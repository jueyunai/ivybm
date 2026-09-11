import { MigrateDownArgs, MigrateUpArgs, sql } from '@payloadcms/db-postgres'

// Widens the timeout default so long-tail provider latency does not silently
// abandon a request that the provider still bills for.
//
// parameters_max_output_tokens deliberately gets no column default: the column
// is shared by text, embedding and image profiles, and both the AiModelProfiles
// validation and the AI route registry reject text-generation settings on
// non-text profiles. Its default is applied per capability in the collection's
// beforeChange hook instead.
//
// The paired .json snapshot is the complete generated schema; this file keeps
// only this task's statements, matching how task14 and posts_content_type were
// trimmed. Running the full generated diff would fail on tables that
// 20260831_092856_v17_cms_structures already created.
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "ai_model_profiles" ALTER COLUMN "parameters_timeout_ms" SET DEFAULT 90000;
  ALTER TABLE "ai_model_profiles" ALTER COLUMN "parameters_max_output_tokens" DROP DEFAULT;`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "ai_model_profiles" ALTER COLUMN "parameters_timeout_ms" SET DEFAULT 30000;`)
}
