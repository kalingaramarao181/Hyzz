# Application previews

**Current release 1.5.0 / Android code 7:** see [operations, public website and APK update guide](OPERATIONS-1.5.md). Apply only missing migrations through 010. Earlier release notes below are historical.


**Current release 1.4.0 / Android code 6:** see [driver screen coverage and upgrade guide](DRIVER-SCREENS.md) for all 12 reference panels, chat, wallet/payout management, migration 008 and the required server encryption-key setting. Earlier 1.3 notes below describe the previous release.


These PNGs are rendered from the **actual source UI in headless Chrome**. Customer/driver images use React Native Web at a 412×915 mobile viewport. They are **not screenshots taken on an Android phone**, and they do not establish real-device behavior or hosted login success.

- Customer welcome: `frontend/customer/screenshots/welcome.png`
- Customer email sign-in form: `frontend/customer/screenshots/login.png`
- Driver welcome: `frontend/driver/screenshots/welcome.png`
- Driver email sign-in form: `frontend/driver/screenshots/login.png`
- Admin desktop: `frontend/admin/screenshots/desktop.png`
- Admin mobile: `frontend/admin/screenshots/mobile.png`

The new `fixture-home.png`, `fixture-live-trip.png` and `fixture-account.png` files in each app's screenshots folder render actual components using **local mocked API responses**. Street map tiles are real; names, booking and location points are explicitly labeled UI fixtures. No hosted email, booking or GPS journey was created. They show layout only and do not prove provider delivery, real authentication or background tracking. Generate them using `node scripts/mobile-flow-check.cjs` after the browser exports below.

Reproduce from the root after installing dependencies (PowerShell):

```powershell
$env:HYZZ_APP_VARIANT='customer'
npx expo export --platform web --clear --output-dir frontend/customer/web-preview --max-workers 2
$env:HYZZ_APP_VARIANT='driver'
npx expo export --platform web --clear --output-dir frontend/driver/web-preview --max-workers 2
node scripts/mobile-screenshots.cjs
npm run admin:build
node scripts/browser-check.cjs
```

Clear the Expo cache when changing audience to avoid a driver web preview reusing customer configuration. Native APK embedded audience metadata is checked independently by `scripts/verify-apks.ps1`.

Current driver gallery: [all 12 reference screens](../frontend/driver/screenshots/storyboard/index.html). Includes extra arrival OTP, chat, bank, documents, support and settings captures. All storyboard captures are real React Native Web components with explicitly labeled local fixture data.

Version 1.5: [public website desktop/mobile](../frontend/website/screenshots/index.html), [all 14 admin pages](../frontend/admin/screenshots/management/index.html), and [driver screens including help/update](../frontend/driver/screenshots/storyboard/index.html). All are actual browser fixture renders, not Android device captures.
