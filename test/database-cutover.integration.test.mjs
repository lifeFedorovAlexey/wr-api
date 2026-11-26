import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const databaseUrl = process.env.SCRAPE_TEST_DATABASE_URL;
test("cutover remaps colliding snapshot IDs and preserves both histories", { skip: !databaseUrl }, async () => {
  const admin = postgres(databaseUrl, { max: 1 });
  const name = `cutover_test_${process.pid}_${Date.now()}`;
  let sql;
  try {
    await admin.unsafe(`CREATE DATABASE ${name}`);
    const url = new URL(databaseUrl);
    url.pathname = `/${name}`;
    sql = postgres(url.toString(), { max: 1 });
    await sql.unsafe(`
      CREATE TABLE champion_stats_snapshots(id serial primary key,source text,stats_date date,started_at timestamptz);
      CREATE TABLE champion_stats_history(id serial primary key,snapshot_id integer,slug text,rank text,lane text,win_rate float,
        UNIQUE(snapshot_id,slug,rank,lane),FOREIGN KEY(snapshot_id) REFERENCES champion_stats_snapshots(id));
      CREATE TABLE champions(slug text primary key,name text);
      CREATE TABLE scrape_runs(id text primary key,status text);
      CREATE TABLE patch_note_source_revisions(patch_version text,locale text,content_hash text,raw_html text,archived_at timestamptz,PRIMARY KEY(patch_version,locale,content_hash));
      INSERT INTO patch_note_source_revisions VALUES('7.3f','en-us','shared','same-html','2026-11-24T10:00Z'),('7.3f','en-us','local-only','local-html','2026-11-25T01:00Z');
      CREATE TEMP TABLE old_source_revisions AS SELECT * FROM patch_note_source_revisions WITH NO DATA;
      INSERT INTO old_source_revisions VALUES('7.3f','en-us','shared','same-html','2026-11-24T11:00Z'),('7.3f','en-us','cloud-only','cloud-html','2026-11-25T02:00Z');
      INSERT INTO champion_stats_snapshots VALUES(200,'cnHistory','2026-11-24','2026-11-25T07:17:00Z');
      SELECT setval('champion_stats_snapshots_id_seq',200);
      INSERT INTO champion_stats_history(snapshot_id,slug,rank,lane,win_rate) VALUES(200,'ahri','overall','mid',52.5);
      INSERT INTO champions VALUES('ahri','local'),('akali','local');
      INSERT INTO scrape_runs VALUES('shared','interrupted'),('local-only','success');
      CREATE TEMP TABLE old_source_snapshots AS SELECT * FROM champion_stats_snapshots WITH NO DATA;
      INSERT INTO old_source_snapshots VALUES(200,'cnHistory','2026-11-23','2026-11-25T01:33:00Z');
      CREATE TEMP TABLE old_source_history AS SELECT * FROM champion_stats_history WITH NO DATA;
      INSERT INTO old_source_history VALUES(900,200,'ahri','overall','mid',49.5);
      CREATE TEMP TABLE old_source_champions AS SELECT * FROM champions WITH NO DATA;
      INSERT INTO old_source_champions VALUES('ahri','cloud'),('new-champion','cloud');
      CREATE TEMP TABLE old_source_runs AS SELECT * FROM scrape_runs WITH NO DATA;
      INSERT INTO old_source_runs VALUES('shared','running'),('cloud-only','failed');
    `);
    const metadata = [
      { table: "champion_stats_snapshots", columns: ["id", "source", "stats_date", "started_at"].map(name => ({ name })) },
      { table: "champion_stats_history", columns: ["id", "snapshot_id", "slug", "rank", "lane", "win_rate"].map(name => ({ name })) },
    ];
    const file = fileURLToPath(new URL("../ops/wildrift-worker/cutover-database.py", import.meta.url));
    const py = "import importlib.util,json,sys; s=importlib.util.spec_from_file_location('cutover',sys.argv[1]); m=importlib.util.module_from_spec(s); s.loader.exec_module(m); print(m.merge_sql(json.load(sys.stdin)))";
    const generated = spawnSync(process.platform === "win32" ? "python" : "python3", ["-c", py, file], { input: JSON.stringify(metadata), encoding: "utf8" });
    assert.ifError(generated.error);
    assert.equal(generated.status, 0, generated.stderr);
    // pg_dump clears search_path in the data restore preceding this merge.
    await sql.unsafe("SET search_path=''");
    await sql.unsafe(generated.stdout);
    const history = await sql`select s.id,s.stats_date::text,h.win_rate from champion_stats_snapshots s join champion_stats_history h on h.snapshot_id=s.id order by s.stats_date`;
    assert.equal(history.length, 2);
    assert.notEqual(history[0].id, history[1].id);
    assert.deepEqual(history.map(r => [r.stats_date, r.win_rate]), [["2026-11-23", 49.5], ["2026-11-24", 52.5]]);
    assert.equal(history[1].id, 200);
    assert.equal((await sql`select name from champions where slug='ahri'`)[0].name, "local");
    assert.equal((await sql`select count(*)::int n from champions`)[0].n, 3);
    assert.deepEqual((await sql`select id,status from scrape_runs order by id`).map(r => [r.id, r.status]), [["cloud-only", "failed"], ["local-only", "success"], ["shared", "interrupted"]]);
    assert.deepEqual((await sql`select content_hash from patch_note_source_revisions order by content_hash`).map(r => r.content_hash), ["cloud-only", "local-only", "shared"]);
    // A retry can reuse the already imported source snapshot without duplicating history.
    await sql`drop table imported_snapshot_ids`;
    await sql.unsafe(generated.stdout);
    assert.equal((await sql`select count(*)::int n from champion_stats_history`)[0].n, 2);
    // A content-hash collision with different payload must stop the candidate merge.
    await sql`drop table imported_snapshot_ids`;
    await sql`update old_source_revisions set raw_html='unexpected-payload' where content_hash='shared'`;
    await assert.rejects(sql.unsafe(generated.stdout), /Archived source revision payload differs/);
  } finally {
    if (sql) await sql.end({ timeout: 5 });
    await admin.unsafe(`DROP DATABASE IF EXISTS ${name}`);
    await admin.end({ timeout: 5 });
  }
});
