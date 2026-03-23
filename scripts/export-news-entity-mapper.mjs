import fs from "fs";
import path from "path";
import "dotenv/config";

import { buildNewsEntityMapper } from "../lib/newsEntityMapper.mjs";

const outPath = path.join(process.cwd(), "data", "news-entity-mapper.json");

let dbSchema = null;
let dbClient = null;

if (process.env.DATABASE_URL) {
  try {
    const [{ db }, schema] = await Promise.all([
      import("../db/client.js"),
      import("../db/schema.js"),
    ]);
    dbClient = db;
    dbSchema = schema;
  } catch (error) {
    console.warn(
      "[news-entity-mapper] DB source unavailable, exporting champions/abilities only:",
      error?.message || error,
    );
  }
}

const mapper = await buildNewsEntityMapper({
  rootDir: path.resolve(process.cwd(), ".."),
  dbSchema,
  dbClient,
});

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(mapper, null, 2), "utf8");

console.log(
  `[news-entity-mapper] exported ${outPath} champions=${mapper.counts.champions} abilities=${mapper.counts.abilities} items=${mapper.counts.items}`,
);
