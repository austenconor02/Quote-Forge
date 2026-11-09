import { test } from "node:test";
import assert from "node:assert/strict";
import { compileAiDraft, type AiOutput } from "../src/lib/ai-quote";
import { quoteInputSchema } from "../src/lib/server-input";
import { emptyQuote } from "../src/lib/quote";
import { demoCompanies } from "../src/lib/demo";

const excerpt = "Install trim: quantity 2 EA, total $25.00";
const sources = [{id: "pasted-text", name: "Pasted scope", pages: 1, text: excerpt}];
function output(): AiOutput {return {items: [{description: "Install trim", section: "Carpentry", scopeKey: "Kitchen", quantity: 2, unit: "EA", price: {kind: "total", amount: 25, source: {sourceId: "pasted-text", page: null, excerpt}}, sources: [{sourceId: "pasted-text", page: null, excerpt}], reason: "Price and scope from supplied source.", warnings: []}], warnings: []};}

test("a sourced line total becomes editable unit pricing and always requires review", () => {
  const draft = compileAiDraft(output(), sources), item = draft.lineItems[0];
  assert.equal(item.quantity, 2); assert.equal(item.unitPrice, 12.5); assert.equal(item.needsReview, true);
  assert.equal(item.sourceReferences?.[0].sourceName, "Pasted scope");
  const quote = {...emptyQuote(demoCompanies[0]), customer: {...emptyQuote(demoCompanies[0]).customer, name: "Test"}, lineItems: draft.lineItems};
  assert.equal(quoteInputSchema.safeParse(quote).success, true);
});
test("unreferenced prices and missing quantities remain zero with review warnings", () => {
  const input = output(); input.items[0].price!.amount = 999; input.items[0].quantity = null;
  const result = compileAiDraft(input,sources); assert.equal(result.lineItems[0].unitPrice, 0); assert.equal(result.lineItems[0].quantity, 0);
  assert.match(result.warnings.join(" "), /could not be verified/);
});
test("foreign sources, fabricated text, and nonexistent pages are rejected", () => {
  const foreign = output(); foreign.items[0].sources[0].sourceId = "company-b-source";
  assert.throws(() => compileAiDraft(foreign,sources), /unknown source/);
  const fabricated = output(); fabricated.items[0].price!.source.excerpt = "Invented $25.00";
  assert.throws(() => compileAiDraft(fabricated,sources), /could not be verified/);
  const page = output(); page.items[0].sources[0].page = 2;
  assert.throws(() => compileAiDraft(page,sources), /unknown source/);
});
test("exact duplicate evidence is collapsed while different locations remain separate", () => {
  const input = output(); input.items.push(structuredClone(input.items[0]));
  assert.equal(compileAiDraft(input,sources).lineItems.length, 1);
  input.items[1].scopeKey = "Bathroom";
  assert.equal(compileAiDraft(input,sources).lineItems.length, 2);
});
test("invalid numbers, oversized responses, and model-supplied company fields are rejected", () => {
  const input = output(); input.items[0].quantity = Infinity; assert.throws(() => compileAiDraft(input,sources));
  assert.throws(() => compileAiDraft({...output(), companyId: "company-b"},sources));
  assert.throws(() => compileAiDraft({...output(), items: Array.from({length:201}, () => output().items[0])},sources));
});
