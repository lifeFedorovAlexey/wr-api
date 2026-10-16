import { load } from "cheerio";

const RIOT_ORIGIN = "https://wildrift.leagueoflegends.com";
const skinGalleryCache = new Map();
const SKIN_GALLERY_LABEL_ALIASES = new Map([
  [normalizeSkinLabel("Ashen Avenger Samira"), "Ashen Knight Samira"],
  [normalizeSkinLabel("Защитник растений Сион"), "Plant Protector Sion"],
  [normalizeSkinLabel("Пепельная мстительница Самира"), "ashen knight samira"],
  [normalizeSkinLabel("Тусовая Талия"), "Pool Party Taliyah"],
  [normalizeSkinLabel("Неоновая сорвиголова Кай'Са"), "Neon Daredevil Kai'Sa"],
  [normalizeSkinLabel("Неоновый сорвиголова Гекарим"), "Neon Daredevil Hecarim"],
  [normalizeSkinLabel("Неоновая сорвиголова Ирелия"), "Neon Daredevil Irelia"],
  [normalizeSkinLabel("Неоновая сорвиголова Аврора"), "Neon Daredevil Aurora"],
  [normalizeSkinLabel("Неоновый сорвиголова Зед"), "Neon Daredevil Zed"],
  [normalizeSkinLabel("Неоновый сорвиголова Грагас"), "Neon Daredevil Gragas"],
  [normalizeSkinLabel("Дракомант Вейн"), "Dragonmancer Vayne"],
  [normalizeSkinLabel("Дракомант Фиора"), "Dragonmancer Fiora"],
  [normalizeSkinLabel("Дракомант Нила"), "Dragonmancer Nilah"],
  [normalizeSkinLabel("Мэл, Признание в любви"), "Confession Melody Mel"],
  [normalizeSkinLabel("Джейс, Признание в любви"), "Confession Melody Jayce"],
  [normalizeSkinLabel("Love Confession Mel"), "Confession Melody Mel"],
  [normalizeSkinLabel("Love Confession Jayce"), "Confession Melody Jayce"],
  [normalizeSkinLabel("Glorious Eminence Milio"), "Glorious Eminence Milio"],
  [normalizeSkinLabel("Блистательная знаменитость Милио"), "Glorious Eminence Milio"],
  [normalizeSkinLabel("Точилка для карандашей Ког'Мао"), "Pencil Sharpener Kog'Maw"],
  [normalizeSkinLabel("Dream Raider Kha'Zix"), "Dream Raider"],
  [normalizeSkinLabel("Похититель снов Ка'Зикс"), "Dream Raider"],
  [normalizeSkinLabel("Supervillain Graves"), "Super Villain Graves"],
  [normalizeSkinLabel("Суперзлодей Грейвз"), "Super Villain Graves"],
  [normalizeSkinLabel("Cyber Pop Zoe"), "Cyper Pop Zoe"],
  [normalizeSkinLabel("Киберпоп Зои"), "Cyper Pop Zoe"],
  [normalizeSkinLabel("Киберпоп- Зои"), "Cyper Pop Zoe"],
  [normalizeSkinLabel("Glorious Eminence Renekton"), "Glorious Eminence Renekton"],
  [normalizeSkinLabel("Блистательная знаменитость Ренектон"), "Glorious Eminence Renekton"],
  [normalizeSkinLabel("Movie Director Ryze"), "Movie Director Ryze"],
  [normalizeSkinLabel("Режиссер Райз"), "Movie Director Ryze"],
  [normalizeSkinLabel("Cosmic Sting Skarner"), "Cosmic Sting Skarner"],
  [normalizeSkinLabel("Космическое жало Скарнер"), "Cosmic Sting Skarner"],
  [normalizeSkinLabel("Superhero Jayce"), "Superhero Jayce"],
  [normalizeSkinLabel("Супергерой Джейс"), "Superhero Jayce"],
  [normalizeSkinLabel("Дух леса Шая"), "Elderwood Xayah"],
  [normalizeSkinLabel("Дух леса Рэйкан"), "Elderwood Rakan"],
  [normalizeSkinLabel("Purple Garlic Lulu"), "Purple Garlic Lulu"],
  [normalizeSkinLabel("Фиолетовый чеснок Лулу"), "Purple Garlic Lulu"],
  [normalizeSkinLabel("Блистательная знаменитость Джакс"), "Glorious Eminence Jax"],
  [normalizeSkinLabel("Боевая душа Варус"), "Soul Fighter Varus"],
  [normalizeSkinLabel("Защитник хекспедиции Галио"), "Hexplorer Galio"],
  [normalizeSkinLabel("Супергероиня Вай"), "Superhero Vi"],
  [normalizeSkinLabel("Защитница в пижаме Лулу"), "Pajama Guardian Lulu"],
  [normalizeSkinLabel("Машинист Орн"), "Choo-Choo Ornn"],
  [normalizeSkinLabel("Боевая душа Виего"), "Soul Fighter Viego"],
  [normalizeSkinLabel("Боевая душа Сенна"), "Soul Fighter Senna"],
  [normalizeSkinLabel("Боевая душа Амбесса"), "Soul Fighter Ambessa"],
  [normalizeSkinLabel("Боевая душа Виктор"), "Soul Fighter Viktor"],
  [normalizeSkinLabel("Убийца драконов Кейл"), "Dragonslayer Kayle"],
  [normalizeSkinLabel("Олень Смолдер"), "Reindeer Smolder"],
]);

function normalizeSkinLabel(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
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
  const alias = SKIN_GALLERY_LABEL_ALIASES.get(labels[0]);
  if (alias) labels.push(normalizeSkinLabel(alias));
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
