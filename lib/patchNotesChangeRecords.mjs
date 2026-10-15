import { createHash } from "node:crypto";

import { buildPublicIconPath } from "./championIcons.mjs";
import { buildGuideAssetKey, buildPublicGuideAssetPath } from "./guideAssets.mjs";
import { eq } from "drizzle-orm";

function normalizeName(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^a-z0-9а-я]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function createAliasMap(records, aliasesForRecord) {
  const aliases = new Map();
  for (const record of records) {
    for (const alias of aliasesForRecord(record)) {
      const key = normalizeName(alias);
      if (key && !aliases.has(key)) aliases.set(key, record);
    }
  }
  return aliases;
}

export async function loadPatchChangeCatalog(dbSchema, db) {
  const champions = await db.select({
    slug: dbSchema.champions.slug,
    name: dbSchema.champions.name,
    nameLocalizations: dbSchema.champions.nameLocalizations,
    icon: dbSchema.champions.icon,
  }).from(dbSchema.champions);
  const items = await db.select({
    slug: dbSchema.guideEntities.slug,
    name: dbSchema.guideEntities.name,
    tooltipTitle: dbSchema.guideEntities.tooltipTitle,
    imageUrl: dbSchema.guideEntities.imageUrl,
    tooltipImageUrl: dbSchema.guideEntities.tooltipImageUrl,
  }).from(dbSchema.guideEntities).where(eq(dbSchema.guideEntities.kind, "item"));

  const itemAliases = createAliasMap(items, (record) => [record.slug, record.name, record.tooltipTitle]);
  const bySlug = new Map(items.map((record) => [record.slug, record]));
  for (const [alias, slug] of [
    ["Locket of the Iron Solari", "locket-enchant"],
    ["Медальон Железных Солари", "locket-enchant"],
    ["Thornmail", "thornmail"],
    ["Шипованный доспех", "thornmail"],
    ["Warmog's Heart", "warmogs-armor"],
    ["Сердце Вармога", "warmogs-armor"],
    ["Эгида солнечного пламени", "sunfire-aegis"],
    ["Великанская зима", "fimbulwinter"],
    ["Слеза богини", "tear-of-the-goddess"],
  ]) {
    const entity = bySlug.get(slug);
    if (entity) itemAliases.set(normalizeName(alias), entity);
  }
  for (const item of [
    { slug: "statikk-shiv", name: "Statikk Shiv", aliases: ["Statikk Shiv", "Заточка Статикка"], imageUrl: "https://www.wildriftfire.com/images/items/statikk-shiv.png" },
    { slug: "yun-tal-wildarrows", name: "Yun Tal Wildarrows", aliases: ["Yun Tal Wildarrows", "Дикие стрелы Юнталь"], imageUrl: "https://www.wildriftfire.com/images/items/yun-tal-wildarrows.png" },
    { slug: "magnetic-blaster", name: "Magnetic Blaster", aliases: ["Magnetic Blaster", "Магнитный бластер"], imageUrl: "https://www.wildriftfire.com/images/items/magnetic-blaster.png" },
    { slug: "soul-transfer", name: "Soul Transfer", aliases: ["Soul Transfer", "Перенос души"], imageUrl: "https://www.wildriftfire.com/images/items/soul-transfer.png" },
    { slug: "cloak-of-agility", name: "Cloak of Agility", aliases: ["Cloak of Agility", "Плащ ловкости"], imageUrl: "https://www.wildriftfire.com/images/items/cloak-of-agility.png" },
    { slug: "nashors-talon", name: "Nashor's Talon", aliases: ["Nashor's Talon", "Nashor’s Talon", "Коготь Нашора"], imageUrl: "https://www.wildriftfire.com/images/items/nashors-talon.png" },
    { slug: "searing-crown", name: "Searing Crown", aliases: ["Searing Crown", "Обжигающая корона"], imageUrl: "https://www.wildriftfire.com/images/items/searing-crown.png" },
    { slug: "surging-scales", name: "Surging Scales", aliases: ["Surging Scales", "Вздымающаяся чешуя"], imageUrl: "https://www.wildriftfire.com/images/items/surging-scales.png" },
    { slug: "shimmering-spark", name: "Shimmering Spark", aliases: ["Shimmering Spark", "Мерцающая искра"], imageUrl: "https://www.wildriftfire.com/images/items/shimmering-spark.png" },
    { slug: "stinger", name: "Stinger", aliases: ["Stinger", "Жало"], imageUrl: "https://www.wildriftfire.com/images/items/stinger.png" },
    { slug: "pickaxe", name: "Pickaxe", aliases: ["Pickaxe", "Кирка"], imageUrl: "https://www.wildriftfire.com/images/items/pickaxe.png" },
    { slug: "hearthbound-axe", name: "Hearthbound Axe", aliases: ["Hearthbound Axe", "Топор Теплолюбивых"], imageUrl: "https://www.wildriftfire.com/images/items/hearthbound-axe.png" },
    { slug: "hexoptics-c44", name: "Hexoptics C44", aliases: ["Hexoptics C44", "Хекс-прицел C44", "Хекс-прицел С44"], imageUrl: "https://www.wildriftfire.com/images/items/hexoptics-c44.png" },
    { slug: "rapid-firecannon", name: "Rapid Firecannon", aliases: ["Rapid Firecannon", "Скорострельная пушка"], imageUrl: "https://www.wildriftfire.com/images/items/rapid-firecannon.png" },
    { slug: "fiendhunter-bolts", name: "Fiendhunter Bolts", aliases: ["Fiendhunter Bolts", "Стрелы борца с демонами"], imageUrl: "https://www.wildriftfire.com/images/items/fiendhunter-bolts.png" },
    { slug: "mercurial-scimitar", name: "Mercurial Scimitar", aliases: ["Mercurial Scimitar", "Ртутный ятаган"], imageUrl: "https://www.wildriftfire.com/images/items/mercurial-scimitar.png" },
    { slug: "bandleglass-mirror", name: "Bandleglass Mirror", aliases: ["Bandleglass Mirror", "Зеркало йордлов"], imageUrl: "https://www.wildriftfire.com/images/items/bandleglass-mirror.png" },
    { slug: "whispering-circlet", name: "Whispering Circlet", aliases: ["Whispering Circlet", "Шепчущая диадема"], imageUrl: "https://www.wildriftfire.com/images/items/whispering-circlet.png" },
    { slug: "diadem-of-songs", name: "Diadem of Songs", aliases: ["Diadem of Songs", "Диадема песен"], imageUrl: "https://www.wildriftfire.com/images/items/diadem-of-songs.png" },
    { slug: "echoes-of-helia", name: "Echoes of Helia", aliases: ["Echoes of Helia", "Эхо Гелии"], imageUrl: "https://www.wildriftfire.com/images/items/echoes-of-helia.png" },
    { slug: "shurelyas-battlesong", name: "Shurelya's Battlesong", aliases: ["Shurelya's Battlesong", "Shurelya’s Battlesong", "Боевая песнь Шурелии"], imageUrl: "https://www.wildriftfire.com/images/items/shurelyas-battlesong.png" },
    { slug: "dusk-and-dawn", name: "Dusk and Dawn", aliases: ["Dusk and Dawn", "Рассвет и закат"], imageUrl: "https://www.wildriftfire.com/images/items/dusk-and-dawn.png" },
    { slug: "at-wits-end", name: "At Wit's End", aliases: ["At Wit's End", "Смерть Разума"], imageUrl: "https://www.wildriftfire.com/images/items/wits-end.png" },
  ]) {
    const entity = { ...item, tooltipImageUrl: item.imageUrl };
    for (const alias of [item.slug, item.name, ...item.aliases]) itemAliases.set(normalizeName(alias), entity);
  }

  return {
    champions: createAliasMap(champions, (record) => [
      record.slug,
      record.name,
      ...Object.values(record.nameLocalizations || {}),
    ]),
    items: itemAliases,
  };
}

function parseNumbers(value) {
  const comparable = String(value || "").replace(/\([^)]*(?:based on|depending on|at level|level|в зависимости от|уровне)[^)]*\)/gi, "");
  return comparable.match(/\d+(?:[.,]\d+)?/g)?.map((number) => Number(number.replace(",", "."))) || [];
}

function classifyLine(detail) {
  if (!detail?.before || !detail?.after) return null;
  const before = parseNumbers(detail.before);
  const after = parseNumbers(detail.after);
  if (!before.length || !after.length) return null;

  const count = Math.min(before.length, after.length);
  const difference = after.slice(0, count).reduce((sum, value, index) => sum + value - before[index], 0);
  if (!difference) return null;

  const label = normalizeName(detail.label || detail.text);
  const lowerIsBetter = /price|cost|cooldown|cool down|recharge|стоимост|цена|перезаряд/.test(label);
  const higherIsWorse = /threshold|порог/.test(label);
  const isBuff = lowerIsBetter ? difference < 0 : higherIsWorse ? difference < 0 : difference > 0;
  return isBuff ? "buff" : "nerf";
}

function classifyChange(change) {
  const structuralText = `${change.entityName} ${change.changeName || ""} ${change.details.map((detail) => detail.text).join(" ")}`;
  if (change.entityKind === "champion" || change.entityKind === "item") {
    const headerText = `${change.sectionName || ""} ${change.entityName} ${change.changeName || ""}`;
    const removedSection = /^(?:removed|deleted)\s+(?:items?|champions?)$|^удаленные\s+(?:предметы|чемпионы)$/i.test(change.sectionName || "");
    const removedStatement = change.details.some((detail) => (
      /^(?:(?:this )?(?:item|champion) (?:has been )?removed from (?:the )?(?:game|wild rift)|removed from (?:the )?(?:game|wild rift))\.?$/i.test(detail.text.trim())
      || /^(?:предмет|чемпион)?\s*удален\w* из игры\.?$/i.test(detail.text.trim())
    ));
    if (removedSection || removedStatement) {
      return "removed";
    }
    const newSectionOrName = /\bnew\s+(?:champions?|items?)\b|нов(?:ый|ые)\s+(?:чемпион|предмет)/i.test(headerText);
    const newEntityStatement = change.details.some((detail) => (
      /^(?:(?:a )?new (?:champion|item)\b|(?:this )?(?:champion|item) is new\b|(?:a )?(?:champion|item) added to (?:the )?(?:game|wild rift)\b|нов(?:ый|ая|ое) (?:чемпион|предмет)\b|(?:чемпион|предмет) добавлен[ао]? в игру)/i.test(detail.text.trim())
    ));
    if (newSectionOrName || newEntityStatement) {
      return "new";
    }
  }
  if (/\brework(?:ed)?\b|переработ/i.test(structuralText)) return "rework";
  const directions = new Set(change.details.map(classifyLine).filter(Boolean));
  if (directions.size > 1) return "adjustment";
  if (directions.has("buff")) return "buff";
  if (directions.has("nerf")) return "nerf";
  return "adjustment";
}

function findCatalogEntity(change, catalog) {
  if (change.entityKind !== "champion" && change.entityKind !== "item") return null;
  const map = change.entityKind === "champion" ? catalog.champions : catalog.items;
  return map.get(normalizeName(change.entityName)) || null;
}

function enrichChange(change, catalog) {
  const catalogEntity = findCatalogEntity(change, catalog);
  const entity = catalogEntity;

  const entitySlug = entity?.slug || null;
  let imageUrl = null;
  if (change.entityKind === "champion" && entity?.icon) {
    imageUrl = buildPublicIconPath(entity.slug, entity.icon);
  } else if (change.entityKind === "item" && entity) {
    const sourceUrl = entity.tooltipImageUrl || entity.imageUrl || null;
    imageUrl = sourceUrl
      ? buildPublicGuideAssetPath(buildGuideAssetKey("guide", "item", entity.slug, "image"), sourceUrl)
      : null;
  } else if (change.entityKind === "champion" && change.sourceImageUrl) {
    const imageKey = createHash("sha1").update(normalizeName(change.entityName)).digest("hex").slice(0, 12);
    imageUrl = buildPublicGuideAssetPath(buildGuideAssetKey("patch", "champion", imageKey), change.sourceImageUrl);
  }
  return { ...change, entitySlug, imageUrl };
}

function itemDetailSignature(change) {
  const values = change.details.flatMap((detail) => {
    const source = detail.before && detail.after
      ? `${detail.before} ${detail.after}`
      : detail.text;
    return source.match(/\d[\d\s]*(?:[.,]\d+)?/g) || [];
  }).map((value) => {
    const normalized = value.replace(/\s/g, "");
    return /[,.]\d{3}$/.test(normalized)
      ? normalized.replace(/[,.]/g, "")
      : normalized.replace(",", ".");
  }).sort();
  return values.length ? values.join("|") : null;
}

export function buildPatchChangeRows(changes, catalog, englishChanges = []) {
  const itemChanges = (changes || []).filter((change) => change.entityKind === "item");
  const englishItems = (englishChanges || []).filter((change) => change.entityKind === "item");
  const itemFallbacks = new Map();
  if (itemChanges.length && itemChanges.length === englishItems.length) {
    itemChanges.forEach((change, index) => {
      const english = englishItems[index];
      const signature = itemDetailSignature(change);
      if (signature && signature === itemDetailSignature(english) && english.entitySlug && english.imageUrl) {
        itemFallbacks.set(change, english);
      }
    });
  }

  const rows = (changes || []).map((rawChange, ordinal) => {
    const entityKind = rawChange.entityKind || "system";
    const catalogEntity = findCatalogEntity(rawChange, catalog);
    const itemFallback = entityKind === "item" && !catalogEntity ? itemFallbacks.get(rawChange) : null;
    const change = enrichChange(rawChange, catalog);
    return {
      ordinal,
      entityKind,
      entitySlug: change.entitySlug || itemFallback?.entitySlug || null,
      entityName: change.entityName,
      imageUrl: change.imageUrl || itemFallback?.imageUrl || null,
      changeType: classifyChange(change),
      sectionName: change.sectionName || null,
      changeName: change.changeName || null,
      details: change.details,
    };
  });

  const champions = new Map();
  const itemsByEntity = new Map();
  const others = [];
  for (const row of rows) {
    if (row.entityKind === "item") {
      const key = row.entitySlug || normalizeName(row.entityName);
      const existing = itemsByEntity.get(key);
      if (existing) mergeItemRows(existing, row);
      else itemsByEntity.set(key, { ...row, details: [...row.details] });
      continue;
    }
    if (row.entityKind !== "champion") {
      others.push(row);
      continue;
    }
    const key = row.entitySlug || normalizeName(row.entityName);
    const existing = champions.get(key);
    if (existing) {
      existing.details.push(...row.details.map((detail) => ({ ...detail, component: row.changeName })));
      existing.changeType = combineTypes(existing.changeType, row.changeType);
    } else {
      champions.set(key, {
        ...row,
        details: row.details.map((detail) => ({ ...detail, component: row.changeName })),
      });
    }
  }
  return [...champions.values(), ...itemsByEntity.values(), ...others].map((row, ordinal) => ({ ...row, ordinal }));
}

function detailSignature(detail) {
  return [detail.component, detail.label, detail.before, detail.after, detail.text]
    .map((value) => normalizeName(value || ""))
    .join("|");
}

function mergeItemRows(existing, row) {
  const detailKeys = new Set(existing.details.map(detailSignature));
  for (const detail of row.details) {
    const key = detailSignature(detail);
    if (detailKeys.has(key)) continue;
    detailKeys.add(key);
    existing.details.push(detail);
  }
  existing.changeType = combineTypes(existing.changeType, row.changeType);
}

function combineTypes(left, right) {
  if (left === right) return left;
  if (left === "removed" || right === "removed") return "removed";
  if (left === "new" || right === "new") return "new";
  if (left === "rework" || right === "rework") return "rework";
  return "adjustment";
}

