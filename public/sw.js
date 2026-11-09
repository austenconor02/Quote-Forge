/* Phase 2 opt-in only. Not registered in Phase 1.
   Deliberately does not cache authenticated pages, APIs, documents, or proposal data. */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));
