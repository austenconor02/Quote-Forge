import { requireOwnerPage } from "@/lib/server/auth";
import { WorkspaceProvider } from "@/components/workspace-provider";
import { OwnerShell } from "@/components/owner-shell";
import { OwnerTutorialProvider } from "@/components/owner-tutorial";

export const metadata = { icons: { icon: { url: "/brand/quoteforge-logo-256.webp", type: "image/webp" } } };

export default async function OwnerLayout({ children }: { children: React.ReactNode }) {
  const session = await requireOwnerPage();
  return <WorkspaceProvider demo={session.demo} cacheScope={session.uid}><OwnerTutorialProvider><OwnerShell>{children}</OwnerShell></OwnerTutorialProvider></WorkspaceProvider>;
}
