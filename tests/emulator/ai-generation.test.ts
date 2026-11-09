import { after, test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { Firestore } from "firebase-admin/firestore";
import { applicationDefault, deleteApp, initializeApp } from "firebase-admin/app";
import { getStorage } from "firebase-admin/storage";
import { PDFDocument } from "pdf-lib";
import { createAiGeneration } from "../../src/lib/server/ai-generation-core";
import { AccessError } from "../../src/lib/server/access-error";
import { privateDocumentPath } from "../../src/lib/server-input";

process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
process.env.FIREBASE_STORAGE_EMULATOR_HOST = "127.0.0.1:9199";
const projectId = "demo-quoteforge-ai-tests";
const db = new Firestore({projectId,host:"127.0.0.1:8080",ssl:false});
const app = initializeApp({projectId,storageBucket:`${projectId}.appspot.com`,credential:applicationDefault()},"ai-generation-tests");
const bucket = getStorage(app).bucket(), companies: string[] = [], objects: string[] = [];
async function fixture() {
  const companyId = `ai-${randomUUID()}`, uid = `user-${randomUUID()}`;
  companies.push(companyId); await db.doc(`companies/${companyId}`).set({id:companyId,status:"Active"});
  let enabled = true, authorized = true, calls = 0;
  let provider: () => Promise<void> = async()=>{};
  const service = createAiGeneration({
    authorize: async id => {if(id!==companyId || !authorized)throw new AccessError(403,"Company access denied");return {demo:false,uid};},
    services: ()=>({db,bucket,auth:{} } as never), configured:()=>enabled, rateLimit:async()=>{},
    assertAccess:async()=>{if(!authorized)throw new AccessError(403,"Access changed");},
    model:async sources=>{calls++;await provider();return {lineItems:[],warnings:[],model:"test-fixture",generatedAt:new Date().toISOString(),usage:{inputTokens:1,outputTokens:1}, sourceIds:sources.map(source=>source.id)};}
  });
  const input = {companyId,requestId:randomUUID(),documentIds:[] as string[],pastedText:"Synthetic scope",specialInstructions:""};
  return {companyId,uid,service,input,calls:()=>calls,disable:()=>{enabled=false;},revoke:()=>{authorized=false;},provider:(value:typeof provider)=>{provider=value;}};
}
async function source(companyId:string, bytes:Buffer, mimeType="application/pdf", patch={}) {
  const id=randomUUID(),sha256=createHash("sha256").update(bytes).digest("hex"),storagePath=privateDocumentPath(companyId,id,sha256);
  await bucket.file(storagePath).save(bytes,{resumable:false}); objects.push(storagePath);
  await db.doc(`companies/${companyId}/documents/${id}`).set({id,companyId,sha256,storagePath,size:bytes.length,mimeType,name:"Synthetic source.pdf",...patch});
  return id;
}
after(async()=>{for(const id of companies)await db.recursiveDelete(db.doc(`companies/${id}`));for(const path of objects)await bucket.file(path).delete({ignoreNotFound:true});await db.terminate();await deleteApp(app);});

test("disabled integration and unauthorized companies never call the model",async()=>{
  const f=await fixture(); await assert.rejects(f.service.generate({...f.input,companyId:"foreign-company"}),/denied/);
  f.disable(); await assert.rejects(f.service.generate(f.input),/not configured/);assert.equal(f.calls(),0);
});
test("duplicate submissions reuse the current company result and changed payloads cannot reuse an identity",async()=>{
  const f=await fixture();await f.service.generate(f.input);await f.service.generate(f.input);assert.equal(f.calls(),1);
  await assert.rejects(f.service.generate({...f.input,pastedText:"Changed"}),/another request/);
  assert.equal((await f.service.status(f.companyId,f.input.requestId)).status,"completed");
  await assert.rejects(f.service.status("foreign-company",f.input.requestId),/denied/);
});
test("foreign paths and missing original documents are rejected before any model request",async()=>{
  const f=await fixture(),other=await fixture(),doc=await source(other.companyId,Buffer.from("%PDF-test"));
  await assert.rejects(f.service.generate({...f.input,documentIds:[doc]}),/another company/);
  await db.doc(`companies/${f.companyId}/documents/${doc}`).set({id:doc,companyId:other.companyId,sha256:"a".repeat(64),storagePath:`companies/${other.companyId}/documents/${doc}/file`});
  await assert.rejects(f.service.generate({...f.input,documentIds:[doc]}),/another company/);assert.equal(f.calls(),0);
});
test("verified PDF bytes reach only the current request and exact file copies are handled once",async()=>{
  const f=await fixture(),pdf=await PDFDocument.create();pdf.addPage();const bytes=Buffer.from(await pdf.save());
  const first=await source(f.companyId,bytes),second=await source(f.companyId,bytes);
  const result=await f.service.generate({...f.input,pastedText:"",documentIds:[first,second]});
  assert.deepEqual(result.sourceIds,[first]);assert.match(result.warnings.join(" "),/processed once/);
});
test("corrupted bytes and oversized PDF page counts are rejected before charging",async()=>{
  const f=await fixture(),pdf=await PDFDocument.create();for(let i=0;i<31;i++)pdf.addPage();
  const bytes=Buffer.from(await pdf.save()),doc=await source(f.companyId,bytes);
  await assert.rejects(f.service.generate({...f.input,documentIds:[doc]}),/1–30 pages/);assert.equal(f.calls(),0);
  const record=await db.doc(`companies/${f.companyId}/documents/${doc}`).get();
  await bucket.file(record.data()!.storagePath).save(Buffer.alloc(bytes.length),{resumable:false});
  await assert.rejects(f.service.generate({...f.input,documentIds:[doc]}),/integrity check/);assert.equal(f.calls(),0);
});
test("revoking access while a model request runs prevents result disclosure",async()=>{
  const f=await fixture();f.provider(async()=>{f.revoke();});
  await assert.rejects(f.service.generate(f.input),/Access changed/);assert.equal(f.calls(),1);
  await assert.rejects(f.service.status(f.companyId,f.input.requestId),/denied/);
});
test("a company lease rejects overlapping paid requests, without automatically retrying a failed provider",async()=>{
  const f=await fixture();let release!:()=>void,started!:()=>void;
  const startedPromise=new Promise<void>(resolve=>{started=resolve;});
  f.provider(async()=>{started();await new Promise<void>(resolve=>{release=resolve;});});
  const first=f.service.generate(f.input);await startedPromise;
  await assert.rejects(f.service.generate({...f.input,requestId:randomUUID()}),/in progress/);release();await first;assert.equal(f.calls(),1);
  const next={...f.input,requestId:randomUUID()};f.provider(async()=>{throw new Error("Provider private detail");});
  await assert.rejects(f.service.generate(next),error=>error instanceof AccessError && error.status===502 && !error.message.includes("private detail"));
  await assert.rejects(f.service.generate(next),/already submitted/);assert.equal(f.calls(),2);
  const expired=randomUUID();await db.doc(`companies/${f.companyId}/aiJobs/${expired}`).set({uid:f.uid,status:"running",createdAt:Date.now()-300000});
  assert.equal((await f.service.status(f.companyId,expired)).status,"uncertain");
});
