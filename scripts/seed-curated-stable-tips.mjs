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
  {
    championSlug: "brand",
    lane: null,
    tipText: "Сначала наложи «Поджог», а затем попади «Выгоранием», чтобы ненадолго оглушить цель.",
    sourceLabel: "ВЫГОРАНИЕ",
    evidenceText: "Выпускает снаряд, который взрывается при столкновении с первым врагом на пути, нанося урон и добавляя заряд Поджога. Цель, которая ранее получила урон от пассивного умения Брэнда, ненадолго оглушается.",
    sourceUrl: "https://wildrift.leagueoflegends.com/ru-ru/champions/brand/",
  },
  {
    championSlug: "brand",
    lane: null,
    tipText: "Применяй «Воспламенение» к уже горящей цели, чтобы вдвое увеличить дальность распространения пламени.",
    sourceLabel: "ВОСПЛАМЕНЕНИЕ",
    evidenceText: "Брэнд воспламеняет цель, после чего пламя распространяется на ближайших врагов, нанося магический урон. Если цель в огне, дальность распространения Воспламенения увеличивается вдвое.",
    sourceUrl: "https://wildrift.leagueoflegends.com/ru-ru/champions/brand/",
  },
  {
    championSlug: "brand",
    lane: null,
    tipText: "Учитывай небольшую задержку «Столба пламени», выбирая область для нанесения урона нескольким врагам.",
    sourceLabel: "СТОЛБ ПЛАМЕНИ",
    evidenceText: "После небольшой задержки Брэнд создает в указанной точке огненный столб, который наносит магический урон всем врагам в зоне поражения.",
    sourceUrl: "https://wildrift.leagueoflegends.com/ru-ru/champions/brand/",
  },
  {
    championSlug: "vladimir",
    lane: null,
    tipText: "Используй усиленное «Переливание» при заполненном ресурсе, чтобы нанести большой урон и восстановить здоровье.",
    sourceLabel: "МАГИЯ КРОВИ",
    evidenceText: "Владимир высасывает жизненную силу врага. Когда ресурс Владимира заполнится, Переливание нанесет огромный урон и восстановит здоровье Владимиру.",
    sourceUrl: "https://wildrift.leagueoflegends.com/ru-ru/champions/vladimir/",
  },
  {
    championSlug: "vladimir",
    lane: null,
    tipText: "Применяй «Алый омут», чтобы на 2 секунды стать недосягаемым, замедлить врагов над собой и вытянуть их здоровье.",
    sourceLabel: "АЛЫЙ ОМУТ",
    evidenceText: "Владимир погружается в омут крови и становится недосягаемым на 2 сек., замедляя врагов над собой и вытягивая у них здоровье.",
    sourceUrl: "https://wildrift.leagueoflegends.com/ru-ru/champions/vladimir/",
  },
  {
    championSlug: "vladimir",
    lane: null,
    tipText: "Накрой врагов «Заражением крови», чтобы они получали увеличенный урон во время действия умения.",
    sourceLabel: "ЗАРАЖЕНИЕ КРОВИ",
    evidenceText: "Владимир заражает всех противников в выбранной области. В течение действия умения пораженные враги получают увеличенный урон; кроме того, по окончании действия умения им наносится дополнительный магический урон.",
    sourceUrl: "https://wildrift.leagueoflegends.com/ru-ru/champions/vladimir/",
  },
];

const defaultSourceUrl = "https://wildrift.leagueoflegends.com/ru-ru/champions/rengar/";

for (const tip of curatedTips) {
  const record = {
    ...tip,
    sourceKind: "riot-wild-rift-champion-page-curated",
    sourceUrl: tip.sourceUrl || defaultSourceUrl,
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
