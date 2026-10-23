# Node.js API reference

Base origin: **`https://api.srtechcreators.in`**. All frontend authentication, booking, data, upload and admin-account requests use this separately deployed Node server. No Supabase project key or service credential is embedded in these new frontends. The Auth SDK is a maintained session/parser client; its network requests are rewritten by `frontend/shared/api/transport.cjs`.

The implemented OpenAPI 3.1 description is `backend/openapi.json` (also copied to `docs/openapi.json`). Import it into a trusted API client/local Swagger UI. Never paste real access tokens into untrusted hosted tools.

| Route | Purpose |
| --- | --- |
| `GET /health` | Node liveness |
| `POST /api/v1/auth/otp` | Email sign-in code; optional customer signup |
| `POST /api/v1/auth/verify` | Verify email code and receive session |
| `POST /api/v1/auth/token?grant_type=refresh_token` | Refresh session |
| `GET /api/v1/auth/user` | Validated Auth identity |
| `POST /api/v1/auth/logout?scope=local` | Revoke session; works even for blocked business accounts |
| `POST /api/v1/actions/{action}` | One of 44 explicitly validated application actions |
| `GET /api/v1/data/{resource}` | Bounded, allowlisted read retaining the user's RLS permissions |
| `POST /api/v1/admin/accounts` | Authorized driver/employee creation using server credentials |
| `POST /api/v1/documents/upload/{driverUUID}/{file}` | Private PDF/PNG/JPEG upload; multipart field `file`, at most 4 MiB |
| `POST /api/v1/documents/sign/{driverUUID}/{file}` | Authorized 60-second private viewing URL |

Protected calls require `Authorization: Bearer <access_token>`. The frontend's `apikey` marker is not an authorization credential and is ignored by Node. Node validates Auth identity, active account status and request shape. PostgreSQL then validates resource access, staff permissions, transaction locking, states, OTP attempts and financial integrity again. The internal `admin_provision_user` RPC is not a public Node action.

Example estimate:

```http
POST /api/v1/actions/estimate_service_fare
Authorization: Bearer <user access token>
Content-Type: application/json

{"p_service":"hourly","p_minutes":60,"p_km":0}
```

Current workflow actions: `my_profile`, `update_my_profile`, `estimate_service_fare`, `create_service_booking`, `nearby_requests`, `set_availability`, `accept_booking`, `decline_request`, `booking_details`, `advance_booking`, `issue_trip_otp`, `verify_pickup_code`, `start_trip`, `finish_service_trip`, `confirm_cash`, `cancel_booking`, `driver_wallet`, `submit_rating`, `submit_support`, `admin_overview`, `admin_live_locations`, `admin_set_role`, `admin_assign_driver`, `admin_publish_pricing`, `admin_record_commission`. Legacy estimate/create/completion names remain for compatibility; new screens use the GST-aware workflow. Exact parameter schemas live in `backend/src/modules/action-contracts.json`; SQL implementation is in migrations. Service-only `api_*` utilities and internal account provisioning are excluded from the public Node action router.

`verify_pickup_code` and legacy `verify_trip_otp` can return HTTP 200 with `{ok:false,message}` for an incorrect code; this commits the failed-attempt counter. Always inspect `ok`. Most successful void actions return JSON null. 400 means validation/business rule rejection; 401 invalid session; 403 permission/account status; 413 oversized upload/body; 429 rate limited; 503 missing setup/provider unavailable. Errors include a request ID and a friendly message, never a stack or secret.

Read resources are restricted to bookings, support_tickets, driver_documents, financial_ledger_entries, notification_records, pricing_rules, system_settings, roles, role_permissions and account_deletion_requests. Only ordinary column selections, documented sort fields, bounded limit/offset and the role_id equality filter are accepted. No client table writes, arbitrary SQL, relation embedding or arbitrary function names are exposed. Admin dashboard aggregates are returned through permission-checked actions. Document viewing returns an authorized expiring Storage URL; it does not make the bucket public.

Screens reconcile through Node HTTP polling while foregrounded. Direct provider Realtime sockets were removed so API traffic stays at the configured server. Background push, online payments and automated settlements remain unavailable as documented in feature-status.md.
