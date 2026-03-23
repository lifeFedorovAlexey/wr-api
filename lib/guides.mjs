import { buildPublicIconPath } from "./championIcons.mjs";
import { buildGuideAssetKey, buildPublicGuideAssetPath } from "./guideAssets.mjs";
import {
  buildPublicGuideHeroMediaPath,
  resolveGuideHeroMediaFilePath,
} from "./guideHeroMedia.mjs";

function cleanText(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeGuideAssetPath(assetKey, sourceUrl) {
  if (!sourceUrl) return null;
  if (String(sourceUrl).startsWith("/")) return sourceUrl;

  try {
    const url = new URL(sourceUrl);
    if (url.protocol === "http:" || url.protocol === "https:") {
      return buildPublicGuideAssetPath(assetKey, sourceUrl);
    }
  } catch {}

  return sourceUrl;
}

function isGenericVariantTitle(value = "") {
  const normalized = cleanText(value).toLowerCase();
  return /^build\s*\d+$/.test(normalized) || /^guide\s*\d+$/.test(normalized);
}

export function localizeRole(value = "") {
  const normalized = cleanText(value).toLowerCase();

  if (normalized.includes("support") || normalized.includes("саппорт")) return "Саппорт";
  if (normalized.includes("mid") || normalized.includes("мид")) return "Мид";
  if (normalized.includes("jungle") || normalized.includes("лес")) return "Лес";
  if (normalized.includes("baron") || normalized.includes("топ")) return "Барон";
  if (normalized.includes("duo")) return "Дуо";
  if (normalized.includes("adc") || normalized.includes("адк")) return "АДК";

  return cleanText(value);
}

export function getGuideRoles(guide) {
  const variants = Array.isArray(guide?.variants) ? guide.variants : [];

  const roles = variants
    .map((variant) => {
      const lane = cleanText(variant?.lane || "");
      const title = isGenericVariantTitle(variant?.title) ? "" : cleanText(variant?.title || "");
      return localizeRole(lane || title || "");
    })
    .filter(Boolean);

  if (roles.length) {
    return Array.from(new Set(roles));
  }

  const officialRoles = Array.isArray(guide?.official?.roles)
    ? guide.official.roles.map((role) => localizeRole(role)).filter(Boolean)
    : [];

  if (officialRoles.length) {
    return Array.from(new Set(officialRoles));
  }

  const recommendedRole = localizeRole(guide?.metadata?.recommendedRole || "");
  return recommendedRole ? [recommendedRole] : [];
}

export function summarizeGuide(guide) {
  const variants = Array.isArray(guide?.variants) ? guide.variants : [];
  const defaultVariant =
    variants.find((variant) => variant?.isDefault) || variants[0] || null;

  return {
    slug: guide?.champion?.slug || "",
    name: guide?.champion?.name || "",
    title: guide?.champion?.title || guide?.official?.champion?.title || null,
    icon: guide?.champion?.iconUrl || null,
    patch: guide?.metadata?.patch || null,
    tier: defaultVariant?.ownTier || defaultVariant?.tier || guide?.metadata?.tier || null,
    recommendedRole:
      localizeRole(
        defaultVariant?.lane ||
          (isGenericVariantTitle(defaultVariant?.title) ? "" : defaultVariant?.title) ||
          guide?.metadata?.recommendedRole ||
          guide?.official?.roles?.[0] ||
          "",
      ) || null,
    roles: getGuideRoles(guide),
    buildCount: variants.length || 1,
    sourceSite: guide?.source?.site || "wildriftfire",
    sourceUrl: guide?.source?.url || null,
    contentHash: guide?.source?.contentHash || null,
    fetchedAt: guide?.source?.fetchedAt || null,
  };
}

function mapEntity(kind, entity) {
  if (!entity?.slug || !entity?.name) return null;

  return {
    kind,
    slug: entity.slug,
    name: entity.name,
    imageUrl: entity.imageUrl || null,
    lane: entity.lane || null,
    entityId: entity.id ?? null,
    entityKind: entity.kind || null,
    videoUrl: entity.videoUrl || null,
    tooltipTitle: entity.tooltip?.title || null,
    tooltipCost: entity.tooltip?.cost || null,
    tooltipImageUrl: entity.tooltip?.imageUrl || null,
    tooltipStats: Array.isArray(entity.tooltip?.stats) ? entity.tooltip.stats : [],
    tooltipLines: Array.isArray(entity.tooltip?.lines) ? entity.tooltip.lines : [],
  };
}

export function extractGuideEntities(guide) {
  const entities = [];
  const push = (kind, entity) => {
    const mapped = mapEntity(kind, entity);
    if (mapped) entities.push(mapped);
  };

  const dictionaries = guide?.dictionaries || {};

  for (const entity of Object.values(dictionaries.items || {})) push("item", entity);
  for (const entity of Object.values(dictionaries.runes || {})) push("rune", entity);
  for (const entity of Object.values(dictionaries.summonerSpells || {})) {
    push("summonerSpell", entity);
  }
  for (const entity of Object.values(dictionaries.abilities || {})) push("ability", entity);

  const matchupEntries = [
    ...(guide?.counters || []),
    ...(guide?.synergies || []),
    ...((guide?.variants || []).flatMap((variant) => [
      ...(variant.counters || []),
      ...(variant.synergies || []),
    ])),
  ];

  for (const entity of matchupEntries) push("champion", entity);

  const deduped = new Map();
  for (const entity of entities) {
    deduped.set(`${entity.kind}:${entity.slug}`, entity);
  }

  return Array.from(deduped.values());
}

export function buildGuideImportRecord(guide) {
  const summary = summarizeGuide(guide);
  const variants = Array.isArray(guide?.variants) ? guide.variants : [];
  const entities = extractGuideEntities(guide);

  const officialMeta = {
    guideSlug: summary.slug,
    championName: guide?.official?.champion?.name || guide?.champion?.name || null,
    championTitle: guide?.official?.champion?.title || guide?.champion?.title || null,
    roles: Array.isArray(guide?.official?.roles) ? guide.official.roles : [],
    difficulty: guide?.official?.difficulty || null,
    heroRemoteVideoUrl: guide?.official?.heroMedia?.remoteVideoUrl || null,
    heroLocalVideoPath: guide?.official?.heroMedia?.localVideoPath || null,
  };

  const abilities = (guide?.abilitiesRu || []).map((ability, index) => ({
    guideSlug: summary.slug,
    orderIndex: index,
    abilitySlug: ability.slug,
    name: ability.name,
    subtitle: ability.subtitle || null,
    description: ability.description || null,
    iconUrl: ability.iconUrl || null,
    videoUrl: ability.videoUrl || null,
  }));

  const buildBreakdown = guide?.buildBreakdown
    ? {
        guideSlug: summary.slug,
        featuredItemSlugs: (guide.buildBreakdown.featuredItems || [])
          .map((item) => item.slug)
          .filter(Boolean),
        paragraphs: Array.isArray(guide.buildBreakdown.paragraphs)
          ? guide.buildBreakdown.paragraphs
          : [],
      }
    : null;

  const variantRows = [];
  const sectionRows = [];
  const skillOrderRows = [];
  const skillRowRows = [];
  const matchupRows = [];

  variants.forEach((variant, variantIndex) => {
    const variantKey = variant.guideId || `variant-${variantIndex + 1}`;

    variantRows.push({
      guideSlug: summary.slug,
      variantKey,
      title: variant.title,
      lane: variant.lane || null,
      tier: variant.tier || null,
      isDefault: Boolean(variant.isDefault),
      orderIndex: variantIndex,
    });

    const itemBuildEntries = [
      ["starting", variant.itemBuild?.starting || []],
      ["core", variant.itemBuild?.core || []],
      ["boots", variant.itemBuild?.boots || []],
      ["finalBuild", variant.itemBuild?.finalBuild || []],
    ];

    itemBuildEntries.forEach(([sectionKey, items], orderIndex) => {
      sectionRows.push({
        guideSlug: summary.slug,
        variantKey,
        sectionType: "itemBuild",
        sectionKey,
        label: null,
        orderIndex,
        entitySlugs: items.map((item) => item.slug).filter(Boolean),
      });
    });

    const spellRuneEntries = [
      ["summonerSpells", variant.spellsAndRunes?.summonerSpells || []],
      ["runes", variant.spellsAndRunes?.runes || []],
    ];

    spellRuneEntries.forEach(([sectionKey, items], orderIndex) => {
      sectionRows.push({
        guideSlug: summary.slug,
        variantKey,
        sectionType: "spellsAndRunes",
        sectionKey,
        label: null,
        orderIndex,
        entitySlugs: items.map((item) => item.slug).filter(Boolean),
      });
    });

    (variant.situationalItems || []).forEach((entry, orderIndex) => {
      sectionRows.push({
        guideSlug: summary.slug,
        variantKey,
        sectionType: "situationalItems",
        sectionKey: `situational-item-${orderIndex + 1}`,
        label: entry.label || null,
        orderIndex,
        entitySlugs: (entry.options || []).map((item) => item.slug).filter(Boolean),
      });
    });

    (variant.situationalRunes || []).forEach((entry, orderIndex) => {
      sectionRows.push({
        guideSlug: summary.slug,
        variantKey,
        sectionType: "situationalRunes",
        sectionKey: `situational-rune-${orderIndex + 1}`,
        label: entry.label || null,
        orderIndex,
        entitySlugs: (entry.options || []).map((item) => item.slug).filter(Boolean),
      });
    });

    skillOrderRows.push({
      guideSlug: summary.slug,
      variantKey,
      quickOrder: (variant.skillOrder?.quickOrder || [])
        .map((item) => item.slug)
        .filter(Boolean),
    });

    (variant.skillOrder?.rows || []).forEach((row, orderIndex) => {
      skillRowRows.push({
        guideSlug: summary.slug,
        variantKey,
        abilitySlug: row.slug,
        rowName: row.name,
        orderIndex,
        levels: Array.isArray(row.levels) ? row.levels : [],
      });
    });

    (variant.counters || []).forEach((entity, orderIndex) => {
      matchupRows.push({
        guideSlug: summary.slug,
        variantKey,
        matchupType: "counter",
        championSlug: entity.slug,
        orderIndex,
      });
    });

    (variant.synergies || []).forEach((entity, orderIndex) => {
      matchupRows.push({
        guideSlug: summary.slug,
        variantKey,
        matchupType: "synergy",
        championSlug: entity.slug,
        orderIndex,
      });
    });
  });

  return {
    summary,
    entities,
    officialMeta,
    abilities,
    buildBreakdown,
    variants: variantRows,
    sections: sectionRows,
    skillOrders: skillOrderRows,
    skillRows: skillRowRows,
    matchups: matchupRows,
  };
}

function toTooltip(entity) {
  const stats = Array.isArray(entity.tooltipStats) ? entity.tooltipStats.filter(Boolean) : [];
  const lines = Array.isArray(entity.tooltipLines) ? entity.tooltipLines.filter(Boolean) : [];

  if (
    !entity.tooltipTitle &&
    !entity.tooltipCost &&
    !entity.tooltipImageUrl &&
    stats.length === 0 &&
    lines.length === 0
  ) {
    return null;
  }

  return {
    title: entity.tooltipTitle || null,
    cost: entity.tooltipCost || null,
    imageUrl: normalizeGuideAssetPath(
      buildGuideAssetKey("guide", entity.kind, entity.slug, "tooltip"),
      entity.tooltipImageUrl || null,
    ),
    stats,
    lines,
  };
}

function toClientEntity(entity) {
  return {
    name: entity.name,
    slug: entity.slug,
    imageUrl: normalizeGuideAssetPath(
      buildGuideAssetKey("guide", entity.kind, entity.slug, "image"),
      entity.imageUrl || null,
    ),
    lane: entity.lane || null,
    id: entity.entityId ?? null,
    kind: entity.entityKind || null,
    videoUrl: entity.videoUrl || null,
    tooltip: toTooltip(entity),
  };
}

function mapEntitiesByKind(rows) {
  const mapped = {
    items: {},
    runes: {},
    summonerSpells: {},
    abilities: {},
    champions: {},
  };

  for (const row of rows) {
    const entity = toClientEntity(row);

    if (row.kind === "item") mapped.items[row.slug] = entity;
    if (row.kind === "rune") mapped.runes[row.slug] = entity;
    if (row.kind === "summonerSpell") mapped.summonerSpells[row.slug] = entity;
    if (row.kind === "ability") mapped.abilities[row.slug] = entity;
    if (row.kind === "champion") mapped.champions[row.slug] = entity;
  }

  return mapped;
}

function pickEntities(slugs, dictionary) {
  return (slugs || []).map((slug) => dictionary[slug]).filter(Boolean);
}

export function assembleGuideDetail({
  summary,
  officialMeta,
  abilities,
  buildBreakdown,
  variants,
  sections,
  skillOrders,
  skillRows,
  matchups,
  entities,
}) {
  const resolvedHeroLocalVideoPath =
    officialMeta?.heroLocalVideoPath ||
    (summary?.slug && resolveGuideHeroMediaFilePath(summary.slug)
      ? buildPublicGuideHeroMediaPath(summary.slug)
      : null);

  const dictionaries = mapEntitiesByKind(entities);
  const variantsByKey = variants
    .slice()
    .sort((left, right) => left.orderIndex - right.orderIndex)
    .map((variant) => {
      const variantSections = sections
        .filter((section) => section.variantKey === variant.variantKey)
        .sort((left, right) => left.orderIndex - right.orderIndex);

      const sectionMap = (sectionType, sectionKey) =>
        variantSections.find(
          (section) =>
            section.sectionType === sectionType && section.sectionKey === sectionKey,
        );

      const situationalItems = variantSections
        .filter((section) => section.sectionType === "situationalItems")
        .map((section) => ({
          label: section.label || "",
          options: pickEntities(section.entitySlugs, dictionaries.items),
        }));

      const situationalRunes = variantSections
        .filter((section) => section.sectionType === "situationalRunes")
        .map((section) => ({
          label: section.label || "",
          options: pickEntities(section.entitySlugs, dictionaries.runes),
        }));

      const skillOrder = skillOrders.find((entry) => entry.variantKey === variant.variantKey);

      return {
        guideId: variant.variantKey,
        title: variant.title,
        lane: variant.lane || null,
        tier: variant.tier || null,
        isDefault: Boolean(variant.isDefault),
        itemBuild: {
          starting: pickEntities(
            sectionMap("itemBuild", "starting")?.entitySlugs,
            dictionaries.items,
          ),
          core: pickEntities(sectionMap("itemBuild", "core")?.entitySlugs, dictionaries.items),
          boots: pickEntities(sectionMap("itemBuild", "boots")?.entitySlugs, dictionaries.items),
          finalBuild: pickEntities(
            sectionMap("itemBuild", "finalBuild")?.entitySlugs,
            dictionaries.items,
          ),
        },
        spellsAndRunes: {
          summonerSpells: pickEntities(
            sectionMap("spellsAndRunes", "summonerSpells")?.entitySlugs,
            dictionaries.summonerSpells,
          ),
          runes: pickEntities(
            sectionMap("spellsAndRunes", "runes")?.entitySlugs,
            dictionaries.runes,
          ),
        },
        situationalItems,
        situationalRunes,
        skillOrder: {
          quickOrder: pickEntities(skillOrder?.quickOrder, dictionaries.abilities),
          rows: skillRows
            .filter((row) => row.variantKey === variant.variantKey)
            .sort((left, right) => left.orderIndex - right.orderIndex)
            .map((row) => ({
              name: row.rowName,
              slug: row.abilitySlug,
              levels: Array.isArray(row.levels) ? row.levels : [],
            })),
        },
        counters: matchups
          .filter(
            (row) => row.variantKey === variant.variantKey && row.matchupType === "counter",
          )
          .sort((left, right) => left.orderIndex - right.orderIndex)
          .map((row) => dictionaries.champions[row.championSlug])
          .filter(Boolean),
        synergies: matchups
          .filter(
            (row) => row.variantKey === variant.variantKey && row.matchupType === "synergy",
          )
          .sort((left, right) => left.orderIndex - right.orderIndex)
          .map((row) => dictionaries.champions[row.championSlug])
          .filter(Boolean),
      };
    });

  const detail = {
    champion: {
      name: summary.name,
      slug: summary.slug,
      title: summary.title || null,
      iconUrl: summary.icon ? buildPublicIconPath(summary.slug, summary.icon) : null,
    },
    metadata: {
      patch: summary.patch || null,
      recommendedRole: summary.recommendedRole || null,
      tier: summary.tier || null,
      blurb: null,
    },
    variants: variantsByKey,
    buildBreakdown: buildBreakdown
      ? {
          featuredItems: pickEntities(buildBreakdown.featuredItemSlugs, dictionaries.items),
          paragraphs: Array.isArray(buildBreakdown.paragraphs)
            ? buildBreakdown.paragraphs
            : [],
        }
      : null,
    official: officialMeta
      ? {
          champion: {
            name: officialMeta.championName || summary.name,
            title: officialMeta.championTitle || summary.title || null,
          },
          roles: Array.isArray(officialMeta.roles) ? officialMeta.roles : [],
          difficulty: officialMeta.difficulty || null,
          heroMedia: {
            remoteVideoUrl: officialMeta.heroRemoteVideoUrl || null,
            localVideoPath: resolvedHeroLocalVideoPath,
          },
        }
      : null,
    abilitiesRu: abilities
      .slice()
      .sort((left, right) => left.orderIndex - right.orderIndex)
      .map((ability) => ({
        name: ability.name,
        slug: ability.abilitySlug,
        subtitle: ability.subtitle || null,
        description: ability.description || null,
        iconUrl: normalizeGuideAssetPath(
          buildGuideAssetKey("guide", summary.slug, ability.abilitySlug, "ability"),
          ability.iconUrl || null,
        ),
        videoUrl: ability.videoUrl || null,
      })),
    dictionaries: {
      items: dictionaries.items,
      runes: dictionaries.runes,
      summonerSpells: dictionaries.summonerSpells,
      abilities: dictionaries.abilities,
    },
  };

  detail.counters = variantsByKey[0]?.counters || [];
  detail.synergies = variantsByKey[0]?.synergies || [];
  detail.itemBuild = variantsByKey[0]?.itemBuild || {
    starting: [],
    core: [],
    boots: [],
    finalBuild: [],
  };
  detail.spellsAndRunes = variantsByKey[0]?.spellsAndRunes || {
    summonerSpells: [],
    runes: [],
  };
  detail.situationalItems = variantsByKey[0]?.situationalItems || [];
  detail.situationalRunes = variantsByKey[0]?.situationalRunes || [];
  detail.skillOrder = variantsByKey[0]?.skillOrder || {
    quickOrder: [],
    rows: [],
  };

  return detail;
}
