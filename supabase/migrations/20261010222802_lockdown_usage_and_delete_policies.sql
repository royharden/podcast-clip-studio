/*
# Lock down usage_counters and pcs_increment_usage; remove delete policies

1. Purpose
   Security hardening: usage_counters is an internal counter table that must not be
   readable, writable, or deletable by the anon/authenticated roles. The
   pcs_increment_usage function must only be callable by the service_role (edge
   functions use the service role key). Delete policies on data tables and the
   storage bucket are removed to prevent anonymous deletion of episodes, segments,
   clips, chapters, and audio files.

2. Changes
   - DROP all four anon policies on usage_counters (select/insert/update/delete).
   - REVOKE ALL privileges on usage_counters FROM anon, authenticated.
     RLS remains enabled with no policies — the table is fully locked to anon/authenticated.
   - REVOKE EXECUTE ON pcs_increment_usage FROM PUBLIC, anon, authenticated.
   - GRANT EXECUTE ON pcs_increment_usage TO service_role only.
     SECURITY DEFINER and search_path=public are retained from the original definition.
   - DROP anon_delete policies on episodes, segments, clips, chapters.
   - DROP public_delete_episodes_bucket policy on storage.objects.

3. Notes
   - The service_role bypasses RLS, so edge functions using SUPABASE_SERVICE_ROLE_KEY
     can still read/increment usage_counters via the RPC.
   - Select/insert/update anon policies on episodes, segments, clips, chapters remain
     unchanged — only delete is removed.
*/

-- Lock down usage_counters: drop all anon policies
DROP POLICY IF EXISTS "anon_select_usage_counters" ON usage_counters;
DROP POLICY IF EXISTS "anon_insert_usage_counters" ON usage_counters;
DROP POLICY IF EXISTS "anon_update_usage_counters" ON usage_counters;
DROP POLICY IF EXISTS "anon_delete_usage_counters" ON usage_counters;

-- Revoke all table privileges from anon and authenticated (RLS stays on, no policies)
REVOKE ALL ON usage_counters FROM anon, authenticated;

-- Lock down pcs_increment_usage: only service_role may call it
REVOKE ALL ON FUNCTION pcs_increment_usage(text, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION pcs_increment_usage(text, date) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION pcs_increment_usage(text, date) TO service_role;

-- Remove anonymous delete on data tables
DROP POLICY IF EXISTS "anon_delete_episodes" ON episodes;
DROP POLICY IF EXISTS "anon_delete_segments" ON segments;
DROP POLICY IF EXISTS "anon_delete_clips" ON clips;
DROP POLICY IF EXISTS "anon_delete_chapters" ON chapters;

-- Remove anonymous delete on storage objects in the episodes bucket
DROP POLICY IF EXISTS "public_delete_episodes_bucket" ON storage.objects;
