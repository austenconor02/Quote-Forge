import { test, expect } from "@playwright/test";
import { createProposalPdf } from "../../src/lib/pdf";
import { sampleQuote } from "../../src/lib/quote";
import { demoCompanies } from "../../src/lib/demo";

test("customer proposal page handles missing links without exposing owner controls", async ({page}) => {
  await page.goto("/proposal#not-a-valid-link");
  await expect(page.getByRole("main").getByRole("alert")).toContainText("Ask the company for a new link");
  await expect(page).toHaveURL(/\/proposal$/);
  await expect(page.getByRole("button", {name: /sign in|save|send|edit/i})).toHaveCount(0);
  await expect(page.getByRole("link", {name: "Download PDF"})).toHaveCount(0);
});

test("fragment is stripped and requested once under StrictMode before private PDF preview/download", async ({page}) => {
  const token = "T".repeat(43), requests: string[] = [], failures: string[] = [];
  const pdf = Buffer.from(createProposalPdf({...demoCompanies[0], branding: {...demoCompanies[0].branding, logo: ""}}, sampleQuote(demoCompanies[0])).output("arraybuffer"));
  page.on("pageerror", error => failures.push(error.message));
  await page.route("**/api/proposals/download", async route => {
    requests.push(route.request().postDataJSON().token);
    expect(new URL(page.url()).hash).toBe("");
    await route.fulfill({status: 200, headers: {"content-type": "application/pdf", "content-disposition": 'inline; filename="proposal-customer-test.pdf"'}, body: pdf});
  });
  await page.goto(`/proposal#token=${token}`);
  await expect(page.getByTitle("Your project proposal PDF")).toHaveAttribute("src", /^blob:/);
  const download = page.getByRole("link", {name: "Download PDF"});
  await expect(download).toHaveAttribute("download", "proposal-customer-test.pdf");
  await expect(download).toHaveAttribute("href", /^blob:/);
  expect(requests).toEqual([token]); expect(failures).toEqual([]);
  await page.setViewportSize({width: 390, height: 844});
  await expect(download).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("expired proposal remains generic and never renders returned server data", async ({page}) => {
  await page.route("**/api/proposals/download", route => route.fulfill({status: 404, contentType: "application/json", body: JSON.stringify({error: "sensitive internal fixture should not be shown"})}));
  await page.goto(`/proposal#token=${"E".repeat(43)}`);
  await expect(page.getByRole("main").getByRole("alert")).toContainText("unavailable or has expired");
  await expect(page.getByRole("main").getByRole("alert")).not.toContainText("sensitive internal fixture");
  await expect(page.getByRole("link", {name: "Download PDF"})).toHaveCount(0);
});
