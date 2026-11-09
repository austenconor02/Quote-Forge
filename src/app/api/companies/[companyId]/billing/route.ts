import { z } from "zod";
import { assertSameOrigin, requireOwner, apiError, AccessError } from "@/lib/server/auth";
import { boundedJson } from "@/lib/server/request-body";
import { billingOwnerAction } from "@/lib/server/billing";
const input = z.object({action: z.enum(["enable", "disable", "checkout", "portal"]), billingEmail: z.string().email().max(254).optional()}).strict();
export async function POST(request: Request, {params}: {params: Promise<{companyId: string}>}) {
  try {await assertSameOrigin(request); await requireOwner(); const data = input.safeParse(await boundedJson(request, 1000)); if (!data.success) throw new AccessError(400, "Invalid billing request."); const {companyId} = await params; return Response.json(await billingOwnerAction(companyId, data.data.action, data.data.billingEmail), {headers: {"Cache-Control": "private, no-store"}});} catch (error) {return apiError(error);}
}
