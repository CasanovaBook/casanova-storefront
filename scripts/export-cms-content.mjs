/**
 * Read-only export of the Maestro CMS content tables into `backups/`.
 *
 * Run manually when a backup is wanted. Requires credentials in .env.local:
 *   VITE_SUPABASE_URL and VITE_SUPABASE_SERVICE_ROLE_KEY.
 * The service-role key is read from the environment at runtime; it is never
 * printed, logged, or committed (backups/ and .env.local are git-ignored).
 *
 * Also emits backups/sales-overrides.json — a key/value map of every
 * `sales.*` override currently stored in site_content. Merge any needed
 * values into content/sales.json BEFORE the Git-first cutover, so the
 * live page copy does not change when the DB stops being consulted.
 *
 * Usage:  node scripts/export-cms-content.mjs
 * Output: backups/cms-content-<date>.json
 *         backups/sales-overrides.json
 */

import { createClient } from "@supabase/supabase-js";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

/* Minimal .env.local parser — the project has no dotenv dependency. */
function loadEnv() {
  try {
    const raw = readFileSync(".env.local", "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) {
        process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
      }
    }
  } catch {
    /* no .env.local: rely on process env */
  }
}
loadEnv();

const url = process.env.VITE_SUPABASE_URL;
const key = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error(
    "Missing VITE_SUPABASE_URL / VITE_SUPABASE_SERVICE_ROLE_KEY in .env.local. " +
      "Nothing was read or written.",
  );
  process.exit(1);
}

const supabase = createClient(url, key, { auth: { persistSession: false } });

const TABLES = [
  "site_content",
  "cms_sections",
  "testimonials",
  "faqs",
  "cms_pages",
  "cms_categories",
  "platform_settings",
  "media",
];

const out = { exported_at: new Date().toISOString(), tables: {} };

for (const table of TABLES) {
  const all = [];
  let from = 0;
  const PAGE = 1000;
  for (;;) {
    const { data, error } = await supabase
      .from(table)
      .select("*")
      .range(from, from + PAGE - 1);
    if (error) {
      console.error(`x ${table}: ${error.message}`);
      break;
    }
    all.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
    from += PAGE;
  }
  out.tables[table] = all;
  console.log(`- ${table}: ${all.length} rows`);
}

mkdirSync("backups", { recursive: true });

const dated = `backups/cms-content-${new Date().toISOString().slice(0, 10)}.json`;
writeFileSync(dated, JSON.stringify(out, null, 2));
console.log(`\nBackup written to ${dated} (backups/ is git-ignored).`);

/* Sales-page overrides: site_content rows whose key starts with "sales."
 * (or the SEO image fields), keyed the same way content/sales.json's
 * flattened keys map onto the registry. */
const rows = out.tables.site_content ?? [];
const overrides = {};
for (const row of rows) {
  const k = row?.key ?? row?.id;
  if (typeof k === "string" && k.startsWith("sales.")) {
    overrides[k] = row.value ?? row.content ?? null;
  }
}
writeFileSync("backups/sales-overrides.json", JSON.stringify(overrides, null, 2));
console.log(
  `Sales overrides: ${Object.keys(overrides).length} key(s) written to backups/sales-overrides.json.`,
);
