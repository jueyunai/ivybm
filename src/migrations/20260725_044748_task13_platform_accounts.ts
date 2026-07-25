import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload: _payload, req: _req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    CREATE TYPE "public"."enum_platform_accounts_account_kind" AS ENUM('facebook-page', 'instagram-professional', 'tiktok-business', 'linkedin-member', 'linkedin-organization');
    CREATE TYPE "public"."enum_platform_accounts_platform_family" AS ENUM('meta', 'tiktok', 'linkedin');
    CREATE TYPE "public"."enum_platform_accounts_authorization_state" AS ENUM('not_started', 'pending', 'connected', 'expired', 'blocked', 'disabled');
    CREATE TYPE "public"."enum_platform_accounts_capabilities_messaging_inbound" AS ENUM('not_started', 'pending', 'approved', 'blocked');
    CREATE TYPE "public"."enum_platform_accounts_capabilities_publishing" AS ENUM('not_started', 'pending', 'approved', 'blocked');
    CREATE TABLE "platform_accounts_authorization_scopes" (
      "_order" integer NOT NULL,
      "_parent_id" integer NOT NULL,
      "id" varchar PRIMARY KEY NOT NULL,
      "scope" varchar NOT NULL
    );

    CREATE TABLE "platform_accounts" (
      "id" serial PRIMARY KEY NOT NULL,
      "name" varchar NOT NULL,
      "account_kind" "enum_platform_accounts_account_kind" NOT NULL,
      "platform_family" "enum_platform_accounts_platform_family" DEFAULT 'meta' NOT NULL,
      "external_account_id" varchar,
      "connection_key" varchar,
      "authorization_state" "enum_platform_accounts_authorization_state" DEFAULT 'not_started' NOT NULL,
      "authorization_app_id" varchar,
      "authorization_access_token" varchar,
      "authorization_access_token_configured" boolean DEFAULT false,
      "authorization_clear_access_token" boolean DEFAULT false,
      "authorization_refresh_token" varchar,
      "authorization_refresh_token_configured" boolean DEFAULT false,
      "authorization_clear_refresh_token" boolean DEFAULT false,
      "authorization_expires_at" timestamp(3) with time zone,
      "capabilities_messaging_inbound" "enum_platform_accounts_capabilities_messaging_inbound" DEFAULT 'not_started',
      "capabilities_publishing" "enum_platform_accounts_capabilities_publishing" DEFAULT 'not_started',
      "notes" varchar,
      "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
      "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
    );

    ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "platform_accounts_id" integer;
    ALTER TABLE "platform_accounts_authorization_scopes" ADD CONSTRAINT "platform_accounts_authorization_scopes_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."platform_accounts"("id") ON DELETE cascade ON UPDATE no action;
    CREATE INDEX "platform_accounts_authorization_scopes_order_idx" ON "platform_accounts_authorization_scopes" USING btree ("_order");
    CREATE INDEX "platform_accounts_authorization_scopes_parent_id_idx" ON "platform_accounts_authorization_scopes" USING btree ("_parent_id");
    CREATE UNIQUE INDEX "platform_accounts_name_idx" ON "platform_accounts" USING btree ("name");
    CREATE INDEX "platform_accounts_platform_family_idx" ON "platform_accounts" USING btree ("platform_family");
    CREATE INDEX "platform_accounts_external_account_id_idx" ON "platform_accounts" USING btree ("external_account_id");
    CREATE UNIQUE INDEX "platform_accounts_connection_key_idx" ON "platform_accounts" USING btree ("connection_key");
    CREATE INDEX "platform_accounts_updated_at_idx" ON "platform_accounts" USING btree ("updated_at");
    CREATE INDEX "platform_accounts_created_at_idx" ON "platform_accounts" USING btree ("created_at");
    ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_platform_accounts_fk" FOREIGN KEY ("platform_accounts_id") REFERENCES "public"."platform_accounts"("id") ON DELETE cascade ON UPDATE no action;
    CREATE INDEX "payload_locked_documents_rels_platform_accounts_id_idx" ON "payload_locked_documents_rels" USING btree ("platform_accounts_id");`)
}

export async function down({ db, payload: _payload, req: _req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
  ALTER TABLE "platform_accounts_authorization_scopes" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "platform_accounts" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "platform_accounts_authorization_scopes" CASCADE;
  DROP TABLE "platform_accounts" CASCADE;
  -- Dropping platform_accounts with CASCADE already removes this relation's
  -- foreign-key constraint. Trying to drop it a second time breaks a complete
  -- migration reset before the column and its index can be removed.
  DROP INDEX "payload_locked_documents_rels_platform_accounts_id_idx";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "platform_accounts_id";
  DROP TYPE "public"."enum_platform_accounts_account_kind";
  DROP TYPE "public"."enum_platform_accounts_platform_family";
  DROP TYPE "public"."enum_platform_accounts_authorization_state";
  DROP TYPE "public"."enum_platform_accounts_capabilities_messaging_inbound";
  DROP TYPE "public"."enum_platform_accounts_capabilities_publishing";`)
}
