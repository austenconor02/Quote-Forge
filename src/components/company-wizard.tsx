"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, ChevronDown, ExternalLink, FileText, LoaderCircle, Monitor, Pipette, Save, Send, Smartphone } from "lucide-react";
import { Company, defaultBranding, newId, companyProfile } from "@/lib/models";
import { colorsFromLogo } from "@/lib/logo-palette";
import { sampleQuote } from "@/lib/quote";
import { useWorkspace } from "./workspace-provider";
import { LogoUpload } from "./logo-upload";
import { CompanyLogo } from "./ui";
import { ActualPdfPreview, themeStyle } from "./proposal-preview";
import { QuoteBuilder } from "./quote-builder";
import { useIntegrationStatus } from "./use-integration-status";

const steps = ["Company & Logo", "Choose Colors", "Preview Application", "Assign & Send"];
type ColorKey = "primary" | "secondary" | "accent";
const colorLabels: { key: ColorKey; label: string }[] = [{ key: "primary", label: "Primary" }, { key: "secondary", label: "Secondary" }, { key: "accent", label: "Accent" }];
const emailValid = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const boundedStep = (value: number) => Number.isFinite(value) ? Math.max(0, Math.min(3, Math.trunc(value))) : 0;

export function CompanyWizard({ companyId, initialStep = 0 }: { companyId?: string; initialStep?: number }) {
  const router = useRouter();
  const { data, setData, saveCompany, ready, toast, demo, refreshWorkspace } = useWorkspace();
  const integrations = useIntegrationStatus();
  const [draft, setDraft] = useState<Company | null>(null);
  const [step, setStep] = useState(companyId ? boundedStep(initialStep) : 0);
  const [preview, setPreview] = useState("desktop");
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [hexInputs, setHexInputs] = useState<Partial<Record<ColorKey, string>>>({});
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [sampleTarget, setSampleTarget] = useState<ColorKey>("primary");
  const [notFound, setNotFound] = useState(false);
  const initialized = useRef(false);
  const invitationOperation = useRef(newId());
  const nameRef = useRef<HTMLInputElement>(null);
  const draftRef = useRef(draft);
  const stepRef = useRef(step);
  draftRef.current = draft;
  stepRef.current = step;
  const assigned = useMemo(() => companyId ? data.invitations.find(invitation => invitation.companyId === companyId && invitation.status === "Active") || data.invitations.find(invitation => invitation.companyId === companyId && invitation.status === "Sent") || data.invitations.find(invitation => invitation.companyId === companyId && invitation.status === "Prepared") : undefined, [data.invitations, companyId]);
  const latestCompany = companyId ? data.companies.find(company => company.id === companyId) : undefined;
  const currentAssignedEmail = latestCompany?.assignedEmail || assigned?.email || "";
  const activeAssignment = companyId ? data.invitations.some(invitation => invitation.companyId === companyId && invitation.status === "Active") || !!latestCompany?.assignedEmail : false;
  const previewQuote = useMemo(() => draft ? sampleQuote(draft) : null, [draft]);

  useEffect(() => {
    if (!ready || initialized.current) return;
    initialized.current = true;
    const existing = companyId ? data.companies.find(company => company.id === companyId) : undefined;
    if (companyId && !existing) { setNotFound(true); return; }
    const initial: Company = existing ? structuredClone(existing) : {
      id: `company-${newId()}`, name: "", industry: "", email: "", phone: "", address: "", website: "", status: "Draft",
      branding: { ...defaultBranding, primary: "#122239", secondary: "#F5F7FA", accent: "#EE7D3B" }, fields: [], createdAt: new Date().toISOString(), origin: "owner"
    };
    setDraft(initial);
    setEmail(existing?.assignedEmail || assigned?.email || "");
  }, [ready, companyId, data.companies, assigned]);

  useEffect(() => {
    let cancelled = false;
    if (!draft?.branding.logo) { setSuggestions([]); return; }
    colorsFromLogo(draft.branding.logo).then(colors => { if (!cancelled) setSuggestions(colors); }).catch(() => { if (!cancelled) setSuggestions([]); });
    return () => { cancelled = true; };
  }, [draft?.branding.logo]);

  const goToStep = useCallback((requested: number) => {
    const next = boundedStep(requested);
    if (next > 0 && !draftRef.current?.name.trim()) {
      setError("Enter the company name to continue.");
      setStep(0);
      nameRef.current?.focus();
      window.dispatchEvent(new CustomEvent("quoteforge:wizard-step-changed", { detail: { step: 0, blocked: true } }));
      return;
    }
    if (next > stepRef.current && Object.values(hexInputs).some(value => value !== undefined && !/^#[0-9a-f]{6}$/i.test(value))) {
      setError("Enter valid six-digit HEX colors to continue.");
      window.dispatchEvent(new CustomEvent("quoteforge:wizard-step-changed", { detail: { step: stepRef.current, blocked: true } }));
      return;
    }
    setError("");
    setStep(next);
    window.dispatchEvent(new CustomEvent("quoteforge:wizard-step-changed", { detail: { step: next } }));
  }, [hexInputs]);

  useEffect(() => {
    const tutorialRequest = (event: Event) => { const detail = (event as CustomEvent<{ wizardStep?: number }>).detail; if (typeof detail?.wizardStep === "number") goToStep(detail.wizardStep); };
    const wizardRequest = (event: Event) => { const detail = (event as CustomEvent<{ step?: number }>).detail; if (typeof detail?.step === "number") goToStep(detail.step); };
    window.addEventListener("quoteforge:tutorial-step", tutorialRequest);
    window.addEventListener("quoteforge:wizard-step", wizardRequest);
    return () => { window.removeEventListener("quoteforge:tutorial-step", tutorialRequest); window.removeEventListener("quoteforge:wizard-step", wizardRequest); };
  }, [goToStep]);

  function updateDetails(key: keyof Company, value: string) { setDraft(current => current && ({ ...current, [key]: value })); }
  function updateColor(key: ColorKey, value: string) {
    if (/^#[0-9a-f]{6}$/i.test(value)) {
      setDraft(current => current && ({ ...current, branding: { ...current.branding, [key]: value.toUpperCase() } }));
      setHexInputs(inputs => { const next = { ...inputs }; delete next[key]; return next; });
    } else setHexInputs(inputs => ({ ...inputs, [key]: value }));
  }
  async function sampleColor(key: ColorKey) {
    setSampleTarget(key);
    const EyeDropper = (window as unknown as { EyeDropper?: new () => { open: () => Promise<{ sRGBHex: string }> } }).EyeDropper;
    if (!EyeDropper) { toast("Select a suggested logo color below, or use the color picker. Screen sampling is available in Chrome and Edge."); return; }
    try { updateColor(key, (await new EyeDropper().open()).sRGBHex); } catch { /* Dismissing the native sampler keeps the current color. */ }
  }
  function validate() {
    const fail = (message: string, target: number) => {setError(message); setStep(target); window.dispatchEvent(new CustomEvent("quoteforge:wizard-step-changed", {detail: {step: target, blocked: true}})); return false;};
    if (!draft?.name.trim()) return fail("Enter the company name.", 0);
    if (Object.values(hexInputs).some(value => value !== undefined && !/^#[0-9a-f]{6}$/i.test(value))) return fail("Enter valid six-digit HEX colors.", 1);
    if (draft.email && !emailValid(draft.email)) return fail("Enter a valid contact email in Additional Details.", 0);
    if (draft.website) { try { const url = new URL(draft.website); if (!["http:", "https:"].includes(url.protocol)) throw new Error(); } catch { return fail("Enter a website beginning with https:// or http://.", 0); } }
    return true;
  }
  function profileWithLatestSettings(): Company {
    const latest = data.companies.find(company => company.id === draft?.id);
    return { ...(latest || draft!), name: draft!.name.trim(), industry: draft!.industry, email: draft!.email, phone: draft!.phone, address: draft!.address, website: draft!.website, branding: draft!.branding, origin: "owner", status: latest?.status || "Draft", assignedEmail: latest?.assignedEmail };
  }
  async function saveLocally() {
    if (!draft || busy || !validate()) return;
    if (activeAssignment && email.trim().toLowerCase() !== currentAssignedEmail.toLowerCase()) { setError("This company has active access. Its assigned email can change only after the server securely revokes or reassigns that account. Keep the current email to save branding changes."); return; }
    const company = profileWithLatestSettings();
    setBusy(true);
    try {
      if (!await saveCompany(company)) return;
      window.dispatchEvent(new CustomEvent("quoteforge:company-saved"));
      toast(companyId ? "Company changes saved. Existing records and access are unchanged." : "Company saved as an unassigned draft. No invitation was sent.");
      router.push("/");
    } finally {setBusy(false);}
  }
  async function send() {
    if (!draft || busy || !validate()) return;
    const normalizedEmail = email.trim().toLowerCase();
    if (!emailValid(normalizedEmail)) { setError("Enter a valid Customer Email Address."); return; }
    const reassigning = activeAssignment && normalizedEmail !== currentAssignedEmail.toLowerCase();
    if (reassigning && demo) { setError("Secure reassignment requires the cloud workspace. Existing access has not changed."); return; }
    if (reassigning && !window.confirm("Revoke the existing company user's access and send an invitation to the new email? Existing quotes and customers will be kept.")) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/invitations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ companyId: draft.id, company: companyProfile(profileWithLatestSettings()), email: normalizedEmail, action: reassigning ? "reassign" : "create", idempotencyKey: invitationOperation.current }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "The invitation service is unavailable. Save this company as an unassigned draft.");
      // Delivery and repository persistence must both be confirmed by the server.
      if (result.delivered !== true || result.companySaved !== true || typeof result.invitationId !== "string") throw new Error("The server did not confirm both company creation and email delivery. No invitation success can be confirmed. Save as a draft or retry after checking the service.");
      if (demo) {
        const company: Company = {...profileWithLatestSettings(), status: "Active", assignedEmail: normalizedEmail};
        if (!await saveCompany(company)) return;
        setData(current => ({...current, invitations: [...current.invitations.filter(invitation => invitation.companyId !== company.id || invitation.status !== "Prepared"), {id: result.invitationId, companyId: company.id, email: normalizedEmail, status: "Sent", createdAt: new Date().toISOString()}]}));
      } else if (!await refreshWorkspace()) {toast("The invitation was sent. Reload My Companies to see the latest saved settings."); router.push("/"); return;}
      window.dispatchEvent(new CustomEvent("quoteforge:company-saved"));
      toast("Company saved and invitation email delivery confirmed.");
      router.push("/");
    } catch (cause) { if (!demo) await refreshWorkspace(); setError(cause instanceof Error ? cause.message : "The invitation could not be sent. Save as an unassigned draft and try again later."); }
    finally { setBusy(false); }
  }

  if (!ready || !draft && !notFound) return <div className="wizard-loading"><LoaderCircle className="spin" size={20}/>Loading company setup…</div>;
  if (notFound || !draft || !previewQuote) return <div className="wizard-not-found"><h1>Company not found</h1><Link className="button secondary" href="/">My Companies</Link></div>;
  return <div className="company-wizard" data-wizard-step={step}>
    <div className="wizard-heading"><Link href="/" className="wizard-back"><ArrowLeft size={15}/>My Companies</Link><h1>{companyId ? "Edit Company" : "Create Company"}</h1></div>
    <ol className="company-wizard-steps" aria-label="Company setup steps">{steps.map((title, index) => <li key={title} className={step === index ? "current" : index < step ? "complete" : ""}><button type="button" aria-current={step === index ? "step" : undefined} onClick={() => goToStep(index)}><span>{index < step ? <Check size={14}/> : index + 1}</span><strong>{title}</strong></button></li>)}</ol>
    <div>
      {step === 0 && <section className="wizard-section" data-tutorial="upload-logo"><header><h2>Company & Logo</h2></header><label className="wizard-company-name">Company name <b>*</b><input ref={nameRef} autoFocus required maxLength={80} placeholder="Company name" value={draft.name} onChange={event => updateDetails("name", event.target.value)}/></label><div className="wizard-logo"><h3>Company logo</h3><LogoUpload name={draft.name} value={draft.branding.logo} onChange={logo => setDraft(current => current && ({ ...current, branding: { ...current.branding, logo } }))}/></div><details className="wizard-additional"><summary>Additional Details <ChevronDown size={15}/></summary><div className="form-grid"><label>Industry<input maxLength={80} value={draft.industry} onChange={event => updateDetails("industry", event.target.value)} placeholder="Optional"/></label><label>Contact email<input type="email" value={draft.email} onChange={event => updateDetails("email", event.target.value)} placeholder="Optional"/></label><label>Phone<input type="tel" value={draft.phone} onChange={event => updateDetails("phone", event.target.value)} placeholder="Optional"/></label><label>Website<input type="url" value={draft.website} onChange={event => updateDetails("website", event.target.value)} placeholder="https://"/></label><label className="span-2">Address<input value={draft.address} onChange={event => updateDetails("address", event.target.value)} placeholder="Optional"/></label></div></details></section>}
      {step === 1 && <section className="wizard-section wizard-colors" data-tutorial="choose-colors"><header><h2>Choose Colors</h2></header><div className="wizard-color-layout"><div><div className="wizard-color-list">{colorLabels.map(({ key, label }) => <div className="wizard-color-row" key={key}><label htmlFor={`wizard-${key}-hex`}>{label}</label><input type="color" value={draft.branding[key]} aria-label={`${label} color picker`} onChange={event => updateColor(key, event.target.value)}/><input id={`wizard-${key}-hex`} value={hexInputs[key] ?? draft.branding[key]} aria-label={`${label} HEX`} maxLength={7} spellCheck={false} onChange={event => updateColor(key, event.target.value)}/><button type="button" className="icon-button" aria-label={`Sample ${label.toLowerCase()} color from logo`} onClick={() => sampleColor(key)}><Pipette size={17}/></button></div>)}</div>{suggestions.length > 0 && <div className="wizard-suggestions"><div><span>Colors from the logo</span><select aria-label="Apply suggested logo color to" value={sampleTarget} onChange={event => setSampleTarget(event.target.value as ColorKey)}>{colorLabels.map(color => <option key={color.key} value={color.key}>{color.label}</option>)}</select></div><div className="wizard-suggested-swatches">{suggestions.map(color => <button key={color} type="button" style={{ background: color }} title={color} aria-label={`Use ${color} for ${sampleTarget}`} onClick={() => updateColor(sampleTarget, color)}/>)}</div></div>}<label className="wizard-font">Font<select value={draft.branding.font} onChange={event => setDraft(current => current && ({ ...current, branding: { ...current.branding, font: event.target.value } }))}>{["Arial", "Georgia", "Trebuchet MS", "Verdana"].map(font => <option key={font}>{font}</option>)}</select></label></div><div className="wizard-theme-preview" style={themeStyle(draft)}><header><CompanyLogo company={draft}/><strong>{draft.name}</strong></header><div><span className="wizard-theme-kicker">NEW QUOTE</span><h3>Project details</h3><label>Customer / Project Name<input value="Customer name" readOnly aria-label="Color preview customer name"/></label><button type="button">Generate AI Draft <ArrowRight size={13}/></button></div><footer>Live branding preview</footer></div></div></section>}
      {step === 2 && <section className="wizard-section wizard-application-preview" data-tutorial="preview-app"><header><h2>Preview Application</h2><div className="wizard-preview-tabs" role="group" aria-label="Application preview">{[{ id: "desktop", label: "Desktop", Icon: Monitor }, { id: "mobile", label: "Mobile", Icon: Smartphone }, { id: "pdf", label: "PDF Proposal", Icon: FileText }].map(({ id, label, Icon }) => <button key={id} type="button" aria-pressed={preview === id} className={preview === id ? "active" : ""} onClick={() => setPreview(id)}><Icon size={15}/>{label}</button>)}</div></header><p className="wizard-preview-note">Preview content only. No customer, quote, or draft records are created.</p>{preview === "pdf" ? <div className="wizard-pdf-preview"><ActualPdfPreview company={draft} quote={previewQuote}/></div> : <div className={`wizard-app-canvas ${preview === "mobile" ? "show-mobile" : ""}`}><div className={preview === "mobile" ? "wizard-mobile-device" : "wizard-desktop-device"}><QuoteBuilder key={`${draft.id}-${preview}`} company={draft} drafts={[]} customers={[]} previewOnly onSave={() => toast("Preview only. No draft was saved.")} onCustomer={() => {}} notify={toast}/></div></div>}</section>}
      {step === 3 && <section className="wizard-section wizard-assign" data-tutorial="assign-email"><header><h2>Assign & Send</h2></header><div className="wizard-final-summary"><CompanyLogo company={draft} size="large"/><div><h3>{draft.name}</h3><div className="wizard-summary-colors">{colorLabels.map(({ key, label }) => <span key={key} title={`${label}: ${draft.branding[key]}`} style={{ background: draft.branding[key] }}/>)}</div></div><button type="button" className="text-link" onClick={() => goToStep(2)}>Preview application <ExternalLink size={14}/></button></div><div className="wizard-app-url"><span>Application URL</span><code>/app/{draft.id}</code>{companyId && <a href={`/app/${draft.id}`} target="_blank" rel="noreferrer" aria-label="Open company application"><ExternalLink size={15}/></a>}</div><label className="wizard-assigned-email">Customer Email Address <b>*</b><input type="email" autoComplete="email" value={email} placeholder="name@company.com" onChange={event => setEmail(event.target.value)}/></label>{activeAssignment && <p className="wizard-reassignment-note">Changing an active assignment requires verified server-side revocation. Branding can be saved while retaining the current email.</p>}<div className="wizard-integration-message" role="note"><Send size={17}/><span>{integrations.invitationsReady ? "An expiring, single-use invitation will be sent through your configured EmailJS template. Only the invited, verified Google account can accept it." : "EmailJS invitation delivery is not configured. Save an unassigned draft until the remaining email settings are configured. No invitation will be reported as sent without confirmation from the email service."}</span></div><div className="wizard-save-actions"><button type="button" onClick={() => void send()} className="button primary" disabled={busy}>{busy ? <LoaderCircle size={16} className="spin"/> : <Send size={16}/>} {companyId ? "Save Changes & Send Invitation" : "Create Company & Send Invitation"}</button><button type="button" className="button secondary" onClick={saveLocally} disabled={busy}><Save size={16}/>{companyId ? "Save Changes" : "Save unassigned draft"}</button></div></section>}
      {error && <div className="wizard-error" role="alert">{error}</div>}
      <div className="wizard-footer"><button type="button" className="button secondary" onClick={() => goToStep(step - 1)} disabled={step === 0 || busy}><ArrowLeft size={15}/>Back</button><span>Step {step + 1} of 4</span>{step < 3 ? <button type="button" className="button primary" onClick={() => { if (step === 0 && !validate()) return; goToStep(step + 1); }}>Next<ArrowRight size={15}/></button> : <Link className="wizard-cancel" href="/">Cancel</Link>}</div>
    </div>
  </div>;
}
