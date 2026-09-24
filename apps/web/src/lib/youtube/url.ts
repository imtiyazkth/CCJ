/**
 * CCJ — YouTube URL Detection
 *
 * Robust, allow-listed hostname parsing. Does NOT accept an arbitrary
 * domain just because "youtube" appears somewhere in the string.
 */

export interface YouTubeVideoRef {
  videoId: string;
  /** The URL exactly as the user/topic string provided it. */
  url: string;
  /** Canonical https://www.youtube.com/watch?v=ID form, for storage/dedup. */
  canonicalUrl: string;
  videoType: "video" | "short";
  /** Seconds offset if a `t=`/`start=` timestamp was present in the URL. */
  startSeconds: number | null;
}

const ALLOWED_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtu.be",
]);

// A YouTube video ID is 11 chars of [A-Za-z0-9_-].
const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

function parseTimeParam(raw: string | null): number | null {
  if (!raw) return null;
  // Plain seconds: "t=84" or "t=84s"
  const plain = raw.match(/^(\d+)s?$/);
  if (plain) return parseInt(plain[1]!, 10);
  // YouTube long form: "t=1h2m3s"
  const long = raw.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
  if (long && (long[1] || long[2] || long[3])) {
    const h = parseInt(long[1] ?? "0", 10);
    const m = parseInt(long[2] ?? "0", 10);
    const s = parseInt(long[3] ?? "0", 10);
    return h * 3600 + m * 60 + s;
  }
  return null;
}

function buildCanonical(videoId: string, startSeconds: number | null): string {
  const base = `https://www.youtube.com/watch?v=${videoId}`;
  return startSeconds ? `${base}&t=${startSeconds}s` : base;
}

/**
 * Extract a validated YouTube video reference from a URL string.
 * Returns null if the string is not a recognizable, valid YouTube video URL.
 */
export function extractYouTubeVideoId(input: string): YouTubeVideoRef | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  let parsed: URL;
  try {
    // Allow bare "youtube.com/..." without protocol.
    parsed = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }

  const host = parsed.hostname.toLowerCase();
  if (!ALLOWED_HOSTS.has(host)) return null;

  let videoId: string | null = null;
  let videoType: "video" | "short" = "video";

  if (host === "youtu.be") {
    // https://youtu.be/VIDEO_ID
    const seg = parsed.pathname.split("/").filter(Boolean)[0];
    if (seg && VIDEO_ID_RE.test(seg)) videoId = seg;
  } else {
    const segments = parsed.pathname.split("/").filter(Boolean);

    if (parsed.pathname === "/watch") {
      const v = parsed.searchParams.get("v");
      if (v && VIDEO_ID_RE.test(v)) videoId = v;
    } else if (segments[0] === "shorts" && segments[1]) {
      if (VIDEO_ID_RE.test(segments[1])) {
        videoId = segments[1];
        videoType = "short";
      }
    } else if (segments[0] === "embed" && segments[1]) {
      if (VIDEO_ID_RE.test(segments[1])) videoId = segments[1];
    } else if (segments[0] === "v" && segments[1]) {
      if (VIDEO_ID_RE.test(segments[1])) videoId = segments[1];
    }
  }

  if (!videoId) return null;

  const startSeconds =
    parseTimeParam(parsed.searchParams.get("t")) ??
    parseTimeParam(parsed.searchParams.get("start"));

  return {
    videoId,
    url: trimmed,
    canonicalUrl: buildCanonical(videoId, startSeconds),
    videoType,
    startSeconds,
  };
}

/**
 * Scan free-form text (a research topic string) for any YouTube URLs.
 * Used so a topic like "check this out https://youtu.be/abc123..." still
 * triggers YouTube ingestion without the user submitting *only* a URL.
 */
export function findYouTubeUrlsInText(text: string): YouTubeVideoRef[] {
  const urlPattern = /https?:\/\/[^\s)"'<>]+/gi;
  const found = text.match(urlPattern) ?? [];
  const refs: YouTubeVideoRef[] = [];
  const seen = new Set<string>();

  for (const candidate of found) {
    const ref = extractYouTubeVideoId(candidate);
    if (ref && !seen.has(ref.videoId)) {
      seen.add(ref.videoId);
      refs.push(ref);
    }
  }
  return refs;
}

/** Build a deep link that opens the video at a specific second. */
export function youtubeTimestampUrl(videoId: string, seconds: number): string {
  return `https://www.youtube.com/watch?v=${videoId}&t=${Math.max(0, Math.floor(seconds))}s`;
}
