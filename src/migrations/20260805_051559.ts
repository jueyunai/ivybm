import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_feishu_app_registrations_status" AS ENUM('pending', 'registering', 'qr_ready', 'configuring', 'authorization_ready', 'completed', 'failed', 'expired', 'cancelled');
  ALTER TYPE "public"."enum_feishu_connections_auth_mode" ADD VALUE 'qr_registered';
  CREATE TABLE "feishu_app_registrations" (
	"id" serial PRIMARY KEY NOT NULL,
	"status" "enum_feishu_app_registrations_status" DEFAULT 'pending' NOT NULL,
	"requested_by_id" integer,
	"qr_url" varchar,
	"qr_expires_at" timestamp(3) with time zone,
	"authorize_url" varchar,
	"authorize_expires_at" timestamp(3) with time zone,
	"configuring_started_at" timestamp(3) with time zone,
	"app_id" varchar,
	"app_secret_encrypted" varchar,
	"last_error_code" varchar,
	"completed_at" timestamp(3) with time zone,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );

  ALTER TABLE "feishu_connections" ADD COLUMN "app_id" varchar;
  ALTER TABLE "feishu_connections" ADD COLUMN "app_secret_encrypted" varchar;
  ALTER TABLE "feishu_oauth_states" ADD COLUMN "registration_id" integer;
  ALTER TABLE "feishu_oauth_states" ADD COLUMN "processing_at" timestamp(3) with time zone;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "feishu_app_registrations_id" integer;
  ALTER TABLE "feishu_app_registrations" ADD CONSTRAINT "feishu_app_registrations_requested_by_id_users_id_fk" FOREIGN KEY ("requested_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "feishu_app_registrations_status_idx" ON "feishu_app_registrations" USING btree ("status");
  CREATE INDEX "feishu_app_registrations_requested_by_idx" ON "feishu_app_registrations" USING btree ("requested_by_id");
  CREATE INDEX "feishu_app_registrations_qr_expires_at_idx" ON "feishu_app_registrations" USING btree ("qr_expires_at");
  CREATE INDEX "feishu_app_registrations_authorize_expires_at_idx" ON "feishu_app_registrations" USING btree ("authorize_expires_at");
  CREATE INDEX "feishu_app_registrations_configuring_started_at_idx" ON "feishu_app_registrations" USING btree ("configuring_started_at");
  CREATE INDEX "feishu_app_registrations_app_id_idx" ON "feishu_app_registrations" USING btree ("app_id");
  CREATE INDEX "feishu_app_registrations_updated_at_idx" ON "feishu_app_registrations" USING btree ("updated_at");
  CREATE INDEX "feishu_app_registrations_created_at_idx" ON "feishu_app_registrations" USING btree ("created_at");
  ALTER TABLE "feishu_oauth_states" ADD CONSTRAINT "feishu_oauth_states_registration_id_feishu_app_registrations_id_fk" FOREIGN KEY ("registration_id") REFERENCES "public"."feishu_app_registrations"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_feishu_app_registrations_fk" FOREIGN KEY ("feishu_app_registrations_id") REFERENCES "public"."feishu_app_registrations"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "feishu_oauth_states_registration_idx" ON "feishu_oauth_states" USING btree ("registration_id");
  CREATE INDEX "feishu_oauth_states_processing_at_idx" ON "feishu_oauth_states" USING btree ("processing_at");
  CREATE INDEX "payload_locked_documents_rels_feishu_app_registrations_i_idx" ON "payload_locked_documents_rels" USING btree ("feishu_app_registrations_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   DO $$
  BEGIN
    IF EXISTS (SELECT 1 FROM "feishu_connections" WHERE "auth_mode" = 'qr_registered') THEN
      RAISE EXCEPTION 'Cannot roll back Feishu QR registration while qr_registered connections exist';
    END IF;
    IF EXISTS (SELECT 1 FROM "feishu_connections" WHERE "app_secret_encrypted" IS NOT NULL) THEN
      RAISE EXCEPTION 'Cannot roll back Feishu QR registration while connection app credentials exist';
    END IF;
    IF EXISTS (
      SELECT 1 FROM "feishu_app_registrations" WHERE "app_secret_encrypted" IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'Cannot roll back Feishu QR registration while registered app credentials exist';
    END IF;
  END
  $$;
  ALTER TABLE "feishu_oauth_states" DROP CONSTRAINT "feishu_oauth_states_registration_id_feishu_app_registrations_id_fk";
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_feishu_app_registrations_fk";
  DROP INDEX "feishu_oauth_states_registration_idx";
  DROP INDEX "feishu_oauth_states_processing_at_idx";
  DROP INDEX "payload_locked_documents_rels_feishu_app_registrations_i_idx";
  ALTER TABLE "feishu_oauth_states" DROP COLUMN "registration_id";
  ALTER TABLE "feishu_oauth_states" DROP COLUMN "processing_at";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "feishu_app_registrations_id";
  ALTER TABLE "feishu_app_registrations" DROP COLUMN "configuring_started_at";
  ALTER TABLE "feishu_app_registrations" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "feishu_app_registrations";
  ALTER TABLE "feishu_connections" ALTER COLUMN "auth_mode" SET DATA TYPE text;
  ALTER TABLE "feishu_connections" ALTER COLUMN "auth_mode" SET DEFAULT 'store_oauth'::text;
  DROP TYPE "public"."enum_feishu_connections_auth_mode";
  CREATE TYPE "public"."enum_feishu_connections_auth_mode" AS ENUM('store_oauth');
  ALTER TABLE "feishu_connections" ALTER COLUMN "auth_mode" SET DEFAULT 'store_oauth'::"public"."enum_feishu_connections_auth_mode";
  ALTER TABLE "feishu_connections" ALTER COLUMN "auth_mode" SET DATA TYPE "public"."enum_feishu_connections_auth_mode" USING "auth_mode"::"public"."enum_feishu_connections_auth_mode";
  ALTER TABLE "feishu_connections" DROP COLUMN "app_id";
  ALTER TABLE "feishu_connections" DROP COLUMN "app_secret_encrypted";
  DROP TYPE "public"."enum_feishu_app_registrations_status";`)
}
