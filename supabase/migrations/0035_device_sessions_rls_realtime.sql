-- ============================================================
-- 0035 - Device sessions: RLS, server-authoritative claiming, realtime
--
-- WHY
--
-- `public.device_sessions` was the one table the product's most visible
-- promise rests on - "reading is limited to N devices" - while the browser
-- never wrote to it. Every claim, release and block happened inside one
-- browser's localStorage, so a reader on a phone and the same reader on a
-- laptop held two independent, mutually invisible sets of slots. Three
-- consequences followed, and none of them were fixable in the client:
--
--   • The administrator's device table could not show a customer's phone.
--     There was nothing to read.
--   • The device cap was a per-browser suggestion. Two devices racing could
--     each believe they held the last slot.
--   • A block pressed in /admin/security reached nobody, because the reader
--     it was aimed at never consults a server.
--
-- This migration makes the server the authority and the browser a mirror:
--
--   • RLS on device_sessions: a reader sees their own rows, staff with the
--     `security` permission see all. No direct INSERT/UPDATE/DELETE for any
--     browser role - the four RPCs below are the only write paths, so
--     identity (user_id) and attribution (revoked_by) are stamped from the
--     JWT and cannot be supplied by a caller.
--   • The limit is resolved and enforced inside claim_my_device_session,
--     against the policy the server holds, after closing rows whose device
--     has not reported in. That ordering is the difference between "two
--     devices reading" and "two devices ever used", which is what the
--     reader was actually being blocked by.
--   • The table joins supabase_realtime, so a claim on an iPhone and a
--     disconnect on a desktop reach the other screen within seconds.
--   • max_devices_per_user becomes 2: the column default for rows nobody has
--     created yet, and every policy currently active.
--
-- NOTE ON `is_admin()`
--
-- Migrations 0018 and 0022 describe their staff policies as using
-- `is_admin()`. No such function exists in this database. The live staff
-- predicate is public.admin_has_permission(text) (0024), which also checks
-- account_status = 'ACTIVE'; this migration uses it, scoped to the
-- `security` permission rather than a blanket admin, because the table
-- carries device fingerprints and revocation reasons.
--
-- APPLY, THEN VERIFY
--
--    SELECT policyname, cmd, roles FROM pg_policies
--     WHERE schemaname = 'public' AND tablename = 'device_sessions'
--     ORDER BY policyname;
--     → device_sessions_select_own   | SELECT | {authenticated}
--       device_sessions_select_staff | SELECT | {authenticated}
--    and no INSERT/UPDATE/DELETE row at all.
--
--    SELECT pubname, schemaname, tablename
--      FROM pg_publication_tables
--     WHERE tablename = 'device_sessions';
--    Expect one row: supabase_realtime | public | device_sessions.
--
--    SELECT max_devices_per_user, active FROM public.drm_policies;
--    Every active row must now read 2.
--
--    As an authenticated customer, a direct write must be refused:
--
--      SET ROLE authenticated;
--      SET request.jwt.claims = '{"sub":"<user uuid>","role":"authenticated"}';
--      INSERT INTO public.device_sessions (user_id, device_fingerprint)
--        VALUES ('<user uuid>', 'x');
--      -- ERROR: new row violates row-level security policy
--      -- (there is no INSERT policy; only claim_my_device_session writes).
--      RESET ROLE;
--
--    The customer write path, which must work:
--
--      SELECT * FROM public.claim_my_device_session('fp-test', 'WEB', 'Test');
-- ============================================================

BEGIN;

-- ── 1. Row Level Security ───────────────────────────────────

ALTER TABLE public.device_sessions ENABLE ROW LEVEL SECURITY;

-- A reader sees their own devices. This is also what scopes the realtime
-- stream: an event is only delivered to a subscriber who could SELECT the
-- row.
DROP POLICY IF EXISTS device_sessions_select_own ON public.device_sessions;
CREATE POLICY device_sessions_select_own ON public.device_sessions
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- Staff who administer protection see every account. Deliberately the
-- `security` permission and not a blanket admin: this table pairs a person
-- with a stable device identifier and records who blocked what and why.
DROP POLICY IF EXISTS device_sessions_select_staff ON public.device_sessions;
CREATE POLICY device_sessions_select_staff ON public.device_sessions
  FOR SELECT TO authenticated
  USING (public.admin_has_permission('security'));

-- No INSERT, UPDATE or DELETE policy for any role. Every browser write goes
-- through the RPCs below, which stamp user_id and revoked_by from the JWT.
--
-- The table previously had RLS disabled, so anon connections could read
-- every device row in the store. They lose direct access entirely here;
-- nothing in the product had a legitimate use for it.
REVOKE ALL ON public.device_sessions FROM anon;

-- ── 2. Two devices, per account ────────────────────────────
--
-- A data change, not only a default: the requirement is a hard limit of two,
-- and the limit lives in this table rather than in code. Readers holding more
-- than two slots are not cut off by this statement - the RPC refuses the
-- *next* claim once the count of live rows reaches the limit, so an account
-- that is over the line settles back to two as its extra devices idle out.

ALTER TABLE public.drm_policies
  ALTER COLUMN max_devices_per_user SET DEFAULT 2;

UPDATE public.drm_policies
   SET max_devices_per_user = 2
 WHERE active
   AND max_devices_per_user IS DISTINCT FROM 2;

-- ── 3. Policy resolution ──────────────────────────────────
--
-- Same precedence the client's resolveDrmPolicy() uses - an active policy
-- scoped to this exact client, then one scoped to ALL, then any active
-- policy - so the number the browser displays and the number the server
-- enforces are the same number. Most-specific-first is expressed as a
-- boolean sort key; `updated_at` breaks a tie the way the sweeper does.

CREATE OR REPLACE FUNCTION public.device_limit(p_platform text)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(
    (
      SELECT d.max_devices_per_user
        FROM public.drm_policies d
       WHERE d.active
       ORDER BY (d.applies_to = p_platform) DESC,
                (d.applies_to = 'ALL') DESC,
                d.updated_at DESC
       LIMIT 1
    ),
    2
  );
$$;

CREATE OR REPLACE FUNCTION public.device_idle_minutes(p_platform text)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(
    (
      SELECT d.session_timeout_minutes
        FROM public.drm_policies d
       WHERE d.active
       ORDER BY (d.applies_to = p_platform) DESC,
                (d.applies_to = 'ALL') DESC,
                d.updated_at DESC
       LIMIT 1
    ),
    120
  );
$$;

REVOKE ALL ON FUNCTION public.device_limit(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.device_idle_minutes(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.device_limit(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.device_idle_minutes(text) TO authenticated;

-- ── 4. claim_my_device_session() ──────────────────────────
--
-- The only way a browser can put a device into this table. Identity is
-- never an argument: user_id comes from the JWT, so a crafted request cannot
-- claim a slot on someone else's account or spend someone else's limit.
--
-- Returns the existing live row untouched when this device already holds a
-- slot. That is not a convenience - the caller runs it from a mount effect,
-- and a write on every mount would notify every subscriber and re-trigger
-- the effect that issued it.

CREATE OR REPLACE FUNCTION public.claim_my_device_session(
  p_device_fingerprint text,
  p_platform           text DEFAULT 'WEB',
  p_device_name        text DEFAULT NULL,
  p_device_model       text DEFAULT NULL,
  p_os_version         text DEFAULT NULL,
  p_app_version        text DEFAULT NULL
)
RETURNS public.device_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid      uuid := auth.uid();
  v_fp       text := left(btrim(COALESCE(p_device_fingerprint, '')), 256);
  -- An unknown client is treated as the web, which is the stricter default:
  -- it resolves the policy the storefront enforces rather than a mobile one.
  v_platform text := CASE
                       WHEN p_platform IN ('WEB','ANDROID','IOS') THEN p_platform
                       ELSE 'WEB'
                     END;
  -- Declarations are evaluated in order, so these read the normalised
  -- platform above rather than the raw argument.
  v_limit    integer := public.device_limit(v_platform);
  v_idle     integer := public.device_idle_minutes(v_platform);
  v_existing public.device_sessions;
  v_open     integer;
  v_row      public.device_sessions;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;

  IF v_fp = '' THEN
    RAISE EXCEPTION 'validation_fingerprint';
  END IF;

  -- Free the places that are not really taken. A row whose device stopped
  -- reporting is not a device reading, and counting it is what locked a
  -- paying reader out of a book they own. This is the same rule the
  -- application applies through occupiesSlot(), and the same one
  -- sweep_expired_reader_sessions() applies on a schedule - doing it here
  -- means the reader is never refused by a row nobody released.
  UPDATE public.device_sessions
     SET ended_at           = NOW(),
         secure_flag_active = FALSE
   WHERE user_id      = v_uid
     AND ended_at IS NULL
     AND revoked = FALSE
     AND last_seen_at < NOW() - make_interval(mins => v_idle);

  SELECT * INTO v_existing
    FROM public.device_sessions
   WHERE user_id            = v_uid
     AND device_fingerprint = v_fp
     AND ended_at IS NULL
     AND revoked = FALSE;

  IF FOUND THEN
    RETURN v_existing;
  END IF;

  SELECT count(*) INTO v_open
    FROM public.device_sessions
   WHERE user_id = v_uid
     AND ended_at IS NULL
     AND revoked = FALSE;

  IF v_open >= v_limit THEN
    -- Recorded server-side as well as in the browser, because the attempt
    -- that matters is the one the server refused.
    INSERT INTO public.security_events (user_id, event_type, platform, metadata)
    VALUES (
      v_uid,
      'DEVICE_LIMIT_EXCEEDED',
      v_platform,
      jsonb_build_object(
        'open_sessions', v_open,
        'limit',         v_limit,
        'source',        'server'
      )
    );

    RAISE EXCEPTION 'device_limit_exceeded';
  END IF;

  INSERT INTO public.device_sessions (
    user_id,
    device_fingerprint,
    platform,
    device_name,
    device_model,
    os_version,
    app_version,
    device_integrity,
    secure_flag_active,
    started_at,
    last_seen_at,
    revoked
  ) VALUES (
    v_uid,
    v_fp,
    v_platform,
    left(NULLIF(btrim(COALESCE(p_device_name,  '')), ''), 160),
    left(NULLIF(btrim(COALESCE(p_device_model,  '')), ''), 120),
    left(NULLIF(btrim(COALESCE(p_os_version,    '')), ''),  60),
    left(NULLIF(btrim(COALESCE(p_app_version,   '')), ''),  40),
    -- A browser has no integrity verdict to give. Native clients report one
    -- here, which is where block_rooted_devices has something to decide on.
    'UNKNOWN',
    TRUE,
    NOW(),
    NOW(),
    FALSE
  )
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

-- ── 5. touch_my_device_session() ──────────────────────────
--
-- The heartbeat. Moves last_seen_at and nothing else, so a device cannot
-- rewrite its own started_at or bring a blocked row back to life.

CREATE OR REPLACE FUNCTION public.touch_my_device_session(p_session_id uuid)
RETURNS public.device_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.device_sessions;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;

  UPDATE public.device_sessions
     SET last_seen_at = NOW()
   WHERE session_id    = p_session_id
     AND user_id       = v_uid
     AND revoked = FALSE
     AND ended_at IS NULL
  RETURNING * INTO v_row;

  IF FOUND THEN
    RETURN v_row;
  END IF;

  -- Named apart, because the reader's screen has to say something different
  -- for "an administrator stopped you" than for "this slot is closed".
  IF EXISTS (
    SELECT 1 FROM public.device_sessions
     WHERE session_id = p_session_id AND user_id = v_uid AND revoked
  ) THEN
    RAISE EXCEPTION 'session_revoked';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.device_sessions
     WHERE session_id = p_session_id AND user_id = v_uid AND ended_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'session_ended';
  END IF;

  RAISE EXCEPTION 'session_not_found';
END;
$$;

-- ── 6. end_my_device_session() ────────────────────────────
--
-- Self-service release. A reader must be able to free a slot they are not
-- using, or the only exit from a full limit is a support ticket. Revoked
-- rows are refused: a block is lifted by an administrator, not by the
-- account it was applied to.

CREATE OR REPLACE FUNCTION public.end_my_device_session(p_session_id uuid)
RETURNS public.device_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.device_sessions;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;

  UPDATE public.device_sessions
     SET ended_at = NOW()
   WHERE session_id = p_session_id
     AND user_id    = v_uid
     AND revoked = FALSE
     AND ended_at IS NULL
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'session_not_open';
  END IF;

  RETURN v_row;
END;
$$;

-- ── 7. admin_revoke_device_session() ──────────────────────
--
-- Staff block, with the reason that goes to the audit trail. The
-- content-grant cascade is NOT repeated here:
-- trg_device_session_revokes_grants already fires on
-- `UPDATE OF revoked` when a row flips to revoked, so writing the cascade a
-- second time in SQL would be a second, divergent implementation of one
-- rule.
--
-- This is the most destructive function in the file. A revoked session
-- takes its reader's open copies with it, which is why it requires the
-- manage_drm permission and refuses to touch a row that is already closed.

CREATE OR REPLACE FUNCTION public.admin_revoke_device_session(
  p_session_id uuid,
  p_reason     text DEFAULT NULL
)
RETURNS public.device_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.device_sessions;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;

  PERFORM public.admin_require_permission('manage_drm');

  UPDATE public.device_sessions
     SET revoked            = TRUE,
         ended_at           = COALESCE(ended_at, NOW()),
         secure_flag_active = FALSE,
         revoked_at         = NOW(),
         revoked_by         = v_uid,
         revoke_reason      = NULLIF(btrim(COALESCE(p_reason, '')), '')
   WHERE session_id = p_session_id
     AND revoked = FALSE
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'session_not_revocable';
  END IF;

  INSERT INTO public.security_events (user_id, session_id, event_type, platform, metadata)
  VALUES (
    v_row.user_id,
    v_row.session_id,
    'SESSION_REVOKED',
    v_row.platform,
    jsonb_build_object(
      'revoked_by', v_uid::text,
      'reason',     v_row.revoke_reason,
      'source',     'server'
    )
  );

  RETURN v_row;
END;
$$;

-- ── 8. Function privileges ────────────────────────────────
--
-- Granted to authenticated, not to PUBLIC: a service-role or anon caller has
-- no business in these paths, and `auth.uid()` is NULL for anon anyway,
-- which each function refuses first.

REVOKE ALL ON FUNCTION public.claim_my_device_session(text, text, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.touch_my_device_session(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.end_my_device_session(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_revoke_device_session(uuid, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.claim_my_device_session(text, text, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.touch_my_device_session(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.end_my_device_session(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_revoke_device_session(uuid, text) TO authenticated;

-- ── 9. Realtime delivery ──────────────────────────────────
--
-- Idempotent, per the 0017/0018 pattern: re-running this migration must not
-- fail on an already-published table.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_publication_tables
     WHERE pubname    = 'supabase_realtime'
       AND schemaname = 'public'
       AND tablename  = 'device_sessions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.device_sessions;
  END IF;
END
$$;

-- The client treats an event as a hint and refetches, so it needs the old
-- and new rows to carry their primary key. Without DEFAULT the DELETE
-- payload would arrive with only the key columns, which is exactly the
-- blind spot AppContext documents for RLS-scoped tables - and the reason the
-- client keeps a revalidation beat alongside the subscription.
ALTER TABLE public.device_sessions REPLICA IDENTITY DEFAULT;

-- ── VERIFY ─────────────────────────────────────────────────
--
-- 1. Policies, publication and the new limit: the queries in the header.
--
-- 2. Claim: as a customer with fewer than two live devices,
--      SELECT public.claim_my_device_session('fp-verify', 'WEB', 'Verify');
--    returns one row with user_id = the caller. Running it again returns the
--    SAME session_id and does not advance started_at.
--
-- 3. Limit: with two live rows for the account,
--      SELECT public.claim_my_device_session('fp-third', 'WEB', 'Third');
--    raises device_limit_exceeded and leaves a DEVICE_LIMIT_EXCEEDED row in
--    security_events. Then set one row's last_seen_at into the past:
--      UPDATE public.device_sessions
--         SET last_seen_at = NOW() - INTERVAL '4 hours'
--       WHERE device_fingerprint = '<one of the two>';
--    (run as staff - customers have no UPDATE policy), and the claim in this
--    step succeeds. That is the whole point of the ordering in step 4.
--
-- 4. Isolation: as user A, SELECT * FROM device_sessions returns only A's
--    rows; a direct INSERT is refused by RLS; touching B's session id raises
--    session_not_found.
--
-- 5. Block: as staff with manage_drm,
--      SELECT public.admin_revoke_device_session('<session>', 'shared account');
--    returns the row revoked, and its content_access_grants rows come back
--    with revoked_at set (trigger cascade). A SUPPORT admin_role without
--    manage_drm is refused by admin_require_permission.
--
-- 6. End to end: sign in on a second device while the first is open on
--    /dashboard - the new device appears on the first screen within seconds
--    with no reload, and the meter reads 2 / 2.

COMMIT;
