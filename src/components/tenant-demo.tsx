"use client";
import { useEffect, useState } from "react";
import { Company, Customer, Quote } from "@/lib/models";
import { TENANT_STORAGE_PREFIX } from "@/lib/workspace-storage";
import { QuoteBuilder } from "./quote-builder";
import { tenantWorkspaceSchema } from "@/lib/workspace-schema";
type TenantWorkspace = {company: Company; drafts: Quote[]; customers: Customer[]};
export function TenantDemo({companyId}: {companyId: string}) {
  const [workspace, setWorkspace] = useState<TenantWorkspace | null>(null);
  const [ready, setReady] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    function load() {
      let company: Company | undefined;
      let drafts: Quote[] = [];
      let customers: Customer[] = [];
      try { const raw = localStorage.getItem(TENANT_STORAGE_PREFIX + companyId); if (raw) { const data = tenantWorkspaceSchema.parse(JSON.parse(raw)); if (data.company.id === companyId) {company = data.company; drafts = data.drafts.filter(d => d.companyId === companyId && d.customer.companyId === companyId); customers = data.customers.filter(c => c.companyId === companyId);} } } catch {setMessage("The saved company workspace could not be read. Your existing records are preserved."); setReady(true); return;}
      if (company) setWorkspace({company, drafts, customers});
      setReady(true);
    }
    load(); const onStorage = (e: StorageEvent) => { if (e.key === TENANT_STORAGE_PREFIX + companyId) load(); }; window.addEventListener("storage", onStorage); return () => window.removeEventListener("storage", onStorage);
  }, [companyId]);
  useEffect(() => {if (!workspace || !ready) return; try {localStorage.setItem(TENANT_STORAGE_PREFIX + companyId, JSON.stringify(workspace));} catch {setMessage("Changes are kept for this session; browser storage is unavailable.");}}, [workspace, ready, companyId]);
  if (!ready) return <main className="setup-page"><p>Getting your workspace ready…</p></main>;
  if (!workspace) return <main className="setup-page"><h1>Company unavailable</h1><p>This company has not been created in the local workspace.</p></main>;
  if (workspace.company.status !== "Active") return <main className="setup-page"><h1>{workspace.company.name}</h1><p>{workspace.company.status === "Suspended" ? "Company access is suspended. Contact your platform owner." : "This workspace is being prepared. Contact your platform owner for access."}</p></main>;
  return <main className="standalone-page"><div className="local-preview-banner">Local company workspace · Live services are not connected</div><QuoteBuilder key={companyId} company={workspace.company} drafts={workspace.drafts} customers={workspace.customers} standalone notify={setMessage} onSave={quote => setWorkspace(w => w && ({...w, drafts: [quote, ...w.drafts.filter(d => d.id !== quote.id)]}))} onCustomer={customer => setWorkspace(w => w && ({...w, customers: [customer, ...w.customers.filter(c => c.id !== customer.id)]}))}/>{message && <div className="toast" role="status">{message}<button aria-label="Dismiss notification" onClick={() => setMessage("")}>×</button></div>}</main>;
}
