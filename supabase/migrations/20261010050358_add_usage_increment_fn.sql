/*
# Add atomic usage counter increment function

1. Purpose
   The daily usage cap (200 calls/function/day) needs an atomic increment so concurrent
   edge function calls cannot race past the cap. `pcs_increment_usage` upserts the
   (day, fn) row and returns the new call count in one statement.
2. Security
   - SECURITY DEFINER so it can bump the counter despite RLS.
   - Revoked from PUBLIC; executable by anon + authenticated (the roles the demo's
     edge functions use through the service role key connection).
*/

CREATE OR REPLACE FUNCTION pcs_increment_usage(p_fn text, p_day date)
RETURNS int
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO usage_counters (day, fn, calls)
  VALUES (p_day, p_fn, 1)
  ON CONFLICT (day, fn) DO UPDATE SET calls = usage_counters.calls + 1
  RETURNING calls;
$$;

REVOKE ALL ON FUNCTION pcs_increment_usage(text, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION pcs_increment_usage(text, date) TO anon, authenticated;
