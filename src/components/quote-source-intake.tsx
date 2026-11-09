"use client";

import { ClipboardEvent, useEffect, useRef } from "react";
import { UploadCloud, FileText, Mail, Trash2, Sparkles, ArrowRight, Clipboard, AlertCircle, Clock3, CheckCircle2, RotateCcw, Download } from "lucide-react";
import { QuoteSourceDocument, QuoteSourceInput, newId } from "@/lib/models";
import { combineQuoteSources, documentInputError, hasUnresolvedDocuments, MAX_DOCUMENTS } from "@/lib/documents/source";
import { processDocument } from "@/lib/documents/process";
import { getDocumentCacheScope, getDocumentFile, storeDocumentFile, removeDocumentFile } from "@/lib/documents/local-files";

type Props = { value?: QuoteSourceInput; onChange: (value: QuoteSourceInput) => void; onGenerate: () => void; previewOnly?: boolean; loadDocumentFile?: (document: QuoteSourceDocument) => Promise<File | undefined> };
type Job = { id: string; file?: File; controller: AbortController; running: boolean; cacheScope: string };
const emptySource: QuoteSourceInput = { pastedText: "", specialInstructions: "", documents: [] };

export function QuoteSourceIntake({ value = emptySource, onChange, onGenerate, previewOnly = false, loadDocumentFile }: Props) {
  const picker = useRef<HTMLInputElement>(null);
  const latest = useRef(value); latest.current = value;
  const change = useRef(onChange); change.current = onChange;
  const cloudLoad = useRef(loadDocumentFile); cloudLoad.current = loadDocumentFile;
  const jobs = useRef(new Map<string, Job>());
  const checked = useRef(new Set<string>());
  const resumed = useRef(new Set<string>());
  const active = useRef(0);
  const mounted = useRef(true);
  const pump = useRef<() => void>(() => {});
  function commit(update: (input: QuoteSourceInput) => QuoteSourceInput) {
    if (!mounted.current) return;
    const next = update(latest.current); latest.current = next; change.current(next);
  }
  function patchDocument(id: string, patch: Partial<QuoteSourceDocument>) {
    commit(input => ({ ...input, documents: input.documents.map(document => document.id === id ? { ...document, ...patch } : document) }));
  }
  async function run(job: Job) {
    try {
      let file = job.file || await getDocumentFile(job.id, job.cacheScope);
      const metadata = latest.current.documents.find(document => document.id === job.id);
      if (!file && metadata?.storagePath && cloudLoad.current) file = await cloudLoad.current(metadata);
      if (job.controller.signal.aborted) return;
      if (!file) throw new Error("The original file is unavailable on this device. Remove this entry and add the file again.");
      patchDocument(job.id, { status: "processing", progress: 0, error: undefined, progressLabel: "Saving original file privately" });
      const persisted = await storeDocumentFile(job.id, file, job.cacheScope);
      if (job.controller.signal.aborted) return;
      const bytes = await file.arrayBuffer();
      const hash = await crypto.subtle.digest("SHA-256", bytes);
      const sha256 = Array.from(new Uint8Array(hash)).map(value => value.toString(16).padStart(2, "0")).join("");
      patchDocument(job.id, { sha256, localFileAvailable: true, progressLabel: persisted ? "Original file saved in this browser" : "Original file retained for this session only" });
      const result = await processDocument(file, { signal: job.controller.signal, onProgress: update => patchDocument(job.id, { status: "processing", progress: update.progress, progressLabel: update.label }) });
      if (job.controller.signal.aborted) return;
      patchDocument(job.id, { status: "ready", progress: 1, progressLabel: persisted ? "Text extracted · Original file saved in this browser" : "Text extracted · Original file available for this session only", extractedText: result.text, pageCount: result.pageCount, extractionMethod: result.method, error: undefined, localFileAvailable: true });
    } catch (error) {
      if (!job.controller.signal.aborted) patchDocument(job.id, { status: "error", progress: 0, progressLabel: undefined, error: error instanceof Error ? error.message : "This document could not be read. Try a different copy." });
    } finally {
      if (jobs.current.get(job.id) === job) jobs.current.delete(job.id);
      active.current = Math.max(0, active.current - 1);
      if (job.controller.signal.aborted && !latest.current.documents.some(document => document.id === job.id)) void removeDocumentFile(job.id, job.cacheScope);
      if (mounted.current) pump.current();
    }
  }
  pump.current = () => {
    const mobile = typeof window !== "undefined" && navigator.maxTouchPoints > 0 && window.innerWidth < 900;
    const concurrency = mobile || typeof navigator !== "undefined" && navigator.hardwareConcurrency <= 4 ? 1 : 2;
    while (mounted.current && active.current < concurrency) {
      const job = [...jobs.current.values()].find(candidate => !candidate.running);
      if (!job) break;
      job.running = true; active.current++; void run(job);
    }
  };
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; for (const job of jobs.current.values()) job.controller.abort(); jobs.current.clear(); resumed.current.clear(); checked.current.clear(); };
  }, []);
  useEffect(() => {
    const ids = new Set(value.documents.map(document => document.id));
    for (const job of jobs.current.values()) if (!ids.has(job.id)) { job.controller.abort(); jobs.current.delete(job.id); }
    for (const document of value.documents) {
      if (["pending", "processing"].includes(document.status) && !jobs.current.has(document.id) && !resumed.current.has(document.id)) {
        resumed.current.add(document.id);
        jobs.current.set(document.id, { id: document.id, controller: new AbortController(), running: false, cacheScope: getDocumentCacheScope() });
      } else if (document.status === "ready" && !checked.current.has(document.id)) {
        checked.current.add(document.id);
        void getDocumentFile(document.id).then(file => { if (mounted.current) patchDocument(document.id, { localFileAvailable: !!file }); });
      }
    }
    pump.current();
  }, [value.documents]);

  function addFiles(files: FileList | File[]) {
    let available = MAX_DOCUMENTS - latest.current.documents.filter(document => document.status !== "error").length;
    const documents: QuoteSourceDocument[] = Array.from(files).map(file => {
      const error = documentInputError(file.name, file.size) || (available <= 0 ? "The 10-document limit is reached. Remove a document and add this file again." : undefined);
      const id = newId();
      if (!error) {
        available--; resumed.current.add(id);
        jobs.current.set(id, { id, file, controller: new AbortController(), running: false, cacheScope: getDocumentCacheScope() });
      }
      return { id, name: file.name || "Pasted screenshot.png", size: file.size, mimeType: file.type, status: error ? "error" : "pending", progress: 0, ...(error ? { error } : { progressLabel: "Waiting to process" }) };
    });
    commit(input => ({ ...input, documents: [...input.documents, ...documents] }));
    if (picker.current) picker.current.value = "";
    pump.current();
  }
  function remove(document: QuoteSourceDocument) {
    const job = jobs.current.get(document.id); job?.controller.abort(); jobs.current.delete(document.id);
    commit(input => ({ ...input, documents: input.documents.filter(candidate => candidate.id !== document.id) }));
    void removeDocumentFile(document.id);
  }
  function retry(document: QuoteSourceDocument) {
    if (jobs.current.has(document.id)) return;
    jobs.current.set(document.id, { id: document.id, controller: new AbortController(), running: false, cacheScope: getDocumentCacheScope() });
    patchDocument(document.id, { status: "pending", error: undefined, progress: 0, progressLabel: "Waiting to retry" }); pump.current();
  }
  async function download(document: QuoteSourceDocument) {
    try {
      const file = await getDocumentFile(document.id) || (cloudLoad.current ? await cloudLoad.current(document) : undefined);
      if (!file) { patchDocument(document.id, { localFileAvailable: false, error: "The original file is unavailable. Its extracted text is retained; add the original again if needed." }); return; }
      const url = URL.createObjectURL(file); const anchor = window.document.createElement("a");
      anchor.href = url; anchor.download = document.name; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { patchDocument(document.id, { error: "The original file could not be downloaded. Sign in again or add a new copy; extracted text is retained." }); }
  }
  function handlePaste(event: ClipboardEvent<HTMLElement>) {
    if (event.clipboardData.files.length) { event.preventDefault(); addFiles(event.clipboardData.files); return; }
    if ((event.target as HTMLElement).closest("textarea, input")) return;
    const text = event.clipboardData.getData("text/plain");
    if (text) { event.preventDefault(); commit(input => ({ ...input, pastedText: [input.pastedText, text].filter(Boolean).join("\n\n") })); }
  }
  const busy = value.documents.some(document => document.status === "pending" || document.status === "processing");
  const failed = value.documents.some(document => document.status === "error");
  const combined = combineQuoteSources(value);
  const ready = value.documents.filter(document => document.status === "ready").length;

  return <section className="quote-section source-intake" aria-label="Quote source information" onPaste={handlePaste}>
    <div className="quote-section-heading"><span className="number-label">02</span><div><h3>Drop Anything Here</h3><p>Read PDFs, scans, photos, and pasted scope information.</p></div></div>
    <div className="document-drop source-drop" tabIndex={0} aria-label="Drop files or paste a screenshot" onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); addFiles(event.dataTransfer.files); }}>
      <UploadCloud size={30}/><strong>Drop Anything Here</strong><p>PDFs, emails, photos, screenshots, and iPhone images.</p>
      <button type="button" className="tenant-outline source-browse" onClick={() => picker.current?.click()}>Browse Files</button>
      <div className="source-file-types" aria-label="Supported input types">{["PDF", "PNG", "JPG / JPEG", "HEIC / HEIF", "Paste Text", "Paste Screenshot"].map(type => <span key={type}>{type}</span>)}</div>
      <small>Up to 10 documents · 20 MB / 30 pages per file · OCR runs privately in your browser</small>
      <input ref={picker} type="file" hidden multiple accept=".pdf,.png,.jpg,.jpeg,.webp,.heic,.heif" aria-label="Upload quote documents" onChange={event => { if (event.target.files) addFiles(event.target.files); }}/>
    </div>
    <div className="source-text-block"><div className="source-block-heading"><Mail size={17}/><div><label htmlFor="quote-source-text">Extracted / Pasted Text</label><p>Paste additional estimate, email, or scope text. Extracted file text stays linked to its source below.</p></div></div><textarea id="quote-source-text" rows={5} value={value.pastedText} onChange={event => commit(input => ({ ...input, pastedText: event.target.value }))} placeholder="Paste quote email details, estimate line items, or project scope here…"/></div>
    {value.documents.length > 0 && <div className="source-input-list"><div className="source-list-heading"><h4>Added Inputs</h4><span role="status" aria-live="polite">{ready} of {value.documents.length} extracted</span></div>{value.documents.map(document => <div className={`source-document ${document.status === "error" ? "has-error" : ""}`} key={document.id} data-document-id={document.id} data-document-status={document.status}><div className="source-input-row"><FileText size={18}/><div><strong>{document.name}</strong><span>{Math.max(1, Math.round(document.size / 1024))} KB · {document.pageCount ? `${document.pageCount} ${document.pageCount === 1 ? "page" : "pages"} · ` : ""}{document.extractionMethod === "mixed" ? "Embedded text + OCR" : document.extractionMethod === "embedded" ? "Embedded PDF text" : document.extractionMethod === "ocr" ? "OCR" : document.mimeType || "Document"}</span><p>{document.status === "error" ? <><AlertCircle size={11}/>{document.error}</> : document.status === "ready" ? <><CheckCircle2 size={11}/>{document.error ? document.error : document.extractedText?.includes("· no readable text]") ? "Some PDF pages have no readable text. Review the original before using this source." : document.storagePath ? "Text extracted · Original file saved in company storage" : document.localFileAvailable === false ? "Text retained · Original file unavailable on this device" : document.progressLabel || "Text extracted"}</> : <><Clock3 size={11}/>{document.progressLabel || "Waiting to process"}</>}</p></div><div className="source-document-actions">{document.status === "error" && (document.localFileAvailable || document.storagePath) && <button className="icon-button" type="button" aria-label={`Retry ${document.name}`} onClick={() => retry(document)}><RotateCcw size={14}/></button>}{document.status === "ready" && (document.localFileAvailable || document.storagePath) && <button className="icon-button" type="button" aria-label={`Download original ${document.name}`} onClick={() => void download(document)}><Download size={14}/></button>}<button className="icon-button" type="button" aria-label={`Remove ${document.name}`} onClick={() => remove(document)}><Trash2 size={15}/></button></div></div>{["pending", "processing"].includes(document.status) && <progress className="source-document-progress" max={1} value={document.progress || 0} aria-label={`Extraction progress for ${document.name}`}/>} {document.extractedText && <details className="source-extracted-text"><summary>View extracted text</summary><textarea readOnly rows={7} aria-label={`Extracted text from ${document.name}`} value={document.extractedText}/></details>}</div>)}</div>}
    {combined && <details className="source-combined-text"><summary>Review combined source text</summary><textarea readOnly rows={9} aria-label="Combined quote source text" value={combined}/></details>}
    <p className="source-paste-tip"><Clipboard size={14}/>Click the drop area and press Ctrl+V to add copied text or screenshots.</p>
    <div className="source-instructions"><label htmlFor="quote-special-instructions">Special Instructions for AI <span>Optional</span></label><p>Use this when the source needs special handling. These instructions stay out of customer PDFs.</p><textarea id="quote-special-instructions" rows={3} value={value.specialInstructions} onChange={event => commit(input => ({ ...input, specialInstructions: event.target.value }))} placeholder="e.g. Keep installation and materials separate. Ignore email signatures. Use only the service detail table."/></div>
    <div className="source-generate"><div><strong>Ready to build the AI draft?</strong><p id="source-generation-status">{busy ? "Wait for every document to finish extracting." : failed ? "Retry or remove failed documents before generating." : "Every proposal requires your review before it is sent."}</p></div><button className="tenant-button" type="button" onClick={onGenerate} disabled={hasUnresolvedDocuments(value)} aria-describedby="source-generation-status"><Sparkles size={16}/>Generate AI Draft<ArrowRight size={14}/></button></div>
    <div className="fixture-note"><span/>{previewOnly ? "Preview uses sample line items. " : ""}Text extraction is available. AI generation requires the separate server integration.</div>
  </section>;
}
