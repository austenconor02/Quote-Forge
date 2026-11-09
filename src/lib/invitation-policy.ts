export const INVITATION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
export type InvitationIdentity = {uid: string; email: string; email_verified: boolean; provider: string};
export type InvitationState = {email: string; status: string; expiresAt: number; companyStatus: string; tokenHash: string; currentTokenHash: string | null};

export function validInvitationToken(value: unknown): value is string {return typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);}
export function normalizeInvitationEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return email.length <= 254 && /^[^\s@<>,;:\"]+@[^\s@<>,;:\"]+\.[^\s@<>,;:\"]+$/.test(email) ? email : null;
}
export function verifiedGoogleIdentity(identity: InvitationIdentity) {
  return !!identity.uid && identity.uid.length <= 128 && !/[\/\u0000-\u001f\u007f]/.test(identity.uid) && ![".", ".."].includes(identity.uid) && identity.provider === "google.com" && identity.email_verified === true && !!normalizeInvitationEmail(identity.email);
}
export function canAcceptInvitation(invitation: InvitationState, identity: InvitationIdentity, now = Date.now()) {
  return verifiedGoogleIdentity(identity)
    && normalizeInvitationEmail(identity.email) === normalizeInvitationEmail(invitation.email)
    && !!normalizeInvitationEmail(invitation.email)
    && invitation.status === "Sent" && invitation.companyStatus === "Active"
    && Number.isFinite(invitation.expiresAt) && invitation.expiresAt > now
    && /^[a-f0-9]{64}$/.test(invitation.tokenHash)
    && invitation.currentTokenHash === invitation.tokenHash;
}
export function invitationOrigin(value: string | undefined, allowLocal = false) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) return null;
    const local = allowLocal && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    return url.protocol === "https:" || local && url.protocol === "http:" ? url.origin : null;
  } catch {return null;}
}
