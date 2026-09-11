import { MigrateDownArgs, MigrateUpArgs, sql } from '@payloadcms/db-postgres'

const adminPermissions = JSON.stringify({
  conversations: { edit: true, view: true },
  'website-content': { edit: true, view: true },
  'content-studio': { edit: true, view: true },
  knowledge: { edit: true, view: true },
  leads: { edit: true, view: true },
  media: { edit: true, view: true },
  operations: { edit: true, view: true },
  platforms: { edit: true, view: true },
  settings: { edit: true, view: true },
})

const operatorPermissions = JSON.stringify({
  conversations: { edit: true, view: true },
  'website-content': { edit: true, view: true },
  'content-studio': { edit: true, view: true },
  knowledge: { edit: true, view: true },
  leads: { edit: true, view: true },
  media: { edit: true, view: true },
  operations: { edit: false, view: false },
  platforms: { edit: false, view: false },
  settings: { edit: true, view: true },
})

const salesPermissions = JSON.stringify({
  conversations: { edit: true, view: true },
  'website-content': { edit: false, view: false },
  'content-studio': { edit: false, view: false },
  knowledge: { edit: false, view: false },
  leads: { edit: true, view: true },
  media: { edit: false, view: false },
  operations: { edit: false, view: false },
  platforms: { edit: false, view: false },
  settings: { edit: true, view: true },
})

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    ALTER TABLE "users" ADD COLUMN "username" varchar;
  `)

  await db.execute(sql`
    DO $$
    DECLARE
      rec RECORD;
      candidate text;
      base text;
      suffix integer;
    BEGIN
      -- Allocate usernames in id order and probe the complete set of already
      -- assigned values. A partitioned row_number() cannot see cross-base
      -- collisions such as "alex-2" produced by another user's "alex" base.
      FOR rec IN
        SELECT
          id,
          CASE
            WHEN length(username_base) >= 3 THEN username_base
            WHEN length(username_base) = 2 THEN username_base || '0'
            WHEN length(username_base) = 1 THEN username_base || '00'
            ELSE 'user'
          END AS username_base
        FROM (
          SELECT
            id,
            btrim(
              left(
                regexp_replace(
                  lower(split_part(coalesce(email, ''), '@', 1)),
                  '[^a-z0-9._-]+',
                  '-',
                  'g'
                ),
                40
              ),
              '._-'
            ) AS username_base
          FROM "users"
        ) AS cleaned_users
        ORDER BY id
      LOOP
        base := rec.username_base;
        candidate := base;
        suffix := 0;

        WHILE EXISTS (SELECT 1 FROM "users" WHERE "username" = candidate) LOOP
          suffix := suffix + 1;
          candidate := base || '-' || rec.id::text;
          IF suffix > 1 THEN
            candidate := candidate || '-' || suffix::text;
          END IF;
        END LOOP;

        UPDATE "users" SET "username" = candidate WHERE id = rec.id;
      END LOOP;
    END $$;
  `)

  await db.execute(sql`
    ALTER TABLE "users" ADD COLUMN "permissions" jsonb;
  `)

  await db.execute(
    sql`
      UPDATE "users"
      SET "permissions" = CASE "role"
        WHEN 'admin' THEN ${adminPermissions}::jsonb
        WHEN 'operator' THEN ${operatorPermissions}::jsonb
        ELSE ${salesPermissions}::jsonb
      END
      WHERE "permissions" IS NULL;
    `,
  )

  await db.execute(sql`
    ALTER TABLE "users"
      ALTER COLUMN "username" SET NOT NULL,
      ALTER COLUMN "permissions" SET NOT NULL,
      ALTER COLUMN "email" DROP NOT NULL;
    DROP INDEX "users_email_idx";
    CREATE UNIQUE INDEX "users_username_idx" ON "users" USING btree ("username");
  `)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    UPDATE "users"
    SET "email" = "username" || '@legacy.invalid'
    WHERE "email" IS NULL;
  `)

  await db.execute(sql`
    DO $$
    DECLARE
      rec RECORD;
      local_part text;
      domain_part text;
      candidate text;
      suffix integer;
    BEGIN
      FOR rec IN SELECT id, email FROM "users" ORDER BY id LOOP
        IF EXISTS (
          SELECT 1
          FROM "users"
          WHERE "email" = rec.email AND id <> rec.id
        ) THEN
          local_part := split_part(coalesce(rec.email, ''), '@', 1);
          domain_part := split_part(coalesce(rec.email, ''), '@', 2);
          IF domain_part = '' THEN
            domain_part := 'legacy.invalid';
          END IF;

          candidate := local_part || '-' || rec.id::text || '@' || domain_part;
          suffix := 0;
          WHILE EXISTS (
            SELECT 1
            FROM "users"
            WHERE "email" = candidate AND id <> rec.id
          ) LOOP
            suffix := suffix + 1;
            candidate :=
              local_part || '-' || rec.id::text || '-' || suffix::text || '@' || domain_part;
          END LOOP;

          UPDATE "users" SET "email" = candidate WHERE id = rec.id;
        END IF;
      END LOOP;
    END $$;
  `)

  await db.execute(sql`
    DROP INDEX "users_username_idx";
    CREATE UNIQUE INDEX "users_email_idx" ON "users" USING btree ("email");
    ALTER TABLE "users" ALTER COLUMN "email" SET NOT NULL;
    ALTER TABLE "users" DROP COLUMN "permissions";
    ALTER TABLE "users" DROP COLUMN "username";
  `)
}
