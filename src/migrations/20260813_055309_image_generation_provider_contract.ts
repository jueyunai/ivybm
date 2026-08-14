import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_ai_providers_text_generation_contract" AS ENUM('responses', 'chat-completions');
  ALTER TYPE "public"."enum_ai_model_profiles_capability" ADD VALUE 'image';
  ALTER TYPE "public"."enum_ai_usage_routes_operation" ADD VALUE 'image';
  ALTER TYPE "public"."enum_ai_usage_logs_operation" ADD VALUE 'generateImage' BEFORE 'generateText';
  ALTER TABLE "ai_providers" ADD COLUMN "text_generation_contract" "enum_ai_providers_text_generation_contract" DEFAULT 'responses' NOT NULL;`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   DO $$
   BEGIN
     IF EXISTS (SELECT 1 FROM "ai_model_profiles" WHERE "capability" = 'image')
       OR EXISTS (SELECT 1 FROM "ai_usage_routes" WHERE "operation" = 'image')
       OR EXISTS (SELECT 1 FROM "ai_usage_logs" WHERE "operation" = 'generateImage') THEN
       RAISE EXCEPTION 'Cannot roll back image generation migration while image configuration or usage data exists';
     END IF;
     IF EXISTS (SELECT 1 FROM "ai_providers" WHERE "text_generation_contract" = 'chat-completions') THEN
       RAISE EXCEPTION 'Cannot roll back image generation/provider contract migration while chat-completions provider configuration exists';
     END IF;
   END $$;`)
  await db.execute(sql`
   ALTER TABLE "ai_model_profiles" ALTER COLUMN "capability" SET DATA TYPE text;
  DROP TYPE "public"."enum_ai_model_profiles_capability";
  CREATE TYPE "public"."enum_ai_model_profiles_capability" AS ENUM('text', 'embedding');
  ALTER TABLE "ai_model_profiles" ALTER COLUMN "capability" SET DATA TYPE "public"."enum_ai_model_profiles_capability" USING "capability"::"public"."enum_ai_model_profiles_capability";
  ALTER TABLE "ai_usage_routes" ALTER COLUMN "operation" SET DATA TYPE text;
  DROP TYPE "public"."enum_ai_usage_routes_operation";
  CREATE TYPE "public"."enum_ai_usage_routes_operation" AS ENUM('text', 'embedding');
  ALTER TABLE "ai_usage_routes" ALTER COLUMN "operation" SET DATA TYPE "public"."enum_ai_usage_routes_operation" USING "operation"::"public"."enum_ai_usage_routes_operation";
  ALTER TABLE "ai_usage_logs" ALTER COLUMN "operation" SET DATA TYPE text;
  DROP TYPE "public"."enum_ai_usage_logs_operation";
  CREATE TYPE "public"."enum_ai_usage_logs_operation" AS ENUM('embed', 'generateText');
  ALTER TABLE "ai_usage_logs" ALTER COLUMN "operation" SET DATA TYPE "public"."enum_ai_usage_logs_operation" USING "operation"::"public"."enum_ai_usage_logs_operation";
  ALTER TABLE "ai_providers" DROP COLUMN "text_generation_contract";
  DROP TYPE "public"."enum_ai_providers_text_generation_contract";`)
}
