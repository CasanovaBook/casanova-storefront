import { defineConfig, devices } from "@playwright/test"

/* The suite runs against a PRIVATE port with the Supabase env vars emptied,
 * which forces the app into its local data layer (isSupabaseConfigured ->
 * false). Two reasons: tests must never import/reset real production CMS
 * content, and results must not depend on network state. The port is not
 * reused from the developer's 8443 server on purpose - that one is usually
 * running WITH the real Supabase env from .env.local. */
const PORT = "8545"
const BASE_URL = `http://localhost:${PORT}`

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run dev",
    env: {
      PORT,
      VITE_SUPABASE_URL: "",
      VITE_SUPABASE_ANON_KEY: "",
      VITE_TURNSTILE_SITE_KEY: "",
    },
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
