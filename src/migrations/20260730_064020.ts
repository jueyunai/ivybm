import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "generated_contents" ADD COLUMN "idempotency_key" varchar NOT NULL;
  ALTER TABLE "generated_contents" ADD COLUMN "creation_fingerprint" varchar NOT NULL;
  CREATE UNIQUE INDEX "generated_contents_idempotency_key_idx" ON "generated_contents" USING btree ("idempotency_key");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   DROP INDEX "generated_contents_idempotency_key_idx";
  ALTER TABLE "generated_contents" DROP COLUMN "idempotency_key";
  ALTER TABLE "generated_contents" DROP COLUMN "creation_fingerprint";`)
}
