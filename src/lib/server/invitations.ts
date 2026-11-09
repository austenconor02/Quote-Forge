import "server-only";
import { AccessError, requireOwner } from "./auth";
import { adminServices } from "./firebase";
import { saveCompanyRecord } from "./tenant-repository";
import { enforceRateLimit } from "./rate-limit";
import { invitationEmailConfigured, sendInvitationEmail } from "./email";
import { createInvitationService, InvitationError, type IssueInput } from "./invitation-core";
import type { InvitationIdentity } from "../invitation-policy";
export {createInvitationService} from "./invitation-core";

function service() {
  const {db, auth} = adminServices();
  return createInvitationService({db, auth, owner: requireOwner, emailConfigured: invitationEmailConfigured, sendEmail: sendInvitationEmail, saveCompany: saveCompanyRecord, rateLimit: enforceRateLimit});
}
async function translate<T>(operation: () => Promise<T>): Promise<T> {
  try {return await operation();}
  catch (error) {if (error instanceof InvitationError) throw new AccessError(error.status, error.message); throw error;}
}
export async function issueInvitation(input: IssueInput) {
  const owner = await requireOwner();
  if (owner.demo || !invitationEmailConfigured()) throw new AccessError(503, "Invitation email delivery is not configured. Nothing was sent. You can save the company as an unassigned draft.");
  return translate(() => service().issueInvitation(input));
}
export async function acceptInvitation(rawToken: string, identity: InvitationIdentity) {return translate(() => service().acceptInvitation(rawToken, identity));}
export async function changeCompanyAccess(companyId: string, action: "suspend" | "reactivate") {return translate(() => service().changeCompanyAccess(companyId, action));}
