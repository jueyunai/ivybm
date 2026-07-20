import { sql, type MigrateDownArgs, type MigrateUpArgs } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_ai_providers_protocol" AS ENUM('openai-compatible');
  CREATE TYPE "public"."enum_ai_model_profiles_capability" AS ENUM('text', 'embedding');
  CREATE TYPE "public"."enum_ai_model_profiles_parameters_reasoning_effort" AS ENUM('none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max');
  CREATE TYPE "public"."enum_ai_usage_routes_operation" AS ENUM('text', 'embedding');
  CREATE TABLE "ai_providers" (
    "id" serial PRIMARY KEY NOT NULL,
    "name" varchar NOT NULL,
    "enabled" boolean DEFAULT true NOT NULL,
    "protocol" "enum_ai_providers_protocol" DEFAULT 'openai-compatible' NOT NULL,
    "base_u_r_l" varchar NOT NULL,
    "api_key" varchar,
    "api_key_configured" boolean DEFAULT false NOT NULL,
    "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
    "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );

  CREATE TABLE "ai_model_profiles" (
    "id" serial PRIMARY KEY NOT NULL,
    "name" varchar NOT NULL,
    "enabled" boolean DEFAULT true NOT NULL,
    "provider_id" integer NOT NULL,
    "capability" "enum_ai_model_profiles_capability" NOT NULL,
    "model" varchar NOT NULL,
    "parameters_timeout_ms" numeric DEFAULT 30000 NOT NULL,
    "parameters_max_output_tokens" numeric,
    "parameters_reasoning_enabled" boolean DEFAULT false,
    "parameters_reasoning_effort" "enum_ai_model_profiles_parameters_reasoning_effort" DEFAULT 'medium',
    "parameters_temperature" numeric,
    "parameters_top_p" numeric,
    "parameters_dimensions" numeric,
    "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
    "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );

  CREATE TABLE "ai_usage_routes" (
    "id" serial PRIMARY KEY NOT NULL,
    "usage_key" varchar NOT NULL,
    "enabled" boolean DEFAULT true NOT NULL,
    "operation" "enum_ai_usage_routes_operation" NOT NULL,
    "profile_id" integer NOT NULL,
    "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
    "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );

  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "ai_providers_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "ai_model_profiles_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "ai_usage_routes_id" integer;
  ALTER TABLE "ai_model_profiles" ADD CONSTRAINT "ai_model_profiles_provider_id_ai_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."ai_providers"("id") ON DELETE restrict ON UPDATE no action;
  ALTER TABLE "ai_usage_routes" ADD CONSTRAINT "ai_usage_routes_profile_id_ai_model_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."ai_model_profiles"("id") ON DELETE restrict ON UPDATE no action;
  CREATE UNIQUE INDEX "ai_providers_name_idx" ON "ai_providers" USING btree ("name");
  CREATE INDEX "ai_providers_updated_at_idx" ON "ai_providers" USING btree ("updated_at");
  CREATE INDEX "ai_providers_created_at_idx" ON "ai_providers" USING btree ("created_at");
  CREATE UNIQUE INDEX "ai_model_profiles_name_idx" ON "ai_model_profiles" USING btree ("name");
  CREATE INDEX "ai_model_profiles_provider_idx" ON "ai_model_profiles" USING btree ("provider_id");
  CREATE INDEX "ai_model_profiles_updated_at_idx" ON "ai_model_profiles" USING btree ("updated_at");
  CREATE INDEX "ai_model_profiles_created_at_idx" ON "ai_model_profiles" USING btree ("created_at");
  CREATE UNIQUE INDEX "ai_usage_routes_usage_key_idx" ON "ai_usage_routes" USING btree ("usage_key");
  CREATE INDEX "ai_usage_routes_profile_idx" ON "ai_usage_routes" USING btree ("profile_id");
  CREATE INDEX "ai_usage_routes_updated_at_idx" ON "ai_usage_routes" USING btree ("updated_at");
  CREATE INDEX "ai_usage_routes_created_at_idx" ON "ai_usage_routes" USING btree ("created_at");
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_ai_providers_fk" FOREIGN KEY ("ai_providers_id") REFERENCES "public"."ai_providers"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_ai_model_profiles_fk" FOREIGN KEY ("ai_model_profiles_id") REFERENCES "public"."ai_model_profiles"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_ai_usage_routes_fk" FOREIGN KEY ("ai_usage_routes_id") REFERENCES "public"."ai_usage_routes"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_ai_providers_id_idx" ON "payload_locked_documents_rels" USING btree ("ai_providers_id");
  CREATE INDEX "payload_locked_documents_rels_ai_model_profiles_id_idx" ON "payload_locked_documents_rels" USING btree ("ai_model_profiles_id");
  CREATE INDEX "payload_locked_documents_rels_ai_usage_routes_id_idx" ON "payload_locked_documents_rels" USING btree ("ai_usage_routes_id");`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_ai_providers_fk";
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_ai_model_profiles_fk";
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_ai_usage_routes_fk";
  DROP INDEX "payload_locked_documents_rels_ai_providers_id_idx";
  DROP INDEX "payload_locked_documents_rels_ai_model_profiles_id_idx";
  DROP INDEX "payload_locked_documents_rels_ai_usage_routes_id_idx";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "ai_providers_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "ai_model_profiles_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "ai_usage_routes_id";
  ALTER TABLE "ai_usage_routes" DROP CONSTRAINT "ai_usage_routes_profile_id_ai_model_profiles_id_fk";
  ALTER TABLE "ai_model_profiles" DROP CONSTRAINT "ai_model_profiles_provider_id_ai_providers_id_fk";
  DROP TABLE "ai_usage_routes";
  DROP TABLE "ai_model_profiles";
  DROP TABLE "ai_providers";
  DROP TYPE "public"."enum_ai_providers_protocol";
  DROP TYPE "public"."enum_ai_model_profiles_capability";
  DROP TYPE "public"."enum_ai_model_profiles_parameters_reasoning_effort";
  DROP TYPE "public"."enum_ai_usage_routes_operation";`)
}
