// api/champions.js
import { db } from "../db/client.js";
import { champions } from "../db/schema.js";

export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") {
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

        // уже локализованное имя по ?lang=
        name: localizedName,

        // полный словарь имён
        nameLocalizations,

        // ключи ролей (для фильтров / логики)
        roles: ch.roles || [],

        // локализованные роли под текущий lang
        rolesLocalized: localizedRoles,

        // ключ сложности
        difficulty: ch.difficulty || null,

        // локализованная сложность
        difficultyLocalized: localizedDifficulty,

        icon: ch.icon || null,

        ids: {
          slug: ch.slug,
          cnHeroId: ch.cnHeroId || null,
        },
      };
    });

    return res.status(200).json(data);
  } catch (e) {
    console.error("[wr-api] /api/champions error:", e);
    return res
      .status(500)
      .json({ error: "Internal Server Error", message: e.message });
  }
}
