/*
# Create 'episodes' storage bucket

1. Storage
   - Creates a public bucket named `episodes` for podcast audio files.
   - Restricts uploads to mp3/m4a/wav with a 25 MB max file size.
2. Security
   - Public read on objects (share page audio playback).
   - Public insert for this no-auth demo workspace.
*/

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('episodes', 'episodes', true, 26214400, ARRAY['audio/mpeg', 'audio/mp4', 'audio/x-m4a', 'audio/m4a', 'audio/wav', 'audio/x-wav'])
ON CONFLICT (id) DO UPDATE
  SET public = true,
      file_size_limit = 26214400,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "public_read_episodes_bucket" ON storage.objects;
CREATE POLICY "public_read_episodes_bucket" ON storage.objects FOR SELECT
  TO anon, authenticated USING (bucket_id = 'episodes');

DROP POLICY IF EXISTS "public_insert_episodes_bucket" ON storage.objects;
CREATE POLICY "public_insert_episodes_bucket" ON storage.objects FOR INSERT
  TO anon, authenticated WITH CHECK (bucket_id = 'episodes');

DROP POLICY IF EXISTS "public_delete_episodes_bucket" ON storage.objects;
CREATE POLICY "public_delete_episodes_bucket" ON storage.objects FOR DELETE
  TO anon, authenticated USING (bucket_id = 'episodes');
