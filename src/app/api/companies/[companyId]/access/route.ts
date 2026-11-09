import { z } from "zod";
import { apiError, assertSameOrigin, requireOwner, AccessError } from "@/lib/server/auth";
import { changeCompanyAccess } from "@/lib/server/invitations";
import { boundedJson } from "@/lib/server/request-body";
const inputSchema = z.object({action: z.enum(["suspend", "reactivate"])}).strict();
export async function POST(request: Request, {params}: {params: Promise<{companyId: string}>}) {
  try {
    await assertSameOrigin(request); await requireOwner();
    const input = inputSchema.safeParse(await boundedJson(request, 1000));
    if (!input.success) throw new AccessError(400, "Choose deactivate or reactivate.");
    const {companyId} = await params;
    return Response.json(await changeCompanyAccess(companyId, input.data.action), {headers: {"Cache-Control": "private, no-store"}});
  } catch (error) {return apiError(error);}
}
