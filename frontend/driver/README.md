# Hyzz Driver

This folder owns `App.js`, `app.config.js`, `src/screens/RequestsScreen.js`, `src/screens/LoginScreen.js`, `src/config/api.js`, `screenshots/` and the generated `apk/Hyzz-driver.apk`. Reusable trip/account/auth UI is under `../shared/mobile`.

Install dependencies once at the full Hyzz root with `npm ci`. From this folder use `npm start` for driver preview or `npm run build:apk` to build the driver APK through the shared native workspace. Its package is `com.hyzz.driver`; only administrator-created, approved driver accounts can accept bookings.

The API default is `https://api.srtechcreators.in`. Override it through this app's `.env` or `src/config/api.js`, then rebuild. Version/versionCode are in `app.config.js`. This is an ARM64 Android 7+ test-key release; deployment and phone verification remain necessary.

Read `../../docs/EDIT-AND-BUILD.md` for exact edit/repack steps. Browser screenshots are labeled as previews rather than Android-device captures.
