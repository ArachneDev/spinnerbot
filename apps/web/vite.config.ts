import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  build: {
    // The CSP refuses data: fonts, so small files must stay files too.
    assetsInlineLimit: 0,
    outDir: "dist/client",
    emptyOutDir: true,
  },
  server: {
    proxy: {
      "/api": "http://localhost:3000",
      "/brand": "http://localhost:3000",
      "/healthz": "http://localhost:3000",
    },
  },
});
