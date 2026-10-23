# Hyzz 1.5 verification

Both Android APKs compiled successfully and passed signature, package identity, embedded audience and required content verification. These are test builds; device journeys and hosted setup remain unverified.

Completed checks:

- 51 backend/API/SDK tests: existing security/CORS/push/bank checks plus customer provisioning, contact consent/validation, APK archive limits/metadata, authenticated upload capabilities and publication checks.
- 63 PostgreSQL/PostGIS workflow and upgrade checks through 010, including contact privacy, permission-gated content, managed customer contacts, administrator assignment notifications to both participants, ride access, coupon accounting/rollback, pre-assignment commission lock and release audience/version/notification deduplication.
- 8 domain/transport tests plus source parsing/mobile binding checks. Expo dependencies are unchanged.
- Admin and independent public website Vite production builds.
- Browser fixture check of all 14 admin pages, initial failed-dashboard recovery, APK upload MIME normalization and explicit draft/publication interactions using fixture storage.
- Website desktop (1440x1000) and mobile (390x844) layout/images/form validity and consented local-fixture contact submission; screenshots saved.
- Driver browser journey: all reference screens plus help/update prompt/contact form and existing trip/chat/finance/support/settings flows.
- Backend dependency audit after updating the ZIP reader: zero reported vulnerabilities.

Fixtures do not send hosted mail, bank transfers or public enquiries. The APK ZIP fixture tests structural checks, not Android signature verification. Browser renders are not Android device captures. Local database tests use Auth/Storage/PostGIS adapters and do not establish hosted concurrency behavior.

Hosted migrations, API/admin/website deployments, public website DNS/origin, reviewed policies, initial release publication, Firebase/Expo credentials, scheduler and physical-phone acceptance are owner actions. Remote push and locked-screen GPS remain unverified. Server publication validates archive/embedded metadata and SHA256; the administrator must separately verify the Android signature/native package before confirming publication. No error-free production guarantee is claimed.


Both native APKs passed apksigner/package/content checks. Their 40 frontend/domain sourcemap entries match the delivered source. The publication inspector also accepted both actual version 1.5.0 / code 7 binaries. The standalone admin source independently installed and built. No Android device is attached (`adb devices -l` rechecked).

<!-- APK_VERIFICATION -->

## Verified local Android artifacts

### Hyzz Customer

- File: `frontend/customer/apk/Hyzz-customer.apk`
- Bytes: 26589917
- SHA-256: `F67CFD05C6F58140E24CA0375CDB17943BFD1C4F5D266FFBC78B8DCEFE97C24E`
- Android package: `com.hyzz.customer`
- Embedded Expo audience: `customer`
- Signature: verified; standard Android debug/test signing key, RSA 2048, APK v2 signature.
- Architecture: ARM64 (arm64-v8a); minimum Android 7.0 / API 24, target API 36.
- Includes nonempty Hermes JS bundle, classes.dex and ARM64 React Native library.
- External-storage and overlay permissions removed; background-location permission is present only in the driver APK.

### Hyzz Driver

- File: `frontend/driver/apk/Hyzz-driver.apk`
- Bytes: 26590017
- SHA-256: `155BC40717AA1A03CC1D5347BA0DCB79274E14960177A70537BFDA32E8D63812`
- Android package: `com.hyzz.driver`
- Embedded Expo audience: `driver`
- Signature: verified; standard Android debug/test signing key, RSA 2048, APK v2 signature.
- Architecture: ARM64 (arm64-v8a); minimum Android 7.0 / API 24, target API 36.
- Includes nonempty Hermes JS bundle, classes.dex and ARM64 React Native library.
- External-storage and overlay permissions removed; background-location permission is present only in the driver APK.

Evidence: `build/apk-verification.json`, `build-customer.log` and `build-driver.log`. `scripts/verify-apks.ps1` reproduces the signature, package, permission and embedded-config checks. Native bundle module counts are recorded in the build logs. Both APKs embed the local Hyzz illustration and audience-specific brand mark. No EAS cloud build or APK cloud download URL is claimed.
