import "server-only";
import { randomUUID } from "node:crypto";
import { AccessError, requireOwner } from "./auth";
import { adminServices } from "./firebase";
import { createBillingService, BillingError } from "./billing-core";
import { createStripeGateway, stripeConfigured } from "./stripe";
import { billingEmailConfigured, sendBillingEmail, EmailDeliveryError } from "./email";
import { createInvitationAssetService } from "./invitation-assets";
import { enforceRateLimit } from "./rate-limit";

function service() {
  const {db, bucket} = adminServices();
  return createBillingService({db, gateway: createStripeGateway(), configured: stripeConfigured, emailConfigured: billingEmailConfigured, owner: requireOwner,
    async sendSetup(companyId, email, url, expiresAt) {
      const company = (await db.doc(`companies/${companyId}`).get()).data()!;
      const branding = await createInvitationAssetService({db, bucket}).prepare({id: companyId, name: company.name, branding: company.branding}, new Date(expiresAt).toISOString());
      const dispatchId = randomUUID(), throttle = db.doc("mailOperations/emailjs-global-throttle");
      try {await db.runTransaction(async transaction => {const record = await transaction.get(throttle); const now = Date.now(); if (Number(record.data()?.leaseUntil || 0) > now || Number(record.data()?.lastDispatchAt || 0) > now - 1100) throw new Error("Dispatch throttled"); transaction.set(throttle, {operationId: dispatchId, leaseUntil: now + 20000, lastDispatchAt: now});});} catch {throw new EmailDeliveryError("rejected");}
      try {await sendBillingEmail({...branding, companyName: company.name, toEmail: email, billingUrl: url});}
      finally {await db.runTransaction(async transaction => {const record = await transaction.get(throttle); if (record.data()?.operationId === dispatchId) transaction.update(throttle, {operationId: null, leaseUntil: 0});});}
    }
  });
}
export async function billingOwnerAction(companyId: string, action: "enable" | "disable" | "checkout" | "portal", email?: string) {
  const owner = await requireOwner();
  if (owner.demo || !stripeConfigured()) throw new AccessError(503, "Stripe is Not Configured. Existing billing remains unchanged; no checkout or cancellation was attempted.");
  await enforceRateLimit(owner.uid, "billing-change", {limit: 10, windowMs: 60000});
  try {return await service().ownerAction(companyId, action, email);}
  catch (error) {if (error instanceof BillingError) throw new AccessError(error.status, error.message); throw error;}
}
export async function reconcileStripeEvent(event: {id: string; type: string; customerId: string; live: boolean}) {return service().reconcile(event);}
