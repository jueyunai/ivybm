import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload: _payload, req: _req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_lead_sources_channel" AS ENUM('website', 'ai-chat', 'social', 'manual');
  CREATE TYPE "public"."enum_leads_locale" AS ENUM('en', 'ar');
  CREATE TYPE "public"."enum_leads_status" AS ENUM('new', 'contacted', 'qualified', 'disqualified');
  CREATE TYPE "public"."enum_leads_intent_level" AS ENUM('unscored', 'a', 'b', 'c');
  CREATE TABLE "lead_sources" (
    "id" serial PRIMARY KEY NOT NULL,
    "name" varchar NOT NULL,
    "key" varchar NOT NULL,
    "channel" "enum_lead_sources_channel" DEFAULT 'website' NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "description" varchar,
    "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
    "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );

  CREATE TABLE "leads" (
    "id" serial PRIMARY KEY NOT NULL,
    "request_id" varchar NOT NULL,
    "idempotency_key" varchar NOT NULL,
    "source_id" integer NOT NULL,
    "locale" "enum_leads_locale" NOT NULL,
    "status" "enum_leads_status" DEFAULT 'new' NOT NULL,
    "intent_level" "enum_leads_intent_level" DEFAULT 'unscored' NOT NULL,
    "assigned_to_id" integer,
    "name" varchar NOT NULL,
    "company" varchar,
    "country" varchar NOT NULL,
    "email" varchar NOT NULL,
    "phone" varchar,
    "interest" varchar,
    "message" varchar NOT NULL,
    "source_u_r_l" varchar,
    "utm_source" varchar,
    "utm_medium" varchar,
    "utm_campaign" varchar,
    "utm_term" varchar,
    "utm_content" varchar,
    "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
    "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );

  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "lead_sources_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "leads_id" integer;
  ALTER TABLE "leads" ADD CONSTRAINT "leads_source_id_lead_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."lead_sources"("id") ON DELETE restrict ON UPDATE no action;
  ALTER TABLE "leads" ADD CONSTRAINT "leads_assigned_to_id_users_id_fk" FOREIGN KEY ("assigned_to_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  CREATE UNIQUE INDEX "lead_sources_key_idx" ON "lead_sources" USING btree ("key");
  CREATE INDEX "lead_sources_is_active_idx" ON "lead_sources" USING btree ("is_active");
  CREATE INDEX "lead_sources_updated_at_idx" ON "lead_sources" USING btree ("updated_at");
  CREATE INDEX "lead_sources_created_at_idx" ON "lead_sources" USING btree ("created_at");
  CREATE UNIQUE INDEX "leads_request_id_idx" ON "leads" USING btree ("request_id");
  CREATE UNIQUE INDEX "leads_idempotency_key_idx" ON "leads" USING btree ("idempotency_key");
  CREATE INDEX "leads_source_idx" ON "leads" USING btree ("source_id");
  CREATE INDEX "leads_status_idx" ON "leads" USING btree ("status");
  CREATE INDEX "leads_intent_level_idx" ON "leads" USING btree ("intent_level");
  CREATE INDEX "leads_assigned_to_idx" ON "leads" USING btree ("assigned_to_id");
  CREATE INDEX "leads_name_idx" ON "leads" USING btree ("name");
  CREATE INDEX "leads_country_idx" ON "leads" USING btree ("country");
  CREATE INDEX "leads_email_idx" ON "leads" USING btree ("email");
  CREATE INDEX "leads_updated_at_idx" ON "leads" USING btree ("updated_at");
  CREATE INDEX "leads_created_at_idx" ON "leads" USING btree ("created_at");
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_lead_sources_fk" FOREIGN KEY ("lead_sources_id") REFERENCES "public"."lead_sources"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_leads_fk" FOREIGN KEY ("leads_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_lead_sources_id_idx" ON "payload_locked_documents_rels" USING btree ("lead_sources_id");
  CREATE INDEX "payload_locked_documents_rels_leads_id_idx" ON "payload_locked_documents_rels" USING btree ("leads_id");`)
}

export async function down({ db, payload: _payload, req: _req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_lead_sources_fk";
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_leads_fk";
  DROP INDEX "payload_locked_documents_rels_lead_sources_id_idx";
  DROP INDEX "payload_locked_documents_rels_leads_id_idx";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "lead_sources_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "leads_id";
  ALTER TABLE "leads" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "lead_sources" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "leads" CASCADE;
  DROP TABLE "lead_sources" CASCADE;
  DROP TYPE "public"."enum_lead_sources_channel";
  DROP TYPE "public"."enum_leads_locale";
  DROP TYPE "public"."enum_leads_status";
  DROP TYPE "public"."enum_leads_intent_level";`)
}
