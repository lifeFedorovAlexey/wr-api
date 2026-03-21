import { eq } from "drizzle-orm";

import { db } from "../db/client.js";
import { championGuides } from "../db/schema.js";
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
    const rows = await db
      .select({
        payload: championGuides.payload,
      })
      .from(championGuides)
      .where(eq(championGuides.slug, slug))
      .limit(1);

    if (!rows.length || !rows[0]?.payload) {
      setNoStore(res);
      return res.status(404).json({ error: "Not Found" });
    }

    setPublicCache(res, { sMaxAge: 3600, swr: 21600 });
    return res.status(200).json(rows[0].payload);
  } catch (error) {
    console.error("[wr-api] /api/guides/:slug error:", error);
    setNoStore(res);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}
