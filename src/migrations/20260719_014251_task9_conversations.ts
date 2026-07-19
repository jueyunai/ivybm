import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload: _payload, req: _req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_visitor_sessions_channel" AS ENUM('website', 'whatsapp', 'facebook', 'instagram');
  CREATE TYPE "public"."enum_visitor_sessions_locale" AS ENUM('en', 'ar');
  CREATE TYPE "public"."enum_conversations_channel" AS ENUM('website', 'whatsapp', 'facebook', 'instagram');
  CREATE TYPE "public"."enum_conversations_locale" AS ENUM('en', 'ar');
  CREATE TYPE "public"."enum_conversations_handoff_status" AS ENUM('ai_active', 'handoff_requested', 'human_active', 'resolved');
  CREATE TYPE "public"."enum_conversations_intent_level" AS ENUM('unscored', 'a', 'b', 'c');
  CREATE TYPE "public"."enum_messages_author" AS ENUM('visitor', 'ai', 'operator', 'system');
  CREATE TYPE "public"."enum_messages_status" AS ENUM('pending', 'sent', 'failed');
  CREATE TYPE "public"."enum_handoffs_status" AS ENUM('requested', 'active', 'resolved');
  CREATE TYPE "public"."enum_handoffs_source" AS ENUM('visitor', 'ai_policy', 'operator');
  CREATE TYPE "public"."enum_conversation_commands_status" AS ENUM('processing', 'completed', 'failed');
  CREATE TABLE "visitor_sessions" (
    "id" serial PRIMARY KEY NOT NULL,
    "public_id" varchar NOT NULL,
    "session_token_hash" varchar NOT NULL,
    "idempotency_key" varchar NOT NULL,
    "channel" "enum_visitor_sessions_channel" NOT NULL,
    "locale" "enum_visitor_sessions_locale" NOT NULL,
    "source_u_r_l" varchar,
    "last_seen_at" timestamp(3) with time zone NOT NULL,
    "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
    "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );

  CREATE TABLE "conversations" (
    "id" serial PRIMARY KEY NOT NULL,
    "public_id" varchar NOT NULL,
    "request_id" varchar NOT NULL,
    "visitor_session_id" integer NOT NULL,
    "channel" "enum_conversations_channel" NOT NULL,
    "external_thread_id" varchar,
    "locale" "enum_conversations_locale" NOT NULL,
    "handoff_status" "enum_conversations_handoff_status" DEFAULT 'ai_active' NOT NULL,
    "assigned_to_id" integer,
    "lead_id" integer,
    "intent_level" "enum_conversations_intent_level" DEFAULT 'unscored' NOT NULL,
    "intent_score" numeric,
    "summary" varchar,
    "last_message_at" timestamp(3) with time zone,
    "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
    "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );

  CREATE TABLE "messages_citations" (
    "_order" integer NOT NULL,
    "_parent_id" integer NOT NULL,
    "id" varchar PRIMARY KEY NOT NULL,
    "document_id" varchar NOT NULL,
    "title" varchar NOT NULL,
    "version" varchar NOT NULL,
    "url" varchar
  );

  CREATE TABLE "messages" (
    "id" serial PRIMARY KEY NOT NULL,
    "conversation_id" integer NOT NULL,
    "request_id" varchar NOT NULL,
    "idempotency_key" varchar NOT NULL,
    "external_message_id" varchar,
    "author" "enum_messages_author" NOT NULL,
    "status" "enum_messages_status" DEFAULT 'sent' NOT NULL,
    "content" varchar NOT NULL,
    "prompt_version" numeric,
    "model" varchar,
    "token_usage_input_tokens" numeric,
    "token_usage_output_tokens" numeric,
    "token_usage_total_tokens" numeric,
    "estimated_cost_u_s_d" numeric,
    "error_code" varchar,
    "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
    "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );

  CREATE TABLE "handoffs" (
    "id" serial PRIMARY KEY NOT NULL,
    "public_id" varchar NOT NULL,
    "conversation_id" integer NOT NULL,
    "idempotency_key" varchar NOT NULL,
    "domain_event_id" varchar NOT NULL,
    "status" "enum_handoffs_status" DEFAULT 'requested' NOT NULL,
    "source" "enum_handoffs_source" NOT NULL,
    "reason" varchar NOT NULL,
    "requested_by_id" integer,
    "assigned_to_id" integer,
    "requested_at" timestamp(3) with time zone NOT NULL,
    "accepted_at" timestamp(3) with time zone,
    "resolved_at" timestamp(3) with time zone,
    "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
    "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );

  CREATE TABLE "conversation_commands" (
    "id" serial PRIMARY KEY NOT NULL,
    "scope" varchar NOT NULL,
    "idempotency_key" varchar NOT NULL,
    "owner_token" varchar NOT NULL,
    "status" "enum_conversation_commands_status" DEFAULT 'processing' NOT NULL,
    "conversation_id" integer,
    "result" jsonb,
    "error_code" varchar,
    "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
    "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );

  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "visitor_sessions_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "conversations_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "messages_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "handoffs_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "conversation_commands_id" integer;
  ALTER TABLE "conversations" ADD CONSTRAINT "conversations_visitor_session_id_visitor_sessions_id_fk" FOREIGN KEY ("visitor_session_id") REFERENCES "public"."visitor_sessions"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "conversations" ADD CONSTRAINT "conversations_assigned_to_id_users_id_fk" FOREIGN KEY ("assigned_to_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "conversations" ADD CONSTRAINT "conversations_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "messages_citations" ADD CONSTRAINT "messages_citations_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "handoffs" ADD CONSTRAINT "handoffs_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "handoffs" ADD CONSTRAINT "handoffs_requested_by_id_users_id_fk" FOREIGN KEY ("requested_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "handoffs" ADD CONSTRAINT "handoffs_assigned_to_id_users_id_fk" FOREIGN KEY ("assigned_to_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "conversation_commands" ADD CONSTRAINT "conversation_commands_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;
  CREATE UNIQUE INDEX "visitor_sessions_public_id_idx" ON "visitor_sessions" USING btree ("public_id");
  CREATE UNIQUE INDEX "visitor_sessions_session_token_hash_idx" ON "visitor_sessions" USING btree ("session_token_hash");
  CREATE UNIQUE INDEX "visitor_sessions_idempotency_key_idx" ON "visitor_sessions" USING btree ("idempotency_key");
  CREATE INDEX "visitor_sessions_channel_idx" ON "visitor_sessions" USING btree ("channel");
  CREATE INDEX "visitor_sessions_last_seen_at_idx" ON "visitor_sessions" USING btree ("last_seen_at");
  CREATE INDEX "visitor_sessions_updated_at_idx" ON "visitor_sessions" USING btree ("updated_at");
  CREATE INDEX "visitor_sessions_created_at_idx" ON "visitor_sessions" USING btree ("created_at");
  CREATE UNIQUE INDEX "conversations_public_id_idx" ON "conversations" USING btree ("public_id");
  CREATE UNIQUE INDEX "conversations_request_id_idx" ON "conversations" USING btree ("request_id");
  CREATE UNIQUE INDEX "conversations_visitor_session_idx" ON "conversations" USING btree ("visitor_session_id");
  CREATE INDEX "conversations_channel_idx" ON "conversations" USING btree ("channel");
  CREATE INDEX "conversations_external_thread_id_idx" ON "conversations" USING btree ("external_thread_id");
  CREATE INDEX "conversations_handoff_status_idx" ON "conversations" USING btree ("handoff_status");
  CREATE INDEX "conversations_assigned_to_idx" ON "conversations" USING btree ("assigned_to_id");
  CREATE INDEX "conversations_lead_idx" ON "conversations" USING btree ("lead_id");
  CREATE INDEX "conversations_intent_level_idx" ON "conversations" USING btree ("intent_level");
  CREATE INDEX "conversations_last_message_at_idx" ON "conversations" USING btree ("last_message_at");
  CREATE INDEX "conversations_updated_at_idx" ON "conversations" USING btree ("updated_at");
  CREATE INDEX "conversations_created_at_idx" ON "conversations" USING btree ("created_at");
  CREATE INDEX "messages_citations_order_idx" ON "messages_citations" USING btree ("_order");
  CREATE INDEX "messages_citations_parent_id_idx" ON "messages_citations" USING btree ("_parent_id");
  CREATE INDEX "messages_conversation_idx" ON "messages" USING btree ("conversation_id");
  CREATE UNIQUE INDEX "messages_request_id_idx" ON "messages" USING btree ("request_id");
  CREATE UNIQUE INDEX "messages_idempotency_key_idx" ON "messages" USING btree ("idempotency_key");
  CREATE INDEX "messages_external_message_id_idx" ON "messages" USING btree ("external_message_id");
  CREATE INDEX "messages_author_idx" ON "messages" USING btree ("author");
  CREATE INDEX "messages_status_idx" ON "messages" USING btree ("status");
  CREATE INDEX "messages_updated_at_idx" ON "messages" USING btree ("updated_at");
  CREATE INDEX "messages_created_at_idx" ON "messages" USING btree ("created_at");
  CREATE UNIQUE INDEX "handoffs_public_id_idx" ON "handoffs" USING btree ("public_id");
  CREATE INDEX "handoffs_conversation_idx" ON "handoffs" USING btree ("conversation_id");
  CREATE UNIQUE INDEX "handoffs_idempotency_key_idx" ON "handoffs" USING btree ("idempotency_key");
  CREATE UNIQUE INDEX "handoffs_domain_event_id_idx" ON "handoffs" USING btree ("domain_event_id");
  CREATE INDEX "handoffs_status_idx" ON "handoffs" USING btree ("status");
  CREATE INDEX "handoffs_requested_by_idx" ON "handoffs" USING btree ("requested_by_id");
  CREATE INDEX "handoffs_assigned_to_idx" ON "handoffs" USING btree ("assigned_to_id");
  CREATE INDEX "handoffs_requested_at_idx" ON "handoffs" USING btree ("requested_at");
  CREATE INDEX "handoffs_updated_at_idx" ON "handoffs" USING btree ("updated_at");
  CREATE INDEX "handoffs_created_at_idx" ON "handoffs" USING btree ("created_at");
  CREATE INDEX "conversation_commands_scope_idx" ON "conversation_commands" USING btree ("scope");
  CREATE UNIQUE INDEX "conversation_commands_idempotency_key_idx" ON "conversation_commands" USING btree ("idempotency_key");
  CREATE INDEX "conversation_commands_status_idx" ON "conversation_commands" USING btree ("status");
  CREATE INDEX "conversation_commands_conversation_idx" ON "conversation_commands" USING btree ("conversation_id");
  CREATE INDEX "conversation_commands_updated_at_idx" ON "conversation_commands" USING btree ("updated_at");
  CREATE INDEX "conversation_commands_created_at_idx" ON "conversation_commands" USING btree ("created_at");
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_visitor_sessions_fk" FOREIGN KEY ("visitor_sessions_id") REFERENCES "public"."visitor_sessions"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_conversations_fk" FOREIGN KEY ("conversations_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_messages_fk" FOREIGN KEY ("messages_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_handoffs_fk" FOREIGN KEY ("handoffs_id") REFERENCES "public"."handoffs"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_conversation_commands_fk" FOREIGN KEY ("conversation_commands_id") REFERENCES "public"."conversation_commands"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_visitor_sessions_id_idx" ON "payload_locked_documents_rels" USING btree ("visitor_sessions_id");
  CREATE INDEX "payload_locked_documents_rels_conversations_id_idx" ON "payload_locked_documents_rels" USING btree ("conversations_id");
  CREATE INDEX "payload_locked_documents_rels_messages_id_idx" ON "payload_locked_documents_rels" USING btree ("messages_id");
  CREATE INDEX "payload_locked_documents_rels_handoffs_id_idx" ON "payload_locked_documents_rels" USING btree ("handoffs_id");
  CREATE INDEX "payload_locked_documents_rels_conversation_commands_id_idx" ON "payload_locked_documents_rels" USING btree ("conversation_commands_id");`)
}

export async function down({ db, payload: _payload, req: _req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_visitor_sessions_fk";
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_conversations_fk";
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_messages_fk";
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_handoffs_fk";
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_conversation_commands_fk";
  DROP INDEX "payload_locked_documents_rels_visitor_sessions_id_idx";
  DROP INDEX "payload_locked_documents_rels_conversations_id_idx";
  DROP INDEX "payload_locked_documents_rels_messages_id_idx";
  DROP INDEX "payload_locked_documents_rels_handoffs_id_idx";
  DROP INDEX "payload_locked_documents_rels_conversation_commands_id_idx";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "visitor_sessions_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "conversations_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "messages_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "handoffs_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "conversation_commands_id";
  ALTER TABLE "visitor_sessions" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "conversations" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "messages_citations" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "messages" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "handoffs" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "conversation_commands" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "messages_citations" CASCADE;
  DROP TABLE "messages" CASCADE;
  DROP TABLE "handoffs" CASCADE;
  DROP TABLE "conversation_commands" CASCADE;
  DROP TABLE "conversations" CASCADE;
  DROP TABLE "visitor_sessions" CASCADE;
  DROP TYPE "public"."enum_visitor_sessions_channel";
  DROP TYPE "public"."enum_visitor_sessions_locale";
  DROP TYPE "public"."enum_conversations_channel";
  DROP TYPE "public"."enum_conversations_locale";
  DROP TYPE "public"."enum_conversations_handoff_status";
  DROP TYPE "public"."enum_conversations_intent_level";
  DROP TYPE "public"."enum_messages_author";
  DROP TYPE "public"."enum_messages_status";
  DROP TYPE "public"."enum_handoffs_status";
  DROP TYPE "public"."enum_handoffs_source";
  DROP TYPE "public"."enum_conversation_commands_status";`)
}
