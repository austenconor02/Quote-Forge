import { requireTenant, apiError, AccessError, assertSameOrigin } from "@/lib/server/auth";
import { readJson } from "@/lib/server/http";
export async function POST(request: Request) {
  try {
    await assertSameOrigin(request);
    const body = await readJson(request, 4096);
    if (typeof body.companyId !== "string") throw new AccessError(400, "Company identity is required.");
    await requireTenant(body.companyId);
    return Response.json({ error: "Original AI proposal service is missing from the supplied reference. Live generation is disabled; no model request or billing occurred.", code: "AI_INTEGRATION_PENDING" }, { status: 503 });
  } catch (e) { return apiError(e); }
}
