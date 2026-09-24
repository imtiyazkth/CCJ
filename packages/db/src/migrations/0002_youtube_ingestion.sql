-- Migration: 0002_youtube_ingestion
-- Purpose: Add YouTube research ingestion support.
-- Fully additive — no columns dropped, no tables renamed, no destructive changes.

-- sources: nullable JSONB for YouTube-specific metadata.
ALTER TABLE "sources" ADD COLUMN IF NOT EXISTS "youtube_meta" jsonb;

-- Functional index for looking up an existing YouTube source by videoId
-- (used for dedup — do not re-ingest the same video twice per project).
CREATE INDEX IF NOT EXISTS "sources_youtube_video_id_idx"
  ON "sources" (((youtube_meta ->> 'videoId')));

-- evidence: nullable start/end time in seconds, for timestamped evidence
-- (YouTube transcript segments, or any future time-based source).
ALTER TABLE "evidence" ADD COLUMN IF NOT EXISTS "start_time" real;
ALTER TABLE "evidence" ADD COLUMN IF NOT EXISTS "end_time" real;

-- claims: nullable JSONB recording where a claim originated
-- ({ sourceId, evidenceId, timestamp, speakerOrAttribution }).
ALTER TABLE "claims" ADD COLUMN IF NOT EXISTS "origin_ref" jsonb;
