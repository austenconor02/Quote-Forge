import { createServer } from "node:http";
const messages = [];
let mode = "ok";
const server = createServer(async (request, response) => {
  if (request.url === "/messages" && request.method === "GET") {response.writeHead(200, {"Content-Type": "application/json"}); response.end(JSON.stringify(messages)); return;}
  if (request.url === "/mode" && request.method === "POST") {
    let body = ""; for await (const chunk of request) body += chunk;
    mode = body === "reject" ? "reject" : "ok"; response.end("OK"); return;
  }
  if (request.url !== "/capture" || request.method !== "POST") {response.writeHead(404); response.end(); return;}
  let body = "";
  for await (const chunk of request) {body += chunk; if (body.length > 65536) {response.writeHead(413); response.end(); return;}}
  try {
    const message = JSON.parse(body);
    if (message.user_id !== "public-test" || message.accessToken !== "private-test") {response.writeHead(400); response.end("Test credentials only"); return;}
    messages.push(message);
    response.writeHead(mode === "reject" ? 422 : 200, {"Content-Type": "text/plain"}); response.end(mode === "reject" ? "Test rejection" : "OK");
  } catch {response.writeHead(400); response.end();}
});
server.listen(9444, "127.0.0.1", () => console.log("Fake EmailJS capture ready on loopback; no emails will be delivered."));
