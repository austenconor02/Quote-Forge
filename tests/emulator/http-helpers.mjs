import assert from "node:assert/strict";
export const baseUrl = process.env.EMULATOR_TEST_URL || "http://127.0.0.1:3002";
export const authEmulatorUrl = "http://127.0.0.1:9099";
export const projectId = "demo-quoteforge";
const base = new URL(baseUrl);
assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(base.hostname), "HTTP integration tests require a loopback server.");
function jwtPart(value) {return Buffer.from(JSON.stringify(value)).toString("base64url");}
export async function createGoogleIdentity(email) {
  const now = Math.floor(Date.now() / 1000);
  const token = jwtPart({alg: "none", typ: "JWT"}) + "." + jwtPart({iss: "https://accounts.google.com", aud: "demo-google-client", sub: "quoteforge-test-" + email, email, email_verified: true, name: "Emulator test account", iat: now, exp: now + 3600}) + ".";
  const response = await fetch(authEmulatorUrl + "/identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=emulator-key", {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({requestUri: baseUrl + "/login", postBody: "id_token=" + encodeURIComponent(token) + "&providerId=google.com", returnSecureToken: true, returnIdpCredential: true})});
  const result = await response.json();
  assert.equal(response.status, 200, "Emulator Google identity failed: " + JSON.stringify(result.error));
  return {email, uid: result.localId, idToken: result.idToken, refreshToken: result.refreshToken};
}
export async function refreshIdentity(identity) {
  const response = await fetch(authEmulatorUrl + "/securetoken.googleapis.com/v1/token?key=emulator-key", {method: "POST", headers: {"Content-Type": "application/x-www-form-urlencoded"}, body: new URLSearchParams({grant_type: "refresh_token", refresh_token: identity.refreshToken})});
  const result = await response.json();
  assert.equal(response.status, 200, "Emulator identity refresh failed.");
  return {...identity, idToken: result.id_token, refreshToken: result.refresh_token || identity.refreshToken};
}
function applyCookies(jar, response) {
  for (const value of response.headers.getSetCookie()) {
    const pair = value.split(";", 1)[0]; const separator = pair.indexOf("="); const name = pair.slice(0, separator); const contents = pair.slice(separator + 1);
    if (!contents || /max-age=0/i.test(value)) jar.delete(name); else jar.set(name, contents);
  }
}
export async function createGoogleSession(email, options = {}) {
  let identity = options.identity || await createGoogleIdentity(email);
  const jar = new Map();
  const csrfResponse = await fetch(baseUrl + "/api/session/csrf"); applyCookies(jar, csrfResponse);
  assert.equal(csrfResponse.status, 200, "Sign-in CSRF setup failed.");
  const {csrfToken} = await csrfResponse.json();
  let response; let body;
  for (let attempt = 0; attempt < 3; attempt++) {
    response = await fetch(baseUrl + "/api/session", {method: "POST", headers: {"Content-Type": "application/json", Origin: base.origin, Cookie: [...jar].map(([name, value]) => name + "=" + value).join("; ")}, body: JSON.stringify({idToken: identity.idToken, csrfToken, ...(options.invitationToken ? {invitationToken: options.invitationToken} : {})})});
    applyCookies(jar, response); body = await response.json();
    if (!body.refreshRequired) break;
    identity = await refreshIdentity(identity);
  }
  if (!options.allowDenied) assert.equal(response.status, 200, "Session creation failed: " + JSON.stringify(body));
  const cookie = [...jar].map(([name, value]) => name + "=" + value).join("; ");
  return {...identity, cookie, response, body, request: (path, init = {}) => fetch(baseUrl + path, {...init, headers: {Origin: base.origin, Cookie: cookie, ...init.headers}, redirect: "manual"})};
}
export async function jsonRequest(session, path, method, value) {
  const response = await session.request(path, {method, headers: {"Content-Type": "application/json"}, body: value === undefined ? undefined : JSON.stringify(value)});
  const body = await response.json(); return {response, body};
}
