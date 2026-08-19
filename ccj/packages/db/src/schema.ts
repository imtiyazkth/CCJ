/**
 * CCJ Database Schema — Drizzle ORM
 *
 * IMPORTANT: public.users.id is NOT auto-generated.
 * It comes from auth.users.id (Supabase Auth).
 * The handle_auth_user_change() trigger populates it on signup.
 * No passwords are stored in public.users.
 */

import {
  pgTable, uuid, text, varchar, integer, smallint, boolean,
  timestamp, jsonb, real, pgEnum, uniqueIndex, index,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";

// ── Enums ────────────────────────────────────────────────────

export const userRoleEnum          = pgEnum("user_role",          ["owner", "editor", "viewer"]);
export const projectStatusEnum     = pgEnum("project_status",     ["draft", "active", "archived"]);
export const researchDepthEnum     = pgEnum("research_depth",     ["quick", "standard", "deep"]);
export const researchRunStatusEnum = pgEnum("research_run_status", [
  "pending", "planning", "searching", "fetching",
  "extracting", "analysing", "complete", "failed",
]);
export const sourceTypeEnum        = pgEnum("source_type", [
  "webpage", "pdf", "video", "news", "social",
  "legal_document", "official_statement", "academic", "user_upload",
]);
export const credibilityTierEnum   = pgEnum("credibility_tier", [
  "primary", "verified", "credible", "reported", "unknown", "disputed",
]);
export const accessMethodEnum      = pgEnum("access_method", [
  "public_web", "rss", "user_upload", "api", "youtube",
]);
export const claimTypeEnum         = pgEnum("claim_type", [
  "fact", "reported", "opinion", "analysis",
  "legal_interpretation", "inference", "statistic",
]);
export const claimStatusEnum       = pgEnum("claim_status", [
  "verified", "strongly_correlated", "reported",
  "disputed", "unverified", "opinion", "inference", "outdated",
]);
export const dossierCardTypeEnum   = pgEnum("dossier_card_type", [
  "summary", "timeline", "contradiction", "gap",
  "legal", "source_analysis", "key_claim",
]);
export const auditActionEnum       = pgEnum("audit_action", [
  "create", "update", "delete", "import", "export",
  "translate", "verify", "dispute",
]);

// ── Users ────────────────────────────────────────────────────
// id is the Supabase Auth UUID — set by trigger, NOT generated here.

export const users = pgTable("users", {
  id:            uuid("id").primaryKey(),           // from auth.users.id
  email:         varchar("email", { length: 320 }).notNull().unique(),
  name:          varchar("name", { length: 255 }).notNull(),
  role:          userRoleEnum("role").notNull().default("owner"),
  uiLocale:      varchar("ui_locale", { length: 10 }).notNull().default("en"),
  emailVerified: boolean("email_verified").notNull().default(false),
  createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:     timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  emailIdx: uniqueIndex("users_email_idx").on(t.email),
}));

// ── Projects ─────────────────────────────────────────────────

export const projects = pgTable("projects", {
  id:            uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  userId:        uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  title:         varchar("title", { length: 500 }).notNull(),
  description:   text("description"),
  status:        projectStatusEnum("status").notNull().default("draft"),
  uiLocale:      varchar("ui_locale", { length: 10 }).notNull().default("en"),
  promptLocale:  varchar("prompt_locale", { length: 10 }).notNull().default("en"),
  projectLocale: varchar("project_locale", { length: 10 }).notNull().default("en"),
  outputLocale:  varchar("output_locale", { length: 10 }).notNull().default("en"),
  sourceLanguage:varchar("source_language", { length: 20 }).notNull().default("en"),
  createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:     timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  userIdIdx: index("projects_user_id_idx").on(t.userId),
}));

// ── Research Runs ─────────────────────────────────────────────

export const researchRuns = pgTable("research_runs", {
  id:                uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId:         uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  version:           integer("version").notNull().default(1),
  status:            researchRunStatusEnum("status").notNull().default("pending"),
  depth:             researchDepthEnum("depth").notNull().default("standard"),
  topic:             text("topic").notNull(),
  dateRangeStart:    timestamp("date_range_start", { withTimezone: true }),
  dateRangeEnd:      timestamp("date_range_end", { withTimezone: true }),
  requestedLanguage: varchar("requested_language", { length: 10 }).notNull().default("en"),
  researchPlan:      jsonb("research_plan"),
  progressPct:       smallint("progress_pct").notNull().default(0),
  error:             text("error"),
  createdAt:         timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt:       timestamp("completed_at", { withTimezone: true }),
}, (t) => ({
  projectIdIdx: index("runs_project_id_idx").on(t.projectId),
}));

// ── Sources ──────────────────────────────────────────────────

export const sources = pgTable("sources", {
  id:                  uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  researchRunId:       uuid("research_run_id").notNull().references(() => researchRuns.id, { onDelete: "cascade" }),
  url:                 text("url").notNull(),
  canonicalUrl:        text("canonical_url").notNull(),
  domain:              varchar("domain", { length: 255 }).notNull(),
  title:               text("title").notNull(),
  author:              text("author"),
  publishedAt:         timestamp("published_at", { withTimezone: true }),
  retrievedAt:         timestamp("retrieved_at", { withTimezone: true }).notNull().defaultNow(),
  language:            varchar("language", { length: 10 }).notNull().default("en"),
  sourceType:          sourceTypeEnum("source_type").notNull(),
  credibilityTier:     credibilityTierEnum("credibility_tier").notNull().default("unknown"),
  accessMethod:        accessMethodEnum("access_method").notNull(),
  contentHash:         varchar("content_hash", { length: 64 }).notNull(),
  rawArtifactId:       text("raw_artifact_id"),
  extractedArtifactId: text("extracted_artifact_id"),
  isDemo:              boolean("is_demo").notNull().default(false),
  createdAt:           timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  runIdIdx:   index("sources_run_id_idx").on(t.researchRunId),
  hashIdx:    index("sources_hash_idx").on(t.contentHash),
}));

// ── Evidence ─────────────────────────────────────────────────

export const evidence = pgTable("evidence", {
  id:                 uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  sourceId:           uuid("source_id").notNull().references(() => sources.id, { onDelete: "cascade" }),
  pageNumber:         integer("page_number"),
  section:            text("section"),
  quote:              text("quote").notNull(),
  coordinates:        jsonb("coordinates"),
  capturedAt:         timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
  confidence:         real("confidence").notNull().default(1.0),
  language:           varchar("language", { length: 10 }).notNull().default("en"),
  extractionWarnings: text("extraction_warnings").array().notNull().default(sql`'{}'`),
  isDemo:             boolean("is_demo").notNull().default(false),
  createdAt:          timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  sourceIdIdx: index("evidence_source_id_idx").on(t.sourceId),
}));

// ── Claims ───────────────────────────────────────────────────

export const claims = pgTable("claims", {
  id:                uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId:         uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  claimText:         text("claim_text").notNull(),
  claimType:         claimTypeEnum("claim_type").notNull(),
  status:            claimStatusEnum("status").notNull().default("unverified"),
  confidence:        real("confidence").notNull().default(0.0),
  reasoningSummary:  text("reasoning_summary"),
  whatIsMissing:     text("what_is_missing"),
  isDemo:            boolean("is_demo").notNull().default(false),
  createdAt:         timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:         timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  projectIdIdx: index("claims_project_id_idx").on(t.projectId),
}));

// ── Claim ↔ Evidence ─────────────────────────────────────────

export const claimEvidence = pgTable("claim_evidence", {
  claimId:          uuid("claim_id").notNull().references(() => claims.id, { onDelete: "cascade" }),
  evidenceId:       uuid("evidence_id").notNull().references(() => evidence.id, { onDelete: "cascade" }),
  relationshipType: varchar("relationship_type", { length: 20 }).notNull().default("supports"),
}, (t) => ({
  pk: uniqueIndex("claim_evidence_pk").on(t.claimId, t.evidenceId),
}));

// ── Dossier Cards ─────────────────────────────────────────────

export const dossierCards = pgTable("dossier_cards", {
  id:            uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId:     uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  researchRunId: uuid("research_run_id").notNull().references(() => researchRuns.id, { onDelete: "cascade" }),
  cardType:      dossierCardTypeEnum("card_type").notNull(),
  title:         text("title").notNull(),
  body:          text("body").notNull(),
  claimIds:      uuid("claim_ids").array().notNull().default(sql`'{}'`),
  sourceIds:     uuid("source_ids").array().notNull().default(sql`'{}'`),
  evidenceIds:   uuid("evidence_ids").array().notNull().default(sql`'{}'`),
  locale:        varchar("locale", { length: 10 }).notNull().default("en"),
  sortOrder:     integer("sort_order").notNull().default(0),
  createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  projectIdIdx: index("dossier_project_id_idx").on(t.projectId),
}));

// ── Audit Log ─────────────────────────────────────────────────

export const auditLog = pgTable("audit_log", {
  id:           uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  userId:       uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  resourceType: varchar("resource_type", { length: 100 }).notNull(),
  resourceId:   uuid("resource_id").notNull(),
  action:       auditActionEnum("action").notNull(),
  diff:         jsonb("diff"),
  ipAddress:    varchar("ip_address", { length: 50 }),
  createdAt:    timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  resourceIdx:   index("audit_resource_idx").on(t.resourceType, t.resourceId),
  userIdx:       index("audit_user_idx").on(t.userId),
  createdAtIdx:  index("audit_created_at_idx").on(t.createdAt),
}));

// ── Relations ────────────────────────────────────────────────

export const usersRelations = relations(users, ({ many }) => ({
  projects:  many(projects),
  auditLogs: many(auditLog),
}));

export const projectsRelations = relations(projects, ({ one, many }) => ({
  user:          one(users, { fields: [projects.userId], references: [users.id] }),
  researchRuns:  many(researchRuns),
  claims:        many(claims),
  dossierCards:  many(dossierCards),
}));

export const researchRunsRelations = relations(researchRuns, ({ one, many }) => ({
  project:      one(projects, { fields: [researchRuns.projectId], references: [projects.id] }),
  sources:      many(sources),
  dossierCards: many(dossierCards),
}));

export const sourcesRelations = relations(sources, ({ one, many }) => ({
  researchRun: one(researchRuns, { fields: [sources.researchRunId], references: [researchRuns.id] }),
  evidence:    many(evidence),
}));

export const evidenceRelations = relations(evidence, ({ one, many }) => ({
  source:       one(sources, { fields: [evidence.sourceId], references: [sources.id] }),
  claimEvidence: many(claimEvidence),
}));

export const claimsRelations = relations(claims, ({ one, many }) => ({
  project:      one(projects, { fields: [claims.projectId], references: [projects.id] }),
  claimEvidence: many(claimEvidence),
}));

export const claimEvidenceRelations = relations(claimEvidence, ({ one }) => ({
  claim:    one(claims,   { fields: [claimEvidence.claimId],    references: [claims.id] }),
  evidence: one(evidence, { fields: [claimEvidence.evidenceId], references: [evidence.id] }),
}));
