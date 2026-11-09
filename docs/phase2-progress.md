# QuoteForge Phase 2 — incremental work

The existing Phase 1 application remains the base. The supplied archives are reference material, never runtime imports. Do not call the original application's Firebase or AI endpoints.

## Increment 1: logo and original quote intake

- Converted the supplied navy QF finance anvil PNG to a full-resolution lossless WebP, plus a 256 px interface version. The owner dashboard and login use this artwork; company workspaces retain their own logos.
- Imported 59 original files from `app.zip` and `features.zip` under `reference-source/`, retaining their bytes. `phase2-inventory.json` records their SHA-256 hashes. Original external archives are unchanged.
- Reordered quote intake to match `NewQuote.jsx`: customer/project first, then Drop Anything Here, Extracted / Pasted Text, Special Instructions for AI, and Generate AI Draft. Retained the existing Phase 1 editor underneath for this increment.
- Added backward-compatible `Quote.sourceInput` with pasted text, special instructions, and per-document metadata/errors. Existing drafts load without this property. Saving and reopening retains these fields using the existing local demo repository.
- Document selections are explicitly pending. The UI retains unsupported/over-limit files as visible errors rather than silently dropping them. File bytes, OCR, extraction, and cloud document storage are not implemented in this increment.
- Source and AI instructions remain internal; the customer PDF generator does not consume them.

## Original behavior to restore in later increments

Use subsequent user prompts to select each bounded increment. Do not combine this list into a single implementation/test pass.

1. Actual extraction: embedded PDF text; OCR for images and scanned PDF pages; HEIC/HEIF conversion; per-document progress, errors, source names, and private file persistence.
2. Server AI generation: preserve the original structured response and traceability. Use company-scoped, owner-configured AI instructions retrieved after backend authorization. Never replace unknown original engine behavior with a fixture or a simplified parser.
3. Editor fidelity: separate generation/review stages; group by source document and section; retain confidence, review flags, warnings, source reasons, and original ordering. Restore none/percentage/multiplier/flat private markup modes.
4. Original PDF template: US Letter portrait; branded header/logo; Project Proposal; Prepared For left and proposal number/date right; accent divider; Detailed Scope of Work; Description / Qty / Unit Price / Amount columns; section subtotals; total; Notes; Customer Approval signature/date; company contact footer. Apply each company's saved theme rather than copying the reference's green/gold colors.
5. Independent Firebase persistence and tenant authentication: new project, verified sole-owner UID, server session cookies, company membership enforcement, tenant collections/storage, persistent drafts, and emulator validation. Do not connect the original project.
6. Invitation delivery and installation: configured email provider, hashed single-use expiring tokens, verified email acceptance, tenant logos/manifests/icons over HTTPS. No live delivery or deployment is authorized in this increment.

## Reference map

- `reference-source/features/QuoteBuilder/NewQuote.jsx`: intake order and source-to-editor handoff (`customerId`, `customerName`, `fileNames`, `hasEmailText`, `rawExtractedText`, `fallbackParsedLineItems`, `aiDraft`, `specialInstructions`, `createdAt`). The original endpoint and localStorage transport are reference-only.
- `reference-source/features/QuoteBuilder/DropAnythingHere.jsx`: source inputs, clipboard behavior, extracted/pasted text, and file list.
- `reference-source/features/QuoteBuilder/SpecialInstructions.jsx`: optional internal AI instruction input.
- `reference-source/features/QuoteBuilder/QuoteEditor.jsx`: real editor, document/section grouping, private pricing, and PDF implementation. Its schema consumption is evidence, not the complete generation-engine contract.
- `reference-source/services/extractionService.js`: original embedded PDF extraction, image OCR, and HEIC conversion. Scanned PDF OCR must be added; the original only returned an OCR-fallback message.
- `reference-source/firebase/firestore.js`: original customer/draft behavior to port to company-scoped repositories, never its original Firebase configuration.

## Still missing or unconnected

`functions/index.js` and `generateQuoteDraft` were not present in either new archive. Several component/service files remain empty, but the newly supplied `QuoteEditor.jsx` contains the real PDF generator. The Phase 1 A4 PDF is provisional and has not yet been replaced with that template.

No independent Firebase project credentials, designated owner UID, OpenAI server secret/organization, or transactional email service have been supplied. Existing integration gates remain disabled. Java is also missing for Firebase emulator tests. Do not describe cloud persistence, OCR, live AI, invitations, or PWA installation as operational yet.

Validation for this increment: TypeScript check and the targeted logo/intake browser check only. No full Phase 2 build or comprehensive integration test was attempted.
