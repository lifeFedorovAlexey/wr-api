// One-time provisioning. Only the encrypted envelope leaves the Actions runner.
import { randomBytes, createCipheriv, publicEncrypt, constants } from "node:crypto";
import fs from "node:fs/promises";
import { connectScrapeStore } from "../lib/scrapeStore.mjs";

const required = ["DATABASE_URL", "S3_ENDPOINT", "S3_BUCKET", "S3_PUBLIC_BASE_URL", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY", "RECIPIENT_PUBLIC_KEY"];
for (const name of required) if (!process.env[name]) throw new Error(`Missing ${name}`);
const sql = connectScrapeStore(process.env.DATABASE_URL);
const quote = text => '"' + text.replaceAll('"', '""') + '"';
const urlFor = (user, password) => { const url = new URL(process.env.DATABASE_URL); url.username = user; url.password = password; return url.href; };
const workerRole = "wr_scrape_kolvrt", monitorRole = "wr_scrape_monitor";
const workerPassword = randomBytes(32).toString("hex"), monitorPassword = randomBytes(32).toString("hex");
const env = Object.fromEntries(required.filter(key => key.startsWith("S3_")).map(key => [key, process.env[key]]));
Object.assign(env, { DATABASE_URL: urlFor(workerRole, workerPassword), S3_FORCE_PATH_STYLE: process.env.S3_FORCE_PATH_STYLE || "true", ASSET_PUBLIC_MODE: "s3",
  DATABASE_POOL_MAX: "3", GUIDE_ASSETS_DIR: "/tmp/wr-assets/guides", GUIDE_HERO_MEDIA_DIR: "/tmp/wr-assets/hero", CHAMPION_ICONS_DIR: "/tmp/wr-assets/icons",
  CN_FETCH_TIMEOUT_MS: "30000", CN_FETCH_RETRIES: "5", RIFTGG_REQUEST_TIMEOUT_MS: "20000", RIFTGG_FETCH_RETRIES: "2",
  PATCH_NOTES_REQUEST_TIMEOUT_MS: "30000", PATCH_NOTES_FETCH_RETRIES: "3" });
const key = randomBytes(32), iv = randomBytes(12);
const cipher = createCipheriv("aes-256-gcm", key, iv);
const encrypted = Buffer.concat([cipher.update(JSON.stringify({ worker: env, monitor: { DATABASE_URL: urlFor(monitorRole, monitorPassword) } })), cipher.final()]);
const envelope = { version: 1, key: publicEncrypt({ key: Buffer.from(process.env.RECIPIENT_PUBLIC_KEY, "base64"), padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" }, key).toString("base64"),
  iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: encrypted.toString("base64") };
try {
  await sql.begin(async tx => {
    const existing = await tx`select rolname from pg_roles where rolname in (${workerRole}, ${monitorRole})`;
    if (existing.length) throw new Error("Worker roles already exist; refusing to rotate credentials. Use the saved encrypted envelope.");
    await tx.unsafe(await fs.readFile(new URL("../ops/wildrift-worker/schema.sql", import.meta.url), "utf8"));
    // Identifiers are fixed and passwords are hex, never user-provided SQL.
    for (const [role, password] of [[workerRole, workerPassword], [monitorRole, monitorPassword]]) {
      await tx.unsafe(`CREATE ROLE ${quote(role)} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION CONNECTION LIMIT 6 PASSWORD '${password}'`);
      const [{ database }] = await tx`select current_database() as database`;
      await tx.unsafe(`GRANT CONNECT ON DATABASE ${quote(database)} TO ${quote(role)}`);
      await tx.unsafe(`GRANT USAGE ON SCHEMA public TO ${quote(role)}`);
      await tx.unsafe(`ALTER ROLE ${quote(role)} SET statement_timeout = '120s'`);
      await tx.unsafe(`ALTER ROLE ${quote(role)} SET idle_in_transaction_session_timeout = '60s'`);
    }
    const tables = await tx`select tablename from pg_tables where schemaname = 'public'`;
    const allowed = /^(champions|champion_stats_history|champion_stats_snapshots|champion_events|guide_[a-z_]+|riftgg_cn_[a-z_]+|patch_[a-z_]+|skin_collections|skin_entries|scrape_job_state|scrape_runs)$/;
    let count = 0;
    for (const { tablename } of tables) {
      if (!allowed.test(tablename)) continue;
      await tx.unsafe(`GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.${quote(tablename)} TO ${quote(workerRole)}`);
      const sequences = await tx`select pg_get_serial_sequence('public.' || quote_ident(${tablename}), column_name) as sequence from information_schema.columns where table_schema = 'public' and table_name = ${tablename}`;
      for (const { sequence } of sequences.filter(row => row.sequence)) await tx.unsafe(`GRANT USAGE, SELECT ON SEQUENCE ${sequence} TO ${quote(workerRole)}`);
      count++;
    }
    await tx.unsafe(`GRANT SELECT ON scrape_job_state, scrape_runs TO ${quote(monitorRole)}`);
    await tx.unsafe(`ALTER ROLE ${quote(monitorRole)} SET default_transaction_read_only = on`);
    for (const { tablename } of tables.filter(row => /^(admin_|site_|chat_)/.test(row.tablename))) {
      const [access] = await tx`select has_table_privilege(${workerRole}, 'public.' || quote_ident(${tablename}), 'SELECT,INSERT,UPDATE,DELETE') as allowed`;
      if (access.allowed) throw new Error("Worker unexpectedly has access to account/chat tables; provisioning rolled back");
    }
    await fs.writeFile("worker-envelope.json", JSON.stringify(envelope), { mode: 0o600 });
    console.log(`Created scoped worker and read-only monitor roles; ${count} data tables granted.`);
  });
} catch (error) { console.error("Provisioning failed:", error.message); process.exitCode = 1; }
finally { key.fill(0); await sql.end({ timeout: 5 }); }
