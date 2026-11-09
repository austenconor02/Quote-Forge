import test from "node:test";
import assert from "node:assert/strict";
import type { Company, Customer, Quote, Workspace } from "../src/lib/models";
import { demoCompanies, makeDemoWorkspace } from "../src/lib/demo";
import { sampleQuote } from "../src/lib/quote";
import {
  OWNER_STORAGE_KEY,
  LEGACY_STORAGE_KEY,
  LEGACY_TENANT_PREFIX,
  TENANT_STORAGE_PREFIX,
  createEmptyWorkspace,
  loadOwnerWorkspace,
  mergeTenantRecords,
} from "../src/lib/workspace-storage";

class ReadOnlyStorage {
  readonly values: Map<string, string>;
  readonly reads: string[] = [];
  writes = 0;
  deletions = 0;
  constructor(entries: Record<string, string> = {}) { this.values = new Map(Object.entries(entries)); }
  getItem(key: string) { this.reads.push(key); return this.values.get(key) ?? null; }
  setItem() { this.writes++; throw new Error("Migration must not write its source storage."); }
  removeItem() { this.deletions++; throw new Error("Migration must not delete recovery records."); }
  clear() { this.deletions++; throw new Error("Migration must not clear recovery records."); }
}

function company(id = "cedar-services-created-1234"): Company & { origin: "owner" } {
  return { ...structuredClone(demoCompanies[0]), id, name: "Cedar Services", email: "owner@cedar.example", fields: [{ id: "permit", label: "Permit number", type: "Text", required: true, defaultValue: "TX-27", options: [] }], origin: "owner" };
}
function draft(tenant: Company, id: string, updatedAt = "2026-11-08T12:00:00Z"): Quote {
  return { ...sampleQuote(tenant), id, title: `Project ${id}`, updatedAt, customer: { ...sampleQuote(tenant).customer, id: `customer-${id}`, name: `Customer ${id}` }, sourceInput: { pastedText: `Source for ${id}`, specialInstructions: "Keep the supplied prices.", documents: [] } };
}
function workspace(companies: Company[]): Workspace {
  return { version: 1, companies, customers: [], drafts: [], invitations: [], activity: [], selectedCompanyId: companies[0]?.id ?? "" };
}

test("storage keys keep the new owner workspace separate from immutable legacy recovery keys", () => {
  assert.equal(OWNER_STORAGE_KEY, "quoteforge.owner.workspace.v2");
  assert.equal(LEGACY_STORAGE_KEY, "quoteforge.phase1.workspace.v1");
  assert.equal(LEGACY_TENANT_PREFIX, "quoteforge.phase1.tenant.");
  assert.equal(TENANT_STORAGE_PREFIX, "quoteforge.owner.tenant.v2.");
});

test("a first visit starts with no seeded companies, people, invitations, or drafts", () => {
  const expected = workspace([]);
  assert.deepEqual(createEmptyWorkspace(), expected);
  assert.deepEqual(loadOwnerWorkspace(new ReadOnlyStorage()), expected);
});

test("legacy migration removes known demo identities and keeps user-created companies and their records", () => {
  const legacy = makeDemoWorkspace();
  const owned = company();
  const { origin: _origin, ...unmarkedCompany } = owned;
  const savedDraft = draft(unmarkedCompany, "owned-draft");
  legacy.companies.push(unmarkedCompany);
  legacy.customers.push(savedDraft.customer);
  legacy.drafts.push(savedDraft);
  legacy.invitations.push({ id: "owned-invitation", companyId: owned.id, email: "user@cedar.example", status: "Prepared", createdAt: "2026-11-08T12:00:00Z" });
  legacy.selectedCompanyId = "northstar-roofing";
  const raw = JSON.stringify(legacy);
  const storage = new ReadOnlyStorage({ [LEGACY_STORAGE_KEY]: raw });
  const result = loadOwnerWorkspace(storage);

  assert.deepEqual(result.companies.map(c => c.id), [owned.id]);
  assert.equal((result.companies[0] as Company & { origin?: string }).origin, "owner");
  assert.deepEqual(result.companies[0].fields, owned.fields);
  assert.deepEqual(result.drafts, [savedDraft]);
  assert.deepEqual(result.customers, [savedDraft.customer]);
  assert.deepEqual(result.invitations.map(i => i.id), ["owned-invitation"]);
  assert.equal(result.selectedCompanyId, owned.id);
  assert.equal(storage.values.get(LEGACY_STORAGE_KEY), raw);
  assert.equal(storage.writes, 0);
  assert.equal(storage.deletions, 0);
});

test("company names never determine which records are demonstration data", () => {
  const sameName = { ...company(), name: "Northstar Roofing" };
  const legacy = workspace([structuredClone(demoCompanies[0]), sameName]);
  const result = loadOwnerWorkspace(new ReadOnlyStorage({ [LEGACY_STORAGE_KEY]: JSON.stringify(legacy) }));
  assert.deepEqual(result.companies.map(c => c.id), [sameName.id]);
  assert.equal(result.companies[0].name, "Northstar Roofing");
});

test("an explicitly owner-created company is kept even when its ID matches an old seed ID", () => {
  const ownedSeed = company("northstar-roofing");
  const savedDraft = draft(ownedSeed, "retained-owner-draft");
  const old = { ...workspace([ownedSeed]), drafts: [savedDraft], customers: [savedDraft.customer] };
  const result = loadOwnerWorkspace(new ReadOnlyStorage({ [LEGACY_STORAGE_KEY]: JSON.stringify(old) }));
  assert.equal(result.companies[0].id, ownedSeed.id);
  assert.deepEqual(result.drafts, [savedDraft]);
  assert.deepEqual(result.customers, [savedDraft.customer]);
});

test("migrating a workspace containing only legacy demos yields an empty selection", () => {
  const storage = new ReadOnlyStorage({ [LEGACY_STORAGE_KEY]: JSON.stringify(makeDemoWorkspace()) });
  const result = loadOwnerWorkspace(storage);
  assert.deepEqual(result.companies, []);
  assert.deepEqual(result.drafts, []);
  assert.deepEqual(result.customers, []);
  assert.deepEqual(result.invitations, []);
  assert.equal(result.selectedCompanyId, "");
});

test("legacy tenant snapshots restore newer drafts without overwriting their recovery bytes", () => {
  const owned = company();
  const older = draft(owned, "continue-project", "2026-11-08T10:00:00Z");
  const newer = { ...older, title: "Latest saved scope", updatedAt: "2026-11-08T14:00:00Z" };
  const second = draft(owned, "keep-second-project");
  const tenantKey = `${LEGACY_TENANT_PREFIX}${owned.id}`;
  const entries = {
    [LEGACY_STORAGE_KEY]: JSON.stringify({ ...workspace([owned]), drafts: [older, second], customers: [second.customer] }),
    [tenantKey]: JSON.stringify({ company: owned, drafts: [newer], customers: [newer.customer] }),
  };
  const storage = new ReadOnlyStorage(entries);
  const result = loadOwnerWorkspace(storage);
  assert.equal(result.drafts.find(q => q.id === newer.id)?.title, "Latest saved scope");
  assert.ok(result.drafts.some(q => q.id === second.id));
  assert.ok(result.customers.some(c => c.id === newer.customer.id));
  assert.ok(result.customers.some(c => c.id === second.customer.id));
  assert.deepEqual(Object.fromEntries(storage.values), entries);
  assert.equal(storage.writes, 0);
  assert.equal(storage.deletions, 0);
});

test("an existing new owner workspace takes precedence over a malformed legacy workspace", () => {
  const owned = company();
  const current = workspace([owned]);
  const storage = new ReadOnlyStorage({ [OWNER_STORAGE_KEY]: JSON.stringify(current), [LEGACY_STORAGE_KEY]: "{broken legacy data" });
  const result = loadOwnerWorkspace(storage);
  assert.deepEqual(result, current);
  assert.equal(storage.writes, 0);
  assert.equal(storage.deletions, 0);
});

test("malformed or invalid saved workspaces throw rather than creating replacement sample data", () => {
  for (const key of [OWNER_STORAGE_KEY, LEGACY_STORAGE_KEY]) {
    assert.throws(() => loadOwnerWorkspace(new ReadOnlyStorage({ [key]: "{broken json" })));
    assert.throws(() => loadOwnerWorkspace(new ReadOnlyStorage({ [key]: JSON.stringify({ version: 1, companies: "not an array" }) })));
  }
});

test("a stale tenant event preserves the newer draft and records missing from the event", () => {
  const owned = company();
  const latest = draft(owned, "current", "2026-11-08T16:00:00Z");
  const other = draft(owned, "not-in-payload");
  const previous = { ...workspace([owned]), drafts: [latest, other], customers: [latest.customer, other.customer] };
  const snapshot = structuredClone(previous);
  const stale = { ...latest, title: "Old scope", updatedAt: "2026-11-08T09:00:00Z" };
  const result = mergeTenantRecords(previous, { company: owned, drafts: [stale], customers: [] });
  assert.deepEqual(result.drafts.find(q => q.id === latest.id), latest);
  assert.deepEqual(result.drafts.find(q => q.id === other.id), other);
  assert.deepEqual(result.customers, previous.customers);
  assert.deepEqual(previous, snapshot);
});

test("tenant merging filters cross-company draft/customer rows and never alters owner branding", () => {
  const a = company("tenant-a-owned");
  const b = company("tenant-b-owned");
  const own = draft(a, "tenant-a-draft");
  const other = draft(b, "tenant-b-draft");
  const invalidCustomer = { ...draft(a, "invalid-customer-company"), customer: { ...own.customer, companyId: b.id } };
  const prior = { ...workspace([a, b]), drafts: [other], customers: [other.customer] };
  const changedBranding = { ...a, branding: { ...a.branding, primary: "#FF00FF" } };
  const incomingCustomer: Customer = { ...own.customer, phone: "(512) 555-0199" };
  const result = mergeTenantRecords(prior, { company: changedBranding, drafts: [own, other, invalidCustomer], customers: [incomingCustomer, other.customer] });
  assert.deepEqual(result.companies, prior.companies);
  assert.equal(result.drafts.length, 2);
  assert.ok(result.drafts.some(q => q.id === own.id));
  assert.ok(result.drafts.some(q => q.id === other.id));
  assert.ok(!result.drafts.some(q => q.id === invalidCustomer.id));
  assert.equal(result.customers.filter(c => c.companyId === a.id).length, 1);
  assert.equal(result.customers.find(c => c.id === incomingCustomer.id)?.phone, incomingCustomer.phone);
  assert.deepEqual(result.customers.find(c => c.id === other.customer.id), other.customer);
});

test("tenant events cannot introduce an unknown company or its records", () => {
  const owned = company();
  const unknown = company("unknown-company-owned");
  const current = workspace([owned]);
  const payload = draft(unknown, "unknown-draft");
  const result = mergeTenantRecords(current, { company: unknown, drafts: [payload], customers: [payload.customer] });
  assert.deepEqual(result, current);
});

test("customer merging updates a matching identity while retaining other customer records", () => {
  const owned = company();
  const one = draft(owned, "one").customer;
  const two = draft(owned, "two").customer;
  const current = { ...workspace([owned]), customers: [one, two] };
  const changed = { ...one, address: "Updated project address" };
  const result = mergeTenantRecords(current, { company: owned, drafts: [], customers: [changed] });
  assert.equal(result.customers.length, 2);
  assert.deepEqual(result.customers.find(c => c.id === one.id), changed);
  assert.deepEqual(result.customers.find(c => c.id === two.id), two);
});
