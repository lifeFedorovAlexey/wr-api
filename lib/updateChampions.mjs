// lib/updateChampions.mjs
import { inArray, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import {
  championStatsHistory,
  champions,
  riftggCnBuilds,
  riftggCnMatchups,
} from "../db/schema.js";
import { classifyChampionSlugMigrations } from "./championSlugMigration.mjs";
import { runChampionCatalogScrape } from "../scrapers/getChampions.mjs";

const REQUIRED_NAME_LOCALES = ["en_us", "zh_cn"];
const SOFT_NAME_LOCALES = ["ru_ru"];

/**
 * Проверяем чемпиона на заполненность полей.
 * Возвращаем массив строк с названиями проблемных полей.
 */
function validateChampion(champion) {
  const missing = [];
  const warnings = [];
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

  for (const loc of SOFT_NAME_LOCALES) {
    const v = names[loc];
    if (!v || String(v).trim() === "") {
      warnings.push(`names.${loc}`);
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

  return {
    missing,
    warnings,
  };
}

export async function updateChampions() {
  console.log("[updateChampions] loading champions from scrapers...");
  const scrapeReport = await runChampionCatalogScrape();
  const items = scrapeReport.champions;
  console.log(`[updateChampions] got ${items.length} champions`);
  const scrapedSlugs = new Set();
  const existingRowsBefore = await db
    .select({ slug: champions.slug })
    .from(champions);
  const existingSlugSet = new Set(
    existingRowsBefore.map((row) => String(row?.slug || "").trim()).filter(Boolean),
  );
  let created = 0;
  let updated = 0;

  /** @type {Array<{ slug: string, missing: string[] }>} */
  const problems = [];
  /** @type {Array<{ slug: string, warnings: string[] }>} */
  const softWarnings = [];

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

    const baseName = ru || en || zh || null;

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
    const validation = validateChampion({
      ...c,
      names: nameLocalizations,
      rolesLocalized: rolesLocalizations,
      difficultyLocalized: difficultyLocalizations,
    });

    if (validation.missing.length > 0) {
      problems.push({
        slug: c.slug || "(no-slug)",
        missing: validation.missing,
      });
    }

    if (validation.warnings.length > 0) {
      softWarnings.push({
        slug: c.slug || "(no-slug)",
        warnings: validation.warnings,
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

    if (existingSlugSet.has(c.slug)) {
      updated += 1;
    } else {
      created += 1;
    }

    await db.insert(champions).values(rowToInsert).onConflictDoUpdate({
      target: champions.slug,
      set: rowToInsert,
    });
  }

  const existingSlugs = existingRowsBefore
    .map((row) => String(row?.slug || "").trim())
    .filter(Boolean);
  const { aliasMigrations, staleSlugs } = classifyChampionSlugMigrations(
    existingSlugs,
    Array.from(scrapedSlugs),
  );

  if (aliasMigrations.length) {
    console.warn(
      `[updateChampions] migrating legacy champion slugs to canonical Riot slugs: ${aliasMigrations.map(({ from, to }) => `${from}->${to}`).join(", ")}`,
    );
  }

  if (aliasMigrations.length || staleSlugs.length) {
    await db.transaction(async (tx) => {
      for (const { from, to } of aliasMigrations) {
        await tx.execute(sql`
          insert into champion_stats_history
            (date, slug, cn_hero_id, rank, lane, position, win_rate, pick_rate, ban_rate, strength_level, created_at)
          select
            date,
            ${to},
            cn_hero_id,
            rank,
            lane,
            position,
            win_rate,
            pick_rate,
            ban_rate,
            strength_level,
            created_at
          from champion_stats_history
          where slug = ${from}
          on conflict (date, slug, rank, lane) do nothing
        `);

        await tx.execute(sql`
          insert into riftgg_cn_matchups
            (champion_slug, rank, lane, data_date, opponent_slug, win_rate, pick_rate, win_rate_rank, pick_rate_rank, raw_payload, updated_at)
          select
            ${to},
            rank,
            lane,
            data_date,
            opponent_slug,
            win_rate,
            pick_rate,
            win_rate_rank,
            pick_rate_rank,
            raw_payload,
            updated_at
          from riftgg_cn_matchups
          where champion_slug = ${from}
          on conflict (champion_slug, rank, lane, data_date, opponent_slug) do nothing
        `);

        await tx.execute(sql`
          insert into riftgg_cn_builds
            (champion_slug, rank, lane, data_date, build_type, build_key, entry_slugs, win_rate, pick_rate, win_rate_rank, pick_rate_rank, raw_payload, updated_at)
          select
            ${to},
            rank,
            lane,
            data_date,
            build_type,
            build_key,
            entry_slugs,
            win_rate,
            pick_rate,
            win_rate_rank,
            pick_rate_rank,
            raw_payload,
            updated_at
          from riftgg_cn_builds
          where champion_slug = ${from}
          on conflict (champion_slug, rank, lane, data_date, build_type, build_key) do nothing
        `);

        await tx
          .delete(championStatsHistory)
          .where(inArray(championStatsHistory.slug, [from]));

        await tx
          .delete(riftggCnMatchups)
          .where(inArray(riftggCnMatchups.championSlug, [from]));

        await tx
          .delete(riftggCnBuilds)
          .where(inArray(riftggCnBuilds.championSlug, [from]));

        await tx
          .delete(champions)
          .where(inArray(champions.slug, [from]));
      }

      if (staleSlugs.length) {
        console.warn(
          `[updateChampions] removing stale champions not present on Riot page: ${staleSlugs.join(", ")}`,
        );

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
      }
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

  if (softWarnings.length > 0) {
    console.warn(
      `[updateChampions][WARN] У Riot-каталога есть чемпионы без ru_ru, временно используем en_us: ${softWarnings.length}`,
    );
    for (const warning of softWarnings) {
      console.warn(
        `  - ${warning.slug}: ждём ru_ru -> ${warning.warnings.join(", ")}`,
      );
    }
  }

  const report = {
    total: items.length,
    created,
    updated,
    migratedAliases: aliasMigrations.length,
    removed: staleSlugs.length,
    hardValidationWarnings: problems.length,
    softValidationWarnings: softWarnings.length,
    scrape: scrapeReport.steps,
    aliasMigrations,
    staleSlugs,
  };

  console.log(
    `[updateChampions] summary -> total=${report.total} created=${report.created} updated=${report.updated} migratedAliases=${report.migratedAliases} removed=${report.removed} hardWarnings=${report.hardValidationWarnings} softWarnings=${report.softValidationWarnings}`,
  );

  return report;
}
