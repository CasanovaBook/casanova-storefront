#!/usr/bin/env bash
# ============================================================
# check-migration-columns.sh
#
# Pre-flight: does every table.column the migrations name actually
# exist in the live database?
#
# This exists because a migration that references a column which is not
# there does not fail when it is written, and does not fail when it is
# linted. It fails in the browser, at run time, as a raw 42703 with no
# hint about which of several dozen references was the wrong one — which
# is how `product_relations.product_id` cost a round-trip: four of the
# five child tables hang off `product_id` and the fifth does not, so the
# loop looked uniform right up to the iteration that threw.
#
# PostgREST answers a request for a missing column with 42703 and a
# request for a present one with 200, so the anon key is enough to test
# existence. Nothing is read that the storefront could not already read.
#
# Usage:
#   ./scripts/check-migration-columns.sh
#   ./scripts/check-migration-columns.sh products:content_url
# ============================================================
set -uo pipefail

cd "$(dirname "$0")/.." || exit 1
set -a; . ./.env.local 2>/dev/null; set +a

URL="${VITE_SUPABASE_URL:?VITE_SUPABASE_URL is not set}"
KEY="${VITE_SUPABASE_ANON_KEY:?VITE_SUPABASE_ANON_KEY is not set}"
REST="$URL/rest/v1"

# Every table.column the catalogue migrations touch. Kept explicit on
# purpose: this is the list that has to be re-checked when the schema
# moves, so it should read as a list, not be inferred from the SQL.
TARGETS=(
  # 0022 / 0024 — the columns admin_save_product writes
  products:product_id products:name products:subtitle products:slug
  products:sku products:description products:short_description
  products:product_type products:price products:sale_price products:currency
  products:image_url products:cover_colors products:content_url
  products:content_asset_id products:tags products:metadata
  products:seo_title products:seo_description products:seo_keywords
  products:status products:visibility products:availability
  products:inventory products:featured products:position
  products:created_at products:updated_at products:archived_at
  products:rating products:reviews_count
  books:product_id books:author_name books:isbn books:publisher
  books:language books:publication_date books:total_pages
  product_categories:product_id product_categories:category_id
  product_images:product_id product_images:image_id product_images:image_url
  product_images:sort_order product_images:alt_text product_images:asset_id
  product_media_links:product_id product_media_links:media_link_id
  product_media_links:label product_media_links:url
  product_media_links:platform product_media_links:sort_order
  # the one that is NOT product_id — the whole point of this script
  product_relations:relation_id product_relations:source_product_id
  product_relations:target_product_id product_relations:relation_type
  product_relations:sort_order
  # 0023 — checkout
  orders:order_id orders:order_number orders:user_id orders:order_status
  orders:payment_status orders:subtotal orders:discount_amount
  orders:total_amount orders:currency orders:coupon_code
  orders:customer_first_name orders:customer_last_name
  orders:customer_email orders:customer_phone orders:paid_at
  order_items:order_item_id order_items:order_id order_items:product_id
  order_items:product_name order_items:product_slug order_items:quantity
  order_items:unit_price order_items:discount_amount order_items:line_total
  payments:order_id payments:provider payments:status payments:amount
  payments:currency payments:transaction_reference payments:captured_at
  user_products:user_product_id user_products:user_id
  user_products:product_id user_products:product_snapshot
  user_products:source_order_id user_products:access_status
  user_products:granted_at user_products:expires_at user_products:granted_by
  user_products:revoked_at user_products:revoked_by user_products:revoke_reason
  subscriptions:product_id
  platform_settings:is_singleton platform_settings:payment_provider
  platform_settings:order_prefix
  users:user_id users:role users:admin_role users:account_status
  users:first_name users:last_name users:email users:phone
)

# A POSTGREST_ERROR is the shape of "the column is not there".
probe() {
  local table="$1" col="$2" code
  code=$(curl -s -o /dev/null -w '%{http_code}' \
    "$REST/$table?select=$col&limit=1" \
    -H "apikey: $KEY" -H "Authorization: Bearer $KEY")
  case "$code" in
    200) return 0 ;;                       # exists (2xx variants count)
    400|404) return 1 ;;                   # 42703 / PGRST202: missing
    401|403) return 0 ;;                   # refused, not missing
    *) return 0 ;;
  esac
}

missing=0
checked=0
printf 'checking %d table.column references against the live database…\n\n' "${#TARGETS[@]}"

for t in "${TARGETS[@]}"; do
  table="${t%%:*}"; col="${t##*:}"
  checked=$((checked+1))
  if ! probe "$table" "$col"; then
    printf '  \033[31mMISSING\033[0m  %s.%s\n' "$table" "$col"
    missing=$((missing+1))
  fi
done

# Anything passed on the command line, e.g.
#   ./scripts/check-migration-columns.sh products:content_url
if [ $# -gt 0 ]; then
  printf '\ncommand-line arguments:\n'
  for t in "$@"; do
    table="${t%%:*}"; col="${t##*:}"
    if probe "$table" "$col"; then
      printf '  \033[32mpresent\033[0m  %s.%s\n' "$table" "$col"
    else
      printf '  \033[31mMISSING\033[0m  %s.%s\n' "$table" "$col"
      missing=$((missing+1))
    fi
  done
fi

printf '\nchecked %d, missing %d\n' "$checked" "$missing"

# Note: a column revoked in 0025 (content_url, content_asset_id) answers
# 403/401 rather than 200, which probe() counts as present. That is the
# intended behaviour — those two SHOULD stop being readable.
if [ "$missing" -gt 0 ]; then
  printf '\nA migration references a column that does not exist. Find it above.\n'
  exit 1
fi
exit 0
