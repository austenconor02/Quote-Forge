"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Plus, Search, ArrowUpRight, Pencil, Mail, Power, Building2, X } from "lucide-react";
import type { Company } from "@/lib/models";
import { useWorkspace } from "./workspace-provider";
import { CompanyLogo, Modal } from "./ui";

export function MyCompanies() {
  const router = useRouter();
  const { data, ready, saveCompany, toast, demo, refreshWorkspace, loadError } = useWorkspace();
  const [search, setSearch] = useState("");
  const [accessChange, setAccessChange] = useState<Company | null>(null);
  const [deliveryError, setDeliveryError] = useState("");
  const [sending, setSending] = useState<string | null>(null);
  const [changingAccess, setChangingAccess] = useState(false);
  const companies = data.companies.filter(company => company.origin !== "demo" && `${company.name} ${company.assignedEmail || ""} ${data.invitations.filter(i => i.companyId === company.id).map(i => i.email).join(" ")}`.toLowerCase().includes(search.toLowerCase()));
  async function resend(company: Company) {
    setSending(company.id); setDeliveryError("");
    const email = company.assignedEmail || data.invitations.find(i => i.companyId === company.id && i.status !== "Suspended")?.email;
    if (!email) { router.push(`/companies/${company.id}/edit?step=3`); setSending(null); return; }
    try {
      const response = await fetch("/api/invitations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ companyId: company.id, email, action: "resend" }) });
      const result = await response.json();
      if (!response.ok || result.delivered !== true) throw new Error(result.error || "The email service has not confirmed delivery. No invitation was marked as sent.");
      await refreshWorkspace();
      toast("The email service confirmed the invitation was sent.");
    } catch (error) { setDeliveryError(error instanceof Error ? error.message : "Invitation delivery failed. No invitation was marked as sent."); }
    finally { setSending(null); }
  }
  async function applyAccessChange() {
    if (!accessChange || changingAccess) return;
    setChangingAccess(true);
    try {
      const assigned = !!accessChange.assignedEmail || data.invitations.some(invitation => invitation.companyId === accessChange.id && invitation.status === "Active");
      const status = accessChange.status === "Suspended" ? assigned ? "Active" : "Draft" : "Suspended";
      if (demo) {if (!await saveCompany({...accessChange, status})) return;}
      else {
        const response = await fetch(`/api/companies/${accessChange.id}/access`, {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({action: accessChange.status === "Suspended" ? "reactivate" : "suspend"})});
        const result = await response.json(); if (!response.ok) throw new Error(result.error || "Access could not be updated.");
        await refreshWorkspace();
      }
      toast(`Company ${status === "Suspended" ? "deactivated" : "reactivated"}. Existing records were preserved.`); setAccessChange(null);
    } catch (error) {setDeliveryError(error instanceof Error ? error.message : "Access could not be updated.");}
    finally {setChangingAccess(false);}
  }
  return <div className="company-home"><div className="owner-page-title"><h1>My Companies</h1><Link href="/create-company" className="button primary" data-tutorial="create-company"><Plus size={17}/>Create Company</Link></div>
    {!ready ? <div className="owner-loading" role="status">Loading companies…</div> : <>
      {loadError && <div className="owner-inline-error" role="alert">{loadError}<button className="button secondary small" onClick={() => void refreshWorkspace()}>Retry</button></div>}
      {data.companies.length > 0 && <label className="owner-company-search"><Search size={17}/><input type="search" placeholder="Search companies" aria-label="Search companies" value={search} onChange={event => setSearch(event.target.value)}/>{search && <button className="icon-button" type="button" aria-label="Clear search" onClick={() => setSearch("")}><X size={14}/></button>}</label>}
      {deliveryError && <div className="owner-inline-error" role="alert"><Mail size={16}/><span>{deliveryError}</span><button className="icon-button" onClick={() => setDeliveryError("")} aria-label="Dismiss invitation error"><X size={15}/></button></div>}
      {!data.companies.length ? <div className="company-empty"><Building2 size={31}/><h2>No companies yet</h2><Link href="/create-company" className="button secondary"><Plus size={16}/>Create Company</Link></div> : !companies.length ? <div className="company-empty search-empty"><h2>No companies found</h2><button className="button secondary" onClick={() => setSearch("")}>Clear search</button></div> : <div className="owner-company-grid">{companies.map(company => {
        const invitation = data.invitations.find(i => i.companyId === company.id && i.status === "Active") || data.invitations.find(i => i.companyId === company.id && i.status === "Sent") || data.invitations.find(i => i.companyId === company.id && i.status === "Prepared");
        const assignedEmail = company.assignedEmail || invitation?.email;
        const access = company.status === "Suspended" ? "Deactivated" : invitation?.status === "Active" ? "Account active" : invitation?.status === "Sent" ? "Invitation sent" : invitation ? "Invitation not sent" : assignedEmail ? "Assignment pending" : "Unassigned draft";
        return <article className="owner-company-card" key={company.id} onClick={event => { if (!(event.target as HTMLElement).closest("a,button,summary,details")) router.push(`/companies/${company.id}/edit`); }}>
          <Link className="owner-company-identity" href={`/companies/${company.id}/edit`} aria-label={`Edit ${company.name}`}><CompanyLogo company={company} size="large"/><h2>{company.name}</h2></Link>
          <dl className="owner-company-details"><div><dt>Assigned email</dt><dd>{assignedEmail || "Not assigned"}</dd></div><div><dt>Access</dt><dd><span className={`owner-access-status ${company.status === "Suspended" ? "inactive" : invitation?.status === "Active" ? "active" : "draft"}`}><span/>{access}</span></dd></div><div><dt>Created</dt><dd><time dateTime={company.createdAt}>{new Date(company.createdAt).toLocaleDateString("en-US", {month: "short", day: "numeric", year: "numeric", timeZone: "America/Chicago"})}</time></dd></div></dl>
          <div className="owner-company-buttons"><Link className="button secondary" href={`/companies/${company.id}/edit`}><Pencil size={14}/>Edit</Link><Link className="button owner-open-button" href={`/companies/${company.id}/open`}>Open Company<ArrowUpRight size={14}/></Link></div>
          <div className="owner-company-more"><button type="button" disabled={sending === company.id} onClick={() => void resend(company)}><Mail size={13}/>{sending === company.id ? "Checking delivery…" : "Resend Invitation"}</button><button type="button" onClick={() => setAccessChange(company)}><Power size={13}/>{company.status === "Suspended" ? "Reactivate" : "Deactivate"}</button></div>
        </article>;
      })}</div>}
    </>}
    {accessChange && <Modal title={accessChange.status === "Suspended" ? "Reactivate company?" : "Deactivate company?"} onClose={() => setAccessChange(null)}><p>{accessChange.status === "Suspended" ? `Restore company access for ${accessChange.name}. Unassigned companies remain drafts until an invitation is successfully sent.` : `Suspend access for ${accessChange.name}. Existing customers, quotes, and drafts will be kept.`}</p><p className="owner-local-note">{demo ? "This updates local workspace access. Live Firebase account changes require the independent integration." : "This changes server-enforced access. Deactivation immediately blocks company requests and revokes existing user sessions."}</p><div className="form-actions"><button className="button secondary" disabled={changingAccess} onClick={() => setAccessChange(null)}>Cancel</button><button className="button primary" disabled={changingAccess} onClick={() => void applyAccessChange()}>{changingAccess ? "Updating…" : accessChange.status === "Suspended" ? "Reactivate" : "Deactivate"}</button></div></Modal>}
  </div>;
}
