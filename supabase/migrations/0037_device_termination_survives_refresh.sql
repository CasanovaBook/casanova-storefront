-- ============================================================
-- 0037 - A disconnected device does not come back on its own
--
-- THE HOLE
--
-- end_my_device_session terminates the row correctly. The resurrection is
-- the claim path, and it is entirely self-inflicted:
--
--   claim_my_device_session looks for a live row for this fingerprint, finds
--   none (the row we just terminated is excluded by `ended_at IS NULL`),
--   counts the slot as free for the same reason, and INSERTs a brand-new row
--   with a new session_id. The client then mints a content grant against that
--   new row, and reader-content serves it - correctly, because the session
--   genuinely is live.
--
-- The trigger was the storefront mounting a claim on every app start, so an
-- ordinary page refresh completed the whole cycle with no user intent at
-- all. That call site is removed separately; this migration makes the
-- database refuse even a hand-crafted repeat of it.
--
-- THE RULE
--
-- A fingerprint that has been terminated on an account stays terminated until
-- a caller explicitly says otherwise. `p_confirm_reactivate` is how a caller
-- says so, and every use of it is recorded, because "the device you
-- disconnected is reading again" is precisely the thing an administrator
-- needs to see.
--
-- WHY NOT A TRIGGER ON auth.users.last_sign_in_at
--
-- tempting, and wrong. GoTrue refresh paths can update that column, so an
-- attestation derived from it would be granted by a silent token refresh -
-- the exact event this migration exists to refuse. A deliberate click plus a
-- recorded audit event is weaker than cryptographic proof and honest about
-- being weaker. If a hard guarantee is ever needed, the control is a device
-- blocklist that survives re-login, not a timestamp.
--
-- APPLY, THEN VERIFY
--
--   SELECT proargnames FROM pg_proc
--    WHERE proname = 'claim_my_device_session';
--   -> exactly one function, whose argument list ends with
--      p_confirm_reactivate. Two rows here means the old signature survived
--      and PostgREST will refuse the call as ambiguous.
--
--   Terminate a device, then claim without confirming:
--     SELECT public.claim_my_device_session('<fp>','WEB','x');
--   -> ERROR: device_previously_terminated
--   Then confirm:
--     SELECT public.claim_my_device_session('<fp>','WEB','x',
--       NULL, NULL, NULL, true);
--   -> a new row, and a DEVICE_REACTIVATED event naming the old one.
-- ============================================================

BEGIN;

-- ── 1. Why a row stopped, recorded on the row ────────────
--
-- `ended_at` alone cannot answer the question this migration has to ask. It is
-- set by a deliberate release, by the idle sweep, and by an administrator
-- block alike - so a rule written against `ended_at` would treat a reader who
-- left a book open overnight the same as a device that was signed out on
-- purpose, and demand a click to undo a timeout. That is not the bug being
-- fixed and it would be a worse product than the one we have.
--
-- So intent becomes data. Existing closed rows are backfilled to 'expired',
-- which is the lenient reading: nothing that was already silent is treated as
-- a termination on upgrade, and only releases and blocks from here forward
-- require confirmation to undo.

ALTER TABLE public.device_sessions
  ADD COLUMN IF NOT EXISTS end_reason text
    CHECK (end_reason IN ('released','expired','revoked'));

-- Backfilled explicitly rather than left to NULL. The claim's rule would
-- happen to treat NULL as "not a termination" because `NULL IN (...)` is never
-- true, but a security decision should not rest on three-valued logic that a
-- later reader has to know to expect.
--
-- Intent cannot be recovered for rows that are already closed, so they are
-- stamped with the lenient reading: a revoked row is a revocation, everything
-- else that is closed was most likely a sweep or a timeout. The consequence is
-- that devices disconnected before this migration can still be reclaimed
-- without confirmation - which is correct, because nothing recorded that
-- anybody asked for them to stop.

UPDATE public.device_sessions
   SET end_reason = 'revoked'
 WHERE revoked AND end_reason IS NULL;

UPDATE public.device_sessions
   SET end_reason = 'expired'
 WHERE ended_at IS NOT NULL AND end_reason IS NULL;

COMMENT ON COLUMN public.device_sessions.end_reason IS
  'Why this slot stopped: released by its owner, expired by inactivity, or '
  'revoked by staff. Only released and revoked require a confirmed re-claim.';

-- ── 2. One more thing worth recording ────────────────────

DO $$
DECLARE
  v_conname text;
BEGIN
  SELECT conname INTO v_conname
    FROM pg_constraint
   WHERE conrelid = 'public.security_events'::regclass
     AND contype = 'c'
     AND pg_get_constraintdef(oid) LIKE '%event_type%';

  IF v_conname IS NOT NULL THEN
    EXECUTE format(
      'ALTER TABLE public.security_events DROP CONSTRAINT %I', v_conname
    );
  END IF;

  ALTER TABLE public.security_events
    ADD CONSTRAINT security_events_event_type_check
    CHECK (event_type IN (
      'SCREENSHOT_BLOCKED','RECORDING_DETECTED','COPY_BLOCKED',
      'PRINT_BLOCKED','CONTEXT_MENU_BLOCKED','SOURCE_VIEW_BLOCKED',
      'VISIBILITY_HIDDEN',
      'SESSION_REVOKED','SESSION_RELEASED','DEVICE_LIMIT_EXCEEDED',
      'DEVICE_RECLAIM_AFTER_BLOCK','DEVICE_REACTIVATED',
      'DOWNLOAD_BLOCKED','SHARE_BLOCKED','MIRROR_DETECTED',
      'DEVICE_COMPROMISED','GRANT_REPLAY_BLOCKED','OFFLINE_EXPIRED'
    ));
END
$$;

-- ── 3. The claim, with the termination check ─────────────
--
-- Dropped before re-creating on purpose: adding a defaulted parameter makes a
-- second signature, and PostgREST refuses to resolve an overloaded function by
-- name. One signature, always.

DROP FUNCTION IF EXISTS public.claim_my_device_session(
  text, text, text, text, text, text
);

CREATE OR REPLACE FUNCTION public.claim_my_device_session(
  p_device_fingerprint   text,
  p_platform             text   DEFAULT 'WEB',
  p_device_name          text   DEFAULT NULL,
  p_device_model         text   DEFAULT NULL,
  p_os_version           text   DEFAULT NULL,
  p_app_version          text   DEFAULT NULL,
  p_confirm_reactivate   boolean DEFAULT FALSE
)
RETURNS public.device_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid      uuid := auth.uid();
  v_fp       text := left(btrim(COALESCE(p_device_fingerprint, '')), 256);
  v_platform text := CASE
                       WHEN p_platform IN ('WEB','ANDROID','IOS') THEN p_platform
                       ELSE 'WEB'
                     END;
  v_limit    integer := public.device_limit(v_platform);
  v_idle     integer := public.device_idle_minutes(v_platform);
  v_existing public.device_sessions;
  v_ended    public.device_sessions;
  v_blocked  public.device_sessions;
  v_open     integer;
  v_row      public.device_sessions;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;

  IF v_fp = '' THEN
    RAISE EXCEPTION 'validation_fingerprint';
  END IF;

  /* Idle cleanup first, as before: a device that stopped reporting is not
   * reading and must not hold a place. It is stamped 'expired' here so the
   * check below can tell this apart from a disconnect. */
  UPDATE public.device_sessions
     SET ended_at           = NOW(),
         secure_flag_active = FALSE,
         end_reason         = 'expired'
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

  /* The rule. Look back further than the live row.
   *
   * A release pressed by the account owner and a block pressed by staff are
   * terminations, and a terminated fingerprint does not come back because
   * something reloaded. An 'expired' row is not in this list: that is a
   * timeout, the reader was never asked to stop, and demanding a click to undo
   * it would punish exactly the people this is supposed to protect. */
  IF NOT p_confirm_reactivate THEN
    SELECT * INTO v_ended
      FROM public.device_sessions
     WHERE user_id            = v_uid
       AND device_fingerprint = v_fp
       AND (revoked OR end_reason IN ('released','revoked'))
     ORDER BY COALESCE(revoked_at, ended_at) DESC NULLS LAST
     LIMIT 1;

    IF FOUND THEN
      INSERT INTO public.security_events (user_id, session_id, event_type, platform, metadata)
      VALUES (
        v_uid,
        v_ended.session_id,
        'DEVICE_REACTIVATED',
        v_platform,
        jsonb_build_object(
          'attempted',   true,
          'confirmed',   false,
          'terminated',  COALESCE(v_ended.revoked_at, v_ended.ended_at),
          'reason',      v_ended.end_reason,
          'by_admin',    v_ended.revoked
        )
      );

      RAISE EXCEPTION 'device_previously_terminated';
    END IF;
  END IF;

  SELECT count(*) INTO v_open
    FROM public.device_sessions
   WHERE user_id = v_uid
     AND ended_at IS NULL
     AND revoked = FALSE;

  IF v_open >= v_limit THEN
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

  SELECT * INTO v_blocked
    FROM public.device_sessions
   WHERE user_id            = v_uid
     AND device_fingerprint = v_fp
     AND revoked
   ORDER BY revoked_at DESC NULLS LAST
   LIMIT 1;

  INSERT INTO public.device_sessions (
    user_id, device_fingerprint, platform, device_name,
    device_model, os_version, app_version,
    device_integrity, secure_flag_active,
    started_at, last_seen_at, revoked
  ) VALUES (
    v_uid, v_fp, v_platform,
    left(NULLIF(btrim(COALESCE(p_device_name,  '')), ''), 160),
    left(NULLIF(btrim(COALESCE(p_device_model,  '')), ''), 120),
    left(NULLIF(btrim(COALESCE(p_os_version,    '')), ''),  60),
    left(NULLIF(btrim(COALESCE(p_app_version,   '')), ''),  40),
    'UNKNOWN', TRUE, NOW(), NOW(), FALSE
  )
  RETURNING * INTO v_row;

  IF p_confirm_reactivate THEN
    INSERT INTO public.security_events (user_id, session_id, event_type, platform, metadata)
    VALUES (
      v_uid,
      v_row.session_id,
      'DEVICE_REACTIVATED',
      v_platform,
      jsonb_build_object(
        'attempted',  true,
        'confirmed',  true,
        'previous',   v_blocked.session_id::text
      )
    );
  ELSIF v_blocked.session_id IS NOT NULL THEN
    INSERT INTO public.security_events (user_id, session_id, event_type, platform, metadata)
    VALUES (
      v_uid,
      v_row.session_id,
      'DEVICE_RECLAIM_AFTER_BLOCK',
      v_platform,
      jsonb_build_object(
        'previous_session_id', v_blocked.session_id::text,
        'blocked_at', to_char(v_blocked.revoked_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
        'blocked_by', v_blocked.revoked_by::text,
        'reason',     v_blocked.revoke_reason
      )
    );
  END IF;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_my_device_session(
  text, text, text, text, text, text, boolean
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.claim_my_device_session(
  text, text, text, text, text, text, boolean
) TO authenticated;

-- ── 4. Stamp the reason on the two deliberate paths ──────
--
-- Both are redefined whole rather than patched with a trigger, so there is one
-- place that decides what a release and a block mean.

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
     SET ended_at           = NOW(),
         secure_flag_active = FALSE,
         end_reason         = 'released'
   WHERE session_id = p_session_id
     AND user_id    = v_uid
     AND revoked = FALSE
     AND ended_at IS NULL
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'session_not_open';
  END IF;

  INSERT INTO public.security_events (user_id, session_id, event_type, platform, metadata)
  VALUES (
    v_row.user_id,
    v_row.session_id,
    'SESSION_RELEASED',
    v_row.platform,
    jsonb_build_object(
      'released_by', v_uid::text,
      'own_row',     v_row.user_id = v_uid,
      'device_name', v_row.device_name
    )
  );

  RETURN v_row;
END;
$$;

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
         revoke_reason      = NULLIF(btrim(COALESCE(p_reason, '')), ''),
         end_reason         = 'revoked'
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

-- The grant cascade stays on trg_device_session_revokes_grants. Re-implementing
-- it here would put a second copy of one rule somewhere to drift.

-- ── 5. The scheduled sweeper agrees ──────────────────────
--
-- sweep_expired_reader_sessions() closes idle rows on a timer. Without the
-- stamp its rows would be NULL in end_reason, which the claim treats as
-- non-terminating - correct today, but only by accident. Making it explicit
-- keeps the invariant readable instead of emergent.

CREATE OR REPLACE FUNCTION sweep_expired_reader_sessions()
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  closed INTEGER;
BEGIN
  WITH policy AS (
    SELECT COALESCE(
      (SELECT d.session_timeout_minutes FROM drm_policies d
        WHERE d.active AND d.applies_to = 'WEB'
        ORDER BY d.updated_at DESC LIMIT 1),
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
       SET ended_at           = NOW(),
           secure_flag_active = FALSE,
           end_reason         = 'expired'
      FROM policy
     WHERE ds.ended_at IS NULL
       AND ds.revoked = FALSE
       AND ds.last_seen_at < NOW() - (policy.idle_minutes || ' minutes')::INTERVAL
    RETURNING ds.session_id
  )
  SELECT COUNT(*) INTO closed FROM swept;

  UPDATE content_access_grants
     SET revoked_at = COALESCE(revoked_at, NOW())
   WHERE revoked_at IS NULL AND expires_at <= NOW();

  RETURN closed;
END;
$$;

-- ── VERIFY ─────────────────────────────────────────────────
--
-- 1. Single signature (header query).
--
-- 2. Release a device, then claim without confirming -> device_previously_
--    terminated, and a DEVICE_REACTIVATED event with confirmed = false.
--
-- 3. Claim with p_confirm_reactivate => true -> a live row, and a
--    DEVICE_REACTIVATED event with confirmed = true.
--
-- 4. A never-before-used fingerprint claims on the first try with no
--    confirmation and writes no DEVICE_REACTIVATED event. If it does, the
--    check is reading rows that are not this device's.
--
-- 5. reader-content still refuses the OLD session id after the release, and
--    serves the new one - the new row is a real session, so the edge has
--    nothing to refuse. Enforcement of intent lives here, not there.

COMMIT;
