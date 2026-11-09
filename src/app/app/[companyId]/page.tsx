import { requireTenant } from "@/lib/server/auth";
import { redirect } from "next/navigation";
import { TenantDemo } from "@/components/tenant-demo";
import { TenantCloud } from "@/components/tenant-cloud";
export default async function CompanyApp({params}: {params: Promise<{companyId: string}>}) {
  const {companyId} = await params;
  let demo = false;
  let uid = "";
  try { const session = await requireTenant(companyId); demo = session.demo; uid = session.uid; } catch { redirect("/login"); }
  if (!demo) return <TenantCloud companyId={companyId} cacheScope={uid}/>;
  return <TenantDemo companyId={companyId}/>;
}
