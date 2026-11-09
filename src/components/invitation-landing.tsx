"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Login } from "./login";
export function InvitationLanding() {
  const [token, setToken] = useState<string | null>(null);
  const consumed = useRef(false);
  useEffect(() => {if (consumed.current) return; consumed.current = true; const value = new URLSearchParams(window.location.hash.slice(1)).get("token"); window.history.replaceState(null, "", window.location.pathname); setToken(value && /^[A-Za-z0-9_-]{43}$/.test(value) ? value : "");}, []);
  if (token === null) return <main className="setup-page"><p>Checking invitation…</p></main>;
  if (!token) return <main className="setup-page"><h1>Invitation link required</h1><p>Open the complete link from your invitation email. Expired or replaced invitations require a new link from the platform owner.</p><Link className="button secondary" href="/login" style={{marginTop: 20}}>Already have access? Sign in</Link></main>;
  return <Login invitationToken={token}/>;
}
