import "server-only";
import { invitationOrigin, normalizeInvitationEmail } from "../invitation-policy";
import { accessibleEmailTextColor, type InvitationEmailBranding } from "../invitation-email-branding";

export type InvitationEmail = InvitationEmailBranding & {toEmail: string; companyName: string; invitationUrl: string; expiresAt: string};
export type ProposalEmail = {toEmail: string; companyName: string; customerName: string; proposalUrl: string; proposalTotal: string; proposalTitle: string; expiresAt: string};
export class EmailDeliveryError extends Error {
  constructor(public kind: "rejected" | "unknown") {super(kind === "rejected" ? "The email provider rejected the email. Nothing was confirmed as sent." : "Email delivery could not be confirmed. The request will not be automatically resent.");}
}
function configured(template: string | undefined) {return process.env.EMAIL_DELIVERY_ENABLED === "true" && !!process.env.EMAILJS_SERVICE_ID && !!template && !!process.env.EMAILJS_PUBLIC_KEY && !!process.env.EMAILJS_PRIVATE_KEY && !!invitationOrigin(process.env.APP_ORIGIN, process.env.NODE_ENV !== "production");}
export function invitationEmailConfigured() {
  return configured(process.env.EMAILJS_INVITATION_TEMPLATE_ID);
}
export function proposalEmailConfigured() {return configured(process.env.EMAILJS_PROPOSAL_TEMPLATE_ID);}
function validLink(email: string, link: string, path: string) {
  const origin = invitationOrigin(process.env.APP_ORIGIN, process.env.NODE_ENV !== "production")!;
  const url = new URL(link);
  return !!normalizeInvitationEmail(email) && url.origin === origin && url.pathname === path && !url.search && /^#token=[A-Za-z0-9_-]{43}$/.test(url.hash);
}
async function send(templateId: string, params: Record<string, string>): Promise<void> {
  let response: Response;
  try {
    response = await fetch("https://api.emailjs.com/api/v1.0/email/send", {method: "POST", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(12000), headers: {"Content-Type": "application/json"}, body: JSON.stringify({
      service_id: process.env.EMAILJS_SERVICE_ID, template_id: templateId, user_id: process.env.EMAILJS_PUBLIC_KEY, accessToken: process.env.EMAILJS_PRIVATE_KEY, template_params: params
    })});
  } catch {throw new EmailDeliveryError("unknown");}
  if (!response.ok) throw new EmailDeliveryError(response.status >= 400 && response.status < 500 ? "rejected" : "unknown");
  try {if ((await response.text()).trim() !== "OK") throw new Error();}
  catch {throw new EmailDeliveryError("unknown");}
}
export async function sendInvitationEmail(message: InvitationEmail): Promise<void> {
  if (!invitationEmailConfigured()) throw new Error("Invitation email delivery is not configured.");
  const origin = invitationOrigin(process.env.APP_ORIGIN, process.env.NODE_ENV !== "production")!;
  let logo: URL;
  try {logo = new URL(message.companyLogoUrl);} catch {throw new Error("The invitation logo URL is invalid.");}
  if (!validLink(message.toEmail, message.invitationUrl, "/invite") || !message.companyName.trim() || /{{|}}/.test(message.companyName) || logo.origin !== origin || !/^\/api\/invitations\/logo\/[A-Za-z0-9_-]{43}\.png$/.test(logo.pathname) || logo.username || logo.password || logo.search || logo.hash || message.headerTextColor !== accessibleEmailTextColor(message.primaryColor) || message.buttonTextColor !== message.headerTextColor) throw new Error("The invitation email contains invalid information.");
  return send(process.env.EMAILJS_INVITATION_TEMPLATE_ID!, {to_email: normalizeInvitationEmail(message.toEmail)!, company_name: message.companyName, company_logo_url: message.companyLogoUrl, primary_color: message.primaryColor, header_text_color: message.headerTextColor, button_text_color: message.buttonTextColor, invite_url: message.invitationUrl, expires_in: "7 days"});
}
export async function sendProposalEmail(message: ProposalEmail): Promise<void> {
  if (!proposalEmailConfigured()) throw new Error("Proposal email delivery is not configured.");
  if (!validLink(message.toEmail, message.proposalUrl, "/proposal")) throw new Error("The proposal email contains invalid information.");
  return send(process.env.EMAILJS_PROPOSAL_TEMPLATE_ID!, {to_email: message.toEmail, company_name: message.companyName, customer_name: message.customerName, proposal_url: message.proposalUrl, proposal_total: message.proposalTotal, proposal_title: message.proposalTitle, expires_at: message.expiresAt});
}
