# Hyzz public website

Independent React/Vite website with responsive green/lime styling, motion preferences, published guides/policies, contact enquiries and public APK download links.

PowerShell from this folder: `npm ci`, then `npm run dev` or `npm run build`. Preview a build with `npm run preview`. Deployment: Vite, Node 22.x, build `npm run build`, output `dist`. Copy `.env.example` settings into your deployment environment; add the exact website origin to the backend ALLOWED_ORIGINS. Keep backend secrets out of this project.

Edit `src/main.jsx` for sections and `src/style.css` for layout/motion. Admin Content manages published copy and contact details. Phone/WhatsApp defaults to the supplied +917730020465. The support email remains blank until configured. Publish APKs in admin App updates before downloads appear. See the complete source project's docs/OPERATIONS-1.5.md.

Screenshots are actual browser renders with fixture data, not evidence of hosted enquiry delivery.
