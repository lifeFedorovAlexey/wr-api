import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const databaseUrl = process.env.SCRAPE_TEST_DATABASE_URL;
test("schema setup preserves augments and rolls back incompatible constraint changes", { skip: !databaseUrl }, async () => {
  const admin = postgres(databaseUrl, { max: 1 });
  const name = `patch_schema_${process.pid}_${Date.now()}`;
  let sql;
  try {
    await admin.unsafe(`CREATE DATABASE ${name}`);
    const url = new URL(databaseUrl);
    url.pathname = `/${name}`;
    sql = postgres(url.toString(), { max: 1 });
    await sql.unsafe(`
      CREATE TABLE patch_note_changes (
        id serial primary key, patch_version text not null, locale text not null,ordinal integer not null,
        entity_kind text not null,entity_slug text,entity_name text not null,image_url text,change_type text not null,
        section_name text,change_name text,details jsonb not null default '[]',updated_at timestamptz not null default now(),
        unique(patch_version,locale,ordinal),
        CONSTRAINT patch_note_changes_entity_kind_check CHECK(entity_kind IN ('champion','item','rune','spell','system','skin','augment'))
      );
      INSERT INTO patch_note_changes(patch_version,locale,ordinal,entity_kind,entity_name,change_type)
        VALUES('6.0','en-us',1,'augment','Existing augment','adjustment');
    `);
    const file = fileURLToPath(new URL("../scripts/setup-patch-notes-tables.mjs", import.meta.url));
    const run = () => spawnSync(process.execPath, [file], { env: { ...process.env, DATABASE_URL: url.toString() }, encoding: "utf8", timeout: 60000 });
    const first = run();
    assert.ifError(first.error);
    assert.equal(first.status, 0, first.stderr);
    assert.equal((await sql`select count(*)::int n from patch_note_changes where entity_kind='augment'`)[0].n, 1);
    // A later version may introduce a type this setup script does not recognize.
    // Failed replacement must retain its existing constraint and all its rows.
    await sql.unsafe(`ALTER TABLE patch_note_changes DROP CONSTRAINT patch_note_changes_entity_kind_check;
      ALTER TABLE patch_note_changes ADD CONSTRAINT patch_note_changes_entity_kind_check
        CHECK(entity_kind IN ('augment','future-kind'));
      INSERT INTO patch_note_changes(patch_version,locale,ordinal,entity_kind,entity_name,change_type)
        VALUES('7.0','en-us',1,'future-kind','New source entity','adjustment');`);
    const second = run();
    assert.ifError(second.error);
    assert.equal(second.status, 1);
    const [constraint] = await sql`select pg_get_constraintdef(oid) as definition from pg_constraint where conrelid='patch_note_changes'::regclass and conname='patch_note_changes_entity_kind_check'`;
    assert.match(constraint.definition, /future-kind/);
    assert.equal((await sql`select count(*)::int n from patch_note_changes`)[0].n, 2);
  } finally {
    if (sql) await sql.end({ timeout: 5 });
    await admin.unsafe(`DROP DATABASE IF EXISTS ${name}`);
    await admin.end({ timeout: 5 });
  }
});
