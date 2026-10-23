# Development, deployment and recovery

## PowerShell local commands

```powershell
cd 'C:\Users\ADMIN\Desktop\Mobile App\Hyzz'
npm install
npm --prefix apps/admin-web install
npm test
npm run test:database
npm run check:source
npm run check
npm run admin:build

# Terminal 1: customer preview
$env:HYZZ_APP_VARIANT='customer'
npx expo start --go

# Or driver preview (stop the prior Metro server first):
$env:HYZZ_APP_VARIANT='driver'
npx expo start --go --clear

# Terminal 2: local admin
npm run admin:dev
```

Admin URL: `http://localhost:5173`. The admin website is not an Android app. Expo SDK 54 needs a compatible Expo Go version; if the store version has moved on, use the verified standalone APK instead, or install an SDK-compatible Expo Go from Expo's official Android download page. The phone and computer should be on the same LAN for Metro preview. In Metro, press `a` to use a configured Android emulator. No working emulator has been verified in this environment. Android ARM64 APKs do not run on an x86-only emulator.

Use Node 22.13+ for current EAS/Expo Doctor tooling; this workspace's Node 20.20.2 supports the pinned app packages but can warn in newer tooling. The existing local Java 17, SDK 36, Build Tools 36.0.0, NDK 27.1.12297006 and CMake 3.22.1 support the native build.

## Build the two local APKs

Stop Metro preview servers before a native build on Windows. From Hyzz:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-apks.ps1 -Variant both
```

Output: `build/Hyzz-customer.apk` and `build/Hyzz-driver.apk`. Copy each to an ARM64 Android 7+ phone, open the file and allow your file manager to install apps if prompted. Both apps can coexist because their package IDs are `com.hyzz.customer` and `com.hyzz.driver`. Internet access is required for authentication and operations. These are local **test-key signed** releases. Production needs a private release/upload key and managed signing; never publish the standard debug key as a production identity.

The native project is kept for reproducible Windows builds. It includes customer/driver Gradle product flavors and a CMake staging directory outside node_modules to avoid Windows locking issues. The SDK's unrelated, pre-existing Android 37 emulator package metadata warning does not itself invalidate an APK build. See build logs for actual success/failure.

The source archive omits signing keys, build caches and SDK paths. The build script generates a new standard test keystore if it is absent. A newly generated key cannot update an installation signed with a different key; uninstall that test installation first if Android reports a signature mismatch. Production keys must be managed separately. Native source moved to the Hyzz package namespace; Android's activity class is `com.hyzz.mobile.MainActivity` in both app packages.

## EAS cloud APK alternative

```powershell
npm install
npx expo start
npx eas-cli@latest login
npx eas-cli@latest build
npx eas-cli@latest build --platform android --profile preview
npx eas-cli@latest build --platform android --profile preview-driver
```

The bare `build` command is interactive; select Android and the appropriate preview profile. Both preview profiles explicitly set `android.buildType: apk`. The production profile intentionally creates a Play Store AAB. EAS requires an Expo account and a project association. Since these are separate applications, associate each audience with its own project:

```powershell
$env:HYZZ_APP_VARIANT='customer'
npx eas-cli@latest project:init
# If the dynamic config cannot be written automatically, copy the returned UUID:
$env:HYZZ_CUSTOMER_EAS_PROJECT_ID='YOUR_ACTUAL_CUSTOMER_PROJECT_UUID'
npx eas-cli@latest build --platform android --profile preview

$env:HYZZ_APP_VARIANT='driver'
npx eas-cli@latest project:init
$env:HYZZ_DRIVER_EAS_PROJECT_ID='YOUR_ACTUAL_DRIVER_PROJECT_UUID'
npx eas-cli@latest build --platform android --profile preview-driver
```

Persist the actual project UUIDs in your EAS environment configuration or local shell environment. No project IDs are invented here. `.easignore` excludes native `android/`, so EAS runs Expo prebuild independently for the selected audience and permissions. Preview builds need Android signing credentials; EAS can generate test/internal credentials interactively. Download a completed cloud artifact from the successful build's Expo dashboard page or the CLI artifact URL. No cloud build or cloud artifact URL is claimed in this delivery.

## Admin hosting

Serve `apps/admin-web/dist` on HTTPS. The included Docker build, from the Hyzz root:

```powershell
docker build -f infrastructure/admin.Dockerfile -t hyzz-admin .
docker run --rm -p 8080:80 hyzz-admin
```

Local URL: `http://localhost:8080`. Use a TLS reverse proxy or static hosting service for production, set `ADMIN_ALLOWED_ORIGIN` to the exact deployed HTTPS origin, and redeploy the Edge Function. No SMTP or service key is needed in the frontend image. CSP and response headers are included in the nginx config. Google fonts have local system-font fallback. Use separate Supabase projects/configuration for development and production; change `packages/config.js` and rebuild all clients when changing projects. Restrict production admin access and add appropriate MFA and monitoring before live financial functions.

## Backend operations

Supabase hosts Auth, PostgREST, PostgreSQL, Storage, Realtime and the admin Edge Function. No separate local API server is required. For a complete local Supabase stack, install Docker Desktop and Supabase CLI, run `npx supabase@latest start`, apply the migrations and use the local URL/public key in a separate configuration. Neither Docker nor the hosted management credentials were available for a full-stack deployment in this session.

Back up both PostgreSQL and private Storage objects. Confirm your Supabase plan's backup/PITR support; do not assume database backups include document file contents. Use Supabase CLI `db dump` for schema/data backups with project-owner credentials, encrypted storage and a tested restore procedure. Retain an inventory of private document paths. A restore drill must run on a separate staging project, including Auth identities, permissions, Storage ACLs and application state. No backup/restore drill was run here.

Roll forward with new transactional migrations rather than deleting or rewriting financial history. For a bad web release, redeploy the previous immutable static artifact. For a bad mobile release, distribute a higher versionCode rebuild with the prior source. Restore the database only through the documented incident procedure and reconciliation process. Do not blindly drop a populated schema to roll back an app.

Define real retention periods with legal/operational advice before public launch. Deletion requests require staff review and documented financial-record retention; no automatic destructive job is enabled. License expiry is enforced on availability/acceptance even without a cron job. Matching expiration is evaluated on reads/acceptance and persisted by `expire_requests` during authenticated app refresh. Add monitored scheduled cleanup and notification workers for production; no worker is secretly assumed to exist.

Payment gateway, push credentials, maps/geocoding and SMS provider integration are outstanding and must be tested in staging. iOS bundle identifiers are configured, but a macOS/Xcode or EAS iOS build, Apple account, signing and device verification are required. Android build success does not establish iOS readiness.
