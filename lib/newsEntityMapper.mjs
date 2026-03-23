import fs from "fs";
import path from "path";

function uniq(values) {
  return Array.from(
    new Set(
      (values || [])
        .map((value) => String(value || "").trim())
        .filter(Boolean),
    ),
  );
}

export function normalizeLookupText(value = "") {
  return String(value || "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/&/g, " and ")
    .replace(/[']/g, "")
    .replace(/[^a-z0-9а-я]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function addAlias(map, key, value) {
  const normalized = normalizeLookupText(key);
  if (!normalized || value == null) return;
  if (!map.has(normalized)) {
    map.set(normalized, value);
  }
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function getChampionDir(rootDir) {
  return path.join(rootDir, "champions");
}

function buildChampionAliases(champion) {
  const aliases = [
    champion.slug,
    champion.name?.ru_ru,
    champion.name?.en_us,
    champion.name?.en_gb,
  ];

  if (champion.name && typeof champion.name === "object") {
    aliases.push(...Object.values(champion.name));
  }

  return uniq(aliases);
}

function buildAbilityAliases(ability) {
  const aliases = [
    ability.slug,
    ability.key,
    ability.slot,
    ability.name?.ru_ru,
    ability.name?.en_us,
    ability.name?.en_gb,
  ];

  if (ability.name && typeof ability.name === "object") {
    aliases.push(...Object.values(ability.name));
  }

  return uniq(aliases);
}

export function loadChampionRecords(rootDir = process.cwd()) {
  const championsDir = getChampionDir(rootDir);
  if (!fs.existsSync(championsDir)) return [];

  return fs
    .readdirSync(championsDir)
    .filter((file) => file.endsWith(".json"))
    .map((file) => readJson(path.join(championsDir, file)))
    .filter((entry) => entry && typeof entry === "object" && entry.slug);
}

export function buildChampionMapper(championRecords = []) {
  const aliasToSlug = new Map();
  const champions = championRecords.map((champion) => {
    const aliases = buildChampionAliases(champion);

    for (const alias of aliases) {
      addAlias(aliasToSlug, alias, champion.slug);
    }

    return {
      slug: champion.slug,
      primaryName: champion.name?.ru_ru || champion.name?.en_us || champion.slug,
      aliases,
    };
  });

  return {
    champions,
    aliasToSlug,
  };
}

export function buildAbilityMapper(championRecords = []) {
  const aliasToAbility = new Map();
  const abilities = [];

  for (const champion of championRecords) {
    const championAliases = buildChampionAliases(champion);
    const championLabel =
      champion.name?.ru_ru || champion.name?.en_us || champion.slug;

    for (const ability of champion.abilities || []) {
      const abilitySlug = ability.slug || ability.key || ability.slot;
      if (!abilitySlug) continue;

      const aliases = buildAbilityAliases(ability);
      const record = {
        championSlug: champion.slug,
        championName: championLabel,
        abilitySlug,
        slot: ability.slot || null,
        key: ability.key || null,
        primaryName: ability.name?.ru_ru || ability.name?.en_us || abilitySlug,
        aliases,
      };

      abilities.push(record);

      for (const alias of aliases) {
        addAlias(aliasToAbility, `${champion.slug}::${alias}`, record);
        addAlias(aliasToAbility, `${championLabel}::${alias}`, record);
        for (const championAlias of championAliases) {
          addAlias(aliasToAbility, `${championAlias}::${alias}`, record);
        }
      }
    }
  }

  return {
    abilities,
    aliasToAbility,
  };
}

export async function loadItemRecordsFromDb(dbSchema, dbClient) {
  if (!dbSchema?.guideEntities || !dbClient) return [];

  const { eq } = await import("drizzle-orm");
  const rows = await dbClient
    .select({
      slug: dbSchema.guideEntities.slug,
      name: dbSchema.guideEntities.name,
      tooltipTitle: dbSchema.guideEntities.tooltipTitle,
      entityId: dbSchema.guideEntities.entityId,
      imageUrl: dbSchema.guideEntities.imageUrl,
    })
    .from(dbSchema.guideEntities)
    .where(eq(dbSchema.guideEntities.kind, "item"));

  return rows || [];
}

export function buildItemMapper(itemRecords = []) {
  const aliasToItem = new Map();
  const items = itemRecords.map((item) => {
    const aliases = uniq([item.slug, item.name, item.tooltipTitle]);

    const record = {
      slug: item.slug,
      primaryName: item.name || item.tooltipTitle || item.slug,
      tooltipTitle: item.tooltipTitle || null,
      entityId: item.entityId ?? null,
      imageUrl: item.imageUrl || null,
      aliases,
    };

    for (const alias of aliases) {
      addAlias(aliasToItem, alias, record);
    }

    return record;
  });

  return {
    items,
    aliasToItem,
  };
}

export function resolveChampionSlug(aliasToSlug, rawName) {
  const normalized = normalizeLookupText(rawName);
  if (!normalized || !aliasToSlug) return null;
  return aliasToSlug.get(normalized) || null;
}

export function resolveAbility(aliasToAbility, championHint, rawAbilityName) {
  const abilityName = normalizeLookupText(rawAbilityName);
  if (!abilityName || !aliasToAbility) return null;

  const hintCandidates = uniq([championHint]).map((value) => normalizeLookupText(value));
  for (const hint of hintCandidates) {
    const direct = aliasToAbility.get(`${hint} ${abilityName}`) || aliasToAbility.get(`${hint}::${abilityName}`);
    if (direct) return direct;
  }

  for (const [key, value] of aliasToAbility.entries()) {
    if (key.endsWith(`::${abilityName}`)) return value;
  }

  return null;
}

export function resolveItem(aliasToItem, rawItemName) {
  const normalized = normalizeLookupText(rawItemName);
  if (!normalized || !aliasToItem) return null;
  return aliasToItem.get(normalized) || null;
}

export async function buildNewsEntityMapper(options = {}) {
  const rootDir = options.rootDir || process.cwd();
  const championRecords = loadChampionRecords(rootDir);
  const championMapper = buildChampionMapper(championRecords);
  const abilityMapper = buildAbilityMapper(championRecords);

  let itemRecords = Array.isArray(options.itemRecords) ? options.itemRecords : [];
  let itemsSource = "none";

  if (!itemRecords.length && options.dbSchema && options.dbClient) {
    itemRecords = await loadItemRecordsFromDb(options.dbSchema, options.dbClient);
    itemsSource = itemRecords.length ? "database" : "database-empty";
  } else if (itemRecords.length) {
    itemsSource = "provided";
  }

  const itemMapper = buildItemMapper(itemRecords);

  return {
    generatedAt: new Date().toISOString(),
    sources: {
      champions: championRecords.length ? "champions-dir" : "none",
      abilities: championRecords.length ? "champions-dir" : "none",
      items: itemsSource,
    },
    counts: {
      champions: championMapper.champions.length,
      championAliases: championMapper.aliasToSlug.size,
      abilities: abilityMapper.abilities.length,
      abilityAliases: abilityMapper.aliasToAbility.size,
      items: itemMapper.items.length,
      itemAliases: itemMapper.aliasToItem.size,
    },
    champions: championMapper.champions,
    abilities: abilityMapper.abilities,
    items: itemMapper.items,
    championAliasMap: Object.fromEntries(championMapper.aliasToSlug.entries()),
    abilityAliasMap: Object.fromEntries(
      Array.from(abilityMapper.aliasToAbility.entries()).map(([key, value]) => [
        key,
        {
          championSlug: value.championSlug,
          abilitySlug: value.abilitySlug,
          slot: value.slot,
        },
      ]),
    ),
    itemAliasMap: Object.fromEntries(
      Array.from(itemMapper.aliasToItem.entries()).map(([key, value]) => [
        key,
        {
          slug: value.slug,
          entityId: value.entityId,
        },
      ]),
    ),
  };
}
