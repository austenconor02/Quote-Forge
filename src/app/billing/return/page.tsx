import Link from "next/link";
export default function BillingReturn() {
  return <main className="setup-page"><h1>Billing update received</h1><p>Payment access updates only after Stripe confirms your subscription. Returning to this page does not activate paid access.</p><p>Use your company invitation or sign in again to check your workspace.</p><Link className="button primary" href="/login">Sign in to QuoteForge</Link></main>;
}
