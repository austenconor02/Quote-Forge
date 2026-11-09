import "server-only";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Timestamp, type Firestore, type Transaction } from "firebase-admin/firestore";
import type { Bucket } from "@google-cloud/storage";
import type { Company, Quote } from "../models";
import { money } from "../models";
import { calculateQuote, requiredFieldErrors } from "../quote";
import { createProposalPdf } from "../pdf";
import { identifierSchema, quoteInputSchema, validTenantRecord } from "../server-input";
import { invitationOrigin, normalizeInvitationEmail, validInvitationToken } from "../invitation-policy";
import { EmailDeliveryError, type ProposalEmail } from "./email";

export const PROPOSAL_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
export const MAX_PROPOSAL_BYTES = 10 * 1024 * 1024;
export type ProposalReceipt = {delivered: true; proposalId: string};
export class ProposalDeliveryError extends Error {constructor(public status: number, message: string) {super(message);}}
export type ProposalDependencies = {
  db: Firestore; bucket: Pick<Bucket, "file">;
  tenant: (companyId: string) => Promise<{demo: boolean; uid: string}>;
  authorizeTransaction: (transaction: Transaction, companyId: string, uid: string) => Promise<void>;
  readCompany: (companyId: string) => Promise<Company>;
  readQuote: (companyId: string, quoteId: string) => Promise<Quote>;
  emailConfigured: () => boolean; sendEmail: (message: ProposalEmail) => Promise<void>;
  rateLimit: (uid: string, action: string, options: {limit: number; windowMs: number}) => Promise<void>;
  now?: () => number;
};
const digest = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const receipt = (proposalId: string): ProposalReceipt => ({delivered: true, proposalId});
function priorResult(data: FirebaseFirestore.DocumentData): ProposalReceipt {
  if (data.status === "confirmed" && identifierSchema.safeParse(data.proposalId).success) return receipt(data.proposalId);
  throw new ProposalDeliveryError(409, data.status === "unknown" ? "The earlier email delivery is uncertain. This proposal will not be automatically resent. Check the provider before sending an edited version." : "This proposal delivery was already attempted or is in progress. No duplicate email was sent.");
}

export function validateProposalForDelivery(company: Company, input: unknown): Quote {
  const parsed = quoteInputSchema.safeParse(input);
  if (!parsed.success || !validTenantRecord(company.id, parsed.data)) throw new ProposalDeliveryError(400, "The saved proposal contains invalid information.");
  const quote = parsed.data;
  if (company.status !== "Active") throw new ProposalDeliveryError(409, "Activate this company before emailing customer proposals.");
  if (!quote.reviewed || !quote.title.trim() || !quote.customer.name.trim() || !normalizeInvitationEmail(quote.customer.email)) throw new ProposalDeliveryError(400, "Review the saved proposal and provide its title, customer name, and valid customer email before sending.");
  if (requiredFieldErrors(company, quote).length) throw new ProposalDeliveryError(400, "Complete all required proposal fields before sending.");
  const visible = quote.lineItems.filter(item => !item.hiddenFromProposal);
  if (!visible.length || visible.some(item => !item.description.trim() || !(item.quantity > 0) || !(item.unitPrice > 0) || item.needsReview)) throw new ProposalDeliveryError(400, "Review every visible line item, description, quantity, and unit price before sending.");
  if (quote.sourceInput?.documents.some(document => document.status !== "ready" || !!document.error || !document.extractedText?.trim())) throw new ProposalDeliveryError(409, "Finish processing or remove failed source documents before sending this proposal.");
  const totals = calculateQuote(quote);
  if (!(totals.total > 0) || ![totals.net, totals.tax, totals.total, ...totals.items.map(item => item.amount)].every(value => Number.isSafeInteger(Math.round(value * 100)) && value >= 0) || totals.items.some(item => !Number.isFinite(item.displayUnitPrice))) throw new ProposalDeliveryError(400, "The proposal total is invalid. Review its pricing before sending.");
  return quote;
}

// A timestamp-only save must not bypass durable email idempotency after an uncertain response.
function contentDigest(company: Company, quote: Quote) {
  const totals = calculateQuote(quote);
  return digest(JSON.stringify({companyId: company.id, quoteId: quote.id, company: {name: company.name, email: company.email, phone: company.phone, address: company.address, website: company.website, branding: company.branding, fields: company.fields}, title: quote.title, customer: quote.customer, items: totals.items.map(item => ({id: item.id, description: item.description, section: item.section, quantity: item.quantity, unit: item.unit, amount: item.amount})), net: totals.net, tax: totals.tax, total: totals.total, customValues: Object.fromEntries(Object.entries(quote.customValues).sort(([a], [b]) => a.localeCompare(b))), notes: quote.notes}));
}

/** Domain service has injectable dependencies so emulator tests never send external email. */
export function createProposalDeliveryService(deps: ProposalDependencies) {
  const now = deps.now || Date.now;
  async function sendStoredProposal(companyId: string, quoteId: string): Promise<ProposalReceipt> {
    if (!identifierSchema.safeParse(companyId).success || !identifierSchema.safeParse(quoteId).success) throw new ProposalDeliveryError(400, "Invalid proposal identity.");
    const actor = await deps.tenant(companyId);
    const origin = invitationOrigin(process.env.APP_ORIGIN, process.env.NODE_ENV !== "production");
    if (actor.demo || !deps.emailConfigured() || !origin) throw new ProposalDeliveryError(503, "Proposal email delivery is not configured. Your saved proposal has been kept; no email was sent.");
    const [company, savedQuote] = await Promise.all([deps.readCompany(companyId), deps.readQuote(companyId, quoteId)]);
    if (company.id !== companyId || savedQuote.id !== quoteId) throw new ProposalDeliveryError(403, "Stored proposal identity does not match this company.");
    const quote = validateProposalForDelivery(company, savedQuote);
    const version = quote.updatedAt;
    const companyVersion = (company as Company & {updatedAt?: string}).updatedAt;
    const signature = contentDigest(company, quote);
    const operationId = digest(JSON.stringify(["proposal", companyId, quoteId, signature]));
    const operation = deps.db.doc(`mailOperations/${operationId}`);
    const prior = await operation.get();
    if (prior.exists) return priorResult(prior.data()!);
    await deps.rateLimit(actor.uid, "proposal-send", {limit: 10, windowMs: 60000});
    const pdf = Buffer.from(createProposalPdf(company, quote).output("arraybuffer"));
    if (!pdf.length || pdf.length > MAX_PROPOSAL_BYTES) throw new ProposalDeliveryError(413, "The proposal PDF exceeds the 10 MB email delivery limit.");
    const proposalId = randomUUID(), rawToken = randomBytes(32).toString("base64url"), tokenHash = digest(rawToken);
    const share = deps.db.doc(`proposalShares/${tokenHash}`);
    const companyRef = deps.db.doc(`companies/${companyId}`);
    const quoteRef = companyRef.collection("drafts").doc(quoteId);
    const throttle = deps.db.doc("mailOperations/emailjs-global-throttle");
    const storagePath = `companies/${companyId}/proposals/${proposalId}.pdf`;
    const expiresAt = Timestamp.fromMillis(now() + PROPOSAL_LIFETIME_MS);
    const prepared = await deps.db.runTransaction(async transaction => {
      await deps.authorizeTransaction(transaction, companyId, actor.uid);
      const [existing, currentCompany, currentQuote, dispatch] = await Promise.all([transaction.get(operation), transaction.get(companyRef), transaction.get(quoteRef), transaction.get(throttle)]);
      if (existing.exists) return priorResult(existing.data()!);
      if (currentCompany.data()?.status !== "Active" || currentCompany.data()?.updatedAt !== companyVersion || currentQuote.data()?.updatedAt !== version || currentQuote.data()?.reviewed !== true) throw new ProposalDeliveryError(409, "The company or saved proposal changed before sending. Reload and review it again.");
      if (Number(dispatch.data()?.leaseUntil || 0) > now() || Number(dispatch.data()?.lastDispatchAt || 0) > now() - 1100) throw new ProposalDeliveryError(429, "Please wait a moment before sending another email.");
      const time = Timestamp.fromMillis(now());
      transaction.set(operation, {kind: "proposal", companyId, quoteId, proposalId, signature, version, tokenHash, status: "preparing", createdBy: actor.uid, createdAt: time, expiresAt: Timestamp.fromMillis(now() + 30 * 24 * 60 * 60 * 1000)});
      transaction.set(share, {companyId, quoteId, proposalId, storagePath, status: "Prepared", createdAt: time, expiresAt, sha256: digest(pdf), size: pdf.length});
      transaction.set(throttle, {operationId, leaseUntil: now() + 30000, lastDispatchAt: Number(dispatch.data()?.lastDispatchAt || 0)});
      return null;
    });
    if (prepared) return prepared;
    const file = deps.bucket.file(storagePath);
    async function fail(kind: "rejected" | "unknown") {
      await deps.db.runTransaction(async transaction => {
        const [existing, dispatch] = await Promise.all([transaction.get(operation), transaction.get(throttle)]);
        if (!existing.exists || existing.data()?.status === "confirmed") return;
        transaction.update(operation, {status: kind, updatedAt: Timestamp.fromMillis(now())});
        transaction.update(share, {status: kind === "unknown" ? "Unknown" : "Rejected"});
        if (dispatch.data()?.operationId === operationId) transaction.update(throttle, {operationId: null, leaseUntil: 0});
      });
    }
    try {
      await file.save(pdf, {resumable: false, metadata: {contentType: "application/pdf", cacheControl: "private, no-store", metadata: {companyId, proposalId, sha256: digest(pdf), expiresAt: expiresAt.toDate().toISOString()}}});
      await deps.db.runTransaction(async transaction => {
        await deps.authorizeTransaction(transaction, companyId, actor.uid);
        const [existing, currentCompany, currentQuote, dispatch] = await Promise.all([transaction.get(operation), transaction.get(companyRef), transaction.get(quoteRef), transaction.get(throttle)]);
        if (existing.data()?.status !== "preparing" || currentCompany.data()?.status !== "Active" || currentCompany.data()?.updatedAt !== companyVersion || currentQuote.data()?.updatedAt !== version || currentQuote.data()?.reviewed !== true || dispatch.data()?.operationId !== operationId || Number(dispatch.data()?.leaseUntil || 0) <= now()) throw new ProposalDeliveryError(409, "The company or proposal changed before email delivery.");
        transaction.update(operation, {status: "sending", attemptedAt: Timestamp.fromMillis(now())});
        transaction.update(throttle, {lastDispatchAt: now(), leaseUntil: now() + 20000});
      });
    } catch (error) {await fail("rejected"); await file.delete({ignoreNotFound: true}).catch(() => {}); throw error;}
    try {
      await deps.sendEmail({toEmail: normalizeInvitationEmail(quote.customer.email)!, customerName: quote.customer.name, companyName: company.name, proposalUrl: `${origin}/proposal#token=${rawToken}`, proposalTotal: money(calculateQuote(quote).total), proposalTitle: quote.title, expiresAt: expiresAt.toDate().toISOString()});
    } catch (error) {
      const kind = error instanceof EmailDeliveryError ? error.kind : "unknown";
      await fail(kind);
      if (kind === "rejected") await file.delete({ignoreNotFound: true}).catch(() => {});
      throw new ProposalDeliveryError(503, kind === "unknown" ? "Email delivery is uncertain. This proposal will not be automatically resent. Check the provider before sending an edited version." : "The email provider rejected this proposal. No successful delivery was recorded.");
    }
    const confirmed = await deps.db.runTransaction(async transaction => {
      const [existing, currentCompany, currentQuote, dispatch] = await Promise.all([transaction.get(operation), transaction.get(companyRef), transaction.get(quoteRef), transaction.get(throttle)]);
      const valid = existing.data()?.status === "sending" && currentCompany.data()?.status === "Active" && currentCompany.data()?.updatedAt === companyVersion && currentQuote.data()?.updatedAt === version && currentQuote.data()?.reviewed === true;
      if (dispatch.data()?.operationId === operationId) transaction.update(throttle, {operationId: null, leaseUntil: 0});
      transaction.update(operation, {status: valid ? "confirmed" : "confirmed-revoked", deliveredAt: Timestamp.fromMillis(now())});
      transaction.update(share, {status: valid ? "Sent" : "Revoked", deliveredAt: Timestamp.fromMillis(now())});
      return valid;
    });
    if (!confirmed) throw new ProposalDeliveryError(409, "Email delivery completed, but the company or proposal changed while sending. The proposal link has been deactivated.");
    return receipt(proposalId);
  }

  async function downloadSharedProposal(rawToken: string): Promise<{bytes: Buffer; fileName: string}> {
    if (!validInvitationToken(rawToken)) throw new ProposalDeliveryError(404, "This proposal link is unavailable or has expired.");
    const tokenHash = digest(rawToken);
    await deps.rateLimit(tokenHash, "proposal-download", {limit: 20, windowMs: 60000});
    const reference = deps.db.doc(`proposalShares/${tokenHash}`);
    async function validShare() {
      const snapshot = await reference.get(); const data = snapshot.data();
      if (!data || data.status !== "Sent" || !(data.expiresAt instanceof Timestamp) || data.expiresAt.toMillis() <= now() || !identifierSchema.safeParse(data.companyId).success || !identifierSchema.safeParse(data.proposalId).success || data.storagePath !== `companies/${data.companyId}/proposals/${data.proposalId}.pdf`) throw new ProposalDeliveryError(404, "This proposal link is unavailable or has expired.");
      const company = await deps.db.doc(`companies/${data.companyId}`).get();
      if (company.data()?.status !== "Active") throw new ProposalDeliveryError(404, "This proposal link is unavailable or has expired.");
      return data;
    }
    const share = await validShare();
    const file = deps.bucket.file(share.storagePath);
    const [metadata] = await file.getMetadata();
    const size = Number(metadata.size);
    if (!Number.isSafeInteger(size) || size < 1 || size > MAX_PROPOSAL_BYTES || metadata.contentType !== "application/pdf" || metadata.metadata?.firebaseStorageDownloadTokens) throw new ProposalDeliveryError(413, "This proposal file is unavailable.");
    const [bytes] = await file.download({start: 0, end: MAX_PROPOSAL_BYTES});
    if (bytes.length !== size || bytes.length > MAX_PROPOSAL_BYTES || bytes.subarray(0, 5).toString("ascii") !== "%PDF-" || digest(bytes) !== share.sha256) throw new ProposalDeliveryError(413, "This proposal file is unavailable.");
    const current = await validShare();
    if (current.sha256 !== share.sha256 || current.storagePath !== share.storagePath) throw new ProposalDeliveryError(404, "This proposal link is unavailable or has expired.");
    return {bytes, fileName: `proposal-${share.proposalId}.pdf`};
  }
  return {sendStoredProposal, downloadSharedProposal};
}
