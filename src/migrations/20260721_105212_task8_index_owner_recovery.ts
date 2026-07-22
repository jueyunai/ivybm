import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    DO $$
    DECLARE
      affected_routes text;
    BEGIN
      SELECT string_agg(route.usage_key, ', ' ORDER BY route.usage_key)
        INTO affected_routes
      FROM ai_usage_routes AS route
      INNER JOIN ai_model_profiles AS profile ON profile.id = route.profile_id
      WHERE route.enabled = true
        AND profile.enabled = true
        AND route.operation = 'embedding'
        AND (
          profile.capability <> 'embedding'
          OR profile.parameters_dimensions IS NULL
          OR profile.parameters_dimensions <> trunc(profile.parameters_dimensions)
          OR profile.parameters_dimensions < 1
          OR profile.parameters_dimensions > 16384
        );

      IF affected_routes IS NOT NULL THEN
        RAISE EXCEPTION
          'Active embedding route(s) require verified fixed dimensions before this release: %',
          affected_routes;
      END IF;
    END $$;

    UPDATE "knowledge_documents"
       SET "index_status" = 'failed',
           "indexed_at" = NULL,
           "updated_at" = NOW()
     WHERE "index_status" = 'processing';

    ALTER TABLE "knowledge_documents" ADD COLUMN "index_job_id" numeric;
    ALTER TABLE "knowledge_documents" ADD COLUMN "index_owner_token" varchar;
    ALTER TABLE "knowledge_documents"
      ADD CONSTRAINT "knowledge_documents_index_job_id_integral_ck"
      CHECK (
        "index_job_id" IS NULL
        OR (
          "index_job_id" > 0
          AND "index_job_id" <= 2147483647
          AND "index_job_id" = trunc("index_job_id")
        )
      );
  `)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    ALTER TABLE "knowledge_documents" DROP CONSTRAINT IF EXISTS "knowledge_documents_index_job_id_integral_ck";
    ALTER TABLE "knowledge_documents" DROP COLUMN IF EXISTS "index_job_id";
    ALTER TABLE "knowledge_documents" DROP COLUMN IF EXISTS "index_owner_token";
  `)
}
