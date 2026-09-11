import { MigrateDownArgs, MigrateUpArgs, sql } from '@payloadcms/db-postgres'

// Widens the AI model profile defaults so long-tail provider latency and longer
// engineering copy do not silently fail or truncate. Values mirror the
// AiModelProfiles collection defaults.
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
