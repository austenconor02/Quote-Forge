import { requireTenant, AccessError } from "@/lib/server/auth";
import { redirect } from "next/navigation";
import { TenantDemo } from "@/components/tenant-demo";
import { TenantCloud } from "@/components/tenant-cloud";
export default async function CompanyApp({params}: {params: Promise<{companyId: string}>}) {
  const {companyId} = await params;
  let demo = false;
  let uid = "";
  try { const session = await requireTenant(companyId); demo = session.demo; uid = session.uid; } catch (error) {if (error instanceof AccessError && error.status === 402) return <main className="setup-page"><h1>Payment required</h1><p>Your company records are preserved. Contact the owner for your secure payment setup link. Access updates after Stripe confirms the subscription.</p><a className="button secondary" href="/login">Return to sign in</a></main>; redirect("/login"); }
  if (!demo) return <TenantCloud companyId={companyId} cacheScope={uid}/>;
  return <TenantDemo companyId={companyId}/>;
}
