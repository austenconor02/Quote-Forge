import "server-only";
import sharp from "sharp";
import { Company } from "../models";
import { readTenantCompany } from "./tenant-repository";
import { requireTenant, AccessError } from "./auth";

export async function installedCompany(companyId: string): Promise<Company> {
  const session = await requireTenant(companyId);
  if (session.demo) throw new AccessError(409, "Local company branding is stored in this browser. Connect private logo storage before enabling installation metadata.");
  const company = await readTenantCompany(companyId);
  if (!company || company.status !== "Active") throw new AccessError(404, "Active company not found.");
  if (!company.branding.logo) throw new AccessError(409, "Upload and save the company logo before enabling installation.");
  return company;
}
export async function tenantIcon(company: Company, size: 192 | 512) {
  // Accept stored image bytes only. Never fetch arbitrary caller-controlled image URLs.
  if (!/^data:image\/(png|jpeg|webp);base64,/.test(company.branding.logo)) throw new AccessError(409, "A stored company logo is required.");
  const bytes = Buffer.from(company.branding.logo.split(",")[1], "base64");
  if (bytes.length > 4 * 1024 * 1024) throw new AccessError(400, "Logo is too large.");
  const inset = Math.round(size * .15);
  const innerSize = size - inset * 2;
  const logo = await sharp(bytes, {limitInputPixels: 16000000}).resize(innerSize, innerSize, {fit: "contain", background: "transparent"}).png().toBuffer();
  return sharp({create: {width: size, height: size, channels: 4, background: company.branding.secondary}}).composite([{input: logo, left: inset, top: inset}]).png().toBuffer();
}
