import { apiError, AccessError, assertSameOrigin, requireTenant } from "@/lib/server/auth";
import { boundedJson } from "@/lib/server/request-body";
import { resourceNames, type ResourceName } from "@/lib/server-input";
import { deleteTenantResource, listTenantResource, readTenantRecord, saveTenantResource } from "@/lib/server/tenant-repository";
type Context = {params: Promise<{companyId: string; resource: string}>};
async function parameters(context: Context) {const {companyId, resource} = await context.params; if (!resourceNames.includes(resource as ResourceName)) throw new AccessError(404, "Unknown resource."); return {companyId, resource: resource as ResourceName};}
export async function GET(request: Request, context: Context) {
  try {const {companyId, resource} = await parameters(context); const query = new URL(request.url).searchParams; const id = query.get("recordId"); const result = id ? {record: await readTenantRecord(companyId, resource, id)} : await listTenantResource(companyId, resource, query.get("cursor") || undefined); return Response.json(result, {headers: {"Cache-Control": "private, no-store"}});} catch (error) {return apiError(error);}
}
export async function POST(request: Request, context: Context) {
  try {await assertSameOrigin(request); const {companyId, resource} = await parameters(context); await requireTenant(companyId); const record = await saveTenantResource(companyId, resource, await boundedJson(request, 5 * 1024 * 1024)); return Response.json({record}, {headers: {"Cache-Control": "private, no-store"}});} catch (error) {return apiError(error);}
}
export async function DELETE(request: Request, context: Context) {
  try {await assertSameOrigin(request); const {companyId, resource} = await parameters(context); await requireTenant(companyId); const body = await boundedJson(request, 1000) as {id?: unknown}; if (typeof body?.id !== "string") throw new AccessError(400, "Record identity is required."); await deleteTenantResource(companyId, resource, body.id); return Response.json({ok: true});} catch (error) {return apiError(error);}
}
