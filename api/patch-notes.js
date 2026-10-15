import { and, desc, eq, isNotNull } from "drizzle-orm";

import { db } from "../db/client.js";
import { patchNoteChanges, patchNotes } from "../db/schema.js";
import { setCors } from "./utils/cors.js";

function setPublicCache(res) {
  res.setHeader("Cache-Control", "public, s-maxage=1800, stale-while-revalidate=7200");
}

function setNoStore(res) {
  res.setHeader("Cache-Control", "no-store");
}

function toPublicPatch(row, changes = []) {
  return {
    version: row.patchVersion,
    locale: row.locale,
    title: row.title,
    description: row.description,
    sourceUrl: row.sourceUrl,
    publishedAt: row.publishedAt,
    imageUrl: row.imageUrl,
    changes,
  };
}

const PUBLIC_FIELDS = {
  patchVersion: patchNotes.patchVersion,
  locale: patchNotes.locale,
  title: patchNotes.title,
  description: patchNotes.description,
  sourceUrl: patchNotes.sourceUrl,
  publishedAt: patchNotes.publishedAt,
  imageUrl: patchNotes.imageUrl,
  parsedPayload: patchNotes.parsedPayload,
};

function compareVersions(left, right) {
  const a = String(left).match(/^(\d+)\.(\d+)([a-z]?)$/i) || [];
  const b = String(right).match(/^(\d+)\.(\d+)([a-z]?)$/i) || [];
  return Number(b[1] || 0) - Number(a[1] || 0)
    || Number(b[2] || 0) - Number(a[2] || 0)
    || String(b[3] || "").localeCompare(String(a[3] || ""));
}

export default async function handler(req, res) {
  setCors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") {
    setNoStore(res);
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const version = String(req.params?.version || "").trim().toLowerCase();
    if (version) {
      const rows = await db
        .select(PUBLIC_FIELDS)
        .from(patchNotes)
        .where(eq(patchNotes.patchVersion, version));
      const selected = rows.find((row) => row.locale === "ru-ru" && row.parsedPayload)
        || rows.find((row) => row.locale === "en-us" && row.parsedPayload);
      if (!selected) {
        setNoStore(res);
        return res.status(404).json({ error: "Not Found" });
      }
      const changes = await db
        .select({
          ordinal: patchNoteChanges.ordinal,
          entityKind: patchNoteChanges.entityKind,
          entitySlug: patchNoteChanges.entitySlug,
          entityName: patchNoteChanges.entityName,
          imageUrl: patchNoteChanges.imageUrl,
          changeType: patchNoteChanges.changeType,
          sectionName: patchNoteChanges.sectionName,
          changeName: patchNoteChanges.changeName,
          details: patchNoteChanges.details,
        })
        .from(patchNoteChanges)
        .where(and(
          eq(patchNoteChanges.patchVersion, version),
          eq(patchNoteChanges.locale, selected.locale),
        ))
        .orderBy(patchNoteChanges.ordinal);
      setPublicCache(res);
      return res.status(200).json(toPublicPatch(selected, changes));
    }

    const rows = await db
      .select(PUBLIC_FIELDS)
      .from(patchNotes)
      .where(isNotNull(patchNotes.parsedPayload))
      .orderBy(desc(patchNotes.publishedAt));
    const byVersion = new Map();
    for (const row of rows) {
      if (!row.parsedPayload) continue;
      const current = byVersion.get(row.patchVersion) || {};
      current[row.locale] = row;
      byVersion.set(row.patchVersion, current);
    }
    const previewRows = await db
      .select({
        patchVersion: patchNoteChanges.patchVersion,
        locale: patchNoteChanges.locale,
        entityKind: patchNoteChanges.entityKind,
        entitySlug: patchNoteChanges.entitySlug,
        entityName: patchNoteChanges.entityName,
        imageUrl: patchNoteChanges.imageUrl,
        changeType: patchNoteChanges.changeType,
      })
      .from(patchNoteChanges)
      .orderBy(patchNoteChanges.ordinal);
    const previewsByPatch = new Map();
    for (const row of previewRows) {
      if (!row.imageUrl || (row.entityKind !== "champion" && row.entityKind !== "item")) continue;
      const key = `${row.patchVersion}:${row.locale}`;
      const previews = previewsByPatch.get(key) || {
        new: [], buff: [], adjustment: [], nerf: [], removed: [], seen: new Set(),
      };
      const identity = `${row.entityKind}:${row.entitySlug || row.entityName}`;
      const tone = ["new", "buff", "adjustment", "nerf", "removed"].includes(row.changeType)
        ? row.changeType
        : "adjustment";
      const previewKey = `${tone}:${identity}`;
      if (!previews.seen.has(previewKey)) {
        previews.seen.add(previewKey);
        previews[tone].push({
          entityKind: row.entityKind,
          entitySlug: row.entitySlug,
          entityName: row.entityName,
          imageUrl: row.imageUrl,
        });
      }
      previewsByPatch.set(key, previews);
    }
    const items = Array.from(byVersion.entries())
      .map(([patchVersion, locales]) => {
        const selected = locales["ru-ru"] || locales["en-us"];
        return {
          version: patchVersion,
          locale: selected.locale,
          title: selected.title,
          description: selected.description,
          sourceUrl: selected.sourceUrl,
          publishedAt: selected.publishedAt,
          imageUrl: selected.imageUrl,
          availableLocales: Object.keys(locales),
          iconPreviews: (() => {
            const previews = previewsByPatch.get(`${patchVersion}:${selected.locale}`);
            if (!previews) return { new: [], buff: [], adjustment: [], nerf: [], removed: [] };
            return {
              new: previews.new,
              buff: previews.buff,
              adjustment: previews.adjustment,
              nerf: previews.nerf,
              removed: previews.removed,
            };
          })(),
        };
      })
      .sort((a, b) => {
        const dateDiff = new Date(b.publishedAt || 0).getTime() - new Date(a.publishedAt || 0).getTime();
        return dateDiff || compareVersions(a.version, b.version);
      });
    setPublicCache(res);
    return res.status(200).json({ count: items.length, items });
  } catch (error) {
    console.error("[wr-api] /api/patch-notes error:", error);
    setNoStore(res);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}
