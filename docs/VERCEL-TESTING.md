> Version 1.3 upgrade: follow [LIVE-PLATFORM-1.3.md](LIVE-PLATFORM-1.3.md) first. Existing 001?005 databases need 006 and 007; old pickup-only and admin-created-driver descriptions below describe the previous release.

# Hyzz 1.2 testing deployment

**Admin ZIP deployment:** use `frontend/admin/release/Hyzz-admin-vercel.zip` for Vercel source uploads. Extract it and choose the directory containing its `package.json` and `vercel.json` as Root Directory. Framework Vite; Node 22.x; Install `npm ci`; Build `npm run build`; Output `dist`; environment `VITE_API_BASE_URL=https://api.srtechcreators.in`. The archive contains its own shared client/config and images, so outside-root files are unnecessary for this artifact. The canonical workspace still shares source across frontends. `Hyzz-admin-web.zip` is prebuilt static output, not the Vite source project.

The reported esbuild install-script warning is addressed by a pinned `allowScripts` approval for the locked esbuild version. The unrelated npm `cache-dir` warning shown in build logs does not itself indicate a failed build. A fresh isolated admin install and production build were verified locally (Node 20.20.2/npm 10.8.2; Vercel should select the pinned Node 22.x). Hosted success requires a new deployment; if it still fails, provide the final build-error lines after installation.

This release adds the supplied HTML demo's booking operations to the existing Hyzz design. It is more than an authentication app. The reference is saved at `docs/reference/hyzz-interactive-demo.html`. The HTML is a browser simulation; its local role switch, displayed login code, moving car and fast-forward buttons are not production authentication, GPS or billing logic.

## Deploy in this order

1. **Supabase:** use a separate testing project for demo fixtures. For a fresh database, paste `backend/database/Hyzz-setup.sql` into SQL Editor. If migrations 001–003 already exist, apply only `004_demo_workflow.sql`, then `005_demo_seed.sql`. Do not rerun 001 or reset existing tables. Migration 005 installs a service-only helper; it inserts no fixtures automatically.
2. **API Vercel project:** select `Hyzz/backend` as Root Directory (or upload the standalone backend ZIP's `backend` folder). Use Node **22.x**, Framework Preset **Other**, install `npm ci`, no frontend build command or output directory. `api/index.js` exports Express; `vercel.json` rewrites requests to the function and includes the validation contracts. Do not use `npm start` as a Vercel build command.
3. Set the environment variables below in Vercel for Production and any Preview you intend to test. Redeploy after changing them. The Supabase service-role/secret key must belong to the same project as SUPABASE_URL. The publishable key provided earlier cannot replace this privileged server key.
4. Add **api.srtechcreators.in** to the API Vercel project. Add exactly the DNS records Vercel displays, wait for HTTPS to become valid, and check `https://api.srtechcreators.in/health`. A successful health response is liveness only, not a full provider/SMTP test. Turn off interactive Vercel Deployment Protection for the API deployment used by the APKs; the application routes enforce their own JWT authentication.
5. **Admin Vercel project:** Root Directory `Hyzz/frontend/admin`, enable access to files outside the root directory (the admin imports `frontend/shared` and `assets`). Framework Vite, install `npm ci`, build `npm run build`, output `dist`. Set `VITE_API_BASE_URL=https://api.srtechcreators.in`. Add **hyzz.srtechcreators.in**, complete its DNS and HTTPS, and redeploy.
6. Seed dedicated test identities as below, then sign into each audience with its actual email code. No passwords or OTP bypasses are shipped.

## API environment

Copy the values in `backend/.env.example` to Vercel Environment Variables. Required configuration:

```dotenv
NODE_ENV=production
PUBLIC_API_URL=https://api.srtechcreators.in
ALLOWED_ORIGINS=https://hyzz.srtechcreators.in
TRUST_PROXY=none
SUPABASE_URL=https://ajkdzvcnhnsvgfltfziu.supabase.co
SUPABASE_PUBLISHABLE_KEY=<publishable key for this project>
SUPABASE_SERVICE_ROLE_KEY=<server-only service-role or secret key>
AUTH_EMAIL_DELIVERY=smtp
RATE_LIMIT_STORE=database
SMTP_HOST=smtp.ionos.com
SMTP_PORT=587
SMTP_USER=ramarao.teamweb@bedatatech.com
SMTP_PASS=<set privately in Vercel; never in frontend or Git>
MAIL_FROM_ADDRESS=ramarao.teamweb@bedatatech.com
MAIL_FROM_NAME=Hyzz
MAIL_ENCRYPTION=tls
```

Vercel supplies `VERCEL=1`; do not set it on an ordinary public Node server. The rate limiter uses the platform-overwritten `x-vercel-forwarded-for` header only on Vercel and stores counters in Postgres, so multiple function instances share limits. Supabase failure rejects protected API requests rather than silently disabling limits. An ordinary standalone server uses `req.ip`; set TRUST_PROXY=loopback only behind a same-host nginx proxy.

The Node backend requests a Supabase-generated email OTP and sends it via IONOS using TLS. Supabase still verifies that OTP and issues/refreshes/revokes sessions. Node does not invent a parallel password or token system. There is no OTP in the HTTP send-code response or application logs. For unknown staff/driver addresses, a generic successful send-code response avoids account enumeration; no account is created.

In Supabase Auth, enable email authentication and configure OTP expiry, code length (6–10 digits) and signup policy as required. Set Site URL to `https://hyzz.srtechcreators.in`. Custom SMTP in the Supabase dashboard is needed only when choosing `AUTH_EMAIL_DELIVERY=supabase`; the default `smtp` mode sends mail from Node using the server variables above. Do not configure two competing delivery paths. Set up SPF/DKIM/DMARC for the sender domain with its email provider, and test delivery to your inbox.

## Demo admin, driver, customer and history

Demo records are **fictional fixtures**. They include an admin, approved driver and customer, watermarked test PDF documents in private Storage, demo pricing, a completed/settled cash trip, receipt breakdown, ledger entries, rating and audit event. No actual payment, driving licence or background verification is represented. The driver starts offline and requires real foreground GPS when going online. The demo pricing is ₹50 base, ₹200/hour, ₹18/km, ₹1,600/10h, 5-minute hourly grace, 18% GST and 15% commission before tax. Publishing test pricing affects all new bookings in that project: use a test project.

Choose **three different real inboxes you control**. There is no hardcoded password. Existing non-demo accounts are never converted into privileged demo users. Existing demo identities are reused and the fixed demo trip/ledger are not duplicated.

PowerShell:

```powershell
cd "C:\Users\ADMIN\Desktop\Mobile App\Hyzz\backend"
Copy-Item .env.example .env
# Edit .env: provider service key, SMTP_PASS, and three demo email inboxes.
# Set DEMO_SEED_CONFIRM=TEST_PROJECT_ONLY after checking SUPABASE_URL.
npm ci
npm run seed:demo
```

Set `DEMO_ADMIN_EMAIL`, `DEMO_DRIVER_EMAIL`, and `DEMO_CUSTOMER_EMAIL` in that local backend `.env`. Run the seed script locally, not as a public HTTP endpoint and not as a Vercel install/build command. It requires the private server key. The script uploads visibly fake test PDFs and invokes the service-only fixture function installed by migration 005. The emails are verified when each owner enters a real OTP, not by the seed script. Hosted demo seeding has now succeeded for the three supplied inboxes. Roles, sample fare/ledger, private test PDFs and retry-safe seeding were verified. Real inbox delivery and APK journeys still require the deployed API.

The demo trip appears in customer/driver History and admin Bookings/Finance/Audit. These demo coordinates are near the city used in the HTML; matching a new request needs an online eligible driver within the configured radius of the **actual pickup**. Use the customer's GPS near the driver's real location for a real-device test. Do not spoof GPS or treat the schematic streets as a navigation map.

## Acceptance walkthrough

1. Admin signs in with DEMO_ADMIN_EMAIL. Check seeded users, approved fictional documents and the demo trip/ledger. Only use fictional documents in testing.
2. Driver signs in with DEMO_DRIVER_EMAIL, allows foreground location, goes online, and keeps the app foregrounded.
3. Customer signs in with DEMO_CUSTOMER_EMAIL, selects GPS/landmark/pin/manual coordinates, chooses hourly/distance/full-day, reviews the GST-inclusive estimate and confirms.
4. Driver sees nearby requests and may decline one without cancelling it for other drivers, or accept it. Customer sees assignment and real pickup location updates. Tap Navigate for Google Maps; the in-app map is a schematic like the HTML.
5. Driver marks en route, then arrived. Customer generates a pickup code and shares it when the driver arrives. Driver verifies it, then separately presses Start trip. Tracking stops at verification/start; server timestamps control billing. There is no clock fast-forward control in a real booking.
6. Driver ends the trip (enters actual km for distance service). Both see the snapshot-priced receipt, tax, earnings and commission. Driver confirms cash collection; customer confirms payment or raises a dispute. This records cash, not a bank transfer.
7. Customer rates the trip. Admin views the readable timeline and fare, exports records, and records commission **actually received** with a unique receipt reference and driver UUID. Receipts are immutable, retry-safe and cannot exceed commission on settled cash trips.
8. Admin publishes prices for new bookings, changes account status with a reason, verifies documents, and tests employee roles. Permissions are enforced by SQL and JWT-scoped requests. Existing trip prices are unchanged.

Online gateway payments, SMS, background push, continuous in-trip tracking and automated payouts are outside the supplied cash-first workflow. No external deployment, real SMTP delivery or phone journey is claimed until you complete it with your account configuration.

## Edit and rebuild

Central API origin: `frontend/shared/config.js`. Per-app overrides: `frontend/customer/src/config/api.js`, `frontend/driver/src/config/api.js`, and `frontend/admin/src/config/api.js` plus their `.env.example` files. API paths are in `frontend/shared/api/transport.cjs`; backend routes are in `backend/src/modules`.

After mobile changes, from `Hyzz`:

```powershell
npm ci
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\build-apks.ps1 -Variant both
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\verify-apks.ps1
```

Outputs: `frontend/customer/apk/Hyzz-customer.apk` and `frontend/driver/apk/Hyzz-driver.apk`. Version is 1.2.0, Android versionCode 4. Increment each app's versionCode in its `app.config.js` for future distributed upgrades; preserve package ID and signing key. See EDIT-AND-BUILD.md for EAS and toolchain setup.

References: [Vercel Express](https://vercel.com/docs/frameworks/backend/express), [Vercel request headers](https://vercel.com/docs/headers/request-headers), [Supabase generateLink](https://supabase.com/docs/reference/javascript/auth-admin-generatelink).

## Fix FUNCTION_INVOCATION_FAILED after uploading the backend ZIP

The ZIP includes `.env.example`, not the private `.env`. The real local file is `Hyzz/backend/.env`. Neither ZIP upload nor a local `.env` configures Vercel's Production environment automatically.

1. Open Vercel → backend project → Settings → Environment Variables. Import the local backend `.env` using the dashboard's environment-variable import option, or copy its key/value pairs manually. Keep both secret values private. Select **Production** and also **Preview** if using a preview deployment URL.
2. In particular, set SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_SERVICE_ROLE_KEY, SMTP_PASS, PUBLIC_API_URL=https://api.srtechcreators.in and ALLOWED_ORIGINS=https://hyzz.srtechcreators.in. Use the remaining SMTP/rate-limit settings from the local file/example. Do not change the allowed origin to an HTTP URL in production. Do not place the server key or SMTP password in frontend settings.
3. Root Directory must be the extracted folder containing `package.json`, `vercel.json`, `api/` and `src/`. Framework: Other. Node: 22.x. Install: npm ci. No frontend build command or output directory.
4. Redeploy the backend after saving environment variables. Existing deployments do not gain newly saved variables automatically. Uploading a secret `.env` into the ZIP is not the fix.
5. Open `/health` on the deployed API origin. Expect HTTP 200 and service `hyzz-node-api`. The API root `/` is not a website and normally returns an API 404 when running correctly.
6. If it still fails, open Vercel → Logs → the failed request and inspect `startup_failed`. The updated handler returns HTTP 503 with `SERVER_SETUP_REQUIRED` rather than exposing a stack or secrets. Configuration messages in private runtime logs identify missing field names; missing bundled files/dependencies require checking Root Directory and installation. Supply the error lines with credentials removed if further debugging is needed.

The actual cloud error cannot be diagnosed from the platform's generic FUNCTION_INVOCATION_FAILED code alone. The revised handler passed 27 API/startup tests and returned HTTP 200 locally using the private backend environment. Hosted success still needs verification after redeployment. APK rebuilding is unnecessary for this backend-only update because the API origin is unchanged.
## Build succeeds but the app still does not respond

“Deployment completed” confirms the deployment build finished; check runtime requests separately. The backend package now pins Node 22.x, and vercel.json explicitly sets framework=null (Other) so automatic backend-framework routing does not change the intended API-function rewrite behavior. Redeploy the latest backend ZIP after saving server environment variables.

Test https://YOUR-BACKEND-PROJECT.vercel.app/health first. Expected JSON includes service=hyzz-node-api. If that works but the custom domain fails, add api.srtechcreators.in to the backend project Domains settings and use the exact DNS records Vercel displays. A local DNS check on 22 October 2026 returned ENOTFOUND for api.srtechcreators.in; the actual Vercel project URL is needed to check runtime independently. DNS results can vary by resolver and propagation.

The npm cache-dir warning is emitted by the build environment and did not stop the supplied successful build. FUNCTION_INVOCATION_FAILED must be diagnosed from Runtime Logs, not the successful installation/build log. Do not share environment-variable values or tokens when providing runtime errors.

## Backend 1.2.1: email OTP returns 400 VALIDATION_ERROR

The actual Supabase Auth SDK sends code_challenge=null and code_challenge_method=null for the default email-OTP flow. Backend 1.2.0 rejected these valid null values. A safe invalid-email probe against the deployed API confirmed both null-field validation errors; no email was sent. Patch 1.2.1 accepts omitted/null challenge fields while retaining validation of non-null challenge values and all other inputs. The actual SDK request now passes through the Node validation layer in the regression test.

Redeploy the latest backend/release/Hyzz-backend.zip with the existing server environment settings. Check /health reports version 1.2.1, then retry Send verification code from the admin app. No frontend/APK rebuild or database migration is required. The apikey/Bearer public marker used by the SDK on the public send-code endpoint is expected; do not replace it with a server key.

Validated locally: 27 API/startup checks and two SDK transport/integration checks pass. Hosted patch deployment and actual inbox delivery remain to be verified after redeployment.