import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_pages_professional_section_role_cards_role_key" AS ENUM('architects', 'facade-contractors', 'main-contractors');
  CREATE TYPE "public"."enum__pages_v_version_professional_section_role_cards_role_key" AS ENUM('architects', 'facade-contractors', 'main-contractors');
  CREATE TABLE "pages_capabilities_items" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"image_id" integer
  );
  
  CREATE TABLE "pages_capabilities_items_locales" (
  	"title" varchar,
  	"description" varchar,
  	"badge" varchar,
  	"metrics" varchar,
  	"id" serial PRIMARY KEY NOT NULL,
  	"_locale" "_locales" NOT NULL,
  	"_parent_id" varchar NOT NULL
  );
  
  CREATE TABLE "pages_capabilities_workflow" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"step_number" numeric
  );
  
  CREATE TABLE "pages_capabilities_workflow_locales" (
  	"title" varchar,
  	"description" varchar,
  	"id" serial PRIMARY KEY NOT NULL,
  	"_locale" "_locales" NOT NULL,
  	"_parent_id" varchar NOT NULL
  );
  
  CREATE TABLE "pages_professional_section_role_cards" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"role_key" "enum_pages_professional_section_role_cards_role_key"
  );
  
  CREATE TABLE "pages_professional_section_role_cards_locales" (
  	"title" varchar,
  	"description" varchar,
  	"deliverables" varchar,
  	"id" serial PRIMARY KEY NOT NULL,
  	"_locale" "_locales" NOT NULL,
  	"_parent_id" varchar NOT NULL
  );
  
  CREATE TABLE "pages_professional_section_resource_matrix" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"file_id" integer
  );
  
  CREATE TABLE "pages_professional_section_resource_matrix_locales" (
  	"title" varchar,
  	"category" varchar,
  	"description" varchar,
  	"id" serial PRIMARY KEY NOT NULL,
  	"_locale" "_locales" NOT NULL,
  	"_parent_id" varchar NOT NULL
  );
  
  CREATE TABLE "pages_professional_section_faq" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL
  );
  
  CREATE TABLE "pages_professional_section_faq_locales" (
  	"question" varchar,
  	"answer" varchar,
  	"id" serial PRIMARY KEY NOT NULL,
  	"_locale" "_locales" NOT NULL,
  	"_parent_id" varchar NOT NULL
  );
  
  CREATE TABLE "_pages_v_version_capabilities_items" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" serial PRIMARY KEY NOT NULL,
  	"image_id" integer,
  	"_uuid" varchar
  );
  
  CREATE TABLE "_pages_v_version_capabilities_items_locales" (
  	"title" varchar,
  	"description" varchar,
  	"badge" varchar,
  	"metrics" varchar,
  	"id" serial PRIMARY KEY NOT NULL,
  	"_locale" "_locales" NOT NULL,
  	"_parent_id" integer NOT NULL
  );
  
  CREATE TABLE "_pages_v_version_capabilities_workflow" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" serial PRIMARY KEY NOT NULL,
  	"step_number" numeric,
  	"_uuid" varchar
  );
  
  CREATE TABLE "_pages_v_version_capabilities_workflow_locales" (
  	"title" varchar,
  	"description" varchar,
  	"id" serial PRIMARY KEY NOT NULL,
  	"_locale" "_locales" NOT NULL,
  	"_parent_id" integer NOT NULL
  );
  
  CREATE TABLE "_pages_v_version_professional_section_role_cards" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" serial PRIMARY KEY NOT NULL,
  	"role_key" "enum__pages_v_version_professional_section_role_cards_role_key",
  	"_uuid" varchar
  );
  
  CREATE TABLE "_pages_v_version_professional_section_role_cards_locales" (
  	"title" varchar,
  	"description" varchar,
  	"deliverables" varchar,
  	"id" serial PRIMARY KEY NOT NULL,
  	"_locale" "_locales" NOT NULL,
  	"_parent_id" integer NOT NULL
  );
  
  CREATE TABLE "_pages_v_version_professional_section_resource_matrix" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" serial PRIMARY KEY NOT NULL,
  	"file_id" integer,
  	"_uuid" varchar
  );
  
  CREATE TABLE "_pages_v_version_professional_section_resource_matrix_locales" (
  	"title" varchar,
  	"category" varchar,
  	"description" varchar,
  	"id" serial PRIMARY KEY NOT NULL,
  	"_locale" "_locales" NOT NULL,
  	"_parent_id" integer NOT NULL
  );
  
  CREATE TABLE "_pages_v_version_professional_section_faq" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" serial PRIMARY KEY NOT NULL,
  	"_uuid" varchar
  );
  
  CREATE TABLE "_pages_v_version_professional_section_faq_locales" (
  	"question" varchar,
  	"answer" varchar,
  	"id" serial PRIMARY KEY NOT NULL,
  	"_locale" "_locales" NOT NULL,
  	"_parent_id" integer NOT NULL
  );
  
  CREATE TABLE "products_engineering_workflow" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"step_number" numeric
  );
  
  CREATE TABLE "products_engineering_workflow_locales" (
  	"title" varchar,
  	"description" varchar,
  	"id" serial PRIMARY KEY NOT NULL,
  	"_locale" "_locales" NOT NULL,
  	"_parent_id" varchar NOT NULL
  );
  
  CREATE TABLE "_products_v_version_engineering_workflow" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" serial PRIMARY KEY NOT NULL,
  	"step_number" numeric,
  	"_uuid" varchar
  );
  
  CREATE TABLE "_products_v_version_engineering_workflow_locales" (
  	"title" varchar,
  	"description" varchar,
  	"id" serial PRIMARY KEY NOT NULL,
  	"_locale" "_locales" NOT NULL,
  	"_parent_id" integer NOT NULL
  );
  
  ALTER TABLE "products_locales" ADD COLUMN "disclaimer" varchar;
  ALTER TABLE "_products_v_locales" ADD COLUMN "version_disclaimer" varchar;
  ALTER TABLE "projects_locales" ADD COLUMN "project_snapshot" varchar;
  ALTER TABLE "projects_locales" ADD COLUMN "observed_focus" varchar;
  ALTER TABLE "projects_locales" ADD COLUMN "solution_framework" varchar;
  ALTER TABLE "projects_locales" ADD COLUMN "quality_verification" varchar;
  ALTER TABLE "_projects_v_locales" ADD COLUMN "version_project_snapshot" varchar;
  ALTER TABLE "_projects_v_locales" ADD COLUMN "version_observed_focus" varchar;
  ALTER TABLE "_projects_v_locales" ADD COLUMN "version_solution_framework" varchar;
  ALTER TABLE "_projects_v_locales" ADD COLUMN "version_quality_verification" varchar;
  ALTER TABLE "pages_capabilities_items" ADD CONSTRAINT "pages_capabilities_items_image_id_media_id_fk" FOREIGN KEY ("image_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "pages_capabilities_items" ADD CONSTRAINT "pages_capabilities_items_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "pages_capabilities_items_locales" ADD CONSTRAINT "pages_capabilities_items_locales_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."pages_capabilities_items"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "pages_capabilities_workflow" ADD CONSTRAINT "pages_capabilities_workflow_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "pages_capabilities_workflow_locales" ADD CONSTRAINT "pages_capabilities_workflow_locales_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."pages_capabilities_workflow"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "pages_professional_section_role_cards" ADD CONSTRAINT "pages_professional_section_role_cards_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "pages_professional_section_role_cards_locales" ADD CONSTRAINT "pages_professional_section_role_cards_locales_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."pages_professional_section_role_cards"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "pages_professional_section_resource_matrix" ADD CONSTRAINT "pages_professional_section_resource_matrix_file_id_media_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "pages_professional_section_resource_matrix" ADD CONSTRAINT "pages_professional_section_resource_matrix_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "pages_professional_section_resource_matrix_locales" ADD CONSTRAINT "pages_professional_section_resource_matrix_locales_parent_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."pages_professional_section_resource_matrix"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "pages_professional_section_faq" ADD CONSTRAINT "pages_professional_section_faq_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "pages_professional_section_faq_locales" ADD CONSTRAINT "pages_professional_section_faq_locales_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."pages_professional_section_faq"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_pages_v_version_capabilities_items" ADD CONSTRAINT "_pages_v_version_capabilities_items_image_id_media_id_fk" FOREIGN KEY ("image_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_pages_v_version_capabilities_items" ADD CONSTRAINT "_pages_v_version_capabilities_items_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."_pages_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_pages_v_version_capabilities_items_locales" ADD CONSTRAINT "_pages_v_version_capabilities_items_locales_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."_pages_v_version_capabilities_items"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_pages_v_version_capabilities_workflow" ADD CONSTRAINT "_pages_v_version_capabilities_workflow_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."_pages_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_pages_v_version_capabilities_workflow_locales" ADD CONSTRAINT "_pages_v_version_capabilities_workflow_locales_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."_pages_v_version_capabilities_workflow"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_pages_v_version_professional_section_role_cards" ADD CONSTRAINT "_pages_v_version_professional_section_role_cards_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."_pages_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_pages_v_version_professional_section_role_cards_locales" ADD CONSTRAINT "_pages_v_version_professional_section_role_cards_locales__fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."_pages_v_version_professional_section_role_cards"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_pages_v_version_professional_section_resource_matrix" ADD CONSTRAINT "_pages_v_version_professional_section_resource_matrix_file_id_media_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_pages_v_version_professional_section_resource_matrix" ADD CONSTRAINT "_pages_v_version_professional_section_resource_matrix_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."_pages_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_pages_v_version_professional_section_resource_matrix_locales" ADD CONSTRAINT "_pages_v_version_professional_section_resource_matrix_loc_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."_pages_v_version_professional_section_resource_matrix"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_pages_v_version_professional_section_faq" ADD CONSTRAINT "_pages_v_version_professional_section_faq_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."_pages_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_pages_v_version_professional_section_faq_locales" ADD CONSTRAINT "_pages_v_version_professional_section_faq_locales_parent__fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."_pages_v_version_professional_section_faq"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "products_engineering_workflow" ADD CONSTRAINT "products_engineering_workflow_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "products_engineering_workflow_locales" ADD CONSTRAINT "products_engineering_workflow_locales_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."products_engineering_workflow"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_products_v_version_engineering_workflow" ADD CONSTRAINT "_products_v_version_engineering_workflow_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."_products_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_products_v_version_engineering_workflow_locales" ADD CONSTRAINT "_products_v_version_engineering_workflow_locales_parent_i_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."_products_v_version_engineering_workflow"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "pages_capabilities_items_order_idx" ON "pages_capabilities_items" USING btree ("_order");
  CREATE INDEX "pages_capabilities_items_parent_id_idx" ON "pages_capabilities_items" USING btree ("_parent_id");
  CREATE INDEX "pages_capabilities_items_image_idx" ON "pages_capabilities_items" USING btree ("image_id");
  CREATE UNIQUE INDEX "pages_capabilities_items_locales_locale_parent_id_unique" ON "pages_capabilities_items_locales" USING btree ("_locale","_parent_id");
  CREATE INDEX "pages_capabilities_workflow_order_idx" ON "pages_capabilities_workflow" USING btree ("_order");
  CREATE INDEX "pages_capabilities_workflow_parent_id_idx" ON "pages_capabilities_workflow" USING btree ("_parent_id");
  CREATE UNIQUE INDEX "pages_capabilities_workflow_locales_locale_parent_id_unique" ON "pages_capabilities_workflow_locales" USING btree ("_locale","_parent_id");
  CREATE INDEX "pages_professional_section_role_cards_order_idx" ON "pages_professional_section_role_cards" USING btree ("_order");
  CREATE INDEX "pages_professional_section_role_cards_parent_id_idx" ON "pages_professional_section_role_cards" USING btree ("_parent_id");
  CREATE UNIQUE INDEX "pages_professional_section_role_cards_locales_locale_parent_" ON "pages_professional_section_role_cards_locales" USING btree ("_locale","_parent_id");
  CREATE INDEX "pages_professional_section_resource_matrix_order_idx" ON "pages_professional_section_resource_matrix" USING btree ("_order");
  CREATE INDEX "pages_professional_section_resource_matrix_parent_id_idx" ON "pages_professional_section_resource_matrix" USING btree ("_parent_id");
  CREATE INDEX "pages_professional_section_resource_matrix_file_idx" ON "pages_professional_section_resource_matrix" USING btree ("file_id");
  CREATE UNIQUE INDEX "pages_professional_section_resource_matrix_locales_locale_pa" ON "pages_professional_section_resource_matrix_locales" USING btree ("_locale","_parent_id");
  CREATE INDEX "pages_professional_section_faq_order_idx" ON "pages_professional_section_faq" USING btree ("_order");
  CREATE INDEX "pages_professional_section_faq_parent_id_idx" ON "pages_professional_section_faq" USING btree ("_parent_id");
  CREATE UNIQUE INDEX "pages_professional_section_faq_locales_locale_parent_id_uniq" ON "pages_professional_section_faq_locales" USING btree ("_locale","_parent_id");
  CREATE INDEX "_pages_v_version_capabilities_items_order_idx" ON "_pages_v_version_capabilities_items" USING btree ("_order");
  CREATE INDEX "_pages_v_version_capabilities_items_parent_id_idx" ON "_pages_v_version_capabilities_items" USING btree ("_parent_id");
  CREATE INDEX "_pages_v_version_capabilities_items_image_idx" ON "_pages_v_version_capabilities_items" USING btree ("image_id");
  CREATE UNIQUE INDEX "_pages_v_version_capabilities_items_locales_locale_parent_id" ON "_pages_v_version_capabilities_items_locales" USING btree ("_locale","_parent_id");
  CREATE INDEX "_pages_v_version_capabilities_workflow_order_idx" ON "_pages_v_version_capabilities_workflow" USING btree ("_order");
  CREATE INDEX "_pages_v_version_capabilities_workflow_parent_id_idx" ON "_pages_v_version_capabilities_workflow" USING btree ("_parent_id");
  CREATE UNIQUE INDEX "_pages_v_version_capabilities_workflow_locales_locale_parent" ON "_pages_v_version_capabilities_workflow_locales" USING btree ("_locale","_parent_id");
  CREATE INDEX "_pages_v_version_professional_section_role_cards_order_idx" ON "_pages_v_version_professional_section_role_cards" USING btree ("_order");
  CREATE INDEX "_pages_v_version_professional_section_role_cards_parent_id_idx" ON "_pages_v_version_professional_section_role_cards" USING btree ("_parent_id");
  CREATE UNIQUE INDEX "_pages_v_version_professional_section_role_cards_locales_loc" ON "_pages_v_version_professional_section_role_cards_locales" USING btree ("_locale","_parent_id");
  CREATE INDEX "_pages_v_version_professional_section_resource_matrix_order_idx" ON "_pages_v_version_professional_section_resource_matrix" USING btree ("_order");
  CREATE INDEX "_pages_v_version_professional_section_resource_matrix_parent_id_idx" ON "_pages_v_version_professional_section_resource_matrix" USING btree ("_parent_id");
  CREATE INDEX "_pages_v_version_professional_section_resource_matrix_fi_idx" ON "_pages_v_version_professional_section_resource_matrix" USING btree ("file_id");
  CREATE UNIQUE INDEX "_pages_v_version_professional_section_resource_matrix_locale" ON "_pages_v_version_professional_section_resource_matrix_locales" USING btree ("_locale","_parent_id");
  CREATE INDEX "_pages_v_version_professional_section_faq_order_idx" ON "_pages_v_version_professional_section_faq" USING btree ("_order");
  CREATE INDEX "_pages_v_version_professional_section_faq_parent_id_idx" ON "_pages_v_version_professional_section_faq" USING btree ("_parent_id");
  CREATE UNIQUE INDEX "_pages_v_version_professional_section_faq_locales_locale_par" ON "_pages_v_version_professional_section_faq_locales" USING btree ("_locale","_parent_id");
  CREATE INDEX "products_engineering_workflow_order_idx" ON "products_engineering_workflow" USING btree ("_order");
  CREATE INDEX "products_engineering_workflow_parent_id_idx" ON "products_engineering_workflow" USING btree ("_parent_id");
  CREATE UNIQUE INDEX "products_engineering_workflow_locales_locale_parent_id_uniqu" ON "products_engineering_workflow_locales" USING btree ("_locale","_parent_id");
  CREATE INDEX "_products_v_version_engineering_workflow_order_idx" ON "_products_v_version_engineering_workflow" USING btree ("_order");
  CREATE INDEX "_products_v_version_engineering_workflow_parent_id_idx" ON "_products_v_version_engineering_workflow" USING btree ("_parent_id");
  CREATE UNIQUE INDEX "_products_v_version_engineering_workflow_locales_locale_pare" ON "_products_v_version_engineering_workflow_locales" USING btree ("_locale","_parent_id");
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_lead_attachments_fk" FOREIGN KEY ("lead_attachments_id") REFERENCES "public"."lead_attachments"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_lead_attachments_id_idx" ON "payload_locked_documents_rels" USING btree ("lead_attachments_id");
  CREATE UNIQUE INDEX "lead_attachments_filename_idx" ON "lead_attachments" USING btree ("filename");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "pages_capabilities_items" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "pages_capabilities_items_locales" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "pages_capabilities_workflow" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "pages_capabilities_workflow_locales" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "pages_professional_section_role_cards" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "pages_professional_section_role_cards_locales" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "pages_professional_section_resource_matrix" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "pages_professional_section_resource_matrix_locales" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "pages_professional_section_faq" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "pages_professional_section_faq_locales" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "_pages_v_version_capabilities_items" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "_pages_v_version_capabilities_items_locales" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "_pages_v_version_capabilities_workflow" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "_pages_v_version_capabilities_workflow_locales" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "_pages_v_version_professional_section_role_cards" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "_pages_v_version_professional_section_role_cards_locales" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "_pages_v_version_professional_section_resource_matrix" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "_pages_v_version_professional_section_resource_matrix_locales" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "_pages_v_version_professional_section_faq" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "_pages_v_version_professional_section_faq_locales" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "products_engineering_workflow" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "products_engineering_workflow_locales" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "_products_v_version_engineering_workflow" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "_products_v_version_engineering_workflow_locales" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "pages_capabilities_items" CASCADE;
  DROP TABLE "pages_capabilities_items_locales" CASCADE;
  DROP TABLE "pages_capabilities_workflow" CASCADE;
  DROP TABLE "pages_capabilities_workflow_locales" CASCADE;
  DROP TABLE "pages_professional_section_role_cards" CASCADE;
  DROP TABLE "pages_professional_section_role_cards_locales" CASCADE;
  DROP TABLE "pages_professional_section_resource_matrix" CASCADE;
  DROP TABLE "pages_professional_section_resource_matrix_locales" CASCADE;
  DROP TABLE "pages_professional_section_faq" CASCADE;
  DROP TABLE "pages_professional_section_faq_locales" CASCADE;
  DROP TABLE "_pages_v_version_capabilities_items" CASCADE;
  DROP TABLE "_pages_v_version_capabilities_items_locales" CASCADE;
  DROP TABLE "_pages_v_version_capabilities_workflow" CASCADE;
  DROP TABLE "_pages_v_version_capabilities_workflow_locales" CASCADE;
  DROP TABLE "_pages_v_version_professional_section_role_cards" CASCADE;
  DROP TABLE "_pages_v_version_professional_section_role_cards_locales" CASCADE;
  DROP TABLE "_pages_v_version_professional_section_resource_matrix" CASCADE;
  DROP TABLE "_pages_v_version_professional_section_resource_matrix_locales" CASCADE;
  DROP TABLE "_pages_v_version_professional_section_faq" CASCADE;
  DROP TABLE "_pages_v_version_professional_section_faq_locales" CASCADE;
  DROP TABLE "products_engineering_workflow" CASCADE;
  DROP TABLE "products_engineering_workflow_locales" CASCADE;
  DROP TABLE "_products_v_version_engineering_workflow" CASCADE;
  DROP TABLE "_products_v_version_engineering_workflow_locales" CASCADE;
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_lead_attachments_fk";
  
  DROP INDEX "lead_attachments_filename_idx";
  DROP INDEX "payload_locked_documents_rels_lead_attachments_id_idx";
  ALTER TABLE "products_locales" DROP COLUMN "disclaimer";
  ALTER TABLE "_products_v_locales" DROP COLUMN "version_disclaimer";
  ALTER TABLE "projects_locales" DROP COLUMN "project_snapshot";
  ALTER TABLE "projects_locales" DROP COLUMN "observed_focus";
  ALTER TABLE "projects_locales" DROP COLUMN "solution_framework";
  ALTER TABLE "projects_locales" DROP COLUMN "quality_verification";
  ALTER TABLE "_projects_v_locales" DROP COLUMN "version_project_snapshot";
  ALTER TABLE "_projects_v_locales" DROP COLUMN "version_observed_focus";
  ALTER TABLE "_projects_v_locales" DROP COLUMN "version_solution_framework";
  ALTER TABLE "_projects_v_locales" DROP COLUMN "version_quality_verification";
  DROP TYPE "public"."enum_pages_professional_section_role_cards_role_key";
  DROP TYPE "public"."enum__pages_v_version_professional_section_role_cards_role_key";`)
}
