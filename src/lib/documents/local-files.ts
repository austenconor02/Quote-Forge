"use client";

const DATABASE = "quoteforge-private-source-files";
const STORE = "files";
const sessionFiles = new Map<string, File>();
let currentScope = "local";
type StoredFile = { id: string; blob: Blob; name: string; lastModified: number; mimeType: string };

/** Set from the verified server session before rendering a cloud workspace. */
export function setDocumentCacheScope(scope: string): void { currentScope = scope || "local"; }
export function getDocumentCacheScope(): string { return currentScope; }
function cacheKey(id: string, scope: string) { return scope === "local" ? id : `uid:${encodeURIComponent(scope)}:${id}`; }

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") { reject(new Error("Private browser file storage is unavailable.")); return; }
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Private browser file storage is unavailable."));
    request.onblocked = () => reject(new Error("Private file storage is blocked by another browser tab."));
  });
}

async function transaction<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const database = await openDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = database.transaction(STORE, mode);
      const request = action(tx.objectStore(STORE));
      let result: T;
      request.onsuccess = () => { result = request.result; };
      request.onerror = () => reject(request.error || new Error("Private file storage failed."));
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error || new Error("Private file storage failed."));
      tx.onabort = () => reject(tx.error || new Error("Private file storage was interrupted."));
    });
  } finally { database.close(); }
}

/** Returns true when the original file was durably saved in IndexedDB, false for session-only fallback. */
export async function storeDocumentFile(id: string, file: File, scope = currentScope): Promise<boolean> {
  const key = cacheKey(id, scope);
  sessionFiles.set(key, file);
  try {
    await transaction("readwrite", store => store.put({ id: key, blob: file, name: file.name, lastModified: file.lastModified, mimeType: file.type } satisfies StoredFile));
    return true;
  } catch { return false; }
}

export async function getDocumentFile(id: string, scope = currentScope): Promise<File | undefined> {
  const key = cacheKey(id, scope);
  const cached = sessionFiles.get(key);
  if (cached) return cached;
  try {
    const stored = await transaction<StoredFile | undefined>("readonly", store => store.get(key));
    if (!stored) return undefined;
    const file = new File([stored.blob], stored.name, { type: stored.mimeType, lastModified: stored.lastModified });
    sessionFiles.set(key, file);
    return file;
  } catch { return undefined; }
}

export async function removeDocumentFile(id: string, scope = currentScope): Promise<void> {
  const key = cacheKey(id, scope);
  sessionFiles.delete(key);
  try { await transaction("readwrite", store => store.delete(key)); } catch { /* Removal from the current source list is independent of cache availability. */ }
}

/** Call on sign-out when a shared-device session should leave no original-file cache. */
export async function clearDocumentFiles(): Promise<void> {
  const scope = currentScope;
  if (scope === "local") return; // Development records are not a signed-in cloud account's cache.
  const prefix = `uid:${encodeURIComponent(scope)}:`;
  for (const key of sessionFiles.keys()) if (key.startsWith(prefix)) sessionFiles.delete(key);
  try {
    const database = await openDatabase();
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = database.transaction(STORE, "readwrite");
        const request = tx.objectStore(STORE).openCursor();
        request.onsuccess = () => { const cursor = request.result; if (!cursor) return; if (typeof cursor.primaryKey === "string" && cursor.primaryKey.startsWith(prefix)) cursor.delete(); cursor.continue(); };
        tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
      });
    } finally { database.close(); }
  } catch { /* Other users' caches and local development records are never cleared. */ }
}
