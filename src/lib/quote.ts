import { newId, type Company, type Quote } from "./models";

const cents = (value: number) => Math.round((Number.isFinite(value) ? value : 0) * 100);
export function calculateQuote(quote: Pick<Quote, "lineItems" | "markupType" | "markupValue" | "privateAdjustment" | "taxRate">) {
  const visible = quote.lineItems.filter(i => !i.hiddenFromProposal);
  const subtotalCents = visible.reduce((total, item) => total + Math.max(0, cents(Math.max(0, item.quantity) * Math.max(0, item.unitPrice))), 0);
  const markupCents = quote.markupType === "percent" ? Math.round(subtotalCents * Math.max(0, quote.markupValue) / 100) : quote.markupType === "fixed" ? Math.max(0, cents(quote.markupValue)) : 0;
  const netCents = Math.max(0, subtotalCents + markupCents + cents(quote.privateAdjustment));
  const taxCents = Math.round(netCents * Math.min(100, Math.max(0, quote.taxRate)) / 100);
  // Allocate private adjustments to displayed amounts. No private pricing fields enter PDFs.
  let allocated = 0;
  let cumulativeBase = 0;
  const items = visible.map((item, index) => {
    const base = Math.max(0, cents(Math.max(0, item.quantity) * Math.max(0, item.unitPrice)));
    cumulativeBase += base;
    const target = index === visible.length - 1 ? netCents : subtotalCents ? Math.round(cumulativeBase / subtotalCents * netCents) : Math.round((index + 1) / visible.length * netCents);
    const amount = target - allocated;
    allocated += amount;
    return { ...item, amount: amount / 100, displayUnitPrice: item.quantity ? amount / 100 / item.quantity : 0 };
  });
  return { subtotal: subtotalCents / 100, markup: markupCents / 100, net: netCents / 100, tax: taxCents / 100, total: (netCents + taxCents) / 100, items };
}

export function requiredFieldErrors(company: Company, quote: Quote) {
  return company.fields.filter(f => {
    if (!f.required) return false;
    const value = quote.customValues[f.id] ?? f.defaultValue;
    return f.type === "Checkbox" ? value !== true && value !== "true" : !String(value ?? "").trim();
  }).map(f => f.label);
}

export function emptyQuote(company: Company): Quote {
  return { id: newId(), companyId: company.id, title: "", customer: { id: newId(), companyId: company.id, name: "", email: "", phone: "", address: "" }, lineItems: [], markupType: "none", markupValue: 0, privateAdjustment: 0, taxRate: 0, customValues: Object.fromEntries(company.fields.map(field => [field.id, field.type === "Checkbox" ? field.defaultValue === "true" : field.defaultValue])), notes: "", updatedAt: new Date().toISOString(), reviewed: false };
}

export function sampleQuote(company: Company): Quote {
  return {
    id: "sample-" + company.id, companyId: company.id, title: "Residential roof replacement",
    customer: { id: "customer-" + company.id, companyId: company.id, name: "Jamie & Alex Morgan", email: "jamie@example.com", phone: "(512) 555-0142", address: "1840 Willow Creek Dr, Austin, TX 78704" },
    lineItems: [
      { id: "sample-1", section: "Roofing & Exterior Work", description: "Architectural shingles · supply & install", quantity: 28, unit: "SQ", unitPrice: 285, hiddenFromProposal: false, needsReview: false, sourceType: "demo fixture", confidence: "high" },
      { id: "sample-2", section: "Roofing & Exterior Work", description: "Synthetic underlayment & ice barrier", quantity: 28, unit: "SQ", unitPrice: 42, hiddenFromProposal: false, needsReview: false, sourceType: "demo fixture", confidence: "high" },
      { id: "sample-3", section: "Gutters & Drainage", description: "Seamless aluminum gutters", quantity: 160, unit: "LF", unitPrice: 8.5, hiddenFromProposal: false, needsReview: false, sourceType: "demo fixture", confidence: "high" },
      { id: "sample-4", section: "Permits, Cleanup & Project Costs", description: "Debris removal & site cleanup", quantity: 1, unit: "EA", unitPrice: 450, hiddenFromProposal: false, needsReview: false, sourceType: "demo fixture", confidence: "high" }
    ],
    markupType: "percent", markupValue: 12, privateAdjustment: 0, taxRate: 0,
    customValues: Object.fromEntries(company.fields.map(f => [f.id, f.type === "Checkbox" ? f.defaultValue === "true" : f.defaultValue])),
    notes: "Thank you for the opportunity to earn your business. This proposal is valid for 30 days. Work includes materials, installation, and final site cleanup.",
    updatedAt: "2026-11-08T15:00:00Z", reviewed: false
  };
}
