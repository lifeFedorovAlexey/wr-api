// api/champions.js
import { db } from "../db/client.js";
import { champions } from "../db/schema.js";
import { setCors } from "./utils/cors.js";
import { buildPublicIconPath } from "../lib/championIcons.mjs";
import { resolveChampionLocalizedName } from "../lib/championLocalization.mjs";
import { filterChampionsForPublicPool } from "../lib/championPublicPool.mjs";

function setPublicCache(res, { sMaxAge = 3600, swr = 21600 } = {}) {
  // Общий CDN-кеш. Ключ кеша = полный URL (path + query).
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
  const fields = typeof req.query.fields === "string" ? req.query.fields.trim() : "";

  try {
    if (fields === "names" || fields === "index") {
      const rows = await db
        .select({
          slug: champions.slug,
          name: champions.name,
          nameLocalizations: champions.nameLocalizations,
          roles: champions.roles,
          icon: champions.icon,
        })
        .from(champions);

      const data = filterChampionsForPublicPool(rows).map((ch) => {
        const item = {
          slug: ch.slug,
          name: resolveChampionLocalizedName({
            slug: ch.slug,
            lang,
            nameLocalizations: ch.nameLocalizations || {},
            fallbackName: ch.name,
          }),
        };

        if (fields === "index") {
          return {
            ...item,
            roles: Array.isArray(ch.roles) ? ch.roles : [],
            iconUrl: ch.icon ? buildPublicIconPath(ch.slug, ch.icon) : null,
          };
        }

        return {
          ...item,
        };
      });

      setPublicCache(res, { sMaxAge: 3600, swr: 21600 });
      return res.status(200).json(data);
    }

    const rows = await db
      .select({
        slug: champions.slug,
        cnHeroId: champions.cnHeroId,
        name: champions.name,
        nameLocalizations: champions.nameLocalizations,
        roles: champions.roles,
        rolesLocalizations: champions.rolesLocalizations,
        difficulty: champions.difficulty,
        difficultyLocalizations: champions.difficultyLocalizations,
        icon: champions.icon,
      })
      .from(champions);

    const data = filterChampionsForPublicPool(rows).map((ch) => {
      const nameLocalizations = ch.nameLocalizations || {};
      const rolesLocalizations = ch.rolesLocalizations || {};
      const difficultyLocalizations = ch.difficultyLocalizations || {};

      const localizedName =
        resolveChampionLocalizedName({
          slug: ch.slug,
          lang,
          nameLocalizations,
          fallbackName: ch.name,
        });

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
        icon: ch.icon ? buildPublicIconPath(ch.slug, ch.icon) : null,
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
