# Integration handoff

## Live project status

The configured target is **`quote-forge-b153f`**, with owner **`austenconor02@gmail.com`** and intended repository `austenconor02/Quote-Forge`. Configuration files are prepared, but no Firebase resources, rules, hosting backend, billing setting, or production release have been deployed.

The Firebase CLI was retried with the exact supplied project and account. Its project/app API returned **403 PERMISSION_DENIED**. This is an authorization blocker in the current CLI session; it does not contradict the supplied console screenshot. Refresh project authorization before attempting live setup. During inspection, the CLI account-list JSON command unexpectedly emitted credential data; revoke that existing CLI authorization and sign in again. Logs, credentials, private environment files, downloaded tools, and original reference archives are excluded from Git. Do not run or publish the account-list JSON output.

## Firebase setup required before a later release

1. Restore CLI/project access under the intended Google account. Confirm `firebase projects:list` and `firebase apps:list --project quote-forge-b153f` succeed. Avoid commands that print credentials.
2. Register a Firebase Web app in this project and provide its public SDK configuration in the `NEXT_PUBLIC_FIREBASE_*` settings. The server and browser reject unexpected project IDs.
3. Enable Google sign-in in Authentication; configure the support email and authorized application domains. Other sign-in providers do not grant application sessions.
4. Create the Firestore database and private Storage bucket in the intended region. Cloud Storage requires the Blaze plan under the [current Firebase requirements](https://firebase.google.com/docs/storage/faqs-storage-changes-announced-sept-2024). Billing changes require a separate user decision.
5. Select the eventual HTTPS application origin and set `APP_ORIGIN` exactly to that origin. Configure a Firebase App Hosting backend and its runtime service account when deployment is authorized. `apphosting.yaml` deliberately keeps live Firebase and email disabled.
6. Supply server-side application default credentials with only the required Firebase Auth, Firestore, and Storage access. The local CLI login is not the application's Admin SDK credential. Alternatively use `FIREBASE_CLIENT_EMAIL` and `FIREBASE_PRIVATE_KEY` as server secrets; never use a public-prefixed variable for a private key.
7. Set `QUOTEFORGE_OWNER_EMAIL` to the designated owner, and temporarily enable `QUOTEFORGE_OWNER_BOOTSTRAP_ENABLED` for the first recent, verified Google login. Its UID is recorded in `platform/config` and receives the owner claim. Disable bootstrap afterward and pin `QUOTEFORGE_OWNER_UID` to the established UID. An existing owner anchor cannot be silently replaced by a different email/UID.
8. When separately authorized, release the checked-in Firestore rules, Storage rules/indexes, and application together. No rules deployment command has been run as part of this work.

Keep `QUOTEFORGE_DEMO_MODE=false`, emulator flags false, and all emulator host variables absent in production. The development bypass and emulator project are explicitly rejected by production code.

## Authorization and data protection

- Sessions accept only recent, verified Google ID tokens and use a five-day HttpOnly session cookie. Session verification checks revocation. Login/logout use a random CSRF cookie; mutations require the configured origin.
- Owner access requires the anchored UID plus the server-issued owner claim. Tenant access requires an Active company, an enabled company membership, and the matching enabled root account assignment. Mutating transactions recheck current access to prevent in-flight writes after suspension/reassignment.
- Browsers cannot write directly to Firestore. Allowed reads are tenant-scoped; private invitation tokens, delivery operations, owner configuration, and AI settings are not exposed to tenant clients.
- Storage SDK access is denied. Authenticated server routes validate file paths, ownership, MIME magic bytes, size, and current access. Email logos have a separate public PNG-only snapshot route; source files have private immutable content-hash paths; there are no permanent Firebase download-token URLs.
- Cloud saves are explicit and awaited. Company profile edits preserve access status and require the current revision. Customer and draft writes are committed atomically. Lists paginate metadata; full source text is loaded only when a draft is opened.
- Source JSON is stored privately outside Firestore to respect the document size limit: 4 MB per source, metadata pages of 25, and an 8 MB client list budget. Original files are limited to 20 MB each. Request bodies and server rate limits are bounded.
- Cached originals in IndexedDB are separated by authenticated UID. Sign-out clears only that user's cached originals. Existing local-development workspaces and other users' caches are preserved.
- Existing browser-only data is retained as a separate local workspace/recovery archive. There is no automatic cloud migration or complete cloud backup facility. The owner export accurately labels its scope as loaded records.

## Document processing

Supported: PDF, PNG, JPEG, WebP, HEIC, and HEIF. PDF selectable text is extracted directly. Scanned pages and sparse selectable headers over raster pages use OCR; mixed PDFs retain page order. HEIC/HEIF images are decoded before OCR.

Limits include ten documents per quote, 20 MB per original, 30 pages per PDF, 200,000 extracted characters per file, image/render pixel caps, a three-minute timeout per extraction, and bounded concurrency. Individual files expose progress, cancel/remove, retry, source text, and original download. Failed or unfinished sources cannot be silently treated as successfully processed. OCR accuracy depends on source quality; users review the result and pricing before sharing.

Worker code, PDF fonts/maps, WASM, and English trained data use same-origin URLs. Source content is not sent to an external OCR endpoint. Cloud upload happens when the user saves a draft.

Automatic AI quote generation remains unavailable because the original referenced server engine was not supplied. A future integration needs that source (or an explicitly approved replacement workflow), independent provider credentials, and review of its source-to-line-item behavior. No fabricated AI results are returned.

## Invitations and email

EmailJS service: **`service_mk2cjul`**. Invitation template **`template_ho1ym4c`** is supplied. Its public/private keys and live setup remain pending; see [invitation setup](emailjs-invitations.md). `EMAIL_DELIVERY_ENABLED=false`; missing configuration returns an explicit unavailable response and never reports successful delivery.

Before approved live testing, provide these server environment settings:

```dotenv
EMAILJS_SERVICE_ID=service_mk2cjul
EMAILJS_INVITATION_TEMPLATE_ID=template_ho1ym4c
EMAILJS_PROPOSAL_TEMPLATE_ID=
EMAILJS_PUBLIC_KEY=
EMAILJS_PRIVATE_KEY=
EMAIL_DELIVERY_ENABLED=false
APP_ORIGIN=https://your-approved-host
```

Keep the private key in a local/server secret store, outside chat and Git. The implementation intentionally requires it for backend sending. Enable EmailJS API requests from non-browser applications in the account's security settings if required. Configure each template's recipient as `{{to_email}}`; do not allow a client-selected arbitrary recipient field. See the checked-in HTML template examples and the [EmailJS REST API](https://www.emailjs.com/docs/rest-api/send/).

Invitation tokens contain 32 random bytes, have a seven-day lifetime, and are stored only as SHA-256 hashes. Links use a fragment consumed in memory and removed from the address bar. Acceptance requires the exact invited verified Google email, the current confirmed invitation, and a single-use Firestore transaction. Resend/reassignment invalidates previous invitations; reassignment disables previous account bindings and revokes sessions before email sending. Company suspension is rechecked throughout delivery/acceptance.

Email operations share a durable global one-request-per-second lease plus account rate limits. A confirmed provider response is required before an invitation is marked sent. Ambiguous delivery is recorded without an automatic retry to avoid duplicate emails. Provider acceptance is not proof of inbox delivery. No real email was sent during validation.

Proposal delivery uses its own held template and sends only to the customer email in a saved, reviewed draft. Server-generated PDFs are shared through hashed, seven-day bearer links; possession of a link permits reading that PDF until expiry or suspension. It grants no workspace access. See [proposal delivery details](proposal-delivery.md) for template parameters and validation behavior.

## Reproducing focused validation

Unit tests use generated fixtures. Browser tests use isolated contexts and test-only workspaces; they do not load or alter the owner's ordinary browser profile. Playwright currently expects Chrome at `C:/Program Files/Google/Chrome/Application/chrome.exe`; adjust that path for another machine.

For local preview regressions, run the dev server with live services disabled, then:

```powershell
npm.cmd run test:browser -- workspace.spec.ts intake-increment.spec.ts documents.spec.ts
```

For Firebase validation, install the Firebase CLI and Java 21+, then start Auth/Firestore/Storage emulators with project `demo-quoteforge`. All addresses must be loopback. Rules tests use the separate fake project `demo-quoteforge-rules` on those emulators, so they do not touch the API test owner's anchor. No production credentials or project IDs are used for emulator records.

```powershell
firebase.cmd emulators:start --only auth,firestore,storage --project demo-quoteforge
```

In another shell, start an isolated QA server with these settings. A separate build directory avoids corrupting a running preview's generated files:

```powershell
$env:QUOTEFORGE_NEXT_DIST='.next-emulator'
$env:QUOTEFORGE_FIREBASE_ENABLED='true'
$env:QUOTEFORGE_USE_EMULATORS='true'
$env:QUOTEFORGE_DEMO_MODE='false'
$env:FIREBASE_PROJECT_ID='demo-quoteforge'
$env:FIREBASE_STORAGE_BUCKET='demo-quoteforge.appspot.com'
$env:FIRESTORE_EMULATOR_HOST='127.0.0.1:8080'
$env:FIREBASE_AUTH_EMULATOR_HOST='127.0.0.1:9099'
$env:FIREBASE_STORAGE_EMULATOR_HOST='127.0.0.1:9199'
$env:QUOTEFORGE_OWNER_EMAIL='owner@example.com'
$env:QUOTEFORGE_OWNER_UID=''
$env:QUOTEFORGE_OWNER_BOOTSTRAP_ENABLED='true'
$env:APP_ORIGIN='http://127.0.0.1:3002'
$env:EMAIL_DELIVERY_ENABLED='false'
npm.cmd run dev -- --port 3002
```

Run focused suites in a shell with the emulator host settings above:

```powershell
npx.cmd tsx --test tests/rules/*.test.ts
node --conditions=react-server --import tsx --test tests/emulator/invitations.test.ts
node --conditions=react-server --import tsx --test tests/emulator/proposal-delivery.test.ts
node --test tests/emulator/persistence-http.test.mjs
$env:QUOTEFORGE_RUN_CLOUD_BROWSER_TESTS='true'
npm.cmd run test:browser -- cloud-documents.spec.ts
```

The cloud browser test extracts a real PDF, enters manual pricing, saves it through the real server/emulator routes, reloads the saved source, and verifies original download bytes from a fresh browser context. Live Google OAuth, production Firebase provisioning, real EmailJS delivery, and automatic AI generation have not been verified.

The Firebase SDK/Admin dependencies were updated and audited. Targeted overrides pin patched gRPC/rimraf dependencies and Node 22-compatible Firebase app peers. Review these pins when upgrading Firebase rather than removing them without an audit.
