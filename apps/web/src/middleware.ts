/**
 * CCJ Web Middleware
 * Handles: locale detection/redirect, auth session, RTL header.
 */

import { NextRequest, NextResponse } from "next/server";
import { SUPPORTED_LOCALES, RTL_LOCALES } from "@ccj/types";
import type { SupportedLocale } from "@ccj/types";

const DEFAULT_LOCALE: SupportedLocale = "en";
const PUBLIC_PATHS = ["/api", "/_next", "/favicon.ico", "/icons", "/manifest.json"];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Skip middleware for static/API paths
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  // ── Locale Detection ────────────────────────────────────────

  // Check if pathname already has a locale prefix
  const pathnameLocale = SUPPORTED_LOCALES.find(
    (locale) => pathname.startsWith(`/${locale}/`) || pathname === `/${locale}`
  );

  if (pathnameLocale) {
    // Locale already in path — set direction header
    const response = NextResponse.next();
    response.headers.set(
      "x-locale",
      pathnameLocale
    );
    if ((RTL_LOCALES as readonly string[]).includes(pathnameLocale)) {
      response.headers.set("x-direction", "rtl");
    }
    return response;
  }

  // Detect locale from Accept-Language or cookie
  const cookieLocale = request.cookies.get("ccj-locale")?.value as SupportedLocale | undefined;
  const acceptLanguage = request.headers.get("accept-language") ?? "";
  const detectedLocale = cookieLocale ?? detectLocaleFromHeader(acceptLanguage) ?? DEFAULT_LOCALE;

  // Redirect to locale-prefixed path
  const url = request.nextUrl.clone();
  url.pathname = `/${detectedLocale}${pathname}`;
  return NextResponse.redirect(url);
}

function detectLocaleFromHeader(header: string): SupportedLocale | null {
  const tags = header
    .split(",")
    .map((tag) => tag.split(";")[0]?.trim().toLowerCase().slice(0, 2))
    .filter(Boolean) as string[];

  for (const tag of tags) {
    const match = SUPPORTED_LOCALES.find((l) => l === tag);
    if (match) return match;
  }
  return null;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
  // Force Node.js runtime instead of Edge runtime. The Edge runtime's
  // sandbox uses Node's `vm`/runInContext internally, which requires
  // V8 code-generation-from-strings — this is blocked in some restricted
  // environments (e.g. Next.js dev server running inside Termux on
  // Android), causing "Code generation from strings disallowed for this
  // context". This middleware does nothing Edge-specific, so nodejs
  // runtime is safe here. Confirmed fixing this exact error on-device.
  runtime: "nodejs",
};
