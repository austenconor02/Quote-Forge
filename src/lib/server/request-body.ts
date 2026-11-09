import "server-only";
import { AccessError } from "./auth";

export async function boundedBytes(request: Request, maxBytes: number): Promise<Buffer> {
  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > maxBytes) throw new AccessError(413, "The request exceeds the size limit.");
  if (!request.body) return Buffer.alloc(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) { const {done, value} = await reader.read(); if (done) break; size += value.byteLength; if (size > maxBytes) { await reader.cancel(); throw new AccessError(413, "The request exceeds the size limit."); } chunks.push(value); }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks, size);
}
export async function boundedJson(request: Request, maxBytes = 4 * 1024 * 1024): Promise<unknown> {
  if (!(request.headers.get("content-type") || "").toLowerCase().startsWith("application/json")) throw new AccessError(415, "Use an application/json request.");
  try { return JSON.parse((await boundedBytes(request, maxBytes)).toString("utf8")); }
  catch (error) { if (error instanceof AccessError) throw error; throw new AccessError(400, "The request contains invalid JSON."); }
}
