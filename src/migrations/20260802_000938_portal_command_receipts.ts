import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload: _payload, req: _req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_portal_command_receipts_status" AS ENUM('processing', 'completed', 'failed');
  CREATE TABLE "portal_command_receipts" (
    "id" serial PRIMARY KEY NOT NULL,
    "scope" varchar NOT NULL,
    "idempotency_key" varchar NOT NULL,
    "fingerprint" varchar NOT NULL,
    "actor_id" integer NOT NULL,
    "owner_token" varchar NOT NULL,
    "lease_expires_at" timestamp(3) with time zone NOT NULL,
    "status" "enum_portal_command_receipts_status" DEFAULT 'processing' NOT NULL,
    "result" jsonb,
    "error_code" varchar,
    "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
    "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );

  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "portal_command_receipts_id" integer;
  ALTER TABLE "portal_command_receipts" ADD CONSTRAINT "portal_command_receipts_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "portal_command_receipts_scope_idx" ON "portal_command_receipts" USING btree ("scope");
  CREATE INDEX "portal_command_receipts_actor_idx" ON "portal_command_receipts" USING btree ("actor_id");
  CREATE INDEX "portal_command_receipts_lease_expires_at_idx" ON "portal_command_receipts" USING btree ("lease_expires_at");
  CREATE INDEX "portal_command_receipts_status_idx" ON "portal_command_receipts" USING btree ("status");
  CREATE INDEX "portal_command_receipts_updated_at_idx" ON "portal_command_receipts" USING btree ("updated_at");
  CREATE INDEX "portal_command_receipts_created_at_idx" ON "portal_command_receipts" USING btree ("created_at");
  CREATE UNIQUE INDEX "actor_scope_idempotencyKey_idx" ON "portal_command_receipts" USING btree ("actor_id","scope","idempotency_key");
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_portal_command_receipts_fk" FOREIGN KEY ("portal_command_receipts_id") REFERENCES "public"."portal_command_receipts"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_portal_command_receipts_id_idx" ON "payload_locked_documents_rels" USING btree ("portal_command_receipts_id");`)
}

export async function down({ db, payload: _payload, req: _req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "portal_command_receipts" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "portal_command_receipts" CASCADE;
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_portal_command_receipts_fk";

  DROP INDEX "payload_locked_documents_rels_portal_command_receipts_id_idx";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "portal_command_receipts_id";
  DROP TYPE "public"."enum_portal_command_receipts_status";`)
}
