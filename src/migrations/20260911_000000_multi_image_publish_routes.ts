import { MigrateDownArgs, MigrateUpArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    ALTER TYPE "public"."enum_publish_jobs_execution_route" ADD VALUE IF NOT EXISTS 'facebook-photos-multi';
    ALTER TYPE "public"."enum_publish_jobs_execution_route" ADD VALUE IF NOT EXISTS 'instagram-carousel-staged';
    ALTER TYPE "public"."enum_publish_jobs_execution_route" ADD VALUE IF NOT EXISTS 'linkedin-multi-image-staged';
  `)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  // PostgreSQL cannot remove enum values; down intentionally preserves data.
  await db.execute(sql`SELECT 1`)
}
