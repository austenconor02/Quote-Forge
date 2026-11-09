import assert from "node:assert/strict";
const base = process.env.PRODUCTION_TEST_URL || "http://127.0.0.1:3001";
let passed = 0;
for (const path of ["/", "/companies", "/create-company", "/companies/test-company/edit", "/companies/test-company/open", "/branding", "/fields", "/preview", "/invitations", "/settings", "/app/test-company"]) {
  const response = await fetch(base + path, {redirect: "manual"});
  assert.equal(response.status, 307, path); assert.equal(response.headers.get("location"), "/login", path); passed++;
}
for (const [path, method, data] of [["/api/companies", "POST"], ["/api/workspace", "GET"], ["/api/invitations", "POST"], ["/api/companies/test-company/access", "POST", {action: "suspend"}], ["/api/tenants/northstar-roofing/customers", "GET"], ["/api/tenants/northstar-roofing/workspace", "GET"], ["/api/tenants/northstar-roofing/documents/test-document", "GET"], ["/api/tenants/northstar-roofing/proposals/send", "POST", {quoteId: "test-quote"}], ["/api/tenants/northstar-roofing/drafts", "POST", {}], ["/api/proposals/generate", "POST", {companyId: "northstar-roofing"}]]) {
  const response = await fetch(base + path, {method, headers: {"content-type": "application/json", origin: base, cookie: "__session=forged-token"}, body: data ? JSON.stringify(data) : undefined});
  assert.equal(response.status, 401, path); passed++;
}
for (const path of ["/login", "/invite", "/proposal"]) {const response = await fetch(base + path); assert.equal(response.status, 200); assert.equal(response.headers.get("x-content-type-options"), "nosniff"); passed++;}
assert.equal((await fetch(base + "/api/companies", {method: "POST", headers: {origin: "https://untrusted.example", "content-type": "application/json"}, body: "{}"})).status, 403); passed++;
assert.equal((await fetch(base + "/api/proposals/download", {method: "POST", headers: {origin: base, "content-type": "application/json"}, body: JSON.stringify({token: "invalid"})})).status, 404); passed++;
console.log(`${passed} production access checks passed. Local demo is unavailable in the production build.`);
