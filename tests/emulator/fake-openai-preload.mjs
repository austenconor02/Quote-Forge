// Loaded only by the isolated local QA server through NODE_OPTIONS. Never used by the product runtime.
const realFetch = globalThis.fetch;
globalThis.fetch = async function(input, init) {
  const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
  if (url.hostname !== "api.openai.com") return realFetch(input,init);
  if (url.pathname !== "/v1/responses") throw new Error("Unexpected OpenAI test endpoint");
  const request = JSON.parse(init?.body || "{}");
  if (request.store !== false || request.tools?.length !== 0 || request.conversation || request.previous_response_id) throw new Error("Unsafe test request state");
  const content=request.input?.[0]?.content || [],metadata=JSON.parse(content[0].text);
  const sourceId=metadata.sources[0].sourceId,excerpt="Install trim 4 EA at $9.25";
  const draft={items:[{description:"Install trim",section:"Carpentry",scopeKey:"Kitchen",quantity:4,unit:"EA",price:{kind:"unit",amount:9.25,source:{sourceId,page:sourceId==="pasted-text"?null:1,excerpt}},sources:[{sourceId,page:sourceId==="pasted-text"?null:1,excerpt}],reason:"Scope and price from the supplied test source.",warnings:[]}],warnings:["Review the source price before approving."]};
  const text=JSON.stringify(draft);
  return new Response(JSON.stringify({id:"resp_local_fixture",object:"response",created_at:Math.floor(Date.now()/1000),status:"completed",model:request.model,output_text:text,
    output:[{id:"msg_local_fixture",type:"message",status:"completed",role:"assistant",content:[{type:"output_text",text,annotations:[]}]}],usage:{input_tokens:100,output_tokens:100,total_tokens:200}}),{status:200,headers:{"Content-Type":"application/json"}});
};
