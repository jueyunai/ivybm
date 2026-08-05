import { type MigrateDownArgs, type MigrateUpArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    ALTER TABLE "pages" ADD COLUMN "has_been_published" boolean DEFAULT false;
    ALTER TABLE "_pages_v" ADD COLUMN "version_has_been_published" boolean DEFAULT false;
    ALTER TABLE "products" ADD COLUMN "has_been_published" boolean DEFAULT false;
    ALTER TABLE "_products_v" ADD COLUMN "version_has_been_published" boolean DEFAULT false;
    ALTER TABLE "projects" ADD COLUMN "has_been_published" boolean DEFAULT false;
    ALTER TABLE "_projects_v" ADD COLUMN "version_has_been_published" boolean DEFAULT false;
    ALTER TABLE "posts" ADD COLUMN "has_been_published" boolean DEFAULT false;
    ALTER TABLE "_posts_v" ADD COLUMN "version_has_been_published" boolean DEFAULT false;

    CREATE INDEX "pages_has_been_published_idx" ON "pages" USING btree ("has_been_published");
    CREATE INDEX "_pages_v_version_version_has_been_published_idx" ON "_pages_v" USING btree ("version_has_been_published");
    CREATE INDEX "products_has_been_published_idx" ON "products" USING btree ("has_been_published");
    CREATE INDEX "_products_v_version_version_has_been_published_idx" ON "_products_v" USING btree ("version_has_been_published");
    CREATE INDEX "projects_has_been_published_idx" ON "projects" USING btree ("has_been_published");
    CREATE INDEX "_projects_v_version_version_has_been_published_idx" ON "_projects_v" USING btree ("version_has_been_published");
    CREATE INDEX "posts_has_been_published_idx" ON "posts" USING btree ("has_been_published");
    CREATE INDEX "_posts_v_version_version_has_been_published_idx" ON "_posts_v" USING btree ("version_has_been_published");

    UPDATE "pages" AS root SET "has_been_published" = true
    WHERE root."_status" = 'published' OR EXISTS (SELECT 1 FROM "_pages_v" AS version WHERE version."parent_id" = root."id" AND version."version__status" = 'published');
    UPDATE "_pages_v" AS version SET "version_has_been_published" = true
    WHERE EXISTS (SELECT 1 FROM "_pages_v" AS published_version WHERE published_version."parent_id" = version."parent_id" AND published_version."version__status" = 'published');

    UPDATE "products" AS root SET "has_been_published" = true
    WHERE root."_status" = 'published' OR EXISTS (SELECT 1 FROM "_products_v" AS version WHERE version."parent_id" = root."id" AND version."version__status" = 'published');
    UPDATE "_products_v" AS version SET "version_has_been_published" = true
    WHERE EXISTS (SELECT 1 FROM "_products_v" AS published_version WHERE published_version."parent_id" = version."parent_id" AND published_version."version__status" = 'published');

    UPDATE "projects" AS root SET "has_been_published" = true
    WHERE root."_status" = 'published' OR EXISTS (SELECT 1 FROM "_projects_v" AS version WHERE version."parent_id" = root."id" AND version."version__status" = 'published');
    UPDATE "_projects_v" AS version SET "version_has_been_published" = true
    WHERE EXISTS (SELECT 1 FROM "_projects_v" AS published_version WHERE published_version."parent_id" = version."parent_id" AND published_version."version__status" = 'published');

    UPDATE "posts" AS root SET "has_been_published" = true
    WHERE root."_status" = 'published' OR EXISTS (SELECT 1 FROM "_posts_v" AS version WHERE version."parent_id" = root."id" AND version."version__status" = 'published');
    UPDATE "_posts_v" AS version SET "version_has_been_published" = true
    WHERE EXISTS (SELECT 1 FROM "_posts_v" AS published_version WHERE published_version."parent_id" = version."parent_id" AND published_version."version__status" = 'published');
  `)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    DROP INDEX "pages_has_been_published_idx";
    DROP INDEX "_pages_v_version_version_has_been_published_idx";
    DROP INDEX "products_has_been_published_idx";
    DROP INDEX "_products_v_version_version_has_been_published_idx";
    DROP INDEX "projects_has_been_published_idx";
    DROP INDEX "_projects_v_version_version_has_been_published_idx";
    DROP INDEX "posts_has_been_published_idx";
    DROP INDEX "_posts_v_version_version_has_been_published_idx";
    ALTER TABLE "pages" DROP COLUMN "has_been_published";
    ALTER TABLE "_pages_v" DROP COLUMN "version_has_been_published";
    ALTER TABLE "products" DROP COLUMN "has_been_published";
    ALTER TABLE "_products_v" DROP COLUMN "version_has_been_published";
    ALTER TABLE "projects" DROP COLUMN "has_been_published";
    ALTER TABLE "_projects_v" DROP COLUMN "version_has_been_published";
    ALTER TABLE "posts" DROP COLUMN "has_been_published";
    ALTER TABLE "_posts_v" DROP COLUMN "version_has_been_published";
  `)
}
