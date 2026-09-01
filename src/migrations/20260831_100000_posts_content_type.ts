import { MigrateDownArgs, MigrateUpArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    CREATE TYPE "public"."enum_posts_content_type" AS ENUM('news', 'knowledge');
    CREATE TYPE "public"."enum__posts_v_version_content_type" AS ENUM('news', 'knowledge');
    ALTER TABLE "posts" ADD COLUMN "content_type" "enum_posts_content_type" DEFAULT 'news' NOT NULL;
    ALTER TABLE "_posts_v" ADD COLUMN "version_content_type" "enum__posts_v_version_content_type" DEFAULT 'news';
    CREATE INDEX "posts_content_type_idx" ON "posts" USING btree ("content_type");
    CREATE INDEX "_posts_v_version_content_type_idx" ON "_posts_v" USING btree ("version_content_type");
    ALTER TYPE "public"."enum_posts_category" ADD VALUE IF NOT EXISTS 'material-comparison';
    ALTER TYPE "public"."enum_posts_category" ADD VALUE IF NOT EXISTS 'technical-guide';
    ALTER TYPE "public"."enum_posts_category" ADD VALUE IF NOT EXISTS 'procurement';
    ALTER TYPE "public"."enum_posts_category" ADD VALUE IF NOT EXISTS 'quality-logistics';
    ALTER TYPE "public"."enum__posts_v_version_category" ADD VALUE IF NOT EXISTS 'material-comparison';
    ALTER TYPE "public"."enum__posts_v_version_category" ADD VALUE IF NOT EXISTS 'technical-guide';
    ALTER TYPE "public"."enum__posts_v_version_category" ADD VALUE IF NOT EXISTS 'procurement';
    ALTER TYPE "public"."enum__posts_v_version_category" ADD VALUE IF NOT EXISTS 'quality-logistics';
  `)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    DROP INDEX IF EXISTS "_posts_v_version_content_type_idx";
    DROP INDEX IF EXISTS "posts_content_type_idx";
    ALTER TABLE "_posts_v" DROP COLUMN IF EXISTS "version_content_type";
    ALTER TABLE "posts" DROP COLUMN IF EXISTS "content_type";
    DROP TYPE IF EXISTS "public"."enum__posts_v_version_content_type";
    DROP TYPE IF EXISTS "public"."enum_posts_content_type";
  `)
}
