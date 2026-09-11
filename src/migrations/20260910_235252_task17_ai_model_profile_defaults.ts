import { MigrateDownArgs, MigrateUpArgs, sql } from '@payloadcms/db-postgres'

// Historical migration on branch: set column defaults to 90000 and 8192.
// Corrected by 20260911_024207_task17_ai_model_profile_defaults.
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "ai_model_profiles" ALTER COLUMN "parameters_timeout_ms" SET DEFAULT 90000;
  ALTER TABLE "ai_model_profiles" ALTER COLUMN "parameters_max_output_tokens" SET DEFAULT 8192;`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "ai_model_profiles" ALTER COLUMN "parameters_timeout_ms" SET DEFAULT 30000;
  ALTER TABLE "ai_model_profiles" ALTER COLUMN "parameters_max_output_tokens" DROP DEFAULT;`)
}
