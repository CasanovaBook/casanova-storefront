-- ============================================================
-- 0021 — A customer may send at most two messages in a row
--
-- WHY
--
-- `reply_to_my_inquiry` (0019) is the only write path a customer has into a
-- conversation, so it is the only place a message limit can be enforced
-- where it actually counts. Hiding or disabling the composer is a courtesy
-- for the customer, not a rule: the same request can be replayed from the
-- browser console, from a script or straight against PostgREST, and the
-- client cannot be trusted to say whether the customer is out of turn.
--
-- WHAT
--
-- A customer may send at most TWO customer-visible messages since the
-- support team's last customer-visible reply. The third in a row is refused
-- with the token `reply_limit`, which the app renders as:
--
--   ניתן לשלוח עד 2 הודעות ברצף. לאחר תגובת האדמין ניתן לשלוח הודעה נוספת.
--
-- The run is read from the conversation itself — never from a session
-- counter — so it survives a reload, another device, another browser and a
-- direct API call:
--
--   customer, customer                       → the third is refused
--   customer, customer, staff, customer      → allowed (the run restarted)
--   customer, customer, staff, staff,
--            customer, customer              → allowed, then blocked again
--
-- Rules and edges:
--
--   • Only `internal = FALSE` notes take part. An internal annotation is
--     invisible to the customer, so it neither consumes their turn nor
--     restarts it — the customer is still "waiting for an answer" as far as
--     they can see.
--   • The ticket's opening message is not one of the two: this counts the
--     messages sent from the conversation, which is what the customer sees
--     in the composer. (Change the comparison below if the opening message
--     should consume a slot.)
--   • The limit applies to customers only. Staff replies are unrestricted,
--     and because they are customer-visible by default they free the
--     customer's next message.
--   • Everything else about the function is unchanged (0019): the ticket
--     must exist, it must belong to the caller, the note is forced to
--     `internal = FALSE`, the author is stamped from the JWT, and a
--     NEW/WAITING_FOR_CUSTOMER ticket moves back to OPEN.
--
-- APPLY, THEN VERIFY
--
--   As the ticket's owner:
--     SELECT reply_to_my_inquiry('<T>', 'הודעה ראשונה');   -- ok
--     SELECT reply_to_my_inquiry('<T>', 'הודעה שנייה');    -- ok
--     SELECT reply_to_my_inquiry('<T>', 'הודעה שלישית');   -- ERROR: reply_limit
--   As staff:
--     SELECT reply_to_my_inquiry(...) is not the staff path; insert a
--     customer-visible note instead (internal = FALSE):
--       INSERT INTO public.inquiry_notes (inquiry_id, author_id, content, internal)
--       VALUES ('<T>', auth.uid(), 'תשובה', FALSE);
--   As the owner again:
--     SELECT reply_to_my_inquiry('<T>', 'שוב מותר');       -- ok
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.reply_to_my_inquiry(
  p_inquiry_id uuid,
  p_content    text
)
RETURNS public.inquiry_notes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid             uuid := auth.uid();
  v_inquiry         public.inquiries;
  v_note            public.inquiry_notes;
  v_last_staff_note timestamptz;
  v_consecutive     bigint;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;

  IF p_content IS NULL OR btrim(p_content) = '' THEN
    RAISE EXCEPTION 'validation_content';
  END IF;

  SELECT * INTO v_inquiry
    FROM public.inquiries
   WHERE inquiry_id = p_inquiry_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'inquiry_missing';
  END IF;

  -- Only the ticket's own account may reply to it. A ticket opened from
  -- the public form while signed out has no owner and stays staff-only.
  IF v_inquiry.user_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'not_owner';
  END IF;

  -- The last thing the support team said that the CUSTOMER can see. Internal
  -- annotations are deliberately excluded: the customer cannot see them, so
  -- they cannot be the answer the customer is waiting for.
  SELECT max(n.created_at) INTO v_last_staff_note
    FROM public.inquiry_notes n
   WHERE n.inquiry_id = p_inquiry_id
     AND n.internal = FALSE
     AND n.author_id <> v_uid;

  -- How many customer-visible messages the customer has sent in a row since
  -- then. Read from the stored conversation, so a direct API call, a second
  -- browser or a reload all see the same count.
  SELECT count(*) INTO v_consecutive
    FROM public.inquiry_notes n
   WHERE n.inquiry_id = p_inquiry_id
     AND n.internal = FALSE
     AND n.author_id = v_uid
     AND (v_last_staff_note IS NULL OR n.created_at > v_last_staff_note);

  IF v_consecutive >= 2 THEN
    RAISE EXCEPTION 'reply_limit';
  END IF;

  INSERT INTO public.inquiry_notes (inquiry_id, author_id, content, internal)
  VALUES (p_inquiry_id, v_uid, btrim(p_content), FALSE)
  RETURNING * INTO v_note;

  -- A customer answering a ticket that was waiting on them (or that nobody
  -- has opened yet) moves it back into the queue. Any other status is left
  -- to the staff lifecycle; RESOLVED and CLOSED keep their resolved_at, so
  -- chk_inquiry_resolution still holds.
  UPDATE public.inquiries
     SET status = CASE
       WHEN status IN ('NEW', 'WAITING_FOR_CUSTOMER') THEN 'OPEN'
       ELSE status
     END
   WHERE inquiry_id = p_inquiry_id;

  RETURN v_note;
END;
$$;

REVOKE ALL ON FUNCTION public.reply_to_my_inquiry(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reply_to_my_inquiry(uuid, text) TO authenticated;

COMMIT;
