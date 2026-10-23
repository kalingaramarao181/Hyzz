# Edit Hyzz and rebuild APKs

**Current release 1.5.0 / Android code 7:** see [operations, public website and APK update guide](OPERATIONS-1.5.md). Apply only missing migrations through 010. Earlier release notes below are historical.


**Current release 1.4.0 / Android code 6:** see [driver screen coverage and upgrade guide](DRIVER-SCREENS.md) for all 12 reference panels, chat, wallet/payout management, migration 008 and the required server encryption-key setting. Earlier 1.3 notes below describe the previous release.


The working project is `C:\Users\ADMIN\Desktop\Mobile App\Hyzz`. Open this folder in VS Code. The former `BasicAndroidLogin` path is obsolete.

For the earlier Vercel/IONOS/demo setup, read [VERCEL-TESTING.md](VERCEL-TESTING.md) first. The API is `https://api.srtechcreators.in`; admin is `https://hyzz.srtechcreators.in`. Current Android versionCode is **7**, version **1.5.0**. API secrets and SMTP_PASS belong only in the ignored `backend/.env` or server environment; source/APK archives exclude them.

Read [LIVE-PLATFORM-1.3.md](LIVE-PLATFORM-1.3.md) for the required 006/007 database upgrade, driver background tracking permissions, Firebase notifications, optional Google/phone providers and physical-phone acceptance test.

## Folder map

```text
Hyzz/
  backend/                       Standalone Node server; deploy this folder
    src/modules/                 Auth, actions, data, admin, documents
    database/migrations/         PostgreSQL migrations
    database/Hyzz-setup.sql       Fresh-install copy/paste SQL
    deploy/                      nginx, systemd, Docker templates
    .env.example                 Server configuration, no real secrets
  frontend/
    customer/
      App.js                     Customer entry point
      app.config.js              Customer name, ID, version, icon
      src/screens/               HomeScreen, BookingForm, LoginScreen
      src/config/api.js          Customer API URL override
      apk/Hyzz-customer.apk       Built customer APK
      screenshots/               Customer screen previews
    driver/
      App.js                     Driver entry point
      app.config.js              Driver name, ID, version, icon
      src/screens/               RequestsScreen, LoginScreen
      src/config/api.js          Driver API URL override
      apk/Hyzz-driver.apk         Built driver APK
      screenshots/               Driver screen previews
    admin/
      src/                       Admin screens/components and config/api.js
      dist/                      Deploy this generated static website
      release/                   Zipped web deployment artifact
    shared/
      config.js                  ONE default API origin for all frontends
      api/                       Central request transport and client factory
      mobile/                    Shared buttons, theme, authentication, trip/account screens
  assets/                        Editable logo files and illustration
  android/                       Shared native Android build workspace
  scripts/                       Build, check and screenshot tools
```

Source is separated by feature and application. Mobile libraries and the native build toolchain are intentionally shared to keep both apps compatible; they are installed once at the Hyzz root. Do not copy customer/driver folders out by themselves and expect their shared imports to resolve. Use the full source archive for development. The backend archive is independently deployable. Admin `dist/` is independently deployable after compilation.

## Exactly where to change an API URL

Default for every frontend: **`frontend/shared/config.js`**:

```js
export const DEFAULT_API_BASE_URL = 'https://api.srtechcreators.in';
```

Use only the origin, **without `/api/v1`**, a trailing API path, a token or credentials. The transport adds versioned routes. Existing APKs do not read your development files remotely; rebuild and reinstall after changing this value. Keeping the same domain and pointing DNS to a new server avoids an API host change in clients.

Optional overrides:

| Application | Source setting | Environment override |
| --- | --- | --- |
| Customer | `frontend/customer/src/config/api.js` | `EXPO_PUBLIC_CUSTOMER_API_URL` |
| Driver | `frontend/driver/src/config/api.js` | `EXPO_PUBLIC_DRIVER_API_URL` |
| Admin | `frontend/admin/src/config/api.js` | `VITE_API_BASE_URL` |

For customer/driver, copy that app's `.env.example` to `.env`. The supplied start/build helpers load that file. For admin, Vite loads `frontend/admin/.env` automatically. Environment overrides win over the shared default. Values with `EXPO_PUBLIC_` or `VITE_` become public bundle contents: **never put passwords or service keys there**.

To change endpoint path conventions, edit `frontend/shared/api/transport.cjs` and the matching route mounts in `backend/src/app.js` / `backend/src/modules`. Prefer keeping `/api/v1` backwards-compatible and adding `/api/v2` for breaking changes so old installed apps keep working. SQL action names and schemas are listed in `backend/src/modules/action-contracts.json`; update the implementation, contract and tests together.

After adding/changing a public SQL function, review its authorization first, then regenerate contracts with `node scripts/generate-node-contracts.cjs` and OpenAPI with `node scripts/generate-node-openapi.cjs`. The generator excludes the internal account provisioning function; extend that exclusion list for any new server-only helper. Never expose an arbitrary SQL executor as an application action.

## Where to edit features

| Change | File/folder |
| --- | --- |
| Customer welcome/current booking display | `frontend/customer/src/screens/HomeScreen.js` |
| Pickup, duration, fare estimate and booking form | `frontend/customer/src/screens/BookingForm.js` |
| Driver availability, requests and acceptance | `frontend/driver/src/screens/RequestsScreen.js` |
| App-specific login wrapper | That app's `src/screens/LoginScreen.js` |
| Common OTP form | `frontend/shared/mobile/screens/Authentication.js` |
| Pickup OTP, trip and receipt UI | `frontend/shared/mobile/screens/TripScreen.js` |
| Profile, support and logout UI | `frontend/shared/mobile/screens/AccountScreen.js` |
| Colors, spacing, shared mobile styles | `frontend/shared/mobile/theme.js` |
| Shared buttons and form controls | `frontend/shared/mobile/components.js` |
| Mobile session storage and API setup | `frontend/shared/mobile/services/api.js` |
| Admin pages and permission controls | `frontend/admin/src/main.jsx`, `Operations.jsx` |
| Backend route validation/authorization | `backend/src/modules/`, `backend/src/middleware/` |
| Transactional pricing/booking rules | New migration in `backend/database/migrations/` |
| Logos and illustration | `assets/` and `frontend/shared/mobile/BrandLogo.js` |

Shared screen edits affect both mobile apps, so rebuild both. Business behavior is validated again on the server/database; a frontend-only price/role change does not grant authority.

## Install and preview — PowerShell

```powershell
cd 'C:\Users\ADMIN\Desktop\Mobile App\Hyzz'
npm ci
npm --prefix backend ci
npm --prefix frontend/admin ci

# Customer preview:
cd frontend/customer
npm start
# Stop Metro with Ctrl+C before changing audience.

# Driver preview, from the root:
cd 'C:\Users\ADMIN\Desktop\Mobile App\Hyzz\frontend\driver'
npm start

# Admin, in another terminal:
cd 'C:\Users\ADMIN\Desktop\Mobile App\Hyzz'
npm run admin:dev
```

Use an Expo SDK 54-compatible Expo Go or standalone APK. Customer/driver launchers select the correct audience and clear Metro's cache. For an emulator, use `npm run android` inside the selected app folder. Expo Go development can use `http://10.0.2.2:3000` for your PC's API; release APKs should use the deployed HTTPS API rather than enabling cleartext traffic. A physical phone's `localhost` is the phone itself; use your deployed HTTPS API or a deliberate development tunnel instead of assuming it reaches your PC.

## Repack after a mobile change

1. Edit the appropriate source file. Save it and verify in preview.
2. Edit **that app's `app.config.js`**. Increase `versionCode` for every distributed update (currently 7); update `version` as needed (currently 1.5.0). Never reduce versionCode. Keep the Android package ID unchanged to update the existing app.
3. Stop Expo/Metro to avoid Windows file locking during native compilation.
4. Run the checks and build commands below from the Hyzz root.

```powershell
npm test
npm run backend:test
npm run test:database
npm run check:source

# Customer only:
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-apks.ps1 -Variant customer
# Driver only:
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-apks.ps1 -Variant driver
# Or both:
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-apks.ps1 -Variant both

# Verify both delivered files after a two-app release:
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify-apks.ps1
```

Outputs are copied beside their app source: `frontend/customer/apk/Hyzz-customer.apk` and `frontend/driver/apk/Hyzz-driver.apk`. Compatibility copies also remain in root `build/`. Logs are `build-customer.log` and `build-driver.log`; inspect **BUILD SUCCESSFUL**, not the older `local-apk-build.log` from the retired login demo. The build script reads each app's version and `.env` and passes version settings to Gradle.

Install the APK on ARM64 Android 7+. Current files use the same local test key as earlier releases, so matching package IDs/versionCode allow an update. Preserve your signing key. A new/different key cannot update an existing installation; test builds may require uninstalling first if the key was regenerated. For public release use a private production signing key and managed upload signing. The source archive omits keys; the local helper can generate a new test key when absent.

The installed local toolchain is Java 17, Android SDK 36, Build Tools 36.0.0, NDK 27.1.12297006, CMake 3.22.1 and Gradle 8.14.3. `scripts/build-apks.ps1` uses the portable workspace Java 17 if present, otherwise your `JAVA_HOME`. It auto-detects `%LOCALAPPDATA%\Android\Sdk` or uses `ANDROID_HOME`. Change environment variables for another PC instead of editing an absolute path into application code. `android/local.properties` is local-only.

## What needs rebuilding?

| What changed | Required action |
| --- | --- |
| Node API implementation, compatible response shape | Deploy backend and restart it; no APK rebuild |
| Backend credentials / CORS origin | Edit server `.env`, restart Node; no APK rebuild |
| Database rules | Apply a new reviewed migration; preserve existing data |
| Customer/driver JS, images, app name or API host | Rebuild and install affected APKs |
| Shared mobile code | Rebuild both APKs |
| Admin code/API URL | `npm run admin:build`, deploy `frontend/admin/dist/` |

No automatic over-the-air code update service is configured. Editing local JS does not alter an APK already installed on someone's phone.

## EAS alternative

From the root, set `HYZZ_APP_VARIANT` to customer/driver and the actual corresponding EAS project UUID, then use `npx eas-cli@latest login`, `npx eas-cli@latest project:init` if unassociated, and `npx eas-cli@latest build --platform android --profile preview` or `--profile preview-driver`. Both preview profiles create APKs. Download only from a completed successful build's artifact page. No EAS account, project UUID or cloud artifact is invented here.

For the screenshot evidence and its limitations, read `docs/SCREENSHOTS.md`.
