> Version 1.3: read [UPGRADE-1.3.md](UPGRADE-1.3.md) before deployment. Existing 001-005 databases must apply database/Hyzz-upgrade-1.3.sql once. Email OTP remains the default.

**Current release 1.5.0 / Android code 7:** see [operations, public website and APK update guide](UPGRADE-1.5.md). Apply only missing migrations through 010. Earlier release notes below are historical.


**Admin connection fix (24 October 2026):** redeploy the refreshed backend and admin archives. See [connection fix guide](ADMIN-CONNECTION-FIX.md). No new migration or APK rebuild is required.


**Current release 1.4.0 / Android code 6:** see [driver screen coverage and upgrade guide](UPGRADE-1.4.md) for all 12 reference panels, chat, wallet/payout management, migration 008 and the required server encryption-key setting. Earlier 1.3 notes below describe the previous release.


> Current 1.2.0 Vercel/IONOS/domain/migration/demo instructions: ../docs/VERCEL-TESTING.md. Server credentials are required for SMTP OTP generation and persistent limits, in addition to provisioning.

# Hyzz Node.js API — deploy this folder independently

Requires Node.js 22 LTS recommended (20.19.4+ supported). No mobile/admin source is needed on the API server. Supabase remains the hosted Auth/PostgreSQL/private Storage provider; this is a standalone Node HTTP backend, not an Edge Function deployment.

```powershell
cd 'C:\Users\ADMIN\Desktop\Mobile App\Hyzz\backend'
npm ci
Copy-Item .env.example .env
# Edit .env before starting. For local development, use NODE_ENV=development,
# PUBLIC_API_URL=http://localhost:3000 and ALLOWED_ORIGINS=http://localhost:5173.
npm start
```

Health endpoint: `http://localhost:3000/health`. Production: `https://api.srtechcreators.in/health` after you deploy and configure DNS/TLS. The root `/` is not a website; API routes begin `/api/v1`.

Set the server-only `SUPABASE_SERVICE_ROLE_KEY` for admin driver/employee creation. Ordinary sign-in and bookings use the publishable server key plus the verified user's JWT; they never use the service role to bypass RLS. Do not put service keys, SMTP passwords or `.env` files into frontend folders or archives. SMTP email delivery stays configured securely in Supabase Authentication.

Source modules: `src/modules/auth.js`, `actions.js`, `data.js`, `documents.js`, `admin.js`. Middleware authenticates user JWTs, checks active account status, limits requests and handles safe errors. API action contracts are explicit in `src/modules/action-contracts.json`; only listed operations are accepted. Arbitrary tables, SQL execution and the internal account-provision RPC are not exposed. Private uploads are size/type checked and cannot overwrite evidence.

Database setup is in `database/Hyzz-setup.sql` (fresh install only) and `database/migrations/`. If you already applied Hyzz migrations 001–003, this refactor needs **no schema reset or reinstallation**. Preserve your data. First-admin bootstrap is `database/bootstrap-admin.sql`; see the root setup guide. The former Supabase Edge Function is no longer required by these frontends.

Full instructions: `../docs/DEPLOY-NODE.md`, `../docs/EDIT-AND-BUILD.md`, and `../docs/api.md`. `npm test` runs HTTP security/contract tests with an injected provider; `node tests/database.mjs` from this folder runs actual PostgreSQL/PostGIS/pgcrypto business-rule tests using the root development dependencies.

Deployment templates are under `deploy/`. Rate limits use memory and the templates run one Node process. Add a shared rate-limit store before scaling to multiple replicas. These controls and automated checks do not substitute for independent security review, real-device acceptance tests, provider setup or production operations.
