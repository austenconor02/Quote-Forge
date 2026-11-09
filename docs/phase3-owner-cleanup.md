# Phase 3: simplified owner experience

The existing Next.js application and server authorization boundaries remain in place. This change consolidates owner setup; it does not connect live services or deploy the app.

## Owner workflow

- `/` and `/companies` show **My Companies**, containing only owner-created records. No overview, statistics, marketing content, example companies, or sidebar.
- Company cards show their logo/name, assigned email from access records, invitation/account state, creation date, and Edit/Open Company/Resend/Deactivate actions. Search filters the actual list.
- `/create-company` and `/companies/{id}/edit` use the same four-step wizard: Company & Logo → Choose Colors → Preview Application → Assign & Send.
- Additional contact details are collapsed. Logo preview, color picker, HEX input, owner-only eyedropper, local logo color suggestions, font, and shared theme variables are retained.
- The preview provides Desktop, Mobile, and a real PDF rendered by the same existing generator used for download. Preview content stays isolated and cannot create customer or quote records.
- A first-time contextual walkthrough follows the actual controls, with Previous/Next, Skip, persistent progress, completion, and Help/Restart.
- Editing retains company identity and merges profile/branding onto the latest settings, retaining access status, existing fields, customers, drafts, and other data.

## Existing functionality retained

- The company workspace, customer records, line-item editing/calculation, private pricing, source intake, saved drafts, and PDF preview/download remain available through **Open Company**.
- New actual quotes start empty. Realistic sample content is reserved for explicit owner setup previews.
- Source text and internal instructions remain part of saved drafts and stay out of customer PDFs.
- Firebase owner and tenant guards, Firestore/Storage rules, server-only integration boundaries, and company-specific manifest/icon code remain intact.
- Separate Branding Studio and Company Preview links are removed from navigation. Their old URLs lead to the corresponding company workflow. Field Builder code, data, and owner-protected route remain available for future use; existing quote fields are preserved.
- Customers opening `/app/{id}` see only their company application. Owner setup controls are not part of that view.

## Data preservation

The new owner store is `quoteforge.owner.workspace.v2`. Previous `quoteforge.phase1.workspace.v1` and `quoteforge.phase1.tenant.*` entries are left untouched as recovery data. The six exact seeded company identities are excluded from the active list; user-created identities, even with the same display name, are retained. Explicit owner records and their associated data are migrated. Settings provides both workspace and recovery exports.

Tenant snapshots now use `quoteforge.owner.tenant.v2.*`. Cross-tab draft merges retain newer records and do not discard records absent from an event. Parsing preserves additional stored company, customer, proposal, quote, and line-item metadata.

## Integration boundaries

Company settings and drafts currently save in the local browser. Production still requires the designated verified owner; it cannot use the development owner bypass.

Invitation delivery currently returns an explicit unavailable response. **Create Company & Send Invitation** does not report success, mark an invitation sent, or create duplicate companies on failure. The owner can explicitly **Save unassigned draft**. Email changes for an existing assignment are blocked until the server can securely revoke/reassign access. Deactivation/reactivation currently applies to local company access only.

Still required: an independent Firebase project/configuration and persistent repository, the verified owner UID/claim, tenant membership and invitation acceptance, transactional email configuration/verified sender, and server-confirmed revocation/reassignment. Live AI also still requires the missing `functions/index.js` generation engine and server-side OpenAI configuration. OCR/extraction remains a separate incomplete increment. Tenant installation requires HTTPS and server-stored logos. The current PDF generator remains operational; matching the original US Letter template is separate unfinished Phase 2 work.

No original reference files or production records were modified. No live invitations or deployment were attempted.

## Verification

- TypeScript and optimized Next.js build passed.
- 23 unit tests passed for access policy, pricing, PDFs, empty actual quotes, migration, cross-tenant merges, and preservation of additional stored metadata.
- 10 focused browser checks passed using isolated test storage: dashboard/navigation, four-step setup, logo/colors, Desktop/Mobile/PDF previews, no preview record writes, invitation failure/retry identity, same-company editing, blocked insecure reassignment, deactivation/reactivation, tutorial progress, and source intake/PDF regression.
- The stale editor test confirmed that a newer deactivation and custom-field update from another tab survive saving the open wizard.
- 17 checks against the production build passed: protected owner/company pages redirect to sign-in and unauthorized API requests fail, even with a forged session. The production test server was stopped afterward.
- Screenshots were inspected for desktop/mobile layout and tutorial alignment. Firebase rules-emulator validation remains unavailable because Java is not installed; no live Firebase or email verification is claimed.
