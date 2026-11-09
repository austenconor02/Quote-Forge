import { apiError, assertSameOrigin } from "@/lib/server/auth";
import { boundedJson } from "@/lib/server/request-body";
import { aiGeneration } from "@/lib/server/ai-generation";
export const runtime = "nodejs";
export const maxDuration = 180;
export async function POST(request: Request) {
  try {
    await assertSameOrigin(request);
    return Response.json({result: await aiGeneration.generate(await boundedJson(request, 512000))}, {headers: {"Cache-Control": "private, no-store"}});
  } catch (e) { return apiError(e); }
}
export async function GET(request: Request) {
  try {const query = new URL(request.url).searchParams; return Response.json(await aiGeneration.status(query.get("companyId") || "", query.get("requestId") || ""), {headers: {"Cache-Control": "private, no-store"}});}
  catch (error) {return apiError(error);}
}
