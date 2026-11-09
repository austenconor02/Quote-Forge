import { test, expect } from "@playwright/test";
import { jsPDF } from "jspdf";
import sharp from "sharp";
import { mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { ownerWorkspace, prepareContext, TEST_COMPANY_ID } from "./fixtures";

async function readableImage() {
  return sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1800" height="720"><rect width="1800" height="720" fill="white"/><g font-family="Arial" font-size="64" fill="black"><text x="100" y="160">PROJECT ESTIMATE</text><text x="100" y="290">Install siding 12 SQ</text><text x="100" y="420">Unit price $200.00</text><text x="100" y="550">Total $2400.00</text></g></svg>`)).png().toBuffer();
}
function embeddedPdf() {
  const pdf = new jsPDF({ unit: "pt", format: "letter" });
  pdf.setFontSize(18); pdf.text(["EMBEDDED ESTIMATE", "Replace gutters 100 LF at $8.50", "Estimate total $850.00"], 50, 90);
  return pdf;
}
test("real embedded PDFs, image OCR and scanned PDF pages preserve source names and survive reopen", async ({ page }) => {
  test.setTimeout(180000);
  const errors: string[] = []; const externalRequests: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => {if (/^https?:/.test(request.url()) && !request.url().startsWith("http://127.0.0.1:3000/")) externalRequests.push(request.url());});
  await prepareContext(page, ownerWorkspace({ records: false }));
  await page.goto(`/companies/${TEST_COMPANY_ID}/open`);
  await page.getByRole("textbox", { name: "Customer / Project Name", exact: false }).fill("Document Processing Test");
  const image = await readableImage();
  const mixed = embeddedPdf(); mixed.addPage(); mixed.text("SCANNED ESTIMATE PREPARED BY SOURCE COMPANY", 30, 25); mixed.addImage(image, "PNG", 30, 40, 550, 220);
  await page.getByLabel("Upload quote documents").setInputFiles([
    { name: "embedded-estimate.pdf", mimeType: "application/pdf", buffer: Buffer.from(embeddedPdf().output("arraybuffer")) },
    { name: "photo-estimate.png", mimeType: "image/png", buffer: image },
    { name: "mixed-scanned-estimate.pdf", mimeType: "application/pdf", buffer: Buffer.from(mixed.output("arraybuffer")) }
  ]);
  await expect(page.locator(".source-document")).toHaveCount(3);
  await expect(page.locator('.source-document[data-document-status="ready"]')).toHaveCount(3, { timeout: 150000 });
  await expect(page.getByLabel("Extracted text from embedded-estimate.pdf")).toHaveValue(/Replace gutters 100 LF at \$8\.50/);
  await expect(page.getByLabel("Extracted text from photo-estimate.png")).toHaveValue(/Install siding 12 SQ/i);
  await expect(page.getByLabel("Extracted text from mixed-scanned-estimate.pdf")).toHaveValue(/\[Page 2 · embedded text \+ OCR\][\s\S]*Install siding 12 SQ/i);
  await expect(page.getByLabel("Combined quote source text")).toHaveValue(/Source document: embedded-estimate\.pdf[\s\S]*Source document: photo-estimate\.png[\s\S]*Source document: mixed-scanned-estimate\.pdf/);
  await page.getByLabel("Extracted / Pasted Text", { exact: true }).fill("Additional email scope: cleanup included.");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await page.reload(); await page.getByRole("button", { name: /Saved drafts/ }).click(); await page.locator(".draft-list>button").first().click();
  await expect(page.locator('.source-document[data-document-status="ready"]')).toHaveCount(3);
  await expect(page.getByLabel("Combined quote source text")).toHaveValue(/Additional email scope: cleanup included/);
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download original photo-estimate.png", exact: true }).click();
  expect((await downloadPromise).suggestedFilename()).toBe("photo-estimate.png");
  await mkdir("artifacts", {recursive: true});
  await page.locator(".source-input-list").screenshot({ path: "artifacts/document-processing-ready.png" });
  await page.getByRole("button", {name: "Remove photo-estimate.png", exact: true}).click();
  await expect(page.locator(".source-document")).toHaveCount(2);
  await expect(page.getByLabel("Combined quote source text")).not.toHaveValue(/Source document: photo-estimate\.png/);
  expect(errors).toEqual([]); expect(externalRequests).toEqual([]);
});

test("invalid files remain visible, failed inputs block generation, and removing a running file cannot restore it", async ({page}) => {
  test.setTimeout(90000);
  await prepareContext(page, ownerWorkspace({records:false})); await page.goto(`/companies/${TEST_COMPANY_ID}/open`);
  await page.getByLabel("Upload quote documents").setInputFiles([
    {name:"unsupported.exe", mimeType:"application/octet-stream", buffer:Buffer.from("not a document")},
    {name:"corrupt.pdf", mimeType:"application/pdf", buffer:Buffer.from("not a readable pdf")}
  ]);
  await expect(page.locator('.source-document[data-document-status="error"]')).toHaveCount(2, {timeout:30000});
  await expect(page.getByRole("button", {name:"Generate AI Draft", exact:true})).toBeDisabled();
  await expect(page.getByText("Unsupported file. Choose", {exact:false})).toBeVisible();
  await page.getByRole("button", {name:"Remove unsupported.exe", exact:true}).click(); await page.getByRole("button", {name:"Remove corrupt.pdf", exact:true}).click();
  await page.getByLabel("Upload quote documents").setInputFiles({name:"remove-during-ocr.png", mimeType:"image/png", buffer:await readableImage()});
  await page.getByRole("button", {name:"Remove remove-during-ocr.png", exact:true}).click();
  await expect(page.locator(".source-document")).toHaveCount(0);
  await page.getByLabel("Extracted / Pasted Text", {exact:true}).fill("Pasted source remains intact.");
  await expect(page.getByRole("button", {name:"Generate AI Draft", exact:true})).toBeEnabled();
  await expect(page.getByLabel("Extracted / Pasted Text", {exact:true})).toHaveValue("Pasted source remains intact.");
});

test("official HEIC example is decoded and reaches local OCR", async ({page}) => {
  test.skip(!existsSync("artifacts/libheif-example.heic"), "Optional official libheif photographic fixture has not been downloaded.");
  test.setTimeout(120000);
  await prepareContext(page, ownerWorkspace({records:false})); await page.goto(`/companies/${TEST_COMPANY_ID}/open`);
  await page.getByLabel("Upload quote documents").setInputFiles("artifacts/libheif-example.heic");
  const row = page.locator(".source-document");
  await expect(row).toHaveAttribute("data-document-status", /ready|error/, {timeout:100000});
  if (await row.getAttribute("data-document-status") === "error") await expect(row).toContainText("No readable text was found");
  else await expect(row).toContainText("OCR");
});
