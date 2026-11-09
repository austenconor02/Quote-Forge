import { requireTenant } from "@/lib/server/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
export default async function Install({params}: {params: Promise<{companyId: string}>}) {
  const {companyId} = await params;
  try {await requireTenant(companyId);} catch {redirect("/login");}
  return <main className="setup-page"><h1>Your company, a tap away.</h1><p>On iPhone: open your company workspace in Safari, tap Share, then Add to Home Screen. On Android or desktop: use Chrome’s Install app option.</p><p>Installation becomes available in Phase 2 after the company logo, tenant manifest, icons, HTTPS, and authentication are connected.</p><Link className="button primary" href={`/app/${companyId}`} style={{marginTop: 25}}>Open company workspace →</Link></main>;
}
