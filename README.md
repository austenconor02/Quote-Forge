# QuoteForge

Company-specific quoting workspaces built with Next.js, Firebase Auth, Firestore, private Cloud Storage, and EmailJS. The owner creates companies and branding; invited Google accounts can access only their assigned active company.

## Current implementation

- Four-step company setup, supplied QuoteForge logo converted to WebP, isolated previews, and an owner tutorial.
- Actual PDF text extraction, scanned-page/image OCR, and HEIC/HEIF conversion in the browser. Processing workers and the English OCR model are served from this application, without sending document content to an OCR provider.
- Private source-file uploads, saved extracted text, customer records, and draft reopening. Original downloads require current company access.
- Quote editing and branded US Letter PDFs with quantity, unit price, amount, section subtotals, tax, and approval/signature areas. Private adjustments are incorporated into customer prices.
- Verified Google sign-in, server session cookies, CSRF/origin checks, immutable owner UID setup, tenant authorization, rate limits, and restrictive Firestore/Storage rules.
- Expiring, single-use invitation links and server-side EmailJS delivery. Email delivery remains disabled until templates and keys are configured.
- Reviewed proposals can be sent through the same held delivery service as private, expiring PDF links. See [proposal delivery setup](docs/proposal-delivery.md).

**No deployment has been performed.** The target project is `quote-forge-b153f`. Local development works independently; live services fail closed until configured. The original AI generation engine (`functions/index.js`) was absent from the supplied references, so automatic generation remains disabled. OCR does not generate prices or scope.

## Local preview

Use Node 22.13.1 or newer. Copy `.env.example` to `.env.local`, leaving Firebase and email flags disabled.

```powershell
npm.cmd ci
npm.cmd run dev
```

Open `http://127.0.0.1:3000`. The local owner bypass works only in development on loopback. Production always requires authentication. Local browser data is kept separate from cloud records and is never automatically uploaded.

`npm ci` prepares the pinned PDF/OCR worker assets. The committed English OCR model includes its license and provenance under `public/document-assets/tesseract/lang/`.

## Validation

```powershell
npm.cmd test
npm.cmd run typecheck
npm.cmd run build
```

Browser and emulator validation instructions, security behavior, live setup requirements, and remaining integration work are in [docs/integration-handoff.md](docs/integration-handoff.md). CI performs unit tests, typechecking, and a production build; it has no deployment job.

EmailJS invitation setup and the supplied template mapping are in [docs/emailjs-invitations.md](docs/emailjs-invitations.md).

Historical Phase 2/3 documents record earlier milestones. The integration handoff describes the current implementation.
