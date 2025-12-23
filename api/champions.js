// api/champions.js
import { db } from "../db/client.js";
import { champions } from "../db/schema.js";
import { setCors } from "./utils/cors.js";

function setPublicCache(res, { sMaxAge = 3600, swr = 21600 } = {}) {
  // Общий CDN-кеш (Vercel). Ключ кеша = полный URL (path + query).
  res.setHeader(
    "Cache-Control",
    `public, s-maxage=${sMaxAge}, stale-while-revalidate=${swr}`
  );
}

function setNoStore(res) {
  // Ошибки/валидацию лучше не кешировать.
  res.setHeader("Cache-Control", "no-store");
}

export default async function handler(req, res) {
  // CORS через util
  setCors(req, res);

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") {
    setNoStore(res);
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const lang = req.query.lang || "ru_ru";

  try {
    const rows = await db.select().from(champions);

    const data = rows.map((ch) => {
      const nameLocalizations = ch.nameLocalizations || {};
      const rolesLocalizations = ch.rolesLocalizations || {};
      const difficultyLocalizations = ch.difficultyLocalizations || {};

      const localizedName =
        nameLocalizations[lang] ?? nameLocalizations.en_us ?? null;

      const localizedRoles =
        rolesLocalizations[lang] ?? rolesLocalizations.en_us ?? [];

      const localizedDifficulty =
        difficultyLocalizations[lang] ?? difficultyLocalizations.en_us ?? null;

      return {
        slug: ch.slug,
        name: localizedName,
        nameLocalizations,
        roles: ch.roles || [],
        rolesLocalized: localizedRoles,
        difficulty: ch.difficulty || null,
        difficultyLocalized: localizedDifficulty,
        icon: ch.icon || null,
        ids: {
          slug: ch.slug,
          cnHeroId: ch.cnHeroId || null,
        },
      };
    });

    setPublicCache(res, { sMaxAge: 3600, swr: 21600 });
    return res.status(200).json(data);
  } catch (e) {
    console.error("[wr-api] /api/champions error:", e);
    setNoStore(res);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}
