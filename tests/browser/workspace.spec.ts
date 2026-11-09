import { test, expect, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { ownerWorkspace, prepareContext, savedWorkspace, testLogo, TEST_COMPANY_ID, TUTORIAL_KEY, OWNER_KEY } from "./fixtures";
async function nextStep(page: Page) { await page.locator(".wizard-footer").getByRole("button", { name: "Next", exact: true }).click(); }
async function waitTutorialHighlight(page: Page, target: string) {
  await expect.poll(() => page.evaluate(name => {
    const element = document.querySelector(`[data-tutorial="${name}"]`), highlight = document.querySelector(".owner-tutorial-highlight");
    if (!element || !highlight) return Number.MAX_SAFE_INTEGER;
    return Math.abs(highlight.getBoundingClientRect().top - Math.max(6, element.getBoundingClientRect().top - 5));
  }, target)).toBeLessThan(2);
}

test("My Companies starts empty without sample companies, statistics, or sidebar", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await prepareContext(page); await page.goto("/");
  await expect(page.getByRole("heading", { name: "My Companies", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "No companies yet" })).toBeVisible();
  await expect(page.getByRole("img", { name: "QuoteForge finance anvil logo" })).toBeVisible();
  await expect(page.locator(".sidebar,.metric-grid,.welcome-banner,.owner-company-card")).toHaveCount(0);
  await expect(page.getByText("Northstar Roofing", { exact: true })).toHaveCount(0);
  for (const name of ["Branding Studio", "Field Builder", "Company Preview"]) await expect(page.getByRole("link", { name, exact: true })).toHaveCount(0);
  expect((await savedWorkspace(page)).companies).toEqual([]);
  await mkdir("artifacts", { recursive: true }); await page.screenshot({ path: "artifacts/my-companies-empty.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "artifacts/my-companies-mobile.png", fullPage: true }); expect(errors).toEqual([]);
});

test("four-step setup applies logo and colors to desktop, mobile, and PDF previews without saving fixtures", async ({ page }) => {
  await prepareContext(page); await page.goto("/create-company");
  await expect(page.getByRole("list", { name: "Company setup steps" }).getByRole("button")).toHaveCount(4);
  await expect(page.getByRole("heading", { name: "Company & Logo", exact: true })).toBeVisible();
  await nextStep(page); await expect(page.locator(".wizard-error")).toContainText("Enter the company name");
  await page.getByLabel("Company name", { exact: false }).fill("Preview Test Company");
  await page.getByLabel("Upload company logo", { exact: true }).setInputFiles(await testLogo());
  await expect(page.getByRole("img", { name: "Preview Test Company logo preview" })).toBeVisible();
  await nextStep(page); await expect(page.getByRole("heading", { name: "Choose Colors", exact: true })).toBeVisible();
  for (const [name, color] of [["Primary", "#285A6F"], ["Secondary", "#F2F7F9"], ["Accent", "#EC8544"]]) await page.getByLabel(`${name} HEX`, { exact: true }).fill(color);
  await expect(page.locator(".wizard-theme-preview")).toHaveCSS("--tenant-primary", "#285A6F");
  await expect(page.getByRole("button", { name: "Sample primary color from logo" })).toBeVisible();
  await mkdir("artifacts", { recursive: true }); await page.screenshot({ path: "artifacts/company-wizard-colors.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "artifacts/company-wizard-colors-mobile.png", fullPage: true }); await page.setViewportSize({ width: 1440, height: 1100 });
  await nextStep(page); await expect(page.getByRole("heading", { name: "Preview Application", exact: true })).toBeVisible();
  await expect(page.locator(".tenant-app")).toHaveCSS("--tenant-primary", "#285A6F");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Preview only");
  const untouched = await savedWorkspace(page); expect(untouched.companies).toEqual([]); expect(untouched.customers).toEqual([]); expect(untouched.drafts).toEqual([]);
  await page.getByRole("button", { name: "Mobile", exact: true }).click();
  await expect(page.locator(".wizard-mobile-device")).toBeVisible(); expect((await page.locator(".wizard-mobile-device").boundingBox())!.width).toBeLessThanOrEqual(410);
  await page.getByRole("button", { name: "PDF Proposal", exact: true }).click();
  await expect(page.getByTitle("Live branded proposal PDF")).toHaveAttribute("src", /^blob:/);
  await page.locator(".wizard-footer").getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.getByLabel("Primary HEX", { exact: true })).toHaveValue("#285A6F");
  await page.locator(".wizard-footer").getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.getByLabel("Company name", { exact: false })).toHaveValue("Preview Test Company");
  await expect(page.getByRole("img", { name: "Preview Test Company logo preview" })).toBeVisible();
});

test("failed invitation delivery retries without creating duplicates and allows explicit unassigned saving", async ({ page }) => {
  await prepareContext(page); const bodies: { companyId: string; idempotencyKey: string }[] = [];
  page.on("request", request => { if (request.url().endsWith("/api/invitations") && request.method() === "POST") bodies.push(request.postDataJSON()); });
  await page.goto("/create-company"); await page.getByLabel("Company name", { exact: false }).fill("Unassigned Test Company");
  await nextStep(page); await nextStep(page); await nextStep(page);
  await page.getByLabel("Customer Email Address", { exact: false }).fill("client@example.com");
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = page.waitForResponse(response => response.url().endsWith("/api/invitations") && response.request().method() === "POST");
    await page.getByRole("button", { name: "Create Company & Send Invitation", exact: true }).click();
    expect((await response).status()).toBe(503); await expect(page.locator(".wizard-error")).toContainText(/invitation|delivery|unavailable|not connected/i);
    expect((await savedWorkspace(page)).companies).toEqual([]); expect((await savedWorkspace(page)).invitations).toEqual([]);
  }
  expect(bodies).toHaveLength(2); expect(bodies[0].companyId).toBe(bodies[1].companyId); expect(bodies[0].idempotencyKey).toBe(bodies[1].idempotencyKey);
  await page.getByRole("button", { name: "Save unassigned draft", exact: true }).click();
  await expect(page.getByRole("heading", { name: "My Companies", exact: true })).toBeVisible(); await expect(page.locator(".owner-company-card")).toHaveCount(1);
  await expect(page.getByText("Unassigned draft", { exact: true })).toBeVisible();
  const saved = await savedWorkspace(page); expect(saved.companies).toHaveLength(1); expect(saved.companies[0].id).toBe(bodies[0].companyId); expect(saved.companies[0].status).toBe("Draft"); expect(saved.companies[0].assignedEmail).toBeUndefined(); expect(saved.invitations).toEqual([]);
  await page.reload(); await expect(page.locator(".owner-company-card")).toHaveCount(1);
});

test("editing preserves company identity, fields, customers, drafts, and updated branding", async ({ page }) => {
  const initial = ownerWorkspace(); await prepareContext(page, initial); await page.goto("/");
  await page.getByRole("link", { name: "Edit", exact: true }).click();
  await expect(page.getByLabel("Company name", { exact: false })).toHaveValue("Cedar Test Services"); await page.getByLabel("Company name", { exact: false }).fill("Cedar Updated Services");
  await nextStep(page); await page.getByLabel("Primary HEX", { exact: true }).fill("#314E75"); await nextStep(page);
  await expect(page.locator(".tenant-app")).toHaveCSS("--tenant-primary", "#314E75"); await nextStep(page);
  await page.getByRole("button", { name: "Save Changes", exact: true }).click();
  await expect(page.getByRole("heading", { name: "My Companies", exact: true })).toBeVisible(); await expect(page.getByRole("heading", { name: "Cedar Updated Services", exact: true })).toBeVisible();
  const saved = await savedWorkspace(page); expect(saved.companies).toHaveLength(1); expect(saved.companies[0].id).toBe(TEST_COMPANY_ID); expect(saved.companies[0].branding.primary).toBe("#314E75"); expect(saved.companies[0].fields).toEqual(initial.companies[0].fields); expect(saved.customers).toEqual(initial.customers); expect(saved.drafts).toEqual(initial.drafts);
  const dismiss = page.getByRole("button", { name: "Dismiss notification" }); if (await dismiss.isVisible()) await dismiss.click();
  await mkdir("artifacts", { recursive: true }); await page.screenshot({ path: "artifacts/my-companies-populated.png", fullPage: true });
  await page.getByRole("link", { name: "Open Company", exact: true }).click(); await expect(page.locator(".tenant-app")).toHaveCSS("--tenant-primary", "#314E75");
  await expect(page.getByRole("textbox", { name: "Customer / Project Name", exact: false })).toHaveValue(""); await expect(page.getByRole("textbox", { name: "Permit number", exact: true })).toHaveValue("PERMIT-2026");
  await page.getByRole("button", { name: /Saved drafts/ }).click(); await page.locator(".draft-list>button").first().click();
  await expect(page.getByRole("textbox", { name: "Customer / Project Name", exact: false })).toHaveValue("Saved Test Customer"); await expect(page.getByLabel("Line 1 quantity", { exact: true })).toHaveValue("28");
});

test("active company access cannot be reassigned merely by changing an email field", async ({ page }) => {
  const initial = ownerWorkspace({ active: true }); await prepareContext(page, initial); let deliveries = 0;
  page.on("request", request => { if (request.url().endsWith("/api/invitations")) deliveries++; });
  await page.goto(`/companies/${TEST_COMPANY_ID}/edit`); await page.getByRole("button", { name: "4 Assign & Send", exact: false }).click();
  await expect(page.getByLabel("Customer Email Address", { exact: false })).toHaveValue("assigned@cedar.example"); await page.getByLabel("Customer Email Address", { exact: false }).fill("replacement@example.com");
  await page.getByRole("button", { name: "Save Changes & Send Invitation", exact: true }).click(); await expect(page.locator(".wizard-error")).toContainText("Secure reassignment requires the cloud workspace. Existing access has not changed.");
  await page.getByRole("button", { name: "Save Changes", exact: true }).click(); await expect(page.locator(".wizard-error")).toContainText("active access");
  const saved = await savedWorkspace(page); expect(saved.companies).toEqual(initial.companies); expect(saved.invitations).toEqual(initial.invitations); expect(saved.drafts).toEqual(initial.drafts); expect(deliveries).toBe(0);
});

test("search and deactivate/reactivate preserve company records and failed resend does not alter access", async ({ page }) => {
  const initial = ownerWorkspace({ active: true }); await prepareContext(page, initial); await page.goto("/");
  await page.getByRole("searchbox", { name: "Search companies" }).fill("No match"); await expect(page.getByRole("heading", { name: "No companies found" })).toBeVisible(); await page.getByRole("button", { name: "Clear search", exact: true }).last().click();
  await page.getByRole("button", { name: "Deactivate", exact: true }).click(); await page.getByRole("dialog").getByRole("button", { name: "Deactivate", exact: true }).click(); await expect(page.getByText("Deactivated", { exact: true })).toBeVisible();
  expect((await savedWorkspace(page)).drafts).toEqual(initial.drafts); expect((await savedWorkspace(page)).customers).toEqual(initial.customers);
  await page.getByRole("button", { name: "Reactivate", exact: true }).click(); await page.getByRole("dialog").getByRole("button", { name: "Reactivate", exact: true }).click(); await expect(page.getByText("Account active", { exact: true })).toBeVisible();
  expect((await savedWorkspace(page)).drafts).toEqual(initial.drafts);
  await page.getByRole("button", { name: "Resend Invitation", exact: true }).click(); await expect(page.locator(".owner-inline-error")).toContainText(/disabled|unavailable|not connected|not configured/i); expect((await savedWorkspace(page)).invitations).toEqual(initial.invitations);
});

test("tutorial skips and restarts, validates input, and follows regular wizard Next controls", async ({ page }) => {
  await prepareContext(page, undefined, null); await page.goto("/"); const tutorial = page.getByRole("dialog", { name: "Owner setup tutorial" });
  await expect(tutorial.getByRole("heading", { name: "Create a company" })).toBeVisible(); await tutorial.getByRole("button", { name: "Skip Tutorial", exact: true }).click(); await page.reload(); await expect(tutorial).toHaveCount(0);
  await page.getByRole("button", { name: "Help / Restart Tutorial" }).click(); await tutorial.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Company & Logo", exact: true })).toBeVisible(); await expect(tutorial.getByRole("heading", { name: "Add the company logo" })).toBeVisible();
  await waitTutorialHighlight(page, "upload-logo"); await mkdir("artifacts", { recursive: true }); await page.screenshot({ path: "artifacts/tutorial-upload-logo.png" });
  await tutorial.getByRole("button", { name: "Next", exact: true }).click(); await expect(page.locator(".wizard-error")).toContainText("company name"); await expect(page.locator(".company-wizard")).toHaveAttribute("data-wizard-step", "0");
  await page.getByLabel("Company name", { exact: false }).fill("Walkthrough Test Company"); await tutorial.getByRole("button", { name: "Next", exact: true }).click(); await expect(tutorial.getByRole("heading", { name: "Choose their colors" })).toBeVisible();
  await tutorial.getByRole("button", { name: "Previous tutorial step" }).click(); await expect(page.getByLabel("Company name", { exact: false })).toHaveValue("Walkthrough Test Company");
  await nextStep(page); await expect(tutorial.getByRole("heading", { name: "Choose their colors" })).toBeVisible();
  await waitTutorialHighlight(page, "choose-colors"); await page.screenshot({ path: "artifacts/tutorial-choose-colors.png" });
  await nextStep(page); await expect(tutorial.getByRole("heading", { name: "Preview their application" })).toBeVisible();
  await nextStep(page); await expect(tutorial.getByRole("heading", { name: "Assign access" })).toBeVisible();
  await tutorial.getByRole("button", { name: "Finish", exact: true }).click(); expect((await savedWorkspace(page)).companies).toEqual([]);
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).status, TUTORIAL_KEY)).toBe("completed"); await page.reload(); await expect(tutorial).toHaveCount(0);
});

test("unfinished tutorial resumes in context without creating records or bypassing validation", async ({ page }) => {
  await prepareContext(page, undefined, { version: 1, status: "active", step: 3 }); await page.goto("/"); const tutorial = page.getByRole("dialog", { name: "Owner setup tutorial" });
  await expect(tutorial.getByRole("heading", { name: "Continue company setup" })).toBeVisible(); await tutorial.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Company & Logo", exact: true })).toBeVisible(); await expect(tutorial.getByRole("heading", { name: "Add the company logo" })).toBeVisible();
  await tutorial.getByRole("button", { name: "Next", exact: true }).click(); await expect(page.locator(".company-wizard")).toHaveAttribute("data-wizard-step", "0"); expect((await savedWorkspace(page)).companies).toEqual([]);
});

test("saving a previously opened editor keeps newer access status and custom fields from another tab", async ({ page }) => {
  const initial = ownerWorkspace(); await prepareContext(page, initial);
  await page.goto(`/companies/${TEST_COMPANY_ID}/edit`);
  await nextStep(page); await page.getByLabel("Primary HEX", { exact: true }).fill("#314E75");
  const newField = { id: "added-in-another-tab", label: "Latest project detail", type: "Text" as const, required: false, defaultValue: "Preserve this", options: [] };
  await page.evaluate(({ ownerKey, companyId, field }) => {
    const latest = JSON.parse(localStorage.getItem(ownerKey)!);
    const record = latest.companies.find((company: { id: string }) => company.id === companyId);
    record.status = "Suspended"; record.fields.push(field);
    const value = JSON.stringify(latest); localStorage.setItem(ownerKey, value);
    window.dispatchEvent(new StorageEvent("storage", { key: ownerKey, newValue: value, storageArea: localStorage }));
  }, { ownerKey: OWNER_KEY, companyId: TEST_COMPANY_ID, field: newField });
  await nextStep(page); await nextStep(page); await page.getByRole("button", { name: "Save Changes", exact: true }).click();
  await expect(page.getByRole("heading", { name: "My Companies", exact: true })).toBeVisible();
  const saved = await savedWorkspace(page);
  expect(saved.companies[0].status).toBe("Suspended");
  expect(saved.companies[0].branding.primary).toBe("#314E75");
  expect(saved.companies[0].fields).toEqual([...initial.companies[0].fields, newField]);
  expect(saved.customers).toEqual(initial.customers); expect(saved.drafts).toEqual(initial.drafts);
});
