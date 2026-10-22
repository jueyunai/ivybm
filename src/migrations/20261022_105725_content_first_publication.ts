import { type MigrateDownArgs, type MigrateUpArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
  ALTER TABLE "products" ADD COLUMN "published_at" timestamp(3) with time zone;
  ALTER TABLE "_products_v" ADD COLUMN "version_published_at" timestamp(3) with time zone;
  ALTER TABLE "projects" ADD COLUMN "published_at" timestamp(3) with time zone;
  ALTER TABLE "_projects_v" ADD COLUMN "version_published_at" timestamp(3) with time zone;
  CREATE INDEX "products_published_at_idx" ON "products" USING btree ("published_at");
  CREATE INDEX "_products_v_version_version_published_at_idx" ON "_products_v" USING btree ("version_published_at");
  CREATE INDEX "projects_published_at_idx" ON "projects" USING btree ("published_at");
  CREATE INDEX "_projects_v_version_version_published_at_idx" ON "_projects_v" USING btree ("version_published_at");
  CREATE INDEX "posts_published_at_idx" ON "posts" USING btree ("published_at");
  CREATE INDEX "_posts_v_version_version_published_at_idx" ON "_posts_v" USING btree ("version_published_at");

  -- Only repair publication dates. Preserve document/version creation and update times.
  UPDATE "products" AS root SET "published_at" = COALESCE(
    (SELECT MIN(COALESCE(v."version_updated_at", v."created_at")) FROM "_products_v" AS v
     WHERE v."parent_id" = root."id" AND v."version__status" = 'published'),
    root."created_at"
  ) WHERE root."published_at" IS NULL AND (
    root."has_been_published" = true OR root."_status" = 'published' OR EXISTS (
      SELECT 1 FROM "_products_v" AS v WHERE v."parent_id" = root."id" AND v."version__status" = 'published'
    )
  );

  UPDATE "projects" AS root SET "published_at" = COALESCE(
    (SELECT MIN(COALESCE(v."version_updated_at", v."created_at")) FROM "_projects_v" AS v
     WHERE v."parent_id" = root."id" AND v."version__status" = 'published'),
    root."created_at"
  ) WHERE root."published_at" IS NULL AND (
    root."has_been_published" = true OR root."_status" = 'published' OR EXISTS (
      SELECT 1 FROM "_projects_v" AS v WHERE v."parent_id" = root."id" AND v."version__status" = 'published'
    )
  );

  UPDATE "posts" AS root SET "published_at" = COALESCE(
    (SELECT MIN(COALESCE(v."version_updated_at", v."created_at")) FROM "_posts_v" AS v
     WHERE v."parent_id" = root."id" AND v."version__status" = 'published'),
    root."created_at"
  ) WHERE root."published_at" IS NULL AND (
    root."has_been_published" = true OR root."_status" = 'published' OR EXISTS (
      SELECT 1 FROM "_posts_v" AS v WHERE v."parent_id" = root."id" AND v."version__status" = 'published'
    )
  );

  -- Pre-publication drafts stay undated; later versions share the first date.
  UPDATE "_products_v" AS v SET "version_published_at" = root."published_at"
  FROM "products" AS root WHERE v."parent_id" = root."id" AND root."published_at" IS NOT NULL
    AND v."version_published_at" IS NULL AND (
      v."version__status" = 'published' OR COALESCE(v."version_updated_at", v."created_at") >= root."published_at"
    );
  UPDATE "_projects_v" AS v SET "version_published_at" = root."published_at"
  FROM "projects" AS root WHERE v."parent_id" = root."id" AND root."published_at" IS NOT NULL
    AND v."version_published_at" IS NULL AND (
      v."version__status" = 'published' OR COALESCE(v."version_updated_at", v."created_at") >= root."published_at"
    );
  UPDATE "_posts_v" AS v SET "version_published_at" = root."published_at"
  FROM "posts" AS root WHERE v."parent_id" = root."id" AND root."published_at" IS NOT NULL
    AND v."version_published_at" IS NULL AND (
      v."version__status" = 'published' OR COALESCE(v."version_updated_at", v."created_at") >= root."published_at"
    );
  `)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  // Posts already had publication dates before this migration. Keep that data.
  await db.execute(sql`
  DROP INDEX "products_published_at_idx";
  DROP INDEX "_products_v_version_version_published_at_idx";
  DROP INDEX "projects_published_at_idx";
  DROP INDEX "_projects_v_version_version_published_at_idx";
  DROP INDEX "posts_published_at_idx";
  DROP INDEX "_posts_v_version_version_published_at_idx";
  ALTER TABLE "products" DROP COLUMN "published_at";
  ALTER TABLE "_products_v" DROP COLUMN "version_published_at";
  ALTER TABLE "projects" DROP COLUMN "published_at";
  ALTER TABLE "_projects_v" DROP COLUMN "version_published_at";`)
}
