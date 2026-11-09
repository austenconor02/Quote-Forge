import test from "node:test";
import assert from "node:assert/strict";
import { clearDocumentFiles, getDocumentFile, setDocumentCacheScope, storeDocumentFile } from "../src/lib/documents/local-files";

test("original-file cache is isolated by signed-in UID and sign-out preserves other users and legacy local progress", async () => {
  const documentId = "same-shared-company-document";
  const local = new File(["Local original"], "local.pdf", {type:"application/pdf"});
  const alice = new File(["Alice original"], "alice.pdf", {type:"application/pdf"});
  const bob = new File(["Bob original"], "bob.pdf", {type:"application/pdf"});
  try {
    setDocumentCacheScope("local"); await storeDocumentFile(documentId, local);
    setDocumentCacheScope("alice-uid"); assert.equal(await getDocumentFile(documentId), undefined); await storeDocumentFile(documentId, alice);
    setDocumentCacheScope("bob-uid"); assert.equal(await getDocumentFile(documentId), undefined); await storeDocumentFile(documentId, bob);
    assert.equal(await (await getDocumentFile(documentId))!.text(), "Bob original");
    await clearDocumentFiles(); assert.equal(await getDocumentFile(documentId), undefined);
    setDocumentCacheScope("alice-uid"); assert.equal(await (await getDocumentFile(documentId))!.text(), "Alice original");
    setDocumentCacheScope("local"); assert.equal(await (await getDocumentFile(documentId))!.text(), "Local original");
    await clearDocumentFiles(); assert.equal(await (await getDocumentFile(documentId))!.text(), "Local original");
  } finally {setDocumentCacheScope("local");}
});
