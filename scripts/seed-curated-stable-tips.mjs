import "dotenv/config";
import { createHash } from "node:crypto";
import { db, client } from "../db/client.js";
import { championStableTips } from "../db/schema.js";

const curatedTips = [
  {
    championSlug: "rengar",
    lane: "jungle",
    tipText: "Применяй «Боевой рык» после полученного урона: восстановление здоровья зависит от урона за последние несколько секунд.",
    sourceLabel: "БОЕВОЙ РЫК",
    evidenceText: "Ренгар наносит урон врагам поблизости и восстанавливает себе здоровье на величину, зависящую от того, сколько урона он получил за последние несколько секунд. Свирепость: Ренгар наносит еще больше урона и снимает с себя все эффекты контроля.",
  },
  {
    championSlug: "rengar",
    lane: "jungle",
    tipText: "Попадай «Броском боласа», чтобы замедлить и раскрыть цель; усиленный болас обездвиживает её.",
    sourceLabel: "БРОСОК БОЛАСА",
    evidenceText: "Ренгар бросает болас, нанося физический урон пораженной цели и замедляя ее. Болас также раскрывает цель и дает Ренгару обзор окружающей ее области. Свирепость: Ренгар наносит еще больше урона и обездвиживает цель.",
  },
  {
    championSlug: "rengar",
    lane: "jungle",
    tipText: "Используй «Охотничий азарт», чтобы раскрыть ближайшего вражеского чемпиона и подойти к нему под маскировкой.",
    sourceLabel: "ОХОТНИЧИЙ АЗАРТ",
    evidenceText: "Ренгар увеличивает свою скорость передвижения и на некоторое время раскрывает ближайшего вражеского чемпиона. Через несколько секунд Ренгар маскируется, а его следующая атака временно уменьшает броню цели.",
  },
];

const sourceUrl = "https://wildrift.leagueoflegends.com/ru-ru/champions/rengar/";

for (const tip of curatedTips) {
  const record = {
    ...tip,
    sourceKind: "riot-wild-rift-champion-page-curated",
    sourceUrl,
    patchDependent: false,
    reviewStatus: "approved",
  };
  record.contentHash = createHash("sha256").update(JSON.stringify(record)).digest("hex");
  await db.insert(championStableTips).values(record).onConflictDoUpdate({
    target: [championStableTips.championSlug, championStableTips.contentHash],
    set: { reviewStatus: "approved", updatedAt: new Date() },
  });
}

await client.end({ timeout: 5 });
console.log(`[stable-tips] seeded ${curatedTips.length} curated tips`);
