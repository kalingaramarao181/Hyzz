# Hyzz Customer

Source, app configuration, screenshots and generated APK are together in this folder. The main customer files are `App.js`, `src/screens/HomeScreen.js`, `src/screens/BookingForm.js`, `src/screens/LoginScreen.js`, `src/config/api.js`, and `app.config.js`. Shared UI/session/transport code is under `../shared`.

Install dependencies once from the full Hyzz root (`npm ci`). Then, from this folder, `npm start` launches customer Expo preview and `npm run build:apk` invokes the shared Android toolchain. Do not install duplicate React Native dependencies into this wrapper folder.

Default API: `https://api.srtechcreators.in`. Copy `.env.example` to `.env` for a customer-specific override, or change the shared default in `../shared/config.js`. Rebuild the APK after changing frontend code/API URL.

Output after success: `apk/Hyzz-customer.apk`. Version and versionCode live in `app.config.js`. Signed APKs here are ARM64 Android 7+ test releases. API deployment, real credentials and phone acceptance testing are required before live operation.

Full guide: `../../docs/EDIT-AND-BUILD.md`. Screenshots under `screenshots/` render the actual React Native screens in a browser; they are not Android-device captures.
