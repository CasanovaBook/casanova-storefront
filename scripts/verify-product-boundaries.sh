#!/usr/bin/env bash
# ============================================================
# verify-product-boundaries.sh
#
# Checks the catalogue read boundaries against the LIVE project.
# Read-only: it selects, and calls functions that are expected to be
# refused, so running it cannot change a row.
#
#   0. which migrations are live
#   1. the storefront read, as anon     (unchanged before/after 0025)
#   1b the exact column list the app selects, plus its embeds
#   2. the protected columns, as anon   (refused, not answered)
#   3. anon access to the admin RPCs    (refused by grant)
#   4. the role matrix                  (one token per role)
#   5. SQL that only the dashboard can run
#
# Usage:
#   ./scripts/verify-product-boundaries.sh
#   ./scripts/verify-product-boundaries.sh --full    # adds step 4
#
# Every request carries the anon key as `apikey`. Without it PostgREST
# answers "No API key found in request", which reads like an empty
# result rather than a refusal — worth stating because it is a silent
# way to write a verification that passes when nothing worked.
#
# get() and rpc() set two globals rather than printing the body, and
# callers must NOT wrap them in $( ). A command substitution runs the
# function in a subshell, so an assignment inside it never reaches the
# caller and every status check silently reads the previous call's
# value. That bug made a correct refusal report itself as a failure.
# ============================================================
set -uo pipefail

cd "$(dirname "$0")/.." || exit 1
set -a; . ./.env.local 2>/dev/null; set +a

URL="${VITE_SUPABASE_URL:?VITE_SUPABASE_URL is not set}"
KEY="${VITE_SUPABASE_ANON_KEY:?VITE_SUPABASE_ANON_KEY is not set}"
REST="$URL/rest/v1"

# The columns src/lib/supabase-catalog.ts actually selects. If a
# `select=*` reappears anywhere, or a column here is wrong, step 1b
# fails loudly instead of a customer's page failing quietly.
APP_COLUMNS="product_id,name,subtitle,slug,sku,description,short_description,product_type,price,sale_price,currency,image_url,cover_colors,rating,reviews_count,tags,metadata,seo_title,seo_description,seo_keywords,status,visibility,availability,inventory,featured,position,created_at,updated_at,archived_at"
APP_EMBEDS="book:books(*),categories:product_categories(category_id),images:product_images(image_url,sort_order),media_links:product_media_links(media_link_id,label,url,platform,sort_order),relations:product_relations!product_relations_source_product_id_fkey(target_product_id,relation_type)"

pass=0; fail=0; skip=0; BODY=""; STATUS=0
ok()      { printf '  \033[32mok\033[0m    %s\n' "$1"; pass=$((pass+1)); }
bad()     { printf '  \033[31mFAIL\033[0m  %s\n' "$1"; fail=$((fail+1)); }
skipped() { printf '  --    %s\n' "$1"; skip=$((skip+1)); }
head_()   { printf '\n\033[1m%s\033[0m\n' "$1"; }

_tmp() { mktemp; }

# get <path> [token]   -> sets BODY and STATUS
get() {
  local out f
  f=$(_tmp)
  if [ -n "${2:-}" ]; then
    curl -s -o "$f" -w '%{http_code}' "$REST/$1" \
      -H "apikey: $KEY" -H "Authorization: Bearer $2" > "$f.code"
  else
    curl -s -o "$f" -w '%{http_code}' "$REST/$1" \
      -H "apikey: $KEY" -H "Authorization: Bearer $KEY" > "$f.code"
  fi
  STATUS=$(cat "$f.code"); rm -f "$f.code"
  BODY=$(cat "$f"); rm -f "$f"
}

# rpc <fn> <json> [token]  -> sets BODY and STATUS
rpc() {
  local out f
  f=$(_tmp)
  if [ -n "${3:-}" ]; then
    curl -s -o "$f" -w '%{http_code}' -X POST "$REST/rpc/$1" \
      -H "apikey: $KEY" -H "Authorization: Bearer $3" \
      -H "Content-Type: application/json" -d "$2" > "$f.code"
  else
    curl -s -o "$f" -w '%{http_code}' -X POST "$REST/rpc/$1" \
      -H "apikey: $KEY" -H "Authorization: Bearer $KEY" \
      -H "Content-Type: application/json" -d "$2" > "$f.code"
  fi
  STATUS=$(cat "$f.code"); rm -f "$f.code"
  BODY=$(cat "$f"); rm -f "$f"
}

# did the database refuse? (grant denial, or a function's own guard)
is_refused() {
  case "$1" in
    *permission\ denied*|*admin_required*|*permission_denied*) return 0 ;;
    *) return 1 ;;
  esac
}
# PGRST202: PostgREST could not find the function at all
is_absent() { case "$1" in *PGRST202*) return 0 ;; *) return 1 ;; esac; }

# ---------------------------------------------------------------- 0
head_ "0. Which migrations are live"
get "products?select=product_id&limit=1"
printf '  storefront read          : HTTP %s\n' "$STATUS"
rpc admin_list_products '{}'
if is_absent "$BODY"; then
  echo "  0024/0025               : NOT applied"
else
  echo "  0024/0025               : applied"
fi
echo

# ---------------------------------------------------------------- 1
head_ "1. Storefront read as anon — the fingerprint"
get "products?select=product_id,slug,name,price,sale_price,status,visibility,availability"
echo "     $BODY"
if [ "$STATUS" != "200" ]; then
  bad "the storefront read returned HTTP $STATUS — /store would be broken"
else
  ok "anon reads the catalogue (HTTP 200)"
fi

get "products?select=product_id,status,visibility"
if [ "$STATUS" = "200" ]; then
  LEAK=$(printf '%s' "$BODY" | tr '{' '\n' | grep '"product_id"' \
         | grep -v '"status":"ACTIVE"' | grep -v '"visibility":"PUBLIC"' || true)
  if [ -n "$LEAK" ]; then
    bad "anon can see a row that is not ACTIVE + PUBLIC:"; echo "     $LEAK"
  else
    ok "every row anon can see is ACTIVE and PUBLIC"
  fi
else
  bad "unfiltered anon read returned HTTP $STATUS"
fi

# ---------------------------------------------------------------- 1b
# The one that actually answers "did the column revoke break the app?".
# A 401 here means the app is asking for a column it no longer has.
head_ "1b. The exact query the storefront issues"
get "products?select=$APP_COLUMNS"
if [ "$STATUS" = "200" ]; then
  ok "all 27 granted columns read together (HTTP 200)"
else
  bad "the app's own column list was refused (HTTP $STATUS): $BODY"
fi

get "products?select=$APP_COLUMNS,$APP_EMBEDS"
if [ "$STATUS" = "200" ]; then
  ok "with all five embeds: book, categories, images, media_links, relations"
else
  bad "the embedded read was refused (HTTP $STATUS): $BODY"
fi

# ---------------------------------------------------------------- 2
head_ "2. Protected columns — must be refused by Postgres, not hidden"
for col in content_url content_asset_id; do
  get "products?select=$col&limit=1"
  if [ "$STATUS" = "200" ]; then
    bad "$col is readable as anon: $BODY"
  elif is_refused "$BODY"; then
    ok "$col refused (HTTP $STATUS, permission denied for table products)"
  else
    bad "$col returned HTTP $STATUS but not a refusal: $BODY"
  fi
done
for col in content_url content_asset_id; do
  if [ -z "${CUSTOMER_TOKEN:-}" ]; then
    skipped "customer read of $col — set CUSTOMER_TOKEN"
    continue
  fi
  get "products?select=$col&limit=1" "$CUSTOMER_TOKEN"
  if [ "$STATUS" = "200" ]; then
    bad "a signed-in CUSTOMER can read $col: $BODY"
  else
    ok "$col refused for a signed-in customer (HTTP $STATUS)"
  fi
done

# ---------------------------------------------------------------- 3
head_ "3. anon must not be able to execute the admin RPCs at all"
# Parameters are named correctly on purpose: PostgREST resolves a
# function before it checks EXECUTE, so `{}` returns PGRST202 and
# proves nothing.
check_anon_rpc() {
  rpc "$1" "$2"
  if is_absent "$BODY"; then
    skipped "$1 not installed yet"
  elif is_refused "$BODY" && [ "$STATUS" != "200" ]; then
    ok "$1 refused by grant (HTTP $STATUS)"
  else
    bad "$1 answered as anon (HTTP $STATUS): $(printf '%s' "$BODY" | head -c 90)"
  fi
}
check_anon_rpc admin_save_product        '{"p_product":{"name":"x","slug":"x"}}'
check_anon_rpc admin_set_product_status  '{"p_product_id":"00000000-0000-0000-0000-000000000000","p_status":"ACTIVE"}'
check_anon_rpc admin_delete_product      '{"p_product_id":"00000000-0000-0000-0000-000000000000"}'
check_anon_rpc admin_move_product        '{"p_product_id":"00000000-0000-0000-0000-000000000000","p_direction":1}'
check_anon_rpc admin_save_category       '{"p_category":{"name":"x","slug":"x"}}'
check_anon_rpc admin_delete_category     '{"p_category_id":"00000000-0000-0000-0000-000000000000"}'
check_anon_rpc admin_grant_access        '{"p_user_id":"00000000-0000-0000-0000-000000000000","p_product_id":"00000000-0000-0000-0000-000000000000"}'
check_anon_rpc admin_set_access_status   '{"p_user_product_id":"00000000-0000-0000-0000-000000000000","p_status":"ACTIVE"}'
check_anon_rpc admin_remove_access       '{"p_user_product_id":"00000000-0000-0000-0000-000000000000"}'
check_anon_rpc admin_list_products       '{}'
check_anon_rpc create_storefront_order   '{"p_product_id":"00000000-0000-0000-0000-000000000000","p_first_name":"a","p_last_name":"b","p_email":"a@b.co"}'

head_ "3b. The permission helpers must not answer anon either"
# Nothing here is writable and no other account is reachable — a customer
# asking admin_has_permission only learns their own role, which is
# already in the bundle — but a predicate that answers anonymous callers
# is not the shape this system is meant to have.
check_anon_rpc admin_role_permissions    '{"p_role":"CONTENT"}'
check_anon_rpc admin_permission_matrix  '{}'
check_anon_rpc admin_has_permission     '{"p_permission":"edit_price"}'
check_anon_rpc admin_require_permission '{"p_permission":"products"}'

# ---------------------------------------------------------------- 4
if [ "${1:-}" = "--full" ]; then
  head_ "4. Role matrix"
  # $SUPER_ADMIN_TOKEN $CONTENT_TOKEN $FINANCE_TOKEN
  # $SUPPORT_TOKEN $MARKETING_TOKEN $CUSTOMER_TOKEN
  #
  # "refused" means the message is admin_required (not staff) or
  # permission_denied: <name> (staff, but the matrix withholds it).
  # "allowed" means the call passed authorisation and was then stopped by
  # the data itself, which is a different message entirely.
  declare -A WANT_SAVE=(   [SUPER_ADMIN]=1 [CONTENT]=1 [FINANCE]=0 [SUPPORT]=0 [MARKETING]=0 [CUSTOMER]=0 )
  declare -A WANT_DELETE=( [SUPER_ADMIN]=1 [CONTENT]=0 [FINANCE]=0 [SUPPORT]=0 [MARKETING]=0 [CUSTOMER]=0 )
  declare -A WANT_LIST=(   [SUPER_ADMIN]=1 [CONTENT]=1 [FINANCE]=0 [SUPPORT]=0 [MARKETING]=0 [CUSTOMER]=0 )

  for role in SUPER_ADMIN CONTENT FINANCE SUPPORT MARKETING CUSTOMER; do
    var="${role}_TOKEN"; tok="${!var:-}"
    if [ -z "$tok" ]; then skipped "$role — set $var"; continue; fi

    rpc admin_save_product '{"p_product":{"name":"perm-probe","slug":"perm-probe","price":1}}' "$tok"
    if is_absent "$BODY"; then skipped "$role save_product — 0024 not applied"; continue; fi
    is_refused "$BODY" && got=0 || got=1
    if [ "$got" = "${WANT_SAVE[$role]}" ]; then
      ok "$role save_product (with price) -> $([ $got = 1 ] && echo allowed || echo refused)"
    else
      bad "$role save_product -> $BODY"
    fi

    rpc admin_delete_product '{"p_product_id":"00000000-0000-0000-0000-000000000000"}' "$tok"
    is_refused "$BODY" && got=0 || got=1
    if [ "$got" = "${WANT_DELETE[$role]}" ]; then
      ok "$role delete_product -> $([ $got = 1 ] && echo allowed || echo refused)"
    else
      bad "$role delete_product -> $BODY"
    fi

    rpc admin_list_products '{}' "$tok"
    is_refused "$BODY" && got=0 || got=1
    if [ "$got" = "${WANT_LIST[$role]}" ]; then
      ok "$role list_products -> $([ $got = 1 ] && echo allowed || echo refused)"
    else
      bad "$role list_products -> $(printf '%s' "$BODY" | head -c 80)"
    fi
  done
fi

# ---------------------------------------------------------------- 5
head_ "5. SQL only the dashboard can run"
cat <<'SQL'
  -- anon / authenticated must not be able to write the catalogue
  SELECT has_table_privilege('anon',         'public.products', 'INSERT') AS anon_insert,
         has_table_privilege('authenticated', 'public.products', 'UPDATE') AS user_update,
         has_table_privilege('authenticated', 'public.products', 'DELETE') AS user_delete;

  -- every policy on the catalogue must be a SELECT; products has exactly one
  SELECT tablename, policyname, cmd, roles::text,
         pg_get_expr(polqual, polrelid) AS using
    FROM pg_policies
   WHERE schemaname = 'public'
     AND tablename IN ('products','books','product_images',
                       'product_media_links','product_relations',
                       'product_categories')
   ORDER BY tablename, policyname;

  -- the matrix, read back, to compare with src/lib/permissions.ts
  SELECT admin_role, string_agg(permission, ',' ORDER BY permission) AS permissions
    FROM public.admin_permission_matrix()
   GROUP BY admin_role ORDER BY admin_role;

  -- nobody but authenticated may execute the admin functions
  SELECT routine_name, grantee, privilege_type
    FROM information_schema.routine_privileges
   WHERE routine_name LIKE 'admin\_%'
      OR routine_name = 'create_storefront_order'
   ORDER BY routine_name, grantee;
SQL

head_ ""
printf 'passed %d, failed %d, skipped %d\n' "$pass" "$fail" "$skip"
[ "$fail" -eq 0 ] || exit 1
