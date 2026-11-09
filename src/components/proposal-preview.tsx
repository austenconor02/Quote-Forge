"use client";
import { CSSProperties, useEffect, useState } from "react";
import { Download, LoaderCircle } from "lucide-react";
import { Company, Quote, money, readableText } from "@/lib/models";
import { calculateQuote } from "@/lib/quote";
import { createProposalPdf, formatProposalUnitPrice, proposalReference } from "@/lib/pdf";

export function themeStyle(company: Company): CSSProperties {
  return { "--tenant-primary": company.branding.primary, "--tenant-secondary": company.branding.secondary, "--tenant-accent": company.branding.accent, "--tenant-on-primary": readableText(company.branding.primary), "--tenant-on-secondary": readableText(company.branding.secondary), "--tenant-on-accent": readableText(company.branding.accent), fontFamily: `${company.branding.font}, sans-serif` } as CSSProperties;
}
export function ProposalDocument({ company, quote, miniature = false }: { company: Company; quote: Quote; miniature?: boolean }) {
  const totals = calculateQuote(quote);
  const reference = proposalReference(quote);
  return <div className={`proposal-document proposal-letter ${miniature ? "miniature" : ""}`} style={themeStyle(company)}>
    <header className="proposal-top-banner">
      {company.branding.logo && <div className="proposal-logo-pane"><img src={company.branding.logo} alt={`${company.name} logo`}/></div>}
      <div><strong>{company.name}</strong><span>Project Proposal</span></div>
    </header>
    <div className="proposal-inner">
      <div className="proposal-prepared-grid"><div className="proposal-customer"><span>Prepared For</span><strong>{quote.customer.name || "Customer"}</strong><p>{quote.customer.address}{quote.customer.address && <br/>}{[quote.customer.email, quote.customer.phone].filter(Boolean).join(" · ")}</p></div><dl className="proposal-reference"><div><dt>Proposal #:</dt><dd>{reference.number}</dd></div><div><dt>Date:</dt><dd>{reference.date}</dd></div></dl></div>
      {quote.title && <h2 className="proposal-project-title">{quote.title}</h2>}
      {company.fields.length > 0 && <dl className="proposal-custom">{company.fields.map(field => {
        const value = quote.customValues[field.id] ?? field.defaultValue;
        return value !== "" && value !== undefined ? <div key={field.id}><dt>{field.label}</dt><dd>{field.type === "Checkbox" ? value === true || value === "true" ? "Yes" : "No" : String(value)}</dd></div> : null;
      })}</dl>}
      <div className="proposal-rule"/><h2 className="proposal-scope-heading">Detailed Scope of Work</h2>
      <div className="proposal-sections">{[...new Set(totals.items.map(item => item.section || "Scope Items"))].map(section => {
        const items = totals.items.filter(item => (item.section || "Scope Items") === section);
        return <section key={section}><h3>{section}</h3><div className="proposal-line-head"><span>Description</span><span>Qty</span><span>Unit Price</span><span>Amount</span></div>{items.map(item => <div className="proposal-line" key={item.id}><span>{item.description || "Line item"}</span><span>{item.quantity} {item.unit}</span><span>{formatProposalUnitPrice(item)}</span><strong>{money(item.amount)}</strong></div>)}<div className="proposal-section-subtotal"><strong>Section Subtotal</strong><span>{money(items.reduce((total, item) => total + item.amount, 0))}</span></div></section>;
      })}{!totals.items.length && <p className="proposal-no-items">No scope items have been added.</p>}</div>
      <div className="proposal-totals"><div><span>Subtotal</span><span>{money(totals.net)}</span></div><div><span>Tax ({quote.taxRate}%)</span><span>{money(totals.tax)}</span></div><div className="proposal-grand-total"><strong>Total</strong><strong>{money(totals.total)}</strong></div></div>
      <section className="proposal-public-notes"><h3>Notes</h3><p>{quote.notes || "\u00a0"}</p></section>
      <section className="proposal-approval"><h3>Customer Approval</h3><div><p>By signing below, customer approves the project proposal described above.</p><div className="proposal-signature"><span>Signature:<i/></span><span>Date:<i/></span></div></div></section>
      <footer className="proposal-footer"><span>{[company.name, company.address, company.phone, company.email, company.website].filter(Boolean).join(" · ")}</span><span>Page 1</span></footer>
    </div>
  </div>;
}
export function ActualPdfPreview({ company, quote }: { company: Company; quote: Quote }) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    let objectUrl = "";
    setUrl(""); setError("");
    const timer = setTimeout(() => {
      try { objectUrl = URL.createObjectURL(createProposalPdf(company, quote).output("blob")); setUrl(objectUrl); }
      catch { setError("PDF could not be generated. Check the company logo and proposal details."); }
    }, 200);
    return () => { clearTimeout(timer); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [company, quote]);
  return <div className="actual-pdf">{error ? <p role="alert" className="form-error">{error}</p> : url ? <><iframe title="Live branded proposal PDF" src={`${url}#toolbar=0`}/><a className="button secondary small" download={`${company.id}-proposal.pdf`} href={url}><Download size={15}/>Download this PDF</a></> : <div className="pdf-loading"><LoaderCircle className="spin" size={24}/>Preparing your PDF…</div>}</div>;
}
