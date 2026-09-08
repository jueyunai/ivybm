import { MigrateDownArgs, MigrateUpArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    ALTER TABLE "platform_accounts"
      ADD COLUMN "ai_auto_reply_enabled" boolean DEFAULT false NOT NULL;
  `)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    ALTER TABLE "platform_accounts"
      DROP COLUMN "ai_auto_reply_enabled";
  `)
}
