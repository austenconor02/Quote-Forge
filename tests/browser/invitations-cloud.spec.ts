import { test, expect, type BrowserContext } from "@playwright/test";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { createGoogleSession } from "../emulator/http-helpers.mjs";

const base = "http://127.0.0.1:3002";
test.use({baseURL: base});
async function authenticate(context: BrowserContext, cookie: string) {
  await context.addCookies(cookie.split("; ").map(pair => {const separator = pair.indexOf("="); return {name: pair.slice(0, separator), value: pair.slice(separator + 1), url: base, httpOnly: true, sameSite: "Lax" as const};}));
  await context.addInitScript(() => localStorage.setItem("quoteforge.owner.tutorial.v1", JSON.stringify({version: 1, status: "skipped", step: 0})));
}

test("owner wizard sends branded seven-day invitations through fake EmailJS; resend and exact Google acceptance protect tenant records", async ({page, context, browser}) => {
  test.skip(process.env.QUOTEFORGE_RUN_INVITATION_TESTS !== "true", "Requires the explicit emulator server and fake EmailJS transport; never runs with real delivery.");
  test.setTimeout(90000);
  const owner = await createGoogleSession("owner@example.com"); await authenticate(context, owner.cookie);
  const email = `invited-${randomUUID().slice(0, 8)}@example.com`, name = "Invitation QA Company";
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await page.goto("/create-company");
  await page.getByLabel("Company name", {exact: false}).fill(name);
  const logo = await sharp({create: {width: 64, height: 64, channels: 4, background: "#D52A52"}}).png().toBuffer();
  await page.getByLabel("Upload company logo", {exact: true}).setInputFiles({name: "customer-logo.png", mimeType: "image/png", buffer: logo});
  const next = () => page.locator(".wizard-footer").getByRole("button", {name: "Next", exact: true}).click();
  await next(); await page.getByLabel("Primary HEX", {exact: true}).fill("#FAE461"); await next(); await next();
  await page.getByLabel("Customer Email Address", {exact: false}).fill(email);
  const sending = page.waitForResponse(response => response.url().endsWith("/api/invitations") && response.request().method() === "POST");
  await page.getByRole("button", {name: "Create Company & Send Invitation", exact: true}).click();
  const sent = await sending; expect(sent.status(), await sent.text()).toBe(200);
  await expect(page.locator(".owner-company-card").filter({hasText: name})).toContainText("Invitation sent");
  const captured = async () => (await (await fetch("http://127.0.0.1:9444/messages")).json()).filter((message: {template_params: {to_email: string}}) => message.template_params.to_email === email);
  const first = (await captured())[0].template_params;
  expect(Object.keys(first).sort()).toEqual(["to_email", "company_name", "company_logo_url", "primary_color", "header_text_color", "button_text_color", "invite_url", "expires_in"].sort());
  expect(first.company_name).toBe(name); expect(first.primary_color).toBe("#FAE461"); expect(first.header_text_color).toBe("#000000"); expect(first.button_text_color).toBe("#000000"); expect(first.expires_in).toBe("7 days");
  expect(JSON.stringify(first)).not.toContain("{{");
  const image = await fetch(first.company_logo_url); expect(image.status).toBe(200); expect(image.headers.get("content-type")).toBe("image/png");
  const pixel = await sharp(Buffer.from(await image.arrayBuffer())).extract({left: 0, top: 0, width: 1, height: 1}).removeAlpha().raw().toBuffer(); expect([...pixel]).toEqual([213, 42, 82]);
  await page.waitForTimeout(1200); // EmailJS's global dispatch rate is one request/second.
  const resending = page.waitForResponse(response => response.url().endsWith("/api/invitations") && response.request().method() === "POST");
  await page.locator(".owner-company-card").filter({hasText: name}).getByRole("button", {name: "Resend Invitation", exact: true}).click();
  expect((await resending).status()).toBe(200);
  const second = (await captured())[1].template_params;
  expect(second.invite_url).not.toBe(first.invite_url);
  const token = (url: string) => new URL(url).hash.slice("#token=".length);
  expect((await createGoogleSession(email, {invitationToken: token(first.invite_url), allowDenied: true})).response.status).toBe(403);
  expect((await createGoogleSession("wrong-" + email, {invitationToken: token(second.invite_url), allowDenied: true})).response.status).toBe(403);
  const member = await createGoogleSession(email, {invitationToken: token(second.invite_url)});
  expect(member.body.next).toMatch(/^\/app\/company-/);
  expect((await createGoogleSession(email, {invitationToken: token(second.invite_url), allowDenied: true})).response.status).toBe(403);
  expect((await member.request("/api/tenants/another-company/customers")).status).toBe(403);
  expect((await member.request("/api/invitations", {method: "POST", headers: {"Content-Type": "application/json"}, body: "{}"})).status).toBe(403);
  const tenantContext = await browser.newContext();
  try {
    await authenticate(tenantContext, member.cookie); const tenant = await tenantContext.newPage(); await tenant.goto(base + member.body.next);
    await expect(tenant.locator(".tenant-brand")).toContainText(name); await expect(tenant.locator(".tenant-app")).toHaveCSS("--tenant-primary", "#FAE461");
    await expect(tenant.getByRole("link", {name: "Create Company", exact: true})).toHaveCount(0);
    const manifest = await member.request(member.body.next + "/manifest.webmanifest"); expect(manifest.status).toBe(200);
    const identity = await manifest.json(); expect(identity.name).toBe(name); expect(identity.icons.every((icon: {src: string}) => icon.src.startsWith(member.body.next + "/icons/"))).toBe(true);
  } finally {await tenantContext.close();}
  expect(errors).toEqual([]);
});

test("a rejected EmailJS send displays its error and retries the same saved company", async ({page, context}) => {
  test.skip(process.env.QUOTEFORGE_RUN_INVITATION_TESTS !== "true", "Requires isolated emulators and fake-only EmailJS.");
  test.setTimeout(60000);
  const owner = await createGoogleSession("owner@example.com"); await authenticate(context, owner.cookie);
  const email = `retry-${randomUUID().slice(0, 8)}@example.com`;
  await page.goto("/create-company"); await page.getByLabel("Company name", {exact: false}).fill("Retry QA Company");
  for (let step = 0; step < 3; step++) await page.locator(".wizard-footer").getByRole("button", {name: "Next", exact: true}).click();
  await page.getByLabel("Customer Email Address", {exact: false}).fill(email);
  const mode = (value: string) => fetch("http://127.0.0.1:9444/mode", {method: "POST", body: value});
  let companyId = "", operationId = "";
  try {
    await mode("reject");
    const failed = page.waitForResponse(response => response.url().endsWith("/api/invitations") && response.request().method() === "POST");
    await page.getByRole("button", {name: "Create Company & Send Invitation", exact: true}).click();
    const rejected = await failed; expect(rejected.status()).toBe(503);
    const request = rejected.request().postDataJSON(); companyId = request.companyId; operationId = request.idempotencyKey;
    await expect(page.locator(".wizard-error")).toContainText("provider rejected");
    let workspace = await (await owner.request("/api/workspace")).json();
    expect(workspace.companies.filter((company: {id: string}) => company.id === companyId)).toHaveLength(1);
    expect(workspace.companies.find((company: {id: string}) => company.id === companyId).status).toBe("Draft");
    await mode("ok"); await page.waitForTimeout(1200);
    const sending = page.waitForResponse(response => response.url().endsWith("/api/invitations") && response.request().method() === "POST");
    await page.getByRole("button", {name: "Create Company & Send Invitation", exact: true}).click();
    const sent = await sending; expect(sent.status(), await sent.text()).toBe(200);
    expect(sent.request().postDataJSON().idempotencyKey).toBe(operationId);
    await expect(page.locator(".owner-company-card").filter({hasText: "Retry QA Company"})).toContainText("Invitation sent");
    workspace = await (await owner.request("/api/workspace")).json();
    expect(workspace.companies.filter((company: {id: string}) => company.id === companyId)).toHaveLength(1);
    const messages = (await (await fetch("http://127.0.0.1:9444/messages")).json()).filter((message: {template_params: {to_email: string}}) => message.template_params.to_email === email);
    expect(messages).toHaveLength(2); expect(messages[0].template_params.invite_url).not.toBe(messages[1].template_params.invite_url);
  } finally {await mode("ok");}
});
