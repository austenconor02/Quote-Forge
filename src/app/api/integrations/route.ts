import { apiError, requireOwner } from "@/lib/server/auth";
import { invitationEmailConfigured } from "@/lib/server/email";
import { billingEmailConfigured } from "@/lib/server/email";
import { stripeConfigured } from "@/lib/server/stripe";
import { aiConfigured } from "@/lib/server/openai-quote";
export async function GET() {
  try {const session = await requireOwner(); return Response.json({cloud: !session.demo, emulators: !session.demo && process.env.QUOTEFORGE_USE_EMULATORS === "true", invitationsReady: !session.demo && invitationEmailConfigured(), stripeConfigured: !session.demo && stripeConfigured(), billingReady: !session.demo && stripeConfigured() && billingEmailConfigured(), documentProcessing: true, aiGeneration: !session.demo && aiConfigured()}, {headers: {"Cache-Control": "private, no-store"}});} catch (error) {return apiError(error);}
}
