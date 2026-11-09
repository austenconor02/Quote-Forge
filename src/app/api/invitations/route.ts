import { z } from "zod";
import { requireOwner, apiError, assertSameOrigin, AccessError } from "@/lib/server/auth";
import { companyInputSchema, identifierSchema } from "@/lib/server-input";
import { boundedJson } from "@/lib/server/request-body";
import { issueInvitation } from "@/lib/server/invitations";
const inputSchema = z.object({companyId: identifierSchema, company: companyInputSchema.optional(), email: z.string().max(254), action: z.enum(["create", "resend", "reassign"]).optional(), idempotencyKey: z.string().regex(/^[a-zA-Z0-9._:-]{1,128}$/).optional()}).strict();
export async function POST(request: Request) {
  try {
    await assertSameOrigin(request); await requireOwner();
    const result = inputSchema.safeParse(await boundedJson(request, 7 * 1024 * 1024));
    if (!result.success) throw new AccessError(400, "The invitation request is invalid.");
    const input = result.data;
    return Response.json(await issueInvitation({...input, action: input.action || (input.company ? "create" : "resend")}), {headers: {"Cache-Control": "private, no-store"}});
  } catch (error) {return apiError(error);}
}
