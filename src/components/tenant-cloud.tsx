"use client";
import { useEffect, useState } from "react";
import type { Company, Customer, Quote } from "@/lib/models";
import { tenantWorkspaceSchema } from "@/lib/workspace-schema";
import { loadCloudDraft, loadCloudTenantWorkspace, saveCloudCustomer, saveCloudDraft, sendCloudProposal, sourceFileFromCloud } from "@/lib/cloud-repository";
import { QuoteBuilder } from "./quote-builder";
import { setDocumentCacheScope } from "@/lib/documents/local-files";
type TenantWorkspace = {company: Company; drafts: Quote[]; customers: Customer[]};
export function TenantCloud({companyId, cacheScope}: {companyId: string; cacheScope: string}) {
  const [workspace, setWorkspace] = useState<TenantWorkspace | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  useEffect(() => {let cancelled = false; setDocumentCacheScope(cacheScope); loadCloudTenantWorkspace(companyId).then(value => {if (!cancelled) setWorkspace(value);}).catch(cause => {if (!cancelled) setError(cause instanceof Error ? cause.message : "Your company workspace could not be loaded.");}); return () => {cancelled = true;};}, [companyId, cacheScope]);
  if (error) return <main className="setup-page"><h1>Workspace unavailable</h1><p role="alert">{error}</p><a className="button secondary" href="/login" style={{marginTop: 20}}>Sign in again</a></main>;
  if (!workspace) return <main className="setup-page"><p role="status">Loading your company workspace…</p></main>;
  return <main className="standalone-page"><QuoteBuilder key={companyId} company={workspace.company} drafts={workspace.drafts} customers={workspace.customers} standalone authenticated onSendProposal={quoteId => sendCloudProposal(companyId, quoteId)} notify={setMessage} saveIncludesCustomer loadDocumentFile={document => sourceFileFromCloud(companyId, document)} onOpenDraft={draft => loadCloudDraft(companyId, draft.id)}
    onSave={async quote => {try {const saved = await saveCloudDraft(quote); setWorkspace(current => current && ({...current, drafts: [saved, ...current.drafts.filter(draft => draft.id !== saved.id)], customers: [saved.customer, ...current.customers.filter(customer => customer.id !== saved.customer.id)]})); return true;} catch (cause) {setMessage(cause instanceof Error ? cause.message : "The draft could not be saved. Your entered work remains available."); return false;}}}
    onCustomer={async customer => {try {const saved = await saveCloudCustomer(customer); setWorkspace(current => current && ({...current, customers: [saved, ...current.customers.filter(record => record.id !== saved.id)]})); return true;} catch (cause) {setMessage(cause instanceof Error ? cause.message : "Customer details could not be saved."); return false;}}}
  />{message && <div className="toast" role="status">{message}<button aria-label="Dismiss notification" onClick={() => setMessage("")}>×</button></div>}</main>;
}
