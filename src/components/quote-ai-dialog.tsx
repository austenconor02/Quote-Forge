"use client";
import { useState, type RefObject } from "react";
import type { Quote, QuoteSourceInput } from "@/lib/models";
import type { AiDraftResult } from "@/lib/ai-quote";
import { cloudRequest, uploadCloudSources } from "@/lib/cloud-repository";
import { hasUnresolvedDocuments } from "@/lib/documents/source";
import { Modal } from "./ui";

export type GenerationAttempt = {fingerprint: string; id: string};
export function QuoteAiDialog({quote, attempt, onClose, onPrepared, onApply}: {
  quote: Quote; attempt: RefObject<GenerationAttempt | null>; onClose: () => void;
  onPrepared: (sources: QuoteSourceInput) => void; onApply: (result: AiDraftResult) => void;
}) {
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [failed, setFailed] = useState(false), [label, setLabel] = useState("");
  const source = quote.sourceInput;
  const fingerprint = JSON.stringify([quote.companyId, quote.id, source?.pastedText, source?.specialInstructions, source?.documents.map(document => [document.id, document.sha256])]);
  const canGenerate = !!source && !hasUnresolvedDocuments(source) && (!!source.pastedText.trim() || source.documents.length > 0);
  const currentAttempt = attempt.current?.fingerprint === fingerprint ? attempt.current : null;
  async function generate(fresh = false) {
    if (busy || !canGenerate || !source) return;
    setBusy(true); setError(""); setFailed(false); setLabel("Saving selected sources privately…");
    try {
      const prepared = await uploadCloudSources(quote.companyId, source); onPrepared(prepared);
      if (fresh || !attempt.current || attempt.current.fingerprint !== fingerprint) attempt.current = {fingerprint, id: crypto.randomUUID()};
      setLabel("Reading sources and compiling the draft. This may take a few minutes…");
      const {result} = await cloudRequest("/api/proposals/generate", {method: "POST", headers: {"Content-Type": "application/json"},
        body: JSON.stringify({companyId: quote.companyId, requestId: attempt.current.id, documentIds: prepared.documents.map(document => document.id), pastedText: prepared.pastedText, specialInstructions: prepared.specialInstructions})});
      onApply(result); onClose();
    } catch (cause) {setError(cause instanceof Error ? cause.message : "Generation was not confirmed. Your current proposal is preserved.");}
    finally {setBusy(false); setLabel("");}
  }
  async function check() {
    if (!currentAttempt || busy) return;
    setBusy(true); setError("");
    try {
      const result = await cloudRequest(`/api/proposals/generate?companyId=${encodeURIComponent(quote.companyId)}&requestId=${currentAttempt.id}`);
      if (result.status === "completed") {onApply(result.result); onClose();}
      else if (result.status === "failed") {setFailed(true); setError("The previous generation did not complete. You can explicitly start a new generation; it is a new API request.");}
      else if (result.status === "uncertain") {setFailed(true); setError("The previous request expired without a confirmed result. It may have incurred API usage. Starting a new generation submits a separate paid request.");}
      else setError("The submitted request is still running. Check its status again shortly; do not submit another request.");
    } catch (cause) {setError(cause instanceof Error ? cause.message : "Status could not be checked.");}
    finally {setBusy(false);}
  }
  return <Modal title="Compile an AI draft" onClose={() => {if (!busy) onClose();}}>
    <p>Your selected documents, images, pasted scope, and instructions will be sent to OpenAI for this company. The result will replace the current line items after successful generation. Customer form fields and private markup are not added to the request. Selected files may contain customer information.</p>
    <p>Every suggested item and price requires your review. Missing or conflicting prices are flagged; totals and the branded PDF are calculated by QuoteForge.</p>
    {!canGenerate && <p className="notice">Add source information and finish or remove unresolved documents first.</p>}
    {label && <p role="status">{label}</p>}
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="form-actions"><button className="button secondary" disabled={busy} onClick={onClose}>Keep my proposal</button>
      {currentAttempt && <button className="button secondary" disabled={busy} onClick={() => void check()}>Check generation status</button>}
      <button className="button primary" disabled={busy || !canGenerate} onClick={() => void generate(failed)}>{busy ? "Compiling…" : failed ? "Start a new generation" : "Generate AI draft"}</button>
    </div>
  </Modal>;
}
