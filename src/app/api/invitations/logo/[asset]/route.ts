import { adminServices } from "@/lib/server/firebase";
import { createInvitationAssetService } from "@/lib/server/invitation-assets";

export const runtime = "nodejs";
export async function GET(_: Request, {params}: {params: Promise<{asset: string}>}) {
  try {
    const {asset} = await params;
    const match = /^([A-Za-z0-9_-]{43})\.png$/.exec(asset);
    if (!match) throw new Error();
    const {db, bucket} = adminServices();
    const bytes = await createInvitationAssetService({db, bucket}).read(match[1]);
    return new Response(new Uint8Array(bytes), {headers: {"Content-Type": "image/png", "Content-Length": String(bytes.length), "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "X-Robots-Tag": "noindex, nofollow, noarchive", "Content-Security-Policy": "default-src 'none'; sandbox"}});
  } catch {return new Response("Invitation logo unavailable.", {status: 404, headers: {"Cache-Control": "no-store"}});}
}
