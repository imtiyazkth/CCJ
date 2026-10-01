/**
 * CCJ — YouTube Research Ingestion
 *
 * Orchestrates: URL detect → transcript fetch → source persist (deduped) →
 * evidence persist (timestamped) → claim extraction → claim persist.
 *
 * This module is additive and self-contained. It does not modify the
 * existing OSINT pipeline; callers (e.g. the research route) invoke it
 * alongside the existing fetch/agent pipeline and merge the resulting ids.
 */

import { eq, sql, desc } from "drizzle-orm";
import { getDb } from "@/lib/db.server";
import { sources, evidence, claims, researchRuns } from "@ccj/db/schema";
import type { YoutubeSourceMeta, ClaimOriginRef } from "@ccj/db/schema";
import { extractYouTubeVideoId, findYouTubeUrlsInText, type YouTubeVideoRef } from "./url";
import { fetchNormalizedTranscript, chunkSegments, type NormalizedTranscript } from "./transcript";
import { extractYoutubeClaims, type ExtractedYoutubeClaim } from "@/lib/providers/ai";
import { fetchYoutubeVideoMetadata } from "@/lib/providers/social-search";

export interface YoutubeIngestResult {
  videoRef: YouTubeVideoRef;
  transcript: NormalizedTranscript;
  sourceId: string;
  /** True if we reused an existing source row for this video instead of inserting a new one. */
  reusedExistingSource: boolean;
  evidenceIds: string[];
  claimIds: string[];
  /** Neutral claim text extracted, for downstream independent verification. */
  claimTexts: string[];
}

/** Scan a research topic string for YouTube URLs. Returns [] if none found. */
export function detectYoutubeUrls(topic: string): YouTubeVideoRef[] {
  const direct = extractYouTubeVideoId(topic);
  if (direct) return [direct];
  return findYouTubeUrlsInText(topic);
}

/**
 * Find an existing source row for this exact video within the given
 * research run's project, to avoid duplicate ingestion of the same video
 * across repeated runs. Looks up via the youtube_meta->>'videoId' index.
 */
async function findExistingYoutubeSource(
  projectId: string,
  videoId: string
): Promise<{ id: string } | null> {
  const db = getDb();
  // sources are scoped by researchRunId, and researchRuns are scoped by
  // projectId; join through researchRuns to dedupe at the project level.
  const [row] = await db
    .select({ id: sources.id })
    .from(sources)
    .innerJoin(researchRuns, eq(researchRuns.id, sources.researchRunId))
    .where(
      sql`${researchRuns.projectId} = ${projectId} AND (${sources.youtubeMeta} ->> 'videoId') = ${videoId}`
    )
    .orderBy(desc(sources.createdAt))
    .limit(1);
  return row ? { id: row.id } : null;
}

/**
 * Ingest a single YouTube video into the research pipeline:
 * fetch transcript → persist source → persist timestamped evidence →
 * extract claims → persist claims.
 *
 * Never throws on transcript failure — a failed/unavailable transcript
 * still produces a source record (so the video is visible and attributed),
 * just with transcriptStatus reflecting the real failure reason and no
 * fabricated evidence/claims.
 */
export async function ingestYoutubeVideo(
  projectId: string,
  runId: string,
  videoRef: YouTubeVideoRef,
  language: string
): Promise<YoutubeIngestResult> {
  const db = getDb();

  const transcript = await fetchNormalizedTranscript(videoRef.videoId);

  // Real metadata via YouTube Data API v3 when a key is configured;
  // otherwise these remain null rather than being guessed/invented.
  const videoMetadata = await fetchYoutubeVideoMetadata(videoRef.videoId).catch(() => ({
    title: null, channel: null, publishedAt: null, thumbnailUrl: null, durationSeconds: null,
  }));

  const existing = await findExistingYoutubeSource(projectId, videoRef.videoId).catch(() => null);

  const youtubeMeta: YoutubeSourceMeta = {
    videoId: videoRef.videoId,
    canonicalUrl: videoRef.canonicalUrl,
    videoType: videoRef.videoType,
    channel: videoMetadata.channel,
    publishedAt: videoMetadata.publishedAt,
    durationSeconds: videoMetadata.durationSeconds,
    thumbnailUrl: videoMetadata.thumbnailUrl,
    transcriptStatus: transcript.status,
    transcriptLanguage: transcript.language,
    transcriptIsGenerated: transcript.isGenerated,
  };

  // NOTE ON DEDUP: sources.researchRunId is a NOT NULL foreign key, so a
  // source row belongs to exactly one run. We cannot literally "reuse" a
  // row from a prior run inside a new run without violating that
  // constraint or misattributing history. `existing` is therefore used
  // only as a signal (reusedExistingSource) surfaced to the caller/UI —
  // e.g. to note "this video was already researched in an earlier run" —
  // while a fresh source row is still inserted for the current run so
  // this run's evidence/claims stay correctly scoped to it.
  const reusedExistingSource = existing !== null;

  const videoTitle = videoMetadata.title ?? `YouTube video (${videoRef.videoId})`;

  const [src] = await db.insert(sources).values({
    researchRunId: runId,
    url: videoRef.url,
    canonicalUrl: videoRef.canonicalUrl,
    domain: "youtube.com",
    title: videoTitle,
    author: videoMetadata.channel,
    publishedAt: videoMetadata.publishedAt ? new Date(videoMetadata.publishedAt) : null,
    language,
    sourceType: "video",
    credibilityTier: "unknown", // a video's credibility is not assessed by platform alone
    accessMethod: "youtube",
    contentHash: Buffer.from(videoRef.canonicalUrl).toString("base64").slice(0, 64).padEnd(64, "0"),
    isDemo: false,
    youtubeMeta: youtubeMeta as unknown as Record<string, unknown>,
  }).returning({ id: sources.id });

  if (!src?.id) {
    throw new Error("Failed to persist YouTube source record");
  }
  const sourceId = src.id;

  const evidenceIds: string[] = [];
  const claimIds: string[] = [];
  const claimTexts: string[] = [];

  if (transcript.status === "available" && transcript.segments.length > 0) {
    const chunks = chunkSegments(transcript.segments, 40);

    for (const chunk of chunks) {
      // ── Evidence: the transcript passage itself (what was said) ──
      const [ev] = await db.insert(evidence).values({
        sourceId,
        quote: chunk.text.slice(0, 4000),
        startTime: chunk.start,
        endTime: chunk.end,
        confidence: 1.0, // confidence that this IS what was transcribed, not that it's TRUE
        language: transcript.language ?? language,
        extractionWarnings: transcript.isGenerated === true
          ? ["Auto-generated captions — wording may be imprecise"]
          : [],
        isDemo: false,
      }).returning({ id: evidence.id }).catch(() => [] as { id: string }[]);

      if (!ev?.id) continue;
      evidenceIds.push(ev.id);

      // ── Claims: AI-extracted from this chunk, unverified until compared
      //    against independent sources (see verifyClaimsAgainstSources) ──
      const extracted: ExtractedYoutubeClaim[] = await extractYoutubeClaims(
        chunk.text,
        chunk.start,
        videoTitle
      ).catch(() => []);

      for (const c of extracted) {
        const originRef: ClaimOriginRef = {
          sourceId,
          evidenceId: ev.id,
          timestamp: c.timestamp,
          speakerOrAttribution: c.speakerOrAttribution,
        };

        const mappedType =
          c.claimType === "opinion" ? "opinion" :
          c.claimType === "statistic" ? "statistic" :
          c.claimType === "quote" ? "fact" :
          c.claimType === "accusation" ? "reported" :
          c.claimType === "prediction" ? "inference" :
          c.claimType === "religious_claim" || c.claimType === "political_claim"
            ? "analysis" :
          c.claimType === "historical_claim" || c.claimType === "scientific_claim"
            ? "fact" :
          "inference"; // interpretation → inference (closest existing enum value)

        const [claimRow] = await db.insert(claims).values({
          projectId,
          claimText: c.claim.slice(0, 1000),
          claimType: mappedType,
          // Never "verified"/"strongly_correlated" here — a transcript claim
          // is unverified until independently checked in a later pass.
          status: c.claimType === "opinion" ? "opinion" : "unverified",
          confidence: 0, // no independent verification has occurred yet
          reasoningSummary: `Extracted from YouTube transcript at ~${Math.floor(c.timestamp ?? chunk.start)}s. Not yet independently verified.`,
          whatIsMissing: "Independent source verification not yet performed for this claim.",
          isDemo: false,
          originRef: originRef as unknown as Record<string, unknown>,
        }).returning({ id: claims.id }).catch(() => [] as { id: string }[]);

        if (claimRow?.id) {
          claimIds.push(claimRow.id);
          claimTexts.push(c.claim);
        }
      }
    }
  }
  // If transcript is unavailable, we deliberately create zero evidence and
  // zero claims for this source — an unavailable transcript must never be
  // backfilled with fabricated content. The source row still exists so the
  // video is visible in the dashboard with its real transcriptStatus.

  return {
    videoRef,
    transcript,
    sourceId,
    reusedExistingSource,
    evidenceIds,
    claimIds,
    claimTexts,
  };
}

/**
 * Ingest every YouTube URL found in a topic string. Failures for one video
 * do not block ingestion of others.
 */
export async function ingestAllYoutubeVideos(
  projectId: string,
  runId: string,
  topic: string,
  language: string
): Promise<YoutubeIngestResult[]> {
  const refs = detectYoutubeUrls(topic);
  const results: YoutubeIngestResult[] = [];

  for (const ref of refs) {
    try {
      const result = await ingestYoutubeVideo(projectId, runId, ref, language);
      results.push(result);
    } catch (e) {
      console.error(`[YouTube Ingest] Failed for video ${ref.videoId}:`, e);
      // Continue with other videos rather than failing the whole run.
    }
  }

  return results;
}
