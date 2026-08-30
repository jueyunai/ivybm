import { MigrateDownArgs, MigrateUpArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    ALTER TABLE "platform_accounts"
      ADD COLUMN "messaging_external_account_id" varchar,
      ADD COLUMN "messaging_connection_key" varchar;
    CREATE INDEX "platform_accounts_messaging_external_account_id_idx"
      ON "platform_accounts" USING btree ("messaging_external_account_id");
    CREATE UNIQUE INDEX "platform_accounts_messaging_connection_key_idx"
      ON "platform_accounts" USING btree ("messaging_connection_key");

    CREATE TABLE "meta_webhook_replays" (
      "id" serial PRIMARY KEY NOT NULL,
      "trace_id" uuid NOT NULL,
      "provider_object" varchar NOT NULL,
      "error_code" varchar NOT NULL,
      "body_sha256" char(64) NOT NULL,
      "body_bytes" integer NOT NULL,
      "content_type" varchar NOT NULL,
      "encrypted_body" text NOT NULL,
      "key_version" integer DEFAULT 1 NOT NULL,
      "received_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
      "last_received_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
      "expires_at" timestamp(3) with time zone NOT NULL,
      "retry_count" integer DEFAULT 1 NOT NULL,
      "exported_at" timestamp(3) with time zone,
      CONSTRAINT "meta_webhook_replays_provider_object_check"
        CHECK ("provider_object" IN ('instagram', 'page', 'unknown')),
      CONSTRAINT "meta_webhook_replays_body_bytes_check"
        CHECK ("body_bytes" > 0 AND "body_bytes" <= 1000000),
      CONSTRAINT "meta_webhook_replays_retry_count_check"
        CHECK ("retry_count" > 0),
      CONSTRAINT "meta_webhook_replays_body_error_unique"
        UNIQUE ("body_sha256", "error_code")
    );
    CREATE INDEX "meta_webhook_replays_expires_at_idx"
      ON "meta_webhook_replays" USING btree ("expires_at");
    CREATE INDEX "meta_webhook_replays_trace_id_idx"
      ON "meta_webhook_replays" USING btree ("trace_id");
  `)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM "meta_webhook_replays" WHERE "expires_at" > now()) THEN
        RAISE EXCEPTION 'Cannot remove Meta webhook replay storage while unexpired records exist';
      END IF;
    END $$;
    DROP TABLE "meta_webhook_replays";
    DROP INDEX "platform_accounts_messaging_connection_key_idx";
    DROP INDEX "platform_accounts_messaging_external_account_id_idx";
    ALTER TABLE "platform_accounts"
      DROP COLUMN "messaging_connection_key",
      DROP COLUMN "messaging_external_account_id";
  `)
}
