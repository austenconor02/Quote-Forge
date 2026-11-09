import {after,before,test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {initializeApp,applicationDefault,deleteApp} from 'firebase-admin/app';
import {getFirestore} from 'firebase-admin/firestore';
import {baseUrl,createGoogleIdentity,createGoogleSession,jsonRequest} from './http-helpers.mjs';

if(process.env.QUOTEFORGE_RUN_AI_HTTP_TESTS!=='true')throw new Error('Explicit isolated AI HTTP test flag is required.');
process.env.FIRESTORE_EMULATOR_HOST='127.0.0.1:8080';
const app=initializeApp({projectId:'demo-quoteforge',credential:applicationDefault()},'ai-http-tests');
const db=getFirestore(app),companyA=`ai-http-a-${randomUUID()}`,companyB=`ai-http-b-${randomUUID()}`;
let owner,tenant,identity;
const input=companyId=>({companyId,requestId:randomUUID(),documentIds:[],pastedText:'Install trim 4 EA at $9.25',specialInstructions:''});
before(async()=>{
  owner=await createGoogleSession('owner@example.com');
  for(const id of [companyA,companyB]){
    const company={id,name:'AI isolation test',industry:'Services',email:'office@example.com',phone:'',address:'',website:'',status:'Draft',branding:{primary:'#122239',secondary:'#F5F7FA',accent:'#EE7D3B',font:'Arial',logo:''},fields:[],createdAt:new Date().toISOString(),origin:'owner'};
    assert.equal((await jsonRequest(owner,'/api/companies','POST',company)).response.status,200);
    await db.doc(`companies/${id}`).update({status:'Active'});
  }
  identity=await createGoogleIdentity(`ai-http-${randomUUID()}@example.com`);
  await db.doc(`companies/${companyA}/users/${identity.uid}`).set({enabled:true});
  await db.doc(`userAccess/${identity.uid}`).set({companyId:companyA,enabled:true});
  tenant=await createGoogleSession(identity.email,{identity});
});
after(async()=>{for(const id of [companyA,companyB])await db.recursiveDelete(db.doc(`companies/${id}`));if(identity)await db.doc(`userAccess/${identity.uid}`).delete();await deleteApp(app);});

test('anonymous and cross-company requests cannot generate or retrieve results',async()=>{
  const anonymous=await fetch(baseUrl+'/api/proposals/generate',{method:'POST',headers:{Origin:new URL(baseUrl).origin,'Content-Type':'application/json'},body:JSON.stringify(input(companyA))});
  assert.equal(anonymous.status,401);
  assert.equal((await jsonRequest(tenant,'/api/proposals/generate','POST',input(companyB))).response.status,403);
  assert.equal((await tenant.request(`/api/proposals/generate?companyId=${companyB}&requestId=${randomUUID()}`)).status,403);
});
test('authorized generation is bound to its source payload, company, and initiating user',async()=>{
  const request=input(companyA),first=await jsonRequest(tenant,'/api/proposals/generate','POST',request);
  assert.equal(first.response.status,200);assert.equal(first.body.result.lineItems[0].unitPrice,9.25);assert.equal(first.body.result.lineItems[0].needsReview,true);
  const duplicate=await jsonRequest(tenant,'/api/proposals/generate','POST',request);assert.equal(duplicate.response.status,200);
  assert.equal(duplicate.body.result.lineItems[0].id,first.body.result.lineItems[0].id);
  assert.equal((await jsonRequest(tenant,'/api/proposals/generate','POST',{...request,pastedText:'Changed source'})).response.status,409);
  assert.equal((await owner.request(`/api/proposals/generate?companyId=${companyA}&requestId=${request.requestId}`)).status,404);
  const status=await tenant.request(`/api/proposals/generate?companyId=${companyA}&requestId=${request.requestId}`);assert.equal(status.status,200);assert.equal((await status.json()).status,'completed');
});
test('client-selected provider URLs, models, foreign documents, and request origins are rejected',async()=>{
  assert.equal((await jsonRequest(tenant,'/api/proposals/generate','POST',{...input(companyA),model:'untrusted',fileUrl:'https://example.com/private.pdf'})).response.status,400);
  assert.equal((await jsonRequest(tenant,'/api/proposals/generate','POST',{...input(companyA),documentIds:[randomUUID()]})).response.status,403);
  assert.equal((await tenant.request('/api/proposals/generate',{method:'POST',headers:{Origin:'https://foreign.example','Content-Type':'application/json'},body:JSON.stringify(input(companyA))})).status,403);
});
