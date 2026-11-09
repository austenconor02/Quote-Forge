import "server-only";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { PDFDocument } from "pdf-lib";
import { z } from "zod";
import { identifierSchema, privateDocumentPath, sniffDocumentType } from "../server-input";
import { AccessError } from "./access-error";
import type { adminServices } from "./firebase";
import type { assertTenantTransaction } from "./tenant-repository";
import type { enforceRateLimit } from "./rate-limit";
import type { aiConfigured, requestAiDraft, ModelSource } from "./openai-quote";

export const generationInputSchema = z.object({companyId: identifierSchema, requestId: z.string().uuid(), documentIds: z.array(identifierSchema.refine(value => value !== "pasted-text")).max(10), pastedText: z.string().max(100000), specialInstructions: z.string().max(12000)}).strict().refine(value => value.documentIds.length > 0 || value.pastedText.trim().length > 0, "Add a source document or pasted scope first.").refine(value => new Set(value.documentIds).size === value.documentIds.length, "Document identities must be unique.");
type Input = z.infer<typeof generationInputSchema>;
type Dependencies = {authorize: (companyId: string) => Promise<{demo: boolean; uid: string}>; services: typeof adminServices; rateLimit: typeof enforceRateLimit; configured: typeof aiConfigured; model: typeof requestAiDraft; assertAccess: typeof assertTenantTransaction};
const hash = (input: Buffer | string) => createHash("sha256").update(input).digest("hex");

export function createAiGeneration(deps: Dependencies) {
  async function access(companyId: string) {
    const actor = await deps.authorize(companyId);
    if (actor.demo) throw new AccessError(503, "AI generation requires a signed-in company workspace. No source was sent.");
    if (!deps.configured()) throw new AccessError(503, "OpenAI is not configured. No source was sent; your entered work is preserved.");
    return actor;
  }
  async function generate(value: unknown) {
    const parsed = generationInputSchema.safeParse(value);
    if (!parsed.success) throw new AccessError(400, "Add valid source documents or pasted scope before generating (up to 10 files and 100,000 text characters).");
    const input: Input = parsed.data, actor = await access(input.companyId);
    const {db, bucket} = deps.services();
    const company = db.doc(`companies/${input.companyId}`), job = company.collection("aiJobs").doc(input.requestId);
    const fingerprint = hash(JSON.stringify(input));
    const previous = await job.get();
    if (previous.exists) {
      const data = previous.data()!;
      if (data.uid !== actor.uid || data.fingerprint !== fingerprint) throw new AccessError(409, "This generation identity belongs to another request. Start a new generation.");
      if (data.status === "completed") {await deps.authorize(input.companyId); return data.result;}
      throw new AccessError(409, "This generation was already submitted. Retrieve its status before starting another paid request.");
    }
    await deps.rateLimit(actor.uid, "ai-generation", {limit: 5, windowMs: 3600000});
    await deps.rateLimit(`company-${input.companyId}`, "ai-generation", {limit: 20, windowMs: 86400000});
    const sources: ModelSource[] = [], fingerprints = new Set<string>();
    let totalBytes = 0, totalPages = 0, modelBytesTotal = 0;
    // Check all references before reading any file or sending anything to the model.
    const records = await Promise.all(input.documentIds.map(id => company.collection("documents").doc(id).get()));
    for (const record of records) {
      const data = record.data();
      if (!data || data.companyId !== input.companyId || data.id !== record.id || typeof data.sha256 !== "string" || data.storagePath !== privateDocumentPath(input.companyId, record.id, data.sha256)) throw new AccessError(403, "A source document is unavailable or belongs to another company.");
    }
    for (const record of records) {
      const data = record.data()!, file = bucket.file(data.storagePath);
      const [metadata] = await file.getMetadata(), size = Number(metadata.size);
      if (!Number.isSafeInteger(size) || size < 1 || size !== data.size || size > 20 * 1024 * 1024 || totalBytes + size > 20 * 1024 * 1024) throw new AccessError(413, "Limit each AI draft to 20 MB of original documents. Split this work into smaller drafts.");
      const [bytes] = await file.download({start: 0, end: size});
      if (bytes.length !== size || hash(bytes) !== data.sha256) throw new AccessError(409, "A source document changed or failed its integrity check.");
      const mime = sniffDocumentType(bytes);
      if (!mime || mime !== data.mimeType) throw new AccessError(415, "A source document's format could not be verified.");
      totalBytes += size;
      if (fingerprints.has(data.sha256)) continue;
      fingerprints.add(data.sha256);
      let pages = 1, modelBytes = bytes, mimeType = mime;
      if (mime === "application/pdf") {
        try {pages = (await PDFDocument.load(bytes, {updateMetadata: false})).getPageCount();}
        catch {throw new AccessError(400, "A PDF is encrypted or unreadable. Add an unlocked PDF before generating.");}
        if (pages < 1 || pages > 30) throw new AccessError(413, "Each PDF must have 1–30 pages.");
      } else {
        try {modelBytes = await sharp(bytes, {limitInputPixels: 24000000}).rotate().resize({width: 2200, height: 2200, fit: "inside", withoutEnlargement: true}).png().toBuffer(); mimeType = "image/png";}
        catch {throw new AccessError(415, "An image could not be prepared for AI. Convert HEIC/HEIF to PNG or JPG and retry.");}
      }
      totalPages += pages;
      if (totalPages > 40) throw new AccessError(413, "Limit each AI draft to 40 total PDF pages/images.");
      modelBytesTotal += modelBytes.length;
      if (modelBytesTotal > 20 * 1024 * 1024) throw new AccessError(413, "Prepared image/PDF data exceeds the AI draft limit. Split these sources into smaller drafts.");
      sources.push({id: record.id, name: data.name, pages, mimeType, bytes: modelBytes});
    }
    if (input.pastedText.trim()) sources.push({id: "pasted-text", name: "Pasted scope / email", pages: 1, text: input.pastedText});
    const rulesRecord = await company.collection("aiConfig").doc("rules").get();
    const companyRules = typeof rulesRecord.data()?.instructions === "string" ? rulesRecord.data()!.instructions.slice(0,12000) : "";
    await db.runTransaction(async transaction => {
      await deps.assertAccess(transaction, input.companyId, actor.uid);
      const [current, companyRecord, lease] = await Promise.all([transaction.get(job), transaction.get(company), transaction.get(company.collection("aiJobs").doc("lease"))]);
      if (!companyRecord.exists) throw new AccessError(404, "Company not found.");
      if (current.exists) throw new AccessError(409, "This generation was already submitted. Retrieve its status before retrying.");
      if (Number(lease.data()?.until || 0) > Date.now()) throw new AccessError(409, "Another AI generation is in progress for this company.");
      transaction.set(job, {uid: actor.uid, fingerprint, status: "running", createdAt: Date.now(), expiresAt: new Date(Date.now() + 7 * 86400000)});
      transaction.set(company.collection("aiJobs").doc("lease"), {jobId: input.requestId, until: Date.now() + 240000});
    });
    try {
      // Recheck membership immediately before sending and again before returning any private result.
      await deps.authorize(input.companyId);
      const result = {...await deps.model(sources, input.specialInstructions, companyRules), jobId: input.requestId};
      if (records.length !== fingerprints.size) result.warnings.push("Identical copies of a source file were processed once.");
      if (Buffer.byteLength(JSON.stringify(result), "utf8") > 750000) throw new AccessError(413, "This generated draft exceeds the saved-result limit. Split the sources into smaller drafts.");
      await db.runTransaction(async transaction => {await deps.assertAccess(transaction, input.companyId, actor.uid); transaction.update(job, {status: "completed", result, completedAt: Date.now()});});
      await deps.authorize(input.companyId);
      return result;
    } catch (error) {
      await job.update({status: "failed", failedAt: Date.now()});
      if (error instanceof AccessError) throw error;
      // Provider responses/errors can contain source content. Never return or log them.
      throw new AccessError(502, "AI generation was not confirmed. Your sources and current quote are preserved. Check this request's status before starting a new paid generation.");
    } finally {
      await db.runTransaction(async transaction => {const ref = company.collection("aiJobs").doc("lease"); const lease = await transaction.get(ref); if (lease.data()?.jobId === input.requestId) transaction.delete(ref);});
    }
  }
  async function status(companyId: string, requestId: string) {
    if (!identifierSchema.safeParse(companyId).success || !z.string().uuid().safeParse(requestId).success) throw new AccessError(400, "Invalid generation identity.");
    const actor = await access(companyId), {db} = deps.services();
    await deps.rateLimit(actor.uid, "ai-status", {limit: 60, windowMs: 60000});
    const record = (await db.doc(`companies/${companyId}/aiJobs/${requestId}`).get()).data();
    if (!record || record.uid !== actor.uid) throw new AccessError(404, "Generation not found.");
    const state = record.status === "running" && Date.now() - Number(record.createdAt) > 240000 ? "uncertain" : record.status;
    return {status: state, ...(state === "completed" ? {result: record.result} : {})};
  }
  return {generate, status};
}
