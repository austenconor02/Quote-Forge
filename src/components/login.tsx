"use client";
import { useState } from "react";
import { ShieldCheck, ArrowRight, LockKeyhole } from "lucide-react";
import { Wordmark } from "./ui";
export function Login({invitationToken}: {invitationToken?: string}) {
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  async function signIn() {
    setLoading(true); setError("");
    try {
      if (process.env.NEXT_PUBLIC_FIREBASE_ENABLED !== "true") throw new Error("Google sign-in needs the QuoteForge Firebase web app configuration.");
      const [{initializeApp, getApps}, {getAuth, GoogleAuthProvider, signInWithPopup, signOut, setPersistence, inMemoryPersistence, connectAuthEmulator}] = await Promise.all([import("firebase/app"), import("firebase/auth")]);
      const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
      if (projectId !== "quote-forge-b153f" && !(process.env.NODE_ENV === "development" && process.env.NEXT_PUBLIC_USE_EMULATORS === "true" && projectId === "demo-quoteforge")) throw new Error("The Firebase web app must belong to QuoteForge.");
      const app = getApps().find(app => app.name === "quoteforge-browser") || initializeApp({apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY, authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN, projectId, appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID}, "quoteforge-browser");
      const auth = getAuth(app);
      if (process.env.NODE_ENV === "development" && process.env.NEXT_PUBLIC_USE_EMULATORS === "true" && !auth.emulatorConfig) connectAuthEmulator(auth, "http://127.0.0.1:9099", {disableWarnings: true});
      await setPersistence(auth, inMemoryPersistence);
      const provider = new GoogleAuthProvider(); provider.setCustomParameters({prompt: "select_account"});
      const credential = await signInWithPopup(auth, provider);
      try {
        const csrfResponse = await fetch("/api/session/csrf", {cache: "no-store", credentials: "same-origin"});
        if (!csrfResponse.ok) throw new Error("A secure sign-in request could not be started.");
        const {csrfToken} = await csrfResponse.json();
        for (let attempt = 0; attempt < 2; attempt++) {
          const response = await fetch("/api/session", {method: "POST", credentials: "same-origin", headers: {"Content-Type": "application/json"}, body: JSON.stringify({idToken: await credential.user.getIdToken(attempt > 0), csrfToken, ...(invitationToken ? {invitationToken} : {})})});
          const result = await response.json();
          if (!response.ok) throw new Error(result.error || "Access could not be verified.");
          if (result.refreshRequired && attempt === 0) continue;
          if (result.refreshRequired) throw new Error("Your owner permissions are being updated. Please sign in again.");
          if (typeof result.next !== "string" || !result.next.startsWith("/") || result.next.startsWith("//") || result.next.includes("\\")) throw new Error("An authorized workspace could not be selected.");
          window.location.assign(result.next); return;
        }
      } finally {await signOut(auth);}
    } catch (cause) {setError(cause instanceof Error ? cause.message : "Unable to sign in.");}
    finally {setLoading(false);}
  }
  return <main className="login-page"><div className="login-card"><Wordmark/><div className="login-symbol"><LockKeyhole size={28}/></div><h1>{invitationToken ? "Accept your invitation" : "Sign in to QuoteForge"}</h1><p>{invitationToken ? "Continue with the Google account that received this invitation." : "Use your authorized Google account to open your workspace."}</p><button className="button primary full" onClick={() => void signIn()} disabled={loading}>{loading ? "Verifying access…" : "Continue with Google"}<ArrowRight size={17}/></button>{error && <p className="form-error" role="alert">{error}</p>}<div className="secure-note"><ShieldCheck size={15}/>Verified Google accounts and assigned access only.</div></div></main>;
}
