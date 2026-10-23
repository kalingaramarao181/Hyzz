# Hyzz operations, website and APK updates — 1.5.0

This release adds the remaining administration workflows and a separate public website. Android versionCode is **7**. Earlier driver screen and deployment guides remain available; this guide describes the current upgrade.

## What administrators can manage

| Area | Where to work | Server permission / behavior |
| --- | --- | --- |
| Customer and driver accounts/contact maintenance | Customers → Create customer / Create driver | `users.manage`; create email-OTP identities, view contacts and edit name/phone with an audit reason; never exposes passwords or tokens |
| Employee accounts and access | Employees → Create employee, roles and granular permissions | `staff.manage`; existing self-change/Super Admin safeguards apply; only Super Admin can provision another Super Admin |
| Driver documents and approval | Drivers | `drivers.review`; four approved, unexpired documents are still mandatory |
| Driver ride access | Drivers → Driver ride access | `drivers.review`; enables/pauses new rides separately from document approval; active trips must finish or be reassigned first |
| Unaccepted rides / reassignment | Bookings → Manual assignment | `bookings.manage`; choose from approved, online, unassigned drivers, including when no driver accepted; changes are audited and both parties notified |
| Default rates, tax and commission | Settings → Pricing | `settings.manage`; append a new pricing version; existing trips keep their snapshot |
| Individual ride commission | Bookings → Commission for an individual ride | `finance.manage`; permitted only before assignment, never rewrites an accepted/completed trip |
| Cash and commission receipts | Finance | Existing two-party cash confirmation, ledger and immutable receipts |
| Wallet credits and payout requests | Finance | Audited manual credit/approval/transfer-reference workflow; no automatic bank transfer |
| Coupons | Promotions | `finance.manage`; flat or percentage, caps, minimum fare, validity, total/per-customer limits and enable/disable |
| Policies, guides and contacts | Content | `content.manage`; edit plain text, keep drafts private, publish reviewed content |
| Website/app/login enquiries | Enquiries | `support.manage`; view private contact information, record review notes and resolve |
| APK distribution and notices | App updates | `releases.manage`; private direct upload, explicit publish, retire, batch announcement processing |
| Other operations | Existing Bookings, Customers, Support, Reports, Audit, Settings | Cancellation, suspension, maintenance, service zones/categories, role controls, CSV and audit records remain available |

Super Admin receives the two new permissions through migration 009. Grant `content.manage` and `releases.manage` to another role only when needed. Tabs are filtered by the verified staff profile and SQL checks every privileged action. Do not grant all permissions to every employee.

Coupon discounts are funded from platform commission, capped by both the coupon limit and the trip commission. Driver earnings and tax remain unchanged. The customer enters a coupon in the booking form; the server validates and reserves it atomically with booking creation. Invalid coupons roll back the entire request. The estimate shown before booking is the undiscounted estimate; the resulting booking and final receipt show the applied price/discount. Cancelled/no-driver bookings release their coupon reservation. Existing bookings retain the saved coupon terms even if a code is edited later.

## Upgrade an existing database

- If migrations **001–008** are already applied, run `backend/database/Hyzz-upgrade-1.5.sql` **once** (009 and 010).
- If 009 is already applied, run only `010_app_releases.sql`.
- If your database is older, apply only missing numbered migrations in order before 009/010. Do not re-run older combined upgrades or reset live records.
- `backend/database/Hyzz-setup.sql` is for a **new empty project** only.

The new private bucket is `app-releases`, maximum **50 MiB per APK**. Private Storage access is granted using short-lived upload/download capabilities issued by the Node API. The service key and bank encryption key remain backend-only. Preserve the bank key when deploying this upgrade.

## Deploy the three separate web projects

1. **API:** extract `backend/release/Hyzz-backend.zip`, deploy its `backend` folder with Node **22.x** to `https://api.srtechcreators.in`. Keep the existing server environment values. Do not upload `.env` as a substitute for Vercel Production settings.
2. **Admin:** extract `frontend/admin/release/Hyzz-admin-vercel.zip`, deploy the folder containing its package.json. Framework Vite, `npm ci`, `npm run build`, output `dist`, Node 22.x. Set `VITE_API_BASE_URL=https://api.srtechcreators.in`. Existing admin domain: `https://hyzz.srtechcreators.in`.
3. **Public website:** extract `frontend/website/release/Hyzz-website-vercel.zip`. Deploy as a separate Vite project with the same build commands/output. Choose your public website domain; no additional domain has been deployed by this local build. Set `VITE_API_BASE_URL=https://api.srtechcreators.in` and `VITE_ADMIN_URL=https://hyzz.srtechcreators.in`.
4. Add the **exact public website origin**, including its https scheme, to the backend `ALLOWED_ORIGINS` alongside the admin origin, separated by commas. Do not use `*`. Redeploy the API after changing server variables. Website/admin build-time URL changes require a new web build.
5. Sign in as the provisioned Super Admin. Review Content and publish your final policies. Privacy/terms templates are drafts, not operator-approved legal policies. Your supplied phone is stored as **+91 77300 20465** for phone/WhatsApp and can be edited in Content. Set `contact_email` if you want a public support email; no unprovided address is invented.
6. Install the new customer/driver APKs, then test one complete booking and each staff role against staging/your hosted project.

The website includes responsive animated sections, customer/driver guides, FAQ, published app downloads, editable policies/contact details, phone/WhatsApp actions and an enquiry form. Contact forms are also accessible from admin login and both apps' **Help, guides & app updates**. Enquiries are stored for admin review; no automatic outgoing email or guaranteed response time is implied. The contact endpoint validates consent/fields and rate-limits submissions; add your operational anti-abuse controls if traffic requires them.

## Upload a future APK update

1. Edit the customer or driver source. Increase that app's `version` and `versionCode` in `frontend/<audience>/app.config.js`. Keep `com.hyzz.customer` / `com.hyzz.driver` and the **same signing certificate** as installed applications.
2. Rebuild from the `Hyzz` folder:

```powershell
npm install
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-apks.ps1 -Variant both
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify-apks.ps1
```

For one app use `-Variant customer` or `-Variant driver`. Build outputs are `frontend/customer/apk/Hyzz-customer.apk` and `frontend/driver/apk/Hyzz-driver.apk`. The supplied local builds use the existing **internal test signing key**. Use your managed production signing process before public distribution; do not regenerate a signing key for an update.

3. Run Android **apksigner verify --verbose --print-certs** and **aapt dump badging** on the APK using your Android SDK build-tools. Compare its signer with the installed/released app. The local verification script performs these checks for both produced APKs.
4. In admin → **App updates**, select audience, exact version/code and notes, then upload the APK. Bytes go directly to private Supabase Storage, avoiding Vercel's small function request-body limit. Use a stable connection. Retry with the same draft metadata if upload failed; if it actually uploaded, publish that existing draft rather than attempting to overwrite it.
5. Select **Publish verified APK** only after checking the Android signature/native identity. The Node service checks archive limits, AndroidManifest/classes presence, embedded Expo audience/package/version, actual size and SHA256. It does **not** run apksigner or independently prove the native manifest/signature matches embedded metadata. Administrator confirmation is a required trust step, not a server-side signature-verification claim.
6. Published releases become visible through the public download endpoint and website. Apps at **1.5.0 or later** check at launch/resume and about every minute while open and show a newer-version prompt. This first 1.5.0 installation must be installed manually on existing 1.4 devices to gain that feature. Users download through their browser and approve Android installation; there are no silent updates.
7. Publication queues audience-specific in-app announcements in batches of 200, deduplicated by release/user. The first batch runs on publish. Click **Process next notification batch** as needed or schedule the protected worker continuously. Drafts never appear as updates; retiring a release blocks new downloads and stops remaining announcement batches. A previously issued 60-second download URL can remain valid until expiration.

Remote push delivery when the app is closed still needs Firebase/FCM credentials, each app's Expo project/client configuration, and your authenticated scheduler calling `/api/internal/push` with `CRON_SECRET`. The worker also processes release announcement batches when remote push is disabled. In-app update checks do not depend on Firebase. A missed push does not prevent the next foreground version check. Offline/restricted phones cannot be guaranteed immediate delivery. See `LIVE-PLATFORM-1.3.md` for provider setup.

## Where to edit

```text
backend/src/modules/admin.js          Account creation, now including customers
backend/src/modules/public.js         Public content/contact endpoints
backend/src/modules/releases.js       Signed upload, APK checks, publish/download
backend/database/migrations/009_*     Operations, content, coupons and ride access
backend/database/migrations/010_*     APK release registry and announcement batches
frontend/admin/src/Management.jsx    Access, coupons, content, enquiries, updates
frontend/admin/src/Operations.jsx    Assignment dropdown and role permissions
frontend/admin/src/ContactUs.jsx     Admin login contact form
frontend/website/src/main.jsx        Public website sections/form/downloads
frontend/website/src/style.css       Public website theme/animation/responsiveness
frontend/shared/mobile/AppServices.js App guides/contact/update prompt
frontend/customer/src/screens/BookingForm.js Customer coupon entry
frontend/shared/config.js            Default API origin used by admin/mobile
```

Website API/admin links use its `.env.example` settings. SMTP/database keys never belong in a frontend environment file. Existing backend bank encryption settings must be retained. Static `*-web.zip` archives contain prebuilt output; `*-vercel.zip` archives contain editable source and build files.

## Verification and remaining acceptance

Automated tests cover database permission boundaries, coupon accounting/rollback, access gating, commission locking, release monotonicity/notification deduplication, API validation, APK structural checks and actual SDK CORS. Browser checks use local fixture identities/data to exercise all admin pages, website desktop/mobile/contact form and driver flow/help/updates. They do not send hosted enquiries or prove real GPS/push/install behavior. Screenshots are labeled fixture renders.

You still need to apply migrations, deploy the API/admin/website, configure the chosen website origin and remote push provider, publish operator-reviewed policies and test on real phones. Real bank transfers, online payment/refund processing, emergency dispatch, guaranteed 24/7 support and certified distance metering are not implemented by these admin controls. No automated test establishes an error-free production service.

Storage/upload design follows [Supabase signed uploads](https://supabase.com/docs/reference/javascript/file-buckets-uploadtosignedurl). Notification taps are handled explicitly as described by [Expo notifications](https://docs.expo.dev/versions/latest/sdk/notifications/).
