import "server-only";
import { requireTenant } from "./auth";
import { adminServices } from "./firebase";
import { assertTenantTransaction } from "./tenant-repository";
import { enforceRateLimit } from "./rate-limit";
import { aiConfigured, requestAiDraft } from "./openai-quote";
import { createAiGeneration } from "./ai-generation-core";

export const aiGeneration = createAiGeneration({authorize: requireTenant, services: adminServices, rateLimit: enforceRateLimit,
  configured: aiConfigured, model: requestAiDraft, assertAccess: assertTenantTransaction});
