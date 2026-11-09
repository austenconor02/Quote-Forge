import test from "node:test";
import assert from "node:assert/strict";
import { demoCompanies } from "../src/lib/demo";
import { sampleQuote } from "../src/lib/quote";
import { createEmptyWorkspace, LEGACY_STORAGE_KEY, loadOwnerWorkspace } from "../src/lib/workspace-storage";

test("migration retains additional company, customer, quote, proposal, and source metadata", () => {
  const company = {...structuredClone(demoCompanies[0]), id: "retained-owner-1234", ownerNote: "Keep this information", updatedAt: "2026-11-08T12:00:00Z"};
  const quote = {...sampleQuote(company), id: "real-draft", aiReport: {warnings: ["Review source"]}, lineItems: sampleQuote(company).lineItems.map(item => ({...item, sourceDocumentName: "estimate.pdf", sourceReason: "Original source detail"})), customer: {...sampleQuote(company).customer, projectDetails: "Existing project context"}};
  const saved = {...createEmptyWorkspace(), companies: [company], customers: [quote.customer], drafts: [quote], proposals: [{id: "proposal-1", companyId: company.id, title: "Keep existing proposal"}]};
  const raw = JSON.stringify(saved);
  const loaded = loadOwnerWorkspace({getItem: key => key === LEGACY_STORAGE_KEY ? raw : null}) as typeof saved;
  assert.equal(loaded.companies[0].ownerNote, company.ownerNote);
  assert.equal(loaded.customers[0].projectDetails, quote.customer.projectDetails);
  assert.deepEqual(loaded.drafts[0].aiReport, quote.aiReport);
  assert.equal(loaded.drafts[0].lineItems[0].sourceDocumentName, "estimate.pdf");
  assert.equal(loaded.drafts[0].lineItems[0].sourceReason, "Original source detail");
  assert.deepEqual(loaded.proposals, saved.proposals);
});
