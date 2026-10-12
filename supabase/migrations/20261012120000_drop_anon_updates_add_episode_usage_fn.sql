/*
# Drop anonymous UPDATE on data tables; record upload-episode progress server-side

1. Purpose
   Security hardening: anon/authenticated could UPDATE any row in episodes, segments,
   clips and chapters (e.g. rewrite a shared clip's title/caption or an episode's
   audio_path). The browser now only SELECTs and INSERTs. The episode progress it used
   to UPDATE (status, duration, Jev/writer stats) is written by the Edge Functions with
   the service role instead.

2. Changes
   - DROP the anon_update policies on episodes, segments, clips, chapters.
   - REVOKE UPDATE, DELETE, TRUNCATE on those tables FROM anon, authenticated, so a
     future permissive policy cannot silently re-open writes.
   - New function pcs_record_episode_usage(episode_id, fn, cost_usd, latency_ms, status):
     atomically adds one call plus its cost/latency to the jev_* or writer_* columns of
     an upload episode and optionally advances its status. Inputs are validated and
     bounded. Only rows with source = 'upload' that are not yet 'ready' are touched.
     EXECUTE is revoked from PUBLIC, anon, authenticated and granted to service_role.

3. Notes
   - SELECT policies are unchanged (Studio and share pages read publicly).
   - INSERT policies on episodes, segments, clips, chapters and the episodes storage
     bucket are kept: the client-side pipeline still inserts its results.
   - The transcribe function sets status/duration_s with the service role directly.
*/

DROP POLICY IF EXISTS "anon_update_episodes" ON episodes;
DROP POLICY IF EXISTS "anon_update_segments" ON segments;
DROP POLICY IF EXISTS "anon_update_clips" ON clips;
DROP POLICY IF EXISTS "anon_update_chapters" ON chapters;

REVOKE UPDATE, DELETE, TRUNCATE ON episodes, segments, clips, chapters FROM anon, authenticated;

CREATE OR REPLACE FUNCTION pcs_record_episode_usage(
  p_episode_id uuid,
  p_fn text,
  p_cost_usd numeric,
  p_latency_ms numeric,
  p_status text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF p_fn IS NULL OR p_fn NOT IN ('jev-score', 'writer') THEN
    RAISE EXCEPTION 'invalid fn';
  END IF;
  IF p_status IS NOT NULL AND p_status NOT IN ('writing', 'ready') THEN
    RAISE EXCEPTION 'invalid status';
  END IF;
  IF p_cost_usd IS NULL OR p_cost_usd < 0 OR p_cost_usd > 100
     OR p_latency_ms IS NULL OR p_latency_ms < 0 OR p_latency_ms > 3600000 THEN
    RAISE EXCEPTION 'invalid usage values';
  END IF;

  UPDATE episodes SET
    jev_calls             = jev_calls             + CASE WHEN p_fn = 'jev-score' THEN 1 ELSE 0 END,
    jev_cost_usd          = jev_cost_usd          + CASE WHEN p_fn = 'jev-score' THEN p_cost_usd ELSE 0 END,
    jev_latency_ms_sum    = jev_latency_ms_sum    + CASE WHEN p_fn = 'jev-score' THEN p_latency_ms ELSE 0 END,
    writer_calls          = writer_calls          + CASE WHEN p_fn = 'writer' THEN 1 ELSE 0 END,
    writer_cost_usd       = writer_cost_usd       + CASE WHEN p_fn = 'writer' THEN p_cost_usd ELSE 0 END,
    writer_latency_ms_sum = writer_latency_ms_sum + CASE WHEN p_fn = 'writer' THEN p_latency_ms ELSE 0 END,
    status                = COALESCE(p_status, status)
  WHERE id = p_episode_id
    AND source = 'upload'
    AND status <> 'ready';
END;
$$;

REVOKE ALL ON FUNCTION pcs_record_episode_usage(uuid, text, numeric, numeric, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION pcs_record_episode_usage(uuid, text, numeric, numeric, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION pcs_record_episode_usage(uuid, text, numeric, numeric, text) TO service_role;
