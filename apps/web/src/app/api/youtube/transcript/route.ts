import { NextRequest } from "next/server";
import { requireUser, ok, err } from "@/lib/auth.server";
import { extractYouTubeVideoId } from "@/lib/youtube/url";
import { fetchNormalizedTranscript, formatTimestamp } from "@/lib/youtube/transcript";

/**
 * POST /api/youtube/transcript
 * Body: { url: string }
 *
 * Lightweight preview endpoint — fetches and normalizes a transcript
 * without creating a research run/source/evidence/claims. Useful for a
 * "preview transcript before ingesting" UI action.
 */
export async function POST(req: NextRequest) {
  try {
    await requireUser(req); // require auth, but this endpoint is not project-scoped

    const body = await req.json() as { url?: string };
    if (!body.url?.trim()) return err("url is required", 400);

    const ref = extractYouTubeVideoId(body.url.trim());
    if (!ref) {
      return err("Not a recognized YouTube video URL", 400);
    }

    const transcript = await fetchNormalizedTranscript(ref.videoId);

    return ok({
      videoId: ref.videoId,
      canonicalUrl: ref.canonicalUrl,
      videoType: ref.videoType,
      status: transcript.status,
      message: transcript.message,
      language: transcript.language,
      segmentCount: transcript.segments.length,
      // Return a bounded preview, not the full transcript, to keep the
      // response light; full text is available via the research pipeline
      // once ingested as evidence.
      preview: transcript.fullText?.slice(0, 1000) ?? null,
      segments: transcript.segments.slice(0, 5).map(s => ({
        timestamp: formatTimestamp(s.start),
        text: s.text,
      })),
    });
  } catch (r) {
    if (r instanceof Response) return r;
    return err(String(r), 500);
  }
}
