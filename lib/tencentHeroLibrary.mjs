const TENCENT_HERO_LIST_URL = "https://game.gtimg.cn/images/lgamem/act/lrlib/js/heroList/hero_list.js";
const TENCENT_HERO_DETAIL_URL = "https://game.gtimg.cn/images/lgamem/act/lrlib/js/hero/";
const STAT_FIELDS = [
  ["attack", "attack"], ["attackPerLevel", "attackperlevel"],
  ["abilityPower", "magic"], ["abilityPowerPerLevel", "magicperlevel"],
  ["health", "hp"], ["healthPerLevel", "hpperlevel"],
  ["mana", "mp"], ["manaPerLevel", "mpperlevel"],
  ["moveSpeed", "movespeed"], ["armor", "armor"], ["armorPerLevel", "armorperlevel"],
  ["magicResist", "spellblock"], ["magicResistPerLevel", "spellblockperlevel"],
  ["healthRegen", "hpregen"], ["healthRegenPerLevel", "hpregenperlevel"],
  ["manaRegen", "mpregen"], ["manaRegenPerLevel", "mpregenperlevel"],
  ["crit", "crit"], ["attackSpeed", "attackspeed"],
  ["attackSpeedPerLevel", "attackspeedperlevel"], ["mobilityPerLevel", "mobilityperlevel"],
];

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requiredText(value, label) {
  if (typeof value !== "string" && typeof value !== "number") {
    throw new TypeError(`Invalid Tencent hero payload: ${label} must be text`);
  }
  const result = String(value).trim();
  if (!result) throw new TypeError(`Invalid Tencent hero payload: ${label} is empty`);
  return result;
}

function optionalText(value) {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const result = String(value).trim();
  return result || null;
}

function finiteNumber(value, label) {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const text = String(value).trim();
  if (!text) return null;
  const parsed = Number(text);
  if (!Number.isFinite(parsed)) {
    throw new TypeError(`Invalid Tencent hero payload: ${label} must be finite`);
  }
  return parsed;
}

function fixedPointStat(value, field) {
  const raw = finiteNumber(value, `hero.${field}`);
  return raw === null ? null : raw / 10_000;
}

function normalizeMetadata(payload, sourceUrl) {
  const version = optionalText(payload.version);
  const fileName = optionalText(payload.fileName);
  const fileTime = optionalText(payload.fileTime);
  const provenance = {
    source: "tencent-qq-wild-rift-hero-library",
    sourceUrl,
    version,
    fileName,
    fileTime,
  };
  return {
    ...provenance,
    provenance,
  };
}

function normalizeHeroListEntry(hero, key) {
  if (!isRecord(hero)) throw new TypeError(`Invalid Tencent hero payload: heroList[${key}] must be an object`);
  const heroId = requiredText(hero.heroId ?? key, `heroList[${key}].heroId`);
  if (!/^\d+$/.test(heroId)) throw new TypeError(`Invalid Tencent hero payload: heroList[${key}].heroId must be numeric`);
  const name = requiredText(hero.name, `heroList[${key}].name`);
  const roles = Array.isArray(hero.roles)
    ? hero.roles.map((role, index) => requiredText(role, `heroList[${key}].roles[${index}]`))
    : [];

  return {
    heroId,
    name,
    title: optionalText(hero.title),
    alias: optionalText(hero.alias),
    roles,
    lane: optionalText(hero.lane),
    intro: optionalText(hero.intro),
    avatarUrl: optionalText(hero.avatar),
    cardUrl: optionalText(hero.card),
    posterUrl: optionalText(hero.poster),
    difficulty: finiteNumber(hero.difficultyL, `heroList[${key}].difficultyL`),
    damage: finiteNumber(hero.damage, `heroList[${key}].damage`),
    survivability: finiteNumber(hero.surviveL, `heroList[${key}].surviveL`),
    utility: finiteNumber(hero.assistL, `heroList[${key}].assistL`),
    isWeekFree: optionalText(hero.isWeekFree),
    prices: {
      highlight: finiteNumber(hero.highlightprice, `heroList[${key}].highlightprice`),
      coupon: finiteNumber(hero.couponprice, `heroList[${key}].couponprice`),
    },
    rawPayload: hero,
  };
}

/**
 * Parse Tencent's QQ Wild Rift hero roster payload without performing I/O.
 * Stats and growth values use the source's fixed-point scale (integer / 10000).
 */
export function parseTencentHeroList(payload) {
  if (!isRecord(payload)) throw new TypeError("Invalid Tencent hero list: payload must be an object");
  const sourceRoster = payload.heroList ?? payload.hero;
  if (!isRecord(sourceRoster) && !Array.isArray(sourceRoster)) {
    throw new TypeError("Invalid Tencent hero list: expected heroList object or hero array");
  }
  const entries = Array.isArray(sourceRoster)
    ? sourceRoster.map((hero, index) => [String(index), hero])
    : Object.entries(sourceRoster);
  if (!entries.length) throw new TypeError("Invalid Tencent hero list: roster is empty");

  const heroes = entries.map(([key, hero]) => normalizeHeroListEntry(hero, key));
  const ids = new Set();
  for (const hero of heroes) {
    if (ids.has(hero.heroId)) throw new TypeError(`Invalid Tencent hero list: duplicate heroId ${hero.heroId}`);
    ids.add(hero.heroId);
  }

  return {
    ...normalizeMetadata(payload, TENCENT_HERO_LIST_URL),
    heroes,
    rawPayload: payload,
  };
}

function normalizeSpellVariables(spell) {
  const count = finiteNumber(spell.variTypeNum, "spell.variTypeNum") ?? 0;
  if (!Number.isInteger(count) || count < 0 || count > 20) {
    throw new TypeError("Invalid Tencent hero payload: spell.variTypeNum must be an integer from 0 to 20");
  }
  const variables = [];
  for (let index = 1; index <= count; index += 1) {
    const name = optionalText(spell[`variType${index}`]);
    const rawValues = optionalText(spell[`variValue${index}`]);
    if (!name || name.toLowerCase() === "none" || !rawValues) continue;
    variables.push({
      name,
      valuesByRank: rawValues.split("/").map((value) => value.trim()),
    });
  }
  return variables;
}

function normalizeSpell(spell, index, heroId) {
  if (!isRecord(spell)) throw new TypeError(`Invalid Tencent hero payload: spells[${index}] must be an object`);
  const spellHeroId = optionalText(spell.heroId);
  if (spellHeroId && spellHeroId !== heroId) {
    throw new TypeError(`Invalid Tencent hero payload: spells[${index}] belongs to hero ${spellHeroId}, expected ${heroId}`);
  }
  const details = Array.isArray(spell.detail) ? spell.detail.map((entry, detailIndex) => (
    requiredText(entry, `spells[${index}].detail[${detailIndex}]`)
  )) : [];
  const variables = normalizeSpellVariables(spell);
  const rankCount = Math.max(details.length, ...variables.map((variable) => variable.valuesByRank.length), 0);
  const levels = Array.from({ length: rankCount }, (_, rankIndex) => ({
    rank: rankIndex + 1,
    description: details[rankIndex] || null,
    variables: Object.fromEntries(variables.flatMap((variable) => (
      variable.valuesByRank[rankIndex] === undefined ? [] : [[variable.name, variable.valuesByRank[rankIndex]]]
    ))),
  }));

  return {
    heroId,
    spellId: optionalText(spell.spellId),
    key: optionalText(spell.spellKey),
    name: requiredText(spell.name, `spells[${index}].name`),
    description: optionalText(spell.description),
    iconUrl: optionalText(spell.abilityIconPath),
    videoUrl: optionalText(spell.abilityVideoPath),
    cooldown: optionalText(spell.cdtime),
    cost: {
      type: optionalText(spell.costtype),
      value: optionalText(spell.costvalue),
    },
    variables,
    levels,
    rawPayload: spell,
  };
}

function normalizeHeroDetail(hero) {
  if (!isRecord(hero)) throw new TypeError("Invalid Tencent hero detail: hero must be an object");
  const heroId = requiredText(hero.heroId, "hero.heroId");
  if (!/^\d+$/.test(heroId)) throw new TypeError("Invalid Tencent hero detail: hero.heroId must be numeric");
  const stats = Object.fromEntries(STAT_FIELDS.map(([name, field]) => [name, fixedPointStat(hero[field], field)]));
  const growthByLevel = [];
  for (let level = 1; level <= 15; level += 1) {
    const field = `growthfix${level}`;
    const value = fixedPointStat(hero[field], field);
    if (value !== null) growthByLevel.push({ level, multiplier: value });
  }
  return {
    heroId,
    name: requiredText(hero.name, "hero.name"),
    title: optionalText(hero.title),
    roles: Array.isArray(hero.roles) ? hero.roles.map((role, index) => requiredText(role, `hero.roles[${index}]`)) : [],
    lane: optionalText(hero.lane),
    stats,
    growthByLevel,
    rawPayload: hero,
  };
}

/** Parse one Tencent QQ Wild Rift hero detail payload; no network calls are made. */
export function parseTencentHeroDetail(payload, { sourceUrl } = {}) {
  if (!isRecord(payload)) throw new TypeError("Invalid Tencent hero detail: payload must be an object");
  const hero = normalizeHeroDetail(payload.hero);
  if (payload.spells !== undefined && !Array.isArray(payload.spells)) {
    throw new TypeError("Invalid Tencent hero detail: spells must be an array");
  }
  const spells = (payload.spells || []).map((spell, index) => normalizeSpell(spell, index, hero.heroId));
  const resolvedSourceUrl = optionalText(sourceUrl)
    || `${TENCENT_HERO_DETAIL_URL}${encodeURIComponent(hero.heroId)}.js`;
  return {
    ...normalizeMetadata(payload, resolvedSourceUrl),
    hero,
    spells,
    rawPayload: payload,
  };
}
