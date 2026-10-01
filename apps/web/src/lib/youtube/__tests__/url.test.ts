import { describe, it, expect } from "vitest";
import { extractYouTubeVideoId, findYouTubeUrlsInText, youtubeTimestampUrl } from "../url";

const VALID_ID = "dQw4w9WgXcQ";

describe("extractYouTubeVideoId", () => {
  it("parses a standard watch URL", () => {
    const ref = extractYouTubeVideoId(`https://www.youtube.com/watch?v=${VALID_ID}`);
    expect(ref?.videoId).toBe(VALID_ID);
    expect(ref?.videoType).toBe("video");
  });

  it("parses a bare-domain watch URL (no www)", () => {
    const ref = extractYouTubeVideoId(`https://youtube.com/watch?v=${VALID_ID}`);
    expect(ref?.videoId).toBe(VALID_ID);
  });

  it("parses a youtu.be short link", () => {
    const ref = extractYouTubeVideoId(`https://youtu.be/${VALID_ID}`);
    expect(ref?.videoId).toBe(VALID_ID);
  });

  it("parses a Shorts URL and marks videoType 'short'", () => {
    const ref = extractYouTubeVideoId(`https://youtube.com/shorts/${VALID_ID}`);
    expect(ref?.videoId).toBe(VALID_ID);
    expect(ref?.videoType).toBe("short");
  });

  it("parses a Shorts URL with www", () => {
    const ref = extractYouTubeVideoId(`https://www.youtube.com/shorts/${VALID_ID}`);
    expect(ref?.videoId).toBe(VALID_ID);
    expect(ref?.videoType).toBe("short");
  });

  it("parses an embed URL", () => {
    const ref = extractYouTubeVideoId(`https://www.youtube.com/embed/${VALID_ID}`);
    expect(ref?.videoId).toBe(VALID_ID);
  });

  it("parses a mobile (m.youtube.com) URL", () => {
    const ref = extractYouTubeVideoId(`https://m.youtube.com/watch?v=${VALID_ID}`);
    expect(ref?.videoId).toBe(VALID_ID);
  });

  it("strips ?si= tracking params without affecting parsing", () => {
    const ref = extractYouTubeVideoId(`https://youtu.be/${VALID_ID}?si=TYPYwkWghGIWWaqx`);
    expect(ref?.videoId).toBe(VALID_ID);
  });

  it("parses &t= seconds param into startSeconds", () => {
    const ref = extractYouTubeVideoId(`https://www.youtube.com/watch?v=${VALID_ID}&t=84s`);
    expect(ref?.startSeconds).toBe(84);
  });

  it("parses &t= long-form (1h2m3s) param into startSeconds", () => {
    const ref = extractYouTubeVideoId(`https://www.youtube.com/watch?v=${VALID_ID}&t=1h2m3s`);
    expect(ref?.startSeconds).toBe(3723);
  });

  it("returns null for a completely invalid string", () => {
    expect(extractYouTubeVideoId("not a url at all")).toBeNull();
  });

  it("returns null for a non-YouTube domain containing 'youtube' in the path", () => {
    expect(extractYouTubeVideoId("https://evil.com/youtube.com/watch?v=" + VALID_ID)).toBeNull();
  });

  it("returns null for a YouTube URL missing a video id", () => {
    expect(extractYouTubeVideoId("https://www.youtube.com/watch")).toBeNull();
  });

  it("returns null for an id that isn't 11 characters", () => {
    expect(extractYouTubeVideoId("https://youtu.be/short")).toBeNull();
  });

  it("accepts a bare domain without protocol", () => {
    const ref = extractYouTubeVideoId(`youtu.be/${VALID_ID}`);
    expect(ref?.videoId).toBe(VALID_ID);
  });
});

describe("findYouTubeUrlsInText", () => {
  it("finds a single URL embedded in a research topic", () => {
    const refs = findYouTubeUrlsInText(`check this out https://youtu.be/${VALID_ID} thanks`);
    expect(refs).toHaveLength(1);
    expect(refs[0]?.videoId).toBe(VALID_ID);
  });

  it("returns [] when there is no YouTube URL", () => {
    expect(findYouTubeUrlsInText("Why does Assam flood every year?")).toEqual([]);
  });

  it("deduplicates the same video id appearing twice", () => {
    const refs = findYouTubeUrlsInText(
      `https://youtu.be/${VALID_ID} and also https://www.youtube.com/watch?v=${VALID_ID}`
    );
    expect(refs).toHaveLength(1);
  });
});

describe("youtubeTimestampUrl", () => {
  it("builds a deep link with the given second offset", () => {
    expect(youtubeTimestampUrl(VALID_ID, 84)).toBe(
      `https://www.youtube.com/watch?v=${VALID_ID}&t=84s`
    );
  });
});
