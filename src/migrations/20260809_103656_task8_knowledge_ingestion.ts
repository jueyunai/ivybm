import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_knowledge_documents_risk_topics" AS ENUM('price', 'discount', 'payment', 'lead-time', 'warranty', 'lifespan', 'certification', 'structural-performance', 'fire-performance', 'customs', 'freight', 'insurance', 'liability');
  CREATE TYPE "public"."enum_knowledge_source_documents_source_type" AS ENUM('faq', 'product-manual', 'technical-specification', 'sales-script', 'project-case', 'other');
  CREATE TYPE "public"."enum_knowledge_source_documents_original_language" AS ENUM('auto', 'en', 'ar', 'zh');
  CREATE TYPE "public"."enum_knowledge_source_documents_detected_language" AS ENUM('unknown', 'en', 'ar', 'zh');
  CREATE TYPE "public"."enum_knowledge_source_documents_processing_status" AS ENUM('queued', 'processing', 'needs_review', 'failed', 'archived');
  CREATE TYPE "public"."enum_knowledge_source_documents_processing_stage" AS ENUM('queued', 'parsing', 'translating', 'finalizing', 'complete');
  CREATE TYPE "public"."enum_knowledge_source_assets_accessibility" AS ENUM('private', 'preview-only');
  CREATE TABLE "knowledge_documents_risk_topics" (
   "order" integer NOT NULL,
   "parent_id" integer NOT NULL,
   "value" "enum_knowledge_documents_risk_topics",
   "id" serial PRIMARY KEY NOT NULL
  );

  CREATE TABLE "knowledge_source_documents" (
   "id" serial PRIMARY KEY NOT NULL,
   "source_title" varchar NOT NULL,
   "source_type" "enum_knowledge_source_documents_source_type" NOT NULL,
   "source_version" varchar NOT NULL,
   "original_language" "enum_knowledge_source_documents_original_language" DEFAULT 'auto' NOT NULL,
   "source_hash" varchar NOT NULL,
   "ingestion_revision" varchar NOT NULL,
   "detected_language" "enum_knowledge_source_documents_detected_language",
   "extracted_text" varchar,
   "page_count" numeric,
   "paragraph_count" numeric,
   "image_count" numeric,
   "parser_version" varchar,
   "processing_status" "enum_knowledge_source_documents_processing_status" DEFAULT 'queued' NOT NULL,
   "processing_stage" "enum_knowledge_source_documents_processing_stage" DEFAULT 'queued' NOT NULL,
   "current_job_id" numeric,
   "current_job_owner_token" varchar,
   "error_code" varchar,
   "error_summary" varchar,
   "completed_at" timestamp(3) with time zone,
   "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
   "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
   "url" varchar,
   "thumbnail_u_r_l" varchar,
   "filename" varchar,
   "mime_type" varchar,
   "filesize" numeric,
   "width" numeric,
   "height" numeric,
   "focal_x" numeric,
   "focal_y" numeric
  );

  CREATE TABLE "knowledge_source_assets" (
   "id" serial PRIMARY KEY NOT NULL,
   "source_id" integer NOT NULL,
   "sequence" numeric NOT NULL,
   "original_name" varchar NOT NULL,
   "sha256" varchar NOT NULL,
   "byte_size" numeric NOT NULL,
   "accessibility" "enum_knowledge_source_assets_accessibility" DEFAULT 'private' NOT NULL,
   "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
   "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
   "url" varchar,
   "thumbnail_u_r_l" varchar,
   "filename" varchar,
   "mime_type" varchar,
   "filesize" numeric,
   "width" numeric,
   "height" numeric,
   "focal_x" numeric,
   "focal_y" numeric
  );

  ALTER TABLE "knowledge_documents" ADD COLUMN "ingestion_source_id" integer;
  ALTER TABLE "knowledge_documents" ADD COLUMN "source_hash" varchar;
  ALTER TABLE "knowledge_documents" ADD COLUMN "source_anchor" varchar;
  ALTER TABLE "knowledge_documents" ADD COLUMN "generation_model" varchar;
  ALTER TABLE "knowledge_documents" ADD COLUMN "generation_prompt_version" numeric;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "knowledge_source_documents_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "knowledge_source_assets_id" integer;
  ALTER TABLE "knowledge_documents_risk_topics" ADD CONSTRAINT "knowledge_documents_risk_topics_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."knowledge_documents"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "knowledge_source_assets" ADD CONSTRAINT "knowledge_source_assets_source_id_knowledge_source_documents_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."knowledge_source_documents"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "knowledge_documents_risk_topics_order_idx" ON "knowledge_documents_risk_topics" USING btree ("order");
  CREATE INDEX "knowledge_documents_risk_topics_parent_idx" ON "knowledge_documents_risk_topics" USING btree ("parent_id");
  CREATE INDEX "knowledge_source_documents_source_hash_idx" ON "knowledge_source_documents" USING btree ("source_hash");
  CREATE INDEX "knowledge_source_documents_ingestion_revision_idx" ON "knowledge_source_documents" USING btree ("ingestion_revision");
  CREATE INDEX "knowledge_source_documents_processing_status_idx" ON "knowledge_source_documents" USING btree ("processing_status");
  CREATE INDEX "knowledge_source_documents_updated_at_idx" ON "knowledge_source_documents" USING btree ("updated_at");
  CREATE INDEX "knowledge_source_documents_created_at_idx" ON "knowledge_source_documents" USING btree ("created_at");
  CREATE UNIQUE INDEX "knowledge_source_documents_filename_idx" ON "knowledge_source_documents" USING btree ("filename");
  CREATE UNIQUE INDEX "sourceHash_sourceVersion_idx" ON "knowledge_source_documents" USING btree ("source_hash","source_version");
  CREATE INDEX "processingStatus_updatedAt_idx" ON "knowledge_source_documents" USING btree ("processing_status","updated_at");
  CREATE INDEX "knowledge_source_assets_source_idx" ON "knowledge_source_assets" USING btree ("source_id");
  CREATE INDEX "knowledge_source_assets_sha256_idx" ON "knowledge_source_assets" USING btree ("sha256");
  CREATE INDEX "knowledge_source_assets_updated_at_idx" ON "knowledge_source_assets" USING btree ("updated_at");
  CREATE INDEX "knowledge_source_assets_created_at_idx" ON "knowledge_source_assets" USING btree ("created_at");
  CREATE UNIQUE INDEX "knowledge_source_assets_filename_idx" ON "knowledge_source_assets" USING btree ("filename");
  CREATE UNIQUE INDEX "source_sequence_idx" ON "knowledge_source_assets" USING btree ("source_id","sequence");
  ALTER TABLE "knowledge_documents" ADD CONSTRAINT "knowledge_documents_ingestion_source_id_knowledge_source_documents_id_fk" FOREIGN KEY ("ingestion_source_id") REFERENCES "public"."knowledge_source_documents"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_knowledge_source_documents_fk" FOREIGN KEY ("knowledge_source_documents_id") REFERENCES "public"."knowledge_source_documents"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_knowledge_source_assets_fk" FOREIGN KEY ("knowledge_source_assets_id") REFERENCES "public"."knowledge_source_assets"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "knowledge_documents_ingestion_source_idx" ON "knowledge_documents" USING btree ("ingestion_source_id");
  CREATE UNIQUE INDEX "ingestionSource_locale_idx" ON "knowledge_documents" USING btree ("ingestion_source_id","locale");
  CREATE INDEX "payload_locked_documents_rels_knowledge_source_documents_idx" ON "payload_locked_documents_rels" USING btree ("knowledge_source_documents_id");
  CREATE INDEX "payload_locked_documents_rels_knowledge_source_assets_id_idx" ON "payload_locked_documents_rels" USING btree ("knowledge_source_assets_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "knowledge_documents_risk_topics" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "knowledge_source_documents" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "knowledge_source_assets" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "knowledge_documents" DROP CONSTRAINT "knowledge_documents_ingestion_source_id_knowledge_source_documents_id_fk";

  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_knowledge_source_documents_fk";

  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_knowledge_source_assets_fk";

  DROP INDEX "knowledge_documents_ingestion_source_idx";
  DROP INDEX "ingestionSource_locale_idx";
  DROP INDEX "payload_locked_documents_rels_knowledge_source_documents_idx";
  DROP INDEX "payload_locked_documents_rels_knowledge_source_assets_id_idx";
  ALTER TABLE "knowledge_documents" DROP COLUMN "ingestion_source_id";
  ALTER TABLE "knowledge_documents" DROP COLUMN "source_hash";
  ALTER TABLE "knowledge_documents" DROP COLUMN "source_anchor";
  ALTER TABLE "knowledge_documents" DROP COLUMN "generation_model";
  ALTER TABLE "knowledge_documents" DROP COLUMN "generation_prompt_version";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "knowledge_source_documents_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "knowledge_source_assets_id";
  DROP TABLE "knowledge_documents_risk_topics" CASCADE;
  DROP TABLE "knowledge_source_assets" CASCADE;
  DROP TABLE "knowledge_source_documents" CASCADE;
  DROP TYPE "public"."enum_knowledge_documents_risk_topics";
  DROP TYPE "public"."enum_knowledge_source_documents_source_type";
  DROP TYPE "public"."enum_knowledge_source_documents_original_language";
  DROP TYPE "public"."enum_knowledge_source_documents_detected_language";
  DROP TYPE "public"."enum_knowledge_source_documents_processing_status";
  DROP TYPE "public"."enum_knowledge_source_documents_processing_stage";
  DROP TYPE "public"."enum_knowledge_source_assets_accessibility";`)
}
