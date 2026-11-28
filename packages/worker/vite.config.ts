import { cloudflare } from "@cloudflare/vite-plugin"
import { defineConfig } from "vite"

// The web app's build (packages/web, `bun run --cwd ../web build`) ships as the Worker's static assets.
export default defineConfig({
  publicDir: "../web/dist",
  plugins: [cloudflare()],
})
