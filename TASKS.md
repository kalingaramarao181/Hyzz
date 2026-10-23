# Hyzz implementation checklist

Status is recorded from actual checks in docs/verification.md.

- [x] Shared Supabase schema, RLS, transactions and role checks (local DB verified)
- [x] Customer and driver OTP authentication with secure mobile session storage (implemented; live email pending)
- [x] Admin-only Node driver provisioning and document approval (SQL tested; hosted deployment pending)
- [x] Customer booking, driver matching and atomic acceptance (local DB verified; multi-connection load test pending)
- [x] Pickup-only location, booking OTP and server-timed trip (SQL verified; GPS/device test pending)
- [x] Versioned pricing, cash confirmation and immutable commission ledger (local DB verified)
- [x] Ratings, support, emergency reporting and account deletion requests (records/workflows implemented; no emergency dispatch)
- [x] Admin staff permissions, operations, bounded reports and settings
- [x] Android customer and driver APK compilation and verification (test signatures, IDs, audience and content checked; phone tests pending)
- [x] Admin production bundle and automated checks (including responsive login browser checks)
- [ ] Supabase migration applied by project owner (external)
- [x] IONOS SMTP connection, TLS and authentication checked (no email sent; hosted OTP delivery pending)
- [x] Node/Vercel handler, shared database rate limiter and guarded demo seed implemented
- [x] Distance/GST/grace pricing, separate verification/start, decline and commission receipt workflow (local SQL verified)
- [x] Server-only Supabase key supplied and migrations 004/005 applied to hosted project
- [x] Dedicated provided demo inboxes seeded; hosted roles, fixture ledger/private files and idempotency verified
- [ ] First real email OTP sign-in and authenticated APK journey verified
- [ ] Vercel API/admin projects deployed and custom-domain DNS/TLS completed
- [ ] Real-device, live-backend and production provider acceptance tests

Online gateway, refunds/payout automation, background push, geocoding, advanced promotions, iOS release and full production compliance are separate integrations. Never present them as available without implementation and verification.

## Live platform 1.3 upgrade

- [x] Add driver self-signup and four-document review with private uploads
- [x] Add optional customer cars/documents, destinations, driver categories and saved places
- [x] Add real street maps and participant-scoped trip tracking with driver background task
- [x] Add admin maps, zones, category and optional document controls
- [x] Add notification outbox/worker and gated Google/phone integration
- [x] Local API/database/SDK and fixture UI checks
- [ ] Owner applies 006/007 and deploys backend/admin
- [ ] Owner configures Firebase/EAS push credentials and scheduler
- [ ] Physical-phone background GPS and real push acceptance

## Driver storyboard 1.4

- [x] All 12 reference panels, arrival OTP, participant chat and connected support/settings
- [x] Wallet credit, encrypted bank records, payout reservation and audited finance review
- [x] Migration 008 local upgrade/permission/business tests
- [x] Real-component browser fixture journey and screenshot gallery
- [ ] Owner applies missing migrations through 008 and deploys new API/admin
- [ ] Configure Firebase push credentials and scheduler; verify real delivery
- [ ] Two-phone booking and locked-screen Android GPS acceptance

## Operations and public website 1.5

- [x] Customer account creation/contact maintenance and separate driver ride access
- [x] Eligible assignment dropdown and participant notifications
- [x] Pre-assignment ride commission controls and commission-funded coupons
- [x] Published content/policies/guides, public enquiries and support contact
- [x] Independent animated public website with responsive browser checks
- [x] Private APK upload/publish/retire registry and audience update announcements
- [x] App version prompt, guides/contact form and notification download handling
- [ ] Owner applies missing migrations through 010 and deploys all web projects
- [ ] Owner configures FCM/scheduler and verifies signed update installation on phones
