import { MigrateDownArgs, MigrateUpArgs, sql } from '@payloadcms/db-postgres'

const adminPermissions = JSON.stringify({
  conversations: { edit: true, view: true },
  content: { edit: true, view: true },
  contentStudio: { edit: true, view: true },
  knowledge: { edit: true, view: true },
  leads: { edit: true, view: true },
  media: { edit: true, view: true },
  operations: { edit: true, view: true },
  platforms: { edit: true, view: true },
  settings: { edit: true, view: true },
})

const operatorPermissions = JSON.stringify({
  conversations: { edit: true, view: true },
  content: { edit: true, view: true },
  contentStudio: { edit: true, view: true },
  knowledge: { edit: true, view: true },
  leads: { edit: true, view: true },
  media: { edit: true, view: true },
  operations: { edit: false, view: true },
  platforms: { edit: false, view: true },
  settings: { edit: true, view: true },
})

const salesPermissions = JSON.stringify({
  conversations: { edit: true, view: true },
  content: { edit: false, view: false },
  contentStudio: { edit: false, view: false },
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
    WITH numbered_users AS (
      SELECT
        id,
        lower(split_part(email, '@', 1)) AS username_base,
        row_number() OVER (
          PARTITION BY lower(split_part(email, '@', 1))
          ORDER BY id
        ) AS username_number
      FROM "users"
    )
    UPDATE "users"
    SET "username" =
      CASE
        WHEN numbered_users.username_number > 1
          THEN numbered_users.username_base || '-' || "users"."id"::text
        ELSE numbered_users.username_base
      END
    FROM numbered_users
    WHERE "users"."id" = numbered_users."id";
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
    WITH numbered_users AS (
      SELECT
        id,
        "email" AS email_base,
        row_number() OVER (PARTITION BY "email" ORDER BY id) AS email_number
      FROM "users"
    )
    UPDATE "users"
    SET "email" =
      CASE
        WHEN numbered_users.email_number > 1
          THEN numbered_users.email_base || '-' || "users"."id"::text
        ELSE numbered_users.email_base
      END
    FROM numbered_users
    WHERE "users"."id" = numbered_users."id";
  `)

  await db.execute(sql`
    DROP INDEX "users_username_idx";
    CREATE UNIQUE INDEX "users_email_idx" ON "users" USING btree ("email");
    ALTER TABLE "users" ALTER COLUMN "email" SET NOT NULL;
    ALTER TABLE "users" DROP COLUMN "permissions";
    ALTER TABLE "users" DROP COLUMN "username";
  `)
}
