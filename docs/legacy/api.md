# Backend API

The implemented backend is Supabase Auth, PostgREST RPC and one privileged Edge Function. There is no unimplemented `/api/v1` server to deploy. All application RPCs require an authenticated, active user's access token. Permission checks are performed inside PostgreSQL; hiding a button is not an authorization control.

Base URL: `https://ajkdzvcnhnsvgfltfziu.supabase.co`.

`docs/openapi.json` is the generated OpenAPI 3.1 description of all 37 implemented RPC/function endpoints. Import it into a local Swagger UI or API client. Do not paste live access tokens into untrusted hosted API tools. Regenerate it and the combined setup SQL with `node scripts/generate-openapi.cjs` after changing migration signatures.

```http
POST /rest/v1/rpc/create_booking
apikey: <publishable key>
Authorization: Bearer <verified user's access token>
Content-Type: application/json

{"p_request_key":"<UUID>","p_address":"Pickup street and city","p_lat":17.385,"p_lng":78.4867,"p_service":"hourly","p_hours":2,"p_scheduled_at":"<ISO UTC timestamp>"}
```

Parameter names and return schemas are defined precisely in the migration function signatures. Monetary fields end in `_paise`, commission rates are basis points, timestamps are UTC ISO values, IDs are UUIDs. Friendly business-rule errors appear in the PostgREST `message`; constraints or unauthorized changes fail rather than trusting client flags. `verify_trip_otp` is special: an invalid code returns `{ok:false,message}` so the database commits the failed-attempt count. Clients must inspect `ok`, not just HTTP status.

| RPC | Inputs | Authorization / result |
| --- | --- | --- |
| `my_profile` | none | Active user; own profile, driver approval and permissions |
| `update_my_profile` | p_name, p_phone (nullable) | Own name/contact only; cannot set role/approval |
| `estimate_fare` | p_service, p_hours | Active user; server rate, integer-paise estimate and disclosed policy |
| `create_booking` | p_request_key, p_address, p_lat, p_lng, p_service, p_hours, p_scheduled_at | Customer only; idempotent request UUID; matching booking |
| `set_availability` | p_online, p_lat, p_lng | Driver; valid approval/documents to go online |
| `nearby_requests` | none | Eligible online driver; up to 20 nearest eligible requests |
| `accept_booking` | p_booking | Eligible online nearby driver; atomically wins request |
| `booking_details` | p_booking | Participant or authorized operations/finance staff; related names and receipt, not raw OTP |
| `advance_booking` | p_booking, p_action (`en_route` / `arrive`) | Assigned eligible driver; validated sequence |
| `update_pickup_location` | p_booking, p_lat, p_lng | Assigned driver before trip start only |
| `pickup_driver_location` | p_booking | Booking customer; fresh pickup location only, otherwise null |
| `issue_trip_otp` | p_booking | Customer before trip start; plaintext returned only on issuance; 60s cooldown |
| `verify_trip_otp` | p_booking, p_code | Assigned eligible driver at pickup; maximum five guesses, 10-minute expiry, replay blocked |
| `complete_trip` | p_booking | Assigned driver; server duration and frozen price; idempotent completion |
| `confirm_cash` | p_booking | Completed-trip participant; both participants must confirm |
| `cancel_booking` | p_booking, p_reason | Permitted participant or operations staff before trip; reason required |
| `expire_requests` | none | Active user; expires only matching rows whose server timeout passed |
| `submit_rating` | p_booking, p_score (1–5), p_review | Completed-trip participant; one rating per author/booking |
| `submit_support` | p_subject, p_booking (nullable), p_dispute | Own request and own booking; dispute does not rewrite fare |
| `report_emergency` | p_booking (nullable) | Own incident record; no emergency dispatch claimed |
| `request_account_deletion` | none | Own review request, idempotent; no immediate financial erasure |
| `driver_wallet` | none | Driver; aggregate own immutable earnings/commission/cash records |
| `set_notification_preference` | p_enabled | Customer optional outbound preference; trip state still shown |
| `admin_overview` | none | Staff; returns only sections authorized by each module permission |
| `admin_provision_user` | p_user, p_name, p_kind, p_role | Required users.manage/staff.manage; newly created unused account only |
| `admin_set_role` | p_user, p_role, p_reason | staff.manage; cannot change own role |
| `admin_role_permissions` | p_role, p_permissions[], p_reason | staff.manage; cannot edit Super Admin or own role |
| `admin_set_status` | p_user, p_status, p_reason | users.manage for customer/driver, staff.manage for staff; cannot change own status |
| `register_document` | p_driver, p_type, p_path, p_expires | Owner-driver or reviewers; validates private uploaded object path |
| `admin_review_document` | p_document, p_status, p_reason | drivers.review; valid evidence, expiry and reason |
| `admin_approve_driver` | p_driver, p_reason | drivers.review; both current approved document types |
| `admin_assign_driver` | p_booking, p_driver, p_reason | bookings.manage; online approved unoccupied driver, eligible pre-trip booking |
| `admin_update_pricing` | p_base, p_hourly, p_minimum, p_day, p_commission | settings.manage; append-only future booking rate snapshot |
| `admin_update_settings` | p_radius, p_expiry, p_maintenance | settings.manage; bounded configuration values |
| `admin_resolve_ticket` | p_ticket, p_status, p_note | support.manage; audited status/note; does not settle financial disputes |

Privileged account endpoint: `POST /functions/v1/admin-accounts`, body `{email,name,kind:"driver"|"employee",role?}`. It verifies caller JWT with Auth, checks module permissions using the caller's database identity, creates an unconfirmed passwordless Auth identity with server credentials, and provisions its profile. On provisioning failure it attempts to remove the new Auth identity. A cleanup failure needs manual inspection in Auth/audit logs. Existing accounts are not silently converted or sent passwords. Status codes: 201 created, 400 invalid request/provider error, 401 invalid session, 403 no permission, 405 unsupported method. No SMTP email is claimed sent by this endpoint.

Auth uses Supabase `/auth/v1/otp` and `/auth/v1/verify` through the official client. Mobile sessions refresh through Supabase Auth and are kept in SecureStore. Supabase Auth provider rate limits apply to email delivery. SQL limits booking creation (6/hour), trip-code issuance (10/hour), support requests (10/hour), emergency reports (5/hour), plus OTP guesses (5 per issued code). Additional edge/network abuse limits and CAPTCHA remain production work.

Read queries are RLS-protected PostgREST table endpoints. Mobile booking history is limited to the latest 50; support/notifications and wallet lists have documented UI limits. Admin overview caps users/documents/bookings/tickets at 500, audit/emergencies at 200 and ledger rows at 1,000. Aggregate finance/counts are server totals. CSV buttons export **visible rows**, not a falsely complete full-history dataset. Paginated historic reports and retention exports remain future work.

Storage bucket `driver-documents` is private, max 5 MB per PDF/JPEG/PNG. Signed viewing expires after 60 seconds and requires reviewer or owner RLS access. No client may overwrite/delete an approved stored object. Orphan uploads after interrupted registration require an authorized retention cleanup process.
