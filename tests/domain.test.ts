import test from "node:test";
import assert from "node:assert/strict";
import { calculateQuote, emptyQuote, requiredFieldErrors, sampleQuote } from "../src/lib/quote";
import { demoCompanies } from "../src/lib/demo";
import { isOwner, canAccessTenant, localDemoAllowed } from "../src/lib/access-policy";
import { tenantManifest } from "../src/lib/pwa";
import { createProposalPdf } from "../src/lib/pdf";

const company = demoCompanies[0];
test("an actual company quote starts empty and keeps configured field defaults", () => {
  const quote = emptyQuote(company);
  assert.equal(quote.companyId, company.id); assert.equal(quote.customer.companyId, company.id);
  assert.equal(quote.customer.name, ""); assert.equal(quote.customer.email, ""); assert.equal(quote.title, "");
  assert.deepEqual(quote.lineItems, []); assert.equal(calculateQuote(quote).total, 0);
  assert.equal(quote.customValues["project-type"], "Roof replacement");
  assert.notEqual(quote.id, emptyQuote(company).id);
});
test("fractional quantities, fixed/percentage markup, adjustments, and tax use cent rounding", () => {
  const q = sampleQuote(company); q.lineItems = [{...q.lineItems[0], quantity: 1.5, unitPrice: 19.99}]; q.markupType = "percent"; q.markupValue = 10; q.privateAdjustment = -1; q.taxRate = 8.25;
  const result = calculateQuote(q);
  assert.equal(result.subtotal, 29.99); assert.equal(result.markup, 3); assert.equal(result.net, 31.99); assert.equal(result.tax, 2.64); assert.equal(result.total, 34.63);
  q.markupType = "fixed"; q.markupValue = 5; assert.equal(calculateQuote(q).net, 33.99);
});
test("excluded items do not enter totals or proposal rows; allocated amounts reconcile", () => {
  const q = sampleQuote(company); q.lineItems[0].hiddenFromProposal = true; q.markupValue = 13.17; q.privateAdjustment = -31.23;
  const result = calculateQuote(q);
  assert.equal(result.items.length, 3); assert.equal(result.subtotal, 2986);
  assert.equal(Math.round(result.items.reduce((n, i) => n + i.amount, 0) * 100), Math.round(result.net * 100));
  q.privateAdjustment = -1e9; assert.equal(calculateQuote(q).total, 0);
});
test("required custom fields remain independent of pricing", () => {
  const q = sampleQuote(company); const total = calculateQuote(q).total;
  q.customValues = {}; assert.deepEqual(requiredFieldErrors(company, q), []);
  q.customValues["project-type"] = ""; assert.deepEqual(requiredFieldErrors(company, q), ["Project type"]);
  q.customValues["project-type"] = "99999"; assert.equal(calculateQuote(q).total, total);
});
test("only a verified designated owner with the owner claim can administer the platform", () => {
  assert.equal(isOwner(null, "owner"), false); assert.equal(isOwner({uid: "imposter", platformOwner: true, email_verified: true}, "owner"), false);
  assert.equal(isOwner({uid: "owner", platformOwner: false, email_verified: true}, "owner"), false);
  assert.equal(isOwner({uid: "owner", platformOwner: true, email_verified: false}, "owner"), false);
  assert.equal(isOwner({uid: "owner", platformOwner: true, email_verified: true}, "owner"), true);
});
test("tenant policy rejects suspended companies, disabled members, and another user’s membership", () => {
  const identity = {uid: "member-a", email_verified: true}; const member = {uid: "member-a", enabled: true};
  assert.equal(canAccessTenant(identity, "owner", "Active", member), true);
  assert.equal(canAccessTenant(identity, "owner", "Suspended", member), false);
  assert.equal(canAccessTenant(identity, "owner", "Draft", member), false);
  assert.equal(canAccessTenant(identity, "owner", "Active", {...member, enabled: false}), false);
  assert.equal(canAccessTenant(identity, "owner", "Active", {...member, uid: "member-b"}), false);
  assert.equal(canAccessTenant(identity, "owner", "Active"), false);
});
test("demo authorization is limited to development loopback and cannot run in production", () => {
  assert.equal(localDemoAllowed("127.0.0.1:3000", undefined, "development"), true);
  for (const host of ["example.com", "localhost.evil:3000", "127.0.0.1.evil"]) assert.equal(localDemoAllowed(host, "true", "development"), false);
  assert.equal(localDemoAllowed("localhost:3000", "true", "production"), false);
  assert.equal(localDemoAllowed("localhost:3000", "false", "development"), false);
});
test("each manifest has its own app identity, scope, and company icons", () => {
  const a = tenantManifest(demoCompanies[0]), b = tenantManifest(demoCompanies[1]);
  assert.notEqual(a.id, b.id); assert.equal(a.name, company.name); assert.equal(a.theme_color, company.branding.primary);
  assert.ok(a.icons.every(i => i.src.startsWith(a.scope) && !i.src.includes("quoteforge")));
});
test("PDF contains branded proposal details, hides excluded items and private controls, and paginates", () => {
  const q = sampleQuote(company); q.lineItems[0].description = "INTERNAL EXCLUDED ITEM"; q.lineItems[0].hiddenFromProposal = true;
  q.lineItems.push(...Array.from({length: 70}, (_, i) => ({...q.lineItems[1], id: `long-${i}`, description: `Installation line ${i} with detailed scope and specifications.`})));
  const pdf = createProposalPdf(company, q); const bytes = pdf.output();
  assert.ok(bytes.startsWith("%PDF")); assert.ok(bytes.includes("Northstar Roofing")); assert.ok(bytes.includes("Jamie & Alex Morgan"));
  assert.ok(!bytes.includes("INTERNAL EXCLUDED ITEM")); assert.ok(!bytes.includes("Private adjustment")); assert.ok(!bytes.includes("Markup")); assert.ok(pdf.getNumberOfPages() > 2);
});
