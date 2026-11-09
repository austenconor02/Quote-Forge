import { createHash } from "node:crypto";
import { AccessError, apiError, assertSameOrigin, requireTenant } from "@/lib/server/auth";
import { adminServices } from "@/lib/server/firebase";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { boundedBytes } from "@/lib/server/request-body";
import { identifierSchema, privateDocumentPath, sniffDocumentType } from "@/lib/server-input";
import { assertTenantTransaction } from "@/lib/server/tenant-repository";
type Context = {params: Promise<{companyId: string; documentId: string}>};
async function access(context: Context) {
  const {companyId, documentId} = await context.params;
  if (!identifierSchema.safeParse(documentId).success) throw new AccessError(400, "Invalid document identity.");
  const session = await requireTenant(companyId);
  if (session.demo) throw new AccessError(503, "Private cloud document storage is not enabled in the local workspace.");
  return {companyId, documentId, uid: session.uid};
}
export async function POST(request: Request, context: Context) {
  try {
    await assertSameOrigin(request);
    const {companyId, documentId, uid} = await access(context);
    await enforceRateLimit(uid, "document-upload", {limit: 30, windowMs: 60000});
    const bytes = await boundedBytes(request, 20 * 1024 * 1024);
    const mimeType = sniffDocumentType(bytes);
    if (!mimeType) throw new AccessError(415, "This file is not a supported PDF, PNG, JPG, WebP, HEIC, or HEIF document.");
    const declaredType = (request.headers.get("content-type") || "").split(";")[0].toLowerCase();
    if (declaredType && declaredType !== "application/octet-stream" && declaredType !== mimeType && !(["image/heic", "image/heif"].includes(declaredType) && ["image/heic", "image/heif"].includes(mimeType))) throw new AccessError(415, "The document contents do not match its declared type.");
    let name: string;
    try {name = decodeURIComponent(request.headers.get("x-file-name") || "Document");} catch {throw new AccessError(400, "Invalid file name.");}
    if (!name || name.length > 255 || /[\x00-\x1f\x7f]/.test(name)) throw new AccessError(400, "Invalid file name.");
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    await requireTenant(companyId);
    const storagePath = privateDocumentPath(companyId, documentId, sha256);
    const {db, bucket} = adminServices();
    const reference = db.collection("companies").doc(companyId).collection("documents").doc(documentId);
    const previous = await reference.get();
    if (previous.exists && previous.data()?.companyId !== companyId) throw new AccessError(403, "Stored document does not belong to this company.");
    if (previous.exists && previous.data()?.sha256 !== sha256) throw new AccessError(409, "This document identity already contains another file. Add it with a new identity.");
    await bucket.file(storagePath).save(bytes, {resumable: false, metadata: {contentType: mimeType, cacheControl: "private, no-store", metadata: {companyId, uploadedBy: uid, sha256}}});
    const now = new Date().toISOString();
    const document = {id: documentId, companyId, name, size: bytes.length, mimeType, storagePath, sha256};
    await db.runTransaction(async transaction => {
      await assertTenantTransaction(transaction, companyId, uid);
      const existing = await transaction.get(reference);
      if (existing.exists && existing.data()?.sha256 !== sha256) throw new AccessError(409, "Document identity conflict. Add this file with a new identity.");
      transaction.set(reference, {...document, createdBy: existing.data()?.createdBy || uid, createdAt: existing.data()?.createdAt || now, updatedAt: now});
    });
    return Response.json({document}, {headers: {"Cache-Control": "private, no-store"}});
  } catch (error) {return apiError(error);}
}
export async function GET(_: Request, context: Context) {
  try {
    const {companyId, documentId, uid} = await access(context);
    await enforceRateLimit(uid, "document-download", {limit: 60, windowMs: 60000});
    const {db, bucket} = adminServices();
    const snapshot = await db.collection("companies").doc(companyId).collection("documents").doc(documentId).get();
    const document = snapshot.data();
    if (!document || document.companyId !== companyId || typeof document.sha256 !== "string" || document.storagePath !== privateDocumentPath(companyId, documentId, document.sha256)) throw new AccessError(404, "Document not found.");
    const maxBytes = 20 * 1024 * 1024;
    const file = bucket.file(document.storagePath);
    const [metadata] = await file.getMetadata();
    const storedSize = Number(metadata.size);
    if (storedSize > maxBytes || document.size > maxBytes) throw new AccessError(413, "Stored document exceeds the size limit.");
    if (!Number.isSafeInteger(storedSize) || storedSize < 1 || !Number.isSafeInteger(document.size) || document.size !== storedSize) throw new AccessError(409, "The stored document size could not be verified.");
    // The inclusive range permits at most one extra byte if storage changes after preflight.
    const [bytes] = await file.download({start: 0, end: maxBytes});
    if (bytes.length > maxBytes) throw new AccessError(413, "Stored document exceeds the size limit.");
    if (bytes.length !== storedSize || createHash("sha256").update(bytes).digest("hex") !== document.sha256) throw new AccessError(409, "The stored document contents could not be verified.");
    await requireTenant(companyId);
    return new Response(new Uint8Array(bytes), {headers: {"Content-Type": document.mimeType, "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(document.name)}`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox"}});
  } catch (error) {return apiError(error);}
}
