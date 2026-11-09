import "server-only";
import Stripe from "stripe";
import { invitationOrigin } from "../invitation-policy";
import { MONTHLY_PRICE_CENTS, type BillingStatus } from "../billing-policy";

export type StripeSnapshot = {customerId: string; subscriptionId: string | null; status: BillingStatus; entitled: boolean; accessUntil: number; hasSubscription: boolean};
export type CheckoutLink = {id: string; url: string; expiresAt: number};
export interface BillingGateway {
  validatePrice(): Promise<void>;
  customer(companyId: string, email: string, name: string, currentId?: string): Promise<string>;
  snapshot(customerId: string, companyId: string): Promise<StripeSnapshot>;
  checkout(customerId: string, companyId: string, key: string): Promise<CheckoutLink>;
  openCheckout(id: string, customerId: string, companyId: string): Promise<CheckoutLink | null>;
  cancel(customerId: string, companyId: string): Promise<void>;
  portal(customerId: string): Promise<string>;
}
export function stripeConfigured(): boolean {
  return process.env.STRIPE_ENABLED === "true" && /^(sk|rk)_(test|live)_\S+$/.test(process.env.STRIPE_SECRET_KEY || "") && /^whsec_\S+$/.test(process.env.STRIPE_WEBHOOK_SECRET || "") && /^price_[A-Za-z0-9]+$/.test(process.env.STRIPE_PRICE_ID || "") && !!invitationOrigin(process.env.APP_ORIGIN);
}
export function stripeClient() {
  if (!stripeConfigured()) throw new Error("Stripe is not configured.");
  return new Stripe(process.env.STRIPE_SECRET_KEY!, {maxNetworkRetries: 2, timeout: 15000});
}
const objectId = (value: unknown): string | null => typeof value === "string" ? value : value && typeof value === "object" && "id" in value && typeof value.id === "string" ? value.id : null;
function providerUrl(value: string | null, kind: "checkout" | "portal") {
  if (!value) throw new Error("Stripe did not return a billing URL.");
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || !(["checkout.stripe.com", "billing.stripe.com"].includes(url.hostname)) || (kind === "checkout" && url.hostname !== "checkout.stripe.com")) throw new Error("Stripe returned an unexpected billing URL.");
  return value;
}
export function createStripeGateway(client = stripeClient()): BillingGateway {
  const priceId = process.env.STRIPE_PRICE_ID!;
  async function validatePrice() {
    const price = await client.prices.retrieve(priceId);
    if (!price.active || price.unit_amount !== MONTHLY_PRICE_CENTS || price.currency !== "usd" || price.type !== "recurring" || price.recurring?.interval !== "month" || price.recurring.interval_count !== 1 || price.recurring.usage_type !== "licensed" || price.billing_scheme !== "per_unit") throw new Error("Stripe price must be exactly USD 99.00 per company every month.");
  }
  async function ownedCustomer(customerId: string, companyId: string) {
    const customer = await client.customers.retrieve(customerId);
    if (customer.deleted || customer.metadata.companyId !== companyId) throw new Error("Stripe customer does not belong to this company.");
    return customer;
  }
  async function subscriptions(customerId: string, companyId: string) {
    await ownedCustomer(customerId, companyId);
    const rows = await client.subscriptions.list({customer: customerId, status: "all", limit: 100, expand: ["data.latest_invoice"]});
    if (rows.has_more || rows.data.some(subscription => subscription.metadata.companyId !== companyId)) throw new Error("This Stripe customer requires an administrator review before billing changes.");
    return rows.data.filter(subscription => !["canceled", "incomplete_expired"].includes(subscription.status));
  }
  return {
    validatePrice,
    async customer(companyId, email, name, currentId) {
      if (currentId) {await ownedCustomer(currentId, companyId); await client.customers.update(currentId, {email, name}); return currentId;}
      const matches = await client.customers.search({query: `metadata['companyId']:'${companyId}'`, limit: 2});
      if (matches.has_more || matches.data.length > 1) throw new Error("Duplicate Stripe customers need an administrator review.");
      if (matches.data[0]) {await client.customers.update(matches.data[0].id, {email, name}); return matches.data[0].id;}
      return (await client.customers.create({email, name, metadata: {companyId}}, {idempotencyKey: `quoteforge-customer-${companyId}`})).id;
    },
    async snapshot(customerId, companyId) {
      const active = await subscriptions(customerId, companyId);
      if (active.length > 1) throw new Error("Multiple subscriptions detected. Billing access remains restricted until reviewed.");
      const subscription = active[0];
      if (!subscription) return {customerId, subscriptionId: null, status: "Canceled", entitled: false, accessUntil: 0, hasSubscription: false};
      const item = subscription.items.data[0];
      const invoice = subscription.latest_invoice;
      const invoicePaid = !!invoice && typeof invoice !== "string" && invoice.status === "paid" && invoice.currency === "usd" && invoice.amount_paid >= MONTHLY_PRICE_CENTS && objectId(invoice.customer) === customerId;
      const periodEnd = item?.current_period_end || 0;
      const correctPlan = subscription.items.data.length === 1 && item.quantity === 1 && item.price.id === priceId && item.price.unit_amount === MONTHLY_PRICE_CENTS && item.price.currency === "usd" && item.price.recurring?.interval === "month" && item.price.recurring.interval_count === 1;
      const entitled = correctPlan && subscription.status === "active" && !subscription.pause_collection && invoicePaid && periodEnd * 1000 > Date.now();
      const status: BillingStatus = entitled ? "Active" : ["past_due", "unpaid"].includes(subscription.status) ? "Past Due" : subscription.status === "paused" || !correctPlan || !!subscription.pause_collection ? "Suspended" : "Payment Required";
      return {customerId, subscriptionId: subscription.id, status, entitled, accessUntil: entitled ? periodEnd * 1000 : 0, hasSubscription: true};
    },
    async checkout(customerId, companyId, key) {
      await validatePrice(); await ownedCustomer(customerId, companyId);
      const origin = invitationOrigin(process.env.APP_ORIGIN)!;
      const session = await client.checkout.sessions.create({mode: "subscription", customer: customerId, client_reference_id: companyId, metadata: {companyId}, subscription_data: {metadata: {companyId}}, line_items: [{price: priceId, quantity: 1}], allow_promotion_codes: false, success_url: `${origin}/billing/return`, cancel_url: `${origin}/billing/return?canceled=1`, expires_at: Math.floor(Date.now() / 1000) + 24 * 60 * 60}, {idempotencyKey: key});
      return {id: session.id, url: providerUrl(session.url, "checkout"), expiresAt: session.expires_at * 1000};
    },
    async openCheckout(id, customerId, companyId) {
      const session = await client.checkout.sessions.retrieve(id);
      if (objectId(session.customer) !== customerId || session.client_reference_id !== companyId || session.metadata?.companyId !== companyId || session.mode !== "subscription") throw new Error("Checkout does not belong to this company.");
      return session.status === "open" && session.expires_at * 1000 > Date.now() ? {id, url: providerUrl(session.url, "checkout"), expiresAt: session.expires_at * 1000} : null;
    },
    async cancel(customerId, companyId) {
      await ownedCustomer(customerId, companyId);
      const checkouts = await client.checkout.sessions.list({customer: customerId, status: "open", limit: 100});
      if (checkouts.has_more) throw new Error("Too many open payment sessions require an administrator review.");
      for (const checkout of checkouts.data) {
        if (checkout.metadata?.companyId !== companyId || checkout.client_reference_id !== companyId) throw new Error("Checkout ownership requires review before cancellation.");
        await client.checkout.sessions.expire(checkout.id);
      }
      const rows = await subscriptions(customerId, companyId);
      for (const subscription of rows) await client.subscriptions.cancel(subscription.id, {invoice_now: false, prorate: false});
      if ((await subscriptions(customerId, companyId)).length) throw new Error("Stripe has not confirmed all recurring subscriptions are canceled.");
    },
    async portal(customerId) {return providerUrl((await client.billingPortal.sessions.create({customer: customerId, return_url: invitationOrigin(process.env.APP_ORIGIN)! + "/billing/return"})).url, "portal");}
  };
}
