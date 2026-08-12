import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_conversations_qualification_asked_fields" AS ENUM('country', 'company', 'projectStage', 'quantity', 'drawings', 'budget', 'timeline', 'contact');
  CREATE TABLE "conversations_qualification_asked_fields" (
    "order" integer NOT NULL,
    "parent_id" integer NOT NULL,
    "value" "enum_conversations_qualification_asked_fields",
    "id" serial PRIMARY KEY NOT NULL
  );

  ALTER TABLE "leads" ADD COLUMN "budget" varchar;
  ALTER TABLE "leads" ADD COLUMN "procurement_plan" varchar;
  ALTER TABLE "leads" ADD COLUMN "project_stage" varchar;
  ALTER TABLE "leads" ADD COLUMN "quantity_square_meters" numeric;
  ALTER TABLE "leads" ADD COLUMN "timeline" varchar;
  ALTER TABLE "leads" ADD COLUMN "has_drawings" boolean;
  ALTER TABLE "conversations" ADD COLUMN "qualification_signals_budget" varchar;
  ALTER TABLE "conversations" ADD COLUMN "qualification_signals_procurement_plan" varchar;
  ALTER TABLE "conversations" ADD COLUMN "qualification_signals_project_stage" varchar;
  ALTER TABLE "conversations" ADD COLUMN "qualification_signals_quantity_square_meters" numeric;
  ALTER TABLE "conversations" ADD COLUMN "qualification_signals_timeline" varchar;
  ALTER TABLE "conversations" ADD COLUMN "qualification_signals_has_drawings" boolean;
  ALTER TABLE "conversations" ADD COLUMN "qualification_round_count" numeric DEFAULT 0;
  ALTER TABLE "conversations_qualification_asked_fields" ADD CONSTRAINT "conversations_qualification_asked_fields_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "conversations_qualification_asked_fields_order_idx" ON "conversations_qualification_asked_fields" USING btree ("order");
  CREATE INDEX "conversations_qualification_asked_fields_parent_idx" ON "conversations_qualification_asked_fields" USING btree ("parent_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "conversations_qualification_asked_fields" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "conversations_qualification_asked_fields" CASCADE;
  ALTER TABLE "leads" DROP COLUMN "budget";
  ALTER TABLE "leads" DROP COLUMN "procurement_plan";
  ALTER TABLE "leads" DROP COLUMN "project_stage";
  ALTER TABLE "leads" DROP COLUMN "quantity_square_meters";
  ALTER TABLE "leads" DROP COLUMN "timeline";
  ALTER TABLE "leads" DROP COLUMN "has_drawings";
  ALTER TABLE "conversations" DROP COLUMN "qualification_signals_budget";
  ALTER TABLE "conversations" DROP COLUMN "qualification_signals_procurement_plan";
  ALTER TABLE "conversations" DROP COLUMN "qualification_signals_project_stage";
  ALTER TABLE "conversations" DROP COLUMN "qualification_signals_quantity_square_meters";
  ALTER TABLE "conversations" DROP COLUMN "qualification_signals_timeline";
  ALTER TABLE "conversations" DROP COLUMN "qualification_signals_has_drawings";
  ALTER TABLE "conversations" DROP COLUMN "qualification_round_count";
  DROP TYPE "public"."enum_conversations_qualification_asked_fields";`)
}
