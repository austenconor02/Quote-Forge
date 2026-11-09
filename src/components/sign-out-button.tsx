"use client";
import { useState } from "react";
import { LogOut } from "lucide-react";
import { clearDocumentFiles } from "@/lib/documents/local-files";
export function SignOutButton({compact = false}: {compact?: boolean}) {
  const [error, setError] = useState("");
  async function signOut() {try {const csrf = await fetch("/api/session/csrf", {cache: "no-store"}); const {csrfToken} = await csrf.json(); const response = await fetch("/api/session", {method: "DELETE", headers: {"Content-Type": "application/json"}, body: JSON.stringify({csrfToken})}); if (!response.ok) throw new Error(); await clearDocumentFiles(); window.location.assign("/login");} catch {setError("Sign-out could not be completed. Try again.");}}
  return <div><button type="button" className={compact ? "tenant-install" : "button secondary"} onClick={() => void signOut()}><LogOut size={15}/><span>Sign out</span></button>{error && <p role="alert" className="form-error">{error}</p>}</div>;
}
