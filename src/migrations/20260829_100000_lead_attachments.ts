import { MigrateDownArgs, MigrateUpArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    ALTER TYPE "public"."enum_feishu_mappings_field_mappings_local_field" ADD VALUE 'attachments';
    CREATE TYPE "public"."enum_lead_attachments_status" AS ENUM('pending', 'associated', 'missing', 'expired');
    CREATE TABLE "lead_attachments" (
      "id" serial PRIMARY KEY NOT NULL,
      "lead_id" integer,
      "ticket_hash" varchar NOT NULL,
      "status" "enum_lead_attachments_status" DEFAULT 'pending' NOT NULL,
      "byte_size" numeric NOT NULL,
      "mime_type" varchar NOT NULL,
      "expires_at" timestamp(3) with time zone NOT NULL,
      "associated_at" timestamp(3) with time zone,
      "url" varchar,
      "thumbnail_u_r_l" varchar,
      "filename" varchar,
      "filesize" numeric,
      "width" numeric,
      "height" numeric,
      "focal_x" numeric,
      "focal_y" numeric,
      "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
      "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
    );
    ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "lead_attachments_id" integer;
    ALTER TABLE "lead_attachments" ADD CONSTRAINT "lead_attachments_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE set null ON UPDATE no action;
    ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_lead_attachments_fk" FOREIGN KEY ("lead_attachments_id") REFERENCES "public"."lead_attachments"("id") ON DELETE cascade ON UPDATE no action;
    CREATE INDEX "lead_attachments_lead_idx" ON "lead_attachments" USING btree ("lead_id");
    CREATE INDEX "lead_attachments_ticket_hash_idx" ON "lead_attachments" USING btree ("ticket_hash");
    CREATE INDEX "lead_attachments_status_idx" ON "lead_attachments" USING btree ("status");
    CREATE INDEX "lead_attachments_expires_at_idx" ON "lead_attachments" USING btree ("expires_at");
    CREATE INDEX "lead_attachments_associated_at_idx" ON "lead_attachments" USING btree ("associated_at");
    CREATE INDEX "lead_attachments_updated_at_idx" ON "lead_attachments" USING btree ("updated_at");
    CREATE INDEX "lead_attachments_created_at_idx" ON "lead_attachments" USING btree ("created_at");
    CREATE INDEX "payload_locked_documents_rels_lead_attachments_id_idx" ON "payload_locked_documents_rels" USING btree ("lead_attachments_id");
  `)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_lead_attachments_fk";
    ALTER TABLE "lead_attachments" DROP CONSTRAINT "lead_attachments_lead_id_leads_id_fk";
    DROP INDEX "payload_locked_documents_rels_lead_attachments_id_idx";
    DROP TABLE "lead_attachments";
    ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "lead_attachments_id";
    DROP TYPE "public"."enum_lead_attachments_status";
    ALTER TABLE "feishu_mappings_field_mappings" ALTER COLUMN "local_field" SET DATA TYPE text;
    DELETE FROM "feishu_mappings_field_mappings" WHERE "local_field" = 'attachments';
    DROP TYPE "public"."enum_feishu_mappings_field_mappings_local_field";
    CREATE TYPE "public"."enum_feishu_mappings_field_mappings_local_field" AS ENUM('localLeadId', 'customerName', 'country', 'source', 'productNeed', 'projectStage', 'intentLevel', 'owner', 'email', 'phone', 'nextFollowUpAt', 'sourceURL', 'originalInquiry');
    ALTER TABLE "feishu_mappings_field_mappings" ALTER COLUMN "local_field" SET DATA TYPE "public"."enum_feishu_mappings_field_mappings_local_field" USING "local_field"::"public"."enum_feishu_mappings_field_mappings_local_field";
  `)
}
