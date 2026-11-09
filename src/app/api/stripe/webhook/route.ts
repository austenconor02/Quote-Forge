import { apiError, AccessError } from "@/lib/server/auth";
import { boundedBytes } from "@/lib/server/request-body";
import { stripeClient, stripeConfigured } from "@/lib/server/stripe";
import { reconcileStripeEvent } from "@/lib/server/billing";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    if (!stripeConfigured()) throw new AccessError(503, "Stripe is Not Configured. No billing change was made.");
    const signature = request.headers.get("stripe-signature");
    if (!signature || signature.length > 2048) throw new AccessError(400, "A Stripe signature is required.");
    const bytes = await boundedBytes(request, 1024 * 1024);
    let event;
    try {event = stripeClient().webhooks.constructEvent(bytes, signature, process.env.STRIPE_WEBHOOK_SECRET!);} catch {throw new AccessError(400, "The Stripe event signature is invalid.");}
    const live = /^(sk|rk)_live_/.test(process.env.STRIPE_SECRET_KEY!);
    if (event.livemode !== live || event.account) throw new AccessError(400, "Stripe event account or mode does not match this application.");
    const data = event.data.object as unknown as {customer?: string | {id: string}};
    const customerId = typeof data.customer === "string" ? data.customer : data.customer?.id || "";
    return Response.json(await reconcileStripeEvent({id: event.id, type: event.type, customerId, live}), {headers: {"Cache-Control": "no-store"}});
  } catch (error) {return apiError(error);}
}
