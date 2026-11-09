import "server-only";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { FieldPath } from "firebase-admin/firestore";
import { requireTenant, requireOwner, AccessError } from "./auth";
import { adminServices } from "./firebase";
import type { Company, Customer, Quote, Workspace } from "../models";
import { createEmptyWorkspace } from "../workspace-storage";
import { companyInputSchema, customerInputSchema, identifierSchema, quoteInputSchema, type ResourceName, validTenantRecord } from "../server-input";
import { enforceRateLimit } from "./rate-limit";

const digest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const jsonSize = (input: unknown) => Buffer.byteLength(JSON.stringify(input), "utf8");
function timestampString(value: unknown): string | undefined { if (typeof value === "string") return value; if (value && typeof value === "object" && "toDate" in value && typeof value.toDate === "function") return value.toDate().toISOString(); return undefined; }
function recordId(value: string) { if (!identifierSchema.safeParse(value).success) throw new AccessError(400, "Invalid record identity."); return value; }
function parseCompany(value: unknown) { const result = companyInputSchema.safeParse(value); if (!result.success) throw new AccessError(400, "Company information is invalid. Check the name, colors, contact details, logo, and custom fields."); return result.data; }
function parseQuote(value: unknown, companyId: string) { const result = quoteInputSchema.safeParse(value); if (!result.success || !validTenantRecord(companyId, result.data)) throw new AccessError(400, "The draft contains invalid data or belongs to another company."); return result.data; }
function parseCustomer(value: unknown, companyId: string) { const result = customerInputSchema.safeParse(value); if (!result.success || !validTenantRecord(companyId, result.data)) throw new AccessError(400, "The customer contains invalid data or belongs to another company."); return result.data; }

export async function assertTenantTransaction(transaction: FirebaseFirestore.Transaction, companyId: string, uid: string) {
  const {db} = adminServices();
  const owner = await transaction.get(db.doc("platform/config"));
  if (owner.data()?.ownerUid === uid) return;
  const [company, assignment, membership] = await Promise.all([
    transaction.get(db.doc(`companies/${companyId}`)),
    transaction.get(db.doc(`userAccess/${uid}`)),
    transaction.get(db.doc(`companies/${companyId}/users/${uid}`))
  ]);
  if (company.data()?.status !== "Active" || assignment.data()?.companyId !== companyId || assignment.data()?.enabled !== true || membership.data()?.enabled !== true) throw new AccessError(403, "Company access changed before this operation could finish.");
}

export async function tenantCollection(companyId: string, resource: ResourceName) {
  const session = await requireTenant(companyId);
  if (session.demo) throw new AccessError(503, "Cloud storage is not enabled in the local workspace.");
  if (!["customers", "quotes", "drafts", "documents", "proposals"].includes(resource)) throw new AccessError(400, "Invalid resource.");
  return adminServices().db.collection("companies").doc(companyId).collection(resource);
}

async function companyForUi(id: string, data: FirebaseFirestore.DocumentData): Promise<Company & {updatedAt?: string}> {
  let logo = "";
  const path = data.branding?.logoStoragePath;
  if (typeof path === "string" && path.startsWith(`companies/${id}/branding/`)) {
    const file = adminServices().bucket.file(path);
    const [metadata] = await file.getMetadata();
    const maxBytes = 4 * 1024 * 1024;
    const size = Number(metadata.size);
    if (!Number.isSafeInteger(size) || size < 1 || size > maxBytes) throw new AccessError(413, "Stored logo exceeds the allowed size.");
    const [bytes] = await file.download({start: 0, end: maxBytes});
    if (bytes.length > maxBytes) throw new AccessError(413, "Stored logo exceeds the allowed size.");
    const filename = path.slice(`companies/${id}/branding/`.length);
    if (bytes.length !== size || !/^[a-f0-9]{64}\.png$/.test(filename) || digest(bytes) !== filename.slice(0, -4)) throw new AccessError(409, "The stored logo contents could not be verified.");
    const preview = await sharp(bytes, {limitInputPixels: 16000000}).resize({width: 256, height: 256, fit: "inside", withoutEnlargement: true}).png().toBuffer();
    logo = `data:image/png;base64,${preview.toString("base64")}`;
  }
  return { id, name: data.name, industry: data.industry || "", email: data.email || "", phone: data.phone || "", address: data.address || "", website: data.website || "", status: data.status, branding: {primary: data.branding.primary, secondary: data.branding.secondary, accent: data.branding.accent, font: data.branding.font, logo, ...(path ? {logoStoragePath: path} : {})}, fields: Array.isArray(data.fields) ? data.fields : [], createdAt: timestampString(data.createdAt) || "", updatedAt: timestampString(data.updatedAt), origin: "owner", ...(data.assignedEmail ? {assignedEmail: data.assignedEmail} : {}) };
}

export async function saveCompanyRecord(input: unknown, options: {updateFields?: boolean} = {}): Promise<Company> {
  const session = await requireOwner();
  if (session.demo) throw new AccessError(503, "Live company saving requires the independent Firebase project.");
  await enforceRateLimit(session.uid, "company-write", {limit: 30, windowMs: 60000});
  const company = parseCompany(input);
  const { db, bucket } = adminServices();
  const reference = db.collection("companies").doc(company.id);
  const previous = (await reference.get()).data();
  if (previous && company.updatedAt !== timestampString(previous.updatedAt)) throw new AccessError(409, "This company was updated elsewhere. Reload its latest settings before saving.");
  if ((company.assignedEmail || "") !== (previous?.assignedEmail || "")) throw new AccessError(409, "Assigned email changes require the secure invitation and reassignment service.");
  const branding: Record<string, string> = {primary: company.branding.primary, secondary: company.branding.secondary, accent: company.branding.accent, font: company.branding.font, logo: "", logoStoragePath: "", logoPreviewHash: ""};
  if (company.branding.logo) {
    const bytes = Buffer.from(company.branding.logo.split(",")[1] || "", "base64");
    if (!bytes.length || bytes.length > 4 * 1024 * 1024) throw new AccessError(413, "Choose a logo smaller than 4 MB.");
    if (previous?.branding?.logoStoragePath && digest(bytes) === previous.branding.logoPreviewHash) {
      branding.logoStoragePath = previous.branding.logoStoragePath;
      branding.logoPreviewHash = previous.branding.logoPreviewHash;
    } else {
      let normalized: Buffer;
      try { normalized = await sharp(bytes, {limitInputPixels: 16000000}).resize({width: 512, height: 512, fit: "inside", withoutEnlargement: true}).png().toBuffer(); }
      catch { throw new AccessError(400, "The logo image could not be decoded."); }
      const hash = digest(normalized);
      const path = `companies/${company.id}/branding/${hash}.png`;
      const preview = await sharp(normalized).resize({width: 256, height: 256, fit: "inside", withoutEnlargement: true}).png().toBuffer();
      await bucket.file(path).save(normalized, {resumable: false, metadata: {contentType: "image/png", cacheControl: "private, no-store", metadata: {companyId: company.id, uploadedBy: session.uid, sha256: hash}}});
      branding.logoStoragePath = path;
      branding.logoPreviewHash = digest(preview);
    }
  }
  const now = new Date().toISOString();
  await db.runTransaction(async transaction => {
    const ownerAnchor = await transaction.get(db.doc("platform/config"));
    if (ownerAnchor.data()?.ownerUid !== session.uid) throw new AccessError(403, "Platform owner access changed before saving.");
    const existing = await transaction.get(reference);
    const original = existing.data();
    if (original && company.updatedAt !== timestampString(original.updatedAt)) throw new AccessError(409, "This company changed while saving. Reload its latest settings and try again.");
    if ((original?.assignedEmail || "") !== (company.assignedEmail || "")) throw new AccessError(409, "Access changed while editing. Reload the company before saving.");
    transaction.set(reference, {id: company.id, name: company.name, industry: company.industry, email: company.email, phone: company.phone, address: company.address, website: company.website, branding,
      fields: original && !options.updateFields ? original.fields || [] : company.fields, status: original?.status || "Draft", origin: "owner", createdBy: original?.createdBy || session.uid, createdAt: original?.createdAt || now, updatedAt: now}, {merge: true});
  });
  return companyForUi(company.id, (await reference.get()).data()!);
}

export async function readOwnerWorkspace(cursor?: string): Promise<Workspace & {nextCursor: string | null}> {
  const session = await requireOwner();
  if (session.demo) throw new AccessError(503, "The local workspace does not read live Firebase records.");
  const { db } = adminServices();
  let query = db.collection("companies").orderBy(FieldPath.documentId()).limit(26);
  if (cursor) query = query.startAfter(recordId(cursor));
  const result = await query.get();
  const page = result.docs.slice(0, 25);
  const companies = await Promise.all(page.map(document => companyForUi(document.id, document.data())));
  const invitations = (await Promise.all(page.map(async company => {
    const rows = await db.collection("companies").doc(company.id).collection("invitations").orderBy("createdAt", "desc").limit(100).get();
    return rows.docs.map(document => {const data = document.data(); return {id: document.id, companyId: company.id, email: String(data.email), status: data.status, createdAt: String(data.createdAt)};});
  }))).flat().filter(invitation => ["Prepared", "Sent", "Active", "Suspended"].includes(invitation.status));
  return {...createEmptyWorkspace(), companies, invitations, selectedCompanyId: companies[0]?.id || "", nextCursor: result.docs.length > 25 ? page[page.length - 1].id : null};
}

async function quoteForUi(companyId: string, input: FirebaseFirestore.DocumentData, hydrateSource = true): Promise<Quote> {
  const record = {...input};
  if (record.companyId !== companyId || record.customer?.companyId !== companyId) throw new AccessError(403, "Stored draft does not belong to this company.");
  if (hydrateSource && record.sourceStoragePath && (typeof record.sourceStoragePath !== "string" || !record.sourceStoragePath.startsWith(`companies/${companyId}/draft-sources/`))) throw new AccessError(403, "Stored source information does not belong to this company.");
  if (hydrateSource && typeof record.sourceStoragePath === "string" && record.sourceStoragePath.startsWith(`companies/${companyId}/draft-sources/`)) {
    const file = adminServices().bucket.file(record.sourceStoragePath);
    const [metadata] = await file.getMetadata();
    const size = Number(metadata.size);
    if (!Number.isSafeInteger(size) || size < 0 || size > 4 * 1024 * 1024) throw new AccessError(413, "Stored quote sources exceed the 4 MB limit.");
    const [bytes] = await file.download();
    if (bytes.length > 4 * 1024 * 1024) throw new AccessError(413, "Stored quote sources exceed the 4 MB limit.");
    record.sourceInput = JSON.parse(bytes.toString("utf8"));
  }
  if (!hydrateSource) delete record.sourceInput;
  const publicFields = ["id", "companyId", "title", "customer", "lineItems", "markupType", "markupValue", "privateAdjustment", "taxRate", "customValues", "notes", "updatedAt", "reviewed", "sourceInput"];
  const result = Object.fromEntries(publicFields.filter(key => record[key] !== undefined).map(key => [key, record[key]]));
  if (!hydrateSource) result.sourceLoaded = false;
  return result as Quote;
}
function basicResource(companyId: string, document: FirebaseFirestore.DocumentSnapshot) {
  const data = document.data()!;
  if (data.companyId !== companyId) throw new AccessError(403, "Stored record does not belong to this company.");
  return data;
}
async function resourcePage(companyId: string, resource: ResourceName, cursor?: string) {
  const collection = await tenantCollection(companyId, resource);
  let query = collection.orderBy(FieldPath.documentId()).limit(26);
  if (cursor) query = query.startAfter(recordId(cursor));
  const snapshots = await query.get();
  const page = snapshots.docs.slice(0, 25);
  const records = [];
  let bytes = 0;
  for (const document of page) {
    const data = basicResource(companyId, document);
    const record = ["drafts", "quotes", "proposals"].includes(resource) ? await quoteForUi(companyId, data, false) :
      resource === "customers" ? {id: document.id, companyId, name: data.name, email: data.email || "", phone: data.phone || "", address: data.address || "", ...(data.projectDetails ? {projectDetails: data.projectDetails} : {})} :
      {id: document.id, companyId, name: data.name, size: data.size, mimeType: data.mimeType, storagePath: data.storagePath, sha256: data.sha256, createdAt: data.createdAt, updatedAt: data.updatedAt};
    bytes += jsonSize(record);
    if (bytes > 8 * 1024 * 1024) throw new AccessError(413, "This record page exceeds the 8 MB response limit. Open an individual record instead.");
    records.push(record);
  }
  return {records, nextCursor: snapshots.docs.length > 25 ? page[page.length - 1].id : null};
}
export async function readTenantRecord(companyId: string, resource: ResourceName, id: string) {
  const collection = await tenantCollection(companyId, resource);
  const snapshot = await collection.doc(recordId(id)).get();
  if (!snapshot.exists) throw new AccessError(404, "Record not found.");
  const data = basicResource(companyId, snapshot);
  if (["drafts", "quotes", "proposals"].includes(resource)) return quoteForUi(companyId, data);
  if (resource === "customers") return {id: snapshot.id, companyId, name: data.name, email: data.email || "", phone: data.phone || "", address: data.address || "", ...(data.projectDetails ? {projectDetails: data.projectDetails} : {})};
  return {id: snapshot.id, companyId, name: data.name, size: data.size, mimeType: data.mimeType, storagePath: data.storagePath, sha256: data.sha256};
}
export async function readTenantWorkspace(companyId: string) {
  const session = await requireTenant(companyId);
  if (session.demo) throw new AccessError(503, "The local workspace does not read live Firebase records.");
  const company = await adminServices().db.collection("companies").doc(companyId).get();
  if (!company.exists) throw new AccessError(404, "Company not found.");
  const [drafts, customers] = await Promise.all([resourcePage(companyId, "drafts"), resourcePage(companyId, "customers")]);
  if (jsonSize(drafts.records) + jsonSize(customers.records) > 8 * 1024 * 1024) throw new AccessError(413, "The company workspace exceeds the 8 MB response limit.");
  return {company: await companyForUi(companyId, company.data()!), drafts: drafts.records, customers: customers.records, cursors: {drafts: drafts.nextCursor, customers: customers.nextCursor}};
}
export async function readTenantCompany(companyId: string): Promise<Company> {
  const session = await requireTenant(companyId);
  if (session.demo) throw new AccessError(503, "The local workspace does not read live Firebase company branding.");
  const snapshot = await adminServices().db.collection("companies").doc(companyId).get();
  if (!snapshot.exists) throw new AccessError(404, "Company not found.");
  return companyForUi(companyId, snapshot.data()!);
}
export async function listTenantResource(companyId: string, resource: ResourceName, cursor?: string) {return resourcePage(companyId, resource, cursor);}

export async function saveTenantResource(companyId: string, resource: ResourceName, input: unknown) {
  const session = await requireTenant(companyId);
  if (session.demo) throw new AccessError(503, "Cloud saving is not enabled in the local workspace.");
  if (resource === "documents") throw new AccessError(405, "Use the authenticated document upload endpoint.");
  await enforceRateLimit(session.uid, "quote-write", {limit: 60, windowMs: 60000});
  const value = resource === "customers" ? parseCustomer(input, companyId) : parseQuote(input, companyId);
  const {db, bucket} = adminServices();
  const collection = db.collection("companies").doc(companyId).collection(resource);
  const reference = collection.doc(value.id);
  let sourceStoragePath: string | undefined;
  if (resource !== "customers") {
    const quote = value as Quote;
    if (quote.sourceInput) {
      for (let index = 0; index < quote.sourceInput.documents.length; index++) {
        const document = quote.sourceInput.documents[index];
        const path = (document as {storagePath?: string}).storagePath;
        if (!path) throw new AccessError(400, "Upload each original source file before saving the draft to the cloud.");
        if (document.status === "pending" || document.status === "processing") throw new AccessError(400, "Wait for every source document to finish processing before saving.");
        const stored = await db.collection("companies").doc(companyId).collection("documents").doc(recordId(document.id)).get();
        const metadata = stored.data();
        if (!metadata || metadata.companyId !== companyId || metadata.storagePath !== path || !path.startsWith(`companies/${companyId}/documents/${document.id}/`)) throw new AccessError(400, "A source document reference is invalid or belongs to another company.");
        quote.sourceInput.documents[index] = {...document, name: metadata.name, size: metadata.size, mimeType: metadata.mimeType, storagePath: metadata.storagePath, sha256: metadata.sha256};
      }
      const bytes = Buffer.from(JSON.stringify(quote.sourceInput), "utf8");
      if (bytes.length > 4 * 1024 * 1024) throw new AccessError(413, "Quote source text exceeds the 4 MB limit. Split the source documents into separate drafts.");
      sourceStoragePath = `companies/${companyId}/draft-sources/${value.id}/${digest(bytes)}.json`;
      await bucket.file(sourceStoragePath).save(bytes, {resumable: false, metadata: {contentType: "application/json", cacheControl: "private, no-store", metadata: {companyId, uploadedBy: session.uid}}});
    }
  }
  const now = new Date().toISOString();
  const databaseValue = {...value} as Record<string, unknown>;
  if (sourceStoragePath) {delete databaseValue.sourceInput; databaseValue.sourceStoragePath = sourceStoragePath;}
  if (jsonSize(databaseValue) > 750000) throw new AccessError(413, "This record is too large. Split it into smaller drafts.");
  await db.runTransaction(async transaction => {
    await assertTenantTransaction(transaction, companyId, session.uid);
    const existing = await transaction.get(reference);
    const original = existing.data();
    if (original && original.companyId !== companyId) throw new AccessError(403, "Stored record does not belong to this company.");
    let customerSnapshot: FirebaseFirestore.DocumentSnapshot | undefined;
    let customerReference: FirebaseFirestore.DocumentReference | undefined;
    if (resource !== "customers") {
      const quote = value as Quote;
      customerReference = db.collection("companies").doc(companyId).collection("customers").doc(quote.customer.id);
      customerSnapshot = await transaction.get(customerReference);
      if (customerSnapshot.exists && customerSnapshot.data()?.companyId !== companyId) throw new AccessError(403, "Stored customer does not belong to this company.");
    }
    transaction.set(reference, {...databaseValue, companyId, createdBy: original?.createdBy || session.uid, createdAt: original?.createdAt || now, updatedAt: now}, {merge: true});
    if (customerReference) transaction.set(customerReference, {...(value as Quote).customer, companyId, createdBy: customerSnapshot?.data()?.createdBy || session.uid, createdAt: customerSnapshot?.data()?.createdAt || now, updatedAt: now}, {merge: true});
  });
  return resource === "customers" ? {...value} : quoteForUi(companyId, (await reference.get()).data()!);
}

export async function deleteTenantResource(companyId: string, resource: ResourceName, id: string) {
  const session = await requireTenant(companyId);
  if (session.demo) throw new AccessError(503, "Cloud deletion is not enabled in the local workspace.");
  await enforceRateLimit(session.uid, "quote-write", {limit: 60, windowMs: 60000});
  const {db, bucket} = adminServices();
  const reference = db.collection("companies").doc(companyId).collection(resource).doc(recordId(id));
  const snapshot = await reference.get();
  if (!snapshot.exists) return;
  if (snapshot.data()?.companyId !== companyId) throw new AccessError(403, "This record does not belong to the company.");
  let fileToDelete: string | undefined;
  if (resource === "documents") {
    const path = snapshot.data()?.storagePath;
    if (typeof path !== "string" || !path.startsWith(`companies/${companyId}/documents/${id}/`)) throw new AccessError(400, "Invalid document path.");
    fileToDelete = path;
  }
  await db.runTransaction(async transaction => {
    await assertTenantTransaction(transaction, companyId, session.uid);
    const current = await transaction.get(reference);
    if (current.exists && current.data()?.companyId !== companyId) throw new AccessError(403, "Stored record does not belong to this company.");
    if (current.exists && snapshot.updateTime && !current.updateTime?.isEqual(snapshot.updateTime)) throw new AccessError(409, "This record changed before deletion. Reload it before trying again.");
    transaction.delete(reference);
  });
  if (fileToDelete) await bucket.file(fileToDelete).delete({ignoreNotFound: true});
}
