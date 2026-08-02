import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload: _payload, req: _req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_feishu_connections_auth_mode" AS ENUM('store_oauth');
  CREATE TYPE "public"."enum_feishu_connections_status" AS ENUM('provisioning', 'connected', 'reconnect_required', 'disconnected', 'error');
  CREATE TYPE "public"."enum_feishu_mappings_field_mappings_local_field" AS ENUM('localLeadId', 'customerName', 'country', 'source', 'productNeed', 'projectStage', 'intentLevel', 'owner', 'email', 'phone', 'sourceURL', 'originalInquiry');
  CREATE TYPE "public"."enum_feishu_mappings_notification_recipients_receive_id_type" AS ENUM('open_id', 'chat_id');
  CREATE TYPE "public"."enum_feishu_mappings_status" AS ENUM('draft', 'active', 'disabled');
  CREATE TABLE "feishu_connections_scopes" (
   "_order" integer NOT NULL,
   "_parent_id" integer NOT NULL,
   "id" varchar PRIMARY KEY NOT NULL,
   "scope" varchar NOT NULL
  );

  CREATE TABLE "feishu_connections" (
   "id" serial PRIMARY KEY NOT NULL,
   "name" varchar NOT NULL,
   "auth_mode" "enum_feishu_connections_auth_mode" DEFAULT 'store_oauth' NOT NULL,
   "tenant_key" varchar NOT NULL,
   "installer_open_id" varchar NOT NULL,
   "status" "enum_feishu_connections_status" DEFAULT 'provisioning' NOT NULL,
   "access_token_encrypted" varchar,
   "refresh_token_encrypted" varchar,
   "access_token_expires_at" timestamp(3) with time zone,
   "refresh_token_expires_at" timestamp(3) with time zone,
   "app_token" varchar,
   "table_id" varchar,
   "base_u_r_l" varchar,
   "last_connected_at" timestamp(3) with time zone,
   "last_refreshed_at" timestamp(3) with time zone,
   "last_error_code" varchar,
   "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
   "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );

  CREATE TABLE "feishu_mappings_field_mappings" (
   "_order" integer NOT NULL,
   "_parent_id" integer NOT NULL,
   "id" varchar PRIMARY KEY NOT NULL,
   "local_field" "enum_feishu_mappings_field_mappings_local_field" NOT NULL,
   "target_field" varchar NOT NULL,
   "required" boolean DEFAULT false
  );

  CREATE TABLE "feishu_mappings_member_mappings" (
   "_order" integer NOT NULL,
   "_parent_id" integer NOT NULL,
   "id" varchar PRIMARY KEY NOT NULL,
   "user_id" integer NOT NULL,
   "open_id" varchar NOT NULL,
   "enabled" boolean DEFAULT true
  );

  CREATE TABLE "feishu_mappings_notification_recipients" (
   "_order" integer NOT NULL,
   "_parent_id" integer NOT NULL,
   "id" varchar PRIMARY KEY NOT NULL,
   "label" varchar,
   "receive_id_type" "enum_feishu_mappings_notification_recipients_receive_id_type" NOT NULL,
   "receive_id" varchar NOT NULL,
   "enabled" boolean DEFAULT true
  );

  CREATE TABLE "feishu_mappings" (
   "id" serial PRIMARY KEY NOT NULL,
   "name" varchar NOT NULL,
   "key" varchar NOT NULL,
   "status" "enum_feishu_mappings_status" DEFAULT 'draft' NOT NULL,
   "connection_id" integer,
   "app_token" varchar,
   "table_id" varchar,
   "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
   "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );

  CREATE TABLE "feishu_oauth_states" (
   "id" serial PRIMARY KEY NOT NULL,
   "state_hash" varchar NOT NULL,
   "verifier_encrypted" varchar NOT NULL,
   "expires_at" timestamp(3) with time zone NOT NULL,
   "used_at" timestamp(3) with time zone,
   "requested_by_id" integer NOT NULL,
   "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
   "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );

  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "feishu_connections_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "feishu_mappings_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "feishu_oauth_states_id" integer;
  ALTER TABLE "feishu_connections_scopes" ADD CONSTRAINT "feishu_connections_scopes_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."feishu_connections"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "feishu_mappings_field_mappings" ADD CONSTRAINT "feishu_mappings_field_mappings_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."feishu_mappings"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "feishu_mappings_member_mappings" ADD CONSTRAINT "feishu_mappings_member_mappings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "feishu_mappings_member_mappings" ADD CONSTRAINT "feishu_mappings_member_mappings_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."feishu_mappings"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "feishu_mappings_notification_recipients" ADD CONSTRAINT "feishu_mappings_notification_recipients_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."feishu_mappings"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "feishu_mappings" ADD CONSTRAINT "feishu_mappings_connection_id_feishu_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."feishu_connections"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "feishu_oauth_states" ADD CONSTRAINT "feishu_oauth_states_requested_by_id_users_id_fk" FOREIGN KEY ("requested_by_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "feishu_connections_scopes_order_idx" ON "feishu_connections_scopes" USING btree ("_order");
  CREATE INDEX "feishu_connections_scopes_parent_id_idx" ON "feishu_connections_scopes" USING btree ("_parent_id");
  CREATE UNIQUE INDEX "feishu_connections_tenant_key_idx" ON "feishu_connections" USING btree ("tenant_key");
  CREATE INDEX "feishu_connections_status_idx" ON "feishu_connections" USING btree ("status");
  CREATE INDEX "feishu_connections_updated_at_idx" ON "feishu_connections" USING btree ("updated_at");
  CREATE INDEX "feishu_connections_created_at_idx" ON "feishu_connections" USING btree ("created_at");
  CREATE INDEX "feishu_mappings_field_mappings_order_idx" ON "feishu_mappings_field_mappings" USING btree ("_order");
  CREATE INDEX "feishu_mappings_field_mappings_parent_id_idx" ON "feishu_mappings_field_mappings" USING btree ("_parent_id");
  CREATE INDEX "feishu_mappings_member_mappings_order_idx" ON "feishu_mappings_member_mappings" USING btree ("_order");
  CREATE INDEX "feishu_mappings_member_mappings_parent_id_idx" ON "feishu_mappings_member_mappings" USING btree ("_parent_id");
  CREATE INDEX "feishu_mappings_member_mappings_user_idx" ON "feishu_mappings_member_mappings" USING btree ("user_id");
  CREATE INDEX "feishu_mappings_notification_recipients_order_idx" ON "feishu_mappings_notification_recipients" USING btree ("_order");
  CREATE INDEX "feishu_mappings_notification_recipients_parent_id_idx" ON "feishu_mappings_notification_recipients" USING btree ("_parent_id");
  CREATE UNIQUE INDEX "feishu_mappings_key_idx" ON "feishu_mappings" USING btree ("key");
  CREATE INDEX "feishu_mappings_status_idx" ON "feishu_mappings" USING btree ("status");
  CREATE UNIQUE INDEX "feishu_mappings_single_active_idx" ON "feishu_mappings" (("status")) WHERE "status" = 'active';
  CREATE INDEX "feishu_mappings_connection_idx" ON "feishu_mappings" USING btree ("connection_id");
  CREATE INDEX "feishu_mappings_updated_at_idx" ON "feishu_mappings" USING btree ("updated_at");
  CREATE INDEX "feishu_mappings_created_at_idx" ON "feishu_mappings" USING btree ("created_at");
  CREATE UNIQUE INDEX "feishu_oauth_states_state_hash_idx" ON "feishu_oauth_states" USING btree ("state_hash");
  CREATE INDEX "feishu_oauth_states_expires_at_idx" ON "feishu_oauth_states" USING btree ("expires_at");
  CREATE INDEX "feishu_oauth_states_used_at_idx" ON "feishu_oauth_states" USING btree ("used_at");
  CREATE INDEX "feishu_oauth_states_requested_by_idx" ON "feishu_oauth_states" USING btree ("requested_by_id");
  CREATE INDEX "feishu_oauth_states_updated_at_idx" ON "feishu_oauth_states" USING btree ("updated_at");
  CREATE INDEX "feishu_oauth_states_created_at_idx" ON "feishu_oauth_states" USING btree ("created_at");
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_feishu_connections_fk" FOREIGN KEY ("feishu_connections_id") REFERENCES "public"."feishu_connections"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_feishu_mappings_fk" FOREIGN KEY ("feishu_mappings_id") REFERENCES "public"."feishu_mappings"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_feishu_oauth_states_fk" FOREIGN KEY ("feishu_oauth_states_id") REFERENCES "public"."feishu_oauth_states"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_feishu_connections_id_idx" ON "payload_locked_documents_rels" USING btree ("feishu_connections_id");
  CREATE INDEX "payload_locked_documents_rels_feishu_mappings_id_idx" ON "payload_locked_documents_rels" USING btree ("feishu_mappings_id");
  CREATE INDEX "payload_locked_documents_rels_feishu_oauth_states_id_idx" ON "payload_locked_documents_rels" USING btree ("feishu_oauth_states_id");`)
}

export async function down({ db, payload: _payload, req: _req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "feishu_connections_scopes" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "feishu_connections" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "feishu_mappings_field_mappings" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "feishu_mappings_member_mappings" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "feishu_mappings_notification_recipients" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "feishu_mappings" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "feishu_oauth_states" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_feishu_connections_fk";
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_feishu_mappings_fk";
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_feishu_oauth_states_fk";
  DROP INDEX "payload_locked_documents_rels_feishu_connections_id_idx";
  DROP INDEX "payload_locked_documents_rels_feishu_mappings_id_idx";
  DROP INDEX "payload_locked_documents_rels_feishu_oauth_states_id_idx";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "feishu_connections_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "feishu_mappings_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "feishu_oauth_states_id";
  DROP INDEX "feishu_mappings_single_active_idx";
  DROP TABLE "feishu_connections_scopes" CASCADE;
  DROP TABLE "feishu_connections" CASCADE;
  DROP TABLE "feishu_mappings_field_mappings" CASCADE;
  DROP TABLE "feishu_mappings_member_mappings" CASCADE;
  DROP TABLE "feishu_mappings_notification_recipients" CASCADE;
  DROP TABLE "feishu_mappings" CASCADE;
  DROP TABLE "feishu_oauth_states" CASCADE;
  DROP TYPE "public"."enum_feishu_connections_auth_mode";
  DROP TYPE "public"."enum_feishu_connections_status";
  DROP TYPE "public"."enum_feishu_mappings_field_mappings_local_field";
  DROP TYPE "public"."enum_feishu_mappings_notification_recipients_receive_id_type";
  DROP TYPE "public"."enum_feishu_mappings_status";`)
}
