import test from "node:test";
import assert from "node:assert/strict";
import { billingAccessAllowed, billingSummary, MONTHLY_PRICE_CENTS } from "../src/lib/billing-policy";
import { companyInputSchema } from "../src/lib/server-input";
import { demoCompanies } from "../src/lib/demo";
import { companyProfile } from "../src/lib/models";

test("free companies need no Stripe subscription; enabled billing requires current verified entitlement", () => {
  assert.equal(MONTHLY_PRICE_CENTS, 9900);
  assert.equal(billingAccessAllowed(), true); assert.equal(billingAccessAllowed({enabled: false}), true);
  const now = Date.now(), paid = {enabled: true, status: "Active", entitled: true, accessUntil: now + 10000};
  assert.equal(billingAccessAllowed(paid, now), true);
  for (const state of [{...paid, entitled: false}, {...paid, status: "Past Due"}, {...paid, accessUntil: now}, {...paid, accessUntil: Infinity}, {enabled: true}, {enabled: "false"}, {...paid, accessUntil: String(now + 10000)}]) assert.equal(billingAccessAllowed(state, now), false);
  assert.equal(billingSummary().status, "Free");
});

test("billing status is a server summary and cannot be injected through company profile saving", () => {
  const company = structuredClone(demoCompanies[0]);
  const billing = {enabled: true, status: "Active" as const, monthlyPriceCents: 9900, currency: "usd" as const};
  assert.equal(companyInputSchema.safeParse({...company, billing}).success, false);
  assert.equal(companyInputSchema.safeParse(companyProfile({...company, billing})).success, true);
});
