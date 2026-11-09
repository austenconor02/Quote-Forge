"use client";
import type { Customer, Quote, QuoteSourceDocument } from "./models";
import { tenantWorkspaceSchema } from "./workspace-schema";
import { getDocumentFile } from "./documents/local-files";

export async function cloudRequest(path: string, init?: RequestInit) {
  const response = await fetch(path, {credentials: "same-origin", cache: "no-store", ...init});
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || "The request could not be completed. Your entered work has been kept.");
  return value;
}
export async function saveCloudCustomer(customer: Customer): Promise<Customer> {
  const {record} = await cloudRequest(`/api/tenants/${customer.companyId}/customers`, {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(customer)});
  return record;
}
export async function loadCloudDraft(companyId: string, id: string): Promise<Quote> {
  const {record} = await cloudRequest(`/api/tenants/${encodeURIComponent(companyId)}/drafts?recordId=${encodeURIComponent(id)}`);
  return record;
}
export async function sendCloudProposal(companyId: string, quoteId: string): Promise<void> {
  const result = await cloudRequest(`/api/tenants/${encodeURIComponent(companyId)}/proposals/send`, {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({quoteId})});
  if (result.delivered !== true) throw new Error("Proposal delivery could not be confirmed. Check the delivery status before trying again.");
}
export async function loadCloudTenantWorkspace(companyId: string) {
  const initial = await cloudRequest(`/api/tenants/${encodeURIComponent(companyId)}/workspace`);
  const workspace = tenantWorkspaceSchema.parse(initial);
  let total = new TextEncoder().encode(JSON.stringify(workspace)).byteLength;
  for (const resource of ["drafts", "customers"] as const) {
    let cursor = typeof initial.cursors?.[resource] === "string" ? initial.cursors[resource] : null;
    const seen = new Set<string>();
    while (cursor) {
      if (seen.has(cursor)) throw new Error("The server returned an invalid record cursor. Existing work has been kept.");
      seen.add(cursor);
      const page = await cloudRequest(`/api/tenants/${encodeURIComponent(companyId)}/${resource}?cursor=${encodeURIComponent(cursor)}`);
      total += new TextEncoder().encode(JSON.stringify(page.records)).byteLength;
      if (total > 8 * 1024 * 1024) throw new Error("The company record list exceeds the 8 MB view limit. Use a paginated export to manage this workspace.");
      if (!Array.isArray(page.records)) throw new Error("The server returned an invalid record list.");
      workspace[resource].push(...page.records);
      cursor = typeof page.nextCursor === "string" ? page.nextCursor : null;
    }
  }
  return tenantWorkspaceSchema.parse(workspace);
}
export async function sourceFileFromCloud(companyId: string, document: QuoteSourceDocument): Promise<File | undefined> {
  if (!document.storagePath) return undefined;
  const response = await fetch(`/api/tenants/${companyId}/documents/${document.id}`, {credentials: "same-origin", cache: "no-store"});
  if (!response.ok) throw new Error("This source document could not be downloaded. Check your company access and try again.");
  return new File([await response.blob()], document.name, {type: document.mimeType});
}
export async function saveCloudDraft(quote: Quote): Promise<Quote> {
  const documents: QuoteSourceDocument[] = [];
  for (const document of quote.sourceInput?.documents || []) {
    if (document.status === "processing" || document.status === "pending") throw new Error(`Wait for ${document.name} to finish processing before saving to the cloud.`);
    if (document.storagePath) {documents.push(document); continue;}
    const file = await getDocumentFile(document.id);
    if (!file) throw new Error(`Reselect ${document.name} before saving. Its source file is not available in this browser.`);
    const {document: uploaded} = await cloudRequest(`/api/tenants/${quote.companyId}/documents/${document.id}`, {method: "POST", headers: {"Content-Type": file.type || "application/octet-stream", "x-file-name": encodeURIComponent(document.name)}, body: file});
    documents.push({...document, name: uploaded.name, mimeType: uploaded.mimeType, size: uploaded.size, storagePath: uploaded.storagePath, sha256: uploaded.sha256});
  }
  const ready = {...quote, ...(quote.sourceInput ? {sourceInput: {...quote.sourceInput, documents}} : {})};
  const {record} = await cloudRequest(`/api/tenants/${quote.companyId}/drafts`, {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(ready)});
  return record;
}
