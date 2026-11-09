import { copyFile, cp, mkdir, readdir, access } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const root = process.cwd();
const output = resolve(root, "public/document-assets");
const pdf = resolve(require.resolve("pdfjs-dist/package.json"), "..");
const ocr = resolve(require.resolve("tesseract.js/package.json"), "..");
const core = resolve(require.resolve("tesseract.js-core/package.json"), "..");
await mkdir(join(output, "tesseract/core"), { recursive: true });
await mkdir(join(output, "tesseract/lang"), { recursive: true });
await copyFile(join(pdf, "build/pdf.worker.min.mjs"), join(output, "pdf.worker.min.mjs"));
await copyFile(join(pdf, "build/pdf.min.mjs"), join(output, "pdf.min.mjs"));
for (const directory of ["cmaps", "standard_fonts", "wasm"]) await cp(join(pdf, directory), join(output, "pdfjs", directory), { recursive: true });
await copyFile(join(pdf, "LICENSE"), join(output, "pdfjs/LICENSE"));
await copyFile(join(ocr, "dist/worker.min.js"), join(output, "tesseract/worker.min.js"));
await copyFile(join(ocr, "dist/worker.min.js.LICENSE.txt"), join(output, "tesseract/worker.min.js.LICENSE.txt"));
for (const name of await readdir(core)) if (/^tesseract-core.*\.(wasm|js)$/.test(name)) await copyFile(join(core, name), join(output, "tesseract/core", name));
await copyFile(join(core, "LICENSE"), join(output, "tesseract/core/LICENSE"));
try { await access(join(output, "tesseract/lang/eng.traineddata.gz")); console.log("Document worker, PDF resources, OCR core, and English language assets are ready."); }
catch { throw new Error("English OCR data is missing: public/document-assets/tesseract/lang/eng.traineddata.gz. Restore the committed model before building or deploying."); }
