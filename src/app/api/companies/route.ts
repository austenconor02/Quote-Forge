import { apiError, assertSameOrigin, requireOwner } from "@/lib/server/auth";
import { boundedJson } from "@/lib/server/request-body";
import { saveCompanyRecord } from "@/lib/server/tenant-repository";
export async function POST(request: Request) {
  try { await assertSameOrigin(request); await requireOwner(); const options = new URL(request.url).searchParams; const company = await saveCompanyRecord(await boundedJson(request, 7 * 1024 * 1024), {updateFields: options.get("fields") === "1"}); return Response.json({company}, {headers: {"Cache-Control": "private, no-store"}}); }
  catch (error) { return apiError(error); }
}
