import "server-only";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Timestamp, type Firestore } from "firebase-admin/firestore";
import type { Auth } from "firebase-admin/auth";
import type { Company } from "../models";
import { canAcceptInvitation, invitationOrigin, INVITATION_LIFETIME_MS, normalizeInvitationEmail, validInvitationToken, verifiedGoogleIdentity, type InvitationIdentity } from "../invitation-policy";
import { EmailDeliveryError, type InvitationEmail } from "./email";
import type { InvitationEmailBranding, StoredInvitationCompany } from "../invitation-email-branding";
import { billingAccessAllowed } from "../billing-policy";

export type IssueInput = {companyId: string; company?: Company; email: string; action: "create" | "resend" | "reassign"; idempotencyKey?: string};
export type IssueResult = {companySaved: true; delivered: true; invitationId: string};
type OwnerSession = {demo: boolean; uid: string};
export type InvitationDependencies = {
  db: Firestore; auth: Pick<Auth, "revokeRefreshTokens">; owner: () => Promise<OwnerSession>;
  emailConfigured: () => boolean; sendEmail: (message: InvitationEmail) => Promise<void>;
  prepareBranding: (company: StoredInvitationCompany, expiresAt: string) => Promise<InvitationEmailBranding>;
  saveCompany: (company: unknown) => Promise<Company>;
  rateLimit: (uid: string, action: string, options: {limit: number; windowMs: number}) => Promise<void>;
  now?: () => number;
};
export class InvitationError extends Error {constructor(public status: number, message: string) {super(message);}}
const AccessError = InvitationError;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const validId = (value: unknown): value is string => typeof value === "string" && /^[a-zA-Z0-9-]{1,100}$/.test(value);
const timestampMs = (value: unknown) => value instanceof Timestamp ? value.toMillis() : NaN;
const confirmed = (invitationId: string): IssueResult => ({companySaved: true, delivered: true, invitationId});
function existingOperation(data: FirebaseFirestore.DocumentData): IssueResult | null {
  if (data.status === "rejected") return null; // A definitive rejection can safely retry with a new token.
  if (data.status === "confirmed" && validId(data.invitationId)) return confirmed(data.invitationId);
  throw new AccessError(409, data.status === "unknown" ? "The earlier email delivery is uncertain. It will not be automatically resent. Check the provider before explicitly resending." : "This invitation operation has already been attempted or is in progress. No duplicate email was sent.");
}

/** Dependencies are injectable for emulator tests; public routes use the authenticated production wrappers below. */
export function createInvitationService(deps: InvitationDependencies) {
  const now = deps.now || Date.now;
  async function issue(input: IssueInput): Promise<IssueResult> {
    const owner = await deps.owner();
    if (owner.demo || !deps.emailConfigured()) throw new AccessError(503, "Invitation email delivery is not configured. Nothing was sent. You can save the company as an unassigned draft.");
    const email = normalizeInvitationEmail(input.email);
    const origin = invitationOrigin(process.env.APP_ORIGIN, process.env.NODE_ENV !== "production");
    if (!origin || !email || !validId(input.companyId) || !["create", "resend", "reassign"].includes(input.action) || input.idempotencyKey !== undefined && (typeof input.idempotencyKey !== "string" || !/^[a-zA-Z0-9._:-]{1,128}$/.test(input.idempotencyKey))) throw new AccessError(400, "The invitation request is invalid.");
    const time = now();
    const key = input.idempotencyKey || `${input.action}:${Math.floor(time / 60000)}`;
    const operationId = hash(JSON.stringify([owner.uid, input.companyId, email, input.action, key]));
    const operation = deps.db.collection("mailOperations").doc(operationId);
    const priorOperation = await operation.get();
    if (priorOperation.exists) {const previous = existingOperation(priorOperation.data()!); if (previous) return previous;}
    await deps.rateLimit(owner.uid, "invitation-issue", {limit: 15, windowMs: 60000});
    const companyRef = deps.db.collection("companies").doc(input.companyId);
    const previous = (await companyRef.get()).data();
    if (input.company) {
      if (input.company.id !== input.companyId) throw new AccessError(400, "Company identity does not match.");
      await deps.saveCompany({...input.company, status: previous?.status || "Draft", fields: previous?.fields || input.company.fields, assignedEmail: previous?.assignedEmail || undefined});
    }
    const rawToken = randomBytes(32).toString("base64url");
    const tokenHash = hash(rawToken);
    const invitationId = randomUUID();
    const invitationRef = deps.db.collection("platformInvitations").doc(tokenHash);
    const assignmentRef = deps.db.collection("invitationAssignments").doc(input.companyId);
    const summaryRef = companyRef.collection("invitations").doc(invitationId);
    const throttleRef = deps.db.collection("mailOperations").doc("emailjs-global-throttle");
    const expiresAt = Timestamp.fromMillis(time + INVITATION_LIFETIME_MS);
    const prepared = await deps.db.runTransaction(async transaction => {
      const [opSnapshot, companySnapshot, assignmentSnapshot, throttle, billing] = await Promise.all([transaction.get(operation), transaction.get(companyRef), transaction.get(assignmentRef), transaction.get(throttleRef), transaction.get(deps.db.doc(`companyBilling/${input.companyId}`))]);
      if (opSnapshot.exists) {const result = existingOperation(opSnapshot.data()!); if (result) return {result, revoke: [] as string[], company: null};}
      if (!companySnapshot.exists) throw new AccessError(404, "Company not found.");
      if (!billingAccessAllowed(billing.data())) throw new AccessError(402, "Send the billing setup link first. The activation invitation becomes available after Stripe confirms payment.");
      const company = companySnapshot.data()!;
      const assignment = assignmentSnapshot.data();
      if (company.status === "Suspended" && input.action !== "reassign") throw new AccessError(409, "Reactivate this company before sending an invitation.");
      const currentEmail = normalizeInvitationEmail(company.assignedEmail) || (assignment?.state !== "Rejected" ? normalizeInvitationEmail(assignment?.email) : null);
      if (currentEmail && currentEmail !== email && input.action !== "reassign") throw new AccessError(409, "A different account is assigned. Use secure reassignment to revoke its access first.");
      if (["Preparing", "Sending"].includes(assignment?.state)) throw new AccessError(409, "Invitation delivery is already in progress for this company.");
      if (assignment?.state === "Unknown" && input.action === "create") throw new AccessError(409, "Earlier delivery is uncertain. Check the provider before explicitly resending.");
      if (Number(throttle.data()?.leaseUntil || 0) > time || Number(throttle.data()?.lastDispatchAt || 0) > time - 1100) throw new AccessError(429, "Please wait a moment before sending another email.");
      const oldHash = typeof assignment?.activeTokenHash === "string" && /^[a-f0-9]{64}$/.test(assignment.activeTokenHash) ? assignment.activeTokenHash : null;
      const oldToken = oldHash ? await transaction.get(deps.db.collection("platformInvitations").doc(oldHash)) : null;
      const oldSummary = validId(assignment?.invitationId) ? await transaction.get(companyRef.collection("invitations").doc(assignment.invitationId)) : null;
      const members = input.action === "reassign" ? await transaction.get(companyRef.collection("users").limit(101)) : null;
      const oldInvitations = input.action === "reassign" ? await transaction.get(companyRef.collection("invitations").where("status", "in", ["Prepared", "Sent", "Active"]).limit(101)) : null;
      if ((members?.size || 0) > 100 || (oldInvitations?.size || 0) > 100) throw new AccessError(409, "This company requires an administrator-assisted reassignment because of its access history.");
      const revoke = members?.docs.filter(member => member.id !== owner.uid).map(member => member.id) || [];
      const accessSnapshots = await Promise.all(revoke.map(uid => transaction.get(deps.db.collection("userAccess").doc(uid))));
      if (oldToken?.exists && oldToken.data()?.status !== "Consumed") transaction.update(oldToken.ref, {status: "Revoked", revokedAt: Timestamp.fromMillis(time)});
      if (oldSummary?.exists && ["Prepared", "Sent"].includes(oldSummary.data()?.status)) transaction.update(oldSummary.ref, {status: "Suspended"});
      if (input.action === "reassign") {
        transaction.update(companyRef, {status: "Suspended", updatedAt: new Date(time).toISOString()});
        members!.docs.filter(member => member.id !== owner.uid).forEach(member => transaction.set(member.ref, {enabled: false, revokedAt: new Date(time).toISOString(), revokedBy: owner.uid}, {merge: true}));
        accessSnapshots.forEach(access => {if (access.exists && access.data()?.companyId === input.companyId) transaction.set(access.ref, {enabled: false, updatedAt: new Date(time).toISOString()}, {merge: true});});
        oldInvitations!.docs.forEach(invitation => transaction.update(invitation.ref, {status: "Suspended"}));
      }
      transaction.set(invitationRef, {companyId: input.companyId, email, ownerUid: owner.uid, invitationId, operationId, status: "Prepared", createdAt: Timestamp.fromMillis(time), expiresAt});
      transaction.set(summaryRef, {id: invitationId, companyId: input.companyId, email, status: "Prepared", createdAt: new Date(time).toISOString(), expiresAt: expiresAt.toDate().toISOString()});
      transaction.set(assignmentRef, {activeTokenHash: tokenHash, invitationId, email, operationId, state: "Preparing", updatedAt: Timestamp.fromMillis(time)});
      transaction.set(operation, {companyId: input.companyId, email, ownerUid: owner.uid, invitationId, tokenHash, action: input.action, status: "preparing", createdAt: Timestamp.fromMillis(time), updatedAt: Timestamp.fromMillis(time), expiresAt: Timestamp.fromMillis(time + 30 * 24 * 60 * 60 * 1000)});
      transaction.set(throttleRef, {operationId, leaseUntil: time + 30000, lastDispatchAt: Number(throttle.data()?.lastDispatchAt || 0)});
      return {result: null, revoke, company: {id: input.companyId, name: String(company.name), branding: {primary: company.branding?.primary, ...(company.branding?.logoStoragePath ? {logoStoragePath: company.branding.logoStoragePath} : {})}} as StoredInvitationCompany};
    });
    if (prepared.result) return prepared.result;

    async function fail(kind: "rejected" | "unknown") {
      await deps.db.runTransaction(async transaction => {
        const [op, assignment, throttle] = await Promise.all([transaction.get(operation), transaction.get(assignmentRef), transaction.get(throttleRef)]);
        if (!op.exists || op.data()?.status === "confirmed") return;
        transaction.update(operation, {status: kind, updatedAt: Timestamp.fromMillis(now())});
        transaction.update(invitationRef, {status: kind === "unknown" ? "Unknown" : "Rejected"});
        transaction.update(summaryRef, {status: "Suspended"});
        if (assignment.data()?.operationId === operationId) transaction.update(assignmentRef, {activeTokenHash: null, state: kind === "unknown" ? "Unknown" : "Rejected", updatedAt: Timestamp.fromMillis(now())});
        if (throttle.data()?.operationId === operationId) transaction.update(throttleRef, {operationId: null, leaseUntil: 0});
      });
    }
    const revocation = await Promise.allSettled(prepared.revoke.map(uid => deps.auth.revokeRefreshTokens(uid)));
    if (revocation.some(result => result.status === "rejected")) {
      await fail("rejected");
      throw new AccessError(503, "Previous company access is suspended, but session revocation did not finish. No invitation was sent.");
    }
    let branding: InvitationEmailBranding;
    try {branding = await deps.prepareBranding(prepared.company!, expiresAt.toDate().toISOString());}
    catch {await fail("rejected"); throw new AccessError(503, "The invitation email logo could not be prepared. The company was saved; no email was sent. Check its saved logo and retry.");}
    try {
      await deps.db.runTransaction(async transaction => {
        const [op, assignment, throttle] = await Promise.all([transaction.get(operation), transaction.get(assignmentRef), transaction.get(throttleRef)]);
        if (op.data()?.status !== "preparing" || assignment.data()?.activeTokenHash !== tokenHash || throttle.data()?.operationId !== operationId || Number(throttle.data()?.leaseUntil || 0) <= now()) throw new AccessError(409, "This invitation was invalidated before sending.");
        transaction.update(operation, {status: "sending", attemptedAt: Timestamp.fromMillis(now())});
        transaction.update(assignmentRef, {state: "Sending", updatedAt: Timestamp.fromMillis(now())});
        transaction.update(throttleRef, {lastDispatchAt: now(), leaseUntil: now() + 20000});
      });
    } catch (error) {await fail("rejected"); throw error;}
    try {await deps.sendEmail({...branding, toEmail: email, companyName: prepared.company!.name, invitationUrl: `${origin}/invite#token=${rawToken}`, expiresAt: expiresAt.toDate().toISOString()});}
    catch (error) {const kind = error instanceof EmailDeliveryError ? error.kind : "unknown"; await fail(kind); throw new AccessError(503, kind === "unknown" ? "Email delivery is uncertain. This request will not be automatically resent; check the provider before explicitly resending." : "The email provider rejected this invitation. No successful delivery was recorded.");}
    const result = await deps.db.runTransaction(async transaction => {
      const [op, assignment, company, throttle] = await Promise.all([transaction.get(operation), transaction.get(assignmentRef), transaction.get(companyRef), transaction.get(throttleRef)]);
      if (op.data()?.status === "confirmed") return confirmed(invitationId);
      const valid = assignment.data()?.activeTokenHash === tokenHash && op.data()?.status === "sending" && (company.data()?.status !== "Suspended" || input.action === "reassign");
      if (throttle.data()?.operationId === operationId) transaction.update(throttleRef, {operationId: null, leaseUntil: 0});
      if (!valid) {
        transaction.update(operation, {status: "confirmed-revoked", deliveredAt: Timestamp.fromMillis(now())});
        transaction.update(invitationRef, {status: "Revoked"});
        transaction.update(summaryRef, {status: "Suspended"});
        return null;
      }
      if (!company.exists) throw new AccessError(409, "The company is no longer available.");
      transaction.update(operation, {status: "confirmed", deliveredAt: Timestamp.fromMillis(now())});
      transaction.update(invitationRef, {status: "Sent", deliveredAt: Timestamp.fromMillis(now())});
      transaction.update(summaryRef, {status: "Sent", deliveredAt: new Date(now()).toISOString()});
      transaction.update(assignmentRef, {state: "Sent", updatedAt: Timestamp.fromMillis(now())});
      transaction.update(companyRef, {status: "Active", assignedEmail: email, updatedAt: new Date(now()).toISOString()});
      return confirmed(invitationId);
    });
    if (!result) throw new AccessError(409, "Email delivery completed, but the invitation was deactivated while sending. Its link cannot grant access.");
    return result;
  }

  async function accept(rawToken: string, identity: InvitationIdentity): Promise<{companyId: string}> {
    if (!validInvitationToken(rawToken) || !verifiedGoogleIdentity(identity)) throw new AccessError(403, "A verified Google account and valid invitation are required.");
    await deps.rateLimit(identity.uid, "invitation-accept", {limit: 10, windowMs: 60000});
    const tokenHash = hash(rawToken);
    const invitationRef = deps.db.collection("platformInvitations").doc(tokenHash);
    return deps.db.runTransaction(async transaction => {
      const [invitationSnapshot, config, access] = await Promise.all([transaction.get(invitationRef), transaction.get(deps.db.collection("platform").doc("config")), transaction.get(deps.db.collection("userAccess").doc(identity.uid))]);
      const invitation = invitationSnapshot.data();
      if (!invitation || !validId(invitation.companyId) || !validId(invitation.invitationId)) throw new AccessError(403, "This invitation is invalid or no longer available.");
      const companyRef = deps.db.collection("companies").doc(invitation.companyId);
      const assignmentRef = deps.db.collection("invitationAssignments").doc(invitation.companyId);
      const memberRef = companyRef.collection("users").doc(identity.uid);
      const [company, assignment, member] = await Promise.all([transaction.get(companyRef), transaction.get(assignmentRef), transaction.get(memberRef)]);
      if (!canAcceptInvitation({email: invitation.email, status: invitation.status, expiresAt: timestampMs(invitation.expiresAt), companyStatus: company.data()?.status, tokenHash, currentTokenHash: assignment.data()?.activeTokenHash || null}, identity, now())) throw new AccessError(403, "This invitation cannot be accepted by this account or is no longer valid. Ask the owner for a new invitation.");
      const isPlatformOwner = config.data()?.ownerUid === identity.uid;
      let previousMembership: FirebaseFirestore.DocumentSnapshot | null = null;
      if (!isPlatformOwner && access.exists && access.data()?.companyId !== invitation.companyId) {
        if (access.data()?.enabled !== false || !validId(access.data()?.companyId)) throw new AccessError(409, "This account is assigned to another company. Its existing access must be securely reassigned by the owner.");
        previousMembership = await transaction.get(deps.db.collection("companies").doc(access.data()!.companyId).collection("users").doc(identity.uid));
      }
      const time = new Date(now()).toISOString();
      transaction.update(invitationRef, {status: "Consumed", consumedBy: identity.uid, consumedAt: Timestamp.fromMillis(now())});
      transaction.update(companyRef.collection("invitations").doc(invitation.invitationId), {status: "Active", acceptedAt: time});
      transaction.update(assignmentRef, {state: "Consumed", updatedAt: Timestamp.fromMillis(now())});
      if (!isPlatformOwner) {
        if (previousMembership?.exists) transaction.set(previousMembership.ref, {enabled: false, updatedAt: time}, {merge: true});
        transaction.set(memberRef, {uid: identity.uid, email: normalizeInvitationEmail(identity.email), role: "member", enabled: true, createdBy: invitation.ownerUid, createdAt: member.data()?.createdAt || time, updatedAt: time}, {merge: true});
        transaction.set(deps.db.collection("userAccess").doc(identity.uid), {companyId: invitation.companyId, email: normalizeInvitationEmail(identity.email), enabled: true, updatedAt: time}, {merge: true});
      }
      transaction.update(companyRef, {assignedUid: identity.uid, assignedEmail: normalizeInvitationEmail(identity.email), updatedAt: time});
      return {companyId: invitation.companyId};
    });
  }

  async function changeAccess(companyId: string, action: "suspend" | "reactivate") {
    const owner = await deps.owner();
    if (owner.demo) throw new AccessError(503, "Live account access changes require the independent Firebase project.");
    if (!validId(companyId) || !["suspend", "reactivate"].includes(action)) throw new AccessError(400, "Invalid company access request.");
    await deps.rateLimit(owner.uid, "company-access", {limit: 15, windowMs: 60000});
    const reference = deps.db.collection("companies").doc(companyId);
    const assignmentRef = deps.db.collection("invitationAssignments").doc(companyId);
    const result = await deps.db.runTransaction(async transaction => {
      const [company, assignment, members] = await Promise.all([transaction.get(reference), transaction.get(assignmentRef), transaction.get(reference.collection("users").limit(101))]);
      if (!company.exists) throw new AccessError(404, "Company not found.");
      if (members.size > 100) throw new AccessError(409, "This company requires an administrator-assisted access update.");
      const oldHash = assignment.data()?.activeTokenHash;
      const oldToken = typeof oldHash === "string" && /^[a-f0-9]{64}$/.test(oldHash) ? await transaction.get(deps.db.collection("platformInvitations").doc(oldHash)) : null;
      const status = action === "suspend" ? "Suspended" : members.docs.some(member => member.id !== owner.uid && member.data().enabled === true) ? "Active" : "Draft";
      transaction.update(reference, {status, updatedAt: new Date(now()).toISOString()});
      if (action === "suspend" && assignment.exists) {
        transaction.update(assignmentRef, {activeTokenHash: null, state: "Suspended", updatedAt: Timestamp.fromMillis(now())});
        if (oldToken?.exists && oldToken.data()?.status !== "Consumed") {
          transaction.update(oldToken.ref, {status: "Revoked", revokedAt: Timestamp.fromMillis(now())});
          if (validId(oldToken.data()?.invitationId)) transaction.update(reference.collection("invitations").doc(oldToken.data()!.invitationId), {status: "Suspended"});
        }
      }
      return {companyId, status, revoke: action === "suspend" ? members.docs.filter(member => member.id !== owner.uid).map(member => member.id) : []};
    });
    const revocation = await Promise.allSettled(result.revoke.map(uid => deps.auth.revokeRefreshTokens(uid)));
    if (revocation.some(item => item.status === "rejected")) throw new AccessError(503, "Company access is suspended, but session revocation could not fully complete. Access remains blocked; retry deactivation to finish revoking sessions.");
    return {companyId: result.companyId, status: result.status};
  }
  return {issueInvitation: issue, acceptInvitation: accept, changeCompanyAccess: changeAccess};
}
