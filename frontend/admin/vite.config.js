import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
export default defineConfig({
  // Shared source resolves packages installed in this independently built frontend.
  resolve: { dedupe: ["react", "react-dom", "@supabase/supabase-js"] },
  server: {
    fs: { allow: [fileURLToPath(new URL("../../..", import.meta.url))] },
  },
});
