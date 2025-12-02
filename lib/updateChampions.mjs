// lib/updateChampions.mjs
import { db } from "../db/client.js";
import { champions } from "../db/schema.js";
import { getChampions } from "../scrapers/getChampions.mjs";

// Одна общая функция, которую будем вызывать:
//  - из CLI-скрипта (локально)
//  - из cron-функции (на Vercel)
export async function updateChampions() {
  console.log("[updateChampions] loading champions from scrapers...");
  const items = await getChampions();
  console.log(`[updateChampions] got ${items.length} champions`);

  for (const c of items) {
    const names = c.names || {};

    const zh = names.zh_cn || null;
    const en = names.en_us || null;
    // Временно фолбэк для ru_ru, чтобы /api?lang=ru_ru не давал пусто
    const ru = names.ru_ru || zh || en || null;

    const nameLocalizations = {
      ru_ru: ru,
      en_us: en,
      zh_cn: zh,
    };

    const baseName = zh || ru || en || null;

    await db
      .insert(champions)
      .values({
        slug: c.slug,
        cnHeroId: c.cnHeroId || null,
        nameLocalizations,
        name: baseName,
        roles: c.roles || [],
        difficulty: c.difficulty || null,
        icon: c.icon || null,
      })
      .onConflictDoUpdate({
        target: champions.slug,
        set: {
          cnHeroId: c.cnHeroId || null,
          nameLocalizations,
          name: baseName,
          roles: c.roles || [],
          difficulty: c.difficulty || null,
          icon: c.icon || null,
        },
      });
  }

  console.log("[updateChampions] done");
}
