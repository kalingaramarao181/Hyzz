# Hyzz visual assets

- `hyzz-journey.png`: custom AI-generated chauffeur and customer-car illustration. Built-in imagegen was used; no external API key or CLI fallback was used. Decorative artwork, not a real driver's identity photo.
- `hyzz-mark.svg`: editable vector road/H brand mark for the admin website.
- `apps/admin-web/public/favicon.svg`: the same brand mark used for the browser tab icon.
- `hyzz-customer-icon.png`: green/lime 1024px launcher and mobile logo export.
- `hyzz-driver-icon.png`: inverse lime/green 1024px driver launcher and mobile logo export.
- `scripts/create-brand-icons.ps1`: reproducible raster exports of the vector/code-native mark. Native launcher vector lives in `android/app/src/main/res/drawable/hyzz_icon.xml` with audience-specific colors.

The illustration appears on mobile email-login screens, booking/request banners, empty states and the admin login/overview. Mobile header logo opens Home; account icon opens Account. Existing service choices, navigation and action icons remain functional. Buttons animate gently on press. No decorative illustration initiates a booking or pretends to provide driver verification.

Exact built-in imagegen prompt:

> Create a polished premium editorial 3D illustration for the Hyzz Indian chauffeur booking mobile application, a project asset not a mockup. Landscape 3:2 composition. A beautiful modern pearl white compact sedan viewed three quarter front, steering wheel visible through glass, a friendly professional Indian chauffeur in a forest green uniform standing beside the car holding a small car key, subtle Indian urban architecture and a curved road route in the background. Deep forest green #16765B, bright lime #D4F467 accents, warm ivory and white, rounded sophisticated clay material, soft natural studio lighting, restrained detail, premium friendly trustworthy transport brand. Car and chauffeur fully visible with generous margin, centered composition, light mint #EDF5EF background with soft gradients, no hard border. No text, no letters, no numbers, no logos, no watermarks, no UI, no buttons. This will appear as a compact mobile welcome illustration and website hero art; ensure readable silhouettes at small size.

PNG source is copied into this directory, so every referenced asset ships with the source archive and application. Original generated output is preserved in Codex's generated_images directory.
