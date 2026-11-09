# EmailJS invitation setup

The existing company wizard and Resend Invitation action use the authenticated server invitation endpoint. No dashboard redesign, real email, or deployment is part of this change.

## Values supplied and values still needed

The screenshot supplies `template_ho1ym4c`; the previously supplied service is `service_mk2cjul`. Both are recorded in the ignored local environment file. Sending remains disabled.

Enter the remaining settings in **`F:\Quote Forge\.env.local`**:

```dotenv
EMAILJS_SERVICE_ID=service_mk2cjul
EMAILJS_INVITATION_TEMPLATE_ID=template_ho1ym4c
EMAILJS_PUBLIC_KEY=your_EmailJS_public_key
EMAILJS_PRIVATE_KEY=your_EmailJS_private_key
APP_ORIGIN=https://your-actual-quoteforge-host
EMAIL_DELIVERY_ENABLED=false
```

Get the public key from EmailJS **Account** and the private key from **Account → Security**. This backend integration requires private-key authorization. Enable non-browser API requests and private-key authorization in EmailJS as appropriate for the account. Never put the private key in a `NEXT_PUBLIC_*` variable, source code, Git, or chat. Restart the server after changing environment settings; for a future deployment use the hosting environment/secret store.

Keep `EMAIL_DELIVERY_ENABLED=false` until a test delivery has been approved. Do not use the fake test credentials from the emulator instructions with real EmailJS.

Live Firebase configuration is also missing locally: registered Web app SDK values, Google Authentication setup, Firestore/Storage provisioning, and server Admin SDK credentials or application default credentials. Follow [the Firebase handoff](integration-handoff.md). Do not turn on the local development bypass for a hosted application. Invitations require the verified, designated Google owner; local demo mode cannot send them.

## Existing template

In EmailJS, open the supplied template and verify:

- **To Email:** `{{to_email}}` (remove any fixed real customer address).
- **Subject:** for example `Your {{company_name}} workspace invitation`.
- **Body:** use the eight parameters below. A compatible body is provided in [emailjs-invitation-template.html](emailjs-invitation-template.html).

| Parameter | Source |
| --- | --- |
| `to_email` | Validated assigned recipient, normalized without changing Gmail aliases |
| `company_name` | Stored company name |
| `company_logo_url` | Public PNG snapshot of this company's saved logo, or its own branded initials |
| `primary_color` | Stored `company.branding.primary` |
| `header_text_color` | Black or white with the higher contrast against the primary color |
| `button_text_color` | The same accessible foreground for the primary-color button |
| `invite_url` | Single-use activation link with a random fragment token |
| `expires_in` | `7 days`, matching the actual server expiration |

EmailJS documents `{{#company_logo_url}}...{{/company_logo_url}}` conditional sections, so those markers are supported and retained. Double-brace variables are escaped. Do not change them to triple-brace HTML injection. See [EmailJS dynamic variables and conditional rendering](https://www.emailjs.com/docs/user-guide/dynamic-variables-templates/).

The app now sends `invite_url`, not the old `invitation_url`. Invitation emails use `expires_in`, not `expires_at`; proposal delivery uses its separate existing template/parameters. The remote EmailJS dashboard/template body could not be inspected or edited without account access, so its To Email/body settings still need verification there. No live inbox rendering or delivery is claimed.

## Public logo boundary

`/api/invitations/logo/{opaque-id}.png` serves only a sanitized, size-limited PNG. It does not require sign-in, allowing email clients to load it. The snapshot preserves the selected company logo's aspect ratio, strips metadata, and expires with the seven-day invitation. A company with no logo gets its own initials; it does not receive the QuoteForge owner logo.

The URL does not contain a company ID, email address, activation token, Storage path, or credentials. Source logos, Firestore image records, tenant documents, and Storage SDK access remain private. The public route validates the image record, path, expiration, MIME, size, and SHA-256 before returning bytes. Lifecycle/TTL cleanup may be enabled during a later deployment review; expiration enforcement does not depend on cleanup.

## Workflow and failure handling

Company and branding are saved before preparing the email. Only the token hash is stored in Firestore; the random token travels in the activation link and email, never in public company records. Google acceptance requires the exact invited verified email, an active company, the current unexpired token, and a single-use transaction. Resending invalidates the previous unused token.

Only EmailJS's confirmed success response marks delivery as submitted. A definitive provider rejection can retry the same operation with a new token and the same company identity. An uncertain timeout/network result is not automatically resent; inspect the provider before an explicit resend. Resend clicks have separate operation IDs, while repeated wizard submissions retain an operation ID to prevent duplicates. Global email dispatch throttling and per-owner limits remain in place. Provider acceptance does not guarantee inbox delivery.

The tenant manifest and icons continue to use the customer's stored name/logo/theme. Email logo snapshots do not change PWA icons or grant access to app records.

## Validation without sending email

Unit tests cover exact template variables, seven-day expiry, and text contrast. Emulator tests cover rejection/retry, unique tokens, replay, expiry, wrong accounts, secure reassignment, public PNG integrity/fallback, and private record denial.

For the browser workflow, run the Firebase emulator environment from the handoff on port 3002, with these **test-only** overrides, never real keys:

```powershell
# Run this separate loopback-only fake receiver first:
node tests/emulator/fake-emailjs-server.mjs

# In the QA server shell, after setting the handoff's emulator variables:
$env:EMAIL_DELIVERY_ENABLED='true'
$env:EMAILJS_SERVICE_ID='service-test'
$env:EMAILJS_INVITATION_TEMPLATE_ID='template-test'
$env:EMAILJS_PUBLIC_KEY='public-test'
$env:EMAILJS_PRIVATE_KEY='private-test'
node --import ./tests/emulator/fake-emailjs-preload.mjs ./node_modules/next/dist/bin/next dev --hostname 127.0.0.1 --port 3002

# In a test shell:
node --conditions=react-server --import tsx --test tests/emulator/invitations.test.ts tests/emulator/invitation-assets.test.ts
$env:QUOTEFORGE_RUN_INVITATION_TESTS='true'
npm.cmd run test:browser -- invitations-cloud.spec.ts
```

The preload refuses production/live-project/non-test-key configurations and redirects the EmailJS URL to the local fake receiver. The browser test exercises the real wizard/API/company saving, logo PNG, resend, verified Google emulator acceptance, wrong-account/replay/cross-tenant rejection, and tenant PWA identity. It cannot send mail to a customer. Stop other Next.js dev servers for this workspace before running QA; use a fresh `.next-emulator` cache if stale HMR hashes repeatedly reload the page.
