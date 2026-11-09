"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useWorkspace } from "./workspace-provider";
export function LegacyOwnerRoute({ feature }: { feature: "branding" | "preview" | "invitations" }) {
  const { ready, company } = useWorkspace();
  const router = useRouter();
  useEffect(() => { if (!ready) return; router.replace(company ? feature === "preview" ? `/companies/${company.id}/open` : `/companies/${company.id}/edit?step=${feature === "branding" ? 1 : 3}` : "/"); }, [company, feature, ready, router]);
  return <div className="owner-loading" role="status">Opening company…</div>;
}
