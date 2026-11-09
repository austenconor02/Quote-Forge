import { test, expect, type BrowserContext } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { createGoogleSession, jsonRequest } from "../emulator/http-helpers.mjs";
const base = "http://127.0.0.1:3002";
test.use({baseURL: base});
async function authenticate(context: BrowserContext, cookie: string) {
  await context.addCookies(cookie.split("; ").map(pair => {const separator = pair.indexOf("="); return {name: pair.slice(0, separator), value: pair.slice(separator + 1), url: base, httpOnly: true, sameSite: "Lax" as const};}));
  await context.addInitScript(() => localStorage.setItem("quoteforge.owner.tutorial.v1", JSON.stringify({version: 1, status: "skipped", step: 0})));
}
test("Google owner login is mandatory; billing remains Free/Not Configured without any checkout calls", async ({page, context}) => {
  test.skip(process.env.QUOTEFORGE_RUN_SECURITY_BROWSER_TESTS !== "true", "Requires the isolated emulator server with Stripe disabled.");
  test.setTimeout(60000);
  await page.goto("/"); await expect(page).toHaveURL(/\/login$/); await expect(page.getByRole("button", {name: /Google/})).toBeVisible();
  await expect(page.getByRole("heading", {name: "My Companies", exact: true})).toHaveCount(0);
  const rogue = await createGoogleSession(`unauthorized-${randomUUID()}@example.com`, {allowDenied: true}); expect(rogue.response.status).toBe(403);
  const owner = await createGoogleSession("owner@example.com"); await authenticate(context, owner.cookie);
  const id = "billing-ui-" + randomUUID();
  const company = {id, name: "Free Billing QA", industry: "Services", email: "billing@example.com", phone: "", address: "", website: "", status: "Draft", branding: {primary: "#122239", secondary: "#F5F7FA", accent: "#EE7D3B", font: "Arial", logo: ""}, fields: [], createdAt: new Date().toISOString()};
  expect((await jsonRequest(owner, "/api/companies", "POST", company)).response.status).toBe(200);
  let checkoutCalls = 0; page.on("request", request => {if (request.url().endsWith("/billing") && request.method() === "POST") checkoutCalls++;});
  await page.goto("/"); const card = page.locator(".owner-company-card").filter({hasText: company.name});
  await expect(card).toContainText("Free"); await expect(card).toContainText("Stripe: Not Configured");
  await card.getByRole("button", {name: "Enable Billing", exact: true}).click();
  await expect(page.getByRole("dialog")).toContainText("No checkout, payment, or billing change will be attempted");
  await expect(page.getByRole("button", {name: "Enable Billing & Send Setup", exact: true})).toBeDisabled();
  await page.getByRole("button", {name: "Cancel", exact: true}).click(); expect(checkoutCalls).toBe(0);
  await page.setViewportSize({width: 390, height: 844}); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("button", {name: "Sign out", exact: true}).click(); await expect(page).toHaveURL(/\/login$/);
  await page.goto("/"); await expect(page).toHaveURL(/\/login$/);
});
