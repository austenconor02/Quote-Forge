import { z } from "zod";
import { AccessError, apiError, assertSameOrigin, requireTenant } from "@/lib/server/auth";
import { identifierSchema } from "@/lib/server-input";
import { boundedJson } from "@/lib/server/request-body";
import { sendStoredProposal } from "@/lib/server/proposal-delivery";

export const runtime = "nodejs";
const input = z.object({quoteId: identifierSchema}).strict();
export async function POST(request: Request, {params}: {params: Promise<{companyId: string}>}) {
  try {
    await assertSameOrigin(request);
    const {companyId} = await params;
    await requireTenant(companyId);
    const parsed = input.safeParse(await boundedJson(request, 1024));
    if (!parsed.success) throw new AccessError(400, "Choose a saved proposal to send.");
    return Response.json(await sendStoredProposal(companyId, parsed.data.quoteId), {headers: {"Cache-Control": "private, no-store"}});
  } catch (error) {return apiError(error);}
}
