import { after, test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Firestore, Timestamp } from "firebase-admin/firestore";
import { applicationDefault, deleteApp, initializeApp } from "firebase-admin/app";
import { getStorage } from "firebase-admin/storage";
import type { Company, Quote } from "../../src/lib/models";
import { sampleQuote } from "../../src/lib/quote";
import { createProposalDeliveryService, PROPOSAL_LIFETIME_MS } from "../../src/lib/server/proposal-delivery-core";
import { EmailDeliveryError, proposalEmailConfigured, sendProposalEmail, type ProposalEmail } from "../../src/lib/server/email";

// Separate local emulator namespace: never clears or modifies the shared owner session/project.
const projectId = "demo-quoteforge-proposals";
process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
process.env.FIREBASE_STORAGE_EMULATOR_HOST = "127.0.0.1:9199";
process.env.APP_ORIGIN = "https://quoteforge.example.test";
const db = new Firestore({projectId, host: "127.0.0.1:8080", ssl: false});
const app = initializeApp({projectId, storageBucket: `${projectId}.appspot.com`, credential: applicationDefault()}, "proposal-delivery-tests");
const bucket = getStorage(app).bucket();
let clock = Date.now() + 60000;
const companyIds: string[] = [], tokenHashes: string[] = [], userIds: string[] = [];
const hash = (raw: string) => createHash("sha256").update(raw).digest("hex");
const tokenFrom = (message: ProposalEmail) => new URL(message.proposalUrl).hash.slice(7);
async function seed() {
  clock += 60000;
  const company: Company = {id: `proposal-${randomUUID()}`, name: "Proposal Test Company", industry: "Roofing", email: "office@example.com", phone: "555-0100", address: "123 Main St", website: "https://example.com", status: "Active", branding: {primary: "#172F48", secondary: "#EAF0F7", accent: "#E6A429", font: "Arial", logo: ""}, fields: [], createdAt: new Date(clock).toISOString()};
  const quote: Quote = {...sampleQuote(company), id: randomUUID(), reviewed: true, updatedAt: new Date(clock).toISOString()};
  const uid = `proposal-user-${randomUUID()}`;
  await Promise.all([db.doc(`companies/${company.id}`).set(company), db.doc(`companies/${company.id}/drafts/${quote.id}`).set(quote), db.doc(`companies/${company.id}/users/${uid}`).set({enabled: true}), db.doc(`userAccess/${uid}`).set({companyId: company.id, enabled: true})]);
  companyIds.push(company.id); userIds.push(uid);
  return {company, quote, uid};
}
function service(uid: string, messages: ProposalEmail[], overrides: Partial<Parameters<typeof createProposalDeliveryService>[0]> = {}) {
  return createProposalDeliveryService({db, bucket, tenant: async () => ({demo: false, uid}), authorizeTransaction: async (transaction, companyId, actorUid) => {
    const [member, access] = await Promise.all([transaction.get(db.doc(`companies/${companyId}/users/${actorUid}`)), transaction.get(db.doc(`userAccess/${actorUid}`))]);
    if (member.data()?.enabled !== true || access.data()?.companyId !== companyId || access.data()?.enabled !== true) throw new Error("Company access changed.");
  }, readCompany: async companyId => (await db.doc(`companies/${companyId}`).get()).data() as Company, readQuote: async (companyId, quoteId) => (await db.doc(`companies/${companyId}/drafts/${quoteId}`).get()).data() as Quote, emailConfigured: () => true, sendEmail: async message => {messages.push(message); tokenHashes.push(hash(tokenFrom(message)));}, rateLimit: async () => {}, now: () => clock, ...overrides});
}
after(async () => {
  for (const companyId of companyIds) {
    const [files] = await bucket.getFiles({prefix: `companies/${companyId}/`}); await Promise.all(files.map(file => file.delete({ignoreNotFound: true})));
    for (const name of ["users", "drafts"]) {const rows = await db.collection(`companies/${companyId}/${name}`).get(); await Promise.all(rows.docs.map(row => row.ref.delete()));}
    const operations = await db.collection("mailOperations").where("companyId", "==", companyId).get(); await Promise.all(operations.docs.map(row => row.ref.delete()));
    const shares = await db.collection("proposalShares").where("companyId", "==", companyId).get(); await Promise.all(shares.docs.map(row => row.ref.delete()));
    await db.doc(`companies/${companyId}`).delete();
  }
  await Promise.all(userIds.map(uid => db.doc(`userAccess/${uid}`).delete()));
  await db.doc("mailOperations/emailjs-global-throttle").delete();
  await db.terminate(); await deleteApp(app);
});

test("missing proposal email configuration prevents all share/PDF writes and mail", async () => {
  const {company, quote, uid} = await seed(); let sends = 0;
  const backend = service(uid, [], {emailConfigured: () => false, sendEmail: async () => {sends++;}});
  await assert.rejects(backend.sendStoredProposal(company.id, quote.id), /not configured/);
  assert.equal(sends, 0);
  assert.equal((await db.collection("proposalShares").where("companyId", "==", company.id).get()).size, 0);
  assert.equal((await bucket.getFiles({prefix: `companies/${company.id}/proposals/`}))[0].length, 0);
});

test("server validation rejects unreviewed, missing fields, bad pricing and unfinished document processing", async () => {
  const {company, quote, uid} = await seed(); const messages: ProposalEmail[] = [], backend = service(uid, messages);
  const invalid: Quote[] = [{...quote, reviewed: false}, {...quote, customer: {...quote.customer, email: "bad"}}, {...quote, lineItems: quote.lineItems.map(item => ({...item, needsReview: true}))}, {...quote, lineItems: quote.lineItems.map(item => ({...item, unitPrice: 0}))}, ...["pending", "processing", "error"].map(status => ({...quote, sourceInput: {pastedText: "", specialInstructions: "", documents: [{id: "source", name: "source.pdf", mimeType: "application/pdf", size: 20, status: status as "pending" | "processing" | "error"}]}}))];
  for (const value of invalid) {await db.doc(`companies/${company.id}/drafts/${quote.id}`).set(value); await assert.rejects(backend.sendStoredProposal(company.id, quote.id));}
  await db.doc(`companies/${company.id}/drafts/${quote.id}`).set(quote);
  await db.doc(`companies/${company.id}`).update({fields: [{id: "field", label: "Project address", type: "Text", required: true, defaultValue: "", options: []}]});
  await assert.rejects(backend.sendStoredProposal(company.id, quote.id), /required/);
  assert.equal(messages.length, 0);
});

test("confirmed delivery uses stored recipient, private immutable PDF and a seven day hash-only share", async () => {
  const {company, quote, uid} = await seed(); const messages: ProposalEmail[] = [];
  const backend = service(uid, messages), result = await backend.sendStoredProposal(company.id, quote.id);
  assert.equal(messages[0].toEmail, quote.customer.email);
  const token = tokenFrom(messages[0]), tokenHash = hash(token); assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(new URL(messages[0].proposalUrl).search, ""); assert.ok(!JSON.stringify(result).includes(token));
  const share = (await db.doc(`proposalShares/${tokenHash}`).get()).data()!;
  assert.equal(share.status, "Sent"); assert.equal(share.expiresAt.toMillis() - share.createdAt.toMillis(), PROPOSAL_LIFETIME_MS);
  assert.ok(!JSON.stringify(share).includes(token));
  assert.equal(share.storagePath, `companies/${company.id}/proposals/${result.proposalId}.pdf`);
  const [metadata] = await bucket.file(share.storagePath).getMetadata();
  assert.equal(metadata.contentType, "application/pdf"); assert.equal(metadata.cacheControl, "private, no-store"); assert.equal(metadata.metadata?.firebaseStorageDownloadTokens, undefined);
  const download = await backend.downloadSharedProposal(token);
  assert.equal(download.bytes.subarray(0, 5).toString("ascii"), "%PDF-");
  assert.match(download.fileName, /^proposal-[a-z0-9-]+\.pdf$/);
  const pdfText = download.bytes.toString("latin1"); assert.ok(pdfText.includes("Unit Price")); assert.ok(!pdfText.includes("markupType"));
});

test("duplicate clicks and timestamp-only saves never resend the same customer content", async () => {
  const {company, quote, uid} = await seed(); const messages: ProposalEmail[] = [], backend = service(uid, messages);
  const result = await backend.sendStoredProposal(company.id, quote.id);
  assert.deepEqual(await backend.sendStoredProposal(company.id, quote.id), result);
  await db.doc(`companies/${company.id}/drafts/${quote.id}`).update({updatedAt: new Date(clock + 1).toISOString()});
  assert.deepEqual(await backend.sendStoredProposal(company.id, quote.id), result); assert.equal(messages.length, 1);
});

test("concurrent delivery attempts create one email and one private PDF", async () => {
  const {company, quote, uid} = await seed(); const messages: ProposalEmail[] = [], backend = service(uid, messages);
  const results = await Promise.allSettled([backend.sendStoredProposal(company.id, quote.id), backend.sendStoredProposal(company.id, quote.id)]);
  assert.equal(messages.length, 1); assert.ok(results.some(result => result.status === "fulfilled"));
  assert.equal((await bucket.getFiles({prefix: `companies/${company.id}/proposals/`}))[0].length, 1);
});

test("expiry, company suspension, unknown tokens and storage tampering block PDF access", async () => {
  const {company, quote, uid} = await seed(); const messages: ProposalEmail[] = [], backend = service(uid, messages);
  await backend.sendStoredProposal(company.id, quote.id); const raw = tokenFrom(messages[0]);
  await assert.rejects(backend.downloadSharedProposal("bad"), /unavailable/);
  await assert.rejects(backend.downloadSharedProposal(randomBytes(32).toString("base64url")), /unavailable/);
  await db.doc(`companies/${company.id}`).update({status: "Suspended"}); await assert.rejects(backend.downloadSharedProposal(raw), /unavailable/);
  await db.doc(`companies/${company.id}`).update({status: "Active"});
  const shareRef = db.doc(`proposalShares/${hash(raw)}`); const share = (await shareRef.get()).data()!;
  await shareRef.update({expiresAt: Timestamp.fromMillis(clock - 1)}); await assert.rejects(backend.downloadSharedProposal(raw), /unavailable/);
  await shareRef.update({expiresAt: Timestamp.fromMillis(clock + PROPOSAL_LIFETIME_MS)});
  await bucket.file(share.storagePath).save(Buffer.from("%PDF-tampered"), {resumable: false, metadata: {contentType: "application/pdf"}});
  await assert.rejects(backend.downloadSharedProposal(raw), /unavailable/);
});

test("uncertain provider response cannot activate a share or automatically resend after another save", async () => {
  const {company, quote, uid} = await seed(); let attempts = 0; const messages: ProposalEmail[] = [];
  const backend = service(uid, messages, {sendEmail: async message => {attempts++; messages.push(message); throw new EmailDeliveryError("unknown");}});
  await assert.rejects(backend.sendStoredProposal(company.id, quote.id), /uncertain/);
  await db.doc(`companies/${company.id}/drafts/${quote.id}`).update({updatedAt: new Date(clock + 10).toISOString()});
  await assert.rejects(backend.sendStoredProposal(company.id, quote.id), /uncertain/);
  await assert.rejects(backend.downloadSharedProposal(tokenFrom(messages[0])), /unavailable/); assert.equal(attempts, 1);
});

test("company or proposal changes during delivery invalidate the emailed link", async () => {
  for (const change of ["company", "quote"]) {
    const {company, quote, uid} = await seed(); const messages: ProposalEmail[] = [];
    const backend = service(uid, messages, {sendEmail: async message => {messages.push(message); if (change === "company") await db.doc(`companies/${company.id}`).update({status: "Suspended"}); else await db.doc(`companies/${company.id}/drafts/${quote.id}`).update({reviewed: false});}});
    await assert.rejects(backend.sendStoredProposal(company.id, quote.id), /deactivated/);
    await assert.rejects(backend.downloadSharedProposal(tokenFrom(messages[0])), /unavailable/);
  }
});

test("membership revocation and global EmailJS invitation lease prevent dispatch", async () => {
  const {company, quote, uid} = await seed(); const messages: ProposalEmail[] = [], backend = service(uid, messages);
  await db.doc(`companies/${company.id}/users/${uid}`).update({enabled: false}); await assert.rejects(backend.sendStoredProposal(company.id, quote.id), /access changed/);
  await db.doc(`companies/${company.id}/users/${uid}`).update({enabled: true});
  await db.doc("mailOperations/emailjs-global-throttle").set({operationId: "invitation-other-owner", leaseUntil: clock + 20000, lastDispatchAt: clock});
  await assert.rejects(backend.sendStoredProposal(company.id, quote.id), /wait a moment/); assert.equal(messages.length, 0);
  await db.doc("mailOperations/emailjs-global-throttle").delete();
});

test("public download applies a token-specific 20-per-minute limit", async () => {
  const {company, quote, uid} = await seed(); const messages: ProposalEmail[] = []; let calls = 0;
  const backend = service(uid, messages, {rateLimit: async (key, action, options) => {if (action === "proposal-download") {assert.equal(key, hash(tokenFrom(messages[0]))); assert.deepEqual(options, {limit: 20, windowMs: 60000}); if (++calls > 20) throw new Error("Too many requests");}}});
  await backend.sendStoredProposal(company.id, quote.id); const token = tokenFrom(messages[0]);
  for (let count = 0; count < 20; count++) await backend.downloadSharedProposal(token);
  await assert.rejects(backend.downloadSharedProposal(token), /Too many/);
});

test("EmailJS proposal uses its separate held template and the fixed provider endpoint", async () => {
  const originalFetch = globalThis.fetch;
  const keys = ["EMAIL_DELIVERY_ENABLED", "EMAILJS_SERVICE_ID", "EMAILJS_INVITATION_TEMPLATE_ID", "EMAILJS_PROPOSAL_TEMPLATE_ID", "EMAILJS_PUBLIC_KEY", "EMAILJS_PRIVATE_KEY"] as const;
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  try {
    Object.assign(process.env, {EMAIL_DELIVERY_ENABLED: "true", EMAILJS_SERVICE_ID: "service_mk2cjul", EMAILJS_INVITATION_TEMPLATE_ID: "invitation-test", EMAILJS_PUBLIC_KEY: "test-public", EMAILJS_PRIVATE_KEY: "test-private"});
    delete process.env.EMAILJS_PROPOSAL_TEMPLATE_ID; assert.equal(proposalEmailConfigured(), false);
    const message: ProposalEmail = {toEmail: "customer@example.com", companyName: "Company", customerName: "Customer", proposalUrl: `https://quoteforge.example.test/proposal#token=${randomBytes(32).toString("base64url")}`, proposalTotal: "$125.00", proposalTitle: "Project", expiresAt: new Date(clock + PROPOSAL_LIFETIME_MS).toISOString()};
    await assert.rejects(sendProposalEmail(message), /not configured/);
    process.env.EMAILJS_PROPOSAL_TEMPLATE_ID = "proposal-test";
    globalThis.fetch = async (url, options) => {assert.equal(url, "https://api.emailjs.com/api/v1.0/email/send"); const body = JSON.parse(String(options?.body)); assert.equal(body.template_id, "proposal-test"); assert.equal(body.service_id, "service_mk2cjul"); assert.equal(body.template_params.to_email, message.toEmail); assert.equal(body.template_params.proposal_url, message.proposalUrl); assert.equal(body.template_params.invitation_url, undefined); return new Response("OK", {status: 200});};
    await sendProposalEmail(message);
    globalThis.fetch = async () => new Response("unexpected provider body", {status: 200}); await assert.rejects(sendProposalEmail(message), error => error instanceof EmailDeliveryError && error.kind === "unknown");
  } finally {globalThis.fetch = originalFetch; for (const key of keys) {if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key];}}
});
