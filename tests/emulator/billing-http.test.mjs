import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { applicationDefault, initializeApp, deleteApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { createGoogleSession, jsonRequest } from "./http-helpers.mjs";
process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";
const app = initializeApp({projectId: "demo-quoteforge", credential: applicationDefault()}, "billing-http-" + randomUUID());
const db = getFirestore(app), companyId = "billing-http-" + randomUUID();
let owner, member;
before(async () => {
  owner = await createGoogleSession("owner@example.com");
  const company = {id: companyId, name: "Billing HTTP QA", industry: "Services", email: "billing@example.com", phone: "", address: "", website: "", status: "Draft", branding: {primary: "#122239", secondary: "#F5F7FA", accent: "#EE7D3B", font: "Arial", logo: ""}, fields: [], createdAt: new Date().toISOString()};
  assert.equal((await jsonRequest(owner, "/api/companies", "POST", company)).response.status, 200);
  const {createGoogleIdentity} = await import("./http-helpers.mjs"); const identity = await createGoogleIdentity(`billing-member-${randomUUID()}@example.com`);
  await db.doc(`companies/${companyId}`).update({status: "Active"});
  await db.doc(`companies/${companyId}/users/${identity.uid}`).set({enabled: true});
  await db.doc(`userAccess/${identity.uid}`).set({companyId, enabled: true});
  member = await createGoogleSession(identity.email, {identity});
});
after(async () => {if (member) {await db.doc(`companies/${companyId}/users/${member.uid}`).delete(); await db.doc(`userAccess/${member.uid}`).delete(); await getAuth(app).deleteUser(member.uid);} await db.doc(`companies/${companyId}`).delete(); await db.doc(`companyBilling/${companyId}`).delete(); await deleteApp(app);});
test("Stripe Not Configured keeps free access and rejects real checkout attempts", async () => {
  const result = await jsonRequest(owner, `/api/companies/${companyId}/billing`, "POST", {action: "enable", billingEmail: "billing@example.com"});
  assert.equal(result.response.status, 503); assert.match(result.body.error, /Not Configured/);
  assert.equal((await db.doc(`companyBilling/${companyId}`).get()).exists, false);
  assert.equal((await member.request(`/api/tenants/${companyId}/workspace`)).status, 200);
});
test("company users cannot change billing and frontend payment flags are rejected", async () => {
  assert.equal((await jsonRequest(member, `/api/companies/${companyId}/billing`, "POST", {action: "disable"})).response.status, 403);
  assert.equal((await jsonRequest(owner, `/api/companies/${companyId}/billing`, "POST", {action: "enable", paid: true})).response.status, 400);
});
test("server APIs enforce unpaid, paid, expired and restored-free entitlement while retaining owner access", async () => {
  const billing = db.doc(`companyBilling/${companyId}`);
  await billing.set({enabled: true, status: "Payment Required", entitled: false, accessUntil: 0});
  assert.equal((await member.request(`/api/tenants/${companyId}/workspace`)).status, 402);
  assert.equal((await owner.request(`/api/tenants/${companyId}/workspace`)).status, 200);
  const lockedPage = await member.request(`/app/${companyId}`); assert.equal(lockedPage.status, 200); assert.match(await lockedPage.text(), /Payment required/);
  await billing.set({enabled: true, status: "Active", entitled: true, accessUntil: Date.now() + 60000, accessUntilTimestamp: Timestamp.fromMillis(Date.now() + 60000)});
  assert.equal((await member.request(`/api/tenants/${companyId}/workspace`)).status, 200);
  await billing.update({accessUntil: Date.now() - 1000}); assert.equal((await member.request(`/api/tenants/${companyId}/workspace`)).status, 402);
  await billing.update({enabled: false, status: "Free", entitled: false}); assert.equal((await member.request(`/api/tenants/${companyId}/workspace`)).status, 200);
});
