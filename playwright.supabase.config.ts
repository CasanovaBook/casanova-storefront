import { defineConfig, devices } from "@playwright/test"

/* Separate from playwright.config.ts on purpose: that suite deliberately
 * empties the Supabase variables to exercise the local driver. This one
 * starts a second dev server with a dummy project URL so the hosted admin
 * paths run, while every request is stubbed inside the spec. No real
 * Supabase project is ever contacted. */
const PORT = "8546"
const BASE_URL = `http://localhost:${PORT}`

export default defineConfig({
  testDir: "./e2e-supabase",
  fullyParallel: false,
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
      VITE_SUPABASE_URL: "https://testproject.supabase.co",
      VITE_SUPABASE_ANON_KEY: "test-anon-key",
      VITE_TURNSTILE_SITE_KEY: "",
    },
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
