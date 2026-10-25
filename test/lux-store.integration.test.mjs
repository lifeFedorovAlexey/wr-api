import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { createLuxStore, setupLuxTables } from "../lib/lux/store.mjs";
import { loadLuxKnowledge } from "../lib/lux/knowledge.mjs";

test("Lux PostgreSQL ownership, leases, replay, recall and reset", { skip: !process.env.LUX_TEST_DATABASE_URL, timeout: 30000 }, async () => {
  const url = new URL(process.env.LUX_TEST_DATABASE_URL);
  if (url.hostname !== "127.0.0.1" || url.port !== "15432" || url.pathname !== "/wildrift_dev" || url.username !== "wildrift_app") throw new Error("Local dev database required");
  const schema = `lux_test_${randomUUID().replaceAll("-", "")}`;
  const sql = postgres(url.href, { max: 1, connect_timeout: 3, onnotice() {}, connection: { search_path: `${schema},public`, statement_timeout: 5000 } });
  drizzle(sql); // Match db/client.js: raw SQL shares Drizzle's JSON/date serializers.
  try {
    await sql.unsafe(`create schema ${schema}`);
    await sql`create table site_users(id integer primary key)`;
    await sql`insert into site_users values (1), (2)`;
    await setupLuxTables(sql);
    const store = createLuxStore(sql);
    const request = randomUUID();
    const claim = await store.claim(1, request, "Люблю Гарена и поддержку");
    assert.equal((await store.history(2)).turns.length, 0);
    assert.equal((await store.claim(1, request, claim.turn.body)).existing, true);
    await assert.rejects(store.claim(1, randomUUID(), "parallel"), /lux_busy/);
    await assert.rejects(store.claim(1, request, "different"), /lux_request_conflict/);
    const result = { reply: "Запомнила!", sources: [{ label: "Гайд", url: "/guides/garen" }], entities: ["garen"], summary: "Играет за Гарена", throughId: claim.turn.id };
    assert.equal(await store.finish(1, claim, result), true);
    assert.equal((await store.claim(1, request, claim.turn.body)).existing, true);
    assert.equal((await store.history(1)).turns.length, 1);
    assert.deepEqual((await store.history(1)).turns[0].sources, result.sources);
    assert.equal((await store.recall(1, "Гарен", claim.turn.id)).length, 1);
    assert.equal((await store.recall(2, "Гарен", claim.turn.id)).length, 0);
    const second = await store.claim(1, randomUUID(), "следующий");
    assert.equal(second.memory.summary, result.summary);
    assert.deepEqual(second.memory.entities, ["garen"]);
    assert.equal(second.turns.length, 0);
    await store.fail(1, second, "lux_unavailable");
    assert.equal((await store.history(1)).turns.at(-1).status, "failed");
    const retry = await store.claim(1, second.turn.request_id, second.turn.body);
    assert.equal(retry.turn.id, second.turn.id);
    await sql`update lux_conversations set lease_until=now()-interval '1 second' where user_id=1`;
    assert.equal((await store.history(1)).turns.at(-1).status, "failed");
    const replacement = await store.claim(1, second.turn.request_id, second.turn.body);
    assert.equal(await store.finish(1, retry, result), false);
    await store.reset(1);
    assert.equal(await store.finish(1, replacement, result), false);
    assert.equal((await store.history(1)).turns.length, 0);
    assert.equal((await store.recall(1, "Гарен", claim.turn.id)).length, 0);
    // Exercise real game-table SQL against the existing read-only game dataset.
    const data = await loadLuxKnowledge(sql, "Люкс поддержка мастер", { entities: [], summary: "" }, []);
    assert.ok(Array.isArray(data.knowledge.stats));
    assert.equal(data.knowledge.query.lane, "support");
    assert.ok(data.knowledge.stats.every(row => row.rank === "masterPlus" && row.lane === "support"));
  } finally {
    // Only the unique schema created by this test is removed.
    try { await sql.unsafe(`drop schema if exists ${schema} cascade`); }
    finally { await sql.end({ timeout: 2 }); }
  }
});
