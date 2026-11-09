import "server-only";
import { randomUUID } from "node:crypto";
import { Timestamp, type Firestore } from "firebase-admin/firestore";
import { billingSummary } from "../billing-policy";
import { normalizeInvitationEmail } from "../invitation-policy";
import type { BillingGateway } from "./stripe";
import { EmailDeliveryError } from "./email";

export class BillingError extends Error {constructor(public status: number, message: string) {super(message);}}
type Dependencies = {db: Firestore; gateway: BillingGateway; configured: () => boolean; emailConfigured: () => boolean; owner: () => Promise<{demo: boolean; uid: string}>; sendSetup: (companyId: string, email: string, url: string, expiresAt: number) => Promise<void>; now?: () => number};
const validCompany = (id: string) => /^[A-Za-z0-9-]{1,100}$/.test(id);

export function createBillingService(deps: Dependencies) {
  const now = deps.now || Date.now;
  async function locked<T>(companyId: string, uid: string | null, operation: (record: FirebaseFirestore.DocumentData, update: (values: FirebaseFirestore.DocumentData) => Promise<void>) => Promise<T>) {
    if (!validCompany(companyId)) throw new BillingError(400, "Invalid company identity.");
    const reference = deps.db.doc(`companyBilling/${companyId}`), lease = randomUUID();
    const data = await deps.db.runTransaction(async transaction => {
      const [company, billing, owner] = await Promise.all([transaction.get(deps.db.doc(`companies/${companyId}`)), transaction.get(reference), uid ? transaction.get(deps.db.doc("platform/config")) : Promise.resolve(null)]);
      if (uid && owner?.data()?.ownerUid !== uid) throw new BillingError(403, "Only the designated owner can change billing.");
      if (!company.exists) throw new BillingError(404, "Company not found.");
      const data = billing.data() || {enabled: false, status: "Free", entitled: false, accessUntil: 0};
      if (Number(data.leaseUntil || 0) > now()) throw new BillingError(409, "Another billing operation is in progress. Please retry shortly.");
      transaction.set(reference, {...data, lease, leaseUntil: now() + 120000}, {merge: true});
      return {...data, company: company.data()!};
    });
    const update = async (values: FirebaseFirestore.DocumentData) => {
      await deps.db.runTransaction(async transaction => {
        const billing = await transaction.get(reference);
        if (billing.data()?.lease !== lease || Number(billing.data()?.leaseUntil || 0) <= now()) throw new BillingError(409, "The billing operation lease expired. No access change was confirmed.");
        transaction.update(reference, {...values, ...(typeof values.accessUntil === "number" ? {accessUntilTimestamp: Timestamp.fromMillis(Math.max(0, values.accessUntil))} : {}), updatedAt: new Date(now()).toISOString()});
      });
      Object.assign(data, values);
    };
    try {return await operation(data, update);}
    finally {await deps.db.runTransaction(async transaction => {const current = await transaction.get(reference); if (current.data()?.lease === lease) transaction.update(reference, {lease: null, leaseUntil: 0});});}
  }
  async function ownerAction(companyId: string, action: "enable" | "disable" | "checkout" | "portal", requestedEmail?: string) {
    const actor = await deps.owner();
    if (actor.demo || !deps.configured()) throw new BillingError(503, "Stripe is Not Configured. Billing remains unchanged; no payment or checkout was attempted.");
    if (!["enable", "disable", "checkout", "portal"].includes(action)) throw new BillingError(400, "Invalid billing action.");
    if (["enable", "checkout"].includes(action) && !deps.emailConfigured()) throw new BillingError(503, "Billing email delivery is not configured. No billing change was made.");
    if (["enable", "checkout"].includes(action)) await deps.gateway.validatePrice();
    return locked(companyId, actor.uid, async (data, update) => {
      if (action === "disable") {
        if (data.customerId) {
          try {await deps.gateway.cancel(data.customerId, companyId);}
          catch {throw new BillingError(503, "Stripe cancellation could not be confirmed. Billing has not been marked Free, and recurring charges may still continue. Retry after checking Stripe.");}
        } else if (data.subscriptionId) throw new BillingError(409, "The stored subscription requires an administrator review before cancellation.");
        await update({enabled: false, status: "Free", entitled: false, accessUntil: 0, checkoutId: null, checkoutAttemptKey: null, cancellationConfirmedAt: new Date(now()).toISOString()});
        return {billing: billingSummary(data), canceled: true};
      }
      const email = normalizeInvitationEmail(requestedEmail || data.billingEmail || data.company.assignedEmail);
      if (!email) throw new BillingError(400, "Enter the company's billing email before enabling billing.");
      if (action === "portal") {
        if (!data.customerId) throw new BillingError(409, "This company does not yet have a Stripe customer.");
        return {billing: billingSummary(data), portalUrl: await deps.gateway.portal(data.customerId)};
      }
      if (action === "checkout" && data.enabled !== true) throw new BillingError(409, "Enable billing before sending a payment setup link.");
      const customerId = await deps.gateway.customer(companyId, email, data.company.name, data.customerId);
      const mapping = deps.db.doc(`stripeCustomers/${customerId}`);
      await deps.db.runTransaction(async transaction => {
        const current = await transaction.get(mapping);
        if (current.exists && current.data()?.companyId !== companyId) throw new BillingError(409, "This Stripe customer belongs to another company.");
        transaction.set(mapping, {companyId});
      });
      const enabling = data.enabled !== true;
      await update({customerId, billingEmail: email, enabled: true, ...(enabling ? {status: "Payment Required", entitled: false, accessUntil: 0} : {})});
      const state = await deps.gateway.snapshot(customerId, companyId);
      if (state.hasSubscription) {
        // A server reconciliation must confirm current provider state; checkout redirects never unlock access.
        await update({subscriptionId: state.subscriptionId});
        if (data.entitled === true && data.status === "Active" && state.entitled) return {billing: billingSummary(data), alreadySubscribed: true};
        throw new BillingError(409, "A Stripe subscription already exists. A new subscription was not created. Use the billing portal or reconcile its verified webhook events.");
      }
      let checkout = data.checkoutId ? await deps.gateway.openCheckout(data.checkoutId, customerId, companyId) : null;
      if (!checkout) {
        if (!data.checkoutAttemptKey || data.checkoutId) await update({checkoutAttemptKey: randomUUID(), checkoutId: null, emailStatus: null});
        checkout = await deps.gateway.checkout(customerId, companyId, data.checkoutAttemptKey);
        await update({checkoutId: checkout.id, checkoutExpiresAt: checkout.expiresAt, status: "Checkout Pending", entitled: false, accessUntil: 0});
      }
      if (data.emailedCheckoutId === checkout.id && data.emailStatus === "confirmed") return {billing: billingSummary(data), delivered: true};
      if (data.emailedCheckoutId === checkout.id && ["sending", "unknown"].includes(data.emailStatus)) throw new BillingError(409, "Earlier billing-email delivery is uncertain. It will not be automatically resent; inspect the provider before requesting another link.");
      await update({emailedCheckoutId: checkout.id, emailStatus: "sending"});
      try {await deps.sendSetup(companyId, email, checkout.url, checkout.expiresAt);}
      catch (error) {await update({emailStatus: error instanceof EmailDeliveryError && error.kind === "rejected" ? "rejected" : "unknown"}); throw new BillingError(503, "The billing email was not confirmed. Checkout remains pending; no payment or email success was reported.");}
      await update({emailStatus: "confirmed"});
      return {billing: billingSummary(data), delivered: true};
    });
  }
  async function reconcile(event: {id: string; type: string; customerId: string; live: boolean}) {
    if (!deps.configured()) throw new BillingError(503, "Stripe is not configured.");
    const supported = ["checkout.session.completed", "customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted", "invoice.paid", "invoice.payment_failed"];
    if (!supported.includes(event.type)) return {ignored: true};
    if (!/^evt_[A-Za-z0-9]+$/.test(event.id) || !/^cus_[A-Za-z0-9]+$/.test(event.customerId)) throw new BillingError(400, "Invalid Stripe event identity.");
    const mapping = (await deps.db.doc(`stripeCustomers/${event.customerId}`).get()).data();
    if (!mapping) return {ignored: true};
    if (!validCompany(mapping.companyId)) throw new BillingError(409, "Stripe customer is not mapped to a QuoteForge company.");
    const eventRef = deps.db.doc(`stripeEvents/${event.id}`);
    return locked(mapping.companyId, null, async (data, update) => {
      if (data.customerId !== event.customerId) throw new BillingError(409, "Stripe customer mapping is inconsistent.");
      const previousEvent = (await eventRef.get()).data();
      if (previousEvent?.status === "processed") {if (previousEvent.companyId !== mapping.companyId || previousEvent.type !== event.type) throw new BillingError(409, "Stripe event binding is inconsistent."); return {duplicate: true};}
      // Always retrieve authoritative current state. Event timestamps/payload statuses are not an ordering mechanism.
      if (data.enabled !== true) {
        await deps.gateway.cancel(event.customerId, mapping.companyId);
        await update({status: "Free", entitled: false, accessUntil: 0});
      } else {
        const state = await deps.gateway.snapshot(event.customerId, mapping.companyId);
        if (state.customerId !== event.customerId) throw new BillingError(409, "Stripe state belongs to another customer.");
        if (state.subscriptionId) {
          const subscriptionRef = deps.db.doc(`stripeSubscriptions/${state.subscriptionId}`);
          await deps.db.runTransaction(async transaction => {const original = await transaction.get(subscriptionRef); if (original.exists && original.data()?.companyId !== mapping.companyId) throw new BillingError(409, "Stripe subscription belongs to another company."); transaction.set(subscriptionRef, {companyId: mapping.companyId, customerId: event.customerId});});
        }
        await update({status: state.status, subscriptionId: state.subscriptionId, entitled: state.entitled, accessUntil: state.entitled ? state.accessUntil : 0, lastVerifiedEvent: event.id});
      }
      await eventRef.set({companyId: mapping.companyId, type: event.type, status: "processed", processedAt: Timestamp.fromMillis(now()), expiresAt: Timestamp.fromMillis(now() + 90 * 24 * 60 * 60 * 1000)});
      return {received: true};
    });
  }
  return {ownerAction, reconcile};
}
