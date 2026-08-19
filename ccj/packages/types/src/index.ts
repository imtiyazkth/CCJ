/**
 * @ccj/types — Shared domain types for CCJ.
 * All layers (API, web, workers) import from here.
 * No runtime dependencies — types only.
 */

// ══════════════════════════════════════════════════════════════
// LOCALE / I18N
// ══════════════════════════════════════════════════════════════

export const SUPPORTED_LOCALES = ["en", "hi", "ar"] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

export const RTL_LOCALES: SupportedLocale[] = ["ar"];

export interface LocaleConfig {
  /** Locale code — e.g. "en", "hi", "ar" */
  code: SupportedLocale;
  /** Human-readable name in that language */
  nativeName: string;
  /** LTR or RTL */
  direction: "ltr" | "rtl";
  /** IETF BCP 47 tag — e.g. "en-US", "hi-IN", "ar-SA" */
  bcp47: string;
}

/**
 * Every project stores five separate locale dimensions.
 * This prevents conflating UI language with research language.
 */
export interface ProjectLocales {
  /** Language of the application UI for this session */
  uiLocale: SupportedLocale;
  /** Language the user typed the prompt in (auto-detected) */
  promptLocale: SupportedLocale;
  /** Canonical locale for this project's dossier */
  projectLocale: SupportedLocale;
  /** Language for generated output (defaults to promptLocale) */
  outputLocale: SupportedLocale;
  /** Primary language of the source material being researched */
  sourceLanguage: SupportedLocale | string;
}

// ══════════════════════════════════════════════════════════════
// USER / AUTH
// ══════════════════════════════════════════════════════════════

export type UserRole = "owner" | "editor" | "viewer";

export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  uiLocale: SupportedLocale;
  createdAt: string; // ISO-8601
  updatedAt: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: string; // ISO-8601
}

// ══════════════════════════════════════════════════════════════
// PROJECT
// ══════════════════════════════════════════════════════════════

export type ProjectStatus = "draft" | "active" | "archived";

export interface Project {
  id: string;
  userId: string;
  title: string;
  description: string | null;
  status: ProjectStatus;
  locales: ProjectLocales;
  createdAt: string;
  updatedAt: string;
}

export interface CreateProjectInput {
  title: string;
  description?: string;
  locales?: Partial<ProjectLocales>;
}

// ══════════════════════════════════════════════════════════════
// RESEARCH
// ══════════════════════════════════════════════════════════════

export type ResearchDepth = "quick" | "standard" | "deep";
export type ResearchRunStatus =
  | "pending"
  | "planning"
  | "searching"
  | "fetching"
  | "extracting"
  | "analysing"
  | "complete"
  | "failed";

export interface ResearchRun {
  id: string;
  projectId: string;
  version: number;
  status: ResearchRunStatus;
  depth: ResearchDepth;
  topic: string;
  dateRangeStart: string | null;
  dateRangeEnd: string | null;
  requestedLanguage: SupportedLocale;
  researchPlan: ResearchPlan | null;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface ResearchPlan {
  researchQuestions: string[];
  queries: SearchQuery[];
  primarySourceTargets: string[];
  secondarySourceTargets: string[];
  socialSourceTargets: string[];
  legalQuestions: string[];
  expectedEntities: string[];
  dateRange: { start: string | null; end: string | null };
  riskFlags: string[];
}

export interface SearchQuery {
  query: string;
  language: string;
  provider: SearchProvider;
  priority: number;
}

export type SearchProvider = "searxng" | "brave" | "tavily";

export interface TriggerResearchInput {
  topic: string;
  depth?: ResearchDepth;
  dateRangeStart?: string;
  dateRangeEnd?: string;
  requestedLanguage?: SupportedLocale;
}

// ══════════════════════════════════════════════════════════════
// SOURCE MODEL
// Every source must have all these fields (spec requirement).
// ══════════════════════════════════════════════════════════════

export type SourceType =
  | "webpage"
  | "pdf"
  | "video"
  | "news"
  | "social"
  | "legal_document"
  | "official_statement"
  | "academic"
  | "user_upload";

export type CredibilityTier =
  | "primary"    // Official statements, primary documents
  | "verified"   // Major news orgs, peer-reviewed
  | "credible"   // Established outlets
  | "reported"   // Reported but not independently confirmed
  | "unknown"    // Cannot assess
  | "disputed";  // Known credibility issues

export type AccessMethod =
  | "public_web"
  | "rss"
  | "user_upload"
  | "api"
  | "youtube";

export interface Source {
  id: string;
  researchRunId: string;
  url: string;
  canonicalUrl: string;
  domain: string;
  title: string;
  author: string | null;
  publishedAt: string | null;
  retrievedAt: string;
  language: string;
  sourceType: SourceType;
  credibilityTier: CredibilityTier;
  accessMethod: AccessMethod;
  contentHash: string;
  rawArtifactId: string | null;
  extractedArtifactId: string | null;
}

// ══════════════════════════════════════════════════════════════
// EVIDENCE MODEL
// ══════════════════════════════════════════════════════════════

export interface Evidence {
  id: string;
  sourceId: string;
  /** For PDFs/documents — page number */
  pageNumber: number | null;
  /** Section heading or anchor */
  section: string | null;
  /** Exact quote or excerpt — never paraphrased */
  quote: string;
  /** For image/PDF — bounding box {x,y,w,h} */
  coordinates: BoundingBox | null;
  capturedAt: string;
  /** 0.0–1.0 extraction confidence */
  confidence: number;
  language: string;
  /** Warnings from the extraction agent */
  extractionWarnings: string[];
}

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
  page?: number;
}

// ══════════════════════════════════════════════════════════════
// CLAIM MODEL
// ══════════════════════════════════════════════════════════════

export type ClaimType =
  | "fact"
  | "reported"
  | "opinion"
  | "analysis"
  | "legal_interpretation"
  | "inference"
  | "statistic";

/** All statuses per spec. verified requires actual evidence support. */
export type ClaimStatus =
  | "verified"
  | "strongly_correlated"
  | "reported"
  | "disputed"
  | "unverified"
  | "opinion"
  | "inference"
  | "outdated";

export interface Claim {
  id: string;
  projectId: string;
  claimText: string;
  claimType: ClaimType;
  status: ClaimStatus;
  /** 0.0–1.0 */
  confidence: number;
  supportingEvidenceIds: string[];
  contradictingEvidenceIds: string[];
  reasoningSummary: string | null;
  whatIsMissing: string | null;
  createdAt: string;
  updatedAt: string;
}

// ══════════════════════════════════════════════════════════════
// DOSSIER
// ══════════════════════════════════════════════════════════════

export type DossierCardType =
  | "summary"
  | "timeline"
  | "contradiction"
  | "gap"
  | "legal"
  | "source_analysis"
  | "key_claim";

export interface DossierCard {
  id: string;
  projectId: string;
  researchRunId: string;
  cardType: DossierCardType;
  title: string;
  body: string;
  claimIds: string[];
  sourceIds: string[];
  evidenceIds: string[];
  locale: SupportedLocale;
  createdAt: string;
}

// ══════════════════════════════════════════════════════════════
// AUDIT LOG
// ══════════════════════════════════════════════════════════════

export type AuditAction =
  | "create"
  | "update"
  | "delete"
  | "import"
  | "export"
  | "translate"
  | "verify"
  | "dispute";

export interface AuditLogEntry {
  id: string;
  userId: string;
  resourceType: string;
  resourceId: string;
  action: AuditAction;
  diff: Record<string, unknown> | null;
  ipAddress: string | null;
  createdAt: string;
}

// ══════════════════════════════════════════════════════════════
// API RESPONSE ENVELOPES
// ══════════════════════════════════════════════════════════════

export interface ApiSuccess<T> {
  success: true;
  data: T;
  meta?: Record<string, unknown>;
}

export interface ApiError {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export type ApiResponse<T> = ApiSuccess<T> | ApiError;

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  perPage: number;
  hasNext: boolean;
}

// ── Extended fields used in API responses ─────────────────────
// These fields exist in the DB schema but were missing from the shared types.

export interface ResearchRunExtended extends ResearchRun {
  progressPct: number;
}

export interface SourceExtended extends Source {
  isDemo: boolean;
}

export interface EvidenceExtended extends Evidence {
  isDemo: boolean;
}

export interface ClaimExtended extends Claim {
  isDemo: boolean;
}

export interface DossierCardExtended extends DossierCard {
  isDemo: boolean;
}
