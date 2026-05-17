-- Weekly tutor_feedback review.
-- Paste into Supabase SQL editor every Friday afternoon.
-- Read each row out loud. Patch tutor.ts / wellbeing.ts / constitution.md
-- to fix the highest-frequency complaints. That is the bug-fixing flywheel.
--
-- Three queries in order of how I'd actually use them:

------------------------------------------------------------
-- 1) HEADLINE: last 7 days, by persona and rating
------------------------------------------------------------
SELECT
  persona,
  rating,
  count(*) AS n,
  count(note) FILTER (WHERE note <> '') AS with_note
FROM public.tutor_feedback
WHERE created_at >= now() - interval '7 days'
GROUP BY 1, 2
ORDER BY 1, 2;

------------------------------------------------------------
-- 2) ALL THUMBS-DOWN with note from the last 7 days.
--    These are the gold — pick the top 3 recurring complaints,
--    patch the prompt or the constitution.
------------------------------------------------------------
SELECT
  created_at,
  persona,
  COALESCE(note, '') AS note,
  LEFT(user_message_text, 200) AS prompt,
  LEFT(message_text, 400)      AS reply
FROM public.tutor_feedback
WHERE rating = 'down'
  AND created_at >= now() - interval '7 days'
ORDER BY created_at DESC
LIMIT 50;

------------------------------------------------------------
-- 3) SAMPLE THUMBS-UP — what's working. Useful for keeping
--    those behaviors locked in when you change other things.
------------------------------------------------------------
SELECT
  created_at,
  persona,
  LEFT(user_message_text, 200) AS prompt,
  LEFT(message_text, 400)      AS reply
FROM public.tutor_feedback
WHERE rating = 'up'
  AND created_at >= now() - interval '7 days'
ORDER BY random()
LIMIT 20;
