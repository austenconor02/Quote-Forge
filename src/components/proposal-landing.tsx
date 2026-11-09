"use client";
import { useEffect, useRef, useState } from "react";
import styles from "./proposal-landing.module.css";

export function ProposalLanding() {
  const captured = useRef(false);
  const [token, setToken] = useState<string | null>(null);
  const [pdfUrl, setPdfUrl] = useState("");
  const [fileName, setFileName] = useState("proposal.pdf");
  const [error, setError] = useState("");
  // Capture separately from the request effect: StrictMode must not abort the only token request.
  useEffect(() => {
    if (captured.current) return;
    captured.current = true;
    const fragment = window.location.hash;
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
    const match = /^#token=([A-Za-z0-9_-]{43})$/.exec(fragment);
    if (!match) {setError("This proposal link is incomplete. Ask the company for a new link."); setToken(""); return;}
    setToken(match[1]);
  }, []);
  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    let objectUrl = "";
    async function load() {
      try {
        const response = await fetch("/api/proposals/download", {method: "POST", credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer", signal: controller.signal, headers: {"Content-Type": "application/json"}, body: JSON.stringify({token})});
        if (!response.ok || !(response.headers.get("content-type") || "").startsWith("application/pdf")) throw new Error("This proposal link is unavailable or has expired. Ask the company for a new link.");
        const blob = await response.blob();
        if (controller.signal.aborted) return;
        if (!blob.size || blob.size > 10 * 1024 * 1024) throw new Error("This proposal could not be opened. Ask the company for a new link.");
        const name = /filename="(proposal-[A-Za-z0-9-]+\.pdf)"/.exec(response.headers.get("content-disposition") || "")?.[1];
        if (name) setFileName(name);
        objectUrl = URL.createObjectURL(blob); setPdfUrl(objectUrl);
      } catch (failure) {if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "The proposal could not be opened. Please try again later.");}
    }
    void load();
    return () => {controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl);};
  }, [token]);
  return <main className={styles.page}>
    <header className={styles.header}><div><p className={styles.eyebrow}>PROJECT PROPOSAL</p><h1>Your proposal</h1><p>View your project details and download a copy for your records.</p></div>{pdfUrl && <a className={styles.download} href={pdfUrl} download={fileName}>Download PDF</a>}</header>
    {error ? <div className={styles.message} role="alert"><h2>Proposal unavailable</h2><p>{error}</p></div> : pdfUrl ? <iframe className={styles.preview} title="Your project proposal PDF" src={pdfUrl}/> : <div className={styles.message} role="status"><h2>Opening your proposal…</h2><p>Please wait while your document loads.</p></div>}
    <p className={styles.footer}>Questions about this proposal? Contact the company listed in the document. Proposal links expire after seven days.</p>
  </main>;
}
