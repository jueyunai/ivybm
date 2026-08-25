import { MigrateDownArgs, MigrateUpArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    CREATE TYPE "public"."enum_leads_messaging_platform"
      AS ENUM('facebook-messenger', 'instagram', 'tiktok');
    ALTER TABLE "leads" ALTER COLUMN "email" DROP NOT NULL;
    ALTER TABLE "leads"
      ADD COLUMN "messaging_platform" "enum_leads_messaging_platform",
      ADD COLUMN "messaging_account_external_id" varchar,
      ADD COLUMN "messaging_sender_external_id" varchar,
      ADD COLUMN "messaging_thread_external_id" varchar;
    ALTER TABLE "leads" ADD CONSTRAINT "leads_contact_channel_check" CHECK (
      NULLIF(BTRIM("email"), '') IS NOT NULL
      OR NULLIF(BTRIM("phone"), '') IS NOT NULL
      OR (
        "messaging_platform" IS NOT NULL
        AND NULLIF(BTRIM("messaging_account_external_id"), '') IS NOT NULL
        AND NULLIF(BTRIM("messaging_sender_external_id"), '') IS NOT NULL
        AND NULLIF(BTRIM("messaging_thread_external_id"), '') IS NOT NULL
      )
    );
    UPDATE "feishu_mappings_field_mappings"
    SET "required" = false
    WHERE "local_field" = 'email';
  `)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM "leads" WHERE NULLIF(BTRIM("email"), '') IS NULL
      ) THEN
        RAISE EXCEPTION 'Cannot restore required Lead email while email-less Leads exist';
      END IF;
    END $$;
    ALTER TABLE "leads" DROP CONSTRAINT "leads_contact_channel_check";
    ALTER TABLE "leads"
      DROP COLUMN "messaging_platform",
      DROP COLUMN "messaging_account_external_id",
      DROP COLUMN "messaging_sender_external_id",
      DROP COLUMN "messaging_thread_external_id";
    ALTER TABLE "leads" ALTER COLUMN "email" SET NOT NULL;
    UPDATE "feishu_mappings_field_mappings"
    SET "required" = true
    WHERE "local_field" = 'email';
    DROP TYPE "public"."enum_leads_messaging_platform";
  `)
}
