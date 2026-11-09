import { apiError } from "@/lib/server/auth";
import { readTenantWorkspace } from "@/lib/server/tenant-repository";
export async function GET(_: Request, {params}: {params: Promise<{companyId: string}>}) {
  try { const {companyId} = await params; return Response.json(await readTenantWorkspace(companyId), {headers: {"Cache-Control": "private, no-store"}}); }
  catch (error) {return apiError(error);}
}
