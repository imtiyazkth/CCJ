/**
 * CCJ Security Middleware
 *
 * Covers:
 * - SSRF protection (block private IPs, localhost, cloud metadata endpoints)
 * - Request validation
 * - Security headers (CSP, HSTS, etc.)
 * - Secret redaction from logs
 */

import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import { isIP } from "net";
import { lookup as dnsLookup } from "dns/promises";

// ── SSRF Protection ───────────────────────────────────────────

/** Private/reserved IP ranges that must never be fetched */
const BLOCKED_CIDR_PREFIXES = [
  "10.",
  "172.16.", "172.17.", "172.18.", "172.19.", "172.20.", "172.21.",
  "172.22.", "172.23.", "172.24.", "172.25.", "172.26.", "172.27.",
  "172.28.", "172.29.", "172.30.", "172.31.",
  "192.168.",
  "127.",
  "0.",
  "169.254.",  // Link-local / AWS metadata
  "::1",
  "fc00:", "fd",
  "fe80:",
];

/** Blocked hostnames — cloud metadata endpoints and localhost */
const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "metadata.google.internal",
  "169.254.169.254",           // AWS/GCP/Azure IMDS
  "metadata.azure.internal",
  "100.100.100.200",           // Alibaba Cloud metadata
]);

/** Blocked URL schemes */
const ALLOWED_SCHEMES = new Set(["http:", "https:"]);

export function isPrivateIp(ip: string): boolean {
  const cleanIp = ip.replace(/^\[|\]$/g, ""); // strip IPv6 brackets
  for (const prefix of BLOCKED_CIDR_PREFIXES) {
    if (cleanIp.startsWith(prefix)) return true;
  }
  return false;
}

/**
 * Validate a URL is safe to fetch.
 * Resolves DNS and checks the resolved IP.
 * Throws if the URL is disallowed.
 */
export async function validateFetchUrl(rawUrl: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new HTTPException(400, { message: "Invalid URL format" });
  }

  if (!ALLOWED_SCHEMES.has(url.protocol)) {
    throw new HTTPException(400, { message: `URL scheme not allowed: ${url.protocol}` });
  }

  const hostname = url.hostname.toLowerCase();

  if (BLOCKED_HOSTNAMES.has(hostname)) {
    throw new HTTPException(403, { message: "URL target is not allowed" });
  }

  // Reject raw IP literals that are private
  if (isIP(hostname) !== 0 && isPrivateIp(hostname)) {
    throw new HTTPException(403, { message: "URL resolves to a private address" });
  }

  // DNS resolution check — prevent DNS rebinding
  try {
    const addresses = await dnsLookup(hostname, { all: true });
    for (const { address } of addresses) {
      if (isPrivateIp(address)) {
        throw new HTTPException(403, {
          message: "URL resolves to a private or reserved address",
        });
      }
    }
  } catch (err) {
    if (err instanceof HTTPException) throw err;
    throw new HTTPException(400, { message: "Could not resolve URL hostname" });
  }

  return url;
}

// ── Security Headers Middleware ────────────────────────────────

export async function securityHeaders(c: Context, next: Next) {
  await next();

  c.header("X-Content-Type-Options", "nosniff");
  c.header("X-Frame-Options", "DENY");
  c.header("X-XSS-Protection", "0"); // rely on CSP instead
  c.header("Referrer-Policy", "strict-origin-when-cross-origin");
  c.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  c.header(
    "Content-Security-Policy",
    [
      "default-src 'none'",
      "script-src 'none'",
      "connect-src 'none'",
      "img-src 'none'",
      "style-src 'none'",
      "frame-ancestors 'none'",
      "base-uri 'none'",
      "form-action 'none'",
    ].join("; ")
  );

  const isProduction = process.env["NODE_ENV"] === "production";
  if (isProduction) {
    c.header("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");
  }
}

// ── Secret Redaction ──────────────────────────────────────────

/** Patterns of log fields that may contain secrets */
const SECRET_KEY_PATTERNS = [
  /password/i,
  /secret/i,
  /api[_-]?key/i,
  /token/i,
  /authorization/i,
  /credential/i,
  /private[_-]?key/i,
];

export function redactSecrets(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (SECRET_KEY_PATTERNS.some((p) => p.test(key))) {
      result[key] = "[REDACTED]";
    } else if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      result[key] = redactSecrets(value as Record<string, unknown>);
    } else {
      result[key] = value;
    }
  }
  return result;
}

// ── Upload Validation ─────────────────────────────────────────

/** Max upload size: 50 MB */
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

/** Allowed MIME types for uploads */
export const ALLOWED_UPLOAD_MIME_TYPES = new Set([
  "application/pdf",
  "text/plain",
  "text/html",
  "image/png",
  "image/jpeg",
  "image/webp",
  "video/mp4",
  "application/json",
]);

/** Magic bytes for file signature validation */
const FILE_SIGNATURES: Array<{ mime: string; bytes: Uint8Array }> = [
  { mime: "application/pdf", bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]) }, // %PDF
  { mime: "image/png", bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]) },
  { mime: "image/jpeg", bytes: new Uint8Array([0xff, 0xd8, 0xff]) },
];

export function validateFileMagicBytes(buffer: Uint8Array, declaredMime: string): boolean {
  const sig = FILE_SIGNATURES.find((s) => s.mime === declaredMime);
  if (!sig) return true; // No signature rule — pass through to AV scan

  for (let i = 0; i < sig.bytes.length; i++) {
    if (buffer[i] !== sig.bytes[i]) return false;
  }
  return true;
}

// ── IP Anonymisation for Audit Log ────────────────────────────

/** Keep only the first two octets of IPv4 for audit log (privacy). */
export function anonymiseIp(ip: string): string {
  if (!ip) return "unknown";
  const parts = ip.split(".");
  if (parts.length === 4) {
    return `${parts[0]}.${parts[1]}.x.x`;
  }
  // IPv6 — keep prefix only
  const ipv6Parts = ip.split(":");
  return ipv6Parts.slice(0, 4).join(":") + ":xxxx:xxxx:xxxx:xxxx";
}
