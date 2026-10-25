import { load } from "cheerio";

function patchVersionFromHref(href) {
  const slug = String(href || "").match(/\/patch\/wild-rift-patch-notes-(\d+-\d+(?:-[a-z]+|[a-z])?)\/?$/i)?.[1];
  if (!slug) return null;
  const match = slug.match(/^(\d+)-(\d+)(?:-([a-z]+)|([a-z]))?$/i);
  if (!match) return null;
  const suffix = match[3] ? `-${match[3].toLowerCase()}` : (match[4] || "").toLowerCase();
  return `${match[1]}.${match[2]}${suffix}`;
}

function readCount($, card, tone) {
  const node = $(card).find(`.text-${tone}`).first();
  const number = node.text().match(/\d+/)?.[0];
  return number ? Number(number) : 0;
}

/** Read the champion buff/nerf/other counts shown on RiftPatchNotes' patch index. */
export function parseRiftPatchNotesCounts(html) {
  const $ = load(String(html || ""));
  const byVersion = new Map();
  for (const card of $("a[href^='/patch/wild-rift-patch-notes-']").toArray()) {
    if (!$(card).find("h2").length) continue;
    const patchVersion = patchVersionFromHref($(card).attr("href"));
    if (!patchVersion) continue;
    const totalMatch = $(card).find("span").toArray()
      .map((node) => $(node).text().replace(/\s+/g, " ").trim().match(/\b(\d+)\s+champions?\b/i))
      .find(Boolean);
    const counts = {
      buff: readCount($, card, "buff"),
      nerf: readCount($, card, "nerf"),
      other: readCount($, card, "adjust"),
    };
    const candidate = {
      patchVersion,
      totalChampions: totalMatch ? Number(totalMatch[1]) : Object.values(counts).reduce((sum, count) => sum + count, 0),
      hasExplicitChampionTotal: Boolean(totalMatch),
      counts,
    };
    const existing = byVersion.get(patchVersion);
    if (!existing || (!existing.hasExplicitChampionTotal && candidate.hasExplicitChampionTotal)) {
      byVersion.set(patchVersion, candidate);
    }
  }
  return [...byVersion.values()];
}
