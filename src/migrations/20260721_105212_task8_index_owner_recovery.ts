import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    ALTER TABLE "knowledge_documents" ADD COLUMN "index_job_id" numeric;
    ALTER TABLE "knowledge_documents" ADD COLUMN "index_owner_token" varchar;
  `)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    ALTER TABLE "knowledge_documents" DROP COLUMN "index_job_id";
    ALTER TABLE "knowledge_documents" DROP COLUMN "index_owner_token";
  `)
}
