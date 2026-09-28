/**
 * Starter content for Casanova Bookstore.
 *
 * The local connector uses this on first load. Casanova follows a "no seed
 * data" philosophy: a fresh install is genuinely empty and every screen
 * renders an empty state until a real administrator creates real content
 * through the CMS.
 *
 * This file exports empty arrays / neutral defaults. Add demo content here
 * only for development or demo environments.
 */

import type { SiteSettings } from "./core/types";

const ts = "2026-01-01T00:00:00.000Z";
const base = { created_at: ts, updated_at: ts };

/**
 * Platform settings seed. Neutral defaults — no brand name, no payment
 * provider, no email provider. An administrator must configure these
 * from the CMS before the platform is operational.
 */
export const seedSettings: SiteSettings = {
  id: "site",
  brand_name: "",
  default_currency: "ILS",
  payment_provider: null,
  email_provider: null,
  phone: null,
  email: null,
  footer_text: null,
  tagline: null,
  mobile_app_enabled: true,
  maintenance_mode: false,
  maintenance_message: null,
  ...base,
};
