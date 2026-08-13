import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_conversations_qualification_awaiting_fields" AS ENUM('country', 'company', 'projectStage', 'quantity', 'drawings', 'budget', 'timeline', 'contact');
  CREATE TABLE "conversations_qualification_awaiting_fields" (
    "order" integer NOT NULL,
    "parent_id" integer NOT NULL,
    "value" "enum_conversations_qualification_awaiting_fields",
    "id" serial PRIMARY KEY NOT NULL
  );

  ALTER TABLE "conversations" ADD COLUMN "qualification_answered_company" varchar;
  ALTER TABLE "conversations_qualification_awaiting_fields" ADD CONSTRAINT "conversations_qualification_awaiting_fields_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "conversations_qualification_awaiting_fields_order_idx" ON "conversations_qualification_awaiting_fields" USING btree ("order");
  CREATE INDEX "conversations_qualification_awaiting_fields_parent_idx" ON "conversations_qualification_awaiting_fields" USING btree ("parent_id");`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "conversations_qualification_awaiting_fields" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "conversations_qualification_awaiting_fields" CASCADE;
  ALTER TABLE "conversations" DROP COLUMN "qualification_answered_company";
  DROP TYPE "public"."enum_conversations_qualification_awaiting_fields";`)
}
