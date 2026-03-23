import { asc, eq } from "drizzle-orm";

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

  const slug = String(req.params?.slug || "").trim();
  if (!slug) {
    setNoStore(res);
    return res.status(400).json({ error: "Missing slug" });
  }

  try {
    const collectionRows = await db
      .select()
      .from(skinCollections)
      .where(eq(skinCollections.championSlug, slug))
      .limit(1);

    if (!collectionRows.length) {
      setNoStore(res);
      return res.status(404).json({ error: "Not Found" });
    }

    const rows = await db
      .select()
      .from(skinEntries)
      .where(eq(skinEntries.championSlug, slug))
      .orderBy(asc(skinEntries.sortOrder));

    setPublicCache(res, { sMaxAge: 3600, swr: 21600 });
    return res.status(200).json(assembleSkinCollection(collectionRows[0], rows));
  } catch (error) {
    console.error("[wr-api] /api/skins/:slug error:", error);
    setNoStore(res);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}
