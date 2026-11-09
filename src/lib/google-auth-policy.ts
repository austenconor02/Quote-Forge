export type GoogleTokenClaims = { uid: string; email?: string; email_verified?: boolean; auth_time: number; firebase?: {sign_in_provider?: string}; platformOwner?: boolean };
export function isFreshVerifiedGoogleToken(token: GoogleTokenClaims, nowSeconds = Date.now() / 1000) {
  return token.firebase?.sign_in_provider === "google.com" && token.email_verified === true && typeof token.email === "string" && token.email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(token.email) && Number.isFinite(token.auth_time) && token.auth_time <= nowSeconds + 60 && nowSeconds - token.auth_time <= 300;
}
export function normalizeAccountEmail(email: string) { return email.trim().toLowerCase(); }
