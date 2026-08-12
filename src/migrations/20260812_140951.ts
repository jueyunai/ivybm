import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_ai_providers_text_generation_contract" AS ENUM('responses', 'chat-completions');
  ALTER TABLE "ai_providers" ADD COLUMN "text_generation_contract" "enum_ai_providers_text_generation_contract" DEFAULT 'responses' NOT NULL;`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "ai_providers" DROP COLUMN "text_generation_contract";
  DROP TYPE "public"."enum_ai_providers_text_generation_contract";`)
}
