# Private customer proposal delivery

Delivery is implemented but held until email configuration is supplied. No deployment or real email was performed. Keep `EMAIL_DELIVERY_ENABLED=false` while EmailJS templates are being prepared.

Server-only configuration: `APP_ORIGIN` (the final HTTPS application origin), `EMAILJS_SERVICE_ID=service_mk2cjul`, `EMAILJS_PUBLIC_KEY`, `EMAILJS_PRIVATE_KEY`, and a separate `EMAILJS_PROPOSAL_TEMPLATE_ID`. Invitations continue to use `EMAILJS_INVITATION_TEMPLATE_ID`; one template does not enable the other. Configure EmailJS's recipient from `{{to_email}}`, use the company's verified sender, and expose these proposal template parameters:

| Parameter | Meaning |
| --- | --- |
| `to_email` | Customer email read from the saved reviewed draft |
| `company_name` | Saved company name |
| `customer_name` | Saved customer name |
| `proposal_title` | Saved proposal title |
| `proposal_total` | Server-calculated final customer total |
| `proposal_url` | Private seven-day document link |
| `expires_at` | ISO expiration time |

Use `{{proposal_url}}` in the template's view/download button. It contains a fragment token that is removed from the browser address before requesting the PDF. Email providers can read the link because it is emailed; anyone possessing the link can read that immutable PDF until expiration or company suspension. It grants no application or database access. Do not include private quote controls, source instructions, or owner links in the template.

The send endpoint accepts only a saved draft ID, requires a verified authorized Google session and same-origin request, and revalidates review, customer details, required fields, visible descriptions/quantities/prices, and completed source processing. The PDF is generated on the server and stored privately without Firebase public download tokens. Customers receive PDF bytes through the checked download endpoint, never database records. Links stop working while the company is suspended.

Provider success requires EmailJS's `OK` response. Duplicate clicks and unchanged saves reuse the confirmed delivery; timeouts/uncertain responses never automatically retry. Genuine customer-facing edits create a new delivery operation. Invitations and proposals share a transactional global EmailJS lease with more than one second between dispatches. Confirm uncertain deliveries in the provider before attempting a changed proposal. Private share records expire after seven days; mail audit records carry a 30-day expiration field. Storage retention/Firestore TTL policies can be configured during the deployment/setup review; they are not deployed by this change.
