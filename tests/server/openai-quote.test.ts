import { test } from "node:test";
import assert from "node:assert/strict";
import OpenAI from "openai";
import { aiConfigured, requestAiDraft } from "../../src/lib/server/openai-quote";

test("AI requires a server key and an explicit enable flag", () => {
  const oldKey = process.env.OPENAI_API_KEY, oldFlag = process.env.QUOTEFORGE_AI_ENABLED;
  try {
    process.env.QUOTEFORGE_AI_ENABLED = "true"; delete process.env.OPENAI_API_KEY; assert.equal(aiConfigured(), false);
    process.env.OPENAI_API_KEY = "sk-test-fixture"; process.env.QUOTEFORGE_AI_ENABLED = "false"; assert.equal(aiConfigured(), false);
    process.env.QUOTEFORGE_AI_ENABLED = "true"; assert.equal(aiConfigured(), true);
  } finally {if(oldKey===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=oldKey; if(oldFlag===undefined)delete process.env.QUOTEFORGE_AI_ENABLED;else process.env.QUOTEFORGE_AI_ENABLED=oldFlag;}
});
test("OpenAI requests are stateless, tool-free, and contain only supplied current-run files", async () => {
  const oldKey = process.env.OPENAI_API_KEY, oldFlag = process.env.QUOTEFORGE_AI_ENABLED;
  try {
    process.env.OPENAI_API_KEY = "sk-test-fixture"; process.env.QUOTEFORGE_AI_ENABLED = "true";
    let sent: Record<string,unknown> = {};
    const fake = {responses: {create: async (request: Record<string,unknown>) => {sent=request;return {status:"completed",output_text:JSON.stringify({items:[],warnings:[]}),usage:{input_tokens:10,output_tokens:5}};}}};
    await requestAiDraft([{id:"doc-a",name:"Only A",pages:1,mimeType:"application/pdf",bytes:Buffer.from("%PDF-A")},{id:"image-a",name:"Photo A",pages:1,mimeType:"image/png",bytes:Buffer.from("PNG-A")}], "Keep materials separate.", "Use supplied costs.", fake as unknown as Pick<OpenAI,"responses">);
    assert.equal(sent.store,false); assert.deepEqual(sent.tools,[]); assert.equal("conversation" in sent,false); assert.equal("previous_response_id" in sent,false);
    const payload = JSON.stringify(sent.input); assert.match(payload,/input_file/); assert.match(payload,/input_image/); assert.ok(!payload.includes("customerEmail"));
    assert.match(JSON.stringify(sent.text),/json_schema/);
    await requestAiDraft([{id:"pasted-text",name:"Only B",pages:1,text:"Company B only"}],"","",fake as unknown as Pick<OpenAI,"responses">);
    assert.ok(!JSON.stringify(sent.input).includes("Only A")); assert.ok(!JSON.stringify(sent.input).includes("doc-a"));
  } finally {if(oldKey===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=oldKey; if(oldFlag===undefined)delete process.env.QUOTEFORGE_AI_ENABLED;else process.env.QUOTEFORGE_AI_ENABLED=oldFlag;}
});
