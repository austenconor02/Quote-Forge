import { timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { adminServices } from "@/lib/server/firebase";
import { apiError, assertSameOrigin, AccessError } from "@/lib/server/auth";
import { prepareOwnerSignIn } from "@/lib/server/owner-account";
import { readJson } from "@/lib/server/http";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { isFreshVerifiedGoogleToken } from "@/lib/google-auth-policy";
import { acceptInvitation } from "@/lib/server/invitations";

async function verifyCsrf(body: Record<string, unknown>) {
  const expected = (await cookies()).get("__qf_csrf")?.value || "";
  const actual = typeof body.csrfToken === "string" ? body.csrfToken : "";
  if (!/^[A-Za-z0-9_-]{43}$/.test(expected) || !/^[A-Za-z0-9_-]{43}$/.test(actual) || !timingSafeEqual(Buffer.from(expected), Buffer.from(actual))) throw new AccessError(403, "The sign-in request expired. Please try again.");
}
export async function POST(request: Request) {
  try {
    await assertSameOrigin(request);
    const body = await readJson(request);
    await verifyCsrf(body);
    if (typeof body.idToken !== "string" || body.idToken.length > 10000) throw new AccessError(400, "A valid Google identity token is required.");
    const {auth, db} = adminServices();
    let token;
    try {token = await auth.verifyIdToken(body.idToken, true);} catch {throw new AccessError(401, "Your Google sign-in could not be verified. Please sign in again.");}
    if (!isFreshVerifiedGoogleToken(token)) throw new AccessError(401, "A recent sign-in with a verified Google account is required.");
    await enforceRateLimit(token.uid, "session-login", {limit: 30, windowMs: 15 * 60 * 1000});
    const owner = await prepareOwnerSignIn(token);
    if (owner.refreshRequired) return Response.json({refreshRequired: true}, {headers: {"Cache-Control": "no-store"}});
    let next = "/";
    if (body.invitationToken !== undefined) {
      if (typeof body.invitationToken !== "string") throw new AccessError(400, "The invitation is invalid.");
      const accepted = await acceptInvitation(body.invitationToken, {uid: token.uid, email: token.email!, email_verified: true, provider: "google.com"});
      next = "/app/" + accepted.companyId;
    } else if (!owner.isOwner) {
      const assignment = (await db.doc("userAccess/" + token.uid).get()).data();
      if (!assignment?.enabled || typeof assignment.companyId !== "string" || !/^[a-zA-Z0-9-]{1,100}$/.test(assignment.companyId)) throw new AccessError(403, "This Google account has not been assigned a company. Use your invitation link.");
      const [company, member] = await Promise.all([db.doc("companies/" + assignment.companyId).get(), db.doc("companies/" + assignment.companyId + "/users/" + token.uid).get()]);
      if (company.data()?.status !== "Active" || member.data()?.enabled !== true) throw new AccessError(403, "Your company access is suspended or unavailable.");
      next = "/app/" + assignment.companyId;
    }
    const expiresIn = 5 * 24 * 60 * 60 * 1000;
    (await cookies()).set("__session", await auth.createSessionCookie(body.idToken, {expiresIn}), {httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: expiresIn / 1000});
    (await cookies()).delete("__qf_csrf");
    return Response.json({ok: true, next}, {headers: {"Cache-Control": "no-store"}});
  } catch (error) {return apiError(error);}
}
export async function DELETE(request: Request) {
  try {await assertSameOrigin(request); const body = await readJson(request); await verifyCsrf(body); (await cookies()).delete("__session"); (await cookies()).delete("__qf_csrf"); return Response.json({ok: true}, {headers: {"Cache-Control": "no-store"}});}
  catch (error) {return apiError(error);}
}
