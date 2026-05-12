import { and, asc, desc, eq } from "drizzle-orm";

import { db } from "../db/client.js";
import {
  championStatsHistory,
  champions,
  siteUsers,
  streamerTierlistPublications,
} from "../db/schema.js";
import { buildPublicIconPath } from "./championIcons.mjs";
import { resolveChampionLocalizedName } from "./championLocalization.mjs";
import { filterChampionsForPublicPool } from "./championPublicPool.mjs";
import { getLatestCompletedChampionStatsSnapshot } from "./statsSnapshots.mjs";

export const STREAMER_TIERLIST_LANE_KEYS = Object.freeze([
  "top",
  "jungle",
  "mid",
  "adc",
  "support",
]);

export const STREAMER_TIERLIST_TIERS = Object.freeze([
  "S+",
  "S",
  "A",
  "B",
  "C",
  "D",
]);

const LANE_KEY_SET = new Set(STREAMER_TIERLIST_LANE_KEYS);
const TIER_KEY_SET = new Set(STREAMER_TIERLIST_TIERS);
const STREAMER_META_RANK_KEY = "overall";
const STREAMER_PUBLICATION_TIME_ZONE = "Europe/Moscow";

function toIsoString(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function toDateString(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const text = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function normalizeLaneKey(value) {
  const laneKey = String(value || "").trim().toLowerCase();
  return LANE_KEY_SET.has(laneKey) ? laneKey : null;
}

function normalizeTierKey(value) {
  const tierKey = String(value || "").trim().toUpperCase();
  return TIER_KEY_SET.has(tierKey) ? tierKey : null;
}

function normalizeSiteUserId(value) {
  const siteUserId = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(siteUserId) && siteUserId > 0 ? siteUserId : null;
}

function getCalendarDateKey(value, timeZone = STREAMER_PUBLICATION_TIME_ZONE) {
  if (!value) return null;

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  return year && month && day ? `${year}-${month}-${day}` : null;
}

function getTimeValue(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  const time = date.getTime();
  return Number.isNaN(time) ? null : time;
}

function arePublicationPayloadsEqual(left, right) {
  try {
    return JSON.stringify(sanitizePublicationPayload(left)) === JSON.stringify(sanitizePublicationPayload(right));
  } catch {
    return false;
  }
}

function mergePublicationRowsByDay(rows = []) {
  const groups = [];

  for (const row of rows) {
    const dayKey = getCalendarDateKey(row?.publishedAt) || `row-${row?.id || groups.length}`;
    const lastGroup = groups[groups.length - 1];

    if (lastGroup && lastGroup.dayKey === dayKey) {
      lastGroup.rows.push(row);
      continue;
    }

    groups.push({ dayKey, rows: [row] });
  }

  return groups
    .map(({ rows: groupedRows }) => {
      const latestRow = groupedRows[0];
      const earliestRow = groupedRows[groupedRows.length - 1];
      if (!latestRow || !earliestRow) return null;

      const earliestPublishedAt = earliestRow.publishedAt || latestRow.publishedAt || null;
      let latestActivityAt = latestRow.editedAt || latestRow.publishedAt || null;

      for (const row of groupedRows) {
        const candidate = row?.editedAt || row?.publishedAt || null;
        const candidateTime = getTimeValue(candidate);
        const latestTime = getTimeValue(latestActivityAt);
        if (candidateTime != null && (latestTime == null || candidateTime > latestTime)) {
          latestActivityAt = candidate;
        }
      }

      const editedAt =
        groupedRows.length > 1 &&
        latestActivityAt &&
        latestActivityAt !== earliestPublishedAt
          ? latestActivityAt
          : latestRow.editedAt || null;

      return {
        ...latestRow,
        publishedAt: earliestPublishedAt,
        editedAt,
      };
    })
    .filter(Boolean);
}

function createEmptyTierBuckets() {
  return Object.fromEntries(STREAMER_TIERLIST_TIERS.map((tier) => [tier, []]));
}

function createEmptyPublishedPayload() {
  return {
    version: 1,
    tiersOrder: [...STREAMER_TIERLIST_TIERS],
    lanes: Object.fromEntries(
      STREAMER_TIERLIST_LANE_KEYS.map((lane) => [
        lane,
        {
          lane,
          tiers: createEmptyTierBuckets(),
        },
      ]),
    ),
  };
}

function sanitizePublicationPayload(rawPayload) {
  const payload = createEmptyPublishedPayload();
  const sourceLanes =
    rawPayload && typeof rawPayload === "object" && rawPayload.lanes && typeof rawPayload.lanes === "object"
      ? rawPayload.lanes
      : {};

  for (const lane of STREAMER_TIERLIST_LANE_KEYS) {
    const laneSource = sourceLanes[lane];
    const sourceTiers =
      laneSource && typeof laneSource === "object" && laneSource.tiers && typeof laneSource.tiers === "object"
        ? laneSource.tiers
        : laneSource && typeof laneSource === "object"
          ? laneSource
          : {};
    const seen = new Set();

    for (const tier of STREAMER_TIERLIST_TIERS) {
      const entries = Array.isArray(sourceTiers[tier]) ? sourceTiers[tier] : [];

      payload.lanes[lane].tiers[tier] = entries
        .map((entry) => ({
          slug: String(entry?.slug || "").trim().toLowerCase(),
          name: String(entry?.name || "").trim(),
          iconUrl: String(entry?.iconUrl || "").trim() || null,
          roles: Array.isArray(entry?.roles)
            ? entry.roles
                .map((role) => String(role || "").trim().toLowerCase())
                .filter(Boolean)
            : [],
        }))
        .filter((entry) => {
          if (!entry.slug || !entry.name || seen.has(entry.slug)) return false;
          seen.add(entry.slug);
          return true;
        });
    }
  }

  return payload;
}

export function sanitizeStreamerTierlistSubmission(input, championMap) {
  const payload = createEmptyPublishedPayload();
  const sourceLanes =
    input && typeof input === "object" && input.lanes && typeof input.lanes === "object"
      ? input.lanes
      : {};

  for (const lane of STREAMER_TIERLIST_LANE_KEYS) {
    const laneSource =
      sourceLanes[lane] && typeof sourceLanes[lane] === "object" ? sourceLanes[lane] : {};
    const sourceTiers =
      laneSource.tiers && typeof laneSource.tiers === "object" ? laneSource.tiers : laneSource;
    const seen = new Set();

    for (const tier of STREAMER_TIERLIST_TIERS) {
      const entries = Array.isArray(sourceTiers[tier]) ? sourceTiers[tier] : [];
      payload.lanes[lane].tiers[tier] = entries
        .map((slug) => String(slug || "").trim().toLowerCase())
        .filter((slug) => {
          if (!slug || seen.has(slug) || !championMap.has(slug)) return false;
          seen.add(slug);
          return true;
        })
        .map((slug) => {
          const champion = championMap.get(slug);
          return {
            slug: champion.slug,
            name: champion.name,
            iconUrl: champion.iconUrl || null,
            roles: Array.isArray(champion.roles) ? champion.roles : [],
          };
        });
    }
  }

  return payload;
}

function toPublicationView(row) {
  if (!row) return null;

  return {
    id: row.id,
    siteUserId: row.siteUserId,
    sourceStatsSnapshotId: row.sourceStatsSnapshotId || null,
    sourceStatsDate: toDateString(row.sourceStatsDate),
    editedAt: toIsoString(row.editedAt),
    publishedAt: toIsoString(row.publishedAt),
    payload: sanitizePublicationPayload(row.payload),
  };
}

function toHistoryItem(row) {
  if (!row) return null;

  return {
    id: row.id,
    sourceStatsSnapshotId: row.sourceStatsSnapshotId || null,
    sourceStatsDate: toDateString(row.sourceStatsDate),
    editedAt: toIsoString(row.editedAt),
    publishedAt: toIsoString(row.publishedAt),
  };
}

function toStreamerView(user) {
  if (!user) return null;

  return {
    id: user.id,
    displayName: String(user.streamerDisplayName || "").trim() || `Стример #${user.id}`,
    avatarUrl: String(user.avatarUrl || "").trim() || null,
    wildRiftHandle: null,
  };
}

export async function buildStreamerChampionCatalog(lang = "ru_ru", env = process.env) {
  const championRows = filterChampionsForPublicPool(
    await db
      .select({
        slug: champions.slug,
        name: champions.name,
        nameLocalizations: champions.nameLocalizations,
        roles: champions.roles,
        icon: champions.icon,
      })
      .from(champions),
  );

  return championRows
    .map((champion) => ({
      slug: champion.slug,
      name: resolveChampionLocalizedName({
        slug: champion.slug,
        lang,
        nameLocalizations: champion.nameLocalizations || {},
        fallbackName: champion.name,
      }),
      roles: Array.isArray(champion.roles)
        ? champion.roles
            .map((role) => String(role || "").trim().toLowerCase())
            .filter(Boolean)
        : [],
      iconUrl: champion.icon ? buildPublicIconPath(champion.slug, champion.icon, env) : null,
    }))
    .sort((left, right) => left.name.localeCompare(right.name, "ru"));
}

async function fetchSiteUserById(siteUserId) {
  const [user] = await db.select().from(siteUsers).where(eq(siteUsers.id, siteUserId)).limit(1);
  return user || null;
}

async function fetchPublicationRowsForSiteUser(siteUserId, limit = 10) {
  return await db
    .select()
    .from(streamerTierlistPublications)
    .where(eq(streamerTierlistPublications.siteUserId, siteUserId))
    .orderBy(
      desc(streamerTierlistPublications.publishedAt),
      desc(streamerTierlistPublications.id),
    )
    .limit(limit);
}

async function fetchLatestMetaChampionSlugsByLane(snapshotId) {
  const empty = Object.fromEntries(STREAMER_TIERLIST_LANE_KEYS.map((lane) => [lane, []]));
  if (!snapshotId) {
    return empty;
  }

  const rows = await db
    .select({
      slug: championStatsHistory.slug,
      lane: championStatsHistory.lane,
      position: championStatsHistory.position,
      strengthLevel: championStatsHistory.strengthLevel,
      winRate: championStatsHistory.winRate,
      pickRate: championStatsHistory.pickRate,
    })
    .from(championStatsHistory)
    .where(
      and(
        eq(championStatsHistory.snapshotId, snapshotId),
        eq(championStatsHistory.rank, STREAMER_META_RANK_KEY),
      ),
    )
    .orderBy(
      asc(championStatsHistory.lane),
      asc(championStatsHistory.position),
      asc(championStatsHistory.strengthLevel),
      desc(championStatsHistory.winRate),
      desc(championStatsHistory.pickRate),
      asc(championStatsHistory.slug),
    );

  const byLane = new Map(STREAMER_TIERLIST_LANE_KEYS.map((lane) => [lane, []]));
  const seenByLane = new Map(STREAMER_TIERLIST_LANE_KEYS.map((lane) => [lane, new Set()]));

  for (const row of rows) {
    const lane = normalizeLaneKey(row?.lane);
    const slug = String(row?.slug || "").trim().toLowerCase();
    if (!lane || !slug) continue;

    const seen = seenByLane.get(lane);
    if (!seen || seen.has(slug)) continue;
    seen.add(slug);
    byLane.get(lane).push(slug);
  }

  return Object.fromEntries(
    STREAMER_TIERLIST_LANE_KEYS.map((lane) => [lane, byLane.get(lane) || []]),
  );
}

export async function loadStreamerTierlistEditor(siteUserId, { lang = "ru_ru", env = process.env } = {}) {
  const normalizedSiteUserId = normalizeSiteUserId(siteUserId);
  if (!normalizedSiteUserId) {
    throw new Error("invalid_site_user");
  }

  const [user, latestSnapshot, championsCatalog, historyRows] = await Promise.all([
    fetchSiteUserById(normalizedSiteUserId),
    getLatestCompletedChampionStatsSnapshot(),
    buildStreamerChampionCatalog(lang, env),
    fetchPublicationRowsForSiteUser(normalizedSiteUserId, 12),
  ]);

  if (!user) {
    throw new Error("site_user_not_found");
  }

  const mergedHistoryRows = mergePublicationRowsByDay(historyRows);
  const currentPublication = mergedHistoryRows.length ? toPublicationView(mergedHistoryRows[0]) : null;
  const metaChampionSlugsByLane = await fetchLatestMetaChampionSlugsByLane(latestSnapshot?.id || null);

  return {
    streamer: toStreamerView(user),
    sourceSnapshot: latestSnapshot
      ? {
          id: latestSnapshot.id,
          statsDate: toDateString(latestSnapshot.statsDate),
          completedAt: toIsoString(latestSnapshot.completedAt),
        }
      : null,
    tiersOrder: [...STREAMER_TIERLIST_TIERS],
    laneKeys: [...STREAMER_TIERLIST_LANE_KEYS],
    champions: championsCatalog,
    metaChampionSlugsByLane,
    currentPublication,
    history: mergedHistoryRows.map(toHistoryItem).filter(Boolean),
  };
}

export async function publishStreamerTierlist(siteUserId, submission, { lang = "ru_ru", env = process.env } = {}) {
  const normalizedSiteUserId = normalizeSiteUserId(siteUserId);
  if (!normalizedSiteUserId) {
    throw new Error("invalid_site_user");
  }

  const [user, latestSnapshot, championsCatalog, latestPublicationRow] = await Promise.all([
    fetchSiteUserById(normalizedSiteUserId),
    getLatestCompletedChampionStatsSnapshot(),
    buildStreamerChampionCatalog(lang, env),
    fetchPublicationRowsForSiteUser(normalizedSiteUserId, 1).then((rows) => rows[0] || null),
  ]);

  if (!user) {
    throw new Error("site_user_not_found");
  }

  const championMap = new Map(championsCatalog.map((champion) => [champion.slug, champion]));
  const payload = sanitizeStreamerTierlistSubmission(submission, championMap);
  const now = new Date();
  const nowDayKey = getCalendarDateKey(now);
  const latestPublicationDayKey = getCalendarDateKey(latestPublicationRow?.publishedAt);
  const shouldUpdateExisting =
    Boolean(latestPublicationRow?.id) &&
    Boolean(nowDayKey) &&
    nowDayKey === latestPublicationDayKey;

  if (shouldUpdateExisting && latestPublicationRow) {
    const hasPayloadDelta = !arePublicationPayloadsEqual(latestPublicationRow.payload, payload);
    const hasSnapshotDelta =
      (latestPublicationRow.sourceStatsSnapshotId || null) !== (latestSnapshot?.id || null) ||
      toDateString(latestPublicationRow.sourceStatsDate) !== toDateString(latestSnapshot?.statsDate || null);

    if (!hasPayloadDelta && !hasSnapshotDelta) {
      return {
        publication: toPublicationView(latestPublicationRow),
        publishAction: "unchanged",
      };
    }

    const [updated] = await db
      .update(streamerTierlistPublications)
      .set({
        sourceStatsSnapshotId: latestSnapshot?.id || null,
        sourceStatsDate: latestSnapshot?.statsDate || null,
        payload,
        editedAt: now,
      })
      .where(eq(streamerTierlistPublications.id, latestPublicationRow.id))
      .returning();

    return {
      publication: toPublicationView(updated),
      publishAction: "updated",
    };
  }

  const [inserted] = await db
    .insert(streamerTierlistPublications)
    .values({
      siteUserId: normalizedSiteUserId,
      sourceStatsSnapshotId: latestSnapshot?.id || null,
      sourceStatsDate: latestSnapshot?.statsDate || null,
      payload,
      editedAt: null,
      publishedAt: now,
    })
    .returning();

  return {
    publication: toPublicationView(inserted),
    publishAction: "created",
  };
}

export async function listLatestStreamerTierlists() {
  const publicationRows = await db
    .select()
    .from(streamerTierlistPublications)
    .orderBy(
      desc(streamerTierlistPublications.publishedAt),
      desc(streamerTierlistPublications.id),
    );

  if (!publicationRows.length) {
    return [];
  }

  const latestRowsByUserId = new Map();
  const rowsByUserId = new Map();

  for (const row of publicationRows) {
    if (!rowsByUserId.has(row.siteUserId)) {
      rowsByUserId.set(row.siteUserId, []);
    }

    rowsByUserId.get(row.siteUserId).push(row);
  }

  for (const [siteUserId, rows] of rowsByUserId) {
    const [latestRow] = mergePublicationRowsByDay(rows);
    if (latestRow) {
      latestRowsByUserId.set(siteUserId, latestRow);
    }
  }

  const siteUserIds = Array.from(latestRowsByUserId.keys());
  const users = await db.select().from(siteUsers);
  const usersById = new Map(users.map((user) => [user.id, user]));

  return siteUserIds
    .map((siteUserId) => {
      const row = latestRowsByUserId.get(siteUserId);
      const user = usersById.get(siteUserId);
      if (!row || !user) return null;

      return {
        streamer: toStreamerView(user),
        currentPublication: {
          id: row.id,
          sourceStatsSnapshotId: row.sourceStatsSnapshotId || null,
          sourceStatsDate: toDateString(row.sourceStatsDate),
          editedAt: toIsoString(row.editedAt),
          publishedAt: toIsoString(row.publishedAt),
        },
      };
    })
    .filter(Boolean);
}

export async function getCurrentStreamerTierlist(siteUserId, { historyLimit = 8 } = {}) {
  const normalizedSiteUserId = normalizeSiteUserId(siteUserId);
  if (!normalizedSiteUserId) {
    throw new Error("invalid_site_user");
  }

  const [user, publicationRows] = await Promise.all([
    fetchSiteUserById(normalizedSiteUserId),
    fetchPublicationRowsForSiteUser(normalizedSiteUserId, historyLimit),
  ]);

  if (!user) {
    throw new Error("site_user_not_found");
  }

  if (!publicationRows.length) {
    return null;
  }

  const mergedPublicationRows = mergePublicationRowsByDay(publicationRows);

  return {
    streamer: toStreamerView(user),
    currentPublication: toPublicationView(mergedPublicationRows[0]),
    history: mergedPublicationRows.map(toHistoryItem).filter(Boolean),
  };
}

export function streamerUserHasAccess(user) {
  const roleSet = new Set(
    Array.isArray(user?.roles)
      ? user.roles.map((role) => String(role || "").trim().toLowerCase()).filter(Boolean)
      : [],
  );

  return roleSet.has("owner") || roleSet.has("streamer");
}

export function isValidStreamerTierlistRequest(query = {}) {
  const siteUserId = normalizeSiteUserId(query?.siteUserId);
  return siteUserId;
}

export function parseStreamerTierlistLane(value) {
  return normalizeLaneKey(value);
}

export function parseStreamerTierlistTier(value) {
  return normalizeTierKey(value);
}
