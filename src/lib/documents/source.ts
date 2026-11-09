import type { QuoteSourceInput } from "../models";

export const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;
export const MAX_DOCUMENTS = 10;
export const MAX_DOCUMENT_PAGES = 30;
export const MAX_EXTRACTED_CHARACTERS = 200000;

export function documentType(name: string): "pdf" | "image" | "heic" | null {
  if (/\.pdf$/i.test(name)) return "pdf";
  if (/\.(heic|heif)$/i.test(name)) return "heic";
  return /\.(png|jpe?g|webp)$/i.test(name) ? "image" : null;
}

/** Only successfully extracted sources enter generation. Errors are never injected as quote text. */
export function combineQuoteSources(input?: QuoteSourceInput): string {
  if (!input) return "";
  const documents = input.documents.filter(document => document.status === "ready" && document.extractedText?.trim())
    .map(document => `--- Source document: ${document.name.replace(/[\r\n]/g, " ")} ---\n${document.extractedText!.trim()}\n--- End source document ---`);
  const pasted = input.pastedText.trim() ? `--- Pasted estimate / email / scope ---\n${input.pastedText.trim()}\n--- End pasted source ---` : "";
  return [...documents, pasted].filter(Boolean).join("\n\n");
}

export function hasUnresolvedDocuments(input?: QuoteSourceInput): boolean {
  return input?.documents.some(document => document.status !== "ready") ?? false;
}

/** Browser cache/progress metadata must not invalidate a previously reviewed proposal. */
export function sourceRequiresReview(previous: QuoteSourceInput | undefined, next: QuoteSourceInput): boolean {
  const content = (input?: QuoteSourceInput) => ({pastedText: input?.pastedText || "", specialInstructions: input?.specialInstructions || "", documents: (input?.documents || []).map(document => ({id: document.id, name: document.name, size: document.size, sha256: document.sha256, status: document.status, error: document.error || "", text: document.extractedText || ""}))});
  return JSON.stringify(content(previous)) !== JSON.stringify(content(next));
}

export function documentInputError(name: string, size: number): string | null {
  if (!documentType(name)) return "Unsupported file. Choose a PDF, PNG, JPG, WebP, HEIC, or HEIF.";
  if (size <= 0) return "This file is empty. Choose a document with content.";
  if (size > MAX_DOCUMENT_BYTES) return "This file exceeds the 20 MB limit.";
  return null;
}
