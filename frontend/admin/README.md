# Hyzz Admin Web

For folder/ZIP upload to Vercel, use **`release/Hyzz-admin-vercel.zip`**. It is a self-contained source/build project with the required shared client and artwork included. Extract and deploy its root: Framework **Vite**, Node **22.x**, Install **npm ci**, Build **npm run build**, Output **dist**. Set `VITE_API_BASE_URL=https://api.srtechcreators.in`; configure `hyzz.srtechcreators.in` in Domains. Never put backend secrets in this frontend.

`release/Hyzz-admin-web.zip` is already-built static output, for static hosting. It is a different artifact from the Vercel source ZIP. Uploading only the canonical admin folder without its shared files will not provide everything needed to compile. With the complete repository, Root Directory `Hyzz/frontend/admin` plus Vercel's “Include source files outside Root Directory” option remains supported.

Regenerate both delivery ZIPs after source edits, from `Hyzz`:

```powershell
npm run admin:build
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/package-delivery.ps1
```

The admin package explicitly approves only the locked `esbuild@0.25.12` install script on npm versions that enforce install-script approval. Review and update that approval when intentionally upgrading esbuild. It no longer depends on the mobile project as an npm package.

Development source: `src/`; API override: `src/config/api.js` or `.env` (`VITE_API_BASE_URL`). Shared client/config are in `../shared`; artwork is in the workspace `assets` folder. Use the complete source tree to edit/build.

```powershell
# From Hyzz/frontend/admin:
npm ci
npm run dev
npm run build
```

Deploy **only `dist/`** to your separate admin website host. `release/Hyzz-admin-web.zip` packages that output. Configure your actual admin origin in the Node server's ALLOWED_ORIGINS and use HTTPS. Do not deploy Node secrets into this frontend directory. Admin sessions are held in memory and require a fresh login after a full page reload.

See `../../docs/DEPLOY-NODE.md` and `../../docs/EDIT-AND-BUILD.md`. The Node API defaults to `https://api.srtechcreators.in`; the admin website is not a native Android application.
