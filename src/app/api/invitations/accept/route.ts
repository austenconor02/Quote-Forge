import { z } from "zod";
import { apiError, assertSameOrigin, AccessError } from "@/lib/server/auth";
import { adminServices } from "@/lib/server/firebase";
import { boundedJson } from "@/lib/server/request-body";
import { acceptInvitation } from "@/lib/server/invitations";

const inputSchema = z.object({idToken: z.string().min(20).max(10000), token: z.string().regex(/^[A-Za-z0-9_-]{43}$/)}).strict();
export async function POST(request: Request) {
  try {
    await assertSameOrigin(request);
    const result = inputSchema.safeParse(await boundedJson(request, 12000));
    if (!result.success) throw new AccessError(400, "A valid Google identity and invitation are required.");
    const token = await adminServices().auth.verifyIdToken(result.data.idToken, true);
    if (!token.email || !token.email_verified || token.firebase?.sign_in_provider !== "google.com" || !Number.isFinite(token.auth_time) || Date.now() / 1000 - token.auth_time > 300 || token.auth_time > Date.now() / 1000 + 60) throw new AccessError(401, "Sign in again with the invited, verified Google account.");
    const accepted = await acceptInvitation(result.data.token, {uid: token.uid, email: token.email, email_verified: true, provider: token.firebase.sign_in_provider});
    return Response.json(accepted, {headers: {"Cache-Control": "private, no-store"}});
  } catch (error) {return apiError(error);}
}
