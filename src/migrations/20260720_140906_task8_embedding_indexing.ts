import { sql, type MigrateDownArgs, type MigrateUpArgs } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    ALTER TABLE "knowledge_documents" ADD COLUMN "embedding_space" varchar;
    ALTER TABLE "knowledge_chunks" ADD COLUMN "embedding_space" varchar;
  `)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    ALTER TABLE "knowledge_chunks" DROP COLUMN "embedding_space";
    ALTER TABLE "knowledge_documents" DROP COLUMN "embedding_space";
  `)
}
