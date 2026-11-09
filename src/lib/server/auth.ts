import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { adminServices } from "./firebase";
import { designatedOwnerUid } from "./owner-account";
import { canAccessTenant, isOwner, localDemoAllowed, Identity } from "../access-policy";
import { billingAccessAllowed } from "../billing-policy";

export class AccessError extends Error { constructor(public status: number, message: string) { super(message); } }
export async function isLocalDemo() {
  if (process.env.QUOTEFORGE_FIREBASE_ENABLED === "true") return false;
  return localDemoAllowed((await headers()).get("host") || "", process.env.QUOTEFORGE_DEMO_MODE, process.env.NODE_ENV);
}
export async function sessionIdentity(): Promise<Identity | null> {
  const cookie = (await cookies()).get("__session")?.value;
  if (!cookie) return null;
  try {
    const token = await adminServices().auth.verifySessionCookie(cookie, true);
    if (token.email_verified !== true || token.firebase?.sign_in_provider !== "google.com" || !token.email) return null;
    return { uid: token.uid, platformOwner: token.platformOwner === true, email_verified: true, email: token.email, provider: "google.com" };
  } catch { return null; }
}
export async function requireOwner() {
  if (await isLocalDemo()) return { demo: true, uid: "local-demo-owner" };
  const identity = await sessionIdentity();
  if (!identity) throw new AccessError(401, "Sign in with your authorized Google account.");
  if (!isOwner(identity, await designatedOwnerUid())) throw new AccessError(403, "Designated platform owner access required.");
  return { demo: false, uid: identity.uid };
}
export async function requireOwnerPage() {
  try { return await requireOwner(); } catch { redirect("/login"); }
}
export async function requireTenantMembership(companyId: string) {
  if (!/^[a-zA-Z0-9-]{1,100}$/.test(companyId)) throw new AccessError(400, "Invalid company identity.");
  if (await isLocalDemo()) return { demo: true, uid: "local-demo-owner" };
  const identity = await sessionIdentity();
  if (!identity) throw new AccessError(401, "Sign in is required.");
  if (isOwner(identity, await designatedOwnerUid())) return { demo: false, uid: identity.uid, owner: true };
  const {db} = adminServices();
  const [company, member, assignment] = await Promise.all([
    db.doc("companies/" + companyId).get(), db.doc("companies/" + companyId + "/users/" + identity.uid).get(), db.doc("userAccess/" + identity.uid).get()
  ]);
  if (assignment.data()?.companyId !== companyId || assignment.data()?.enabled !== true ||
    !canAccessTenant(identity, undefined, company.data()?.status, member.exists ? { uid: member.id, enabled: member.data()?.enabled === true } : undefined)) throw new AccessError(403, "Company access is unavailable.");
  return { demo: false, uid: identity.uid };
}
export async function requireTenant(companyId: string) {
  const session = await requireTenantMembership(companyId);
  if (!session.demo && !("owner" in session && session.owner)) {
    const billing = (await adminServices().db.doc(`companyBilling/${companyId}`).get()).data();
    if (!billingAccessAllowed(billing)) throw new AccessError(402, "This company requires a confirmed subscription. Contact the company owner for its payment setup link.");
  }
  return session;
}
export function apiError(error: unknown) {
  const status = error instanceof AccessError ? error.status : 503;
  return Response.json({ error: error instanceof AccessError ? error.message : "The service is unavailable or not configured. Your entered work has been kept." }, { status, headers: {"Cache-Control": "no-store"} });
}
export async function assertSameOrigin(request: Request) {
  const expected = process.env.APP_ORIGIN || (process.env.NODE_ENV !== "production" ? "http://127.0.0.1:3000" : "");
  let origin = "";
  try {origin = new URL(expected).origin;} catch {throw new AccessError(503, "The application origin is not configured.");}
  if (request.headers.get("origin") !== origin || request.headers.get("sec-fetch-site") === "cross-site") throw new AccessError(403, "Request origin is not allowed.");
}
