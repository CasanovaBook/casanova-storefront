/* ────────────────────────────────────────────────────────────
 * Bundled product fallback for the CASANOVA landing page.
 *
 * The catalogue is the source of truth whenever Supabase is configured.
 * This bundled row keeps the page and its purchase summary meaningful on an
 * install with no hosted catalogue: with no Supabase the local document is
 * the catalogue, so the first purchase click seeds this row before checkout
 * resolves it. On a hosted install it is display copy only — the real
 * `hya-kvdm` row wins, including its price.
 * ───────────────────────────────────────────────────────────── */

import type { Product } from "../types"
import { nowIso } from "../data/db"

const at = nowIso()

/**
 * Offline launch offer — the price `BUNDLED_PRODUCT` carries when there is
 * no hosted catalogue row to read from. With Supabase configured the live
 * row wins, and every marketing price is resolved through `effectivePrice`.
 * Kept in one place so the two values cannot drift apart.
 */
const LAUNCH_PRICE = 99
const LAUNCH_SALE_PRICE = 59

/** The bundled product — used as the offer's source of truth when the
 *  catalogue is empty, and as a safety net when the real product is missing
 *  visual fields (cover image, cover colours). */
export const BUNDLED_PRODUCT: Product = {
  product_id: "prd_hi_kodem_bundle",

  name: "היא קודם",

  slug: "hya-kvdm",

  product_type: "EBOOK",

  price: LAUNCH_PRICE,

  sale_price: LAUNCH_SALE_PRICE,

  currency: "ILS",

  status: "ACTIVE",

  visibility: "PUBLIC",

  availability: "AVAILABLE",

  inventory: null,

  featured: true,

  position: 1,

  image_url: "/covers/hi-kodem-cover.png",

  short_description:
    "חוויות מחדר המיטות — מדריך פרקטי לגבר שרוצה לדעת מה באמת קורה בגוף שלה.",

  description:
    "היא קודם הוא מדריך פרקטי לגבר שרוצה להפסיק לנחש אם היא נהנתה — ולדעת בדיוק מה לעשות כדי שהיא תבקש עוד.",

  cover_colors: ["#2C1810", "#1A0E0A"],

  content_url: "/books/hi-kodem.pdf",

  created_at: at,

  updated_at: at,
}

/** Bundled conversion copy — used as fallback when the settings fields are
 *  empty. The landing page reads the CMS keys first, so an editor can
 *  override any of these without a deploy. */
export const SALES_SETTINGS_DEFAULTS = {
  sales_sticky_cta: "לרכישת הספר",

  sales_exit_title: "רגע אחד.",

  sales_exit_body:
    "לפני שמחליטים, אפשר לראות בקצרה מה יש בספר ואיך מקבלים גישה.",

  sales_exit_cta: "לרכישת הספר",
}
