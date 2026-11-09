import { installedCompany } from "@/lib/server/pwa";
import { tenantManifest } from "@/lib/pwa";
import { apiError } from "@/lib/server/auth";
export async function GET(_: Request, {params}: {params: Promise<{companyId: string}>}) {
  try { const {companyId} = await params; return Response.json(tenantManifest(await installedCompany(companyId)), {headers: {"Content-Type": "application/manifest+json", "Cache-Control": "private, no-store"}}); } catch (e) {return apiError(e);}
}
