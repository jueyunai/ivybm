import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "product_categories" ADD COLUMN "seo_og_image_id" integer;
  ALTER TABLE "product_categories" ADD COLUMN "seo_no_index" boolean DEFAULT false;
  ALTER TABLE "product_categories_locales" ADD COLUMN "seo_title" varchar;
  ALTER TABLE "product_categories_locales" ADD COLUMN "seo_description" varchar;
  ALTER TABLE "product_categories_locales" ADD COLUMN "seo_keywords" varchar;
  ALTER TABLE "product_categories_locales" ADD COLUMN "seo_canonical" varchar;
  ALTER TABLE "downloads" ADD COLUMN "seo_og_image_id" integer;
  ALTER TABLE "downloads" ADD COLUMN "seo_no_index" boolean DEFAULT false;
  ALTER TABLE "downloads_locales" ADD COLUMN "seo_title" varchar;
  ALTER TABLE "downloads_locales" ADD COLUMN "seo_description" varchar;
  ALTER TABLE "downloads_locales" ADD COLUMN "seo_keywords" varchar;
  ALTER TABLE "downloads_locales" ADD COLUMN "seo_canonical" varchar;
  ALTER TABLE "product_categories" ADD CONSTRAINT "product_categories_seo_og_image_id_media_id_fk" FOREIGN KEY ("seo_og_image_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "downloads" ADD CONSTRAINT "downloads_seo_og_image_id_media_id_fk" FOREIGN KEY ("seo_og_image_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "product_categories_seo_seo_og_image_idx" ON "product_categories" USING btree ("seo_og_image_id");
  CREATE INDEX "downloads_seo_seo_og_image_idx" ON "downloads" USING btree ("seo_og_image_id");`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "product_categories" DROP CONSTRAINT "product_categories_seo_og_image_id_media_id_fk";

  ALTER TABLE "downloads" DROP CONSTRAINT "downloads_seo_og_image_id_media_id_fk";

  DROP INDEX "product_categories_seo_seo_og_image_idx";
  DROP INDEX "downloads_seo_seo_og_image_idx";
  ALTER TABLE "product_categories" DROP COLUMN "seo_og_image_id";
  ALTER TABLE "product_categories" DROP COLUMN "seo_no_index";
  ALTER TABLE "product_categories_locales" DROP COLUMN "seo_title";
  ALTER TABLE "product_categories_locales" DROP COLUMN "seo_description";
  ALTER TABLE "product_categories_locales" DROP COLUMN "seo_keywords";
  ALTER TABLE "product_categories_locales" DROP COLUMN "seo_canonical";
  ALTER TABLE "downloads" DROP COLUMN "seo_og_image_id";
  ALTER TABLE "downloads" DROP COLUMN "seo_no_index";
  ALTER TABLE "downloads_locales" DROP COLUMN "seo_title";
  ALTER TABLE "downloads_locales" DROP COLUMN "seo_description";
  ALTER TABLE "downloads_locales" DROP COLUMN "seo_keywords";
  ALTER TABLE "downloads_locales" DROP COLUMN "seo_canonical";`)
}
