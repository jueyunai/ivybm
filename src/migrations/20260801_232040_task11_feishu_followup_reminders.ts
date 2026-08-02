import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload: _payload, req: _req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TYPE "public"."enum_feishu_mappings_field_mappings_local_field" ADD VALUE 'nextFollowUpAt' BEFORE 'sourceURL';
  ALTER TABLE "leads" ADD COLUMN "next_follow_up_at" timestamp(3) with time zone;
  CREATE INDEX "leads_next_follow_up_at_idx" ON "leads" USING btree ("next_follow_up_at");`)
}

export async function down({ db, payload: _payload, req: _req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "feishu_mappings_field_mappings" ALTER COLUMN "local_field" SET DATA TYPE text;
  DELETE FROM "feishu_mappings_field_mappings" WHERE "local_field" = 'nextFollowUpAt';
  DROP TYPE "public"."enum_feishu_mappings_field_mappings_local_field";
  CREATE TYPE "public"."enum_feishu_mappings_field_mappings_local_field" AS ENUM('localLeadId', 'customerName', 'country', 'source', 'productNeed', 'projectStage', 'intentLevel', 'owner', 'email', 'phone', 'sourceURL', 'originalInquiry');
  ALTER TABLE "feishu_mappings_field_mappings" ALTER COLUMN "local_field" SET DATA TYPE "public"."enum_feishu_mappings_field_mappings_local_field" USING "local_field"::"public"."enum_feishu_mappings_field_mappings_local_field";
  DROP INDEX "leads_next_follow_up_at_idx";
  ALTER TABLE "leads" DROP COLUMN "next_follow_up_at";`)
}
