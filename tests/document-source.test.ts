import test from "node:test";
import assert from "node:assert/strict";
import { combineQuoteSources, documentInputError, documentType, hasUnresolvedDocuments, sourceRequiresReview, MAX_DOCUMENT_BYTES } from "../src/lib/documents/source";
import type { QuoteSourceInput } from "../src/lib/models";
const input: QuoteSourceInput = { pastedText: "Additional scope from email", specialInstructions: "Private instruction", documents: [
  {id: "ready-a", name: "Estimate A.pdf", size: 120, mimeType: "application/pdf", status: "ready", extractedText: "Install siding 12 SQ at $200.00"},
  {id: "ready-b", name: "Photograph.png", size: 120, mimeType: "image/png", status: "ready", extractedText: "Cleanup 1 EA at $350.00"},
  {id: "failed", name: "Bad.pdf", size: 3, mimeType: "application/pdf", status: "error", error: "Never include this error as quote text"}
] };
test("combined quote sources preserve document names, ordering and pasted text without errors or internal rules", () => {
  const combined = combineQuoteSources(input);
  assert.match(combined, /Source document: Estimate A\.pdf/); assert.match(combined, /Source document: Photograph\.png/);
  assert.ok(combined.indexOf("Estimate A.pdf") < combined.indexOf("Photograph.png")); assert.match(combined, /Additional scope from email/);
  assert.ok(!combined.includes("Never include this error")); assert.ok(!combined.includes("Private instruction"));
  assert.equal(hasUnresolvedDocuments(input), true);
});
test("removing a document removes exactly its extracted source and retains pasted text", () => {
  const removed = {...input, documents: input.documents.filter(document => document.id !== "ready-a" && document.id !== "failed")};
  const combined = combineQuoteSources(removed); assert.ok(!combined.includes("Estimate A.pdf")); assert.ok(!combined.includes("Install siding")); assert.ok(combined.includes("Cleanup")); assert.ok(combined.includes("Additional scope"));
  assert.equal(hasUnresolvedDocuments(removed), false);
});
test("empty, unsupported and oversized inputs fail explicitly", () => {
  assert.equal(documentType("iPhone.HEIF"), "heic"); assert.equal(documentType("estimate.PDF"), "pdf"); assert.equal(documentType("photo.JPEG"), "image");
  assert.match(documentInputError("payload.exe", 500)!, /Unsupported/); assert.match(documentInputError("empty.pdf", 0)!, /empty/); assert.match(documentInputError("large.pdf", MAX_DOCUMENT_BYTES + 1)!, /20 MB/);
  assert.equal(documentInputError("estimate.pdf", 100), null); assert.equal(combineQuoteSources(), ""); assert.equal(hasUnresolvedDocuments(), false);
});
test("processing and queued sources prevent generation rather than being silently omitted", () => {
  for (const status of ["pending", "processing"] as const) {
    const source = {...input, documents: [{...input.documents[0], status}]};
    assert.equal(hasUnresolvedDocuments(source), true); assert.ok(!combineQuoteSources(source).includes("Install siding"));
  }
});

test("reopening a reviewed source with an empty browser cache preserves review; changed extracted content requires review", () => {
  const reopened = structuredClone(input);
  reopened.documents[0] = {...reopened.documents[0], localFileAvailable: false, progress: 1, progressLabel: "Available in private storage", storagePath: "companies/test/documents/ready-a/hash"};
  assert.equal(sourceRequiresReview(input, reopened), false);
  reopened.documents[0].extractedText = "Install siding 15 SQ at $225.00";
  assert.equal(sourceRequiresReview(input, reopened), true);
  assert.equal(sourceRequiresReview(input, {...input, pastedText: "A changed scope"}), true);
});
