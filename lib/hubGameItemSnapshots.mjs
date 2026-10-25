import { createHash } from "node:crypto";
import { load } from "cheerio";
import { parseHubGameItemCatalog } from "./hubGameItemCatalog.mjs";

export const HUB_GAME_ITEMS_DATASET = "items";
export const HUB_GAME_ITEMS_CATALOG_URL = "https://hub-game.com/wildrift/en/items";

function stableHash(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

/** Get every detail-page link present in the Hub catalog, independently of sitemap coverage. */
export function parseHubGameItemCatalogIndex(html, sourceUrl = HUB_GAME_ITEMS_CATALOG_URL) {
  const catalog = parseHubGameItemCatalog(html, sourceUrl);
  const $ = load(html);
  const linksByUrl = new Map();
  for (const element of $("a[href]").toArray()) {
    const href = $(element).attr("href");
    if (!href) continue;
    const url = new URL(href, sourceUrl);
    const pathParts = url.pathname.split("/").filter(Boolean);
    if (url.hostname !== new URL(sourceUrl).hostname
      || url.protocol !== "https:"
      || pathParts.length !== 4
      || pathParts[0] !== "wildrift"
      || pathParts[1] !== "en"
      || pathParts[2] !== "items"
      || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(pathParts[3])) continue;
    const canonicalUrl = `https://${url.hostname}${url.pathname}`;
    const name = $(element).attr("title") || $(element).text();
    const existing = linksByUrl.get(canonicalUrl);
    if (existing && existing.name !== name.trim()) {
      throw new Error(`Hub Game item detail link has conflicting labels: ${canonicalUrl}`);
    }
    linksByUrl.set(canonicalUrl, { url: canonicalUrl, name: name.trim() });
  }
  const links = [...linksByUrl.values()];
  if (!links.length) throw new Error("Hub Game item catalog contains no detail-page links");
  return {
    sourceUrl,
    version: catalog.version,
    date: catalog.date,
    count: catalog.count,
    items: catalog.items,
    detailLinks: links,
  };
}

function requireText(value, field) {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(`${field} must be a non-empty string`);
  return value.trim();
}

function assertDetailSnapshotVersion(item, version, date) {
  const isExplicitRemoval = item.availability === "removed" && Boolean(item.removedInPatch);
  if (!isExplicitRemoval && (item.source.snapshot?.version !== version || item.source.snapshot?.updatedAt !== date)) {
    throw new Error(`Hub item source snapshot does not match catalog snapshot: ${item.slug}`);
  }
}

function assertDetailLinkName(link, item, sourceUrl) {
  if (link.name && link.name !== item.name) {
    throw new Error(`Hub item detail name does not match catalog link: ${sourceUrl}`);
  }
}

function normalizeDetailPages(detailPages, detailLinks, version, date) {
  if (!Array.isArray(detailPages) || detailPages.length !== detailLinks.length) {
    throw new Error(`Hub item detail coverage mismatch: expected ${detailLinks.length}, parsed ${detailPages?.length ?? 0}`);
  }
  const links = new Map(detailLinks.map((link) => [link.url, link]));
  const byName = new Map();
  const bySlug = new Set();
  for (const item of detailPages) {
    const sourceUrl = requireText(item?.source?.url, "item.source.url");
    const link = links.get(sourceUrl);
    if (!link) throw new Error(`Hub item detail came from an unrequested URL: ${sourceUrl}`);
    assertDetailSnapshotVersion(item, version, date);
    assertDetailLinkName(link, item, sourceUrl);
    const slug = requireText(item.slug, "item.slug");
    if (bySlug.has(slug) || byName.has(item.name)) throw new Error(`Duplicate Hub item detail identity: ${slug}`);
    bySlug.add(slug);
    byName.set(item.name, item);
    links.delete(sourceUrl);
  }
  if (links.size) throw new Error(`Hub item details were not parsed: ${[...links.keys()].join(", ")}`);
  return byName;
}

function stateFromDetail(item) {
  return {
    name: item.name,
    image: item.image,
    cost: item.cost,
    stats: item.stats,
    effects: item.effects,
    passives: item.passives,
    actives: item.actives,
    dataCoverage: "detail-page",
    sourceHistory: {
      coverage: item.historyCoverage,
      entries: item.history,
    },
  };
}

function stateFromRemoval(item) {
  return {
    name: item.name,
    availability: "removed",
    removedInPatch: item.removedInPatch,
    lastKnownState: {
      image: item.image,
      cost: item.cost,
      stats: item.stats,
      effects: item.effects,
      passives: item.passives,
      actives: item.actives,
    },
    dataCoverage: "explicit-removal-with-last-known-values",
    sourceHistory: {
      coverage: item.historyCoverage,
      entries: item.history,
    },
  };
}

function stateFromCatalogCard(item) {
  const effects = Array.isArray(item.passives) ? item.passives : [];
  return {
    name: item.name,
    image: item.image,
    cost: item.cost,
    stats: item.stats,
    effects,
    passives: effects.filter((effect) => effect.type?.toLowerCase() === "passive"),
    actives: effects.filter((effect) => effect.type?.toLowerCase() === "active"),
    dataCoverage: "catalog-card-only",
    sourceHistory: {
      coverage: "not-provided-on-catalog-card",
      entries: [],
    },
  };
}

function rowState(item, card) {
  if (!item) return stateFromCatalogCard(card);
  return item.availability === "removed" ? stateFromRemoval(item) : stateFromDetail(item);
}

function evidenceForItem(item, sourceEvidenceBase) {
  const evidence = [sourceEvidenceBase];
  if (!item) return evidence;
  evidence.push({
    kind: "hub-game",
    role: "item-detail",
    url: item.source.url,
    sourcePatchVersion: item.source.snapshot.version,
    sourceUpdatedAt: item.source.snapshot.updatedAt,
    visibleHistoryEntryCount: item.history.length,
    historyCoverage: item.historyCoverage,
    availability: item.availability,
    removedInPatch: item.removedInPatch,
  });
  return evidence;
}

function snapshotRow(card, context) {
  const name = requireText(card.name, "catalog item name");
  if (context.catalogNames.has(name)) throw new Error(`Duplicate Hub catalog item name: ${name}`);
  context.catalogNames.add(name);
  const item = context.detailByName.get(name);
  const isRemoved = item?.availability === "removed";
  if (!item) context.counters.catalogOnlyRows += 1;
  else if (isRemoved) context.counters.removedRows += 1;
  else context.counters.detailPageRows += 1;

  const entitySlug = item?.slug ?? requireText(card.slug, `catalog item ${name} slug`);
  const state = rowState(item, card);
  const row = {
    patchVersion: context.patchVersion,
    dataset: HUB_GAME_ITEMS_DATASET,
    entityKind: "item",
    entitySlug,
    state,
    sourceKind: "hub-game",
    sourceUrl: item?.source.url ?? context.catalogSourceUrl,
    sourcePatchVersion: isRemoved ? item.removedInPatch : (item?.source.snapshot.version ?? context.patchVersion),
    sourceUpdatedAt: item?.source.snapshot.updatedAt ?? context.sourceUpdatedAt,
    verificationStatus: item && !isRemoved ? "verified" : "partial",
    sourceEvidence: evidenceForItem(item, context.sourceEvidenceBase),
  };
  row.contentHash = stableHash(state);
  return row;
}

/** Build only the explicitly observed current Hub patch rows; prior states are never inferred from partial history. */
export function buildHubGameItemSnapshotRows(catalogIndex, detailPages) {
  if (!catalogIndex || typeof catalogIndex !== "object") {
    throw new TypeError("A parsed Hub Game item catalog index is required");
  }
  const patchVersion = requireText(catalogIndex.version, "catalogIndex.version");
  const sourceUpdatedAt = requireText(catalogIndex.date, "catalogIndex.date");
  const catalogSourceUrl = requireText(catalogIndex.sourceUrl, "catalogIndex.sourceUrl");
  const catalogItems = catalogIndex.items;
  const detailLinks = catalogIndex.detailLinks;
  if (!Array.isArray(catalogItems) || catalogItems.length !== catalogIndex.count || catalogItems.length === 0) {
    throw new Error("Hub Game item catalog has an invalid item count");
  }
  const detailByName = normalizeDetailPages(detailPages, detailLinks, patchVersion, sourceUpdatedAt);
  const catalogNames = new Set();
  const sourceEvidenceBase = {
    kind: "hub-game",
    role: "item-catalog",
    url: catalogSourceUrl,
    sourcePatchVersion: patchVersion,
    sourceUpdatedAt,
    listedItemCount: catalogItems.length,
    linkedDetailPageCount: detailLinks.length,
  };
  const counters = { detailPageRows: 0, removedRows: 0, catalogOnlyRows: 0 };
  const context = {
    patchVersion,
    sourceUpdatedAt,
    catalogSourceUrl,
    detailByName,
    catalogNames,
    sourceEvidenceBase,
    counters,
  };
  const rows = catalogItems.map((card) => snapshotRow(card, context));

  const listedDetailsFound = [...detailByName.keys()].filter((name) => catalogNames.has(name)).length;
  if (listedDetailsFound !== detailByName.size) throw new Error("Hub item detail pages are not all represented in the catalog");
  return {
    rows,
    coverage: {
      patchVersion,
      sourceUpdatedAt,
      catalogItemCount: catalogItems.length,
      linkedDetailPageCount: detailLinks.length,
      parsedDetailPageCount: detailPages.length,
      currentDetailPageSnapshotCount: counters.detailPageRows,
      explicitlyRemovedDetailPageCount: counters.removedRows,
      catalogOnlySnapshotCount: counters.catalogOnlyRows,
      snapshotRowCount: rows.length,
      verifiedSnapshotRowCount: rows.length - counters.removedRows - counters.catalogOnlyRows,
      partialSnapshotRowCount: counters.removedRows + counters.catalogOnlyRows,
      currentDetailPageCoveragePercent: Number(((counters.detailPageRows / catalogItems.length) * 100).toFixed(1)),
      parsedDetailPageCoveragePercent: Number(((detailPages.length / detailLinks.length) * 100).toFixed(1)),
      catalogIdentityRowCoveragePercent: Number(((rows.length / catalogItems.length) * 100).toFixed(1)),
      historicalVersionsCreated: 0,
    },
  };
}
