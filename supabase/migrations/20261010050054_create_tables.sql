/*
# Podcast Clip Studio — initial schema

1. Short description
   Single-tenant, no-auth demo workspace for Podcast Clip Studio: upload an episode,
   get a timestamped transcript, Jev-scored segments, ranked clips, chapters, and usage counters.

2. New Tables
   - `episodes`: one podcast episode per row.
     - `id` uuid pk
     - `title` text not null
     - `show_description` text (used as Jev state context)
     - `audio_path` text (path in the `episodes` storage bucket; null for demo episode)
     - `duration_s` numeric
     - `status` text: 'uploading' | 'transcribing' | 'scoring' | 'writing' | 'ready' | 'error'
     - `source` text: 'upload' | 'demo'
     - `waveform_peaks` jsonb (precomputed peaks for demo episode playback)
     - `jev_calls` int, `jev_cost_usd` numeric, `jev_latency_ms_sum` numeric (Jev stats)
     - `writer_calls` int, `writer_cost_usd` numeric, `writer_latency_ms_sum` numeric
     - `created_at` timestamptz
   - `segments`: transcript segments merged to ~20-40s, with Jev scores.
     - `id` uuid pk, `episode_id` fk -> episodes(id) on delete cascade, `idx` int
     - `start_s` / `end_s` numeric, `text` text
     - `jev` jsonb (raw Jev answers), `hook` numeric (1-4), `hook_conf` numeric,
       `standalone` numeric (0-1), `risky` numeric (0-1), `clip_type` text
   - `clips`: ranked clip moments cut by code from scored segments.
   - `chapters`: chapter groups over segments (titles written by the LLM).
   - `usage_counters`: per-function-per-UTC-day call counters for the daily cap.
   - Indexes on episode_id for fast joins.

3. Security
   - RLS enabled on all 5 tables.
   - Permissive `TO anon, authenticated` policies for this single public demo workspace.
*/

CREATE TABLE IF NOT EXISTS episodes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  show_description text,
  audio_path text,
  duration_s numeric,
  status text NOT NULL DEFAULT 'uploading',
  source text NOT NULL DEFAULT 'upload',
  waveform_peaks jsonb,
  jev_calls int NOT NULL DEFAULT 0,
  jev_cost_usd numeric NOT NULL DEFAULT 0,
  jev_latency_ms_sum numeric NOT NULL DEFAULT 0,
  writer_calls int NOT NULL DEFAULT 0,
  writer_cost_usd numeric NOT NULL DEFAULT 0,
  writer_latency_ms_sum numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS segments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  episode_id uuid NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  idx int NOT NULL,
  start_s numeric NOT NULL,
  end_s numeric NOT NULL,
  text text NOT NULL,
  jev jsonb,
  hook numeric,
  hook_conf numeric,
  standalone numeric,
  risky numeric,
  clip_type text
);

CREATE TABLE IF NOT EXISTS clips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  episode_id uuid NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  start_s numeric NOT NULL,
  end_s numeric NOT NULL,
  segment_ids int[] NOT NULL,
  clip_score numeric NOT NULL,
  title text,
  caption text,
  hashtags text[],
  low_confidence boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS chapters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  episode_id uuid NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  start_s numeric NOT NULL,
  title text NOT NULL
);

CREATE TABLE IF NOT EXISTS usage_counters (
  day date NOT NULL,
  fn text NOT NULL,
  calls int NOT NULL DEFAULT 0,
  PRIMARY KEY (day, fn)
);

CREATE INDEX IF NOT EXISTS idx_segments_episode ON segments(episode_id, idx);
CREATE INDEX IF NOT EXISTS idx_clips_episode ON clips(episode_id, start_s);
CREATE INDEX IF NOT EXISTS idx_chapters_episode ON chapters(episode_id, start_s);

ALTER TABLE episodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE segments ENABLE ROW LEVEL SECURITY;
ALTER TABLE clips ENABLE ROW LEVEL SECURITY;
ALTER TABLE chapters ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_counters ENABLE ROW LEVEL SECURITY;

-- Permissive anon policies: single public demo workspace, no auth.
DROP POLICY IF EXISTS "anon_select_episodes" ON episodes;
CREATE POLICY "anon_select_episodes" ON episodes FOR SELECT
  TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_episodes" ON episodes;
CREATE POLICY "anon_insert_episodes" ON episodes FOR INSERT
  TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_episodes" ON episodes;
CREATE POLICY "anon_update_episodes" ON episodes FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_episodes" ON episodes;
CREATE POLICY "anon_delete_episodes" ON episodes FOR DELETE
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_select_segments" ON segments;
CREATE POLICY "anon_select_segments" ON segments FOR SELECT
  TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_segments" ON segments;
CREATE POLICY "anon_insert_segments" ON segments FOR INSERT
  TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_segments" ON segments;
CREATE POLICY "anon_update_segments" ON segments FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_segments" ON segments;
CREATE POLICY "anon_delete_segments" ON segments FOR DELETE
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_select_clips" ON clips;
CREATE POLICY "anon_select_clips" ON clips FOR SELECT
  TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_clips" ON clips;
CREATE POLICY "anon_insert_clips" ON clips FOR INSERT
  TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_clips" ON clips;
CREATE POLICY "anon_update_clips" ON clips FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_clips" ON clips;
CREATE POLICY "anon_delete_clips" ON clips FOR DELETE
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_select_chapters" ON chapters;
CREATE POLICY "anon_select_chapters" ON chapters FOR SELECT
  TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_chapters" ON chapters;
CREATE POLICY "anon_insert_chapters" ON chapters FOR INSERT
  TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_chapters" ON chapters;
CREATE POLICY "anon_update_chapters" ON chapters FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_chapters" ON chapters;
CREATE POLICY "anon_delete_chapters" ON chapters FOR DELETE
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_select_usage_counters" ON usage_counters;
CREATE POLICY "anon_select_usage_counters" ON usage_counters FOR SELECT
  TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_usage_counters" ON usage_counters;
CREATE POLICY "anon_insert_usage_counters" ON usage_counters FOR INSERT
  TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_usage_counters" ON usage_counters;
CREATE POLICY "anon_update_usage_counters" ON usage_counters FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_usage_counters" ON usage_counters;
CREATE POLICY "anon_delete_usage_counters" ON usage_counters FOR DELETE
  TO anon, authenticated USING (true);
