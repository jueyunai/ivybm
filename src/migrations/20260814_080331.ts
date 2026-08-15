import { MigrateDownArgs, MigrateUpArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    CREATE TYPE "public"."enum_conversation_delivery_intents_required_handoff_status"
      AS ENUM('ai_active', 'human_active');
    CREATE TYPE "public"."enum_conversation_delivery_intents_platform"
      AS ENUM('facebook-messenger', 'instagram');
    CREATE TYPE "public"."enum_conversation_delivery_intents_status"
      AS ENUM('queued', 'retrying', 'accepted', 'blocked', 'failed', 'dead', 'delivery_unknown');

    CREATE TABLE "conversation_delivery_intents" (
      "id" serial PRIMARY KEY NOT NULL,
      "conversation_id" integer NOT NULL,
      "reply_message_id" integer NOT NULL,
      "queue_job_id" integer NOT NULL,
      "required_handoff_status" "enum_conversation_delivery_intents_required_handoff_status" NOT NULL,
      "expected_revision" numeric NOT NULL,
      "platform" "enum_conversation_delivery_intents_platform" NOT NULL,
      "account_external_id" varchar NOT NULL,
      "recipient_external_id" varchar NOT NULL,
      "text" varchar NOT NULL,
      "delivery_key" varchar NOT NULL,
      "status" "enum_conversation_delivery_intents_status" DEFAULT 'queued' NOT NULL,
      "claim_id" varchar,
      "claim_owner_token" varchar,
      "claim_lease_expires_at" timestamp(3) with time zone,
      "fencing_generation" numeric DEFAULT 0 NOT NULL,
      "provider_i_o_started_at" timestamp(3) with time zone,
      "accepted_at" timestamp(3) with time zone,
      "delivery_unknown_at" timestamp(3) with time zone,
      "provider_reference" varchar,
      "last_error_code" varchar,
      "last_error_summary" varchar,
      "retryable" boolean DEFAULT false NOT NULL,
      "retry_after_seconds" numeric,
      "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
      "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
    );

    ALTER TABLE "conversations" ADD COLUMN "external_account_id" varchar;
    ALTER TABLE "conversations" ADD COLUMN "external_sender_id" varchar;
    ALTER TABLE "payload_locked_documents_rels"
      ADD COLUMN "conversation_delivery_intents_id" integer;

    ALTER TABLE "conversation_delivery_intents"
      ADD CONSTRAINT "conversation_delivery_intents_conversation_id_conversations_id_fk"
      FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id")
      ON DELETE restrict ON UPDATE no action;
    ALTER TABLE "conversation_delivery_intents"
      ADD CONSTRAINT "conversation_delivery_intents_reply_message_id_messages_id_fk"
      FOREIGN KEY ("reply_message_id") REFERENCES "public"."messages"("id")
      ON DELETE restrict ON UPDATE no action;
    ALTER TABLE "conversation_delivery_intents"
      ADD CONSTRAINT "conversation_delivery_intents_queue_job_id_jobs_id_fk"
      FOREIGN KEY ("queue_job_id") REFERENCES "public"."jobs"("id")
      ON DELETE restrict ON UPDATE no action;
    ALTER TABLE "payload_locked_documents_rels"
      ADD CONSTRAINT "payload_locked_documents_rels_conversation_delivery_inten_fk"
      FOREIGN KEY ("conversation_delivery_intents_id")
      REFERENCES "public"."conversation_delivery_intents"("id")
      ON DELETE cascade ON UPDATE no action;

    CREATE INDEX "conversation_delivery_intents_conversation_idx"
      ON "conversation_delivery_intents" USING btree ("conversation_id");
    CREATE UNIQUE INDEX "conversation_delivery_intents_reply_message_idx"
      ON "conversation_delivery_intents" USING btree ("reply_message_id");
    CREATE UNIQUE INDEX "conversation_delivery_intents_queue_job_idx"
      ON "conversation_delivery_intents" USING btree ("queue_job_id");
    CREATE INDEX "conversation_delivery_intents_platform_idx"
      ON "conversation_delivery_intents" USING btree ("platform");
    CREATE INDEX "conversation_delivery_intents_status_idx"
      ON "conversation_delivery_intents" USING btree ("status");
    CREATE INDEX "conversation_delivery_intents_claim_lease_expires_at_idx"
      ON "conversation_delivery_intents" USING btree ("claim_lease_expires_at");
    CREATE INDEX "conversation_delivery_intents_updated_at_idx"
      ON "conversation_delivery_intents" USING btree ("updated_at");
    CREATE INDEX "conversation_delivery_intents_created_at_idx"
      ON "conversation_delivery_intents" USING btree ("created_at");
    CREATE INDEX "conversation_status_idx"
      ON "conversation_delivery_intents" USING btree ("conversation_id", "status");
    CREATE UNIQUE INDEX "platform_accountExternalId_deliveryKey_idx"
      ON "conversation_delivery_intents" USING btree
      ("platform", "account_external_id", "delivery_key");
    CREATE INDEX "conversations_external_account_id_idx"
      ON "conversations" USING btree ("external_account_id");
    CREATE INDEX "conversations_external_sender_id_idx"
      ON "conversations" USING btree ("external_sender_id");
    CREATE INDEX "payload_locked_documents_rels_conversation_delivery_inte_idx"
      ON "payload_locked_documents_rels" USING btree ("conversation_delivery_intents_id");
  `)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    ALTER TABLE "payload_locked_documents_rels"
      DROP CONSTRAINT "payload_locked_documents_rels_conversation_delivery_inten_fk";
    DROP INDEX "payload_locked_documents_rels_conversation_delivery_inte_idx";
    ALTER TABLE "payload_locked_documents_rels"
      DROP COLUMN "conversation_delivery_intents_id";

    DROP INDEX "conversations_external_account_id_idx";
    DROP INDEX "conversations_external_sender_id_idx";
    ALTER TABLE "conversations" DROP COLUMN "external_account_id";
    ALTER TABLE "conversations" DROP COLUMN "external_sender_id";

    DROP TABLE "conversation_delivery_intents" CASCADE;
    DROP TYPE "public"."enum_conversation_delivery_intents_required_handoff_status";
    DROP TYPE "public"."enum_conversation_delivery_intents_platform";
    DROP TYPE "public"."enum_conversation_delivery_intents_status";
  `)
}
