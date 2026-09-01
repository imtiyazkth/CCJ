import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the youtube-transcript package's exports before importing our module,
// since we cannot install the real package in this offline environment.
// The shape below (fetchTranscript static method + named error classes)
// matches the package's documented, published API.
vi.mock("youtube-transcript", () => {
  class YoutubeTranscriptError extends Error {}
  class YoutubeTranscriptTooManyRequestError extends YoutubeTranscriptError {}
  class YoutubeTranscriptVideoUnavailableError extends YoutubeTranscriptError {}
  class YoutubeTranscriptDisabledError extends YoutubeTranscriptError {}
  class YoutubeTranscriptNotAvailableError extends YoutubeTranscriptError {}
  class YoutubeTranscriptNotAvailableLanguageError extends YoutubeTranscriptError {}

  return {
    YoutubeTranscriptError,
    YoutubeTranscriptTooManyRequestError,
    YoutubeTranscriptVideoUnavailableError,
    YoutubeTranscriptDisabledError,
    YoutubeTranscriptNotAvailableError,
    YoutubeTranscriptNotAvailableLanguageError,
    YoutubeTranscript: {
      fetchTranscript: vi.fn(),
    },
  };
});

import { YoutubeTranscript } from "youtube-transcript";
import {
  fetchNormalizedTranscript,
  chunkSegments,
  formatTimestamp,
} from "../transcript";

const mockFetch = YoutubeTranscript.fetchTranscript as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockFetch.mockReset();
});

describe("fetchNormalizedTranscript — success path", () => {
  it("normalizes a successful transcript response", async () => {
    mockFetch.mockResolvedValueOnce([
      { text: "Hello there.", duration: 2, offset: 0, lang: "en" },
      { text: "This is a test.", duration: 3, offset: 2, lang: "en" },
    ]);

    const result = await fetchNormalizedTranscript("abc12345678");
    expect(result.status).toBe("available");
    expect(result.fullText).toBe("Hello there. This is a test.");
    expect(result.segments).toHaveLength(2);
    expect(result.segments[0]).toMatchObject({ text: "Hello there.", start: 0, duration: 2, end: 2 });
    expect(result.language).toBe("en");
  });

  it("never fabricates content when the package returns an empty array", async () => {
    mockFetch.mockResolvedValueOnce([]);
    const result = await fetchNormalizedTranscript("abc12345678");
    expect(result.status).toBe("not_available");
    expect(result.fullText).toBeNull();
    expect(result.segments).toEqual([]);
  });
});

describe("fetchNormalizedTranscript — error mapping", () => {
  it("maps TooManyRequest to too_many_requests", async () => {
    const { YoutubeTranscriptTooManyRequestError } = await import("youtube-transcript");
    // Constructor arity/signature varies by installed package version; we only
    // care about `instanceof` matching for status classification, so construct
    // via `as any` rather than guessing the exact real-world argument list.
    mockFetch.mockRejectedValueOnce(new (YoutubeTranscriptTooManyRequestError as any)());
    const result = await fetchNormalizedTranscript("abc12345678");
    expect(result.status).toBe("too_many_requests");
    expect(result.fullText).toBeNull();
  });

  it("maps VideoUnavailable to video_unavailable", async () => {
    const { YoutubeTranscriptVideoUnavailableError } = await import("youtube-transcript");
    mockFetch.mockRejectedValueOnce(new (YoutubeTranscriptVideoUnavailableError as any)());
    const result = await fetchNormalizedTranscript("abc12345678");
    expect(result.status).toBe("video_unavailable");
  });

  it("maps Disabled to disabled", async () => {
    const { YoutubeTranscriptDisabledError } = await import("youtube-transcript");
    mockFetch.mockRejectedValueOnce(new (YoutubeTranscriptDisabledError as any)());
    const result = await fetchNormalizedTranscript("abc12345678");
    expect(result.status).toBe("disabled");
  });

  it("maps NotAvailableLanguage to language_unavailable", async () => {
    const { YoutubeTranscriptNotAvailableLanguageError } = await import("youtube-transcript");
    mockFetch.mockRejectedValueOnce(new (YoutubeTranscriptNotAvailableLanguageError as any)());
    const result = await fetchNormalizedTranscript("abc12345678", "fr");
    expect(result.status).toBe("language_unavailable");
  });

  it("maps NotAvailable to not_available", async () => {
    const { YoutubeTranscriptNotAvailableError } = await import("youtube-transcript");
    mockFetch.mockRejectedValueOnce(new (YoutubeTranscriptNotAvailableError as any)());
    const result = await fetchNormalizedTranscript("abc12345678");
    expect(result.status).toBe("not_available");
  });

  it("maps a generic YoutubeTranscriptError to error", async () => {
    const { YoutubeTranscriptError } = await import("youtube-transcript");
    mockFetch.mockRejectedValueOnce(new YoutubeTranscriptError("generic"));
    const result = await fetchNormalizedTranscript("abc12345678");
    expect(result.status).toBe("error");
  });

  it("maps a totally unexpected thrown value to error without leaking internals", async () => {
    mockFetch.mockRejectedValueOnce(new TypeError("some internal stack trace detail"));
    const result = await fetchNormalizedTranscript("abc12345678");
    expect(result.status).toBe("error");
    expect(result.message).not.toContain("stack trace");
  });
});

describe("chunkSegments", () => {
  it("groups segments into ~targetSeconds buckets without losing text", () => {
    const segments = [
      { text: "a", start: 0, duration: 10, end: 10 },
      { text: "b", start: 10, duration: 10, end: 20 },
      { text: "c", start: 20, duration: 10, end: 30 },
      { text: "d", start: 45, duration: 10, end: 55 },
    ];
    const chunks = chunkSegments(segments, 40);
    // First three segments span 0-30s (< 40s target) → one chunk;
    // the 4th starts at 45s, >= 40s from bucket start → new chunk.
    expect(chunks).toHaveLength(2);
    expect(chunks[0]?.text).toBe("a b c");
    expect(chunks[1]?.text).toBe("d");
  });

  it("returns [] for empty input", () => {
    expect(chunkSegments([])).toEqual([]);
  });
});

describe("formatTimestamp", () => {
  it("formats under an hour as MM:SS", () => {
    expect(formatTimestamp(84)).toBe("01:24");
  });

  it("formats over an hour as H:MM:SS", () => {
    expect(formatTimestamp(3723)).toBe("1:02:03");
  });
});
