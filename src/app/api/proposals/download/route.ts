import { z } from "zod";
import { AccessError, apiError, assertSameOrigin } from "@/lib/server/auth";
import { boundedJson } from "@/lib/server/request-body";
import { downloadSharedProposal } from "@/lib/server/proposal-delivery";

export const runtime = "nodejs";
const input = z.object({token: z.string().regex(/^[A-Za-z0-9_-]{43}$/)}).strict();
export async function POST(request: Request) {
  try {
    await assertSameOrigin(request);
    const parsed = input.safeParse(await boundedJson(request, 1024));
    if (!parsed.success) throw new AccessError(404, "This proposal link is unavailable or has expired.");
    const result = await downloadSharedProposal(parsed.data.token);
    return new Response(new Uint8Array(result.bytes), {headers: {"Content-Type": "application/pdf", "Content-Length": String(result.bytes.length), "Content-Disposition": `inline; filename="${result.fileName}"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow, noarchive"}});
  } catch (error) {return apiError(error);}
}
