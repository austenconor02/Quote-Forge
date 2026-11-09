import test from "node:test";
import assert from "node:assert/strict";
import { canAcceptInvitation, invitationOrigin, INVITATION_LIFETIME_MS, normalizeInvitationEmail, validInvitationToken, verifiedGoogleIdentity } from "../src/lib/invitation-policy";

const token = "a".repeat(43), digest = "1".repeat(64), now = 100000;
const identity = {uid: "invited-user", email: "client@example.com", email_verified: true, provider: "google.com"};
const invitation = {email: "client@example.com", status: "Sent", expiresAt: now + INVITATION_LIFETIME_MS, companyStatus: "Active", tokenHash: digest, currentTokenHash: digest};
test("invitation links use a 256-bit base64url token with a bounded format", () => {
  assert.equal(validInvitationToken(token), true);
  for (const value of [null, "", "a".repeat(42), "a".repeat(44), "/".repeat(43), "=".repeat(43), token + "\n"]) assert.equal(validInvitationToken(value), false);
  assert.equal(INVITATION_LIFETIME_MS, 172800000);
});
test("invited email normalization does not silently change account aliases", () => {
  assert.equal(normalizeInvitationEmail("  Client+Project@Example.com "), "client+project@example.com");
  assert.notEqual(normalizeInvitationEmail("client+project@example.com"), normalizeInvitationEmail("client@example.com"));
  for (const value of ["bad", "client@@example.com", "client@example.com\nBcc: other@example.com", "client@example.com,other@example.com", "<client@example.com>"]) assert.equal(normalizeInvitationEmail(value), null);
});
test("only verified Google authentication may accept an invitation", () => {
  assert.equal(verifiedGoogleIdentity(identity), true);
  assert.equal(verifiedGoogleIdentity({...identity, provider: "password"}), false);
  assert.equal(verifiedGoogleIdentity({...identity, email_verified: false}), false);
  assert.equal(verifiedGoogleIdentity({...identity, uid: ""}), false);
  assert.equal(verifiedGoogleIdentity({...identity, uid: "unsafe/path"}), false);
});
test("acceptance requires the exact invited account, current token, confirmed delivery, and active company", () => {
  assert.equal(canAcceptInvitation(invitation, identity, now), true);
  assert.equal(canAcceptInvitation(invitation, {...identity, email: "someone@example.com"}, now), false);
  assert.equal(canAcceptInvitation(invitation, {...identity, email: "CLIENT@example.com"}, now), true);
  for (const status of ["Prepared", "Consumed", "Revoked", "Unknown", "Rejected"]) assert.equal(canAcceptInvitation({...invitation, status}, identity, now), false);
  assert.equal(canAcceptInvitation({...invitation, currentTokenHash: "2".repeat(64)}, identity, now), false);
  assert.equal(canAcceptInvitation({...invitation, currentTokenHash: null}, identity, now), false);
  for (const companyStatus of ["Draft", "Suspended"]) assert.equal(canAcceptInvitation({...invitation, companyStatus}, identity, now), false);
});
test("expired and malformed expiries fail closed, including the exact expiration instant", () => {
  for (const expiresAt of [now - 1, now, NaN, Infinity]) assert.equal(canAcceptInvitation({...invitation, expiresAt}, identity, now), false);
});
test("invitation links require a configured HTTPS origin without paths, credentials, or queries", () => {
  assert.equal(invitationOrigin("https://quotes.example.com"), "https://quotes.example.com");
  for (const value of [undefined, "javascript:alert(1)", "http://quotes.example.com", "https://user:pass@quotes.example.com", "https://quotes.example.com/path", "https://quotes.example.com/?token=secret", "https://quotes.example.com/#secret"]) assert.equal(invitationOrigin(value), null);
  assert.equal(invitationOrigin("http://127.0.0.1:3000", true), "http://127.0.0.1:3000");
  assert.equal(invitationOrigin("http://quotes.example.com", true), null);
});
