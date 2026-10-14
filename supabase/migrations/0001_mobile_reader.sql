-- ============================================================
-- 0001 — Mobile reader, download-proof content delivery
-- ============================================================
-- Applies on top of schema.sql. Safe to re-run: every statement is
-- either IF NOT EXISTS / IF EXISTS, or drops a constraint by its
-- known auto-generated name before re-adding it.
--
-- WHY THIS MIGRATION EXISTS
--   The site and the React Native reader now serve the same rows from
--   the same database. Auditing schema.sql against what a native
--   client actually needs turned up six gaps, each fixed below:
--
--   A. drm_policies could not express "no download". block_print and
--      block_copy are browser deterrents; a native app can also refuse
--      to export the file at all, allow or refuse an offline copy, and
--      refuse to run on a rooted device. None of that was storable.
--   B. security_events could not record a blocked download, a blocked
--      share, a detected mirror, a compromised device or a replayed
--      content token — the CHECK list predated the mobile client.
--   C. device_sessions threw away the revocation reason (it reached the
--      audit log but not the row), and stored no client build, OS
--      version or integrity verdict, so support could not tell an
--      Android 9 phone from an iOS 18 tablet or see which app version
--      a leaked capture came from.
--   D. products.content_url is a permanent, guessable URL. It was also
--      selected by v_storefront_catalog, i.e. handed to any anonymous
--      catalogue read. A reader that cannot download a PDF must not be
--      able to read its address either, so content delivery moves to
--      short-lived, single-use, entitlement-bound grants (G) and the
--      public view stops exposing the file (H).
--   E. inquiries.source and crm_leads.source had no value for a ticket
--      opened from the app, so mobile support requests had to lie and
--      claim WEBSITE.
--   F. platform_settings had no way to switch the mobile client off or
--      force an upgrade, which a shared deployment needs the moment the
--      API changes shape under an old build.
-- ============================================================

BEGIN;

-- ============================================================
-- A. DRM POLICY — download, offline and device integrity
-- ============================================================
-- block_download is the one the native reader actually enforces: it
-- covers saving, exporting, the share sheet and any "open in another
-- app" path, because all of them are the same act — handing the bytes
-- to something the platform no longer controls. It defaults to TRUE so
-- an existing installation becomes stricter, not looser, and so a
-- policy row created before this migration cannot silently permit
-- exports.
--
-- allow_offline defaults to FALSE. An offline copy is a file that
-- survives the session, so it is opt-in per policy and always bounded
-- by offline_ttl_hours; when the TTL passes the client must delete the
-- cache and re-request a grant.
--
-- block_rooted_devices defaults to TRUE: on a rooted or jailbroken
-- device FLAG_SECURE and the sandbox are both advisory, so the honest
-- options are to refuse the content or to pretend the protection is
-- still standing.
ALTER TABLE drm_policies
  ADD COLUMN IF NOT EXISTS block_download         BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS allow_offline          BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS offline_ttl_hours      INTEGER CHECK (offline_ttl_hours IS NULL
                                                                 OR (offline_ttl_hours > 0
                                                                     AND offline_ttl_hours <= 720)),
  ADD COLUMN IF NOT EXISTS block_rooted_devices   BOOLEAN NOT NULL DEFAULT TRUE;

-- An offline copy with no TTL is a permanent download wearing a
-- costume. COALESCE matters: a CHECK passes on NULL, so without it an
-- offline policy with no expiry would satisfy the constraint.
ALTER TABLE drm_policies DROP CONSTRAINT IF EXISTS chk_drm_offline_needs_ttl;
ALTER TABLE drm_policies
  ADD CONSTRAINT chk_drm_offline_needs_ttl
  CHECK (NOT allow_offline OR COALESCE(offline_ttl_hours, 0) > 0);

-- The seeded baseline row gains the new defaults through the column
-- DEFAULTs above; stating them again keeps the intent readable when the
-- policy is inspected.
UPDATE drm_policies
   SET block_download       = TRUE,
       allow_offline        = FALSE,
       block_rooted_devices = TRUE
 WHERE policy_name = 'מדיניות ברירת מחדל';

-- ============================================================
-- B. SECURITY EVENTS — the mobile vocabulary
-- ============================================================
-- A CHECK list cannot be extended in place, so it is replaced. Existing
-- rows keep their values: every new member is additive.
ALTER TABLE security_events DROP CONSTRAINT IF EXISTS security_events_event_type_check;
ALTER TABLE security_events
  ADD CONSTRAINT security_events_event_type_check
  CHECK (event_type IN (
    -- Browser deterrents (web reader)
    'SCREENSHOT_BLOCKED','RECORDING_DETECTED','COPY_BLOCKED',
    'PRINT_BLOCKED','CONTEXT_MENU_BLOCKED','SOURCE_VIEW_BLOCKED',
    'VISIBILITY_HIDDEN',
    -- Session and device administration (both clients)
    'SESSION_REVOKED','DEVICE_LIMIT_EXCEEDED',
    -- Native reader
    'DOWNLOAD_BLOCKED',      -- save / export / "open in" refused
    'SHARE_BLOCKED',         -- share sheet refused for protected content
    'MIRROR_DETECTED',       -- AirPlay, Chromecast or a wired display
    'DEVICE_COMPROMISED',    -- root / jailbreak / emulator detected
    'GRANT_REPLAY_BLOCKED',  -- a single-use content token reused
    'OFFLINE_EXPIRED'        -- cached copy destroyed because its TTL passed
  ));

CREATE INDEX IF NOT EXISTS idx_security_events_session
  ON security_events (session_id, created_at DESC);

-- ============================================================
-- C. DEVICE SESSIONS — attribution and client identity
-- ============================================================
ALTER TABLE device_sessions
  ADD COLUMN IF NOT EXISTS revoked_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS revoked_by      UUID REFERENCES users (user_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS revoke_reason   TEXT,
  ADD COLUMN IF NOT EXISTS device_model    VARCHAR(120),
  ADD COLUMN IF NOT EXISTS os_version      VARCHAR(60),
  ADD COLUMN IF NOT EXISTS app_version     VARCHAR(40),
  ADD COLUMN IF NOT EXISTS device_integrity VARCHAR(20) NOT NULL DEFAULT 'UNKNOWN'
    CHECK (device_integrity IN
      ('UNKNOWN','TRUSTED','ROOTED','JAILBROKEN','ATTESTATION_FAILED','EMULATOR'));

-- Mirrors chk_user_product_revocation: a row may not claim to be
-- revoked without saying when and by whom. The web service layer was
-- setting `revoked = TRUE` and dropping the reason on the floor, so the
-- reason is now stored where the session is.
ALTER TABLE device_sessions DROP CONSTRAINT IF EXISTS chk_device_session_revocation;
ALTER TABLE device_sessions
  ADD CONSTRAINT chk_device_session_revocation
  CHECK (revoked = FALSE OR (revoked_at IS NOT NULL AND revoked_by IS NOT NULL));

-- Idle sessions have to be swept by a job, and a customer listing their
-- own devices sorts by recency; both want an index that is not the
-- (user_id, revoked) pair.
CREATE INDEX IF NOT EXISTS idx_device_sessions_last_seen
  ON device_sessions (last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_device_sessions_platform
  ON device_sessions (platform) WHERE ended_at IS NULL AND NOT revoked;

-- ============================================================
-- D. AUTH SESSIONS — which client holds the token
-- ============================================================
-- Both apps authenticate against the same sessions table. Without a
-- client column a stolen-token report cannot say whether the web or the
-- phone was involved, and "sign out everywhere except this device" has
-- nothing to filter on.
ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS client      VARCHAR(20) NOT NULL DEFAULT 'WEB'
    CHECK (client IN ('WEB','ANDROID','IOS')),
  ADD COLUMN IF NOT EXISTS app_version VARCHAR(40),
  ADD COLUMN IF NOT EXISTS revoked_at  TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_sessions_client ON sessions (user_id, client);

-- ============================================================
-- E. SUPPORT & CRM SOURCES — tickets opened from the app
-- ============================================================
ALTER TABLE inquiries DROP CONSTRAINT IF EXISTS inquiries_source_check;
ALTER TABLE inquiries
  ADD CONSTRAINT inquiries_source_check
  CHECK (source IN ('WEBSITE','CMS','EMAIL','MOBILE_APP'));

ALTER TABLE crm_leads DROP CONSTRAINT IF EXISTS crm_leads_source_check;
ALTER TABLE crm_leads
  ADD CONSTRAINT crm_leads_source_check
  CHECK (source IN ('LANDING_PAGE','STORE','REFERRAL','CAMPAIGN','MANUAL','MOBILE_APP'));

-- ============================================================
-- F. PLATFORM SETTINGS — mobile kill switch and minimum build
-- ============================================================
-- mobile_app_enabled FALSE makes the API refuse mobile logins, which is
-- how a broken build is taken out of service without a store release.
-- mobile_min_build is compared against the build number the client
-- sends; anything older is told to upgrade before it can read, so a
-- schema or policy change never has to support an app version that
-- predates it.
ALTER TABLE platform_settings
  ADD COLUMN IF NOT EXISTS mobile_app_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS mobile_min_build   INTEGER NOT NULL DEFAULT 0
    CHECK (mobile_min_build >= 0);

-- ============================================================
-- G. CONTENT ACCESS GRANTS — the download-proof delivery path
-- ============================================================
-- The rule both clients obey: nobody ever receives the address of a
-- protected file. They receive a grant, minted for one signed-in
-- account, one entitled product, one device session, with an expiry and
-- a use budget. The API resolves the grant to the asset only after
-- re-checking the entitlement, so revoking access in the CMS also kills
-- every URL already handed out.
--
-- Only token_hash is stored — never the token. A leaked database
-- therefore cannot be replayed into content, exactly as with
-- password_reset_tokens.
--
-- watermark_text is frozen at mint time. The stamp on a leaked page
-- must keep naming the account it was issued to even after that account
-- is renamed or deleted, which a join to users could not guarantee.
--
-- scope separates the two things a reader may do with a grant:
--   STREAM       — short-lived, multi-use inside one session, for the
--                  page the client is displaying right now.
--   OFFLINE_CACHE — single-use, only issued when the policy allows
--                  offline reading; the client stores the bytes in its
--                  private vault and must destroy them at expires_at.
CREATE TABLE IF NOT EXISTS content_access_grants (
  grant_id        UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID          NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
  user_product_id UUID          NOT NULL REFERENCES user_products (user_product_id) ON DELETE CASCADE,
  product_id      UUID          NOT NULL REFERENCES products (product_id) ON DELETE RESTRICT,
  session_id      UUID          REFERENCES device_sessions (session_id) ON DELETE SET NULL,
  asset_id        UUID          REFERENCES content_assets (asset_id) ON DELETE SET NULL,
  platform        VARCHAR(20)   NOT NULL DEFAULT 'WEB'
                  CHECK (platform IN ('WEB','ANDROID','IOS')),
  scope           VARCHAR(20)   NOT NULL DEFAULT 'STREAM'
                  CHECK (scope IN ('STREAM','OFFLINE_CACHE')),
  token_hash      VARCHAR(255)  NOT NULL,
  watermark_text  VARCHAR(200),
  checksum        VARCHAR(64),
  file_size_bytes BIGINT        CHECK (file_size_bytes IS NULL OR file_size_bytes >= 0),
  max_uses        INTEGER       NOT NULL DEFAULT 1 CHECK (max_uses > 0),
  use_count       INTEGER       NOT NULL DEFAULT 0 CHECK (use_count >= 0 AND use_count <= max_uses),
  expires_at      TIMESTAMPTZ   NOT NULL,
  first_used_at   TIMESTAMPTZ,
  last_used_at    TIMESTAMPTZ,
  revoked_at      TIMESTAMPTZ,
  revoked_by      UUID          REFERENCES users (user_id) ON DELETE SET NULL,
  revoke_reason   TEXT,
  client_ip       INET,
  user_agent      TEXT,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_grant_token_unique UNIQUE (token_hash),
  -- An offline cache is a download by another name: one transfer, no
  -- retries, so a single file cannot be pulled down twice.
  CONSTRAINT chk_grant_offline_single_use
    CHECK (scope <> 'OFFLINE_CACHE' OR max_uses = 1),
  CONSTRAINT chk_grant_revocation
    CHECK (revoked_at IS NULL OR revoked_by IS NOT NULL),
  CONSTRAINT chk_grant_bound_to_session
    CHECK (session_id IS NOT NULL OR scope = 'STREAM')
);

CREATE INDEX IF NOT EXISTS idx_content_grants_user_product
  ON content_access_grants (user_id, product_id);
CREATE INDEX IF NOT EXISTS idx_content_grants_expiry
  ON content_access_grants (expires_at)
  WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_content_grants_session
  ON content_access_grants (session_id) WHERE session_id IS NOT NULL;

-- ------------------------------------------------------------
-- Atomic redemption.
--
-- A single-use token checked with SELECT-then-UPDATE from application
-- code is a race: two concurrent readers both pass the check and both
-- receive the file. This function takes the row lock, re-verifies the
-- entitlement (which may have been revoked or expired since the grant
-- was minted), and consumes one use in the same statement.
--
-- It raises rather than returning NULL on rejection, so a caller cannot
-- forget to check the outcome, and carries the token only as its digest.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION consume_content_grant(p_token_hash TEXT)
RETURNS TABLE (
  out_grant_id    UUID,
  out_user_id     UUID,
  out_product_id  UUID,
  out_asset_id    UUID,
  out_scope       VARCHAR,
  out_watermark   VARCHAR,
  out_checksum    VARCHAR,
  out_storage_key VARCHAR
)
LANGUAGE plpgsql AS $$
DECLARE
  g            content_access_grants;
  entitlement  user_products;
BEGIN
  SELECT * INTO g
  FROM content_access_grants
  WHERE token_hash = p_token_hash
  FOR UPDATE;

  IF g.grant_id IS NULL THEN
    RAISE EXCEPTION 'content grant rejected: unknown token'
      USING ERRCODE = '42501';
  END IF;
  IF g.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'content grant rejected: revoked'
      USING ERRCODE = '42501';
  END IF;
  IF g.expires_at <= NOW() THEN
    RAISE EXCEPTION 'content grant rejected: expired'
      USING ERRCODE = '42501';
  END IF;
  IF g.use_count >= g.max_uses THEN
    RAISE EXCEPTION 'content grant rejected: already redeemed'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO entitlement
  FROM user_products
  WHERE user_product_id = g.user_product_id;

  IF entitlement.user_product_id IS NULL
     OR entitlement.access_status <> 'ACTIVE'
     OR (entitlement.expires_at IS NOT NULL AND entitlement.expires_at <= NOW()) THEN
    RAISE EXCEPTION 'content grant rejected: entitlement no longer active'
      USING ERRCODE = '42501';
  END IF;

  UPDATE content_access_grants
     SET use_count     = use_count + 1,
         first_used_at = COALESCE(first_used_at, NOW()),
         last_used_at  = NOW()
   WHERE grant_id = g.grant_id;

  out_grant_id   := g.grant_id;
  out_user_id    := g.user_id;
  out_product_id := g.product_id;
  out_asset_id   := g.asset_id;
  out_scope      := g.scope;
  out_watermark  := g.watermark_text;
  out_checksum   := g.checksum;

  SELECT ca.storage_key INTO out_storage_key
  FROM content_assets ca
  WHERE ca.asset_id = g.asset_id;

  RETURN NEXT;
END;
$$;

-- ------------------------------------------------------------
-- Cascading revocation.
--
-- Minting a grant is only half the promise. The other half is that
-- cutting a device off, or revoking an entitlement in the CMS, also
-- kills every URL already handed out — otherwise a revoked phone keeps
-- a live address to the file until the grant expires on its own, and
-- "revoke access" quietly means "revoke future access".
--
-- Enforced here rather than in application code because two clients
-- write to these rows and only one of them is ours.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION revoke_grants_for_device_session()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  UPDATE content_access_grants
     SET revoked_at    = NOW(),
         revoke_reason = 'ההתקשרות ממכשיר זה נחסמה'
   WHERE session_id = NEW.session_id
     AND revoked_at IS NULL;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_device_session_revokes_grants ON device_sessions;
CREATE TRIGGER trg_device_session_revokes_grants
  AFTER UPDATE OF revoked ON device_sessions
  FOR EACH ROW WHEN (NEW.revoked AND NOT OLD.revoked)
  EXECUTE FUNCTION revoke_grants_for_device_session();

CREATE OR REPLACE FUNCTION revoke_grants_for_entitlement()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  -- Still entitled: nothing to undo. Only a loss of access cascades.
  IF NEW.access_status = 'ACTIVE'
     AND (NEW.expires_at IS NULL OR NEW.expires_at > NOW()) THEN
    RETURN NEW;
  END IF;

  UPDATE content_access_grants
     SET revoked_at    = NOW(),
         revoke_reason = 'הגישה לתוכן זה בוטלה'
   WHERE user_product_id = NEW.user_product_id
     AND revoked_at IS NULL;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_user_product_revokes_grants ON user_products;
CREATE TRIGGER trg_user_product_revokes_grants
  AFTER UPDATE OF access_status, expires_at ON user_products
  FOR EACH ROW
  WHEN (NEW.access_status IS DISTINCT FROM OLD.access_status
        OR NEW.expires_at IS DISTINCT FROM OLD.expires_at)
  EXECUTE FUNCTION revoke_grants_for_entitlement();

-- ============================================================
-- H. VIEWS — the public catalogue stops naming the file
-- ============================================================
-- v_storefront_catalog is what an anonymous visitor reads. It selected
-- products.content_url and content_assets.public_url, i.e. the direct
-- address of every protected PDF, with no entitlement check anywhere on
-- the path. Both columns are removed. Display metadata (page count,
-- file size) stays, because it is what a product card shows.
--
-- Content addresses are now reachable only through v_entitled_content,
-- which is scoped to one user and read by the grant-minting endpoint —
-- never served to a client as-is.
CREATE OR REPLACE VIEW v_storefront_catalog AS
SELECT
  p.product_id,
  p.name,
  p.slug,
  p.sku,
  p.subtitle,
  p.short_description,
  p.description,
  p.product_type,
  p.price,
  p.sale_price,
  p.currency,
  p.cover_colors,
  p.tags,
  p.status,
  p.visibility,
  p.availability,
  p.inventory,
  p.featured,
  p.position,
  p.rating,
  p.reviews_count,
  p.seo_title,
  p.seo_description,
  p.seo_keywords,
  b.author_name,
  b.isbn,
  b.publisher,
  b.language,
  b.publication_date,
  b.total_pages,
  ca.file_size_bytes AS content_size_bytes,
  ca.total_pages     AS content_pages,
  p.image_url        AS cover_image_url,
  COALESCE(gal.image_urls, '{}')      AS gallery_image_urls,
  COALESCE(cats.category_ids, '{}')   AS category_ids,
  COALESCE(cats.category_names, '{}') AS category_names
FROM products p
LEFT JOIN books b           ON b.product_id = p.product_id
LEFT JOIN content_assets ca ON ca.asset_id  = p.content_asset_id
LEFT JOIN LATERAL (
  SELECT array_agg(COALESCE(pi.image_url, a.public_url) ORDER BY pi.sort_order) AS image_urls
  FROM product_images pi
  LEFT JOIN content_assets a ON a.asset_id = pi.asset_id
  WHERE pi.product_id = p.product_id
) gal ON TRUE
LEFT JOIN LATERAL (
  SELECT array_agg(pc.category_id ORDER BY c.display_order)  AS category_ids,
         array_agg(c.name         ORDER BY c.display_order) AS category_names
  FROM product_categories pc
  JOIN categories c ON c.category_id = pc.category_id
  WHERE pc.product_id = p.product_id
) cats ON TRUE
WHERE p.status = 'ACTIVE'
  AND p.visibility = 'PUBLIC';

-- One row per live entitlement, with everything needed to mint a grant:
-- where the bytes are, how big they are, their digest and how many pages
-- the reader should expect. The live product wins while it exists and
-- the purchase-time snapshot is the fallback, so archiving a title never
-- locks a paying customer out of it.
CREATE OR REPLACE VIEW v_entitled_content AS
SELECT
  up.user_id,
  up.user_product_id,
  up.product_id,
  up.access_status,
  up.granted_at,
  up.expires_at,
  up.source_order_id,
  COALESCE(p.name, up.product_snapshot ->> 'name') AS product_name,
  COALESCE(p.slug, up.product_snapshot ->> 'slug') AS product_slug,
  p.product_type,
  p.content_url,
  ca.asset_id,
  ca.storage_key,
  ca.public_url,
  ca.file_name,
  ca.mime_type,
  ca.file_size_bytes,
  ca.checksum,
  COALESCE(ca.total_pages, b.total_pages) AS total_pages
FROM user_products up
LEFT JOIN products p        ON p.product_id = up.product_id
LEFT JOIN content_assets ca ON ca.asset_id  = p.content_asset_id
LEFT JOIN books b           ON b.product_id = p.product_id
WHERE up.access_status = 'ACTIVE'
  AND (up.expires_at IS NULL OR up.expires_at > NOW());

-- Live grants per account and product, for the "download again?" check
-- and for the admin panel's content-access view.
CREATE OR REPLACE VIEW v_active_content_grants AS
SELECT
  g.grant_id,
  g.user_id,
  u.first_name || ' ' || u.last_name AS user_name,
  g.product_id,
  COALESCE(p.name, g.watermark_text)  AS product_name,
  g.session_id,
  ds.platform,
  ds.device_name,
  g.scope,
  g.max_uses,
  g.use_count,
  g.expires_at,
  g.created_at,
  g.revoked_at
FROM content_access_grants g
JOIN users u            ON u.user_id = g.user_id
LEFT JOIN products p    ON p.product_id = g.product_id
LEFT JOIN device_sessions ds ON ds.session_id = g.session_id
WHERE g.revoked_at IS NULL AND g.expires_at > NOW();

-- ============================================================
-- I. HOUSEKEEPING
-- ============================================================
-- Closes device sessions that idled past the governing policy and drops
-- grants that expired, in one statement a scheduled job can call. It
-- returns the number of sessions it closed so the job can log it.
--
-- Idleness is measured against the policy that applies to the session's
-- own platform, which is why the policy is resolved per row instead of
-- being passed in: a MOBILE policy and a WEB policy may disagree, and
-- sweeping both with one number would cut somebody's reading short.
CREATE OR REPLACE FUNCTION sweep_expired_reader_sessions()
RETURNS INTEGER
LANGUAGE plpgsql AS $$
DECLARE
  closed INTEGER;
BEGIN
  WITH policy AS (
    SELECT
      COALESCE(
        (SELECT d.session_timeout_minutes FROM drm_policies d
          WHERE d.active AND d.applies_to = 'MOBILE'
          ORDER BY d.updated_at DESC LIMIT 1),
        (SELECT d.session_timeout_minutes FROM drm_policies d
          WHERE d.active AND d.applies_to = 'ALL'
          ORDER BY d.updated_at DESC LIMIT 1),
        (SELECT d.session_timeout_minutes FROM drm_policies d
          WHERE d.active
          ORDER BY d.updated_at DESC LIMIT 1),
        120
      ) AS idle_minutes
  ),
  swept AS (
    UPDATE device_sessions ds
       SET ended_at = NOW(),
           secure_flag_active = FALSE
      FROM policy
      WHERE ds.ended_at IS NULL
        AND ds.revoked = FALSE
        AND ds.last_seen_at < NOW() - (policy.idle_minutes || ' minutes')::INTERVAL
    RETURNING ds.session_id
  )
  SELECT COUNT(*) INTO closed FROM swept;

  -- Grants are bounded by their own expires_at, so revoking the ones
  -- that lapsed keeps v_active_content_grants honest without a job that
  -- has to understand each policy.
  UPDATE content_access_grants
     SET revoked_at = COALESCE(revoked_at, NOW())
   WHERE revoked_at IS NULL AND expires_at <= NOW();

  RETURN closed;
END;
$$;

COMMIT;

-- ============================================================
-- VERIFICATION — run after applying
-- ============================================================
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'drm_policies'
--      AND column_name IN ('block_download','allow_offline',
--                          'offline_ttl_hours','block_rooted_devices');
--   → 4 rows
--
--   SELECT COUNT(*) FROM content_access_grants;  → 0 (no grants yet)
--
--   SELECT conname FROM pg_constraint
--    WHERE conrelid = 'security_events'::regclass AND contype = 'c';
--   → security_events_event_type_check
--
--   Confirm the leak is closed — this must return no rows:
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'v_storefront_catalog'
--      AND column_name IN ('content_url','content_public_url');
-- ============================================================
