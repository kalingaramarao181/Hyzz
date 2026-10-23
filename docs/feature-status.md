# Hyzz 1.4 feature status

The customer, driver, admin and Node API implement a cash booking workflow beyond authentication. Read [DRIVER-SCREENS.md](DRIVER-SCREENS.md) before deploying this upgrade. No automated check guarantees a production service is error-free.

| Area | Implemented | Remaining integration / acceptance |
| --- | --- | --- |
| Authentication | Email signup/login, IONOS OTP, secure native sessions, refresh/logout; optional mobile Google PKCE and phone endpoints gated by server flags | Google OAuth and SMS providers must be configured and tested; admin uses email |
| Customer | Real map/GPS/manual pickup pin, optional destination, saved places, optional cars and private documents, driver category, hourly/distance/full-day estimate, scheduling/cancellation/history filters | Real device location, new hosted migrations and two-phone booking test; address text is entered manually |
| Driver | Self-registration, own private document upload, four-document review/expiry gate, online/offline, all 12 storyboard panels, nearby accept/decline, earnings charts, wallet, profile/settings, contact/navigation and participant chat | All required documents reviewed by admin; production signing and physical phone tests |
| Trip tracking | Native assigned-trip GPS task with foreground Android notification and background permission, latest-point API, 5-second customer/admin polling, stale indicator, completion/cancellation/reassignment cleanup | Locked-phone GPS/battery/network acceptance test; force-stop/reboot may interrupt sharing |
| Trip state | Assigned → en route → arrived → customer OTP → driver start → completion; server fare/time, receipt and ratings | Distance remains driver-reported, not a certified taximeter |
| Cash | Two-party confirmations, disputes, immutable ledger, wallet/commission receipt controls | Actual collection is operational; audited platform-credit payout requests and manual finance review implemented, no automated bank transfers |
| Admin | Real location map, approval/private document review, optional customer car documents, service zones/categories, matching/maintenance, staff permissions, pricing/finance/support/audit/CSV | Deploy new admin/backend, apply migrations and perform hosted role tests |
| Notifications | In-app updates/local alerts, device registration, private durable outbox, worker retries/receipts, aggregate admin status | Firebase FCM V1 credentials, each app's EAS project/client config, server scheduler, real-delivery testing |
| Maps | Bundled Leaflet, attributed OpenStreetMap tiles, optional OSRM road route and external Google Maps navigation | Commercial fleet routing/tile provider; no address search, traffic feed or built-in voice navigation |
| Delivery | Separate folders, SQL upgrade, standalone Vercel source archives, customer/driver native flavors, APK build helpers | Manual hosted upgrade/deployment and provider setup; no device-connected claim |

Implemented in 1.4: persisted participant chat, platform-credit wallet, encrypted bank details, payout reservations and admin approval/manual-paid review. Not provisioned: automatic online payments/bank transfers/refunds, public live-share links or emergency dispatch. Language preference changes main navigation labels only. SOS records an incident and clearly directs users to actual emergency services. Fixture screenshots use local test responses and are labeled accordingly; they are not evidence of live GPS or hosted financial transactions.
