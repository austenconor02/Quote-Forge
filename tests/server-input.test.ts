import test from "node:test";
import assert from "node:assert/strict";
import { companyInputSchema, customerInputSchema, quoteInputSchema, privateDocumentPath, sniffDocumentType, validTenantRecord } from "../src/lib/server-input";
import { demoCompanies } from "../src/lib/demo";
import { sampleQuote } from "../src/lib/quote";

test("backend company input forbids injected privilege fields and remote image URLs", () => {
  const company = structuredClone(demoCompanies[0]);
  assert.equal(companyInputSchema.safeParse(company).success, true);
  assert.equal(companyInputSchema.safeParse({...company, platformOwner: true}).success, false);
  assert.equal(companyInputSchema.safeParse({...company, branding: {...company.branding, logo: "https://example.com/logo.png"}}).success, false);
  assert.equal(companyInputSchema.safeParse({...company, branding: {...company.branding, primary: "red; background:url(https://example.com)"}}).success, false);
});
test("server record validation rejects cross-tenant nested customers, privileged writes, and nonfinite prices", () => {
  const quote = sampleQuote(demoCompanies[0]);
  assert.equal(quoteInputSchema.safeParse(quote).success, true);
  assert.equal(validTenantRecord(quote.companyId, quote), true);
  assert.equal(validTenantRecord("different-company", quote), false);
  assert.equal(validTenantRecord(quote.companyId, {...quote, customer: {...quote.customer, companyId: "different-company"}}), false);
  assert.equal(quoteInputSchema.safeParse({...quote, createdBy: "another-user"}).success, false);
  assert.equal(quoteInputSchema.safeParse({...quote, lineItems: [{...quote.lineItems[0], unitPrice: Infinity}]}).success, false);
  assert.equal(quoteInputSchema.safeParse({...quote, lineItems: [{...quote.lineItems[0], quantity: -1}]}).success, false);
  assert.equal(customerInputSchema.safeParse({...quote.customer, enabled: true}).success, false);
});
test("document paths cannot escape their tenant and identities cannot contain traversal", () => {
  const hash = "a".repeat(64);
  assert.equal(privateDocumentPath("company-a", "document-a", hash), `companies/company-a/documents/document-a/${hash}`);
  assert.throws(() => privateDocumentPath("../company-b", "doc", hash));
  assert.throws(() => privateDocumentPath("company-a", "../doc", hash));
  assert.throws(() => privateDocumentPath("company-a", "doc", "not-a-hash"));
});
test("document type detection checks file bytes rather than declared filename or MIME", () => {
  assert.equal(sniffDocumentType(new TextEncoder().encode("%PDF-1.7\nexample")), "application/pdf");
  assert.equal(sniffDocumentType(new Uint8Array([137,80,78,71,13,10,26,10])), "image/png");
  assert.equal(sniffDocumentType(new Uint8Array([255,216,255,224,0,16,74,70,73,70])), "image/jpeg");
  assert.equal(sniffDocumentType(new TextEncoder().encode("RIFF1234WEBPcontent")), "image/webp");
  assert.equal(sniffDocumentType(new TextEncoder().encode("abcdefghnotapdf")), null);
  assert.equal(sniffDocumentType(new TextEncoder().encode("MZ executable renamed.pdf")), null);
});
test("real processed source metadata is accepted without accepting unexpected executable properties", () => {
  const quote = sampleQuote(demoCompanies[0]);
  const document = {id: "document-a", name: "source.pdf", size: 100, mimeType: "application/pdf", status: "ready", progress: 1, progressLabel: "Complete", extractedText: "--- Page 1 ---\nOriginal source", extractionMethod: "embedded", pageCount: 1, sha256: "a".repeat(64), localFileAvailable: true};
  assert.equal(quoteInputSchema.safeParse({...quote, sourceInput: {pastedText: "", specialInstructions: "Keep original prices", documents: [document]}}).success, true);
  assert.equal(quoteInputSchema.safeParse({...quote, sourceInput: {pastedText: "", specialInstructions: "", documents: [{...document, runCommand: "unsafe"}]}}).success, false);
});
