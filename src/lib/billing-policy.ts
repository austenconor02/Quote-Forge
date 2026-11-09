export const MONTHLY_PRICE_CENTS = 9900;
export const BILLING_STATUSES = ["Free", "Payment Required", "Checkout Pending", "Active", "Past Due", "Canceled", "Suspended"] as const;
export type BillingStatus = typeof BILLING_STATUSES[number];
export type BillingSummary = {enabled: boolean; status: BillingStatus; monthlyPriceCents: number; currency: "usd"; billingEmail?: string};
export type BillingEntitlement = {enabled?: unknown; status?: unknown; entitled?: unknown; accessUntil?: unknown};
export function billingAccessAllowed(value?: BillingEntitlement | null, now = Date.now()): boolean {
  if (!value || value.enabled === false) return true;
  return value.enabled === true && value.status === "Active" && value.entitled === true && typeof value.accessUntil === "number" && Number.isFinite(value.accessUntil) && value.accessUntil > now;
}
export function billingSummary(value?: BillingEntitlement & {billingEmail?: unknown}): BillingSummary {
  const enabled = value?.enabled === true;
  const status: BillingStatus = !enabled ? "Free" : BILLING_STATUSES.includes(value?.status as BillingStatus) ? value!.status as BillingStatus : "Payment Required";
  return {enabled, status, monthlyPriceCents: MONTHLY_PRICE_CENTS, currency: "usd", ...(typeof value?.billingEmail === "string" ? {billingEmail: value.billingEmail} : {})};
}
