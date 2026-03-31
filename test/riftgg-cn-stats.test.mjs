import test from "node:test";
import assert from "node:assert/strict";

import {
  buildRiftGgGuidePayload,
  normalizeRiftGgCnStats,
  parseRiftGgCnStatsHtml,
} from "../lib/riftggCnStats.mjs";

test("parseRiftGgCnStatsHtml extracts stats and dictionaries from next flight payload", () => {
  const payload = JSON.stringify(
    `1:{"stats":{"matchups":[{"rankLevel":"Diamond+","lane":"Mid","dataDate":"2026-03-31","counters":[{"heroSlug":"ahri","metrics":{"winRate":54.6,"appearRate":2.1,"winRateRank":1,"appearRateRank":9}}]}],"core_items":[{"rankLevel":"Diamond+","lane":"Mid","dataDate":"2026-03-31","builds":[{"items":[{"slug":"infinity-orb"},{"slug":"ludens-echo"}],"metrics":{"winRate":53.1,"appearRate":14.8,"winRateRank":2,"appearRateRank":1}}]}],"runes":[{"rankLevel":"Diamond+","lane":"Mid","dataDate":"2026-03-31","builds":[{"runes":[{"slug":"electrocute"},{"slug":"scorch"}],"metrics":{"winRate":52.2,"appearRate":30.4,"winRateRank":3,"appearRateRank":2}}]}],"spells":[{"rankLevel":"Diamond+","lane":"Mid","dataDate":"2026-03-31","spells":[{"spells":[{"slug":"flash"},{"slug":"ignite"}],"metrics":{"winRate":51.8,"appearRate":22.5,"winRateRank":4,"appearRateRank":3}}]}]},"itemsDict":{"infinity-orb":{"slug":"infinity-orb","name":"Infinity Orb","price":"2900"}},"runesDict":{"electrocute":{"slug":"electrocute","name":"Electrocute","description":["zap"]}},"spellsDict":{"ignite":{"slug":"ignite","name":"Ignite","effects":["burn"]},"flash":{"slug":"flash","name":"Flash","effects":["blink"]}}}`,
  );

  const html = `<html><body><script>self.__next_f.push([1,${payload}])</script></body></html>`;
  const parsed = parseRiftGgCnStatsHtml(html);

  assert.equal(parsed.stats.matchups[0].counters[0].heroSlug, "ahri");
  assert.equal(parsed.itemsDict["infinity-orb"].name, "Infinity Orb");
  assert.equal(parsed.runesDict.electrocute.description[0], "zap");
  assert.equal(parsed.spellsDict.flash.effects[0], "blink");
});

test("parseRiftGgCnStatsHtml extracts stats from CNStatsTabs payload", () => {
  const payload = JSON.stringify(
    `23:I[123,["/_next/static/chunks/app.js"],"CNStatsTabs"]
21:["$","$L23",null,{"stats":{"matchups":[{"rankLevel":"Challenger","lane":"Dragon","dataDate":"2026-03-31","counters":[{"heroSlug":"varus","metrics":{"winRate":51.6,"appearRate":2.6,"winRateRank":1,"appearRateRank":8}}]}],"core_items":[{"rankLevel":"Challenger","lane":"Dragon","dataDate":"2026-03-31","builds":[{"items":[{"slug":"blade-of-the-ruined-king"},{"slug":"magnetic-blaster"}],"metrics":{"winRate":52.4,"appearRate":9.1,"winRateRank":2,"appearRateRank":1}}]}],"runes":[{"rankLevel":"Challenger","lane":"Dragon","dataDate":"2026-03-31","builds":[{"runes":[{"slug":"lethal-tempo"},{"slug":"giant-slayer"}],"metrics":{"winRate":50.1,"appearRate":12.2,"winRateRank":3,"appearRateRank":2}}]}],"spells":[{"rankLevel":"Challenger","lane":"Dragon","dataDate":"2026-03-31","spells":[{"spells":[{"slug":"flash"},{"slug":"heal"}],"metrics":{"winRate":49.8,"appearRate":18.5,"winRateRank":4,"appearRateRank":1}}]}]},"lang":"en","itemsDict":{"blade-of-the-ruined-king":{"slug":"blade-of-the-ruined-king","name":"Blade of the Ruined King"}},"runesDict":{"lethal-tempo":{"slug":"lethal-tempo","name":"Lethal Tempo"}},"spellsDict":{"flash":{"slug":"flash","name":"Flash"},"heal":{"slug":"heal","name":"Heal"}}}]`,
  );

  const html = `<html><body><script>self.__next_f.push([1,${payload}])</script></body></html>`;
  const parsed = parseRiftGgCnStatsHtml(html);

  assert.equal(parsed.stats.matchups[0].lane, "Dragon");
  assert.equal(parsed.stats.core_items[0].builds[0].items[0].slug, "blade-of-the-ruined-king");
  assert.equal(parsed.spellsDict.heal.name, "Heal");
});

test("parseRiftGgCnStatsHtml prefers the stats candidate with valid rank and lane values", () => {
  const payload = JSON.stringify(
    `1:{"stats":{"matchups":[{"rankLevel":"1","lane":"0","dataDate":"2026-03-31","counters":[{"heroSlug":"ahri","metrics":{"winRate":0.5,"appearRate":0,"winRateRank":1,"appearRateRank":1}}]}],"core_items":[],"runes":[],"spells":[]}}
2:{"stats":{"matchups":[{"rankLevel":"Challenger","lane":"Dragon","dataDate":"2026-03-31","counters":[{"heroSlug":"varus","metrics":{"winRate":51.6,"appearRate":2.6,"winRateRank":1,"appearRateRank":8}}]}],"core_items":[],"runes":[],"spells":[]},"itemsDict":{"blade-of-the-ruined-king":{"slug":"blade-of-the-ruined-king","name":"Blade of the Ruined King"}},"runesDict":{"lethal-tempo":{"slug":"lethal-tempo","name":"Lethal Tempo"}},"spellsDict":{"flash":{"slug":"flash","name":"Flash"}}}`,
  );

  const html = `<html><body><script>self.__next_f.push([1,${payload}])</script></body></html>`;
  const parsed = parseRiftGgCnStatsHtml(html);

  assert.equal(parsed.stats.matchups[0].rankLevel, "Challenger");
  assert.equal(parsed.stats.matchups[0].lane, "Dragon");
});

test("parseRiftGgCnStatsHtml keeps dictionaries from the same composite payload as stats", () => {
  const payload = JSON.stringify(
    `1:{"stats":{"matchups":[{"rankLevel":"1","lane":"0","dataDate":"2026-03-31","counters":[{"heroSlug":"ahri","metrics":{"winRate":0.5,"appearRate":0,"winRateRank":1,"appearRateRank":1}}]}],"core_items":[],"runes":[],"spells":[]},"itemsDict":{"bad-item":{"slug":"bad-item","name":"Bad Item"}},"runesDict":{"bad-rune":{"slug":"bad-rune","name":"Bad Rune"}},"spellsDict":{"bad-spell":{"slug":"bad-spell","name":"Bad Spell"}}}
2:{"stats":{"matchups":[{"rankLevel":"Challenger","lane":"Dragon","dataDate":"2026-03-31","counters":[{"heroSlug":"varus","metrics":{"winRate":51.6,"appearRate":2.6,"winRateRank":1,"appearRateRank":8}}]}],"core_items":[{"rankLevel":"Challenger","lane":"Dragon","dataDate":"2026-03-31","builds":[{"items":[{"slug":"blade-of-the-ruined-king"}],"metrics":{"winRate":52.4,"appearRate":9.1,"winRateRank":2,"appearRateRank":1}}]}],"runes":[],"spells":[]},"itemsDict":{"blade-of-the-ruined-king":{"slug":"blade-of-the-ruined-king","name":"Blade of the Ruined King"}},"runesDict":{"lethal-tempo":{"slug":"lethal-tempo","name":"Lethal Tempo"}},"spellsDict":{"flash":{"slug":"flash","name":"Flash"}}}`,
  );

  const html = `<html><body><script>self.__next_f.push([1,${payload}])</script></body></html>`;
  const parsed = parseRiftGgCnStatsHtml(html);

  assert.equal(parsed.stats.matchups[0].heroSlug, undefined);
  assert.equal(parsed.itemsDict["blade-of-the-ruined-king"].name, "Blade of the Ruined King");
  assert.equal(parsed.itemsDict["bad-item"], undefined);
});

test("normalizeRiftGgCnStats builds matchup and build rows", () => {
  const normalized = normalizeRiftGgCnStats("lux", {
    stats: {
      matchups: [
        {
          rankLevel: "Diamond+",
          lane: "Mid",
          dataDate: "2026-03-31",
          counters: [
            {
              heroSlug: "ahri",
              metrics: { winRate: 54.6, appearRate: 2.1, winRateRank: 1, appearRateRank: 9 },
            },
          ],
        },
      ],
      core_items: [
        {
          rankLevel: "Diamond+",
          lane: "Mid",
          dataDate: "2026-03-31",
          builds: [
            {
              items: [{ slug: "infinity-orb" }, { slug: "ludens-echo" }],
              metrics: { winRate: 53.1, appearRate: 14.8, winRateRank: 2, appearRateRank: 1 },
            },
          ],
        },
      ],
      runes: [
        {
          rankLevel: "Diamond+",
          lane: "Mid",
          dataDate: "2026-03-31",
          builds: [
            {
              runes: [{ slug: "electrocute" }, { slug: "scorch" }],
              metrics: { winRate: 52.2, appearRate: 30.4, winRateRank: 3, appearRateRank: 2 },
            },
          ],
        },
      ],
      spells: [
        {
          rankLevel: "Diamond+",
          lane: "Mid",
          dataDate: "2026-03-31",
          spells: [
            {
              spells: [{ slug: "flash" }, { slug: "ignite" }],
              metrics: { winRate: 51.8, appearRate: 22.5, winRateRank: 4, appearRateRank: 3 },
            },
          ],
        },
      ],
    },
    itemsDict: {
      "infinity-orb": { slug: "infinity-orb", name: "Infinity Orb" },
    },
    runesDict: {
      electrocute: { slug: "electrocute", name: "Electrocute" },
    },
    spellsDict: {
      ignite: { slug: "ignite", name: "Ignite" },
      flash: { slug: "flash", name: "Flash" },
    },
  });

  assert.equal(normalized.matchups[0].rank, "diamond_plus");
  assert.equal(normalized.matchups[0].lane, "mid");
  assert.equal(normalized.matchups[0].opponentSlug, "ahri");
  assert.equal(normalized.builds.length, 3);
  assert.deepEqual(normalized.builds[0].entrySlugs, ["infinity-orb", "ludens-echo"]);
  assert.equal(normalized.dictionaries.length, 4);
});

test("buildRiftGgGuidePayload groups rows by rank and lane and exposes top and bottom matchups", () => {
  const payload = buildRiftGgGuidePayload({
    matchupRows: [
      { rank: "diamond_plus", lane: "mid", dataDate: "2026-03-31", opponentSlug: "ahri", winRate: 54.6, pickRate: 2.1, winRateRank: 1, pickRateRank: 9 },
      { rank: "diamond_plus", lane: "mid", dataDate: "2026-03-31", opponentSlug: "teemo", winRate: 47.2, pickRate: 1.1, winRateRank: 29, pickRateRank: 20 },
    ],
    buildRows: [
      { rank: "diamond_plus", lane: "mid", dataDate: "2026-03-31", buildType: "coreItems", entrySlugs: ["infinity-orb"], winRate: 53.1, pickRate: 14.8, winRateRank: 2, pickRateRank: 1 },
      { rank: "diamond_plus", lane: "mid", dataDate: "2026-03-31", buildType: "runes", entrySlugs: ["electrocute"], winRate: 52.2, pickRate: 30.4, winRateRank: 3, pickRateRank: 2 },
      { rank: "diamond_plus", lane: "mid", dataDate: "2026-03-31", buildType: "spells", entrySlugs: ["flash", "ignite"], winRate: 51.8, pickRate: 22.5, winRateRank: 4, pickRateRank: 3 },
    ],
    opponentRows: [
      { slug: "ahri", name: "Ahri", icon: "ahri.webp", roles: ["mid"] },
      { slug: "teemo", name: "Teemo", icon: "teemo.webp", roles: ["mid"] },
    ],
    itemRows: [{ slug: "infinity-orb", name: "Infinity Orb", rawPayload: { price: "2900" } }],
    runeRows: [{ slug: "electrocute", name: "Electrocute", rawPayload: { description: ["zap"] } }],
    spellRows: [{ slug: "ignite", name: "Ignite", rawPayload: { effects: ["burn"] } }],
  });

  assert.equal(payload.matchups.length, 1);
  assert.equal(payload.matchups[0].best[0].opponentSlug, "ahri");
  assert.equal(payload.matchups[0].worst[0].opponentSlug, "teemo");
  assert.deepEqual(payload.coreItems[0].entries[0].entrySlugs, ["infinity-orb"]);
  assert.equal(payload.dictionaries.items["infinity-orb"].price, "2900");
  assert.equal(payload.dictionaries.runes.electrocute.description[0], "zap");
});

test("buildRiftGgGuidePayload ignores invalid rank and lane rows", () => {
  const payload = buildRiftGgGuidePayload({
    matchupRows: [
      { rank: "255", lane: "1", opponentSlug: "ahri", winRate: 0.5, pickRate: 0, winRateRank: 1, pickRateRank: 1 },
    ],
    buildRows: [
      { rank: "255", lane: "1", buildType: "coreItems", entrySlugs: ["infinity-orb"], winRate: 0.5, pickRate: 0, winRateRank: 1, pickRateRank: 1 },
    ],
  });

  assert.equal(payload, null);
});
