import "server-only";
import { AccessError, requireTenant } from "./auth";
import { adminServices } from "./firebase";
import { assertTenantTransaction, readTenantCompany, readTenantRecord } from "./tenant-repository";
import { enforceRateLimit } from "./rate-limit";
import { proposalEmailConfigured, sendProposalEmail } from "./email";
import { createProposalDeliveryService, ProposalDeliveryError } from "./proposal-delivery-core";
import type { Quote } from "../models";
export {createProposalDeliveryService} from "./proposal-delivery-core";

function service() {
  const {db, bucket} = adminServices();
  return createProposalDeliveryService({db, bucket, tenant: requireTenant, authorizeTransaction: assertTenantTransaction, readCompany: readTenantCompany, readQuote: async (companyId, quoteId) => await readTenantRecord(companyId, "drafts", quoteId) as Quote, emailConfigured: proposalEmailConfigured, sendEmail: sendProposalEmail, rateLimit: enforceRateLimit});
}
async function translate<T>(operation: () => Promise<T>): Promise<T> {
  try {return await operation();}
  catch (error) {if (error instanceof ProposalDeliveryError) throw new AccessError(error.status, error.message); throw error;}
}
export async function sendStoredProposal(companyId: string, quoteId: string) {
  const actor = await requireTenant(companyId);
  if (actor.demo || !proposalEmailConfigured()) throw new AccessError(503, "Proposal email delivery is not configured. Your saved proposal has been kept; no email was sent.");
  return translate(() => service().sendStoredProposal(companyId, quoteId));
}
export async function downloadSharedProposal(rawToken: string) {return translate(() => service().downloadSharedProposal(rawToken));}
