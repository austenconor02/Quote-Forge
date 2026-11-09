"use client";
import { useState } from "react";
import { Monitor, Smartphone, ArrowUpRight, Palette, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useWorkspace } from "./workspace-provider";
import { PageHeading, Status } from "./ui";
import { QuoteBuilder } from "./quote-builder";

export function CompanyPreview() {
  const { data, setData, company, toast, log } = useWorkspace();
  const [device, setDevice] = useState("desktop");
  if (!company) return <div className="company-empty"><h2>Select or create a company first</h2><Link className="button secondary" href="/">My Companies</Link></div>;
  return <><PageHeading eyebrow="WALK A MILE IN THEIR WORKSPACE" title="Their app. Ready for a closer look." description="Explore the same quoting experience your company users will call their own." action={<a className="button secondary" href={`/app/${company.id}`} target="_blank" rel="noreferrer">Open company app <ArrowUpRight size={16}/></a>}/><div className="company-preview-toolbar"><div><Status value={company.status}/><span className="muted">{company.name}</span><Link href="/branding" className="text-link"><Palette size={14}/>Edit branding</Link></div><div className="device-toggle"><button className={device === "desktop" ? "active" : ""} onClick={() => setDevice("desktop")} aria-label="Desktop preview"><Monitor size={17}/></button><button className={device === "mobile" ? "active" : ""} onClick={() => setDevice("mobile")} aria-label="Mobile preview"><Smartphone size={17}/></button></div></div><div className={`full-preview-canvas ${device === "mobile" ? "mobile-canvas" : ""}`}><div className={device === "mobile" ? "mobile-frame" : "full-preview-frame"}><QuoteBuilder key={company.id} company={company} drafts={data.drafts.filter(d => d.companyId === company.id)} customers={data.customers.filter(c => c.companyId === company.id)} notify={toast} onSave={quote => {setData(d => ({...d, drafts: [quote, ...d.drafts.filter(q => q.id !== quote.id)]})); log(`${company.name} saved a proposal draft`, quote.title, "quote");}} onCustomer={customer => setData(d => ({...d, customers: [customer, ...d.customers.filter(c => c.id !== customer.id)]}))}/></div></div><div className="preview-access-note"><ShieldCheck size={15}/><span>You’re seeing the company workspace. Branding and field configuration stay in your owner dashboard.</span></div></>;
}
