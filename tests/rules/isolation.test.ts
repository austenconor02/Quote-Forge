import { after, before, test } from "node:test";
import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertFails, assertSucceeds, RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs } from "firebase/firestore";
import { ref, uploadBytes, getBytes } from "firebase/storage";
let env: RulesTestEnvironment;
let previousPlatformConfig: Record<string, unknown> | null = null;
const verifiedGoogle = {email_verified: true, firebase: {sign_in_provider: "google.com"}} as const;
before(async () => {
  env = await initializeTestEnvironment({projectId: "demo-quoteforge-rules", firestore: {host: "127.0.0.1", port: 8080, rules: readFileSync("firestore.rules", "utf8")}, storage: {host: "127.0.0.1", port: 9199, rules: readFileSync("storage.rules", "utf8")}});
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    const originalConfig = await getDoc(doc(db, "platform/config"));
    previousPlatformConfig = originalConfig.exists() ? originalConfig.data() : null;
    await setDoc(doc(db, "platform/config"), {ownerUid: "sole-owner"});
    for (const id of ["a", "b", "suspended"]) await setDoc(doc(db, "companies/" + id), {id, status: id === "suspended" ? "Suspended" : "Active"});
    for (const [uid, companyId, enabled] of [["alice", "a", true], ["bob", "b", true], ["disabled", "a", false], ["mismatched", "b", true]] as const) {
      await setDoc(doc(db, "userAccess/" + uid), {companyId, enabled});
      await setDoc(doc(db, "companies/" + companyId + "/users/" + uid), {enabled});
    }
    await setDoc(doc(db, "companies/a/users/mismatched"), {enabled: true});
    await setDoc(doc(db, "companies/suspended/users/alice"), {enabled: true});
    for (const id of ["a", "b", "suspended"]) await setDoc(doc(db, "companies/" + id + "/customers/customer"), {companyId: id, createdBy: "seed", name: "Customer"});
    await setDoc(doc(db, "companies/a/branding/theme"), {primary: "#173B36"});
    await setDoc(doc(db, "companies/a/fields/test"), {label: "Test"});
    await setDoc(doc(db, "companies/a/aiConfig/private"), {instructions: "Private company AI settings"});
    await setDoc(doc(db, "platformInvitations/hash"), {email: "alice@example.com", tokenHash: "private-hash"});
    await setDoc(doc(db, "proposalShares/hash"), {companyId: "a", tokenHash: "private-proposal-hash"});
    await uploadBytes(ref(context.storage(), "companies/a/documents/sample/file.pdf"), new Uint8Array([1, 2, 3]), {contentType: "application/pdf"});
    await uploadBytes(ref(context.storage(), "companies/a/proposals/private.pdf"), new Uint8Array([1, 2, 3]), {contentType: "application/pdf"});
  });
});
after(async () => {
  if (!env) return;
  await env.withSecurityRulesDisabled(async context => {
    const reference = doc(context.firestore(), "platform/config");
    const current = await getDoc(reference);
    if (current.data()?.ownerUid !== "sole-owner") return;
    if (previousPlatformConfig) await setDoc(reference, previousPlatformConfig);
    else await deleteDoc(reference);
  });
  await env.cleanup();
});
const member = (uid: string) => env.authenticatedContext(uid, verifiedGoogle);
test("anonymous, unverified, and non-Google accounts cannot read company data", async () => {
  await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), "companies/a/customers/customer")));
  await assertFails(getDoc(doc(env.authenticatedContext("alice", {...verifiedGoogle, email_verified: false}).firestore(), "companies/a/customers/customer")));
  await assertFails(getDoc(doc(env.authenticatedContext("alice", {email_verified: true, firebase: {sign_in_provider: "password"}}).firestore(), "companies/a/customers/customer")));
});
test("members can read only their tenant and cannot enumerate companies", async () => {
  const db = member("alice").firestore();
  await assertSucceeds(getDoc(doc(db, "companies/a/customers/customer")));
  await assertFails(getDoc(doc(db, "companies/b/customers/customer")));
  await assertFails(getDocs(collection(db, "companies")));
});
test("suspension, disabled access, and mismatched root assignment deny access", async () => {
  await assertFails(getDoc(doc(member("alice").firestore(), "companies/suspended/customers/customer")));
  await assertFails(getDoc(doc(member("disabled").firestore(), "companies/a/customers/customer")));
  await assertFails(getDoc(doc(member("mismatched").firestore(), "companies/a/customers/customer")));
});
test("members cannot create companies, change branding, grant membership, or self-assign access", async () => {
  const db = member("alice").firestore();
  await assertFails(setDoc(doc(db, "companies/new"), {id: "new", status: "Active"}));
  await assertFails(updateDoc(doc(db, "companies/a/branding/theme"), {primary: "#000000"}));
  await assertFails(updateDoc(doc(db, "companies/a/fields/test"), {label: "Changed"}));
  await assertFails(setDoc(doc(db, "companies/a/users/mallory"), {enabled: true}));
  await assertFails(setDoc(doc(db, "userAccess/alice"), {companyId: "b", enabled: true}));
});
test("only the verified designated owner may list companies or read private AI settings", async () => {
  const owner = env.authenticatedContext("sole-owner", {...verifiedGoogle, platformOwner: true}).firestore();
  const imposter = env.authenticatedContext("imposter", {...verifiedGoogle, platformOwner: true}).firestore();
  await assertSucceeds(getDocs(collection(owner, "companies")));
  await assertSucceeds(getDoc(doc(owner, "companies/a/aiConfig/private")));
  await assertFails(getDocs(collection(imposter, "companies")));
  await assertFails(getDoc(doc(member("alice").firestore(), "companies/a/aiConfig/private")));
  await assertFails(setDoc(doc(owner, "platform/config"), {ownerUid: "imposter"}));
});
test("every client record write must use the validated authenticated server API", async () => {
  const db = member("alice").firestore();
  await assertFails(setDoc(doc(db, "companies/a/drafts/own"), {companyId: "a", createdBy: "alice"}));
  await assertFails(setDoc(doc(db, "companies/a/drafts/spoof"), {companyId: "b", createdBy: "alice"}));
  const owner = env.authenticatedContext("sole-owner", {...verifiedGoogle, platformOwner: true}).firestore();
  await assertFails(setDoc(doc(owner, "companies/a/drafts/direct-owner-write"), {companyId: "a", createdBy: "sole-owner"}));
});
test("invitation hashes and token issuance are private even to direct owner clients", async () => {
  const owner = env.authenticatedContext("sole-owner", {...verifiedGoogle, platformOwner: true}).firestore();
  await assertFails(getDoc(doc(owner, "platformInvitations/hash")));
  await assertFails(getDoc(doc(owner, "proposalShares/hash")));
  await assertFails(getDoc(doc(owner, "invitationEmailAssets/hash")));
  await assertFails(setDoc(doc(owner, "companies/a/invitations/token"), {token: "unsafe"}));
});
test("storage denies every direct client access; private files require backend authorization", async () => {
  const alice = member("alice").storage();
  const bob = member("bob").storage();
  await assertFails(getBytes(ref(alice, "companies/a/documents/sample/file.pdf")));
  await assertFails(getBytes(ref(bob, "companies/a/documents/sample/file.pdf")));
  await assertFails(getBytes(ref(alice, "companies/a/proposals/private.pdf")));
  await assertFails(uploadBytes(ref(alice, "companies/a/documents/new.pdf"), new Uint8Array([1, 2, 3]), {contentType: "application/pdf"}));
  const owner = env.authenticatedContext("sole-owner", {...verifiedGoogle, platformOwner: true}).storage();
  await assertFails(uploadBytes(ref(owner, "companies/a/branding/logo.png"), new Uint8Array([1, 2, 3]), {contentType: "image/png"}));
});
