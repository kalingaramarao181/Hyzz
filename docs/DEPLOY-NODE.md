> **1.2.0 update:** read [VERCEL-TESTING.md](VERCEL-TESTING.md) first. Apply new migrations 004 and 005 after existing 001–003. Node/IONOS SMTP delivery and database-backed rate limits are now the defaults and require the server-only service key. Supabase-dashboard SMTP applies only to the optional supabase delivery mode. API: https://api.srtechcreators.in; admin: https://hyzz.srtechcreators.in.

# Deploy Node at https://api.srtechcreators.in

Deploy **only `Hyzz/backend`** to your own server, for example `/opt/hyzz/backend`. It contains its own package.json/lockfile, source, SQL, OpenAPI and deployment templates. The frontend/mobile build toolchain is not needed on the API server.

## Server environment

Install Node 22 LTS and nginx using your server's supported package installation process. Create a dedicated `hyzz` service account and ensure it can read the backend directory and private `.env`. In that directory:

```bash
npm ci --omit=dev
cp .env.example .env
# Edit .env on the server. Never upload it to a public folder or Git.
```

Required settings:

```dotenv
NODE_ENV=production
HOST=127.0.0.1
PORT=3000
PUBLIC_API_URL=https://api.srtechcreators.in
ALLOWED_ORIGINS=https://YOUR_ACTUAL_ADMIN_DOMAIN
TRUST_PROXY=loopback
SUPABASE_URL=https://ajkdzvcnhnsvgfltfziu.supabase.co
SUPABASE_PUBLISHABLE_KEY=YOUR_PROJECT_PUBLISHABLE_KEY
SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVER_ONLY_SERVICE_ROLE_KEY
```

The publishable key is already supplied in `.env.example`. Obtain the service-role/secret key from your project's API settings and enter it on the server. It is used only for authorized Auth-account creation, never for ordinary user reads or booking mutations. Missing it makes account creation explicitly unavailable, rather than giving clients elevated authority. Multiple admin origins can be comma-separated; no wildcard CORS is used. Mobile apps do not require browser Origin headers.

Configure SMTP/email code templates in Supabase Auth as described in `setup-supabase.md`. Email identity verification and token refresh remain with Supabase Auth; the apps now call them **through Node**. Never put the IONOS password into a frontend `.env`. SMS and online payment integrations remain unavailable in this cash-first release.

## Database setup

If migrations 001–003 are already applied, **do not run the initial setup again or reset the schema**. This source reorganization does not require a new database schema. For a fresh installation run `backend/database/Hyzz-setup.sql` once, then bootstrap your verified administrator email using `backend/database/bootstrap-admin.sql`. Database transactions, immutable ledger and RLS stay in PostgreSQL; Node validates and authorizes HTTP requests before executing them under the caller's JWT.

## Run continuously

Use the supplied `deploy/hyzz-api.service` with systemd after adjusting the account, Node executable location and backend path to your server. Protect the environment file:

```bash
chmod 600 /opt/hyzz/backend/.env
sudo cp deploy/hyzz-api.service /etc/systemd/system/hyzz-api.service
sudo systemctl daemon-reload
sudo systemctl enable --now hyzz-api
sudo systemctl status hyzz-api
curl --fail http://127.0.0.1:3000/health
```

Logs: `journalctl -u hyzz-api -f`. Application logs include request IDs/status codes and omit tokens, OTPs, passwords and request bodies. Configure log retention/monitoring on your server. `GET /health` proves the Node process is running, not that SMTP, database migrations or account provisioning have been configured.

## DNS, nginx and TLS

Point the DNS A/AAAA record for `hyzz.bedatatech.com` to your server. Open inbound ports 80/443. Do not expose Node port 3000 publicly; bind it to loopback and proxy nginx to it. Obtain a valid TLS certificate using your server's certificate tooling (for example Certbot's nginx integration). Do not enable a TLS nginx block before the certificate files exist.

Adapt `backend/deploy/nginx.conf` with your actual certificate paths, install it in nginx's site configuration, test with `nginx -t`, and reload nginx. The template overwrites forwarding headers, limits request bodies and connection time, adds TLS/HSTS, and proxies HTTPS requests to `127.0.0.1:3000`. `TRUST_PROXY=loopback` matches this one-host arrangement. If you add Cloudflare, another load balancer or multiple servers, review proxy/IP/rate-limit settings rather than trusting every forwarding header.

```bash
curl --fail https://api.srtechcreators.in/health
```

Expected: JSON with `service: "hyzz-node-api"`. A protected route without a session must return 401. Configure the real admin origin in backend `.env`, restart the API, and test login from that deployed admin site. CORS is not a replacement for authentication; every protected route checks a valid user token and active account status.

## Docker alternative

From the **backend** folder:

```bash
docker build -f deploy/Dockerfile -t hyzz-api .
docker run -d --name hyzz-api --restart unless-stopped \
  --env-file .env -e HOST=0.0.0.0 -p 127.0.0.1:3000:3000 hyzz-api
```

Keep nginx/TLS in front. The container runs as a non-root user. No Docker execution or deployment to your server has been performed in this workspace.

## Deploy admin and verify the journey

Build admin using `npm run admin:build` from the complete Hyzz workspace. Deploy only `frontend/admin/dist/` to your web host, separately from the Node backend. Its API default is `https://api.srtechcreators.in`; override `VITE_API_BASE_URL` before building if needed. If your admin lives on the API hostname, configure static/API routing carefully; the supplied Node server itself does not serve the admin site. Separate admin hosting avoids path conflicts.

After deployment, verify: customer email login, admin driver creation/document approval, driver email login/availability, nearby booking acceptance, pickup OTP, completion, fare/commission, and both cash confirmations. Test blocked accounts, expiry, cancellation and customer access to unrelated bookings. A successful local build does not establish that these hosted integrations are live.

## Updates, backups and operations

Deploy new backend code, run `npm ci --omit=dev`, restart the service and verify health. Deploy backwards-compatible changes before new APKs; keep `/api/v1` working for existing installations. For schema changes use new transactional migrations with a backup/restore plan. Database backups and private Storage object backups are separate concerns; confirm the provider's retention/restore guarantees for your plan and test recovery in staging. Do not delete immutable financial records to correct a dispute.

The in-memory rate limiter supports the supplied **single-process** deployment. Before adding replicas/workers, implement a shared limiter store and review ingress quotas. Add production monitoring, incident response, managed signing and an independent security review before public operation. No codebase can honestly be guaranteed “perfect” without acceptance testing in its actual deployed environment.

Official references: [Express security recommendations](https://expressjs.com/advanced/best-practice-security/), [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security).
