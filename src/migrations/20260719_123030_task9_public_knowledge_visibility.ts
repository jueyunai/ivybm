import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload: _payload, req: _req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
  ALTER TABLE "knowledge_documents" ADD COLUMN "customer_visible" boolean DEFAULT false;
  CREATE INDEX "knowledge_documents_customer_visible_idx" ON "knowledge_documents" USING btree ("customer_visible");
  `)
}

export async function down({ db, payload: _payload, req: _req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
  DROP INDEX "knowledge_documents_customer_visible_idx";
  ALTER TABLE "knowledge_documents" DROP COLUMN "customer_visible";`)
}
