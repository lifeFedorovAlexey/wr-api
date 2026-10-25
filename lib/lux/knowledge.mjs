import { filterChampionsForPublicPool } from "../championPublicPool.mjs";

const normalize = value => String(value || "").toLowerCase().replace(/ё/g, "е");
const LANES = [
  ["support", /сап|поддерж|support/u], ["jungle", /лес|джанг|jungle/u],
  ["adc", /адк|стрел|дракон|\badc\b|\bbot\b/u], ["top", /барон|топ|\btop\b/u], ["mid", /мид|центр|\bmid\b/u],
];
const RANKS = [["peak", /вершин|легендарн|\bpeak\b/u], ["king", /претенд|челлендж|challenger|king/u],
  ["masterPlus", /мастер|грандмастер|master/u], ["diamondPlus", /алмаз|даймонд|diamond/u]];

// An address names the person being spoken to, not the champion being researched.
export function stripLuxAddress(body) {
  return String(body || "")
    .replace(/(^|\s)@(?:люкс|lux)(?=$|[^\p{L}\p{N}_])[,!:?.]*/giu, "$1")
    .replace(/^\s*(?:(?:привет|здравствуй|здравствуйте|здарова|здорова|здорово|хай|слушай|эй)[,!\s]+)?(?:люкс|lux)(?=$|[\s,:!?.])[,!:?.]*/iu, "")
    .trim();
}

function requestTopics(text) {
  return {
    statistics: /статист|винрейт|вин рейт|пикрейт|банрейт|процент|частот|\b(?:wr|pr|br|win.?rate|pick.?rate|ban.?rate)\b/u.test(text),
    gameplay: /игра|сборк|билд|рун[аыуе]|контр|пик|бан|чемпион|матч|ранг|мет[аеуы]|линии|лайн|саппорт|поддержк|мид|лесник|джанг|адк|топ|(?:кого|кем).{0,25}(?:взять|брать|посовету|пойти)|(?:что|кого).{0,20}посовету|\b(?:build|rune|lane|support|mid|jungle|adc|top)\b/u.test(text),
    guides: /гайд|руководств|\bguide\b/u.test(text),
    lore: /лор|истори|демаси|сайлас|сил[а-я]*с|гарен|маг[а-я]*|биограф|родин|семь|\blore\b/u.test(text),
    links: /ссылк|источник|откуда.{0,20}(?:данн|цифр|информ)|где.{0,20}(?:читать|посмотр|найти)|\b(?:link|source)\b/u.test(text),
  };
}

export function selectLuxSources(body, sources) {
  const topics = requestTopics(normalize(stripLuxAddress(body)));
  return sources.filter(source => {
    if (source.verifiedLookup === true) return true;
    if (source.url === '/winrates') return topics.statistics || (topics.links && topics.gameplay);
    if (source.url?.startsWith('/guides/')) return topics.guides || topics.links;
    return topics.links;
  });
}

export function planLuxKnowledge(body, catalog, memory = {}, turns = []) {
  const text = normalize(stripLuxAddress(body));
  const topics = requestTopics(text);
  const previous = requestTopics(normalize(stripLuxAddress(turns.at(-1)?.body)));
  const followup = /^(?:а|и|тогда|теперь|еще|почему|сравни)(?=$|[\s,?!])/u.test(text);
  const query = resolveLuxQuery(text, catalog, [...turns.slice(-4).reverse().map(turn => stripLuxAddress(turn.body)), memory.summary || ""]);
  const gameplay = topics.gameplay || topics.statistics || topics.guides || (followup && (previous.gameplay || previous.statistics || previous.guides));
  const remembered = Array.isArray(memory.entities) ? memory.entities : [];
  if (!query.entities.length && gameplay && /(^|[^\p{L}])(?:ты|тебя|тебе|тобой|твои|твой|твоя)(?=$|[^\p{L}])/u.test(text)) query.entities = ["lux"];
  if (!query.entities.length && followup) query.entities = remembered;
  query.entities = query.entities.filter(slug => catalog.some(row => row.slug === slug)).slice(0, 4);
  return { query, gameplay, statistics: topics.statistics || (followup && previous.statistics),
    guides: topics.guides || (topics.links && previous.guides),
    loreLinks: topics.links && (topics.lore || previous.lore), links: topics.links,
    entities: query.entities.length ? query.entities : remembered };
}

export function resolveLuxQuery(body, catalog, fallback = "") {
  const text = normalize(body);
  const contexts = [text, ...(Array.isArray(fallback) ? fallback : [fallback]).map(normalize)];
  const find = patterns => contexts.map(context => patterns.find(([, pattern]) => pattern.test(context))?.[0]).find(Boolean);
  const entities = catalog.filter(champion => [champion.slug, champion.name, ...Object.values(champion.nameLocalizations || {})]
    .filter(Boolean).some(name => {
      const escaped = normalize(name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const ending = /^[а-я]{4,}$/u.test(escaped) ? "(?:а|у|е|ом|ой|ы|и|ю)?" : "";
      return new RegExp(`(^|[^\\p{L}])${escaped}${ending}([^\\p{L}]|$)`, "u").test(text);
    })).map(item => item.slug).slice(0, 4);
  return {
    entities,
    lane: find(LANES) || null,
    rank: find(RANKS) || "diamondPlus",
    rankAssumed: !find(RANKS),
  };
}

async function optionalTable(query) {
  try { return await query; } catch (error) { if (error.code === "42P01") return []; throw error; }
}

export async function loadLuxKnowledge(sql, body, memory, turns) {
  const catalog = filterChampionsForPublicPool(await sql`select slug, name, name_localizations as "nameLocalizations" from champions`);
  const plan = planLuxKnowledge(body, catalog, memory, turns);
  // Only identity lore is supplied automatically. The local model requests all other data explicitly.
  const lore = await optionalTable(sql`select distinct on (champion_slug) champion_slug, left(official_lore, 1400) as lore,
    source_url from champion_lore where champion_slug='lux' and review_status<>'rejected'
    order by champion_slug, (locale in ('ru_ru','ru-ru')) desc`);
  return { knowledge: {topic:plan.gameplay?'gameplay':'conversation',stats:[],notice:'',
    lore:lore.map(row=>({slug:row.champion_slug,text:row.lore})),lookups:[]},sources:[],
    entities:Array.isArray(memory.entities)?memory.entities:[] };
}
