# Stripe setup and preliminary integration review

Reviewed November 9, 2026. Business: https://quoteforge--quote-forge-54595.us-central1.hosted.app/ — software for compiling invoices and producing branded PDFs.

## Connection and planner status

- `codex plugin add stripe@openai-curated` succeeded. Installed package version: 1.0.2.
- `codex mcp add stripe --url https://mcp.stripe.com` succeeded, and the interactive OAuth flow reported `Successfully logged in`.
- This already-running chat does not expose `stripe_implementation_planner`. Start a new Codex session to load the newly installed plugin/server, then call the planner with the context below before finalizing the integration design.
- No planner-generated plan has been obtained. The observations below are a source-code review, not a replacement for that requested plan. The skills-install fallback was not used because plugin installation succeeded.

## Context for the planner

QuoteForge is a multi-company SaaS application using Next.js, Firebase Google Auth, server sessions, Firestore, and private Cloud Storage. A verified, pinned owner account controls companies and billing. Tenant access is restricted to assigned active companies. The existing commercial requirement is an optional, owner-enabled **USD 99 per company per month** subscription; companies with billing disabled have free access. Paid access must come from verified server-side Stripe state. Disabling billing must confirm cancellation before restoring free access. Preserve existing document processing and PDF styling.

The owner confirmed **QuoteForge subscriptions first** on November 9, 2026. Requested Stripe products for this phase: Billing for the USD 99 monthly company subscription, Invoicing for its recurring subscription invoices, and Payments through hosted Checkout. Collecting payments for tenant companies' own customer invoices is deferred to a later, separately scoped integration.

Ask the planner to cover hosted Checkout, recurring subscription invoices, Customer Portal, signed webhooks, company ownership and environment isolation, cancellation, retries and reconciliation, sandbox verification, server secret configuration, and a staged launch. Keep Connect and tenant customer invoice/payment flows outside this phase. Do not send real invoices, charge customers, or enable production payments during planning.

## Existing implementation

| Area | Current behavior |
| --- | --- |
| SDK and checkout | Official server Stripe SDK; hosted subscription Checkout with a server-selected monthly Price, quantity one, company metadata, and idempotency key. |
| Authorization | Billing changes require the designated Google owner; private billing records cannot be written by browsers. |
| Entitlement | Redirects do not unlock access. Reconciliation retrieves current subscription/invoice state and checks the exact plan, paid invoice, and billing period. |
| Webhooks | Raw-body signatures, test/live matching, duplicate tracking, current-state reconciliation, and per-company operation leases. Connected-account events are deliberately rejected by this subscription endpoint. |
| Cancellation | Expires open sessions and cancels recurring subscriptions before marking the company Free. |
| Portal | Owner can prepare a Stripe Customer Portal URL; no tenant self-service portal endpoint exists. |
| Tenant invoice payments | Deferred by the owner. No Stripe invoice creation/finalization/payment flow or connected-account onboarding is implemented. Existing branded PDFs do not themselves create a Stripe payable invoice. |

## Items to address before enabling payments

1. Generate and review the actual Stripe planner output in the new session using the confirmed subscriptions-first scope above.
2. The owner supplied sandbox Price ID `price_1UZzgz2cpYmPAH1oPaO3jFk8` for USD 99 monthly. It is wired through `.env.local`, the example environment, and runtime-only App Hosting configuration (effective on the next deployment). Configure the matching sandbox/test server key and webhook signing secret; both are still missing locally. Keep `STRIPE_ENABLED=false` until configuration and sandbox verification are complete. The actual price has not yet been retrieved from Stripe; the gateway checks its amount, currency, and recurring interval before checkout. Keep secret values outside chat, Git, browser variables, and this document. OAuth for the MCP server does not configure application runtime secrets.
3. Register the snapshot webhook destination at `/api/stripe/webhook` for the six events documented in `phase4-security-billing.md`. Match the SDK/API and webhook versions and verify real deliveries in a sandbox.
4. Finish the EmailJS billing template and key setup. The current Enable Billing flow requires configured billing email delivery. No email was sent by this review.
5. Configure Customer Portal for the existing fixed plan. Review whether the authenticated payer should have a self-service route instead of requiring the owner to prepare its link.
6. Add an owner recovery or scheduled reconciliation path for missed/exhausted webhook deliveries. Current synchronization runs through incoming events; a successful Checkout return never grants access.
7. Exercise successful initial payment, additional authentication, failed payment, renewal, duplicate/out-of-order events, cancellation, expired checkout, and cross-company denial with real Stripe sandbox objects before enabling live billing.

The existing four offline Stripe gateway/signature tests passed during this review. They use fixtures and do not establish that a real payment or webhook delivery has succeeded. `STRIPE_ENABLED=false` remains in local and deployed configuration; no production billing configuration was changed.

## Official references

- [Stripe MCP connection](https://docs.stripe.com/mcp)
- [Subscription integration design](https://docs.stripe.com/billing/subscriptions/designing-integration)
- [Customer Portal integration](https://docs.stripe.com/customer-management/integrate-customer-portal)
- [Invoicing API integration](https://docs.stripe.com/invoicing/integration)
- [Connect for platforms](https://docs.stripe.com/connect)
