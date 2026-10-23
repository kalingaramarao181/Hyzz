// Produce a self-contained admin source snapshot; keep workspace shared files canonical.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const admin = path.join(root, 'frontend/admin');
const manifest = JSON.parse(fs.readFileSync(path.join(admin, 'package.json'), 'utf8'));
if (Object.values(manifest.dependencies || {}).some(value => value.startsWith('file:')))
  throw new Error('Admin source must not depend on the mobile workspace via file:. Remove that dependency before packaging.');
const build = path.join(root, 'build');
fs.mkdirSync(build, { recursive: true });
const target = fs.mkdtempSync(path.join(build, 'admin-vercel-'));
for (const name of ['src', 'public']) fs.cpSync(path.join(admin, name), path.join(target, name), { recursive: true });
for (const name of ['package.json', 'package-lock.json', 'index.html', 'vercel.json', '.env.example']) fs.copyFileSync(path.join(admin, name), path.join(target, name));
for (const name of ['api/client.js', 'api/transport.cjs', 'config.js']) {
  const destination = path.join(target, 'shared', name);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(path.join(root, 'frontend/shared', name), destination);
}
fs.mkdirSync(path.join(target, 'assets'));
for (const name of ['hyzz-journey.png', 'hyzz-mark.svg']) fs.copyFileSync(path.join(root, 'assets', name), path.join(target, 'assets', name));
for (const name of ['main.jsx', 'Brand.jsx', 'config/api.js']) {
  const file = path.join(target, 'src', name);
  const source = fs.readFileSync(file, 'utf8')
    .replaceAll('../../shared/api/client', '../shared/api/client')
    .replaceAll('../../../shared/config', '../../shared/config')
    .replaceAll('../../../assets/', '../assets/');
  fs.writeFileSync(file, source);
}
fs.writeFileSync(path.join(target, 'vite.config.js'), `import { defineConfig } from 'vite';
export default defineConfig({resolve:{dedupe:['react','react-dom','@supabase/supabase-js']}});
`);
fs.writeFileSync(path.join(target, '.gitignore'), 'node_modules/\ndist/\n.env*\n!.env.example\n.vercel/\n');
fs.writeFileSync(path.join(target, '.vercelignore'), 'node_modules/\n.env\n.env.local\n.git/\n');
fs.writeFileSync(path.join(target, 'README.md'), `# Standalone Hyzz Admin for Vercel

Extract this ZIP. Deploy the folder containing package.json, index.html, src/, shared/, assets/ and vercel.json.
Vercel: Framework Vite, Node 22.x, Install npm ci, Build npm run build, Output dist.
Set VITE_API_BASE_URL=https://api.srtechcreators.in before building. Do not add backend secrets.
Add hyzz.srtechcreators.in to this Vercel project's domains and follow its DNS instructions.
The API must allow https://hyzz.srtechcreators.in in ALLOWED_ORIGINS.

PowerShell: npm ci; npm run build

This source snapshot includes its shared API client and artwork. It does not need the mobile app or backend folders.
For ongoing development edit the canonical Hyzz/frontend/admin and frontend/shared files, then regenerate using
node scripts/prepare-admin-vercel.cjs and scripts/package-delivery.ps1 from the complete source workspace.
The separate Hyzz-admin-web.zip contains prebuilt static output; this ZIP is the Vercel source/build project.
`);
fs.writeFileSync(path.join(build, 'admin-vercel-source-path.txt'), target);
console.log(target);
