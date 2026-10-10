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
