import { apiError, requireOwner } from "@/lib/server/auth";
import { invitationEmailConfigured } from "@/lib/server/email";
export async function GET() {
  try {const session = await requireOwner(); return Response.json({cloud: !session.demo, emulators: !session.demo && process.env.QUOTEFORGE_USE_EMULATORS === "true", invitationsReady: !session.demo && invitationEmailConfigured(), documentProcessing: true, aiGeneration: false}, {headers: {"Cache-Control": "private, no-store"}});} catch (error) {return apiError(error);}
}
