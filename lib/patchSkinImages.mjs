import { load } from "cheerio";

const RIOT_ORIGIN = "https://wildrift.leagueoflegends.com";
const skinGalleryCache = new Map();

function normalizeSkinLabel(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function parseSkinGallery(html) {
  const data = load(html)("#__NEXT_DATA__").text();
  const page = JSON.parse(data)?.props?.pageProps?.page;
  const carousel = page?.blades?.find((blade) => blade.type === "landingMediaCarousel");
  return (carousel?.groups || []).map((group) => ({
    label: normalizeSkinLabel(group.label),
    imageUrl: group.content?.media?.url || null,
  })).filter((entry) => entry.label && isRiotCdnUrl(entry.imageUrl));
}

function isRiotCdnUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "cmsassets.rgpub.io";
  } catch {
    return false;
  }
}

export function extractRiotSkinImageSource(value) {
  try {
    const url = new URL(String(value || ""), RIOT_ORIGIN);
    if (isRiotCdnUrl(url.toString())) return url.toString();
    const source = url.searchParams.get("src");
    return isRiotCdnUrl(source) ? new URL(source).toString() : null;
  } catch {
    return null;
  }
}

async function loadSkinGallery(championSlug) {
  if (!skinGalleryCache.has(championSlug)) {
    const url = `${RIOT_ORIGIN}/en-us/champions/${encodeURIComponent(championSlug)}/`;
    const request = fetch(url, {
      headers: { "user-agent": "WildRiftAllStatsPatchNotesBot/1.0 (+https://wildriftallstats.ru)" },
      signal: AbortSignal.timeout(30_000),
    }).then(async (response) => {
      if (!response.ok) throw new Error(`Riot champion gallery returned HTTP ${response.status}`);
      return parseSkinGallery(await response.text());
    }).catch(() => []);
    skinGalleryCache.set(championSlug, request);
  }
  return skinGalleryCache.get(championSlug);
}

function getSkinLabelCandidates(change) {
  const labels = [normalizeSkinLabel(change.entityName)];
  const championSlug = change.sourceChampionSlug || String(change.entitySlug || "").split("-")[0];
  const prefix = `${championSlug}-`;
  if (championSlug && change.entitySlug?.startsWith(prefix)) {
    labels.push(normalizeSkinLabel(change.entitySlug.slice(prefix.length).replace(/-/g, " ")));
  }
  return new Set(labels.filter(Boolean));
}

export async function enrichPatchSkinImages(changes, englishChanges = []) {
  const englishImageBySlug = new Map((englishChanges || [])
    .filter((change) => change.entityKind === "skin" && extractRiotSkinImageSource(change.imageUrl))
    .map((change) => [change.entitySlug, extractRiotSkinImageSource(change.imageUrl)]));
  const galleries = new Map();
  const skins = (changes || []).filter((change) => change.entityKind === "skin"
    && (change.sourceChampionSlug || change.entitySlug));
  await Promise.all(skins.map(async (change) => {
    const championSlug = change.sourceChampionSlug || String(change.entitySlug || "").split("-")[0];
    if (!galleries.has(championSlug)) {
      galleries.set(championSlug, await loadSkinGallery(championSlug));
    }
  }));

  return (changes || []).map((change) => {
    if (change.entityKind !== "skin") return change;
    if (isRiotCdnUrl(change.sourceImageUrl)) return change;
    const gallery = galleries.get(change.sourceChampionSlug || String(change.entitySlug || "").split("-")[0]) || [];
    const candidates = getSkinLabelCandidates(change);
    const imageUrl = gallery.find((entry) => candidates.has(entry.label))?.imageUrl
      || englishImageBySlug.get(change.entitySlug)
      || null;
    return imageUrl ? { ...change, sourceImageUrl: imageUrl } : change;
  });
}
