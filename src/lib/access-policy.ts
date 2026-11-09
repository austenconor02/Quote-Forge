export type Identity = { uid: string; platformOwner?: boolean; email_verified?: boolean; email?: string; provider?: string };
export function isOwner(identity: Identity | null, designatedUid: string | undefined) {
  return !!identity && !!designatedUid && identity.uid === designatedUid && identity.platformOwner === true && identity.email_verified === true;
}
export function canAccessTenant(identity: Identity | null, designatedUid: string | undefined, companyStatus: string, member?: { enabled: boolean; uid: string }) {
  if (isOwner(identity, designatedUid)) return true;
  return !!identity && identity.email_verified === true && companyStatus === "Active" && member?.enabled === true && member.uid === identity.uid;
}
export function localDemoAllowed(host: string, mode: string | undefined, environment: string | undefined) {
  return environment === "development" && mode !== "false" && /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host);
}
