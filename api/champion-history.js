// api/champion-history.js
import { db } from "../db/client.js";
import { championStatsHistory } from "../db/schema.js";

// Простейший нормалайзер дат: Date -> 'YYYY-MM-DD'
function toDateString(value) {
  if (!value) return null;

  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }

  // если пришла строка из БД/Drizzle
  const str = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;

  // попытка привести к Date
  const d = new Date(str);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const { slug, rank, lane, date, from, to } = req.query;

  try {
    // Берём всё из таблицы истории
    const rows = await db.select().from(championStatsHistory);

    // Подготовим фильтры
    const rankList =
      typeof rank === "string" && rank.trim()
        ? rank.split(",").map((v) => v.trim())
        : null;

    const laneList =
      typeof lane === "string" && lane.trim()
        ? lane.split(",").map((v) => v.trim())
        : null;

    let fromDate = null;
    let toDate = null;

    if (typeof date === "string" && date.trim()) {
      fromDate = date.trim();
      toDate = date.trim();
    } else {
      if (typeof from === "string" && from.trim()) {
        fromDate = from.trim();
      }
      if (typeof to === "string" && to.trim()) {
        toDate = to.trim();
      }
    }

    const filtered = rows.filter((row) => {
      const rowDate = toDateString(row.date);

      if (slug && row.slug !== slug) return false;

      if (rankList && rankList.length > 0 && !rankList.includes(row.rank)) {
        return false;
      }

      if (laneList && laneList.length > 0 && !laneList.includes(row.lane)) {
        return false;
      }

      if (fromDate && rowDate && rowDate < fromDate) return false;
      if (toDate && rowDate && rowDate > toDate) return false;

      return true;
    });

    // Можно отсортировать: по дате, потом по slug, rank, lane
    filtered.sort((a, b) => {
      const da = toDateString(a.date) || "";
      const dbb = toDateString(b.date) || "";

      if (da !== dbb) return da.localeCompare(dbb);
      if (a.slug !== b.slug) return a.slug.localeCompare(b.slug);
      if (a.rank !== b.rank) return a.rank.localeCompare(b.rank);
      if (a.lane !== b.lane) return a.lane.localeCompare(b.lane);
      return 0;
    });

    const items = filtered.map((row) => ({
      date: toDateString(row.date),
      slug: row.slug,
      cnHeroId: row.cnHeroId,
      rank: row.rank,
      lane: row.lane,
      position: row.position,
      winRate: row.winRate,
      pickRate: row.pickRate,
      banRate: row.banRate,
      strengthLevel: row.strengthLevel,
    }));

    return res.status(200).json({
      filters: {
        slug: slug || null,
        rank: rankList,
        lane: laneList,
        from: fromDate,
        to: toDate || (fromDate && !toDate ? fromDate : toDate),
      },
      count: items.length,
      items,
    });
  } catch (e) {
    console.error("[wr-api] /api/champion-history error:", e);
    return res
      .status(500)
      .json({ error: "Internal Server Error", message: e.message });
  }
}
