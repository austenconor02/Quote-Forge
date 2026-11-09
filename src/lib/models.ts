export type CompanyStatus = "Active" | "Draft" | "Suspended";
export type FieldType = "Text" | "Number" | "Currency" | "Date" | "Dropdown" | "Checkbox" | "Multiline text";
export type Branding = { primary: string; secondary: string; accent: string; font: string; logo: string };
export type CustomField = { id: string; label: string; type: FieldType; required: boolean; defaultValue: string; options: string[] };
export type Company = {
  id: string; name: string; industry: string; email: string; phone: string; address: string; website: string;
  status: CompanyStatus; branding: Branding; fields: CustomField[]; createdAt: string;
  origin?: "owner" | "demo"; assignedEmail?: string;
};
export type Customer = { id: string; companyId: string; name: string; email: string; phone: string; address: string };
export type LineItem = { id: string; description: string; section: string; quantity: number; unit: string; unitPrice: number; hiddenFromProposal: boolean; needsReview: boolean; sourceType?: string; confidence?: string };
export type QuoteSourceDocument = {
  id: string; name: string; size: number; mimeType: string;
  status: "pending" | "processing" | "ready" | "error";
  error?: string; progress?: number; progressLabel?: string; extractedText?: string;
  pageCount?: number; extractionMethod?: "embedded" | "ocr" | "mixed";
  sha256?: string; storagePath?: string; textStoragePath?: string; localFileAvailable?: boolean;
};
export type QuoteSourceInput = {
  pastedText: string;
  specialInstructions: string;
  documents: QuoteSourceDocument[];
};
export type Quote = {
  id: string; companyId: string; title: string; customer: Customer; lineItems: LineItem[];
  markupType: "none" | "percent" | "fixed"; markupValue: number; privateAdjustment: number; taxRate: number;
  customValues: Record<string, string | boolean>; notes: string; updatedAt: string; reviewed: boolean;
  sourceInput?: QuoteSourceInput;
};
export type Invitation = { id: string; companyId: string; email: string; status: "Prepared" | "Sent" | "Active" | "Suspended"; createdAt: string };
export type Activity = { id: string; title: string; description: string; at: string; kind: "company" | "branding" | "invite" | "quote" | "field" };
export type Workspace = { version: 1; companies: Company[]; customers: Customer[]; drafts: Quote[]; invitations: Invitation[]; activity: Activity[]; selectedCompanyId: string };

export const defaultBranding: Branding = { primary: "#173B36", secondary: "#F0F5F1", accent: "#C88B45", font: "Arial", logo: "" };
export const fieldTypes: FieldType[] = ["Text", "Number", "Currency", "Date", "Dropdown", "Checkbox", "Multiline text"];
export const newId = () => crypto.randomUUID();
export const money = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
export const initials = (name: string) => name.split(/\s+/).slice(0, 2).map(n => n[0]).join("").toUpperCase();
export function readableText(hex: string) {
  const c = hex.replace("#", "");
  const rgb = [0, 2, 4].map(i => parseInt(c.slice(i, i + 2), 16) / 255).map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722 > 0.179 ? "#102033" : "#FFFFFF";
}
