import { MigrateDownArgs, MigrateUpArgs, sql } from '@payloadcms/db-postgres'

// Corrective migration: resets parameters_timeout_ms default to 30000 to preserve
// the 120s Portal command lease invariant (text 30s + image 60s < 120s), and drops
// the column default on parameters_max_output_tokens so non-text profiles (image,
// embedding) are not polluted. Text model maxOutputTokens default (8192) is applied
// in the collection's beforeChange hook instead.
//
// The paired .json snapshot is the complete generated schema; this file keeps
// only this task's statements, matching how task14 and posts_content_type were
// trimmed.
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "ai_model_profiles" ALTER COLUMN "parameters_timeout_ms" SET DEFAULT 30000;
  ALTER TABLE "ai_model_profiles" ALTER COLUMN "parameters_max_output_tokens" DROP DEFAULT;`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "ai_model_profiles" ALTER COLUMN "parameters_timeout_ms" SET DEFAULT 90000;
  ALTER TABLE "ai_model_profiles" ALTER COLUMN "parameters_max_output_tokens" SET DEFAULT 8192;`)
}
