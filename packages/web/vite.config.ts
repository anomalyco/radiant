import { defineConfig } from "vite"
import solid from "vite-plugin-solid"

// The Worker serves dist/ from its ASSETS binding under BASE_PATH (packages/worker/src/shell.ts).
export default defineConfig({
  base: "/labs/radiant/",
  plugins: [solid()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    // The CSP allows fonts and images from 'self' only, so every asset ships as its own file.
    assetsInlineLimit: 0,
    modulePreload: { polyfill: false },
  },
})
