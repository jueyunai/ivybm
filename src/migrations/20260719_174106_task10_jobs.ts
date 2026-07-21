import { MigrateDownArgs, MigrateUpArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    CREATE TYPE "public"."enum_jobs_status" AS ENUM('pending', 'processing', 'succeeded', 'failed', 'dead');
    CREATE TABLE "jobs" (
      "id" serial PRIMARY KEY NOT NULL,
      "type" varchar NOT NULL,
      "idempotency_key" varchar,
      "payload" jsonb NOT NULL,
      "status" "enum_jobs_status" DEFAULT 'pending' NOT NULL,
      "attempts" numeric DEFAULT 0 NOT NULL,
      "max_attempts" numeric DEFAULT 5 NOT NULL,
      "next_run_at" timestamp(3) with time zone,
      "lease_expires_at" timestamp(3) with time zone,
      "owner_token" varchar,
      "last_error" varchar,
      "completed_at" timestamp(3) with time zone,
      "dead_at" timestamp(3) with time zone,
      "manual_retry_count" numeric DEFAULT 0 NOT NULL,
      "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
      "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
    );

    ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "jobs_id" integer;
    CREATE INDEX "jobs_type_idx" ON "jobs" USING btree ("type");
    CREATE INDEX "jobs_status_idx" ON "jobs" USING btree ("status");
    CREATE INDEX "jobs_next_run_at_idx" ON "jobs" USING btree ("next_run_at");
    CREATE INDEX "jobs_lease_expires_at_idx" ON "jobs" USING btree ("lease_expires_at");
    CREATE INDEX "jobs_updated_at_idx" ON "jobs" USING btree ("updated_at");
    CREATE INDEX "jobs_created_at_idx" ON "jobs" USING btree ("created_at");
    CREATE UNIQUE INDEX "type_idempotencyKey_idx" ON "jobs" USING btree ("type", "idempotency_key");
    ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_jobs_fk" FOREIGN KEY ("jobs_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;
    CREATE INDEX "payload_locked_documents_rels_jobs_id_idx" ON "payload_locked_documents_rels" USING btree ("jobs_id");
  `)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_jobs_fk";
    DROP INDEX "payload_locked_documents_rels_jobs_id_idx";
    ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "jobs_id";
    DROP TABLE "jobs";
    DROP TYPE "public"."enum_jobs_status";
  `)
}
