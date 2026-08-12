import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload: _payload, req: _req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    ALTER TABLE "leads" ALTER COLUMN "country" DROP NOT NULL;
    UPDATE "feishu_mappings_field_mappings"
    SET "required" = false
    WHERE "local_field" = 'country';
  `)
}

export async function down({ db, payload: _payload, req: _req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM "leads" WHERE "country" IS NULL) THEN
        RAISE EXCEPTION 'Cannot restore required Lead country while country-less Leads exist';
      END IF;
    END $$;
    ALTER TABLE "leads" ALTER COLUMN "country" SET NOT NULL;
    UPDATE "feishu_mappings_field_mappings"
    SET "required" = true
    WHERE "local_field" = 'country';
  `)
}
