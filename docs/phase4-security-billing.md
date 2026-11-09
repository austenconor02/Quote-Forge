# Secure login, deployment, and Stripe preparation

## Confirmed Firebase project and owner

The confirmed project is **`quote-forge-54595`**, selected explicitly by the owner after refreshed CLI access showed that the old saved ID belonged to a different/unavailable project. The original roofing project's services, rules, and credentials were not used or changed.

Registered Web app: `1:77615439092:web:f123ba3e220bb8583612a1`. Backend: `quoteforge`, region `us-central1`. Live URL: **https://quoteforge--quote-forge-54595.us-central1.hosted.app**. Rollout `build-2026-11-09-001` completed successfully. Live checks confirmed the branded Google login, unauthenticated redirect, private API rejection, disabled Stripe webhook, and delivery of the actual gzip OCR model.

The owner enabled Google Authentication and localhost in Firebase Console, then signed in once. The resulting verified Google Firebase UID was checked through the authenticated project administration API, anchored in private `platform/config`, and given the `platformOwner` claim. The deployed runtime pins that same UID. Client-supplied emails or payment flags cannot grant owner access.

The local development bypass is now **off by default**. Production requires the configured UID even if someone enables the old email bootstrap flag. Owner routes and APIs require a verified Google session plus that anchored UID/claim. Tenant memberships remain separate. The header and Settings provide Sign out, with CSRF protection and UID-scoped cache cleanup.

## Production architecture

Use **Firebase App Hosting with the Next.js server**, not static export. Server session cookies, private document APIs, invitation acceptance, company-specific manifests/icons, and Stripe signature verification need a server runtime. App Hosting runs the application on managed Cloud Run; no separate Cloud Function is required for these HTTP endpoints. See [Firebase's Next.js framework support](https://firebase.google.com/docs/app-hosting/frameworks-tooling).

The project was verified to have billing enabled already; no billing account or plan was changed. Its native Standard Firestore database and default Storage bucket are in `us-central1`. Firestore deletion protection is enabled. Storage enforces uniform bucket access and public-access prevention. App Hosting's managed compute identity has the SDK permissions needed for Auth sessions, Firestore, and Storage, without shipping a service-account private key.

`firebase.json` defines the backend and source-upload exclusions. The actual source ZIP was inspected to exclude environment files, references, tests, local tools, logs, and credential files while retaining the committed OCR model. Next.js server traces exclude development/reference files as an additional boundary. Document-worker preparation now fails a build if its required OCR model is missing.

`next.config.ts` reads the managed public `FIREBASE_WEBAPP_CONFIG` into the explicit browser SDK variables at build time. This is Firebase's public web configuration, not Admin credentials. Runtime owner UID, service credentials, Stripe secrets, and EmailJS private keys are not browser variables.

## Stripe behavior

The official server SDK is pinned in `package-lock.json`. The plan is **$99.00 USD per company per month**, quantity one, with no trial, promotion code, or variable client-selected price. All live Stripe features remain disabled until configured.

- **Free:** no billing record, or explicit billing disabled. Quoting remains available for an assigned active company.
- **Payment Required / Checkout Pending:** billing is enabled, but quoting is restricted pending authoritative confirmation. Creating a checkout or visiting its return URL does not unlock access.
- **Active:** verified current subscription, exact configured plan/quantity, paid invoice for at least $99, and an unexpired billing period.
- **Past Due / Canceled / Suspended:** paid access is blocked. A paused or mismatched plan is not entitled.

The simplified company cards show the status and owner-only Enable/Disable Billing. They show **Stripe: Not Configured** now; the confirmation action is disabled and the server independently rejects checkout/billing changes. Existing records are never deleted by billing changes.

Enable Billing validates the configured recurring price, creates/reuses the company's Stripe customer, serializes billing operations, reuses an existing open checkout, and sends one confirmed setup email. Existing subscriptions prevent a second subscription checkout. The billing email comes from an owner-controlled stored address.

Disable Billing expires pending checkout sessions, cancels recurring subscriptions, and confirms no recurring subscription remains before restoring Free. It does not refund prior charges. Cancellation failure leaves billing unchanged and reports that charges may still continue. A later event for a disabled company cannot reactivate billing; it reconciles/cancels a late subscription instead. Deactivating company access is separate from canceling billing, and the owner UI explains that for billing-enabled companies.

Activation invitations are blocked while payment is required. After verified payment, the owner can send the normal existing branded Google invitation. There is no automatic duplicate activation email.

## Webhooks and access enforcement

Register **`/api/stripe/webhook`** for these snapshot events:

```text
checkout.session.completed
customer.subscription.created
customer.subscription.updated
customer.subscription.deleted
invoice.paid
invoice.payment_failed
```

The endpoint verifies the raw-body Stripe signature, timestamp tolerance, account context, and test/live mode. Current subscription/invoice state is retrieved from Stripe rather than trusting payload status or event ordering. Event IDs are stored for duplicate handling; per-company transaction leases serialize owner operations and event reconciliation. Customer/subscription mappings and provider metadata bind each payment to its company. Unrelated customers are ignored. See [Stripe's webhook guidance](https://docs.stripe.com/webhooks).

`companyBilling`, `stripeCustomers`, `stripeSubscriptions`, and `stripeEvents` are private server collections. Firestore rules and server request/transaction checks enforce entitlement; browser controls cannot override it. Owners retain administration access to manage blocked companies. Firestore reads, source downloads, source uploads, and draft/customer mutations enforce the paid gate for tenant users.

This first integration deliberately does not support discounts, partial payments, metered/seat billing, or trials. Stripe Customer Portal should be configured for payment-method updates and cancellation; do not enable quantity/product changes for this fixed company plan. Stripe test-mode credentials and real provider sandbox validation are still required before enabling billing. Fixture tests are not a claim of a real Stripe payment.

## Settings still needed before enabling Stripe or email

Keep these flags **false** while credentials/templates are missing:

```dotenv
STRIPE_ENABLED=false
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_PRICE_ID=price_1UZzgz2cpYmPAH1oPaO3jFk8
EMAIL_DELIVERY_ENABLED=false
EMAILJS_PUBLIC_KEY=
EMAILJS_PRIVATE_KEY=
EMAILJS_BILLING_TEMPLATE_ID=
```

The owner supplied sandbox Price ID `price_1UZzgz2cpYmPAH1oPaO3jFk8` for USD 99.00 recurring every month. It is set in `.env.local`, the example environment, and runtime-only App Hosting configuration. Keep `STRIPE_ENABLED=false` until the matching sandbox server key, webhook signing secret, and billing email configuration are supplied and sandbox verification is complete. The gateway validates the actual price's amount, currency, monthly interval, and billing model before creating checkout; the price has not yet been retrieved from Stripe. Configure Customer Portal in Stripe. The checkout return URL is `/billing/return` and grants no access. Live billing requires a separately configured live price and matching live secrets. Local environment files are excluded from cloud deployment; the App Hosting configuration takes effect on the next deployment.

EmailJS's invitation template remains `template_ho1ym4c` on service `service_mk2cjul`. A separate billing template uses `to_email`, `company_name`, `company_logo_url`, `primary_color`, `header_text_color`, `button_text_color`, `billing_url`, and `monthly_price`. Set To Email to `{{to_email}}`. Keep keys in server secrets; never prefix them `NEXT_PUBLIC_`. Provider acceptance is required before showing a send as confirmed. Unknown delivery is not automatically retried.

Automatic AI generation still needs its original missing server engine and independent provider configuration. Existing document processing, manual quotes, unit-price PDFs, invitations, and saved data paths are preserved.

Live checks on November 9, 2026 confirmed the Google login page, redirect to login for anonymous visitors, rejection of unauthenticated private-data requests, and the disabled Stripe webhook. An isolated browser loaded the deployed OCR worker, core, and English model and correctly recognized `QUOTEFORGE OCR TEST` and `TOTAL $99.00` from a generated image. The first local Google sign-in established the verified owner UID; signed-in use of the deployed My Companies page still awaits the owner's browser confirmation. No real Stripe payment or email was sent.

## Firebase Console checks and repeat deployment

1. Project settings → General: confirm the registered QuoteForge Web app and project ID above.
2. Authentication → Sign-in method: Google enabled, with the owner's support email. The owner already completed this step.
3. Authentication → Settings → Authorized domains: include the actual App Hosting hostname and localhost for local login. The production hostname was configured during setup.
4. Authentication → Users: confirm the designated Google account exists. Its UID must match the runtime pin and private owner anchor; do not replace an established anchor based on email alone.
5. Firestore → Rules and Storage → Rules: confirm the checked-in private rules were released. SDK client writes are denied; writes go through authenticated server APIs.
6. App Hosting → quoteforge → Settings: review runtime environment, owner UID pin, `QUOTEFORGE_DEMO_MODE=false`, emulator flags false, Stripe/email flags false, and the exact HTTPS `APP_ORIGIN`.
7. Deploy with `firebase deploy --only apphosting --project quote-forge-54595` after production/security checks. The configured source exclusions are required; never upload an unfiltered workspace or `.env.local`.
8. Open the actual successful rollout URL, sign in with the designated Google account, and verify company save/reopen. Unauthenticated visitors must see login. The managed runtime uses application default credentials; the local CLI login is not an application credential.

The owner UID tool at `scripts/bootstrap-owner.mjs` can initialize the same verified owner using administrator application default credentials for a future setup; it cannot replace another anchored UID. Existing browser-only data remains in its separate local/recovery store; it is not silently imported or deleted by cloud deployment.
