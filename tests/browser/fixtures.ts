import type { Page } from "@playwright/test";
import type { Company, Workspace } from "../../src/lib/models";
import { demoCompanies } from "../../src/lib/demo";
import { sampleQuote } from "../../src/lib/quote";
import sharp from "sharp";

export const OWNER_KEY = "quoteforge.owner.workspace.v2";
export const TUTORIAL_KEY = "quoteforge.owner.tutorial.v1";
export const TEST_COMPANY_ID = "test-services-created-123";
export function ownerWorkspace({ active = false, records = true } = {}): Workspace {
  const company: Company = { ...structuredClone(demoCompanies[0]), id: TEST_COMPANY_ID, name: "Cedar Test Services", email: "office@cedar.example", origin: "owner", status: active ? "Active" : "Draft", fields: [{ id: "permit-number", label: "Permit number", type: "Text", required: false, defaultValue: "PERMIT-2026", options: [] }], ...(active ? { assignedEmail: "assigned@cedar.example" } : {}) };
  const quote = { ...sampleQuote(company), id: "saved-test-draft-123", customer: { ...sampleQuote(company).customer, id: "saved-test-customer-123", name: "Saved Test Customer" } };
  return { version: 1, companies: [company], selectedCompanyId: company.id, customers: records ? [quote.customer] : [], drafts: records ? [quote] : [], invitations: active ? [{ id: "assigned-test-user", companyId: company.id, email: company.assignedEmail!, status: "Active", createdAt: "2026-11-08T12:00:00Z" }] : [], activity: [] };
}
export async function prepareContext(page: Page, workspace?: Workspace, tutorial: { version: 1; status: "active" | "completed" | "skipped"; step: number } | null = { version: 1, status: "skipped", step: 0 }) {
  // Browser contexts are isolated. Reloads must not replace edits made by the test.
  await page.addInitScript(({ workspace, tutorial, ownerKey, tutorialKey }) => {
    if (window.top !== window) return;
    if (localStorage.getItem("quoteforge.browser-test.initialized")) return;
    if (workspace) localStorage.setItem(ownerKey, JSON.stringify(workspace));
    if (tutorial) localStorage.setItem(tutorialKey, JSON.stringify(tutorial));
    localStorage.setItem("quoteforge.browser-test.initialized", "true");
  }, { workspace, tutorial, ownerKey: OWNER_KEY, tutorialKey: TUTORIAL_KEY });
}
export async function savedWorkspace(page: Page): Promise<Workspace> { return page.evaluate(key => JSON.parse(localStorage.getItem(key) || "null"), OWNER_KEY); }
export async function testLogo() {
  const buffer = await sharp(Buffer.from([18, 34, 57, 18, 34, 57, 238, 125, 59, 238, 125, 59]), { raw: { width: 2, height: 2, channels: 3 } }).resize(64, 64, { kernel: "nearest" }).png().toBuffer();
  return { name: "cedar-company-logo.png", mimeType: "image/png", buffer };
}
