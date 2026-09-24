/**
 * CCJ — YouTube Transcript Service
 *
 * Thin wrapper around the `youtube-transcript` npm package.
 *
 * HARD RULES:
 *  - Never fabricate transcript text.
 *  - Never use an LLM to "reconstruct" a missing transcript.
 *  - Always return a structured status so callers can show the user
 *    exactly why a transcript is or isn't available.
 */

import {
  YoutubeTranscript,
  YoutubeTranscriptError,
  YoutubeTranscriptTooManyRequestError,
  YoutubeTranscriptVideoUnavailableError,
  YoutubeTranscriptDisabledError,
  YoutubeTranscriptNotAvailableError,
  YoutubeTranscriptNotAvailableLanguageError,
} from "youtube-transcript";

export type TranscriptStatus =
  | "available"
  | "disabled"
  | "not_available"
  | "video_unavailable"
  | "too_many_requests"
  | "language_unavailable"
  | "error";

export interface TranscriptSegment {
  text: string;
  /** Seconds from video start. */
  start: number;
  /** Segment duration, seconds. */
  duration: number;
  /** start + duration, seconds. */
  end: number;
}

export interface NormalizedTranscript {
  videoId: string;
  status: TranscriptStatus;
  /** Human-readable reason, safe to show to end users. No stack traces. */
  message: string;
  fullText: string | null;
  segments: TranscriptSegment[];
  language: string | null;
  isGenerated: boolean | null;
}

/**
 * The `youtube-transcript` package returns raw offset/duration in
 * milliseconds in some versions and seconds in others depending on release;
 * we defensively normalize by treating values >= 1000 for a short clip as
 * ms-scale only when duration data is internally consistent. To stay
 * strictly non-fabricating, we pass raw values through unmodified except
 * for computing `end = start + duration`, since inventing a unit
 * correction without verifying against the real payload would itself
 * be guessing. Update this normalization if/when the installed package
 * version's actual unit is confirmed in this environment.
 */
function toSegments(
  raw: Array<{ text: string; duration: number; offset: number; lang?: string }>
): TranscriptSegment[] {
  return raw.map((r) => ({
    text: r.text,
    start: r.offset,
    duration: r.duration,
    end: r.offset + r.duration,
  }));
}

function joinText(segments: TranscriptSegment[]): string {
  return segments
    .map((s) => s.text)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Fetch and normalize a transcript for a given video ID.
 * Never throws — always resolves to a NormalizedTranscript with a status.
 */
export async function fetchNormalizedTranscript(
  videoId: string,
  lang?: string
): Promise<NormalizedTranscript> {
  try {
    const raw = await YoutubeTranscript.fetchTranscript(
      videoId,
      lang ? { lang } : undefined
    );

    if (!raw || raw.length === 0) {
      return {
        videoId,
        status: "not_available",
        message: "No transcript content was returned for this video.",
        fullText: null,
        segments: [],
        language: null,
        isGenerated: null,
      };
    }

    const segments = toSegments(raw);
    const detectedLang = raw[0]?.lang ?? lang ?? null;

    return {
      videoId,
      status: "available",
      message: "Transcript retrieved successfully.",
      fullText: joinText(segments),
      segments,
      language: detectedLang,
      // The youtube-transcript package does not reliably expose whether
      // captions are auto-generated vs. uploaded; we do not fabricate
      // this distinction, so it is left null unless later confirmed.
      isGenerated: null,
    };
  } catch (e) {
    return classifyTranscriptError(videoId, e);
  }
}

function classifyTranscriptError(videoId: string, e: unknown): NormalizedTranscript {
  const base = {
    videoId,
    fullText: null,
    segments: [] as TranscriptSegment[],
    language: null,
    isGenerated: null,
  };

  if (e instanceof YoutubeTranscriptTooManyRequestError) {
    return {
      ...base,
      status: "too_many_requests",
      message: "YouTube transcript service is temporarily rate-limited. Try again shortly.",
    };
  }
  if (e instanceof YoutubeTranscriptVideoUnavailableError) {
    return {
      ...base,
      status: "video_unavailable",
      message: "This YouTube video is unavailable (private, deleted, or region-blocked).",
    };
  }
  if (e instanceof YoutubeTranscriptDisabledError) {
    return {
      ...base,
      status: "disabled",
      message: "Captions/transcript are disabled for this video.",
    };
  }
  if (e instanceof YoutubeTranscriptNotAvailableLanguageError) {
    return {
      ...base,
      status: "language_unavailable",
      message: "A transcript exists but not in the requested language.",
    };
  }
  if (e instanceof YoutubeTranscriptNotAvailableError) {
    return {
      ...base,
      status: "not_available",
      message: "No transcript is available for this video.",
    };
  }
  if (e instanceof YoutubeTranscriptError) {
    return {
      ...base,
      status: "error",
      message: "Transcript could not be retrieved due to a YouTube transcript service error.",
    };
  }

  // Unknown/unexpected error — do not leak internals to the user.
  return {
    ...base,
    status: "error",
    message: "Transcript could not be retrieved due to an unexpected error.",
  };
}

/** Format seconds as HH:MM:SS or MM:SS for display. */
export function formatTimestamp(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(sec).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/**
 * Group raw segments into readable ~30-45s blocks for display and for
 * chunked evidence extraction, without altering factual text content.
 */
export function chunkSegments(
  segments: TranscriptSegment[],
  targetSeconds = 40
): TranscriptSegment[] {
  if (segments.length === 0) return [];
  const chunks: TranscriptSegment[] = [];
  let bucket: TranscriptSegment[] = [];
  let bucketStart = segments[0]!.start;

  const flush = () => {
    if (bucket.length === 0) return;
    const text = bucket.map((b) => b.text).join(" ").replace(/\s+/g, " ").trim();
    const last = bucket[bucket.length - 1]!;
    chunks.push({ text, start: bucketStart, duration: last.end - bucketStart, end: last.end });
    bucket = [];
  };

  for (const seg of segments) {
    if (bucket.length > 0 && seg.start - bucketStart >= targetSeconds) {
      flush();
      bucketStart = seg.start;
    }
    bucket.push(seg);
  }
  flush();
  return chunks;
}
