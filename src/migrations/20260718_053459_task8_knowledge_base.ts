import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload: _payload, req: _req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_knowledge_documents_source_type" AS ENUM('faq', 'product-manual', 'technical-specification', 'sales-script', 'project-case', 'other');
  CREATE TYPE "public"."enum_knowledge_documents_locale" AS ENUM('en', 'ar');
  CREATE TYPE "public"."enum_knowledge_documents_review_status" AS ENUM('draft', 'reviewed', 'archived');
  CREATE TYPE "public"."enum_knowledge_documents_index_status" AS ENUM('pending', 'processing', 'ready', 'failed');
  CREATE TYPE "public"."enum_knowledge_chunks_locale" AS ENUM('en', 'ar');
  CREATE TYPE "public"."enum_prompt_templates_purpose" AS ENUM('customer-chat', 'conversation-summary', 'translation', 'content-generation');
  CREATE TYPE "public"."enum_prompt_templates_locale" AS ENUM('all', 'en', 'ar');
  CREATE TYPE "public"."enum_prompt_templates_status" AS ENUM('draft', 'active', 'archived');
  CREATE TABLE "knowledge_documents" (
    "id" serial PRIMARY KEY NOT NULL,
    "source_title" varchar NOT NULL,
    "source_type" "enum_knowledge_documents_source_type" NOT NULL,
    "source_u_r_l" varchar,
    "source_file_id" integer,
    "source_version" varchar NOT NULL,
    "locale" "enum_knowledge_documents_locale" DEFAULT 'en' NOT NULL,
    "content" varchar NOT NULL,
    "review_status" "enum_knowledge_documents_review_status" DEFAULT 'draft' NOT NULL,
    "reviewed_at" timestamp(3) with time zone,
    "reviewed_by_id" integer,
    "index_status" "enum_knowledge_documents_index_status" DEFAULT 'pending' NOT NULL,
    "indexed_at" timestamp(3) with time zone,
    "embedding_model" varchar,
    "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
    "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );

  CREATE TABLE "knowledge_chunks" (
    "id" serial PRIMARY KEY NOT NULL,
    "document_id" integer NOT NULL,
    "stable_id" varchar NOT NULL,
    "index" numeric NOT NULL,
    "locale" "enum_knowledge_chunks_locale" NOT NULL,
    "content" varchar NOT NULL,
    "source_title" varchar NOT NULL,
    "source_version" varchar NOT NULL,
    "source_u_r_l" varchar,
    "embedding_model" varchar,
    "embedding_dimensions" numeric,
    "embedded_at" timestamp(3) with time zone,
    "embedding_vector" vector,
    "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
    "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );

  CREATE TABLE "prompt_templates" (
    "id" serial PRIMARY KEY NOT NULL,
    "key" varchar NOT NULL,
    "purpose" "enum_prompt_templates_purpose" NOT NULL,
    "locale" "enum_prompt_templates_locale" DEFAULT 'all' NOT NULL,
    "version" numeric DEFAULT 1 NOT NULL,
    "template" varchar NOT NULL,
    "variables" jsonb,
    "status" "enum_prompt_templates_status" DEFAULT 'draft' NOT NULL,
    "model" varchar,
    "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
    "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );

  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "knowledge_documents_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "knowledge_chunks_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "prompt_templates_id" integer;
  ALTER TABLE "knowledge_documents" ADD CONSTRAINT "knowledge_documents_source_file_id_media_id_fk" FOREIGN KEY ("source_file_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "knowledge_documents" ADD CONSTRAINT "knowledge_documents_reviewed_by_id_users_id_fk" FOREIGN KEY ("reviewed_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_document_id_knowledge_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."knowledge_documents"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "knowledge_documents_source_file_idx" ON "knowledge_documents" USING btree ("source_file_id");
  CREATE INDEX "knowledge_documents_locale_idx" ON "knowledge_documents" USING btree ("locale");
  CREATE INDEX "knowledge_documents_review_status_idx" ON "knowledge_documents" USING btree ("review_status");
  CREATE INDEX "knowledge_documents_reviewed_by_idx" ON "knowledge_documents" USING btree ("reviewed_by_id");
  CREATE INDEX "knowledge_documents_index_status_idx" ON "knowledge_documents" USING btree ("index_status");
  CREATE INDEX "knowledge_documents_updated_at_idx" ON "knowledge_documents" USING btree ("updated_at");
  CREATE INDEX "knowledge_documents_created_at_idx" ON "knowledge_documents" USING btree ("created_at");
  CREATE INDEX "knowledge_chunks_document_idx" ON "knowledge_chunks" USING btree ("document_id");
  CREATE UNIQUE INDEX "knowledge_chunks_stable_id_idx" ON "knowledge_chunks" USING btree ("stable_id");
  CREATE INDEX "knowledge_chunks_locale_idx" ON "knowledge_chunks" USING btree ("locale");
  CREATE INDEX "knowledge_chunks_updated_at_idx" ON "knowledge_chunks" USING btree ("updated_at");
  CREATE INDEX "knowledge_chunks_created_at_idx" ON "knowledge_chunks" USING btree ("created_at");
  CREATE INDEX "prompt_templates_key_idx" ON "prompt_templates" USING btree ("key");
  CREATE UNIQUE INDEX "prompt_templates_key_locale_version_idx" ON "prompt_templates" USING btree ("key", "locale", "version");
  CREATE UNIQUE INDEX "prompt_templates_one_active_idx" ON "prompt_templates" USING btree ("key", "locale") WHERE "status" = 'active';
  CREATE INDEX "prompt_templates_status_idx" ON "prompt_templates" USING btree ("status");
  CREATE INDEX "prompt_templates_updated_at_idx" ON "prompt_templates" USING btree ("updated_at");
  CREATE INDEX "prompt_templates_created_at_idx" ON "prompt_templates" USING btree ("created_at");
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_knowledge_documents_fk" FOREIGN KEY ("knowledge_documents_id") REFERENCES "public"."knowledge_documents"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_knowledge_chunks_fk" FOREIGN KEY ("knowledge_chunks_id") REFERENCES "public"."knowledge_chunks"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_prompt_templates_fk" FOREIGN KEY ("prompt_templates_id") REFERENCES "public"."prompt_templates"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_knowledge_documents_id_idx" ON "payload_locked_documents_rels" USING btree ("knowledge_documents_id");
  CREATE INDEX "payload_locked_documents_rels_knowledge_chunks_id_idx" ON "payload_locked_documents_rels" USING btree ("knowledge_chunks_id");
  CREATE INDEX "payload_locked_documents_rels_prompt_templates_id_idx" ON "payload_locked_documents_rels" USING btree ("prompt_templates_id");`)
}

export async function down({ db, payload: _payload, req: _req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_knowledge_documents_fk";

  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_knowledge_chunks_fk";

  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_prompt_templates_fk";

  DROP INDEX "payload_locked_documents_rels_knowledge_documents_id_idx";
  DROP INDEX "payload_locked_documents_rels_knowledge_chunks_id_idx";
  DROP INDEX "payload_locked_documents_rels_prompt_templates_id_idx";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "knowledge_documents_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "knowledge_chunks_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "prompt_templates_id";
  ALTER TABLE "knowledge_documents" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "knowledge_chunks" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "prompt_templates" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "knowledge_chunks" CASCADE;
  DROP TABLE "knowledge_documents" CASCADE;
  DROP TABLE "prompt_templates" CASCADE;
  DROP TYPE "public"."enum_knowledge_documents_source_type";
  DROP TYPE "public"."enum_knowledge_documents_locale";
  DROP TYPE "public"."enum_knowledge_documents_review_status";
  DROP TYPE "public"."enum_knowledge_documents_index_status";
  DROP TYPE "public"."enum_knowledge_chunks_locale";
  DROP TYPE "public"."enum_prompt_templates_purpose";
  DROP TYPE "public"."enum_prompt_templates_locale";
  DROP TYPE "public"."enum_prompt_templates_status";`)
}
