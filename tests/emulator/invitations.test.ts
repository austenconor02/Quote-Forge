import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { Firestore, Timestamp } from "firebase-admin/firestore";
import { deleteApp, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import type { Company } from "../../src/lib/models";
import { invitationEmailBranding } from "../../src/lib/invitation-email-branding";
import { demoCompanies } from "../../src/lib/demo";
import { createInvitationService } from "../../src/lib/server/invitation-core";
import { EmailDeliveryError, invitationEmailConfigured, sendInvitationEmail, type InvitationEmail } from "../../src/lib/server/email";

// All connections are explicitly confined to the local demo project, never the supplied live project.
process.env.QUOTEFORGE_FIREBASE_ENABLED = "true";
process.env.QUOTEFORGE_USE_EMULATORS = "true";
process.env.FIREBASE_PROJECT_ID = "demo-quoteforge";
process.env.FIREBASE_STORAGE_BUCKET = "demo-quoteforge.appspot.com";
process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";
process.env.FIREBASE_STORAGE_EMULATOR_HOST = "127.0.0.1:9199";
process.env.APP_ORIGIN = "https://quoteforge.example.test";
const db = new Firestore({projectId: "demo-quoteforge", host: "127.0.0.1:8080", ssl: false});
const app = initializeApp({projectId: "demo-quoteforge"}, "invitation-emulator-tests");
const auth = getAuth(app);
let clock = Date.now() + 60000;
const companies: string[] = [], tokens: string[] = [], users: string[] = [];
const tokenFrom = (message: InvitationEmail) => new URL(message.invitationUrl).hash.slice("#token=".length);
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const identity = (uid: string, email: string) => ({uid, email, email_verified: true, provider: "google.com"});
async function seed(status: Company["status"] = "Draft") {
  const company = {...structuredClone(demoCompanies[0]), id: `inv-${randomUUID()}`, name: "Invitation Test Company", status, fields: []};
  companies.push(company.id);
  await db.doc(`companies/${company.id}`).set(company);
  return company;
}
function service(messages: InvitationEmail[], overrides: Partial<Parameters<typeof createInvitationService>[0]> = {}) {
  const ownerUid = `inv-owner-${randomUUID()}`;
  return createInvitationService({db, auth, owner: async () => ({demo: false, uid: ownerUid}), emailConfigured: () => true, prepareBranding: async company => invitationEmailBranding(company.branding.primary, `https://quoteforge.example.test/api/invitations/logo/${"b".repeat(43)}.png`), saveCompany: async input => {
    const company = input as Company; await db.doc(`companies/${company.id}`).set(company, {merge: true}); return company;
  }, sendEmail: async message => {messages.push(message); tokens.push(digest(tokenFrom(message)));}, rateLimit: async () => {}, now: () => clock, ...overrides});
}
async function issue(backend: ReturnType<typeof service>, company: Company, email: string, key = randomUUID()) {
  clock += 60000;
  return backend.issueInvitation({companyId: company.id, email, action: "create", idempotencyKey: key});
}
before(async () => {
  await db.doc("mailOperations/emailjs-global-throttle").delete();
});
after(async () => {
  for (const companyId of companies) {
    for (const name of ["users", "invitations"]) {const rows = await db.collection(`companies/${companyId}/${name}`).get(); await Promise.all(rows.docs.map(row => row.ref.delete()));}
    const operations = await db.collection("mailOperations").where("companyId", "==", companyId).get(); await Promise.all(operations.docs.map(row => row.ref.delete()));
    await db.doc(`invitationAssignments/${companyId}`).delete(); await db.doc(`companies/${companyId}`).delete();
  }
  for (const tokenHash of tokens) await db.doc(`platformInvitations/${tokenHash}`).delete();
  for (const uid of users) {await db.doc(`userAccess/${uid}`).delete(); await auth.deleteUser(uid).catch(() => {});}
  await db.doc("mailOperations/emailjs-global-throttle").delete();
  await db.terminate(); await deleteApp(app);
});

test("missing EmailJS configuration prevents company writes and sending", async () => {
  let saves = 0, sends = 0;
  const backend = service([], {emailConfigured: () => false, saveCompany: async () => {saves++; throw new Error("must not save");}, sendEmail: async () => {sends++;}});
  const company = {...structuredClone(demoCompanies[0]), id: `inv-${randomUUID()}`};
  await assert.rejects(backend.issueInvitation({companyId: company.id, company, email: "client@example.com", action: "create"}), /not configured/);
  assert.equal(saves, 0); assert.equal(sends, 0); assert.equal((await db.doc(`companies/${company.id}`).get()).exists, false);
});

test("confirmed issuance stores only a token hash and durable idempotency prevents duplicate email", async () => {
  const company = await seed(), messages: InvitationEmail[] = [];
  const backend = service(messages); const key = randomUUID();
  const result = await issue(backend, company, "client@example.com", key);
  const repeated = await backend.issueInvitation({companyId: company.id, email: "client@example.com", action: "create", idempotencyKey: key});
  assert.deepEqual(repeated, result); assert.equal(messages.length, 1);
  const raw = tokenFrom(messages[0]); assert.match(raw, /^[A-Za-z0-9_-]{43}$/);
  assert.ok(!JSON.stringify(result).includes(raw)); assert.equal(new URL(messages[0].invitationUrl).search, "");
  const privateRecord = (await db.doc(`platformInvitations/${digest(raw)}`).get()).data()!;
  assert.equal(privateRecord.status, "Sent"); assert.equal(privateRecord.expiresAt.toMillis() - privateRecord.createdAt.toMillis(), 604800000);
  assert.ok(!JSON.stringify(privateRecord).includes(raw));
  const summary = (await db.doc(`companies/${company.id}/invitations/${result.invitationId}`).get()).data()!;
  assert.equal(summary.status, "Sent"); assert.equal(summary.tokenHash, undefined); assert.equal(summary.operationId, undefined);
});

test("branding comes from the saved company and a definitively rejected send retries without duplicating it", async () => {
  const company = await seed(), messages: InvitationEmail[] = [];
  const key = randomUUID(); let reject = true;
  const backend = service(messages, {sendEmail: async message => {messages.push(message); tokens.push(digest(tokenFrom(message))); if (reject) throw new EmailDeliveryError("rejected");}});
  await assert.rejects(issue(backend, company, "retry@example.com", key), /provider rejected/);
  assert.equal((await db.doc(`companies/${company.id}`).get()).data()?.status, "Draft");
  assert.equal(messages[0].companyName, company.name);
  assert.equal(messages[0].primaryColor, company.branding.primary.toUpperCase());
  reject = false; clock += 60000;
  await backend.issueInvitation({companyId: company.id, email: "retry@example.com", action: "create", idempotencyKey: key});
  assert.equal(messages.length, 2); assert.notEqual(tokenFrom(messages[0]), tokenFrom(messages[1]));
  const uid = `inv-user-${randomUUID()}`; users.push(uid);
  await assert.rejects(backend.acceptInvitation(tokenFrom(messages[0]), identity(uid, "retry@example.com")), /no longer valid/);
  assert.deepEqual(await backend.acceptInvitation(tokenFrom(messages[1]), identity(uid, "retry@example.com")), {companyId: company.id});
});

test("each explicit resend invalidates the prior unused link even within the same minute", async () => {
  const company = await seed(), messages: InvitationEmail[] = [], backend = service(messages);
  await issue(backend, company, "resend@example.com"); clock += 2000;
  await backend.issueInvitation({companyId: company.id, email: "resend@example.com", action: "resend", idempotencyKey: randomUUID()});
  assert.notEqual(tokenFrom(messages[0]), tokenFrom(messages[1]));
  assert.equal((await db.doc(`platformInvitations/${digest(tokenFrom(messages[0]))}`).get()).data()?.status, "Revoked");
  const uid = `inv-user-${randomUUID()}`; users.push(uid);
  await assert.rejects(backend.acceptInvitation(tokenFrom(messages[0]), identity(uid, "resend@example.com")), /no longer valid/);
  await backend.acceptInvitation(tokenFrom(messages[1]), identity(uid, "resend@example.com"));
});

test("unauthorized issuance never writes a company or prepares a public logo", async () => {
  let writes = 0, assets = 0;
  const backend = service([], {owner: async () => {throw new Error("owner access required");}, saveCompany: async () => {writes++; throw new Error();}, prepareBranding: async () => {assets++; throw new Error();}});
  await assert.rejects(backend.issueInvitation({companyId: "forbidden", email: "test@example.com", action: "create"}), /owner access required/);
  assert.equal(writes, 0); assert.equal(assets, 0);
});

test("unpaid companies cannot send an activation invitation before confirmed payment", async () => {
  const company = await seed(), messages: InvitationEmail[] = [], backend = service(messages);
  const billing = db.doc(`companyBilling/${company.id}`);
  try {await billing.set({enabled: true, status: "Payment Required", entitled: false}); await assert.rejects(issue(backend, company, "unpaid@example.com"), /billing setup link first/); assert.equal(messages.length, 0);}
  finally {await billing.delete();}
});

test("acceptance requires the invited verified Google email and consumes the token once", async () => {
  const company = await seed(), messages: InvitationEmail[] = [];
  const backend = service(messages); await issue(backend, company, "accept@example.com");
  const raw = tokenFrom(messages[0]), uid = `inv-user-${randomUUID()}`; users.push(uid);
  await assert.rejects(backend.acceptInvitation(raw, identity(uid, "wrong@example.com")), /cannot be accepted/);
  await assert.rejects(backend.acceptInvitation(raw, {...identity(uid, "accept@example.com"), provider: "password"}), /verified Google/);
  await assert.rejects(backend.acceptInvitation(raw, {...identity(uid, "accept@example.com"), email_verified: false}), /verified Google/);
  assert.deepEqual(await backend.acceptInvitation(raw, identity(uid, "ACCEPT@example.com")), {companyId: company.id});
  assert.equal((await db.doc(`companies/${company.id}/users/${uid}`).get()).data()?.enabled, true);
  assert.equal((await db.doc(`userAccess/${uid}`).get()).data()?.companyId, company.id);
  await assert.rejects(backend.acceptInvitation(raw, identity(uid, "accept@example.com")), /no longer valid/);
});

test("concurrent redemption has exactly one successful transaction", async () => {
  const company = await seed(), messages: InvitationEmail[] = [];
  const backend = service(messages); await issue(backend, company, "race@example.com");
  const uid = `inv-user-${randomUUID()}`; users.push(uid);
  const results = await Promise.allSettled([backend.acceptInvitation(tokenFrom(messages[0]), identity(uid, "race@example.com")), backend.acceptInvitation(tokenFrom(messages[0]), identity(uid, "race@example.com"))]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(results.filter(result => result.status === "rejected").length, 1);
});

test("expiry and suspension block acceptance without granting memberships", async () => {
  const company = await seed(), messages: InvitationEmail[] = [];
  const backend = service(messages); await issue(backend, company, "expired@example.com");
  const uid = `inv-user-${randomUUID()}`; users.push(uid);
  const raw = tokenFrom(messages[0]); await db.doc(`platformInvitations/${digest(raw)}`).update({expiresAt: Timestamp.fromMillis(clock)});
  await assert.rejects(backend.acceptInvitation(raw, identity(uid, "expired@example.com")), /no longer valid/);
  assert.equal((await db.doc(`companies/${company.id}/users/${uid}`).get()).exists, false);
  clock += 60000; await backend.issueInvitation({companyId: company.id, email: "expired@example.com", action: "resend"});
  assert.equal((await backend.changeCompanyAccess(company.id, "suspend")).status, "Suspended");
  await assert.rejects(backend.acceptInvitation(tokenFrom(messages[1]), identity(uid, "expired@example.com")), /no longer valid/);
  assert.equal((await backend.changeCompanyAccess(company.id, "reactivate")).status, "Draft");
});

test("an account assigned to another company cannot redeem a new company invitation", async () => {
  const company = await seed(), messages: InvitationEmail[] = [];
  const backend = service(messages); await issue(backend, company, "assigned@example.com");
  const uid = `inv-user-${randomUUID()}`; users.push(uid);
  await db.doc(`userAccess/${uid}`).set({companyId: "another-company", email: "assigned@example.com", enabled: true});
  await assert.rejects(backend.acceptInvitation(tokenFrom(messages[0]), identity(uid, "assigned@example.com")), /another company/);
  assert.equal((await db.doc(`platformInvitations/${digest(tokenFrom(messages[0]))}`).get()).data()?.status, "Sent");
  assert.equal((await db.doc(`companies/${company.id}/users/${uid}`).get()).exists, false);
});

test("secure reassignment disables previous access and revokes sessions before new email delivery", async () => {
  const company = await seed(), messages: InvitationEmail[] = [], revoked: string[] = [];
  const oldUid = `inv-user-${randomUUID()}`, newUid = `inv-user-${randomUUID()}`; users.push(oldUid, newUid);
  await auth.createUser({uid: oldUid, email: `${oldUid}@example.com`, emailVerified: true});
  const backend = service(messages, {auth: {revokeRefreshTokens: async uid => {revoked.push(uid); await auth.revokeRefreshTokens(uid);}}, sendEmail: async message => {
    if (messages.length) {assert.ok(revoked.includes(oldUid)); assert.equal((await db.doc(`companies/${company.id}/users/${oldUid}`).get()).data()?.enabled, false); assert.equal((await db.doc(`userAccess/${oldUid}`).get()).data()?.enabled, false); assert.equal((await db.doc(`companies/${company.id}`).get()).data()?.assignedEmail, "old@example.com");}
    messages.push(message); tokens.push(digest(tokenFrom(message)));
  }});
  await issue(backend, company, "old@example.com"); await backend.acceptInvitation(tokenFrom(messages[0]), identity(oldUid, "old@example.com"));
  clock += 60000;
  await assert.rejects(backend.issueInvitation({companyId: company.id, email: "new@example.com", action: "resend"}), /secure reassignment/);
  await backend.issueInvitation({companyId: company.id, email: "new@example.com", action: "reassign", idempotencyKey: randomUUID()});
  assert.equal((await db.doc(`companies/${company.id}`).get()).data()?.assignedEmail, "new@example.com");
  await backend.acceptInvitation(tokenFrom(messages[1]), identity(newUid, "new@example.com"));
  assert.equal((await db.doc(`companies/${company.id}/users/${oldUid}`).get()).data()?.enabled, false);
  assert.equal((await db.doc(`companies/${company.id}/users/${newUid}`).get()).data()?.enabled, true);
});

test("an explicitly revoked old binding can move while its prior membership stays disabled", async () => {
  const oldCompany = await seed("Active"), company = await seed(), messages: InvitationEmail[] = [];
  const backend = service(messages); await issue(backend, company, "moved@example.com");
  const uid = `inv-user-${randomUUID()}`; users.push(uid);
  await db.doc(`companies/${oldCompany.id}/users/${uid}`).set({uid, enabled: false});
  await db.doc(`userAccess/${uid}`).set({companyId: oldCompany.id, email: "moved@example.com", enabled: false});
  await backend.acceptInvitation(tokenFrom(messages[0]), identity(uid, "moved@example.com"));
  assert.equal((await db.doc(`userAccess/${uid}`).get()).data()?.companyId, company.id);
  assert.equal((await db.doc(`userAccess/${uid}`).get()).data()?.enabled, true);
  assert.equal((await db.doc(`companies/${oldCompany.id}/users/${uid}`).get()).data()?.enabled, false);
  assert.equal((await db.doc(`companies/${company.id}/users/${uid}`).get()).data()?.enabled, true);
});

test("uncertain provider acceptance never activates a token or automatically resends an operation", async () => {
  const company = await seed(), messages: InvitationEmail[] = [];
  let calls = 0;
  const backend = service(messages, {sendEmail: async message => {calls++; messages.push(message); tokens.push(digest(tokenFrom(message))); throw new EmailDeliveryError("unknown");}});
  const key = randomUUID(); clock += 60000;
  await assert.rejects(backend.issueInvitation({companyId: company.id, email: "uncertain@example.com", action: "create", idempotencyKey: key}), /uncertain/);
  await assert.rejects(backend.issueInvitation({companyId: company.id, email: "uncertain@example.com", action: "create", idempotencyKey: key}), /uncertain/);
  assert.equal(calls, 1); assert.equal((await db.doc(`companies/${company.id}`).get()).data()?.status, "Draft");
  const uid = `inv-user-${randomUUID()}`; users.push(uid);
  await assert.rejects(backend.acceptInvitation(tokenFrom(messages[0]), identity(uid, "uncertain@example.com")), /no longer valid/);
});

test("a global delivery lease blocks overlapping emails even for a different owner/company", async () => {
  const firstCompany = await seed(), secondCompany = await seed(), messages: InvitationEmail[] = [];
  let release!: () => void, started!: () => void;
  const held = new Promise<void>(resolve => {release = resolve;});
  const reached = new Promise<void>(resolve => {started = resolve;});
  const first = service(messages, {sendEmail: async message => {messages.push(message); tokens.push(digest(tokenFrom(message))); started(); await held;}});
  const secondMessages: InvitationEmail[] = [], second = service(secondMessages);
  const pending = issue(first, firstCompany, "first@example.com"); await reached;
  try {await assert.rejects(second.issueInvitation({companyId: secondCompany.id, email: "second@example.com", action: "create", idempotencyKey: randomUUID()}), /wait a moment/);}
  finally {release();}
  await pending; assert.equal(messages.length, 1); assert.equal(secondMessages.length, 0);
});

test("deactivation while email is in flight cannot reactivate the company or leave a usable invitation", async () => {
  const company = await seed(), messages: InvitationEmail[] = [];
  let backend!: ReturnType<typeof service>;
  backend = service(messages, {sendEmail: async message => {messages.push(message); tokens.push(digest(tokenFrom(message))); await backend.changeCompanyAccess(company.id, "suspend");}});
  await assert.rejects(issue(backend, company, "race-suspension@example.com"), /deactivated while sending/);
  assert.equal((await db.doc(`companies/${company.id}`).get()).data()?.status, "Suspended");
  const uid = `inv-user-${randomUUID()}`; users.push(uid);
  await assert.rejects(backend.acceptInvitation(tokenFrom(messages[0]), identity(uid, "race-suspension@example.com")), /no longer valid/);
});

test("EmailJS remains gated and only an explicit OK response confirms provider acceptance", async () => {
  const oldFetch = globalThis.fetch;
  const names = ["EMAIL_DELIVERY_ENABLED", "EMAILJS_SERVICE_ID", "EMAILJS_INVITATION_TEMPLATE_ID", "EMAILJS_PUBLIC_KEY", "EMAILJS_PRIVATE_KEY"];
  const originals = Object.fromEntries(names.map(name => [name, process.env[name]]));
  let calls = 0, mode = "ok";
  const message = {...invitationEmailBranding("#122239", `https://quoteforge.example.test/api/invitations/logo/${"b".repeat(43)}.png`), toEmail: "test@example.com", companyName: "Test Company", invitationUrl: `https://quoteforge.example.test/invite#token=${"x".repeat(43)}`, expiresAt: new Date(clock + 604800000).toISOString()};
  try {
    process.env.EMAIL_DELIVERY_ENABLED = "false";
    globalThis.fetch = (async (url, options) => {
      assert.equal(url, "https://api.emailjs.com/api/v1.0/email/send"); calls++;
      const body = JSON.parse(options!.body as string); assert.equal(body.service_id, "service-test"); assert.equal(body.accessToken, "private-test"); assert.deepEqual(body.template_params, {to_email: message.toEmail, company_name: message.companyName, company_logo_url: message.companyLogoUrl, primary_color: message.primaryColor, header_text_color: message.headerTextColor, button_text_color: message.buttonTextColor, invite_url: message.invitationUrl, expires_in: "7 days"});
      if (mode === "network") throw new TypeError("network error");
      return new Response(mode === "ok" ? "OK" : "not confirmed", {status: mode === "reject" ? 401 : 200});
    }) as typeof fetch;
    assert.equal(invitationEmailConfigured(), false); await assert.rejects(sendInvitationEmail(message)); assert.equal(calls, 0);
    Object.assign(process.env, {EMAIL_DELIVERY_ENABLED: "true", EMAILJS_SERVICE_ID: "service-test", EMAILJS_INVITATION_TEMPLATE_ID: "template-test", EMAILJS_PUBLIC_KEY: "public-test", EMAILJS_PRIVATE_KEY: "private-test"});
    assert.equal(invitationEmailConfigured(), true); await sendInvitationEmail(message);
    mode = "unexpected"; await assert.rejects(sendInvitationEmail(message), (error: unknown) => error instanceof EmailDeliveryError && error.kind === "unknown");
    mode = "reject"; await assert.rejects(sendInvitationEmail(message), (error: unknown) => error instanceof EmailDeliveryError && error.kind === "rejected");
    mode = "network"; await assert.rejects(sendInvitationEmail(message), (error: unknown) => error instanceof EmailDeliveryError && error.kind === "unknown");
  } finally {
    globalThis.fetch = oldFetch;
    for (const name of names) {if (originals[name] === undefined) delete process.env[name]; else process.env[name] = originals[name];}
  }
});
