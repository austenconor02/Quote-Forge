import "server-only";
import { AccessError } from "./auth";
export async function readJson(request: Request, maxBytes = 24000): Promise<Record<string, unknown>> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) throw new AccessError(415, "JSON content is required.");
  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > maxBytes) throw new AccessError(413, "Request is too large.");
  const reader = request.body?.getReader();
  if (!reader) throw new AccessError(400, "Request body is required.");
  let length = 0; const chunks: Uint8Array[] = [];
  try { while (true) {const {done, value} = await reader.read(); if (done) break; length += value.length; if (length > maxBytes) {await reader.cancel(); throw new AccessError(413, "Request is too large.");} chunks.push(value);} }
  finally { reader.releaseLock(); }
  try {const value = JSON.parse(Buffer.concat(chunks).toString("utf8")); if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(); return value;} catch {throw new AccessError(400, "Invalid JSON request.");}
}
