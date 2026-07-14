import { and, eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { assistantResponses, championLore, championStatsHistory, champions } from "../db/schema.js";
import { getLatestCompletedChampionStatsSnapshot } from "../lib/statsSnapshots.mjs";
import { ensureAuthorized } from "./utils/adminAuth.js";
import { setCors } from "./utils/cors.js";

const auth = {
  tokenEnvNames: ["GUIDES_SYNC_SECRET"],
  secretHeader: "x-guides-sync-secret",
  secretEnvNames: ["GUIDES_SYNC_SECRET"],
};
const allowedRanks = new Set(["overall", "diamondPlus", "masterPlus", "king", "peak"]);
const allowedLanes = new Set(["mid", "top", "adc", "support", "jungle"]);

export default async function handler(req, res) {
  setCors(req, res);
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") return res.status(204).end();
  const pathname = new URL(req.url, "http://localhost").pathname;

  try {
    if (pathname.endsWith("/tasks")) {
      if (req.method !== "GET") return res.status(405).json({ error: "Method Not Allowed" });
      if (!ensureAuthorized(req, res, auth)) return;
      const snapshot = await getLatestCompletedChampionStatsSnapshot();
      if (!snapshot) return res.status(409).json({ error: "No completed stats snapshot" });
      const [stats, lore, names] = await Promise.all([
        db.select().from(championStatsHistory).where(eq(championStatsHistory.snapshotId, snapshot.id)),
        db.select().from(championLore).where(eq(championLore.locale, "ru_ru")),
        db.select({ slug: champions.slug, name: champions.nameLocalizations }).from(champions),
      ]);
      const loreMap = new Map(lore.map((row) => [row.championSlug, row]));
      const nameMap = new Map(names.map((row) => [row.slug, row.name?.ru_ru || row.slug]));
      const grouped = new Map();
      for (const row of stats) {
        if (!allowedRanks.has(row.rank) || !allowedLanes.has(row.lane) || !loreMap.has(row.slug)) continue;
        const key = `${row.slug}|${row.lane}`;
        if (!grouped.has(key)) grouped.set(key, { championSlug: row.slug, championName: nameMap.get(row.slug), lane: row.lane, lore: loreMap.get(row.slug), statsByRank: {} });
        grouped.get(key).statsByRank[row.rank] = { position: row.position, winRate: row.winRate, pickRate: row.pickRate, banRate: row.banRate, strengthLevel: row.strengthLevel };
      }
      return res.status(200).json({ snapshotId: snapshot.id, statsDate: snapshot.statsDate, tasks: [...grouped.values()] });
    }

    if (pathname.endsWith("/sync")) {
      if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });
      if (!ensureAuthorized(req, res, auth)) return;
      const items = Array.isArray(req.body?.items) ? req.body.items : [];
      if (!items.length || items.length > 1000) return res.status(400).json({ error: "Invalid items" });
      for (const item of items) {
        if (!item.championSlug || !allowedLanes.has(item.lane) || !allowedRanks.has(item.rank) || !String(item.response || "").trim()) continue;
        await db.insert(assistantResponses).values({ ...item, response: String(item.response).trim(), generatedAt: new Date(), updatedAt: new Date() }).onConflictDoUpdate({
          target: [assistantResponses.championSlug, assistantResponses.lane, assistantResponses.rank],
          set: { response: String(item.response).trim(), statsSnapshotId: item.statsSnapshotId, loreContentHash: item.loreContentHash, model: item.model, generatedAt: new Date(), updatedAt: new Date() },
        });
      }
      return res.status(200).json({ accepted: items.length });
    }

    if (req.method !== "GET") return res.status(405).json({ error: "Method Not Allowed" });
    const { champion, lane, rank } = req.query;
    if (!champion || !allowedLanes.has(lane) || !allowedRanks.has(rank)) return res.status(400).json({ error: "Invalid query" });
    const rows = await db.select().from(assistantResponses).where(and(eq(assistantResponses.championSlug, champion), eq(assistantResponses.lane, lane), eq(assistantResponses.rank, rank))).limit(1);
    return rows[0] ? res.status(200).json(rows[0]) : res.status(404).json({ error: "Response not generated" });
  } catch (error) {
    console.error("[assistant-responses]", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}
