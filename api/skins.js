import { asc } from "drizzle-orm";

import { db } from "../db/client.js";
import { skinCollections, skinEntries } from "../db/schema.js";
import { assembleSkinCollection } from "../lib/skins.mjs";
import { setCors } from "./utils/cors.js";

function setPublicCache(res, { sMaxAge = 3600, swr = 21600 } = {}) {
  res.setHeader(
    "Cache-Control",
    `public, s-maxage=${sMaxAge}, stale-while-revalidate=${swr}`,
  );
}

function setNoStore(res) {
  res.setHeader("Cache-Control", "no-store");
}

export default async function handler(req, res) {
  setCors(req, res);

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") {
    setNoStore(res);
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const [collectionRows, entryRows] = await Promise.all([
      db.select().from(skinCollections).orderBy(asc(skinCollections.championSlug)),
      db
        .select()
        .from(skinEntries)
        .orderBy(asc(skinEntries.championSlug), asc(skinEntries.sortOrder)),
    ]);

    const rowsByChampion = new Map();
    for (const row of entryRows) {
      const current = rowsByChampion.get(row.championSlug) || [];
      current.push(row);
      rowsByChampion.set(row.championSlug, current);
    }

    const items = collectionRows.map((collection) =>
      assembleSkinCollection(collection, rowsByChampion.get(collection.championSlug) || []),
    );

    setPublicCache(res, { sMaxAge: 3600, swr: 21600 });
    return res.status(200).json({
      count: items.length,
      items,
    });
  } catch (error) {
    console.error("[wr-api] /api/skins error:", error);
    setNoStore(res);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}
