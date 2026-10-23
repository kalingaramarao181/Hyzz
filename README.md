# Hyzz — separate backend, customer, driver and admin

**Current release 1.5.0 / Android code 7:** see [operations, public website and APK update guide](docs/OPERATIONS-1.5.md). Apply only missing migrations through 010. Earlier release notes below are historical.


**Admin connection fix (24 October 2026):** redeploy the refreshed backend and admin archives. See [connection fix guide](docs/ADMIN-CONNECTION-FIX.md). No new migration or APK rebuild is required.


**Current release 1.4.0 / Android code 6:** see [driver screen coverage and upgrade guide](docs/DRIVER-SCREENS.md) for all 12 reference panels, chat, wallet/payout management, migration 008 and the required server encryption-key setting. Earlier 1.3 notes below describe the previous release.


The default API is **https://api.srtechcreators.in**. Deploy the Node server yourself; local builds do not mean that domain is live.

**Version 1.3.0:** read [LIVE-PLATFORM-1.3.md](docs/LIVE-PLATFORM-1.3.md) first. This upgrade adds real street maps, assigned-trip background tracking, driver self-signup/document uploads, optional customer cars, admin service zones and a notification delivery pipeline. Existing databases with 001-005 must apply 006 and 007 before using these apps. Firebase credentials and physical-phone acceptance tests remain necessary.

**Previous release:** start with [VERCEL-TESTING.md](docs/VERCEL-TESTING.md). It covers `api.srtechcreators.in`, admin `hyzz.srtechcreators.in`, IONOS email OTP, the five migrations, dedicated demo accounts and the complete customer → driver → cash → admin commission walkthrough. Existing databases with 001–003 need only 004 and 005. The existing visual design and uncropped welcome illustration are retained.

```text
backend/                   Independent Node API, SQL, server environment, deploy templates
frontend/customer/         Customer source, app settings, screenshots, apk/Hyzz-customer.apk
frontend/driver/           Driver source, app settings, screenshots, apk/Hyzz-driver.apk
frontend/admin/            Admin source, dist/ and release/
frontend/shared/           Shared UI, secure sessions, API transport and default URL
assets/                    Logos and illustration
android/                   Shared native build toolchain
docs/                      Deployment, editing and APK repack instructions
```

Read **[EDIT-AND-BUILD.md](docs/EDIT-AND-BUILD.md)** for exact feature files, API path settings and PowerShell repacking commands. Read **[DEPLOY-NODE.md](docs/DEPLOY-NODE.md)** to deploy only `backend/`. [Supabase setup](docs/setup-supabase.md) covers SMTP/database/admin bootstrap; existing migrations 001–003 do not need a reset for this refactor.

All frontend Auth/data/upload/booking calls go through Node. Supabase remains the identity/database/private Storage provider. The maintained Auth SDK manages sessions, but frontend bundles contain no Supabase project key or URL. Node uses caller JWTs/RLS for ordinary operations. Server-only service credentials handle OTP generation, persistent rate limits, authorized account provisioning and the guarded demo-seed command. Expiring authorized document downloads can still point to Storage. The old Edge Function is no longer needed.

## Change API URL

Edit **`frontend/shared/config.js`** for the default used by all frontends. Each app also has `src/config/api.js` and `.env.example` for an independent override. Use only the API origin, without `/api/v1`. Rebuild affected APKs/admin output after frontend URL changes. Provider credentials and SMTP passwords belong only in backend/provider settings, never `EXPO_PUBLIC_` or `VITE_` values.

## PowerShell

```powershell
cd 'C:\Users\ADMIN\Desktop\Mobile App\Hyzz'
npm ci
npm --prefix backend ci
npm --prefix frontend/admin ci
# Configure backend/.env from its example before starting the API:
npm run backend:dev
# Other terminals:
npm run admin:dev
cd frontend/customer
npm start
# Stop Metro before switching to frontend/driver and running npm start there.
```

## Repack APKs

Edit the appropriate app's `app.config.js` and increase `versionCode` for distributed updates. Stop Metro and run from the root:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-apks.ps1 -Variant both
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify-apks.ps1
```

Use `-Variant customer` or `-Variant driver` for one application. Outputs are copied into each app's `apk/` folder and root `build/`. The full source tree is needed for development because reusable UI and native dependencies are shared. Backend and compiled admin deploy independently. APKs are ARM64 Android 7+ internal test-key builds; preserve the signing key when updating an installed app.

Deployment archives after packaging:

- `backend/release/Hyzz-backend.zip`
- `frontend/admin/release/Hyzz-admin-web.zip`
- `build/Hyzz-source.zip` — full development source, excluding secrets and generated APKs

## Checks and screenshots

```powershell
npm test
npm run backend:test
npm --prefix backend run test:client
npm run test:database
npm run check:source
node scripts/check-mobile-bindings.cjs
npm run admin:build
```

[Screenshot guide](docs/SCREENSHOTS.md) identifies actual customer/driver React Native browser renders and admin screenshots. They are not Android-device captures and do not fabricate authenticated trips. See [verification](docs/verification.md) for actual results and remaining hosted/device checks.

This remains the [documented cash-first pilot](docs/feature-status.md). SMS and Google require provider setup; remote push requires Firebase and a worker. Online payments and automated payouts remain unavailable. Passing local checks does not guarantee a production deployment is perfect.
