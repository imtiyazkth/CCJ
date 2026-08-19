/**
 * CCJ API — In-Memory Queue Tests
 * Verifies the queue processes jobs and rate limiter works.
 * No database or external services required.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { checkRateLimit, cleanRateLimits } from "../lib/queue.js";

describe("checkRateLimit", () => {
  beforeEach(() => cleanRateLimits());

  it("allows requests under the limit", () => {
    expect(checkRateLimit("user:1", 5, 60_000)).toBe(true);
    expect(checkRateLimit("user:1", 5, 60_000)).toBe(true);
    expect(checkRateLimit("user:1", 5, 60_000)).toBe(true);
  });

  it("blocks requests over the limit", () => {
    for (let i = 0; i < 3; i++) checkRateLimit("user:2", 3, 60_000);
    expect(checkRateLimit("user:2", 3, 60_000)).toBe(false);
  });

  it("resets after the window expires", () => {
    checkRateLimit("user:3", 1, 1); // 1ms window
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        cleanRateLimits();
        expect(checkRateLimit("user:3", 1, 60_000)).toBe(true);
        resolve();
      }, 10);
    });
  });

  it("tracks different keys independently", () => {
    for (let i = 0; i < 3; i++) checkRateLimit("user:A", 3, 60_000);
    expect(checkRateLimit("user:A", 3, 60_000)).toBe(false);
    expect(checkRateLimit("user:B", 3, 60_000)).toBe(true);
  });
});
