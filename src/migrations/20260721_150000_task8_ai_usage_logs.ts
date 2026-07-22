import { type MigrateDownArgs, type MigrateUpArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    CREATE TYPE "public"."enum_ai_usage_logs_operation" AS ENUM('embed', 'generateText');
    CREATE TABLE "ai_usage_logs" (
      "id" serial PRIMARY KEY NOT NULL,
      "operation" "enum_ai_usage_logs_operation" NOT NULL,
      "provider" varchar NOT NULL,
      "model" varchar NOT NULL,
      "request_id" varchar,
      "input_tokens" numeric NOT NULL,
      "output_tokens" numeric,
      "total_tokens" numeric NOT NULL,
      "estimated_cost_u_s_d" numeric,
      "duration_ms" numeric NOT NULL,
      "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
      "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
      CONSTRAINT "ai_usage_logs_input_tokens_ck" CHECK ("input_tokens" >= 0),
      CONSTRAINT "ai_usage_logs_output_tokens_ck" CHECK ("output_tokens" IS NULL OR "output_tokens" >= 0),
      CONSTRAINT "ai_usage_logs_total_tokens_ck" CHECK ("total_tokens" >= 0),
      CONSTRAINT "ai_usage_logs_estimated_cost_u_s_d_ck" CHECK ("estimated_cost_u_s_d" IS NULL OR "estimated_cost_u_s_d" >= 0),
      CONSTRAINT "ai_usage_logs_duration_ms_ck" CHECK ("duration_ms" >= 0)
    );
    ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "ai_usage_logs_id" integer;
    ALTER TABLE "payload_locked_documents_rels"
      ADD CONSTRAINT "payload_locked_documents_rels_ai_usage_logs_fk"
      FOREIGN KEY ("ai_usage_logs_id") REFERENCES "public"."ai_usage_logs"("id")
      ON DELETE cascade ON UPDATE no action;
    CREATE INDEX "ai_usage_logs_updated_at_idx" ON "ai_usage_logs" USING btree ("updated_at");
    CREATE INDEX "ai_usage_logs_created_at_idx" ON "ai_usage_logs" USING btree ("created_at");
    CREATE INDEX "ai_usage_logs_provider_model_idx" ON "ai_usage_logs" USING btree ("provider", "model");
    CREATE INDEX "payload_locked_documents_rels_ai_usage_logs_id_idx"
      ON "payload_locked_documents_rels" USING btree ("ai_usage_logs_id");
  `)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    ALTER TABLE "payload_locked_documents_rels"
      DROP CONSTRAINT IF EXISTS "payload_locked_documents_rels_ai_usage_logs_fk";
    DROP INDEX IF EXISTS "payload_locked_documents_rels_ai_usage_logs_id_idx";
    ALTER TABLE "payload_locked_documents_rels" DROP COLUMN IF EXISTS "ai_usage_logs_id";
    DROP INDEX IF EXISTS "ai_usage_logs_updated_at_idx";
    DROP TABLE "ai_usage_logs";
    DROP TYPE "public"."enum_ai_usage_logs_operation";
  `)
}
