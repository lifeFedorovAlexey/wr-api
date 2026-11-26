import test from "node:test";
import assert from "node:assert/strict";
import { localDatabaseUrl } from "../.github/actions/production-db/connection.mjs";

test("private forwarding preserves encoded credentials and database options", () => {
  const config = "DATABASE_URL=postgresql://app:a%40b%3Ac@127.0.0.1:55432/wildrift?connect_timeout=10\n";
  const result = localDatabaseUrl(config, 43210);
  const url = new URL(result.url);
  assert.equal(url.port, "43210");
  assert.equal(url.hostname, "127.0.0.1");
  assert.equal(result.password, "a@b:c");
  assert.equal(url.searchParams.get("connect_timeout"), "10");
});

test("legacy cloud targets, missing configuration and injected lines fail closed", () => {
  for (const config of ["", "DATABASE_URL=postgres://app:secret@old-db.example/default_db",
    "DATABASE_URL=postgres://app:secret@127.0.0.1:5432/wildrift",
    "DATABASE_URL=postgres://app:secret@127.0.0.1:55432/other",
    "DATABASE_URL=postgres://app:secret@127.0.0.1:55432/wildrift\nDATABASE_URL=other",
    "DATABASE_URL=postgres://app:secret@127.0.0.1:55432/wildrift OTHER=value"]) {
    assert.throws(() => localDatabaseUrl(config, 43210));
  }
  assert.throws(() => localDatabaseUrl("DATABASE_URL=postgres://app:secret@127.0.0.1:55432/wildrift", 22));
});
