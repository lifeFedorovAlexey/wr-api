// lib/updateChampions.mjs
// Общая функция обновления чемпионов в БД:
//  - используется локально из CLI
//  - и из крон-задачи (Github/Vercel)

import "dotenv/config";
import { db } from "../db/client.js";
import { champions } from "../db/schema.js";
import { getChampions } from "../scrapers/getChampions.mjs";

export async function updateChampions() {
  console.log("[updateChampions] loading champions from scrapers...");
  const items = await getChampions();
  console.log(`[updateChampions] got ${items.length} champions`);

  for (const c of items) {
    const names = c.names || {};

    // базовое имя — просто чтобы было какое-то одно поле name
    const baseName = names.ru_ru || names.en_us || names.zh_cn || null;

    await db
      .insert(champions)
      .values({
        slug: c.slug,
        cnHeroId: c.cnHeroId || null,

        // полный словарь имён, как вернул скрапер
        nameLocalizations: names,
        name: baseName,

        // ключи ролей
        roles: c.roles || [],

        // локализованные роли
        rolesLocalizations: c.rolesLocalized || null,

        // ключ сложности
        difficulty: c.difficulty || null,

        // локализованная сложность
        difficultyLocalizations: c.difficultyLocalized || null,

        icon: c.icon || null,
      })
      .onConflictDoUpdate({
        target: champions.slug,
        set: {
          cnHeroId: c.cnHeroId || null,

          nameLocalizations: names,
          name: baseName,

          roles: c.roles || [],

          rolesLocalizations: c.rolesLocalized || null,

          difficulty: c.difficulty || null,
          difficultyLocalizations: c.difficultyLocalized || null,

          icon: c.icon || null,
        },
      });
  }

  console.log("[updateChampions] done");
}
