import { installedCompany, tenantIcon } from "@/lib/server/pwa";
import { apiError, AccessError } from "@/lib/server/auth";
export async function GET(_: Request, {params}: {params: Promise<{companyId: string; size: string}>}) {
  try { const {companyId, size} = await params; if (!["192", "512"].includes(size)) throw new AccessError(404, "Unsupported icon size."); const icon = await tenantIcon(await installedCompany(companyId), Number(size) as 192 | 512); return new Response(new Uint8Array(icon), {headers: {"Content-Type": "image/png", "Cache-Control": "private, no-store"}}); } catch (e) {return apiError(e);}
}
