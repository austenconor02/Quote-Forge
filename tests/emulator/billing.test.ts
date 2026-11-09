import { after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Firestore } from "firebase-admin/firestore";
import { createBillingService } from "../../src/lib/server/billing-core";
import type { BillingGateway, StripeSnapshot } from "../../src/lib/server/stripe";
import { billingAccessAllowed } from "../../src/lib/billing-policy";
import { EmailDeliveryError } from "../../src/lib/server/email";

const db = new Firestore({projectId: "demo-quoteforge-billing", host: "127.0.0.1:8080", ssl: false});
const companies: string[] = [], customers: string[] = [], events: string[] = [], subscriptions: string[] = [];
let sequence = 0;
async function setup(overrides: {configured?: boolean; emailError?: boolean; cancelError?: boolean; actor?: string} = {}) {
  const id = "billing-" + randomUUID(), customerId = "cus_QF" + (++sequence), subscriptionId = "sub_QF" + sequence;
  companies.push(id); customers.push(customerId); subscriptions.push(subscriptionId);
  await db.doc("platform/config").set({ownerUid: "owner"});
  await db.doc(`companies/${id}`).set({id, name: "Billing QA", status: "Active", assignedEmail: "billing@example.com"});
  let state: StripeSnapshot = {customerId, subscriptionId: null, status: "Canceled", entitled: false, accessUntil: 0, hasSubscription: false};
  const calls = {checkout: 0, email: 0, snapshot: 0, customer: 0, cancel: 0};
  const gateway: BillingGateway = {
    validatePrice: async () => {}, customer: async () => {calls.customer++; return customerId;}, snapshot: async () => {calls.snapshot++; return {...state};},
    checkout: async () => {calls.checkout++; return {id: "cs_QF" + sequence + "_" + calls.checkout, url: "https://checkout.stripe.com/test_quoteforge", expiresAt: Date.now() + 3600000};},
    openCheckout: async checkoutId => ({id: checkoutId, url: "https://checkout.stripe.com/test_quoteforge", expiresAt: Date.now() + 3600000}),
    cancel: async () => {calls.cancel++; if (overrides.cancelError) throw new Error("provider unavailable"); state = {...state, hasSubscription: false, entitled: false, status: "Canceled"};},
    portal: async () => "https://billing.stripe.com/test_quoteforge"
  };
  const service = createBillingService({db, gateway, configured: () => overrides.configured !== false, emailConfigured: () => true, owner: async () => ({demo: false, uid: overrides.actor || "owner"}), sendSetup: async (_companyId, email, url) => {assert.equal(email, "billing@example.com"); assert.match(url, /^https:\/\/checkout\.stripe\.com\//); calls.email++; if (overrides.emailError) throw new EmailDeliveryError("unknown");}});
  const record = async () => (await db.doc(`companyBilling/${id}`).get()).data();
  const event = async (type = "invoice.paid", eventId = "evt_QF" + randomUUID().replace(/-/g, "")) => {events.push(eventId); return service.reconcile({id: eventId, type, customerId, live: false});};
  return {id, customerId, subscriptionId, service, gateway, calls, overrides, record, event, state: (value: Partial<StripeSnapshot>) => {state = {...state, ...value};}};
}
after(async () => {
  for (const id of companies) await Promise.all([db.doc(`companies/${id}`).delete(), db.doc(`companyBilling/${id}`).delete()]);
  for (const [collection, ids] of [["stripeCustomers", customers], ["stripeSubscriptions", subscriptions], ["stripeEvents", events]] as const) await Promise.all(ids.map(id => db.doc(`${collection}/${id}`).delete()));
  await db.doc("platform/config").delete(); await db.terminate();
});

test("missing Stripe keys leave companies free and perform no Stripe calls or billing writes", async () => {
  const fixture = await setup({configured: false});
  await assert.rejects(fixture.service.ownerAction(fixture.id, "enable"), /Not Configured/);
  assert.equal(await fixture.record(), undefined); assert.equal(fixture.calls.customer, 0); assert.equal(fixture.calls.checkout, 0);
});
test("only the anchored administrator can change billing", async () => {
  const fixture = await setup({actor: "company-user"});
  await assert.rejects(fixture.service.ownerAction(fixture.id, "enable"), /designated owner/);
  assert.equal(fixture.calls.checkout, 0); assert.equal(await fixture.record(), undefined);
});
test("enabling sends one setup link and reuses pending checkout without granting paid access", async () => {
  const fixture = await setup();
  await fixture.service.ownerAction(fixture.id, "enable"); await fixture.service.ownerAction(fixture.id, "checkout");
  assert.equal(fixture.calls.checkout, 1); assert.equal(fixture.calls.email, 1);
  const record = await fixture.record(); assert.equal(record?.status, "Checkout Pending"); assert.equal(billingAccessAllowed(record), false);
});
test("duplicate events are idempotent and late paid events cannot overwrite current past-due state", async () => {
  const fixture = await setup(); await fixture.service.ownerAction(fixture.id, "enable");
  fixture.state({subscriptionId: fixture.subscriptionId, hasSubscription: true, status: "Active", entitled: true, accessUntil: Date.now() + 3600000});
  const id = "evt_QF" + randomUUID().replace(/-/g, ""); await fixture.event("invoice.paid", id);
  assert.equal(billingAccessAllowed(await fixture.record()), true);
  const lookups = fixture.calls.snapshot; await fixture.event("invoice.paid", id); assert.equal(fixture.calls.snapshot, lookups);
  fixture.state({status: "Past Due", entitled: false, accessUntil: 0});
  await fixture.event("invoice.payment_failed"); await fixture.event("invoice.paid");
  assert.equal((await fixture.record())?.status, "Past Due"); assert.equal(billingAccessAllowed(await fixture.record()), false);
});
test("failed cancellation cannot report Free; confirmed cancellation restores free access and re-enabling needs payment", async () => {
  const fixture = await setup({cancelError: true}); await fixture.service.ownerAction(fixture.id, "enable");
  fixture.state({subscriptionId: fixture.subscriptionId, hasSubscription: true, status: "Active", entitled: true, accessUntil: Date.now() + 3600000}); await fixture.event();
  await assert.rejects(fixture.service.ownerAction(fixture.id, "disable"), /recurring charges may still continue/);
  assert.equal((await fixture.record())?.enabled, true); assert.equal((await fixture.record())?.status, "Active");
  fixture.overrides.cancelError = false; await fixture.service.ownerAction(fixture.id, "disable");
  assert.equal((await fixture.record())?.status, "Free"); assert.equal(billingAccessAllowed(await fixture.record()), true);
  await fixture.service.ownerAction(fixture.id, "enable"); assert.equal(billingAccessAllowed(await fixture.record()), false); assert.equal(fixture.calls.checkout, 2);
});
test("an existing subscription prevents duplicate subscription checkout", async () => {
  const fixture = await setup(); fixture.state({subscriptionId: fixture.subscriptionId, hasSubscription: true, status: "Past Due"});
  await assert.rejects(fixture.service.ownerAction(fixture.id, "enable"), /already exists/);
  assert.equal(fixture.calls.checkout, 0); assert.equal(fixture.calls.email, 0);
});
test("uncertain email delivery is not automatically retried and does not create another checkout", async () => {
  const fixture = await setup({emailError: true});
  await assert.rejects(fixture.service.ownerAction(fixture.id, "enable"), /not confirmed/);
  await assert.rejects(fixture.service.ownerAction(fixture.id, "checkout"), /uncertain/);
  assert.equal(fixture.calls.checkout, 1); assert.equal(fixture.calls.email, 1);
});
test("one company payment cannot unlock another company and unrelated customers are ignored", async () => {
  const first = await setup(), second = await setup(); await first.service.ownerAction(first.id, "enable"); await second.service.ownerAction(second.id, "enable");
  first.state({customerId: second.customerId, entitled: true, status: "Active", accessUntil: Date.now() + 3600000});
  await assert.rejects(first.event(), /another customer/);
  assert.equal(billingAccessAllowed(await first.record()), false); assert.equal(billingAccessAllowed(await second.record()), false);
  assert.deepEqual(await first.service.reconcile({id: "evt_unrelated", type: "invoice.paid", customerId: "cus_unrelated", live: false}), {ignored: true});
});
test("events after billing is disabled cancel late subscriptions and never re-enable paid billing", async () => {
  const fixture = await setup(); await fixture.service.ownerAction(fixture.id, "enable"); await fixture.service.ownerAction(fixture.id, "disable");
  fixture.state({subscriptionId: fixture.subscriptionId, hasSubscription: true, status: "Active", entitled: true, accessUntil: Date.now() + 3600000});
  await fixture.event("checkout.session.completed");
  assert.equal((await fixture.record())?.enabled, false); assert.equal((await fixture.record())?.status, "Free"); assert.equal(fixture.calls.cancel, 2);
});
