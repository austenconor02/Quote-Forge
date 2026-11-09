"use client";

import type { PDFDocumentLoadingTask } from "pdfjs-dist";
import type { Worker as OcrWorker } from "tesseract.js";
import { documentInputError, documentType, MAX_DOCUMENT_PAGES, MAX_EXTRACTED_CHARACTERS } from "./source";

export type ExtractionProgress = { progress: number; label: string };
export type ExtractionResult = { text: string; pageCount: number; method: "embedded" | "ocr" | "mixed" };
type Options = { signal?: AbortSignal; onProgress?: (progress: ExtractionProgress) => void; timeoutMs?: number };
const MAX_IMAGE_PIXELS = 24000000;
const MAX_RENDER_PIXELS = 12000000;
const MAX_IMAGE_EDGE = 2600;
const ASSETS = "/document-assets";

function abortError(signal: AbortSignal) { return signal.reason instanceof Error ? signal.reason : new DOMException("Document processing cancelled.", "AbortError"); }
function checkAbort(signal: AbortSignal) { if (signal.aborted) throw abortError(signal); }
function absolute(path: string) { return new URL(path, window.location.origin).href; }
function checkedText(text: string) {
  const clean = text.replace(/\u0000/g, "").trim();
  if (clean.length > MAX_EXTRACTED_CHARACTERS) throw new Error("This document contains too much text. Split it into smaller documents (maximum 200,000 characters per file).");
  return clean;
}
async function imageCanvas(blob: Blob, signal: AbortSignal): Promise<HTMLCanvasElement> {
  checkAbort(signal);
  const bitmap = await createImageBitmap(blob);
  try {
    checkAbort(signal);
    if (bitmap.width * bitmap.height > MAX_IMAGE_PIXELS) throw new Error("This image is too large to process safely. Resize it below 24 megapixels and add it again.");
    const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Your browser could not prepare this image for OCR.");
    context.fillStyle = "white"; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally { bitmap.close(); }
}

/** All source processing happens in this browser. Workers, model data, and PDF assets use the app origin. */
export async function processDocument(file: File, options: Options = {}): Promise<ExtractionResult> {
  const inputError = documentInputError(file.name, file.size);
  if (inputError) throw new Error(inputError);
  const controller = new AbortController();
  const signal = controller.signal;
  const onExternalAbort = () => controller.abort(options.signal?.reason);
  options.signal?.addEventListener("abort", onExternalAbort, { once: true });
  if (options.signal?.aborted) onExternalAbort();
  const timeout = setTimeout(() => controller.abort(new Error("Document processing timed out. Try a smaller document or a clearer image, then retry.")), options.timeoutMs ?? 180000);
  let worker: OcrWorker | undefined;
  let loading: PDFDocumentLoadingTask | undefined;
  let ocrPosition = { index: 0, count: 1 };
  let ocrPromise: Promise<OcrWorker> | undefined;
  const report = (progress: number, label: string) => { checkAbort(signal); options.onProgress?.({ progress: Math.max(0, Math.min(1, progress)), label }); };
  const stop = () => { void worker?.terminate().catch(() => {}); void loading?.destroy().catch(() => {}); };
  signal.addEventListener("abort", stop, { once: true });

  async function recognize(canvas: HTMLCanvasElement, pageIndex: number, pageCount: number): Promise<string> {
    ocrPosition = { index: pageIndex, count: pageCount };
    if (!ocrPromise) {
      const { createWorker, OEM } = await import("tesseract.js");
      checkAbort(signal);
      ocrPromise = createWorker("eng", OEM.LSTM_ONLY, {
        workerPath: absolute(`${ASSETS}/tesseract/worker.min.js`),
        corePath: absolute(`${ASSETS}/tesseract/core`), langPath: absolute(`${ASSETS}/tesseract/lang`),
        workerBlobURL: false, gzip: true, cacheMethod: "none",
        logger: message => { if (!signal.aborted) report((ocrPosition.index + Math.max(.05, Math.min(.95, message.progress || 0))) / ocrPosition.count, `${message.status === "recognizing text" ? "Reading text" : "Preparing OCR"} · page ${ocrPosition.index + 1} of ${ocrPosition.count}`); },
        errorHandler: () => { /* createWorker/recognize promises deliver failures to the document row. */ }
      }).then(async created => {
        worker = created;
        if (signal.aborted) { await created.terminate(); throw abortError(signal); }
        await created.setParameters({ preserve_interword_spaces: "1", user_defined_dpi: "200" });
        return created;
      });
    }
    const ready = await ocrPromise;
    checkAbort(signal);
    const result = await ready.recognize(canvas, { rotateAuto: true }, { text: true });
    checkAbort(signal);
    return checkedText(result.data.text || "");
  }

  const work = async (): Promise<ExtractionResult> => {
    report(.01, "Opening document");
    const kind = documentType(file.name);
    if (kind === "pdf") {
      const pdfjs = await import("pdfjs-dist");
      checkAbort(signal);
      pdfjs.GlobalWorkerOptions.workerSrc = absolute(`${ASSETS}/pdf.worker.min.mjs`);
      loading = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false, useSystemFonts: true, cMapUrl: absolute(`${ASSETS}/pdfjs/cmaps/`), cMapPacked: true, standardFontDataUrl: absolute(`${ASSETS}/pdfjs/standard_fonts/`), wasmUrl: absolute(`${ASSETS}/pdfjs/wasm/`) });
      const pdf = await loading.promise;
      if (pdf.numPages > MAX_DOCUMENT_PAGES) throw new Error(`This PDF has ${pdf.numPages} pages. Split it into files of ${MAX_DOCUMENT_PAGES} pages or fewer.`);
      const pages: string[] = [];
      let embedded = 0, ocr = 0;
      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
        checkAbort(signal);
        report((pageNumber - 1) / pdf.numPages, `Reading PDF · page ${pageNumber} of ${pdf.numPages}`);
        const page = await pdf.getPage(pageNumber);
        try {
          const content = await page.getTextContent();
          let text = content.items.map(item => "str" in item ? item.str + (item.hasEOL ? "\n" : " ") : "").join("").replace(/[ \t]+\n/g, "\n").trim();
          const nativeText = text;
          const characterCount = nativeText.replace(/[^a-zA-Z0-9]/g, "").length;
          const readable = characterCount >= 30;
          // Scanned pages sometimes include a small selectable header/page number.
          // Inspect raster operations so that such headers cannot hide the scanned body.
          const operations = readable && characterCount < 200 ? await page.getOperatorList() : undefined;
          const rasterOperations = new Set([pdfjs.OPS.paintImageXObject, pdfjs.OPS.paintInlineImageXObject, pdfjs.OPS.paintImageXObjectRepeat, pdfjs.OPS.paintImageMaskXObject]);
          const rasterWithSparseText = !!operations?.fnArray.some(operation => rasterOperations.has(operation));
          let method = "embedded text";
          if (readable && !rasterWithSparseText) embedded++;
          else {
            method = "OCR"; ocr++;
            const base = page.getViewport({ scale: 1 });
            const scale = Math.min(2.25, Math.sqrt(MAX_RENDER_PIXELS / (base.width * base.height)));
            const viewport = page.getViewport({ scale });
            const canvas = document.createElement("canvas"); canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
            try {
              const render = page.render({ canvas, viewport, background: "rgb(255,255,255)" });
              const cancel = () => render.cancel(); signal.addEventListener("abort", cancel, { once: true });
              try { await render.promise; } finally { signal.removeEventListener("abort", cancel); }
              text = await recognize(canvas, pageNumber - 1, pdf.numPages);
              if (readable) { embedded++; method = "embedded text + OCR"; text = `[Embedded text]\n${nativeText}\n\n[OCR text]\n${text}`; }
            } finally { canvas.width = 0; canvas.height = 0; }
          }
          if (text.trim()) pages.push(`[Page ${pageNumber} · ${method}]\n${text.trim()}`);
          else pages.push(`[Page ${pageNumber} · no readable text]`);
          checkedText(pages.join("\n\n"));
          report(pageNumber / pdf.numPages, `Read page ${pageNumber} of ${pdf.numPages}`);
        } finally { page.cleanup(); }
      }
      const text = checkedText(pages.join("\n\n"));
      if (pages.every(page => /\[Page \d+ · no readable text\]$/.test(page))) throw new Error("No readable text was found in this PDF. Try a clearer scan or paste the source text.");
      return { text, pageCount: pdf.numPages, method: ocr && embedded ? "mixed" : ocr ? "ocr" : "embedded" };
    }
    let images: Blob[] = [file];
    if (kind === "heic") {
      report(.02, "Converting HEIC / HEIF image");
      const { default: convert } = await import("heic2any");
      checkAbort(signal);
      const converted = await convert({ blob: file, toType: "image/jpeg", quality: .95, multiple: true });
      images = Array.isArray(converted) ? converted : [converted];
      if (images.length > MAX_DOCUMENT_PAGES) throw new Error("This HEIC file contains too many images. Export the required images individually and try again.");
    }
    const texts: string[] = [];
    for (const [index, image] of images.entries()) {
      checkAbort(signal);
      const canvas = await imageCanvas(image, signal);
      try { const text = await recognize(canvas, index, images.length); if (text) texts.push(images.length > 1 ? `[Image ${index + 1}]\n${text}` : text); }
      finally { canvas.width = 0; canvas.height = 0; }
    }
    const text = checkedText(texts.join("\n\n"));
    if (!text) throw new Error("No readable text was found. Try a sharper, well-lit image or paste the source text.");
    report(1, "Text extracted");
    return { text, pageCount: images.length, method: "ocr" };
  };

  let rejectAbort: (reason: unknown) => void = () => {};
  const aborted = new Promise<never>((_, reject) => { rejectAbort = reject; });
  const rejectOnAbort = () => rejectAbort(abortError(signal));
  signal.addEventListener("abort", rejectOnAbort, { once: true });
  try {
    checkAbort(signal);
    return await Promise.race([work(), aborted]);
  } catch (error) {
    if (signal.aborted) throw abortError(signal);
    const message = error instanceof Error ? error.message : typeof error === "string" ? error : "This document could not be read.";
    if (/password/i.test(message)) throw new Error("This PDF is password protected. Save an unlocked copy and add it again.");
    if (/invalid pdf|no pdf header|pdf structure/i.test(message)) throw new Error("This file is not a readable PDF. Export a new copy and add it again.");
    if (/source image could not be decoded|invalid image|image.*decode/i.test(message)) throw new Error("This image could not be decoded. Export a new PNG, JPEG, or HEIC copy and add it again.");
    if (/fetch|network|traineddata|importScripts/i.test(message)) throw new Error("The local OCR or PDF worker assets could not be loaded. Check the app connection and retry.");
    throw new Error(message);
  } finally {
    clearTimeout(timeout); options.signal?.removeEventListener("abort", onExternalAbort);
    signal.removeEventListener("abort", stop); signal.removeEventListener("abort", rejectOnAbort);
    await worker?.terminate().catch(() => {}); await loading?.destroy().catch(() => {});
  }
}
