import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { applicationDefault, initializeApp, deleteApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { jsPDF } from "jspdf";
import sharp from "sharp";
import { baseUrl, projectId, authEmulatorUrl, createGoogleIdentity, createGoogleSession, jsonRequest, refreshIdentity } from "./http-helpers.mjs";

process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";
process.env.FIREBASE_STORAGE_EMULATOR_HOST = "127.0.0.1:9199";
const app = initializeApp({projectId, storageBucket: "demo-quoteforge.appspot.com", credential: applicationDefault()}, "persistence-http-" + randomUUID());
const db = getFirestore(app); const bucket = getStorage(app).bucket();
const suffix = randomUUID().slice(0, 8);
const companyA = "persistence-a-" + suffix; const companyB = "persistence-b-" + suffix;
const documentId = "document-" + suffix; const draftId = "draft-" + suffix;
let owner; let member; let savedA; let originalPdf;
function inputCompany(id, logo = "") {return {id, name: "Persistence Test " + id, industry: "Services", email: "office@example.com", phone: "555-0100", address: "100 Test St", website: "https://example.com", status: "Active", branding: {primary: "#122239", secondary: "#F5F7FA", accent: "#EE7D3B", font: "Arial", logo}, fields: [], createdAt: "1900-01-01T00:00:00Z", origin: "owner"};}
function quoteInput(source = []) {return {id: draftId, companyId: companyA, title: "Cloud source preservation", customer: {id: "customer-" + suffix, companyId: companyA, name: "Integration Customer", email: "customer@example.com", phone: "555-0101", address: "200 Test St"}, lineItems: [{id: "line-" + suffix, description: "Source priced installation", section: "Installation", quantity: 2, unit: "EA", unitPrice: 42.5, hiddenFromProposal: false, needsReview: false}], markupType: "percent", markupValue: 10, privateAdjustment: 0, taxRate: 0, customValues: {}, notes: "Customer terms", updatedAt: "1900-01-01T00:00:00Z", reviewed: true, sourceInput: {pastedText: "Additional supplied scope", specialInstructions: "Keep original prices", documents: source}};}
before(async () => {
  owner = await createGoogleSession(process.env.EMULATOR_OWNER_EMAIL || "owner@example.com");
  const logo = "data:image/png;base64," + (await sharp({create: {width: 32, height: 32, channels: 4, background: "#EE7D3B"}}).png().toBuffer()).toString("base64");
  const first = await jsonRequest(owner, "/api/companies", "POST", inputCompany(companyA, logo)); assert.equal(first.response.status, 200, JSON.stringify(first.body)); savedA = first.body.company;
  const second = await jsonRequest(owner, "/api/companies", "POST", inputCompany(companyB)); assert.equal(second.response.status, 200, JSON.stringify(second.body));
  const identity = await createGoogleIdentity("persistence-member-" + suffix + "@example.com");
  await db.doc("companies/" + companyA).update({status: "Active", updatedAt: new Date().toISOString()});
  await db.doc("companies/" + companyB).update({status: "Active", updatedAt: new Date().toISOString()});
  await db.doc("companies/" + companyA + "/users/" + identity.uid).set({enabled: true, email: identity.email});
  await db.doc("userAccess/" + identity.uid).set({companyId: companyA, enabled: true, email: identity.email});
  member = await createGoogleSession(identity.email, {identity});
  const pdf = new jsPDF(); pdf.text("Original source document: installation 2 EA at $42.50", 20, 20); originalPdf = Buffer.from(pdf.output("arraybuffer"));
});
after(async () => {await db.terminate(); await deleteApp(app);});

test("company creation stores private logos and enforces server-owned draft status and timestamps", async () => {
  assert.equal(savedA.status, "Draft"); assert.notEqual(savedA.createdAt, "1900-01-01T00:00:00Z"); assert.ok(savedA.updatedAt);
  assert.match(savedA.branding.logo, /^data:image\/png;base64,/);
  const stored = (await db.doc("companies/" + companyA).get()).data();
  assert.equal(stored.branding.logo, ""); assert.match(stored.branding.logoStoragePath, new RegExp("^companies/" + companyA + "/branding/"));
  const [metadata] = await bucket.file(stored.branding.logoStoragePath).getMetadata(); assert.equal(metadata.metadata.firebaseStorageDownloadTokens, undefined);
});
test("owner updates reject stale revisions and client-assigned access", async () => {
  const workspace = await owner.request("/api/tenants/" + companyA + "/workspace"); assert.equal(workspace.status, 200);
  const current = (await workspace.json()).company;
  const update = await jsonRequest(owner, "/api/companies", "POST", {...current, name: "Profile update", status: "Suspended"});
  assert.equal(update.response.status, 200, JSON.stringify(update.body)); assert.equal(update.body.company.status, "Active");
  const stale = await jsonRequest(owner, "/api/companies", "POST", {...current, name: "Stale profile"}); assert.equal(stale.response.status, 409);
  const assignment = await jsonRequest(owner, "/api/companies", "POST", {...update.body.company, assignedEmail: "imposter@example.com"}); assert.equal(assignment.response.status, 409);
});

test("installed company manifests and icons use private saved branding", async () => {
  const response = await owner.request("/app/" + companyA + "/manifest.webmanifest");
  assert.equal(response.status, 200); assert.match(response.headers.get("cache-control"), /private.*no-store/);
  const manifest = await response.json();
  assert.equal(manifest.name, "Profile update"); assert.equal(manifest.theme_color, "#122239");
  assert.equal(manifest.start_url, "/app/" + companyA + "/"); assert.equal(manifest.scope, "/app/" + companyA + "/");
  for (const size of [192, 512]) {
    const iconPath = "/app/" + companyA + "/icons/" + size;
    assert.ok(manifest.icons.some(icon => icon.src === iconPath && icon.sizes === size + "x" + size));
    const iconResponse = await owner.request(iconPath); assert.equal(iconResponse.status, 200); assert.equal(iconResponse.headers.get("content-type"), "image/png");
    const metadata = await sharp(Buffer.from(await iconResponse.arrayBuffer())).metadata(); assert.equal(metadata.width, size); assert.equal(metadata.height, size);
  }
  assert.equal((await member.request("/app/" + companyB + "/manifest.webmanifest")).status, 403);
  assert.equal((await owner.request("/app/" + companyB + "/manifest.webmanifest")).status, 409);
});
test("a verified member can load only the assigned company and cannot use owner APIs", async () => {
  assert.equal((await member.request("/api/tenants/" + companyA + "/workspace")).status, 200);
  assert.equal((await member.request("/api/tenants/" + companyB + "/workspace")).status, 403);
  assert.equal((await member.request("/api/workspace")).status, 403);
  assert.equal((await jsonRequest(member, "/api/companies", "POST", inputCompany("member-created-" + suffix))).response.status, 403);
});
test("document upload checks bytes, preserves originals privately, and refuses cross-tenant reads", async () => {
  const path = "/api/tenants/" + companyA + "/documents/" + documentId;
  const upload = await member.request(path, {method: "POST", headers: {"Content-Type": "application/pdf", "x-file-name": encodeURIComponent("Original estimate.pdf")}, body: originalPdf});
  const body = await upload.json(); assert.equal(upload.status, 200, JSON.stringify(body));
  assert.equal(body.document.sha256, createHash("sha256").update(originalPdf).digest("hex"));
  const download = await member.request(path); assert.equal(download.status, 200); assert.match(download.headers.get("cache-control"), /no-store/); assert.deepEqual(Buffer.from(await download.arrayBuffer()), originalPdf);
  assert.equal((await member.request("/api/tenants/" + companyB + "/documents/" + documentId)).status, 403);
  const fake = await member.request(path + "-fake", {method: "POST", headers: {"Content-Type": "application/pdf", "x-file-name": "renamed.pdf"}, body: "MZ executable data renamed as PDF"}); assert.equal(fake.status, 415);
  const mismatch = await member.request(path + "-mismatch", {method: "POST", headers: {"Content-Type": "image/png", "x-file-name": "wrong.png"}, body: originalPdf}); assert.equal(mismatch.status, 415);
  const huge = await member.request(path + "-huge", {method: "POST", headers: {"Content-Type": "application/pdf", "x-file-name": "huge.pdf"}, body: Buffer.alloc(20 * 1024 * 1024 + 1)}); assert.equal(huge.status, 413);
});

test("private document reads verify stored length and hash and reject oversized blobs", async () => {
  const id = "integrity-" + suffix;
  const hash = createHash("sha256").update(originalPdf).digest("hex");
  const path = "companies/" + companyA + "/documents/" + id + "/" + hash;
  const reference = db.doc("companies/" + companyA + "/documents/" + id);
  const file = bucket.file(path);
  const requestPath = "/api/tenants/" + companyA + "/documents/" + id;
  try {
    const tampered = Buffer.from(originalPdf); tampered[100] ^= 1;
    await file.save(tampered, {resumable: false, metadata: {contentType: "application/pdf"}});
    await reference.set({id, companyId: companyA, name: "Integrity.pdf", mimeType: "application/pdf", size: originalPdf.length, storagePath: path, sha256: hash});
    assert.equal((await member.request(requestPath)).status, 409);
    await reference.update({size: originalPdf.length + 1});
    assert.equal((await member.request(requestPath)).status, 409);
    const oversized = Buffer.alloc(20 * 1024 * 1024 + 1);
    await file.save(oversized, {resumable: false, metadata: {contentType: "application/pdf"}});
    await reference.update({size: oversized.length});
    assert.equal((await member.request(requestPath)).status, 413);
  } finally {await reference.delete(); await file.delete({ignoreNotFound: true});}
});

test("private document reads enforce the persistent per-user rate limit", async () => {
  const reference = db.doc("requestLimits/" + createHash("sha256").update(member.uid + "\0document-download").digest("hex"));
  const previous = await reference.get();
  try {
    await reference.set({windowStartedAt: Date.now(), count: 60, expiresAt: new Date(Date.now() + 60000)});
    assert.equal((await member.request("/api/tenants/" + companyA + "/documents/" + documentId)).status, 429);
  } finally {if (previous.exists) await reference.set(previous.data()); else await reference.delete();}
});
test("cloud drafts atomically save customers and retain extracted sources in private blobs", async () => {
  const metadata = (await db.doc("companies/" + companyA + "/documents/" + documentId).get()).data();
  const source = {id: documentId, name: metadata.name, size: metadata.size, mimeType: metadata.mimeType, status: "ready", progress: 1, pageCount: 1, extractionMethod: "embedded", extractedText: "--- Page 1 ---\nOriginal source document: installation 2 EA at $42.50", storagePath: metadata.storagePath, sha256: metadata.sha256, localFileAvailable: true};
  const quote = quoteInput([source]);
  const save = await jsonRequest(member, "/api/tenants/" + companyA + "/drafts", "POST", quote); assert.equal(save.response.status, 200, JSON.stringify(save.body));
  assert.deepEqual(save.body.record.sourceInput, quote.sourceInput); assert.notEqual(save.body.record.updatedAt, quote.updatedAt);
  const stored = (await db.doc("companies/" + companyA + "/drafts/" + draftId).get()).data();
  assert.equal(stored.sourceInput, undefined); assert.match(stored.sourceStoragePath, new RegExp("^companies/" + companyA + "/draft-sources/"));
  assert.equal(stored.createdBy, member.uid); assert.equal((await db.doc("companies/" + companyA + "/customers/" + quote.customer.id).get()).data().companyId, companyA);
  const reopened = await member.request("/api/tenants/" + companyA + "/workspace"); const workspace = await reopened.json();
  assert.equal(workspace.drafts.find(record => record.id === draftId).sourceInput, undefined);
  assert.equal(workspace.drafts.find(record => record.id === draftId).sourceLoaded, false);
  const fullDraftResponse = await member.request("/api/tenants/" + companyA + "/drafts?recordId=" + draftId); assert.equal(fullDraftResponse.status, 200);
  assert.deepEqual((await fullDraftResponse.json()).record.sourceInput, quote.sourceInput);
  const resaved = await jsonRequest(member, "/api/tenants/" + companyA + "/drafts", "POST", {...quote, title: "Resaved original draft"}); assert.equal(resaved.response.status, 200);
  assert.equal((await db.collection("companies/" + companyA + "/drafts").get()).size, 1);
});
test("malicious tenant record identity, creator fields, and document pointers are rejected", async () => {
  const nested = quoteInput(); nested.customer.companyId = companyB;
  assert.equal((await jsonRequest(member, "/api/tenants/" + companyA + "/drafts", "POST", nested)).response.status, 400);
  assert.equal((await jsonRequest(member, "/api/tenants/" + companyA + "/drafts", "POST", {...quoteInput(), createdBy: owner.uid})).response.status, 400);
  const forged = quoteInput([{id: "forged-" + suffix, name: "Other.pdf", size: 100, mimeType: "application/pdf", status: "ready", storagePath: "companies/" + companyB + "/documents/private/file"}]);
  assert.equal((await jsonRequest(member, "/api/tenants/" + companyA + "/drafts", "POST", forged)).response.status, 400);
  const missingOriginal = quoteInput([{id: "missing-" + suffix, name: "Unstored.pdf", size: 100, mimeType: "application/pdf", status: "ready", extractedText: "No original file was uploaded"}]);
  assert.equal((await jsonRequest(member, "/api/tenants/" + companyA + "/drafts", "POST", missingOriginal)).response.status, 400);
  assert.equal((await jsonRequest(member, "/api/companies", "POST", {...inputCompany("malicious-" + suffix), platformOwner: true})).response.status, 403);
});
test("draft metadata pages do not hydrate source blobs and expose a continuation cursor", async () => {
  const ids = Array.from({length: 26}, (_, index) => "page-" + suffix + "-" + String(index).padStart(2, "0"));
  const existingCount = (await db.collection("companies/" + companyA + "/drafts").get()).size;
  try {
    const batch = db.batch();
    for (const id of ids) {const data = quoteInput(); delete data.sourceInput; batch.set(db.doc("companies/" + companyA + "/drafts/" + id), {...data, id, sourceStoragePath: "companies/" + companyA + "/draft-sources/intentionally-not-downloaded.json", createdBy: member.uid, createdAt: new Date().toISOString()});}
    await batch.commit();
    const firstResponse = await owner.request("/api/tenants/" + companyA + "/drafts"); const first = await firstResponse.json();
    assert.equal(firstResponse.status, 200, JSON.stringify(first)); assert.equal(first.records.length, 25); assert.equal(typeof first.nextCursor, "string");
    assert.ok(first.records.every(record => record.sourceInput === undefined && record.sourceLoaded === false));
    const secondResponse = await owner.request("/api/tenants/" + companyA + "/drafts?cursor=" + encodeURIComponent(first.nextCursor)); const second = await secondResponse.json();
    assert.equal(secondResponse.status, 200); assert.equal(second.records.length, existingCount + ids.length - 25); assert.equal(second.nextCursor, null);
  } finally {const cleanup = db.batch(); ids.forEach(id => cleanup.delete(db.doc("companies/" + companyA + "/drafts/" + id))); await cleanup.commit();}
});
test("an oversized stored source is refused before source hydration", async () => {
  const id = "oversize-" + suffix;
  const path = "companies/" + companyA + "/draft-sources/oversize-" + suffix + ".json";
  try {
    await bucket.file(path).save(Buffer.alloc(4 * 1024 * 1024 + 1, 32), {resumable: false, metadata: {contentType: "application/json"}});
    const data = quoteInput(); delete data.sourceInput;
    await db.doc("companies/" + companyA + "/drafts/" + id).set({...data, id, sourceStoragePath: path, createdBy: member.uid});
    const response = await owner.request("/api/tenants/" + companyA + "/drafts?recordId=" + id); assert.equal(response.status, 413);
  } finally {await db.doc("companies/" + companyA + "/drafts/" + id).delete(); await bucket.file(path).delete({ignoreNotFound: true});}
});
test("company suspension and disabled membership revoke subsequent reads and writes", async () => {
  await db.doc("companies/" + companyA).update({status: "Suspended"});
  assert.equal((await member.request("/api/tenants/" + companyA + "/workspace")).status, 403);
  assert.equal((await jsonRequest(member, "/api/tenants/" + companyA + "/drafts", "POST", quoteInput())).response.status, 403);
  await db.doc("companies/" + companyA).update({status: "Active"}); await db.doc("companies/" + companyA + "/users/" + member.uid).update({enabled: false});
  assert.equal((await member.request("/api/tenants/" + companyA + "/documents/" + documentId)).status, 403);
});
test("verified password accounts still cannot establish a Google-only application session", async () => {
  const email = "password-only-" + suffix + "@example.com";
  const response = await fetch(authEmulatorUrl + "/identitytoolkit.googleapis.com/v1/accounts:signUp?key=emulator-key", {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({email, password: "OnlyUsedInLocalTests123!", returnSecureToken: true})});
  const identity = await response.json(); assert.equal(response.status, 200);
  await getAuth(app).updateUser(identity.localId, {emailVerified: true});
  const refreshed = await refreshIdentity({email, uid: identity.localId, idToken: identity.idToken, refreshToken: identity.refreshToken});
  const rejected = await createGoogleSession(email, {identity: refreshed, allowDenied: true}); assert.equal(rejected.response.status, 401);
});
