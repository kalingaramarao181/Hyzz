# Hyzz 1.3: live trips, verification and provider setup

Apply this upgrade before installing the new APKs against the hosted API. Backend, admin, driver and customer remain separate folders. The existing green Hyzz branding and uncropped welcome artwork are retained; maps now use real street tiles.

1. Back up the Supabase database. Because migrations 001–005 are already installed, run `backend/database/Hyzz-upgrade-1.3.sql` **once** in the Supabase SQL editor. It contains 006 and 007. Do not run the fresh-install `Hyzz-setup.sql` on that database.
2. Deploy the new backend to `https://api.srtechcreators.in` using `backend/release/Hyzz-backend.zip`. Copy server environment variables into Vercel Production settings; `.env` and service credentials are intentionally excluded from the ZIP. Redeploy after setting variables. `/health` should report 1.3.0.
3. Deploy `frontend/admin/release/Hyzz-admin-vercel.zip` to `https://hyzz.srtechcreators.in` as Vite (`npm run build`, output `dist`). This is the standalone admin source archive, including its shared API client.
4. Install the customer and driver APKs from each app's `apk` folder. They are internal test builds signed with the existing local test key, ARM64, Android 7 or later. Production distribution requires your own managed signing credentials.

Driver signup and review:

- Both mobile apps accept email signup/sign-in. A new driver first verifies email, then completes driver registration and uploads driving license, identity, insurance and police verification. Files are private PDF/JPEG/PNG, at most 4 MiB each. A profile photo is optional.
- Admin reviews each file with a reason, then approves the driver. Expired or missing required documents block going online and accepting jobs. Driver service categories (professional/premium/lady) are assigned by admin after eligibility review.
- **Existing demo driver:** migration 006 intentionally puts drivers missing the newly required documents back into pending review. The old fixture has only identity and license. Upload and review the two additional documents before approving it again. Existing demo accounts/history are preserved; do not describe fictional fixture documents as genuine verification.
- Customer car details and RC/insurance/PUC/photo uploads are optional. Booking never requires car document approval. Customer uploads have separate private storage and admin review.

Booking and live tracking:

- Customer chooses pickup with GPS or a map pin, enters a recognizable address, optionally selects a destination and saved car, chooses driver category, service duration/distance, Now or a future local date/time, reviews the server estimate and books.
- Approved driver goes online, accepts a nearby request, navigates to pickup, marks arrival, verifies the customer's code, then starts the trip. Completion calculates the server fare. Both parties confirm cash; ratings, history, support and commission records persist.
- Driver: Account → Live trip sharing → Enable live tracking. Read the consent and allow foreground location, then **Allow all the time** when Android opens settings. GPS publishes about every 5 seconds/5 metres during assigned, en-route, arrived, verified and in-progress states. A persistent Android notification indicates background sharing. No customer background permission is requested.
- Customer and authorized admin poll the latest shared point every 5 seconds. Delayed points are marked stale after 45 seconds. Network/GPS/battery restrictions can delay updates; the marker is a last-known point, not guaranteed instantaneous tracking.
- Completion, cancellation and reassignment remove the old point. Logout stops the local task. Force-stop, reboot and manufacturer battery restrictions can interrupt delivery; reopen the driver app and check permissions. Tracking is not a safety guarantee.
- Only the assigned driver can publish; only trip participants and authorized operations can read it. The database keeps the latest trip point, not a permanent breadcrumb trail.
- Admin → Settings can configure named circular service zones, matching radius and maintenance mode. Enabled zones with coordinates restrict new pickups. Maintenance pauses new booking/availability; it does not terminate an existing trip.

Maps and navigation:

- Embedded maps use bundled Leaflet and OpenStreetMap street tiles with attribution. Internet is required. Map pins select coordinates; automatic address search/reverse geocoding is not included. Enter the address text yourself.
- Backend `ROUTING_URL` defaults to the public OSRM demonstration service. Road geometry, distance and non-traffic travel duration are displayed only when that service returns a route. External Google Maps navigation is also available. No fabricated road route/traffic ETA is displayed on failure.
- For a public fleet, configure a supported routing/tile provider or host your own service and review its usage limits. OSM community tiles and the OSRM demonstration endpoint have no commercial availability guarantee. No bulk tile download/offline prefetch is implemented.

Remote notifications — still requires your Firebase/Expo configuration:

1. Create Firebase Android apps for `com.hyzz.customer` and `com.hyzz.driver`. Download the matching `google-services.json` files into `android/app/src/customer/` and `android/app/src/driver/` respectively. These are Firebase client configs; **never** put the private FCM service-account key inside either application or the source archive.
2. Link an EAS project for each audience. Put its UUID into `HYZZ_CUSTOMER_EAS_PROJECT_ID` / `HYZZ_DRIVER_EAS_PROJECT_ID` in the build environment, or set `easProjectId` in each audience's `app.config.js`. With dynamic Expo config, copy the actual ID from `eas init` output; do not invent one.
3. Run `npx eas-cli@latest credentials` for each audience's project and upload its FCM V1 service-account credential through EAS. Rebuild APKs after adding the Firebase client files or project IDs. This repository applies the Google Services Gradle plugin only when the selected audience's config exists.
4. Backend: set `PUSH_ENABLED=true`, a random `CRON_SECRET` of at least 32 characters, and optional `EXPO_ACCESS_TOKEN` if Expo enhanced push security is enabled. Configure a server scheduler to call `GET https://api.srtechcreators.in/api/internal/push` with `Authorization: Bearer <CRON_SECRET>` every minute. Keep this secret server-side. Vercel scheduling frequency depends on your plan; a separate server scheduler is also suitable. Booking itself does not depend on delivery succeeding.
5. On a physical phone, Account → Enable notifications. A registered Expo token is associated with that user's role. Worker processes up to ten messages per invocation in separate requests for the two Expo applications and checks receipts, retries transient failures, disables invalid devices, and exposes aggregate queue status to admin. Provider acceptance does not prove delivery to a phone.

Without Firebase and an EAS project ID, remote push is **not enabled**. In-app updates remain available; permitted local alerts are generated while the updates screen is open. Background location's ongoing Android notification is independent of remote push. Expo Go/browser preview cannot verify this complete native background workflow.

Optional phone and Google sign-in:

- Email OTP works with the current server IONOS settings. Keep `SMS_AUTH_ENABLED=false` until a Supabase SMS provider and its account/billing are configured. Then enable the flag and test real E.164 numbers. A manually entered profile mobile number is not verified by email OTP.
- Configure Supabase Google provider with a Google OAuth web client, using the Supabase callback URL shown in its dashboard. Add exact redirect allowlist entries `hyzzcustomer://auth/callback` and `hyzzdriver://auth/callback`. Set backend `GOOGLE_AUTH_ENABLED=true`. Mobile shows Google only when the API enables it, and uses a system browser with PKCE. An app callback does not grant a driver/admin role; driver document review still applies. Admin remains email OTP. Provider login has not been tested against your Google account.

Known boundaries and acceptance test:

This is a cash pilot. Online payment processing, bank payouts, real emergency dispatch, in-app chat, public live-sharing links, promotional reward processing, automatic navigation voice guidance and Google/phone provider credentials are not provisioned. Call and external Maps navigation are available. Do not interpret storyboard sample prices, badges or incentives as paid financial services.

Before public rollout, test two physical phones plus admin: new email signup → driver pending documents → admin four-document approval → GPS online → customer booking without car documents → accept → lock driver phone for several minutes and observe customer/admin updates → arrive/OTP/start → complete → verify tracking notification stops and the server returns no active point → cash confirmations/rating/history. Repeat cancellation, denied permission, poor internet, expired documents, logout and another user's access denial. FCM requires a separate real-delivery test after credentials are installed. Automated database/API/build checks do not replace this test.

Provider references: [Expo FCM setup](https://docs.expo.dev/push-notifications/fcm-credentials/), [Expo push delivery](https://docs.expo.dev/push-notifications/sending-notifications/), [Supabase Google sign-in](https://supabase.com/docs/guides/auth/social-login/auth-google), [OSM tile policy](https://operations.osmfoundation.org/policies/tiles/).

Build configuration note: this project includes a customized native `android` folder with customer/driver Gradle flavors and separate background permissions. EAS uploads that source and calls the flavor-specific Gradle task. Do not run `expo prebuild --clean` over it: that would replace these native customizations. Build both audiences separately. The local helper creates a test signing key when missing; set up managed production signing before public distribution.
