"use client";
import { useState } from "react";
import type { Company } from "@/lib/models";
import { billingSummary } from "@/lib/billing-policy";
import { useWorkspace } from "./workspace-provider";
import { Modal } from "./ui";

export function CompanyBillingControl({company, stripeReady, deliveryReady}: {company: Company; stripeReady: boolean; deliveryReady: boolean}) {
  const {refreshWorkspace, toast} = useWorkspace();
  const billing = company.billing || billingSummary();
  const [action, setAction] = useState<"enable" | "disable" | null>(null);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [portal, setPortal] = useState("");
  async function change(value: "enable" | "disable" | "checkout" | "portal") {
    if (busy) return; setBusy(true); setError("");
    try {
      const response = await fetch(`/api/companies/${company.id}/billing`, {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({action: value, ...(value === "enable" ? {billingEmail: email.trim()} : {})})});
      const result = await response.json(); if (!response.ok) throw new Error(result.error || "Billing could not be updated. No payment success was confirmed.");
      if (result.portalUrl) setPortal(result.portalUrl);
      else {toast(value === "disable" ? "Stripe cancellation confirmed. This company now has free access." : result.delivered ? "The email provider accepted the payment setup link. Paid access awaits Stripe confirmation." : "Existing subscription retained; no duplicate subscription was created."); setAction(null);}
    } catch (cause) {setError(cause instanceof Error ? cause.message : "Billing could not be updated.");}
    finally {await refreshWorkspace(); setBusy(false);}
  }
  return <div className="company-billing-control" onClick={event => event.stopPropagation()}>
    <div className="company-billing-status"><span>Billing <strong>{billing.status}</strong></span><small>{!stripeReady ? "Stripe: Not Configured" : !deliveryReady ? "Billing email setup pending" : "$99 USD / month per company"}</small></div>
    <button className="button secondary small" disabled={busy} onClick={() => {setEmail(billing.billingEmail || company.assignedEmail || company.email); setError(""); setAction(billing.enabled ? "disable" : "enable");}}>{billing.enabled ? "Disable Billing" : "Enable Billing"}</button>
    {billing.enabled && stripeReady && <div className="company-billing-links"><button className="text-link" disabled={busy || !deliveryReady} onClick={() => void change("checkout")}>Send payment setup</button><button className="text-link" disabled={busy} onClick={() => void change("portal")}>Prepare billing portal</button>{portal && <a href={portal} target="_blank" rel="noreferrer">Open Stripe portal</a>}</div>}
    {error && !action && <p className="form-error" role="alert">{error}</p>}
    {action && <Modal title={action === "enable" ? "Enable company billing?" : "Disable company billing?"} onClose={() => {if (!busy) setAction(null);}}>
      <p>{action === "enable" ? `${company.name} will require a confirmed $99 USD monthly subscription. Existing records will be kept. A secure payment setup link will be emailed to the billing address.` : `Future recurring subscriptions for ${company.name} will be canceled in Stripe. Free access is restored only after cancellation is confirmed. Existing records and drafts will be kept; no refund is initiated.`}</p>
      {!stripeReady ? <p className="notice">{billing.enabled ? "Stripe is Not Configured. Existing billing and access remain unchanged. Cancellation cannot be confirmed until Stripe is configured." : "Stripe is Not Configured. This company retains free access. No checkout, payment, or billing change will be attempted."}</p> : !deliveryReady && action === "enable" ? <p className="notice">Configure billing email delivery before enabling billing.</p> : null}
      {action === "enable" && <label>Billing email<input type="email" value={email} onChange={event => setEmail(event.target.value)} autoComplete="email"/></label>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="form-actions"><button className="button secondary" disabled={busy} onClick={() => setAction(null)}>Cancel</button><button className="button primary" disabled={busy || !stripeReady || action === "enable" && !deliveryReady} onClick={() => void change(action)}>{busy ? "Updating billing..." : action === "enable" ? "Enable Billing & Send Setup" : "Cancel Recurring Charges & Make Free"}</button></div>
    </Modal>}
  </div>;
}
