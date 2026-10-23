# Connect Hyzz to your Supabase project

Project: `https://ajkdzvcnhnsvgfltfziu.supabase.co`.
The supplied publishable key is included in `packages/config.js`. It identifies the application; it does not grant administrator access. No database password, SMTP password or service-role key is included in client code.

## 1. Apply migrations

In Supabase Dashboard → SQL Editor, run these complete files **in order**, once:

1. `supabase/migrations/001_hyzz.sql`
2. `supabase/migrations/002_admin.sql`
3. `supabase/migrations/003_operations.sql`

Alternatively, paste `supabase/Hyzz-setup.sql` for the same fresh installation. Choose either the combined file or the three individual files; **do not run both**. The first-admin bootstrap is a separate step after email verification.

Each file is transactional. These create new Hyzz tables in `public`; inspect existing names before running against an established database. They do not delete existing Auth users. Existing Auth users receive customer profiles, never staff permissions. Back up an existing database before installation. If an execution fails, resolve the reported error and rerun the failed transaction; do not skip statements. These are initial-install migrations, not scripts to rerun over an already installed schema.

PostGIS and pgcrypto are installed into `extensions`. If your project already has either extension in a different schema, align its schema references before running migration 001. See Database → Extensions. Do not move an extension used by another application without reviewing its dependencies.

All monetary values are integer paise in PostgreSQL BIGINT; percentage calculations use NUMERIC. 100 paise = ₹1. Default hourly price: ₹50 base + ₹150/hour, ₹200 minimum; full day: ₹1,200 for 8 hours; extra time: ₹150/hour in 15-minute increments; driver commission: 15%. These are **initial test settings**, not a business-approved tariff. Change them in Admin → Settings before operations. Existing bookings retain their price snapshot. No customer commission, taxes, tolls or parking are added. Pre-trip cancellation is free. Distance-based billing is unavailable.

## 2. Configure email OTP through IONOS

In Authentication → Email / SMTP settings, enable custom SMTP:

| Field | Value |
| --- | --- |
| Host | `smtp.ionos.com` |
| Port | `587` |
| Username | `ramarao.teamweb@bedatatech.com` |
| Password | Enter the mailbox/app password **directly in Supabase Dashboard** |
| Sender email | `ramarao.teamweb@bedatatech.com` |
| Sender name | `Hyzz` (or your approved business sender name) |
| Transport | STARTTLS on port 587; use your mailbox provider's supported settings |

Keep email confirmation enabled. Do not enable automatic email confirmation to bypass verification. Set a short email OTP expiry (for example 10 minutes), configure Auth rate limits and CAPTCHA/abuse protections appropriate to public launch. The apps provide a 60-second resend cooldown; server-side enforcement remains essential.

In Authentication → Email Templates, update **Magic Link** and **Confirm Signup** templates to include the numeric token:

```html
<h2>Your Hyzz verification code</h2>
<p>Your sign-in code is <strong>{{ .Token }}</strong>.</p>
<p>If you did not request this code, ignore this message.</p>
```

The apps use `signInWithOtp` / `verifyOtp(type: 'email')`. A link-only template does not satisfy the code-entry flow. Verify both first signup and returning-user delivery using real test mailboxes. Supabase's default mail service restricts recipients; custom SMTP is needed for general users. IONOS SMTP authentication and delivery have **not** been tested here. SPF/DKIM, sender authorization, quotas and anti-spam settings are controlled by your mailbox provider.

Phone OTP is deliberately not exposed in this release, following the requested email fallback. A profile mobile number is a contact field, **not a verified phone identity**. To add phone sign-in later, configure a Supabase-supported SMS provider and implement/test `signInWithOtp({phone})` and `verifyOtp({phone, token, type:'sms'})`. Never use the mailbox password as an application login password.

## 3. Bootstrap the first administrator

1. Install Hyzz Customer or run the customer project in Expo Go.
2. Sign in using your own email and the emailed code. This creates a customer account.
3. Open `supabase/bootstrap-admin.sql`, replace `REPLACE_WITH_YOUR_VERIFIED_EMAIL` with that verified email, and run it in SQL Editor.
4. Open the admin website and request a fresh email code for the same account.

Bootstrap refuses to run when a Super Admin already exists. Later staff accounts must be created in Admin → Employees. Use a different verified email for customer testing; an employee cannot use the customer booking interface.

## 4. Deploy admin account provisioning

The publishable key cannot create privileged Auth accounts. A single Supabase Edge Function uses the platform's server-side service-role secret, verifies the caller's JWT, and checks backend staff permissions before creating a driver or employee.

PowerShell, from the `Hyzz` directory:

```powershell
npx supabase@latest login
npx supabase@latest link --project-ref ajkdzvcnhnsvgfltfziu
# Use your actual deployed admin origin for production. For local development:
npx supabase@latest secrets set ADMIN_ALLOWED_ORIGIN=http://localhost:5173
npx supabase@latest functions deploy admin-accounts --no-verify-jwt
```

`--no-verify-jwt` disables only the gateway's legacy JWT gate. **The function verifies the access token itself with `auth.getUser()` and checks the caller's database permissions.** Requests with only the public key cannot create accounts. The hosted runtime supplies `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`; do not add the service key to any frontend or APK. Local development needs these in a private, untracked Edge Function environment file.

No invitation is falsely reported as sent. Admin creates an unconfirmed passwordless account; its owner requests an email code in the driver app or staff website. The account's email is verified by Supabase before a session is established. Public customer signup never reads a client-supplied role.

## 5. Complete a two-device acceptance test

1. Admin → Customers → Create driver account. Use a new driver email.
2. Admin → Drivers → upload license and identity (PDF/PNG/JPEG, up to 5 MB), set real expiry/review dates, review each private document, approve both, then approve the driver with a reason.
3. Driver signs into **Hyzz Driver**, saves profile, grants foreground location permission, and goes online. Stay on Requests.
4. A different customer signs into **Hyzz Customer**, saves profile, chooses pickup near the driver, gets the server estimate, and confirms a cash booking.
5. Driver refreshes nearby requests and accepts. A second driver must not win the same booking.
6. Driver selects heading to pickup, then arrived. Customer generates the pickup OTP and shares it only at arrival.
7. Driver verifies OTP. Both apps show IN PROGRESS. Pickup location access stops. No background trip tracking is performed.
8. Driver completes the trip. Check receipt and immutable earnings/commission entries.
9. Driver confirms cash collection; customer confirms cash payment. Only then is cash settled. Platform cash collected remains zero.
10. Test support, rating, cancellation, suspension, expired documents and limited employee permissions. Inspect Admin → Audit and Finance.

Keep both apps foregrounded for this pilot. Foreground polling reconciles snapshots; Realtime accelerates assigned booking changes. No background push provider is configured. A queued database notification is not proof of email/SMS/push delivery.

Official references: [Supabase email OTP](https://supabase.com/docs/guides/auth/auth-email-passwordless), [custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp), [React Native Auth](https://supabase.com/docs/guides/auth/quickstarts/react-native), [API keys](https://supabase.com/docs/guides/getting-started/api-keys).
