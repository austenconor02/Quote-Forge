"use client";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { useWorkspace } from "./workspace-provider";
import { QuoteBuilder } from "./quote-builder";
import { useEffect, useRef } from "react";
import { loadCloudDraft, sendCloudProposal, sourceFileFromCloud } from "@/lib/cloud-repository";

export function CompanyWorkspace({ companyId }: { companyId: string }) {
  const { data, ready, toast, saveDraft, saveCustomer, loadCompany, demo } = useWorkspace();
  const loader = useRef(loadCompany); loader.current = loadCompany;
  useEffect(() => {if (ready && !demo) void loader.current(companyId);}, [companyId, ready, demo]);
  const company = data.companies.find(company => company.id === companyId);
  if (!ready) return <div className="owner-loading" role="status">Loading company…</div>;
  if (!company) return <div className="company-empty"><h1>Company not found</h1><Link className="button secondary" href="/">My Companies</Link></div>;
  return <><div className="owner-workspace-heading"><Link href="/" className="owner-back-link"><ArrowLeft size={15}/>My Companies</Link><span>{company.status === "Active" ? "Owner workspace" : `${company.status} · Owner access`}</span></div><div className="full-preview-frame"><QuoteBuilder key={company.id} company={company} drafts={data.drafts.filter(draft => draft.companyId === company.id)} customers={data.customers.filter(customer => customer.companyId === company.id)} notify={toast} authenticated={!demo} saveIncludesCustomer onOpenDraft={draft => demo ? Promise.resolve(draft) : loadCloudDraft(company.id, draft.id)} loadDocumentFile={document => sourceFileFromCloud(company.id, document)} onSendProposal={demo ? undefined : quoteId => sendCloudProposal(company.id, quoteId)} onSave={saveDraft} onCustomer={saveCustomer}/></div></>;
}
