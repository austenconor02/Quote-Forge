"use client";
import Link from "next/link";
import { Settings } from "lucide-react";
import { Wordmark } from "./ui";
import { TutorialHelpButton } from "./owner-tutorial";
import { useWorkspace } from "./workspace-provider";
import { SignOutButton } from "./sign-out-button";

export function OwnerShell({ children }: { children: React.ReactNode }) {
  const {demo} = useWorkspace();
  return <div className="owner-clean">
    <header className="owner-header"><div className="owner-header-inner">
      <Link href="/" className="owner-brand" aria-label="QuoteForge · My Companies"><Wordmark/></Link>
      <div className="owner-header-tools"><TutorialHelpButton/><Link href="/settings" className="owner-settings-link" aria-label="Settings and account" title="Settings and account"><Settings size={18}/><span>Settings</span></Link>{!demo && <SignOutButton/>}</div>
    </div></header>
    <main className="owner-main">{children}</main>
  </div>;
}
