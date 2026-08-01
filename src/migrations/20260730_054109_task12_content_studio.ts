import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_generated_contents_platform" AS ENUM('facebook', 'instagram', 'linkedin');
  CREATE TYPE "public"."enum_generated_contents_content_locale" AS ENUM('en', 'ar');
  CREATE TYPE "public"."enum_generated_contents_content_type" AS ENUM('post', 'carousel', 'long-form');
  CREATE TYPE "public"."enum_generated_contents_status" AS ENUM('draft', 'review', 'approved');
  CREATE TYPE "public"."enum_content_reviews_decision" AS ENUM('approved', 'revision-requested');
  CREATE TYPE "public"."enum_publish_jobs_platform" AS ENUM('facebook', 'instagram', 'linkedin');
  CREATE TYPE "public"."enum_publish_jobs_mode" AS ENUM('assisted', 'automatic');
  CREATE TYPE "public"."enum_publish_jobs_status" AS ENUM('scheduled', 'accepted', 'publishing', 'published', 'failed', 'delivery_unknown');
  CREATE TYPE "public"."enum_publish_logs_event" AS ENUM('created', 'scheduled', 'accepted', 'assisted-package-ready', 'status-updated', 'failed', 'delivery-unknown');
  CREATE TABLE "generated_contents_source_references" (
    "_order" integer NOT NULL,
    "_parent_id" integer NOT NULL,
    "id" varchar PRIMARY KEY NOT NULL,
    "claim" varchar NOT NULL,
    "source" varchar NOT NULL
  );

  CREATE TABLE "generated_contents" (
    "id" serial PRIMARY KEY NOT NULL,
    "title" varchar NOT NULL,
    "platform" "enum_generated_contents_platform" NOT NULL,
    "content_locale" "enum_generated_contents_content_locale" NOT NULL,
    "content_type" "enum_generated_contents_content_type" NOT NULL,
    "body" varchar NOT NULL,
    "status" "enum_generated_contents_status" DEFAULT 'draft' NOT NULL,
    "created_by_id" integer NOT NULL,
    "reviewed_at" timestamp(3) with time zone,
    "reviewed_by_id" integer,
    "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
    "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );

  CREATE TABLE "generated_contents_rels" (
    "id" serial PRIMARY KEY NOT NULL,
    "order" integer,
    "parent_id" integer NOT NULL,
    "path" varchar NOT NULL,
    "media_id" integer,
    "knowledge_documents_id" integer
  );

  CREATE TABLE "content_reviews" (
    "id" serial PRIMARY KEY NOT NULL,
    "content_id" integer NOT NULL,
    "decision" "enum_content_reviews_decision" NOT NULL,
    "checklist_facts_traceable" boolean DEFAULT false NOT NULL,
    "checklist_technical_claims_checked" boolean DEFAULT false NOT NULL,
    "checklist_no_commercial_commitment" boolean DEFAULT false NOT NULL,
    "checklist_platform_format_checked" boolean DEFAULT false NOT NULL,
    "checklist_arabic_proofread" boolean DEFAULT false NOT NULL,
    "comments" varchar,
    "reviewed_by_id" integer NOT NULL,
    "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
    "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );

  CREATE TABLE "publish_jobs" (
    "id" serial PRIMARY KEY NOT NULL,
    "content_id" integer NOT NULL,
    "platform" "enum_publish_jobs_platform" NOT NULL,
    "platform_account_id" integer,
    "mode" "enum_publish_jobs_mode" NOT NULL,
    "status" "enum_publish_jobs_status" DEFAULT 'scheduled' NOT NULL,
    "scheduled_for" timestamp(3) with time zone NOT NULL,
    "accepted_at" timestamp(3) with time zone,
    "published_at" timestamp(3) with time zone,
    "external_publication_id" varchar,
    "last_error_code" varchar,
    "last_error_summary" varchar,
    "idempotency_key" varchar NOT NULL,
    "created_by_id" integer NOT NULL,
    "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
    "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );

  CREATE TABLE "publish_logs" (
    "id" serial PRIMARY KEY NOT NULL,
    "publish_job_id" integer NOT NULL,
    "event" "enum_publish_logs_event" NOT NULL,
    "summary" varchar NOT NULL,
    "actor_id" integer,
    "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
    "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );

  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "generated_contents_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "content_reviews_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "publish_jobs_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "publish_logs_id" integer;
  ALTER TABLE "generated_contents_source_references" ADD CONSTRAINT "generated_contents_source_references_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."generated_contents"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "generated_contents" ADD CONSTRAINT "generated_contents_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "generated_contents" ADD CONSTRAINT "generated_contents_reviewed_by_id_users_id_fk" FOREIGN KEY ("reviewed_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "generated_contents_rels" ADD CONSTRAINT "generated_contents_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."generated_contents"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "generated_contents_rels" ADD CONSTRAINT "generated_contents_rels_media_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "generated_contents_rels" ADD CONSTRAINT "generated_contents_rels_knowledge_documents_fk" FOREIGN KEY ("knowledge_documents_id") REFERENCES "public"."knowledge_documents"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "content_reviews" ADD CONSTRAINT "content_reviews_content_id_generated_contents_id_fk" FOREIGN KEY ("content_id") REFERENCES "public"."generated_contents"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "content_reviews" ADD CONSTRAINT "content_reviews_reviewed_by_id_users_id_fk" FOREIGN KEY ("reviewed_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "publish_jobs" ADD CONSTRAINT "publish_jobs_content_id_generated_contents_id_fk" FOREIGN KEY ("content_id") REFERENCES "public"."generated_contents"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "publish_jobs" ADD CONSTRAINT "publish_jobs_platform_account_id_platform_accounts_id_fk" FOREIGN KEY ("platform_account_id") REFERENCES "public"."platform_accounts"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "publish_jobs" ADD CONSTRAINT "publish_jobs_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "publish_logs" ADD CONSTRAINT "publish_logs_publish_job_id_publish_jobs_id_fk" FOREIGN KEY ("publish_job_id") REFERENCES "public"."publish_jobs"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "publish_logs" ADD CONSTRAINT "publish_logs_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "generated_contents_source_references_order_idx" ON "generated_contents_source_references" USING btree ("_order");
  CREATE INDEX "generated_contents_source_references_parent_id_idx" ON "generated_contents_source_references" USING btree ("_parent_id");
  CREATE INDEX "generated_contents_platform_idx" ON "generated_contents" USING btree ("platform");
  CREATE INDEX "generated_contents_content_locale_idx" ON "generated_contents" USING btree ("content_locale");
  CREATE INDEX "generated_contents_status_idx" ON "generated_contents" USING btree ("status");
  CREATE INDEX "generated_contents_created_by_idx" ON "generated_contents" USING btree ("created_by_id");
  CREATE INDEX "generated_contents_reviewed_by_idx" ON "generated_contents" USING btree ("reviewed_by_id");
  CREATE INDEX "generated_contents_updated_at_idx" ON "generated_contents" USING btree ("updated_at");
  CREATE INDEX "generated_contents_created_at_idx" ON "generated_contents" USING btree ("created_at");
  CREATE INDEX "generated_contents_rels_order_idx" ON "generated_contents_rels" USING btree ("order");
  CREATE INDEX "generated_contents_rels_parent_idx" ON "generated_contents_rels" USING btree ("parent_id");
  CREATE INDEX "generated_contents_rels_path_idx" ON "generated_contents_rels" USING btree ("path");
  CREATE INDEX "generated_contents_rels_media_id_idx" ON "generated_contents_rels" USING btree ("media_id");
  CREATE INDEX "generated_contents_rels_knowledge_documents_id_idx" ON "generated_contents_rels" USING btree ("knowledge_documents_id");
  CREATE INDEX "content_reviews_content_idx" ON "content_reviews" USING btree ("content_id");
  CREATE INDEX "content_reviews_reviewed_by_idx" ON "content_reviews" USING btree ("reviewed_by_id");
  CREATE INDEX "content_reviews_updated_at_idx" ON "content_reviews" USING btree ("updated_at");
  CREATE INDEX "content_reviews_created_at_idx" ON "content_reviews" USING btree ("created_at");
  CREATE INDEX "publish_jobs_content_idx" ON "publish_jobs" USING btree ("content_id");
  CREATE INDEX "publish_jobs_platform_idx" ON "publish_jobs" USING btree ("platform");
  CREATE INDEX "publish_jobs_platform_account_idx" ON "publish_jobs" USING btree ("platform_account_id");
  CREATE INDEX "publish_jobs_status_idx" ON "publish_jobs" USING btree ("status");
  CREATE INDEX "publish_jobs_scheduled_for_idx" ON "publish_jobs" USING btree ("scheduled_for");
  CREATE UNIQUE INDEX "publish_jobs_idempotency_key_idx" ON "publish_jobs" USING btree ("idempotency_key");
  CREATE INDEX "publish_jobs_created_by_idx" ON "publish_jobs" USING btree ("created_by_id");
  CREATE INDEX "publish_jobs_updated_at_idx" ON "publish_jobs" USING btree ("updated_at");
  CREATE INDEX "publish_jobs_created_at_idx" ON "publish_jobs" USING btree ("created_at");
  CREATE INDEX "publish_logs_publish_job_idx" ON "publish_logs" USING btree ("publish_job_id");
  CREATE INDEX "publish_logs_actor_idx" ON "publish_logs" USING btree ("actor_id");
  CREATE INDEX "publish_logs_updated_at_idx" ON "publish_logs" USING btree ("updated_at");
  CREATE INDEX "publish_logs_created_at_idx" ON "publish_logs" USING btree ("created_at");
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_generated_contents_fk" FOREIGN KEY ("generated_contents_id") REFERENCES "public"."generated_contents"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_content_reviews_fk" FOREIGN KEY ("content_reviews_id") REFERENCES "public"."content_reviews"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_publish_jobs_fk" FOREIGN KEY ("publish_jobs_id") REFERENCES "public"."publish_jobs"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_publish_logs_fk" FOREIGN KEY ("publish_logs_id") REFERENCES "public"."publish_logs"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_generated_contents_id_idx" ON "payload_locked_documents_rels" USING btree ("generated_contents_id");
  CREATE INDEX "payload_locked_documents_rels_content_reviews_id_idx" ON "payload_locked_documents_rels" USING btree ("content_reviews_id");
  CREATE INDEX "payload_locked_documents_rels_publish_jobs_id_idx" ON "payload_locked_documents_rels" USING btree ("publish_jobs_id");
  CREATE INDEX "payload_locked_documents_rels_publish_logs_id_idx" ON "payload_locked_documents_rels" USING btree ("publish_logs_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_generated_contents_fk";
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_content_reviews_fk";
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_publish_jobs_fk";
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_publish_logs_fk";
  DROP INDEX "payload_locked_documents_rels_generated_contents_id_idx";
  DROP INDEX "payload_locked_documents_rels_content_reviews_id_idx";
  DROP INDEX "payload_locked_documents_rels_publish_jobs_id_idx";
  DROP INDEX "payload_locked_documents_rels_publish_logs_id_idx";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "generated_contents_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "content_reviews_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "publish_jobs_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "publish_logs_id";
  ALTER TABLE "generated_contents_source_references" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "generated_contents_rels" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "content_reviews" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "publish_logs" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "publish_jobs" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "generated_contents" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "generated_contents_source_references" CASCADE;
  DROP TABLE "generated_contents_rels" CASCADE;
  DROP TABLE "content_reviews" CASCADE;
  DROP TABLE "publish_logs" CASCADE;
  DROP TABLE "publish_jobs" CASCADE;
  DROP TABLE "generated_contents" CASCADE;
  DROP TYPE "public"."enum_generated_contents_platform";
  DROP TYPE "public"."enum_generated_contents_content_locale";
  DROP TYPE "public"."enum_generated_contents_content_type";
  DROP TYPE "public"."enum_generated_contents_status";
  DROP TYPE "public"."enum_content_reviews_decision";
  DROP TYPE "public"."enum_publish_jobs_platform";
  DROP TYPE "public"."enum_publish_jobs_mode";
  DROP TYPE "public"."enum_publish_jobs_status";
  DROP TYPE "public"."enum_publish_logs_event";`)
}
