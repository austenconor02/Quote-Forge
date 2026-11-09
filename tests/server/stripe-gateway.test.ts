import { test } from "node:test";
import assert from "node:assert/strict";
import Stripe from "stripe";
import { createStripeGateway, stripeConfigured } from "../../src/lib/server/stripe";

const customerId = "cus_QFtest", companyId = "qf-company";
function fixture() {
  process.env.STRIPE_PRICE_ID = "price_QFtest"; process.env.APP_ORIGIN = "https://quoteforge.example.test";
  const price = {id: "price_QFtest", active: true, unit_amount: 9900, currency: "usd", type: "recurring", billing_scheme: "per_unit", recurring: {interval: "month", interval_count: 1, usage_type: "licensed"}};
  const subscription = {id: "sub_QFtest", metadata: {companyId}, status: "active", pause_collection: null, latest_invoice: {status: "paid", currency: "usd", amount_paid: 9900, customer: customerId}, items: {data: [{quantity: 1, price, current_period_end: Math.floor(Date.now() / 1000) + 3600}]}};
  let checkoutParams: Record<string, unknown> = {};
  const fake = {prices: {retrieve: async () => price}, customers: {retrieve: async () => ({id: customerId, metadata: {companyId}})}, subscriptions: {list: async () => ({has_more: false, data: [subscription]})}, checkout: {sessions: {create: async (params: Record<string, unknown>) => {checkoutParams = params; return {id: "cs_QFtest", url: "https://checkout.stripe.com/test_QF", expires_at: Math.floor(Date.now() / 1000) + 3600};}}}};
  return {price, subscription, gateway: createStripeGateway(fake as unknown as Stripe), checkout: () => checkoutParams};
}
test("Stripe stays unconfigured without the explicit enable flag, secrets, price, and HTTPS origin", () => {
  const keys = ["STRIPE_ENABLED", "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "STRIPE_PRICE_ID", "APP_ORIGIN"];
  const old = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  try {
    Object.assign(process.env, {STRIPE_ENABLED: "false", STRIPE_SECRET_KEY: "sk_test_not_a_real_key", STRIPE_WEBHOOK_SECRET: "whsec_not_a_real_secret", STRIPE_PRICE_ID: "price_QFtest", APP_ORIGIN: "https://quoteforge.example.test"});
    assert.equal(stripeConfigured(), false); process.env.STRIPE_ENABLED = "true"; assert.equal(stripeConfigured(), true);
    process.env.APP_ORIGIN = "http://127.0.0.1:3000"; assert.equal(stripeConfigured(), false);
  } finally {for (const key of keys) {if (old[key] === undefined) delete process.env[key]; else process.env[key] = old[key];}}
});
test("checkout uses the configured $99 monthly price, immutable company metadata, and non-authorizing return page", async () => {
  const {gateway, checkout, price} = fixture();
  await gateway.checkout(customerId, companyId, "stable-operation-key");
  const params = checkout();
  assert.equal(params.mode, "subscription"); assert.deepEqual(params.line_items, [{price: price.id, quantity: 1}]);
  assert.deepEqual(params.metadata, {companyId}); assert.equal(params.client_reference_id, companyId);
  assert.equal(params.success_url, "https://quoteforge.example.test/billing/return");
  price.unit_amount = 9800; await assert.rejects(gateway.validatePrice(), /exactly USD 99/);
});
test("an active subscription is insufficient without a paid invoice and exact monthly price/quantity", async () => {
  const {gateway, subscription} = fixture();
  assert.equal((await gateway.snapshot(customerId, companyId)).entitled, true);
  subscription.latest_invoice.status = "open"; assert.equal((await gateway.snapshot(customerId, companyId)).entitled, false);
  subscription.latest_invoice.status = "paid"; subscription.latest_invoice.amount_paid = 0; assert.equal((await gateway.snapshot(customerId, companyId)).entitled, false);
  subscription.latest_invoice.amount_paid = 9900; subscription.items.data[0].quantity = 2; assert.equal((await gateway.snapshot(customerId, companyId)).entitled, false);
  subscription.items.data[0].quantity = 1; subscription.metadata.companyId = "another-company"; await assert.rejects(gateway.snapshot(customerId, companyId), /administrator review/);
});
test("official Stripe signature verification rejects altered events and forged payment statuses", () => {
  const stripe = new Stripe("sk_test_not_a_real_key"), secret = "whsec_test_only";
  const payload = JSON.stringify({id: "evt_QFtest", type: "invoice.paid", data: {object: {customer: customerId}}, livemode: false});
  const signature = stripe.webhooks.generateTestHeaderString({payload, secret});
  assert.equal(stripe.webhooks.constructEvent(payload, signature, secret).id, "evt_QFtest");
  assert.throws(() => stripe.webhooks.constructEvent(payload.replace(customerId, "cus_other"), signature, secret));
  assert.throws(() => stripe.webhooks.constructEvent(payload, signature, "whsec_wrong"));
});
