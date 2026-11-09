# OpenAI source compilation

QuoteForge's source-based AI backend was implemented November 9, 2026. The owner explicitly approved replacing the previously missing generation engine. It connects to the existing company quote editor and PDF generator; company creation and the owner dashboard retain their existing workflow.

## Live release

Firebase rollout `build-2026-11-09-002` succeeded at https://quoteforge--quote-forge-54595.us-central1.hosted.app. The deployed runtime has AI enabled, the pinned model, and a runtime-only reference to secret version 1. Inspection confirmed no plaintext API-key value in the Cloud Run environment configuration. Stripe and email remain disabled. Live checks confirmed that the new AI endpoint rejects unauthenticated requests and the deployed PDF parser/worker extracts a synthetic PDF correctly. No real company quote was automatically generated as part of the release; the authenticated end-to-end workflow was exercised in isolated emulators with a fake provider, alongside the separate real OpenAI synthetic-source test below.

## Key and account setup

Create a project-scoped server key at https://platform.openai.com/api-keys. Configure OpenAI API billing for that project. Firebase Google sign-in authenticates QuoteForge users; it does not authorize OpenAI requests or give OpenAI access to Gmail or Drive.

Local server settings in the ignored `.env.local`:

```dotenv
QUOTEFORGE_AI_ENABLED=false
OPENAI_API_KEY=
OPENAI_MODEL=gpt-5.4-mini-2026-03-17
OPENAI_PROJECT_ID=
OPENAI_ORGANIZATION=
```

The API key must never be public-prefixed, committed, sent to the browser, or pasted into chat. The model snapshot is configurable on the server. Enable the local flag only after key/setup checks; local cloud operation also needs valid server Firebase credentials. The CLI login is not a local Admin SDK credential.

For deployment, bind `OPENAI_API_KEY` to an App Hosting runtime-only Secret Manager version, with access limited to the backend's managed service identities. `.env.local` is excluded from the upload archive and is never a deployment mechanism. Enable `QUOTEFORGE_AI_ENABLED` in the runtime configuration only after verification. Stripe and EmailJS have their independent disabled flags.

The verified key is configured as `QUOTEFORGE_OPENAI_API_KEY`, version 1, in Firebase project `quote-forge-54595`. `apphosting.yaml` binds it to `OPENAI_API_KEY` at runtime only and enables AI for the release after the checks above. The example/local safety default remains disabled. No API key value is stored in this document or source control.

## Processing and review

1. The user selects source files/pasted scope and confirms the AI action. Customer form fields, private markup, and unrelated records are not added to the request. Selected originals can themselves contain customer information.
2. Original files are uploaded privately. The server authenticates current company access and billing, resolves only that company's document IDs, and verifies each stored path, size, hash, and file signature. Clients cannot supply provider file URLs, models, credentials, or arbitrary storage paths.
3. PDFs and supported images are passed directly to a vision-capable OpenAI Responses model. Images are normalized and resized on the server. PDF.js remains the local browser extraction path; its main ESM module and worker are served from matching pinned, same-origin assets.
4. Strict structured output compiles source-backed scope into categories. Rules require combining duplicate evidence of the same work, retaining distinct locations/occurrences, matching supplied prices and units, flagging conflicts, and ignoring source totals/markup as billable work. Source documents and special instructions cannot override privacy/pricing rules. Company-specific owner instructions can be stored privately at `companies/{companyId}/aiConfig/rules.instructions`; no new owner configuration UI was added.
5. The server validates output structure, known source IDs/pages, exact evidence for pasted text, numeric price evidence, and bounded quantities/prices. Unsupported prices/quantities become zero with review warnings. Unit rates derived from a supplied line total are calculated in code and flagged for rounding review. Only exact repeated rows with identical scope and evidence are removed deterministically; uncertain semantic duplicates require user review. Visual/PDF evidence is model-derived and must be checked against originals.
6. All generated items have `needsReview=true`. The result replaces current line items only after successful compilation. Existing manual edits remain intact on failure. Source evidence, warnings, and model/job metadata survive saving and reopening. Changing sources/pricing clears approval. Normal quantity, unit price, new-item, markup, and tax controls remain available.
7. QuoteForge calculates totals in cents and renders the branded PDF in code. AI is not called for arithmetic, each manual edit, or PDF rendering. Private source references/instructions are not printed on customer PDFs.

## Company isolation and retention

One server-held OpenAI account/project key serves the application. Each model request contains only the current authorized request's selected sources and rules. It uses `store:false`, no tools, no shared conversation, no `previous_response_id`, no hosted vector store, and no persistent OpenAI file upload. The provider base URL is fixed to the official API. SDK logging is disabled and provider error bodies are never returned or logged.

Firestore AI jobs/results/leases are private to server APIs. Status retrieval also checks the initiating UID. Authorization is checked before sending and before returning a result; final writes recheck access transactionally. Uploads remain in the existing private company storage paths.

`store:false` does not promise zero provider retention. OpenAI's standard abuse-monitoring retention can still apply; API content is not used for training by default unless the account opts in. Review the actual OpenAI project's data controls. Jobs include seven-day expiration metadata; automatic Firestore deletion requires a configured TTL policy. Company drafts and originals follow the existing app's retention/deletion behavior.

## Limits and failed requests

Per draft: up to 10 files, 20 MB combined original bytes and 20 MB prepared model bytes, 30 pages per PDF, 40 total PDF pages/images, 100,000 pasted characters, 12,000 special-instruction characters, and 200 generated items. Empty/encrypted/unreadable PDFs fail before the provider call. HEIC/HEIF AI preparation depends on the deployed Sharp codec; if decoding is unavailable, the app explicitly asks for PNG/JPG rather than silently omitting the image.

Each account is limited to five generation attempts/hour and each company to twenty/day. These are request caps, not monetary caps; configure OpenAI project spend limits/alerts separately. Model output is capped at 16,000 tokens. The SDK has a 150-second timeout and automatic retries are disabled.

Request IDs are company/UID/payload-bound, completed results are reused, and a company lease blocks overlapping paid jobs. Failed/uncertain requests are not automatically resubmitted. The modal offers status recovery; an explicit new generation is a separate API request and can incur another charge. A request without a confirmed result after four minutes is reported as uncertain and permits only an explicit new generation; preserve the request identity and inspect status before retrying.

## Verification

- 57 unit tests and six offline server tests passed, including source references, exact duplicates vs different locations, missing/unsupported prices, no shared model state, and no tools.
- Seven emulator service tests passed: missing config, foreign files/paths, hash checks, PDF limits, request idempotency, company leases, and revocation during generation.
- Three authenticated HTTP tests passed with a fake model and isolated Google/Firebase emulator identities: anonymous/cross-company denial, initiating-user binding, forged provider settings, and origin checks.
- Ten Firestore/Storage rule tests passed, including denial of browser AI-job and lease access.
- A real browser test with a fake model passed: PDF extraction/upload, AI compilation, source review, manual price edit, markup, save/reopen, and PDF download.
- A real OpenAI request using the owner's saved key processed only a synthetic PDF, synthetic image, and pasted duplicate scope. It returned two correctly priced items (2 at USD 12.50; 3 at USD 4.00), combined duplicate scope, and retained source references. Reported usage: 1,309 input and 302 output tokens. No customer data was used in that test.
- Production build passed; a server-key sentinel was absent from browser JavaScript. Production dependency audit reported zero vulnerabilities.

## Primary references

- [API authentication](https://developers.openai.com/api/reference/overview#authentication)
- [PDF and file inputs](https://developers.openai.com/api/docs/guides/file-inputs)
- [Structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs)
- [Model capabilities](https://developers.openai.com/api/docs/models/gpt-5.4-mini)
- [Data controls](https://developers.openai.com/api/docs/guides/your-data)
