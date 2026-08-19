/**
 * CCJ API — Security Middleware Tests
 * validateFetchUrl is async (DNS resolution) — use rejects.toThrow().
 */
import { describe, it, expect } from "vitest";
import { isPrivateIp, validateFetchUrl } from "../middleware/security.js";

// ── isPrivateIp (synchronous) ─────────────────────────────────
describe("isPrivateIp", () => {
  it("blocks 10.x.x.x",          () => expect(isPrivateIp("10.0.0.1")).toBe(true));
  it("blocks 192.168.x.x",       () => expect(isPrivateIp("192.168.1.1")).toBe(true));
  it("blocks 172.16.x.x",        () => expect(isPrivateIp("172.16.0.1")).toBe(true));
  it("blocks 127.0.0.1",         () => expect(isPrivateIp("127.0.0.1")).toBe(true));
  it("blocks 169.254.x.x",       () => expect(isPrivateIp("169.254.169.254")).toBe(true));
  it("blocks ::1",                () => expect(isPrivateIp("::1")).toBe(true));
  it("allows 8.8.8.8",           () => expect(isPrivateIp("8.8.8.8")).toBe(false));
  it("allows 1.1.1.1",           () => expect(isPrivateIp("1.1.1.1")).toBe(false));
});

// ── validateFetchUrl (async — throws HTTPException as rejected Promise) ───────
describe("validateFetchUrl — scheme checks", () => {
  it("throws on file://", () =>
    expect(validateFetchUrl("file:///etc/passwd")).rejects.toThrow());
  it("throws on ftp://", () =>
    expect(validateFetchUrl("ftp://files.example.com/data")).rejects.toThrow());
  it("throws on empty string", () =>
    expect(validateFetchUrl("")).rejects.toThrow());
  it("throws on invalid URL", () =>
    expect(validateFetchUrl("not_a_url")).rejects.toThrow());
});

describe("validateFetchUrl — blocked hostnames", () => {
  it("throws on localhost", () =>
    expect(validateFetchUrl("http://localhost/admin")).rejects.toThrow());
  it("throws on 169.254.169.254 (AWS IMDS)", () =>
    expect(validateFetchUrl("http://169.254.169.254/latest/meta-data/")).rejects.toThrow());
  it("throws on metadata.google.internal", () =>
    expect(validateFetchUrl("http://metadata.google.internal/")).rejects.toThrow());
  it("throws on 127.0.0.1", () =>
    expect(validateFetchUrl("http://127.0.0.1:8080/secret")).rejects.toThrow());
  it("throws on raw 10.0.0.1", () =>
    expect(validateFetchUrl("http://10.0.0.1/internal")).rejects.toThrow());
  it("throws on raw 192.168.1.1", () =>
    expect(validateFetchUrl("http://192.168.1.1/router")).rejects.toThrow());
});
