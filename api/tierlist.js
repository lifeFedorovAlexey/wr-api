// api/tierlist.js
import { db } from "../db/client.js";
import { championStatsHistory, champions } from "../db/schema.js";

// Простейший нормалайзер дат: Date -> 'YYYY-MM-DD'
function toDateString(value) {
  if (!value) return null;

  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }

  const str = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;

  const d = new Date(str);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

// маппинг strengthLevel -> тир
function strengthToTier(level) {
  if (level == null) return "C"; // по умолчанию серединка

  switch (level) {
    case 5:
      return "S+";
    case 4:
      return "S";
    case 3:
      return "A";
    case 2:
      return "B";
    case 1:
      return "C";
    case 0:
    default:
      return "D";
  }
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

  // rank и lane — фильтры для тирлиста
  const { rank, lane, lang } = req.query;

  const rankKey =
    typeof rank === "string" && rank.trim() ? rank.trim() : "diamondPlus";
  const laneKey = typeof lane === "string" && lane.trim() ? lane.trim() : "top";

  const language =
    typeof lang === "string" && lang.trim() ? lang.trim() : "ru_ru";

  try {
    // 1) Забираем всю историю и всех чемпионов
    const [historyRows, championsRows] = await Promise.all([
      db.select().from(championStatsHistory),
      db.select().from(champions),
    ]);

    // 2) Мап по slug -> champion
    const champBySlug = {};
    for (const ch of championsRows) {
      if (!ch || !ch.slug) continue;
      champBySlug[ch.slug] = ch;
    }

    // 3) Фильтруем по rank+lane
    const filtered = historyRows.filter((row) => {
      if (!row) return false;
      if (row.rank !== rankKey) return false;
      if (row.lane !== laneKey) return false;
      return true;
    });

    if (!filtered.length) {
      return res.status(200).json({
        filters: {
          rank: rankKey,
          lane: laneKey,
          date: null,
          lang: language,
        },
        tiersOrder: ["S+", "S", "A", "B", "C", "D"],
        tiers: {
          "S+": [],
          S: [],
          A: [],
          B: [],
          C: [],
          D: [],
        },
      });
    }

    // 4) Находим последнюю дату для этого rank+lane
    let latestDate = null;
    for (const row of filtered) {
      const d = toDateString(row.date);
      if (!d) continue;
      if (!latestDate || d > latestDate) {
        latestDate = d;
      }
    }

    // 5) Оставляем только последнюю дату
    const latestRows = filtered.filter((row) => {
      const d = toDateString(row.date);
      return d && d === latestDate;
    });

    // 6) Собираем тирлист по strengthLevel
    const tiersOrder = ["S+", "S", "A", "B", "C", "D"];
    const tiers = {
      "S+": [],
      S: [],
      A: [],
      B: [],
      C: [],
      D: [],
    };

    for (const row of latestRows) {
      const slug = row.slug;
      if (!slug) continue;

      const tier = strengthToTier(row.strengthLevel);

      const ch = champBySlug[slug];

      // локализованное имя
      let displayName = slug;
      if (ch) {
        const nameLoc = ch.nameLocalizations || {};
        const byLang = nameLoc[language];
        const en = nameLoc.en_us;
        const baseName = ch.name;
        displayName = byLang || en || baseName || slug;
      }

      const icon = ch?.icon || null;

      tiers[tier].push({
        slug,
        cnHeroId: row.cnHeroId,
        name: displayName,
        icon,
        rank: row.rank,
        lane: row.lane,
        date: latestDate,
        position: row.position,
        winRate: row.winRate,
        pickRate: row.pickRate,
        banRate: row.banRate,
        strengthLevel: row.strengthLevel,
      });
    }

    // 7) Внутри каждого тира отсортируем по winRate desc, потом по pickRate desc
    for (const key of tiersOrder) {
      tiers[key].sort((a, b) => {
        const aw = a.winRate ?? 0;
        const bw = b.winRate ?? 0;
        if (bw !== aw) return bw - aw;

        const ap = a.pickRate ?? 0;
        const bp = b.pickRate ?? 0;
        return bp - ap;
      });
    }

    return res.status(200).json({
      filters: {
        rank: rankKey,
        lane: laneKey,
        date: latestDate,
        lang: language,
      },
      tiersOrder,
      tiers,
    });
  } catch (e) {
    console.error("[wr-api] /api/tierlist error:", e);
    return res
      .status(500)
      .json({ error: "Internal Server Error", message: e.message });
  }
}
