// Initialize coordination tables using the existing importer account. No roles or keys.
import "dotenv/config";
import fs from "node:fs/promises";
import { connectScrapeStore, acquireCoordinator, releaseCoordinator } from "../lib/scrapeStore.mjs";
import { sanitizeLog } from "../lib/scrapeSchedule.mjs";

const sql = connectScrapeStore(process.env.DATABASE_URL);
let locked = false;
try {
  const lock = await acquireCoordinator(sql);
  if (!lock.acquired) throw new Error("A scraper is running; initialize state between runs");
  locked = true;
  const schema = await fs.readFile(new URL("../ops/wildrift-worker/schema.sql", import.meta.url), "utf8");
  await sql.begin(tx => tx.unsafe(schema));
  console.log("Scrape coordination tables ready; existing history and credentials preserved.");
} catch (error) {
  console.error(sanitizeLog(error.message));
  process.exitCode = 1;
} finally {
  if (locked) await releaseCoordinator(sql).catch(() => {});
  await sql.end({ timeout: 5 });
}
