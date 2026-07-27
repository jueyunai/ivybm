import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload: _payload, req: _req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TYPE "public"."enum_visitor_sessions_channel" ADD VALUE 'tiktok';
  ALTER TYPE "public"."enum_conversations_channel" ADD VALUE 'tiktok';`)
}

export async function down({ db, payload: _payload, req: _req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM "visitor_sessions" WHERE "channel" = 'tiktok')
      OR EXISTS (SELECT 1 FROM "conversations" WHERE "channel" = 'tiktok')
      OR EXISTS (
        SELECT 1 FROM "jobs"
        WHERE "type" = 'platform.event.dispatch'
          AND "status" IN ('pending', 'processing', 'failed', 'dead')
          AND "payload" -> 'event' ->> 'platform' = 'tiktok'
      ) THEN
      RAISE EXCEPTION 'Cannot roll back Task 13 TikTok channel migration while TikTok sessions, conversations, or actionable Jobs exist';
    END IF;
   END $$;
  ALTER TABLE "visitor_sessions" ALTER COLUMN "channel" SET DATA TYPE text;
  DROP TYPE "public"."enum_visitor_sessions_channel";
  CREATE TYPE "public"."enum_visitor_sessions_channel" AS ENUM('website', 'whatsapp', 'facebook', 'instagram');
  ALTER TABLE "visitor_sessions" ALTER COLUMN "channel" SET DATA TYPE "public"."enum_visitor_sessions_channel" USING "channel"::"public"."enum_visitor_sessions_channel";
  ALTER TABLE "conversations" ALTER COLUMN "channel" SET DATA TYPE text;
  DROP TYPE "public"."enum_conversations_channel";
  CREATE TYPE "public"."enum_conversations_channel" AS ENUM('website', 'whatsapp', 'facebook', 'instagram');
  ALTER TABLE "conversations" ALTER COLUMN "channel" SET DATA TYPE "public"."enum_conversations_channel" USING "channel"::"public"."enum_conversations_channel";`)
}
