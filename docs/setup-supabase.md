> **1.2.0 update:** read [VERCEL-TESTING.md](VERCEL-TESTING.md) first. Apply new migrations 004 and 005 after existing 001–003. Node/IONOS SMTP delivery and database-backed rate limits are now the defaults and require the server-only service key. Supabase-dashboard SMTP applies only to the optional supabase delivery mode. API: https://api.srtechcreators.in; admin: https://hyzz.srtechcreators.in.

# Connect Supabase to the Node backend

If you already installed Hyzz migrations 001–003, keep your data and skip the initial database setup. This refactor changes application/server layout, not the schema. Do not reset or rerun the fresh-install SQL over a populated Hyzz schema.

For a new project, run `backend/database/Hyzz-setup.sql` once in Supabase SQL Editor. Alternatively run the three individual migration files in filename order, **not both alternatives**. PostGIS and pgcrypto are expected in the `extensions` schema; review existing extension placement/table names before installing into an established database.

## Email OTP

Supabase Authentication → custom SMTP:

| Setting | Value |
| --- | --- |
| Host | `smtp.ionos.com` |
| Port | `587`, provider-supported STARTTLS |
| Username / sender address | `ramarao.teamweb@bedatatech.com` |
| Password | Enter privately in Supabase SMTP settings |
| Sender name | Hyzz / your approved business sender name |

Keep email verification enabled. Update both Magic Link and Confirm Signup email templates to include `{{ .Token }}`, because the apps enter a code instead of opening a sign-in link. Configure Auth OTP expiry, provider quotas and abuse limits. Mail delivery/SPF/DKIM and any mailbox app password must be verified with IONOS; no working delivery is claimed without a real mailbox test.

All app Auth requests now go through Node (`/api/v1/auth/otp`, `/verify`, `/token`). Supabase still generates/verifies identities and sends Auth email through configured SMTP. Never put the mailbox password in an APK or admin bundle. Phone OTP remains disabled in this release, per the selected email fallback; profile contact numbers are unverified contact fields.

## First administrator and drivers

1. Deploy/start Node with `SUPABASE_URL`, publishable key and the private `SUPABASE_SERVICE_ROLE_KEY` from your project.
2. Sign into Hyzz Customer with your own email code after SMTP and database setup.
3. Replace the placeholder email in `backend/database/bootstrap-admin.sql` with that verified email and run it once in SQL Editor. It refuses to create another first Super Admin when one already exists.
4. Sign out of the customer app; that identity is now an employee. Sign into the admin website using the same email.
5. Create a driver account in Admin → Customers and upload/review its license and identity in Admin → Drivers. Only current approved documents and approved driver accounts can go online.
6. Use separate customer and driver emails/devices to test a booking, arrival, OTP start, completion and both cash confirmations.

**No Supabase Edge Function deployment is required anymore.** Node's `src/modules/admin.js` provisions driver/employee Auth accounts after checking the caller's permissions. Ordinary booking/read requests keep the user JWT and RLS. The old Edge Function may be disabled after you confirm all users have upgraded; old 1.0.x APKs used direct provider calls, whereas the new 1.1.0 APKs use your Node API.

Initial pricing is test configuration (₹50 base + ₹150/hour, ₹200 minimum, ₹1,200 eight-hour day, 15% driver commission). Approve your actual pricing and operating policies before public use. Existing booking price snapshots and ledger entries must remain unchanged.

Official references: [email OTP](https://supabase.com/docs/guides/auth/auth-email-passwordless), [custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp), [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security).
