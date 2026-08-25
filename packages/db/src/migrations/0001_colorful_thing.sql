CREATE TYPE "public"."access_method" AS ENUM('public_web', 'rss', 'user_upload', 'api', 'youtube');--> statement-breakpoint
CREATE TYPE "public"."audit_action" AS ENUM('create', 'update', 'delete', 'import', 'export', 'translate', 'verify', 'dispute');--> statement-breakpoint
CREATE TYPE "public"."claim_status" AS ENUM('verified', 'strongly_correlated', 'reported', 'disputed', 'unverified', 'opinion', 'inference', 'outdated');--> statement-breakpoint
CREATE TYPE "public"."claim_type" AS ENUM('fact', 'reported', 'opinion', 'analysis', 'legal_interpretation', 'inference', 'statistic');--> statement-breakpoint
CREATE TYPE "public"."credibility_tier" AS ENUM('primary', 'verified', 'credible', 'reported', 'unknown', 'disputed');--> statement-breakpoint
CREATE TYPE "public"."dossier_card_type" AS ENUM('summary', 'timeline', 'contradiction', 'gap', 'legal', 'source_analysis', 'key_claim');--> statement-breakpoint
CREATE TYPE "public"."project_status" AS ENUM('draft', 'active', 'archived');--> statement-breakpoint
CREATE TYPE "public"."research_depth" AS ENUM('quick', 'standard', 'deep');--> statement-breakpoint
CREATE TYPE "public"."research_run_status" AS ENUM('pending', 'planning', 'searching', 'fetching', 'extracting', 'analysing', 'complete', 'failed');--> statement-breakpoint
CREATE TYPE "public"."source_type" AS ENUM('webpage', 'pdf', 'video', 'news', 'social', 'legal_document', 'official_statement', 'academic', 'user_upload');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('owner', 'editor', 'viewer');--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"resource_type" varchar(100) NOT NULL,
	"resource_id" uuid NOT NULL,
	"action" "audit_action" NOT NULL,
	"diff" jsonb,
	"ip_address" varchar(50),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "claim_evidence" (
	"claim_id" uuid NOT NULL,
	"evidence_id" uuid NOT NULL,
	"relationship_type" varchar(20) DEFAULT 'supports' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"claim_text" text NOT NULL,
	"claim_type" "claim_type" NOT NULL,
	"status" "claim_status" DEFAULT 'unverified' NOT NULL,
	"confidence" real DEFAULT 0 NOT NULL,
	"reasoning_summary" text,
	"what_is_missing" text,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dossier_cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"research_run_id" uuid NOT NULL,
	"card_type" "dossier_card_type" NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"claim_ids" uuid[] DEFAULT '{}' NOT NULL,
	"source_ids" uuid[] DEFAULT '{}' NOT NULL,
	"evidence_ids" uuid[] DEFAULT '{}' NOT NULL,
	"locale" varchar(10) DEFAULT 'en' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"page_number" integer,
	"section" text,
	"quote" text NOT NULL,
	"coordinates" jsonb,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confidence" real DEFAULT 1 NOT NULL,
	"language" varchar(10) DEFAULT 'en' NOT NULL,
	"extraction_warnings" text[] DEFAULT '{}' NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"title" varchar(500) NOT NULL,
	"description" text,
	"status" "project_status" DEFAULT 'draft' NOT NULL,
	"ui_locale" varchar(10) DEFAULT 'en' NOT NULL,
	"prompt_locale" varchar(10) DEFAULT 'en' NOT NULL,
	"project_locale" varchar(10) DEFAULT 'en' NOT NULL,
	"output_locale" varchar(10) DEFAULT 'en' NOT NULL,
	"source_language" varchar(20) DEFAULT 'en' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "research_memories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"entity_id" text NOT NULL,
	"entity_name" text NOT NULL,
	"intent" text,
	"summary" text NOT NULL,
	"key_facts" jsonb,
	"query_history" text[] DEFAULT '{}' NOT NULL,
	"claim_ids" uuid[] DEFAULT '{}' NOT NULL,
	"source_ids" uuid[] DEFAULT '{}' NOT NULL,
	"run_count" integer DEFAULT 1 NOT NULL,
	"last_updated" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "research_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"status" "research_run_status" DEFAULT 'pending' NOT NULL,
	"depth" "research_depth" DEFAULT 'standard' NOT NULL,
	"topic" text NOT NULL,
	"date_range_start" timestamp with time zone,
	"date_range_end" timestamp with time zone,
	"requested_language" varchar(10) DEFAULT 'en' NOT NULL,
	"research_plan" jsonb,
	"progress_pct" smallint DEFAULT 0 NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"research_run_id" uuid NOT NULL,
	"url" text NOT NULL,
	"canonical_url" text NOT NULL,
	"domain" varchar(255) NOT NULL,
	"title" text NOT NULL,
	"author" text,
	"published_at" timestamp with time zone,
	"retrieved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"language" varchar(10) DEFAULT 'en' NOT NULL,
	"source_type" "source_type" NOT NULL,
	"credibility_tier" "credibility_tier" DEFAULT 'unknown' NOT NULL,
	"access_method" "access_method" NOT NULL,
	"content_hash" varchar(64) NOT NULL,
	"raw_artifact_id" text,
	"extracted_artifact_id" text,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" varchar(320) NOT NULL,
	"name" varchar(255) NOT NULL,
	"role" "user_role" DEFAULT 'owner' NOT NULL,
	"ui_locale" varchar(10) DEFAULT 'en' NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_evidence" ADD CONSTRAINT "claim_evidence_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_evidence" ADD CONSTRAINT "claim_evidence_evidence_id_evidence_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "public"."evidence"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dossier_cards" ADD CONSTRAINT "dossier_cards_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dossier_cards" ADD CONSTRAINT "dossier_cards_research_run_id_research_runs_id_fk" FOREIGN KEY ("research_run_id") REFERENCES "public"."research_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_memories" ADD CONSTRAINT "research_memories_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_runs" ADD CONSTRAINT "research_runs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sources" ADD CONSTRAINT "sources_research_run_id_research_runs_id_fk" FOREIGN KEY ("research_run_id") REFERENCES "public"."research_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_resource_idx" ON "audit_log" USING btree ("resource_type","resource_id");--> statement-breakpoint
CREATE INDEX "audit_user_idx" ON "audit_log" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "audit_created_at_idx" ON "audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "claim_evidence_pk" ON "claim_evidence" USING btree ("claim_id","evidence_id");--> statement-breakpoint
CREATE INDEX "claims_project_id_idx" ON "claims" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "dossier_project_id_idx" ON "dossier_cards" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "evidence_source_id_idx" ON "evidence" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "projects_user_id_idx" ON "projects" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "memory_project_entity_idx" ON "research_memories" USING btree ("project_id","entity_id");--> statement-breakpoint
CREATE INDEX "runs_project_id_idx" ON "research_runs" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "sources_run_id_idx" ON "sources" USING btree ("research_run_id");--> statement-breakpoint
CREATE INDEX "sources_hash_idx" ON "sources" USING btree ("content_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_idx" ON "users" USING btree ("email");