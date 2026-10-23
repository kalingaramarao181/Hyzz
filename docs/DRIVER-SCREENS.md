# Driver storyboard delivery — 1.4.0

**Current release 1.5.0 / Android code 7:** see [operations, public website and APK update guide](OPERATIONS-1.5.md). Apply only missing migrations through 010. Earlier release notes below are historical.


All 12 driver panels supplied in the reference are implemented. The image skips number 6; arrival and pickup OTP are included as additional steps. Layout, green/white styling, map cards and four main tabs follow the reference. Actual names, balances, reviews and map tiles come from data; sample portraits, balances and demand are not invented for live accounts.

| Reference | Working screen | Source under frontend/driver/src |
| --- | --- | --- |
| 1 | Map, service zones, online switch, real earnings and trip totals | screens/DriverHomeScreen.js |
| 2 | Searching animation, nearby request polling, go offline | screens/DriverHomeScreen.js |
| 3 | Expiring request, customer first name, pickup/drop, accept/reject | screens/IncomingRequestScreen.js |
| 4 | Assigned/en-route map, external navigation, call, participant chat, arrival/OTP | screens/DriverTripScreen.js |
| 5 | Active trip map, navigation, call/chat, safety report, end trip | screens/DriverTripScreen.js |
| 7 | Fare breakdown, cash confirmation, customer rating, Done | screens/DriverTripScreen.js |
| 8 | Today/week/month totals, incentive credits, chart and recent trips | screens/DriverFinanceScreens.js |
| 9 | All/completed/cancelled booking filters and trip details | screens/DriverFinanceScreens.js |
| 10 | Platform credit wallet, payout request/history, transactions, bank details | screens/DriverFinanceScreens.js |
| 11 | Real profile, editable details, four private documents and review statuses | screens/DriverAccountScreens.js |
| 12 | FAQ, support tickets/issues/feedback, emergency contact, safety and policies | screens/DriverAccountScreens.js |
| 13 | Account menu, notification preference, language, privacy/terms, logout | screens/DriverAccountScreens.js |

`DriverShell.js` handles navigation and refresh; `ui.js` contains shared driver styling. Shared maps and background tracking live in `frontend/shared/mobile`. Chat is `frontend/shared/mobile/TripChat.js`, also connected in the customer app. Backend routes stay in `backend/`; database behavior is migration 008. Admin finance includes `DriverPayoutReview.jsx`.

## Required deployment steps

1. Apply only SQL migrations not already applied, in numeric order. If 001–007 are installed, run `backend/database/migrations/008_driver_storyboard.sql`. If only 001–005 are installed, run `backend/database/Hyzz-upgrade-1.4.sql` once (006, 007 and 008). If 006 is installed, apply 007 and 008 individually. `Hyzz-setup.sql` is for an empty project only. Do not re-run existing migrations or reset real data.
2. Deploy the new `backend/release/Hyzz-backend.zip` to the API Vercel project. Keep all existing production environment settings. Add `BANK_DETAILS_ENCRYPTION_KEY` by copying the existing value from the ignored local `backend/.env` into Vercel Production. Preserve and back up this key: changing it makes existing encrypted bank records unreadable. Never put it into frontend variables, screenshots or source control. A fresh installation can generate a new 32-byte base64 key with `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"` and store it server-side only.
3. Deploy `frontend/admin/release/Hyzz-admin-vercel.zip` to the admin Vercel project. API: `https://api.srtechcreators.in`; admin: `https://hyzz.srtechcreators.in`. Configure production origins accordingly.
4. Install `frontend/driver/apk/Hyzz-driver.apk`. Customer APK also includes participant chat. These are ARM64 internal test builds, version 1.4.0 / Android code 6, using the existing test signing key.
5. Register a driver, upload all four required documents, and have an authorized administrator review/approve them. Document expiry/approval gates online status and acceptance. Customer car documents remain optional.

## Financial behavior

Cash collected on a trip is already held by the driver; it is not available to withdraw a second time. Wallet withdrawals use platform credit owed to the driver (incentives or audited adjustments). Admin finance can record a credit with an immutable unique reference. Payout requests reserve that credit and require bank details and settled commission. Authorized finance staff approve/reject requests, access audited bank snapshots, make the payment outside Hyzz, and record a real transfer reference when marking paid. This application does not initiate bank transfers. Account format checks do not verify bank ownership.

Full bank accounts are encrypted by the Node API with AES-256-GCM before storage; normal reads return only masked details. Keep HTTPS and the server encryption key protected. Participant chat is authenticated, persisted, idempotent, and limited to assigned trip participants; new messages stop when the trip closes. Customer contact/chat is exposed after assignment rather than to every candidate driver.

## Providers and operational limits

- Assigned-trip Android background tracking is implemented with explicit permission and foreground notification. Idle request searching runs while the app is open. Test on two physical phones, including lock/minimize, permission denial, connectivity loss and battery restrictions. Force-stop or reboot can interrupt location updates.
- In-app notices and notification preferences work. Remote Android push still requires Firebase/FCM V1 credentials, each Expo app's project/client configuration and the server scheduler. FCM was not supplied. Email OTP remains the configured login method; Google and SMS require provider setup.
- Maps use attributed OpenStreetMap tiles, configured service zones and optional road routing. External Google Maps handles navigation. No live traffic feed, fake demand or built-in voice guidance is claimed.
- English/Telugu/Hindi preference currently changes main navigation labels; detailed panel text remains English.
- Support tickets and safety reports persist for administrators; emergency contact dialing uses the phone dialer. This is not an emergency dispatch service or a staffed 24/7 support guarantee.

## Preview, edit and rebuild

Open `frontend/driver/screenshots/storyboard/index.html` for all 12 screens and additional steps. Captures render real components at 412×915 with clearly labeled local fixture data; they are not phone captures or evidence of live provider delivery.

PowerShell from the `Hyzz` folder:

```powershell
npm install
npm --prefix frontend/driver start
# Native APK rebuild after editing:
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-apks.ps1 -Variant driver
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify-apks.ps1
# Or rebuild both after shared changes:
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-apks.ps1 -Variant both
# Cloud alternative (Expo account and interactive project setup required):
npx eas-cli@latest login
npx eas-cli@latest build --platform android --profile preview-driver
```

Local compilation requires Java 17 and the Android SDK/NDK described in `EDIT-AND-BUILD.md`. APK output: `frontend/driver/apk/Hyzz-driver.apk`. JavaScript/UI changes require a new APK with this delivery setup; backend-only changes require redeploying the backend. For installation upgrades, retain the package ID/signing key and increase version/versionCode in the audience app config.

Change the default API path in `frontend/shared/config.js`; audience overrides are in `frontend/driver/src/config/api.js` and its public environment setting. Rebuild the APK after changing its API URL. See `EDIT-AND-BUILD.md` for the complete folder map.

Reproduce browser fixture verification after exporting the driver with `HYZZ_APP_VARIANT=driver`: run `node scripts/driver-storyboard-check.cjs`, then `node scripts/driver-gallery.cjs`. Database checks run locally with PGlite adapters, not against hosted production data. See `verification.md` for completed checks and remaining acceptance work.
