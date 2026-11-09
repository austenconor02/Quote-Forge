import type { Company, Customer, Quote, Workspace } from "./models";
import { tenantWorkspaceSchema, workspaceSchema } from "./workspace-schema";

export const OWNER_STORAGE_KEY = "quoteforge.owner.workspace.v2";
export const LEGACY_STORAGE_KEY = "quoteforge.phase1.workspace.v1";
export const LEGACY_TENANT_PREFIX = "quoteforge.phase1.tenant.";
export const TENANT_STORAGE_PREFIX = "quoteforge.owner.tenant.v2.";
const starterIds = new Set(["northstar-roofing", "oak-and-stone", "volt-electric", "evergreen-landscapes", "clearflow-plumbing", "summit-construction"]);

export function createEmptyWorkspace(): Workspace {
  return { version: 1, companies: [], customers: [], drafts: [], invitations: [], activity: [], selectedCompanyId: "" };
}

export function mergeTenantRecords(workspace: Workspace, tenant: { company: Company; drafts: Quote[]; customers: Customer[] }): Workspace {
  const companyId = tenant.company.id;
  if (!workspace.companies.some(company => company.id === companyId)) return workspace;
  const drafts = new Map(workspace.drafts.map(quote => [quote.id, quote]));
  for (const quote of tenant.drafts) {
    if (quote.companyId !== companyId || quote.customer.companyId !== companyId) continue;
    const previous = drafts.get(quote.id);
    if (previous && previous.companyId !== companyId) continue;
    if (!previous || Date.parse(quote.updatedAt) > Date.parse(previous.updatedAt)) drafts.set(quote.id, quote);
  }
  const customers = new Map(workspace.customers.map(customer => [customer.id, customer]));
  for (const customer of tenant.customers) {
    if (customer.companyId !== companyId) continue;
    const previous = customers.get(customer.id);
    if (previous && previous.companyId !== companyId) continue;
    customers.set(customer.id, customer);
  }
  return { ...workspace, drafts: [...drafts.values()], customers: [...customers.values()] };
}

export function loadOwnerWorkspace(storage: { getItem: (key: string) => string | null }): Workspace {
  const current = storage.getItem(OWNER_STORAGE_KEY);
  const legacy = current ? null : storage.getItem(LEGACY_STORAGE_KEY);
  if (!current && !legacy) return createEmptyWorkspace();
  let workspace: Workspace = workspaceSchema.parse(JSON.parse(current || legacy!));
  const prefix = current ? TENANT_STORAGE_PREFIX : LEGACY_TENANT_PREFIX;
  for (const company of workspace.companies) {
    const raw = storage.getItem(prefix + company.id);
    if (!raw) continue;
    try { const tenant = tenantWorkspaceSchema.parse(JSON.parse(raw)); if (tenant.company.id === company.id) workspace = mergeTenantRecords(workspace, tenant); } catch { /* Primary owner records remain intact. */ }
  }
  if (!current) {
    // Legacy keys are an immutable recovery archive. Never clear, rewrite, or delete them.
    const companies = workspace.companies.filter(company => company.origin === "owner" || (!starterIds.has(company.id) && company.origin !== "demo")).map(company => ({ ...company, origin: "owner" as const }));
    const ids = new Set(companies.map(company => company.id));
    workspace = { ...workspace, companies,
      customers: workspace.customers.filter(customer => ids.has(customer.companyId)),
      drafts: workspace.drafts.filter(quote => ids.has(quote.companyId) && quote.customer.companyId === quote.companyId),
      invitations: workspace.invitations.filter(invitation => ids.has(invitation.companyId)),
      activity: workspace.activity.filter(activity => !["activity-1", "activity-2", "activity-3"].includes(activity.id))
    };
  }
  return { ...workspace, selectedCompanyId: workspace.companies.some(c => c.id === workspace.selectedCompanyId) ? workspace.selectedCompanyId : workspace.companies[0]?.id || "" };
}
