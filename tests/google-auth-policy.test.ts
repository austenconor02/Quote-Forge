import test from "node:test";
import assert from "node:assert/strict";
import { isFreshVerifiedGoogleToken } from "../src/lib/google-auth-policy";
const token = {uid: "google-uid", email: "owner@example.com", email_verified: true, auth_time: 1000, firebase: {sign_in_provider: "google.com"}};
test("sessions require a recent verified Google sign-in", () => {
  assert.equal(isFreshVerifiedGoogleToken(token, 1100), true);
  for (const changed of [{email_verified: false}, {email: ""}, {email: "bad-address"}, {auth_time: 0}, {auth_time: 5000}, {firebase: {sign_in_provider: "password"}}, {firebase: {sign_in_provider: "anonymous"}}]) assert.equal(isFreshVerifiedGoogleToken({...token, ...changed}, 1100), false);
});
