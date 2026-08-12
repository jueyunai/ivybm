import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_publish_jobs_execution_route" AS ENUM('facebook-photo-single', 'instagram-image-staged', 'linkedin-text-single', 'linkedin-image-staged');
  ALTER TYPE "public"."enum_publish_logs_event" ADD VALUE 'claimed' BEFORE 'scheduled';
  ALTER TYPE "public"."enum_publish_logs_event" ADD VALUE 'provider-io-started' BEFORE 'status-updated';
  ALTER TYPE "public"."enum_publish_logs_event" ADD VALUE 'checkpoint-committed' BEFORE 'status-updated';
  ALTER TABLE "publish_jobs" ADD COLUMN "execution_route" "enum_publish_jobs_execution_route";
  ALTER TABLE "publish_jobs" ADD COLUMN "execution_revision" numeric DEFAULT 0 NOT NULL;
  ALTER TABLE "publish_jobs" ADD COLUMN "request_fingerprint" varchar;
  ALTER TABLE "publish_jobs" ADD COLUMN "request_snapshot" jsonb;
  ALTER TABLE "publish_jobs" ADD COLUMN "provider_checkpoint" jsonb;
  ALTER TABLE "publish_jobs" ADD COLUMN "authorization_revision" numeric;
  ALTER TABLE "publish_jobs" ADD COLUMN "claim_job_id" integer;
  ALTER TABLE "publish_jobs" ADD COLUMN "claim_id" varchar;
  ALTER TABLE "publish_jobs" ADD COLUMN "claim_owner_token" varchar;
  ALTER TABLE "publish_jobs" ADD COLUMN "claim_lease_expires_at" timestamp(3) with time zone;
  ALTER TABLE "publish_jobs" ADD COLUMN "fencing_generation" numeric DEFAULT 0 NOT NULL;
  ALTER TABLE "publish_jobs" ADD COLUMN "provider_i_o_started_at" timestamp(3) with time zone;
  ALTER TABLE "publish_jobs" ADD COLUMN "delivery_unknown_at" timestamp(3) with time zone;
  ALTER TABLE "publish_jobs" ADD COLUMN "external_publication_url" varchar;
  ALTER TABLE "publish_jobs" ADD CONSTRAINT "publish_jobs_claim_job_id_jobs_id_fk" FOREIGN KEY ("claim_job_id") REFERENCES "public"."jobs"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "publish_jobs_execution_route_idx" ON "publish_jobs" USING btree ("execution_route");
  CREATE INDEX "publish_jobs_request_fingerprint_idx" ON "publish_jobs" USING btree ("request_fingerprint");
  CREATE INDEX "publish_jobs_claim_job_idx" ON "publish_jobs" USING btree ("claim_job_id");
  CREATE INDEX "publish_jobs_claim_lease_expires_at_idx" ON "publish_jobs" USING btree ("claim_lease_expires_at");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "publish_jobs" DROP CONSTRAINT "publish_jobs_claim_job_id_jobs_id_fk";
  
  ALTER TABLE "publish_logs" ALTER COLUMN "event" SET DATA TYPE text;
  DROP TYPE "public"."enum_publish_logs_event";
  CREATE TYPE "public"."enum_publish_logs_event" AS ENUM('created', 'scheduled', 'accepted', 'assisted-package-ready', 'status-updated', 'failed', 'delivery-unknown');
  ALTER TABLE "publish_logs" ALTER COLUMN "event" SET DATA TYPE "public"."enum_publish_logs_event" USING "event"::"public"."enum_publish_logs_event";
  DROP INDEX "publish_jobs_execution_route_idx";
  DROP INDEX "publish_jobs_request_fingerprint_idx";
  DROP INDEX "publish_jobs_claim_job_idx";
  DROP INDEX "publish_jobs_claim_lease_expires_at_idx";
  ALTER TABLE "publish_jobs" DROP COLUMN "execution_route";
  ALTER TABLE "publish_jobs" DROP COLUMN "execution_revision";
  ALTER TABLE "publish_jobs" DROP COLUMN "request_fingerprint";
  ALTER TABLE "publish_jobs" DROP COLUMN "request_snapshot";
  ALTER TABLE "publish_jobs" DROP COLUMN "provider_checkpoint";
  ALTER TABLE "publish_jobs" DROP COLUMN "authorization_revision";
  ALTER TABLE "publish_jobs" DROP COLUMN "claim_job_id";
  ALTER TABLE "publish_jobs" DROP COLUMN "claim_id";
  ALTER TABLE "publish_jobs" DROP COLUMN "claim_owner_token";
  ALTER TABLE "publish_jobs" DROP COLUMN "claim_lease_expires_at";
  ALTER TABLE "publish_jobs" DROP COLUMN "fencing_generation";
  ALTER TABLE "publish_jobs" DROP COLUMN "provider_i_o_started_at";
  ALTER TABLE "publish_jobs" DROP COLUMN "delivery_unknown_at";
  ALTER TABLE "publish_jobs" DROP COLUMN "external_publication_url";
  DROP TYPE "public"."enum_publish_jobs_execution_route";`)
}
