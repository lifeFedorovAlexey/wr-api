import { filterChampionsForPublicPool } from "../championPublicPool.mjs";

const normalize = value => String(value || "").toLowerCase().replace(/ё/g, "е");
const LANES = [
  ["support", /сап|поддерж|support/u], ["jungle", /лес|джанг|jungle/u],
  ["adc", /адк|стрел|дракон|\badc\b|\bbot\b/u], ["top", /барон|топ|\btop\b/u], ["mid", /мид|центр|\bmid\b/u],
];
const RANKS = [["peak", /вершин|легендарн|\bpeak\b/u], ["king", /претенд|челлендж|challenger|king/u],
  ["masterPlus", /мастер|грандмастер|master/u], ["diamondPlus", /алмаз|даймонд|diamond/u]];

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

function knowledgeSources({ stats, snapshot, query, guides, lore, catalog }) {
  const sources = [];
  const name = slug => catalog.find(item => item.slug === slug)?.nameLocalizations?.ru_ru || slug;
  if (stats.length) sources.push({ label: `Статистика CN · ${snapshot.stats_date} · ${query.rank}`, url: "/winrates",
    stats: (query.entities.length ? stats.filter(row => query.entities.includes(row.slug)) : stats.slice(0, 3))
      .slice(0, 4).map(row => ({ name: name(row.slug), lane: row.lane, winRate: row.win_rate, pickRate: row.pick_rate, banRate: row.ban_rate })),
  });
  for (const row of guides) sources.push({ label: `Гайд: ${name(row.champion_slug)}`, url: `/guides/${encodeURIComponent(row.champion_slug)}` });
  for (const row of lore) {
    try {
      const url = new URL(row.source_url);
      if (url.protocol === "https:" && (url.hostname === "leagueoflegends.com" || url.hostname.endsWith(".leagueoflegends.com"))) {
        sources.push({ label: `Лор: ${name(row.champion_slug)}`, url: url.href });
      }
    } catch { /* Missing source URL: keep the text, omit the link. */ }
  }
  return sources;
}

export async function loadLuxKnowledge(sql, body, memory, turns) {
  const catalog = filterChampionsForPublicPool(await sql`select slug, name, name_localizations as "nameLocalizations" from champions`);
  const query = resolveLuxQuery(body, catalog, [...turns.slice(-4).reverse().map(turn => turn.body), memory.summary || ""]);
  const remembered = Array.isArray(memory.entities) ? memory.entities : [];
  const entities = [...new Set([...query.entities, ...remembered])].filter(slug => catalog.some(row => row.slug === slug)).slice(0, 4);
  const requested = [...new Set(["lux", ...entities])];
  const lore = await optionalTable(sql`select distinct on (champion_slug) champion_slug, left(official_lore, 1400) as lore,
      source_url from champion_lore where champion_slug in ${sql(requested)}
      and review_status <> 'rejected' order by champion_slug, (locale in ('ru_ru','ru-ru')) desc`);
  const tips = entities.length ? await optionalTable(sql`select champion_slug, lane, tip_text from champion_stable_tips
      where champion_slug in ${sql(entities)} and review_status='approved' and patch_dependent=false
      and (lane is null or ${query.lane}::text is null or lane=${query.lane}) order by id limit 5`) : [];
  const [snapshot] = await sql`select id, stats_date, source, completed_at from champion_stats_snapshots
    where source='cnHistory' and status='completed' order by stats_date desc, completed_at desc, id desc limit 1`;
  const stats = snapshot ? await sql`select h.slug, h.rank, h.lane, h.win_rate, h.pick_rate, h.ban_rate from champion_stats_history h
    join champions c on c.slug=h.slug where h.snapshot_id=${snapshot.id} and h.rank=${query.rank}
    and (${query.lane}::text is null or h.lane=${query.lane})
    and c.name_localizations->>'en_us' is not null
    order by (h.slug = any(${entities}::text[])) desc, h.win_rate desc nulls last, h.slug, h.lane limit 10` : [];
  if (snapshot) snapshot.stats_date = snapshot.stats_date instanceof Date ? snapshot.stats_date.toISOString().slice(0, 10) : String(snapshot.stats_date).slice(0, 10);
  const guides = entities.length ? await optionalTable(sql`select slug as champion_slug from guide_summaries where slug in ${sql(entities)} limit 4`) : [];
  const sources = knowledgeSources({ stats, snapshot, query, guides, lore, catalog });
  const knowledge = {
    query, region: "Китай (CN)", snapshot: snapshot || null,
    notice: query.rankAssumed ? "Ранг не указан: данные для diamondPlus, уточни ранг при необходимости." : "",
    stats, lore: lore.map(row => ({ slug: row.champion_slug, text: row.lore })), tips,
    names: catalog.filter(row => requested.includes(row.slug) || stats.some(stat => stat.slug === row.slug))
      .map(row => ({ slug: row.slug, name: row.nameLocalizations?.ru_ru || row.name })),
    sources,
  };
  return { knowledge, sources, entities };
}
