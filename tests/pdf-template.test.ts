import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { demoCompanies } from "../src/lib/demo";
import { calculateQuote, sampleQuote } from "../src/lib/quote";
import { createProposalPdf, formatProposalUnitPrice, proposalReference } from "../src/lib/pdf";
import { money } from "../src/lib/models";

const company = () => structuredClone(demoCompanies[0]);

test("the original proposal structure is US Letter with unit-price columns, section subtotals, and approval", () => {
  const tenant = company();
  const quote = sampleQuote(tenant);
  quote.id = "proposal-824";
  const pdf = createProposalPdf(tenant, quote);
  assert.equal(pdf.internal.pageSize.getWidth(), 612);
  assert.equal(pdf.internal.pageSize.getHeight(), 792);
  const source = pdf.output();
  for (const label of ["Project Proposal", "Prepared For", "Proposal #: QF-PROPOSAL-824", "Date:", "Detailed Scope of Work", "Description", "Qty", "Unit Price", "Amount", "Section Subtotal", "Subtotal", "Total", "Notes", "Customer Approval", "Signature:"]) assert.ok(source.includes(label), label);
  assert.ok(source.includes("/MediaBox [0 0 612. 792.]"));
  assert.equal((source.match(/Section Subtotal/g) || []).length, new Set(quote.lineItems.map(item => item.section)).size);
  assert.ok(source.includes(money(calculateQuote(quote).total)));
});

test("private pricing is incorporated into customer unit rates without disclosing internal controls", () => {
  const tenant = company();
  const quote = sampleQuote(tenant);
  quote.privateAdjustment = 137.83;
  quote.lineItems[0].hiddenFromProposal = true;
  quote.lineItems[0].description = "PRIVATE EXCLUDED SOURCE ROW";
  quote.sourceInput = { pastedText: "INTERNAL SOURCE TEXT", specialInstructions: "INTERNAL SPECIAL INSTRUCTIONS", documents: [] };
  const extra = quote as typeof quote & {internalNotes: string; aiReport: string};
  extra.internalNotes = "INTERNAL NOTES";
  extra.aiReport = "INTERNAL CONFIDENCE REPORT";
  const totals = calculateQuote(quote);
  for (const item of totals.items) {
    const shown = Number(formatProposalUnitPrice(item).replace(/[^0-9.-]/g, ""));
    assert.equal(Math.round(shown * item.quantity * 100), Math.round(item.amount * 100));
  }
  const source = createProposalPdf(tenant, extra).output();
  for (const secret of ["PRIVATE EXCLUDED SOURCE ROW", "INTERNAL SOURCE TEXT", "INTERNAL SPECIAL INSTRUCTIONS", "INTERNAL NOTES", "INTERNAL CONFIDENCE REPORT", "Private adjustment", "Markup", "137.83"]) assert.ok(!source.includes(secret), secret);
});

test("fractional customer unit rates reconcile with final cent-rounded line amounts", () => {
  for (const item of [{quantity: 3, amount: 1}, {quantity: 28, amount: 7909.18}, {quantity: 1.125, amount: 39.17}, {quantity: 10000, amount: .01}]) {
    const shown = Number(formatProposalUnitPrice(item).replace(/[^0-9.-]/g, ""));
    assert.equal(Math.round(shown * item.quantity * 100), Math.round(item.amount * 100));
  }
  assert.equal(formatProposalUnitPrice({quantity: 0, amount: 0}), "—");
});

test("long scope rows paginate without losing text and repeat table headings without duplicate line prices", () => {
  const tenant = company();
  tenant.name = "Northstar Roofing and Exterior Construction Services for Residential Projects";
  const quote = sampleQuote(tenant);
  const tokens = Array.from({length: 1300}, (_, index) => `scope-${index}`);
  quote.lineItems = [{...quote.lineItems[0], description: tokens.join(" "), quantity: 100, unitPrice: 123.4567}];
  quote.markupType = "none"; quote.privateAdjustment = 0;
  quote.customer.name = "Jamie and Alex Morgan at the Willow Creek Family Residence and Exterior Renovation Project";
  const pdf = createProposalPdf(tenant, quote);
  assert.ok(pdf.getNumberOfPages() > 3);
  const source = pdf.output();
  for (const token of tokens) assert.ok(source.includes(token), token);
  assert.equal((source.match(/\(\$123\.4567\)/g) || []).length, 1);
  const pages = pdf.internal.pages as unknown as string[][];
  for (let page = 1; page < pages.length; page++) {
    const content = pages[page].join("\n");
    assert.ok(content.includes("Project Proposal"), `header ${page}`);
    assert.ok(content.includes(`Page ${page} of ${pdf.getNumberOfPages()}`), `footer ${page}`);
    if (content.includes("scope-")) assert.ok(content.includes("Unit Price"), `table heading ${page}`);
  }
});

test("long public notes and custom fields wrap onto pages while internal instructions stay private", () => {
  const tenant = company();
  tenant.fields.push({id: "project-spec", label: "Project specification", type: "Multiline text", required: false, defaultValue: "", options: []});
  const quote = sampleQuote(tenant);
  quote.customValues["project-spec"] = "A detailed public specification ".repeat(90);
  quote.notes = Array.from({length: 400}, (_, index) => `Public note ${index}.`).join(" ");
  const pdf = createProposalPdf(tenant, quote);
  const source = pdf.output();
  assert.ok(source.includes("Public note 0.")); assert.ok(source.includes("Public note 399."));
  assert.ok(source.includes("Notes \\(continued\\)")); assert.ok(source.includes("Customer Approval"));
  assert.ok(pdf.getNumberOfPages() > 3);
});

test("hydrated PNG, JPEG, and WebP logos export without forced PNG decoding or aspect distortion", async () => {
  for (const format of ["png", "jpeg", "webp"] as const) {
    const tenant = company();
    const image = await sharp({create: {width: 200, height: 50, channels: 3, background: "#243E75"}}).toFormat(format).toBuffer();
    tenant.branding.logo = `data:image/${format};base64,${image.toString("base64")}`;
    const pdf = createProposalPdf(tenant, sampleQuote(tenant));
    const page = (pdf.internal.pages as unknown as string[][])[1].join("\n");
    assert.ok(/118\. 0 0 29\.5 /.test(page), `aspect ratio for ${format}`);
  }
});

test("proposal identifiers and dates remain stable between preview and download", () => {
  const quote = sampleQuote(company()); quote.id = "saved-quote-123";
  assert.deepEqual(proposalReference(quote), proposalReference(structuredClone(quote)));
  assert.equal(proposalReference(quote).date, "11/08/2026");
  assert.equal(proposalReference({...quote, updatedAt: "invalid"}).date, "Date pending");
});
