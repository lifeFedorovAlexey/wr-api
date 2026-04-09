// lib/updateChampions.mjs
import { inArray } from "drizzle-orm";
import { db } from "../db/client.js";
import {
  championStatsHistory,
  champions,
  riftggCnBuilds,
  riftggCnMatchups,
} from "../db/schema.js";
import { getChampions } from "../scrapers/getChampions.mjs";

const REQUIRED_NAME_LOCALES = ["ru_ru", "en_us", "zh_cn"];

/**
 * Проверяем чемпиона на заполненность полей.
 * Возвращаем массив строк с названиями проблемных полей.
 */
function validateChampion(champion) {
  const missing = [];
  const c = champion ?? {};
  const names = c.names ?? {};
  const rolesLocalized = c.rolesLocalized ?? {};
  const diffLocalized = c.difficultyLocalized ?? {};

  // slug
  if (!c.slug || String(c.slug).trim() === "") {
    missing.push("slug");
  }

  // cnHeroId
  if (!c.cnHeroId || String(c.cnHeroId).trim() === "") {
    missing.push("cnHeroId");
  }

  // names.*
  for (const loc of REQUIRED_NAME_LOCALES) {
    const v = names[loc];
    if (!v || String(v).trim() === "") {
      missing.push(`names.${loc}`);
    }
  }

  // roles
  if (!Array.isArray(c.roles) || c.roles.length === 0) {
    missing.push("roles");
  }

  // difficulty
  if (!c.difficulty || String(c.difficulty).trim() === "") {
    missing.push("difficulty");
  }

  // icon
  if (!c.icon || String(c.icon).trim() === "") {
    missing.push("icon");
  }

  // rolesLocalized.* (хотя бы по одной роли в каждой локали)
  for (const loc of REQUIRED_NAME_LOCALES) {
    const arr = rolesLocalized[loc];
    if (!Array.isArray(arr) || arr.length === 0) {
      missing.push(`rolesLocalized.${loc}`);
    }
  }

  // difficultyLocalized.*
  for (const loc of REQUIRED_NAME_LOCALES) {
    const v = diffLocalized[loc];
    if (!v || String(v).trim() === "") {
      missing.push(`difficultyLocalized.${loc}`);
    }
  }

  return missing;
}

export async function updateChampions() {
  console.log("[updateChampions] loading champions from scrapers...");
  const items = await getChampions();
  console.log(`[updateChampions] got ${items.length} champions`);
  const scrapedSlugs = new Set();

  /** @type {Array<{ slug: string, missing: string[] }>} */
  const problems = [];

  for (const c of items) {
    if (c?.slug) {
      scrapedSlugs.add(c.slug);
    }

    const names = c.names || {};
    const zh = names.zh_cn || null;
    const en = names.en_us || null;
    const ru = names.ru_ru || null;

    const nameLocalizations = {
      ru_ru: ru,
      en_us: en,
      zh_cn: zh,
    };

    const baseName = zh || ru || en || null;

    const rolesLocalizations = c.rolesLocalized || {
      ru_ru: [],
      en_us: [],
      zh_cn: [],
    };

    const difficultyLocalizations = c.difficultyLocalized || {
      ru_ru: null,
      en_us: null,
      zh_cn: null,
    };

    // Валидация
    const missing = validateChampion({
      ...c,
      names: nameLocalizations,
      rolesLocalized: rolesLocalizations,
      difficultyLocalized: difficultyLocalizations,
    });

    if (missing.length > 0) {
      problems.push({
        slug: c.slug || "(no-slug)",
        missing,
      });
    }

    const rowToInsert = {
      slug: c.slug,
      cnHeroId: c.cnHeroId || null,
      nameLocalizations,
      name: baseName,
      roles: c.roles || [],
      difficulty: c.difficulty || null,
      icon: c.icon || null,
      rolesLocalizations,
      difficultyLocalizations,
    };

    await db.insert(champions).values(rowToInsert).onConflictDoUpdate({
      target: champions.slug,
      set: rowToInsert,
    });
  }

  const existingRows = await db
    .select({ slug: champions.slug })
    .from(champions);
  const staleSlugs = existingRows
    .map((row) => String(row?.slug || "").trim())
    .filter((slug) => slug && !scrapedSlugs.has(slug));

  if (staleSlugs.length) {
    console.warn(
      `[updateChampions] removing stale champions not present on Riot page: ${staleSlugs.join(", ")}`,
    );

    await db.transaction(async (tx) => {
      await tx
        .delete(championStatsHistory)
        .where(inArray(championStatsHistory.slug, staleSlugs));

      await tx
        .delete(riftggCnMatchups)
        .where(inArray(riftggCnMatchups.championSlug, staleSlugs));

      await tx
        .delete(riftggCnBuilds)
        .where(inArray(riftggCnBuilds.championSlug, staleSlugs));

      await tx
        .delete(champions)
        .where(inArray(champions.slug, staleSlugs));
    });
  }

  console.log("[updateChampions] done");

  if (problems.length > 0) {
    console.warn(
      `[updateChampions][WARN] Найдено чемпионов с неполными данными: ${problems.length}`
    );
    for (const p of problems) {
      console.warn(
        `  - ${p.slug}: отсутствуют поля -> ${p.missing.join(", ")}`
      );
    }
  } else {
    console.log(
      "[updateChampions] Все чемпионы имеют заполненные ключевые поля"
    );
  }
}
