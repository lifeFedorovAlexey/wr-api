import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const schemaSource = fs.readFileSync(new URL("../db/schema.js", import.meta.url), "utf8");
const setupSource = fs.readFileSync(
  new URL("../scripts/setup-admin-tables.mjs", import.meta.url),
  "utf8",
);

test("streamer tierlist schema supports anonymous public links and edit capabilities", () => {
  assert.match(schemaSource, /publicId:\s*text\("public_id"\)/);
  assert.match(schemaSource, /editTokenHash:\s*text\("edit_token_hash"\)/);
  assert.match(schemaSource, /authorName:\s*text\("author_name"\)/);
  assert.doesNotMatch(schemaSource, /siteUserId:\s*integer\("site_user_id"\)\.notNull\(\)/);
  assert.match(schemaSource, /streamer_tierlists_public_id_published_idx/);
});

test("streamer tierlist setup backfills public ids before enforcing them", () => {
  assert.match(setupSource, /add column if not exists public_id text/i);
  assert.match(setupSource, /add column if not exists edit_token_hash text/i);
  assert.match(setupSource, /add column if not exists author_name text/i);
  assert.match(setupSource, /drop not null/i);
  assert.match(setupSource, /update streamer_tierlist_publications[\s\S]*public_id/i);
  assert.match(setupSource, /streamer_tierlists_public_id_published_idx/i);
});
