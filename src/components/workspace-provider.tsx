"use client";

import { createContext, useContext, useCallback, useEffect, useRef, useState, ReactNode } from "react";
import { Activity, Company, Customer, Quote, Workspace, newId, companyProfile } from "@/lib/models";
import { tenantWorkspaceSchema, workspaceSchema } from "@/lib/workspace-schema";
import { createEmptyWorkspace, loadOwnerWorkspace, mergeTenantRecords, OWNER_STORAGE_KEY, TENANT_STORAGE_PREFIX } from "@/lib/workspace-storage";
import { cloudRequest, loadCloudTenantWorkspace, saveCloudCustomer, saveCloudDraft } from "@/lib/cloud-repository";
import { setDocumentCacheScope } from "@/lib/documents/local-files";

type Context = {
  data: Workspace; setData: React.Dispatch<React.SetStateAction<Workspace>>; demo: boolean;
  company: Company | null; selectCompany: (id: string) => void; updateCompany: (company: Company) => Promise<boolean>;
  saveCompany: (company: Company) => Promise<boolean>; saveDraft: (quote: Quote) => Promise<boolean>; saveCustomer: (customer: Customer) => Promise<boolean>; deleteDraft: (companyId: string, id: string) => Promise<boolean>; loadCompany: (id: string) => Promise<boolean>; refreshWorkspace: () => Promise<boolean>; canPersist: boolean; loadError: string;
  log: (title: string, description: string, kind: Activity["kind"]) => void;
  toast: (message: string) => void; ready: boolean;
};
const WorkspaceContext = createContext<Context | null>(null);
async function fetchOwnerWorkspace(): Promise<Workspace> {
  let combined = createEmptyWorkspace(); let cursor: string | null = null;
  do {
    const response = await cloudRequest("/api/workspace" + (cursor ? "?cursor=" + encodeURIComponent(cursor) : ""));
    const page = workspaceSchema.parse(response);
    combined = {...combined, companies: [...combined.companies, ...page.companies], invitations: [...combined.invitations, ...page.invitations]};
    cursor = typeof response.nextCursor === "string" ? response.nextCursor : null;
  } while (cursor);
  combined.selectedCompanyId = combined.companies[0]?.id || "";
  return combined;
}

export function WorkspaceProvider({ children, demo = true, cacheScope }: { children: ReactNode; demo?: boolean; cacheScope?: string }) {
  const [data, setData] = useState(createEmptyWorkspace);
  const dataRef = useRef(data); dataRef.current = data;
  const [ready, setReady] = useState(false);
  const [message, setMessage] = useState("");
  const [storageWritable, setStorageWritable] = useState(true);
  const [cloudAvailable, setCloudAvailable] = useState(false);
  const [loadError, setLoadError] = useState("");
  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!demo && !cacheScope) {setMessage("A verified account storage scope is required."); setReady(true); return;}
      setDocumentCacheScope(demo ? "local" : cacheScope!);
      if (demo) {
        try { if (!cancelled) setData(loadOwnerWorkspace(localStorage)); }
        catch { setStorageWritable(false); setMessage("Saved data could not be read. Existing records are preserved. Export a recovery copy from Settings before making changes."); }
      } else {
        try {
          const combined = await fetchOwnerWorkspace();
          if (!cancelled) {dataRef.current = combined; setData(combined); setCloudAvailable(true); setLoadError("");}
        } catch (error) { if (!cancelled) {const detail = error instanceof Error ? error.message : "Cloud records could not be loaded. No local records were uploaded or overwritten."; setMessage(detail); setLoadError(detail);} }
      }
      if (!cancelled) setReady(true);
    }
    void load(); return () => {cancelled = true;};
  }, [demo, cacheScope]);
  useEffect(() => {
    if (!ready || !demo || !storageWritable) return;
    try {
      localStorage.setItem(OWNER_STORAGE_KEY, JSON.stringify(data));
      data.companies.forEach(company => localStorage.setItem(TENANT_STORAGE_PREFIX + company.id, JSON.stringify({ company, drafts: data.drafts.filter(d => d.companyId === company.id), customers: data.customers.filter(c => c.companyId === company.id) })));
    } catch { setMessage("Browser storage is full. Your current changes remain in this session; export your data from Settings."); }
  }, [data, ready, demo, storageWritable]);
  useEffect(() => {
    if (!demo) return;
    const onStorage = (event: StorageEvent) => {
      if (!event.key || !event.newValue) return;
      try {
        if (event.key.startsWith(TENANT_STORAGE_PREFIX)) {
          const tenant = tenantWorkspaceSchema.parse(JSON.parse(event.newValue));
          setData(d => mergeTenantRecords(d, tenant));
        } else if (event.key === OWNER_STORAGE_KEY) {
          const incoming = workspaceSchema.parse(JSON.parse(event.newValue));
          setData(current => {
            let merged: Workspace = incoming;
            for (const company of current.companies) merged = mergeTenantRecords(merged, { company, drafts: current.drafts.filter(d => d.companyId === company.id), customers: current.customers.filter(c => c.companyId === company.id) });
            return merged;
          });
        }
      } catch { /* Invalid cross-tab data never replaces an existing workspace. */ }
    };
    window.addEventListener("storage", onStorage); return () => window.removeEventListener("storage", onStorage);
  }, [demo]);
  useEffect(() => { if (!message) return; const timer = setTimeout(() => setMessage(""), 6500); return () => clearTimeout(timer); }, [message]);
  const company = data.companies.find(c => c.id === data.selectedCompanyId) || data.companies[0] || null;
  function localSave(next: Workspace) {
    if (!ready || !storageWritable) throw new Error("Local storage is unavailable; existing records are preserved.");
    localStorage.setItem(OWNER_STORAGE_KEY, JSON.stringify(next)); dataRef.current = next; setData(next);
  }
  async function saveCompany(company: Company) {
    try {
      if (!ready || (!demo && !cloudAvailable)) throw new Error("Company records are unavailable. Reload the workspace before saving.");
      const current = dataRef.current;
      const existing = current.companies.find(record => record.id === company.id);
      const options = new URLSearchParams();
      if (existing && JSON.stringify(company.fields) !== JSON.stringify(existing.fields)) options.set("fields", "1");
      const updated: Company = demo ? {...company, origin: "owner"} : (await cloudRequest("/api/companies" + (options.size ? "?" + options.toString() : ""), {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(companyProfile(company))})).company;
      const next = {...current, selectedCompanyId: company.id, companies: current.companies.some(c => c.id === company.id) ? current.companies.map(c => c.id === company.id ? updated : c) : [...current.companies, updated]};
      if (demo) localSave(next); else {dataRef.current = next; setData(next);}
      return true;
    } catch (error) {setMessage(error instanceof Error ? error.message : "Company was not saved. Your entered changes have been kept."); return false;}
  }
  async function saveDraft(quote: Quote) {
    try {
      const saved = demo ? quote : await saveCloudDraft(quote);
      const current = dataRef.current;
      const next = {...current, drafts: [saved, ...current.drafts.filter(d => d.id !== saved.id)], customers: [saved.customer, ...current.customers.filter(c => c.id !== saved.customer.id)]};
      if (demo) localSave(next); else {dataRef.current = next; setData(next);}
      return true;
    } catch (error) {setMessage(error instanceof Error ? error.message : "The draft could not be saved. Your entered work has been kept."); return false;}
  }
  async function saveCustomer(customer: Customer) {
    try {
      const saved = demo ? customer : await saveCloudCustomer(customer);
      const current = dataRef.current; const next = {...current, customers: [saved, ...current.customers.filter(c => c.id !== saved.id)]};
      if (demo) localSave(next); else {dataRef.current = next; setData(next);}
      return true;
    } catch (error) {setMessage(error instanceof Error ? error.message : "The customer could not be saved. Your entered work has been kept."); return false;}
  }
  async function deleteDraft(companyId: string, id: string) {
    try {
      if (!demo) await cloudRequest("/api/tenants/" + encodeURIComponent(companyId) + "/drafts", {method: "DELETE", headers: {"Content-Type": "application/json"}, body: JSON.stringify({id})});
      const current = dataRef.current; const next = {...current, drafts: current.drafts.filter(d => d.id !== id || d.companyId !== companyId)};
      if (demo) localSave(next); else {dataRef.current = next; setData(next);}
      return true;
    } catch (error) {setMessage(error instanceof Error ? error.message : "The draft could not be deleted."); return false;}
  }
  const loadCompany = useCallback(async (id: string) => {
    if (demo) return true;
    try {
      const tenant = await loadCloudTenantWorkspace(id);
      const current = dataRef.current;
      const next = {...mergeTenantRecords(current.companies.some(company => company.id === id) ? current : {...current, companies: [...current.companies, tenant.company]}, tenant), companies: current.companies.some(company => company.id === id) ? current.companies.map(company => company.id === id ? tenant.company : company) : [...current.companies, tenant.company]};
      dataRef.current = next; setData(next);
      return true;
    } catch (error) {setMessage(error instanceof Error ? error.message : "Company records could not be loaded."); return false;}
  }, [demo]);
  const refreshWorkspace = useCallback(async () => {
    if (demo) return true;
    try {
      const incoming = await fetchOwnerWorkspace();
      const current = dataRef.current;
      let next = {...incoming, selectedCompanyId: incoming.companies.some(company => company.id === current.selectedCompanyId) ? current.selectedCompanyId : incoming.selectedCompanyId};
      for (const company of current.companies) next = mergeTenantRecords(next, {company, drafts: current.drafts.filter(draft => draft.companyId === company.id), customers: current.customers.filter(customer => customer.companyId === company.id)});
      dataRef.current = next; setData(next); setCloudAvailable(true); setLoadError(""); return true;
    } catch (error) {const detail = error instanceof Error ? error.message : "Cloud records could not be refreshed. Your existing view is preserved."; setLoadError(detail); setMessage(detail); return false;}
  }, [demo]);
  const value: Context = {data, setData, company, ready, demo, loadError, canPersist: ready && (demo ? storageWritable : cloudAvailable), saveCompany, saveDraft, saveCustomer, deleteDraft, loadCompany, refreshWorkspace, toast: setMessage,
    selectCompany: id => setData(d => d.companies.some(c => c.id === id) ? {...d, selectedCompanyId: id} : d),
    updateCompany: saveCompany,
    log: (title, description, kind) => setData(d => ({...d, activity: [{id: newId(), title, description, kind, at: new Date().toISOString()}, ...d.activity].slice(0, 40)}))
  };
  return <WorkspaceContext.Provider value={value}>{children}{message && <div className="toast" role="status"><span className="toast-dot"/>{message}<button aria-label="Dismiss notification" onClick={() => setMessage("")}>×</button></div>}</WorkspaceContext.Provider>;
}
export function useWorkspace() {const context = useContext(WorkspaceContext); if (!context) throw new Error("Workspace context required"); return context;}
