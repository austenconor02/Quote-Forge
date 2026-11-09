import { z } from "zod";

export const identifierSchema = z.string().regex(/^[a-zA-Z0-9-]{1,100}$/);
const text = (max: number) => z.string().max(max);
const email = text(254).refine(value => value === "" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value), "Enter a valid email.");
const customField = z.object({id: identifierSchema, label: text(100), type: z.enum(["Text", "Number", "Currency", "Date", "Dropdown", "Checkbox", "Multiline text"]), required: z.boolean(), defaultValue: text(2000), options: z.array(text(250)).max(100)}).strict();
export const companyInputSchema = z.object({
  id: identifierSchema, name: z.string().trim().min(1).max(100), industry: text(100), email, phone: text(50), address: text(1000),
  website: text(1000).refine(value => !value || /^https?:\/\//i.test(value), "Website must use HTTP or HTTPS."), status: z.enum(["Draft", "Active", "Suspended"]),
  branding: z.object({primary: z.string().regex(/^#[0-9a-f]{6}$/i), secondary: z.string().regex(/^#[0-9a-f]{6}$/i), accent: z.string().regex(/^#[0-9a-f]{6}$/i), font: z.enum(["Arial", "Georgia", "Trebuchet MS", "Verdana"]), logo: text(5600000).refine(value => !value || /^data:image\/(png|jpeg|webp);base64,/.test(value)), logoStoragePath: text(500).optional()}).strict(),
  fields: z.array(customField).max(100), createdAt: text(50), origin: z.enum(["owner", "demo"]).optional(), assignedEmail: email.optional(), updatedAt: text(50).optional()
}).strict();
export const customerInputSchema = z.object({id: identifierSchema, companyId: identifierSchema, name: z.string().trim().min(1).max(200), email: text(254), phone: text(50), address: text(2000), projectDetails: text(20000).optional()}).strict();
const sourceDocument = z.object({
  id: identifierSchema, name: text(255), size: z.number().finite().nonnegative().max(20971520), mimeType: text(150),
  status: z.enum(["pending", "processing", "ready", "error"]), error: text(2000).optional(), progress: z.number().min(0).max(1).optional(), progressLabel: text(300).optional(),
  extractedText: text(200000).optional(), pageCount: z.number().int().min(1).max(30).optional(), storagePath: text(500).optional(), textStoragePath: text(500).optional(), sha256: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
  extractionMethod: z.enum(["embedded", "ocr", "mixed"]).optional(), localFileAvailable: z.boolean().optional()
}).strict();
const lineItem = z.object({id: identifierSchema, description: text(10000), section: text(200), quantity: z.number().finite().min(0).max(1000000), unit: text(30), unitPrice: z.number().finite().min(0).max(1000000), hiddenFromProposal: z.boolean(), needsReview: z.boolean(), sourceType: text(100).optional(), confidence: text(30).optional(), sourceDocumentName: text(255).optional(), sourceReason: text(5000).optional()}).strict();
export const quoteInputSchema = z.object({
  id: identifierSchema, companyId: identifierSchema, title: text(250), customer: customerInputSchema, lineItems: z.array(lineItem).max(1000),
  markupType: z.enum(["none", "percent", "fixed"]), markupValue: z.number().finite().min(0).max(1000000), privateAdjustment: z.number().finite().min(-1000000000).max(1000000000), taxRate: z.number().finite().min(0).max(100),
  customValues: z.record(identifierSchema, z.union([text(20000), z.boolean()])), notes: text(100000), updatedAt: text(50), reviewed: z.boolean(),
  sourceInput: z.object({pastedText: text(1000000), specialInstructions: text(20000), documents: z.array(sourceDocument).max(30)}).strict().optional()
}).strict();
export const resourceNames = ["customers", "drafts", "quotes", "proposals", "documents"] as const;
export type ResourceName = typeof resourceNames[number];
export function validTenantRecord(companyId: string, record: {companyId: string; customer?: {companyId: string}}) {
  return record.companyId === companyId && (!record.customer || record.customer.companyId === companyId);
}
export function privateDocumentPath(companyId: string, documentId: string, hash: string) {
  identifierSchema.parse(companyId); identifierSchema.parse(documentId);
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error("Invalid content hash.");
  return `companies/${companyId}/documents/${documentId}/${hash}`;
}
export function sniffDocumentType(bytes: Uint8Array): string | null {
  if (bytes.length < 8) return null;
  const ascii = (start: number, length: number) => String.fromCharCode(...bytes.slice(start, start + length));
  if (ascii(0, 5) === "%PDF-") return "application/pdf";
  if ([137,80,78,71,13,10,26,10].every((value, index) => bytes[index] === value)) return "image/png";
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "image/jpeg";
  if (ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") return "image/webp";
  if (ascii(4, 4) === "ftyp") {
    const brands = ascii(8, Math.min(56, bytes.length - 8));
    if (/heic|heix|hevc|hevx/.test(brands)) return "image/heic";
    if (/mif1|msf1/.test(brands)) return "image/heif";
  }
  return null;
}
