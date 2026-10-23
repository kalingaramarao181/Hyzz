# Admin dashboard connection fix

The deployed API answered `/health` successfully, and its origin allowlist included `https://hyzz.srtechcreators.in`. However, its CORS response omitted `Content-Profile` and `Accept-Profile`. The actual frontend SDK adds those headers to dashboard RPCs and table reads. Browsers block these requests before the data reaches Node, producing the generic “Cannot reach the Hyzz API” message even though login and health can succeed.

The backend now explicitly allows those schema headers plus the SDK's `Prefer`, `Range` and `Range-Unit` request headers. Origin restrictions and authentication remain enforced; this does not enable arbitrary sites or bypass staff permissions. The admin also distinguishes a failed initial dashboard load from empty records and offers retry. Polling failures now show an error while preserving previously loaded records.

## Deploy this fix

1. Redeploy the **backend** using the refreshed `backend/release/Hyzz-backend.zip`, selecting the extracted `backend` folder as project root. It contains `src/app.js` with the CORS fix. Re-uploading only the admin will not fix an old backend.
2. Keep Production environment variables configured in Vercel. Set `ALLOWED_ORIGINS=https://hyzz.srtechcreators.in`. If other browser origins are needed, list exact trusted origins separated by commas; do not use `*`. The ZIP intentionally excludes `.env`.
3. Redeploy the admin using `frontend/admin/release/Hyzz-admin-vercel.zip`. Its API origin is `https://api.srtechcreators.in` (no `/api/v1` suffix).
4. After both deployments complete, close old tabs or hard refresh with Ctrl+Shift+R, then sign in again. CORS preflight responses may remain cached for up to ten minutes in an existing browser session.
5. No new SQL migration or APK rebuild is required for this connection fix. Existing features still require migrations 001–008 to have been applied once. Staff pages show only the data permitted by the signed-in account; use the provisioned admin account to access all permitted management areas.

Verify the new deployed preflight in PowerShell:

```powershell
curl.exe -i -X OPTIONS "https://api.srtechcreators.in/api/v1/actions/admin_overview" -H "Origin: https://hyzz.srtechcreators.in" -H "Access-Control-Request-Method: POST" -H "Access-Control-Request-Headers: authorization,apikey,content-profile,content-type,x-client-info"
```

Expect `204`, `Access-Control-Allow-Origin: https://hyzz.srtechcreators.in`, and `Content-Profile` in `Access-Control-Allow-Headers`. A healthy `/health` response alone does not check browser access or authenticated database permissions.

If a problem remains after deployment, inspect the failed request in browser Network. A readable JSON 401 means sign in again; 403 indicates role/account/origin restrictions; missing-function errors require the corresponding migration. Preserve the request ID and error message when investigating. Do not share access tokens or server secrets.

The local checks use the actual frontend SDK to verify browser preflight header compatibility and ensure untrusted origins stay rejected. The browser fixture check covers initial data-load failure/retry and all ten admin navigation pages without using hosted accounts or changing real data. Hosted authenticated records still need verification after deploying.
