import { apiError } from "@/lib/server/auth";
import { readOwnerWorkspace } from "@/lib/server/tenant-repository";
export async function GET(request: Request) {
  try { return Response.json(await readOwnerWorkspace(new URL(request.url).searchParams.get("cursor") || undefined), {headers: {"Cache-Control": "private, no-store"}}); }
  catch (error) {return apiError(error);}
}
