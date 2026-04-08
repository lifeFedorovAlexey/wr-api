import test from "node:test";
import assert from "node:assert/strict";

import {
  buildRiftGgGuidePayload,
  normalizeRiftGgCnStats,
  parseRiftGgCnStatsHtml,
} from "../lib/riftggCnStats.mjs";

function withEnv(env, fn) {
  const previous = {
    S3_ENDPOINT: process.env.S3_ENDPOINT,
    S3_BUCKET: process.env.S3_BUCKET,
    S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID,
    S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY,
    S3_PUBLIC_BASE_URL: process.env.S3_PUBLIC_BASE_URL,
    ASSET_PUBLIC_MODE: process.env.ASSET_PUBLIC_MODE,
  };

  Object.assign(process.env, env);

  try {
    return fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

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
    `1:{"stats":{"matchups":[{"rankLevel":"255","lane":"255","dataDate":"2026-03-31","counters":[{"heroSlug":"ahri","metrics":{"winRate":0.5,"appearRate":0,"winRateRank":1,"appearRateRank":1}}]}],"core_items":[],"runes":[],"spells":[]}}
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

test("parseRiftGgCnStatsHtml accepts numeric rank and lane enums from CNStatsTabs payload", () => {
  const payload = JSON.stringify(
    `23:I[123,["/_next/static/chunks/app.js"],"CNStatsTabs"]
21:["$","$L23",null,{"stats":{"matchups":[{"rankLevel":1,"lane":4,"dataDate":"2026-03-31","counters":[{"heroSlug":"leesin","metrics":{"winRate":51.6,"appearRate":2.6,"winRateRank":1,"appearRateRank":8}}]},{"rankLevel":255,"lane":4,"dataDate":"2026-03-31","counters":[{"heroSlug":"khazix","metrics":{"winRate":49.1,"appearRate":1.1,"winRateRank":2,"appearRateRank":4}}]}],"core_items":[{"rankLevel":1,"lane":4,"dataDate":"2026-03-31","builds":[{"items":[{"slug":"sunfire-aegis"},{"slug":"thornmail"}],"metrics":{"winRate":52.4,"appearRate":9.1,"winRateRank":2,"appearRateRank":1}}]}],"runes":[{"rankLevel":1,"lane":4,"dataDate":"2026-03-31","builds":[{"runes":[{"slug":"aftershock"},{"slug":"bone-plating"}],"metrics":{"winRate":50.1,"appearRate":12.2,"winRateRank":3,"appearRateRank":2}}]}],"spells":[{"rankLevel":1,"lane":4,"dataDate":"2026-03-31","spells":[{"spells":[{"slug":"flash"},{"slug":"smite"}],"metrics":{"winRate":49.8,"appearRate":18.5,"winRateRank":4,"appearRateRank":1}}]}]},"lang":"en","itemsDict":{"sunfire-aegis":{"slug":"sunfire-aegis","name":"Sunfire Aegis"}},"runesDict":{"aftershock":{"slug":"aftershock","name":"Aftershock"}},"spellsDict":{"flash":{"slug":"flash","name":"Flash"},"smite":{"slug":"smite","name":"Smite"}}}]`,
  );

  const html = `<html><body><script>self.__next_f.push([1,${payload}])</script></body></html>`;
  const parsed = parseRiftGgCnStatsHtml(html);
  const normalized = normalizeRiftGgCnStats("amumu", parsed);

  assert.equal(normalized.matchups.length, 1);
  assert.equal(normalized.matchups[0].rank, "diamond_plus");
  assert.equal(normalized.matchups[0].lane, "jungle");
  assert.equal(normalized.matchups[0].winRate, 51.6);
  assert.equal(normalized.matchups[0].pickRate, 2.6);
  assert.equal(normalized.builds.length, 3);
});

test("parseRiftGgCnStatsHtml accepts support lane enum 5 from CNStatsTabs payload", () => {
  const payload = JSON.stringify(
    `23:I[123,["/_next/static/chunks/app.js"],"CNStatsTabs"]
21:["$","$L23",null,{"stats":{"matchups":[{"rankLevel":1,"lane":"5","dataDate":"2026-03-31","counters":[{"heroSlug":"yuumi","metrics":{"winRate":0.523466,"appearRate":0.0357,"winRateRank":1,"appearRateRank":9}}]}],"core_items":[{"rankLevel":4,"lane":"5","dataDate":"2026-03-31","builds":[{"items":[{"slug":"bulwark-of-the-mountain"},{"slug":"warmogs-armor"}],"metrics":{"winRate":0.681818,"appearRate":0.017537,"winRateRank":1,"appearRateRank":8}}]}],"runes":[{"rankLevel":1,"lane":"5","dataDate":"2026-03-31","builds":[{"runes":[{"slug":"glacial-augment"},{"slug":"bone-plating"}],"metrics":{"winRate":0.532587,"appearRate":0.025312,"winRateRank":1,"appearRateRank":5}}]}],"spells":[{"rankLevel":1,"lane":"5","dataDate":"2026-03-31","spells":[{"spells":[{"slug":"flash"},{"slug":"ignite"}],"metrics":{"winRate":0.477259,"appearRate":0.855758,"winRateRank":2,"appearRateRank":1}}]}]},"lang":"en","itemsDict":{"bulwark-of-the-mountain":{"slug":"bulwark-of-the-mountain","name":"Bulwark of the Mountain"}},"runesDict":{"glacial-augment":{"slug":"glacial-augment","name":"Glacial Augment"}},"spellsDict":{"flash":{"slug":"flash","name":"Flash"},"ignite":{"slug":"ignite","name":"Ignite"}}}]`,
  );

  const html = `<html><body><script>self.__next_f.push([1,${payload}])</script></body></html>`;
  const parsed = parseRiftGgCnStatsHtml(html);
  const normalized = normalizeRiftGgCnStats("alistar", parsed);

  assert.equal(normalized.matchups.length, 1);
  assert.equal(normalized.matchups[0].lane, "support");
  assert.equal(normalized.matchups[0].rank, "diamond_plus");
  assert.equal(normalized.builds.length, 3);
});

test("normalizeRiftGgCnStats maps numeric lane enums to mid, top, adc, jungle and support", () => {
  const normalized = normalizeRiftGgCnStats("aatrox", {
    stats: {
      matchups: [
        {
          rankLevel: 1,
          lane: 1,
          dataDate: "2026-03-31",
          counters: [{ heroSlug: "ahri", metrics: { winRate: 0.5, appearRate: 0.1, winRateRank: 1, appearRateRank: 1 } }],
        },
        {
          rankLevel: 1,
          lane: 2,
          dataDate: "2026-03-31",
          counters: [{ heroSlug: "darius", metrics: { winRate: 0.5, appearRate: 0.1, winRateRank: 1, appearRateRank: 1 } }],
        },
        {
          rankLevel: 1,
          lane: 3,
          dataDate: "2026-03-31",
          counters: [{ heroSlug: "kaisa", metrics: { winRate: 0.5, appearRate: 0.1, winRateRank: 1, appearRateRank: 1 } }],
        },
        {
          rankLevel: 1,
          lane: 4,
          dataDate: "2026-03-31",
          counters: [{ heroSlug: "leesin", metrics: { winRate: 0.5, appearRate: 0.1, winRateRank: 1, appearRateRank: 1 } }],
        },
        {
          rankLevel: 1,
          lane: 5,
          dataDate: "2026-03-31",
          counters: [{ heroSlug: "alistar", metrics: { winRate: 0.5, appearRate: 0.1, winRateRank: 1, appearRateRank: 1 } }],
        },
      ],
      core_items: [],
      runes: [],
      spells: [],
    },
    itemsDict: {},
    runesDict: {},
    spellsDict: {},
  });

  assert.deepEqual(
    normalized.matchups.map((row) => row.lane),
    ["mid", "top", "adc", "jungle", "support"],
  );
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

test("buildRiftGgGuidePayload keeps only the latest dataDate per rank and lane", () => {
  const payload = buildRiftGgGuidePayload({
    matchupRows: [
      { rank: "diamond_plus", lane: "jungle", dataDate: "2026-03-31", opponentSlug: "jax", winRate: 52.9, pickRate: 1.37, winRateRank: 1, pickRateRank: 1 },
      { rank: "diamond_plus", lane: "jungle", dataDate: "2026-04-05", opponentSlug: "jax", winRate: 52.5, pickRate: 1.35, winRateRank: 2, pickRateRank: 2 },
      { rank: "diamond_plus", lane: "jungle", dataDate: "2026-03-31", opponentSlug: "talon", winRate: 52.3, pickRate: 1.19, winRateRank: 3, pickRateRank: 3 },
      { rank: "diamond_plus", lane: "jungle", dataDate: "2026-04-05", opponentSlug: "talon", winRate: 53.2, pickRate: 1.14, winRateRank: 1, pickRateRank: 4 },
    ],
    buildRows: [
      { rank: "diamond_plus", lane: "jungle", dataDate: "2026-03-31", buildType: "coreItems", entrySlugs: ["black-cleaver"], winRate: 52.1, pickRate: 10.2, winRateRank: 2, pickRateRank: 1 },
      { rank: "diamond_plus", lane: "jungle", dataDate: "2026-04-05", buildType: "coreItems", entrySlugs: ["trinity-force"], winRate: 53.4, pickRate: 9.8, winRateRank: 1, pickRateRank: 2 },
    ],
    opponentRows: [
      { slug: "jax", name: "Jax", icon: "jax.webp", roles: ["fighter"] },
      { slug: "talon", name: "Talon", icon: "talon.webp", roles: ["assassin"] },
    ],
  });

  assert.equal(payload.matchups.length, 1);
  assert.equal(payload.matchups[0].dataDate, "2026-04-05");
  assert.deepEqual(
    payload.matchups[0].entries.map((entry) => entry.opponentSlug),
    ["talon", "jax"],
  );
  assert.equal(payload.matchups[0].entries[0].winRate, 53.2);
  assert.equal(payload.matchups[0].entries[1].winRate, 52.5);
  assert.equal(payload.coreItems[0].dataDate, "2026-04-05");
  assert.deepEqual(payload.coreItems[0].entries[0].entrySlugs, ["trinity-force"]);
});

test("buildRiftGgGuidePayload keeps latest build rows per rank, lane and build type", () => {
  const payload = buildRiftGgGuidePayload({
    matchupRows: [],
    buildRows: [
      { rank: "diamond_plus", lane: "top", dataDate: "2026-03-31", buildType: "coreItems", entrySlugs: ["blade-of-the-ruined-king"], winRate: 58.7, pickRate: 7.8, winRateRank: 1, pickRateRank: 2 },
      { rank: "diamond_plus", lane: "top", dataDate: "2026-04-05", buildType: "runes", entrySlugs: ["lethal-tempo"], winRate: 55.1, pickRate: 21.2, winRateRank: 1, pickRateRank: 1 },
      { rank: "diamond_plus", lane: "top", dataDate: "2026-04-05", buildType: "spells", entrySlugs: ["flash", "barrier"], winRate: 54.2, pickRate: 18.4, winRateRank: 1, pickRateRank: 1 },
    ],
  });

  assert.equal(payload.coreItems.length, 1);
  assert.equal(payload.runes.length, 1);
  assert.equal(payload.spells.length, 1);
  assert.equal(payload.coreItems[0].dataDate, "2026-03-31");
  assert.deepEqual(payload.coreItems[0].entries[0].entrySlugs, ["blade-of-the-ruined-king"]);
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

test("buildRiftGgGuidePayload keeps RiftGG rank and lane ordering", () => {
  const payload = buildRiftGgGuidePayload({
    matchupRows: [
      { rank: "challenger", lane: "adc", dataDate: "2026-03-31", opponentSlug: "xayah", winRate: 50, pickRate: 1, winRateRank: 1, pickRateRank: 1 },
      { rank: "diamond_plus", lane: "jungle", dataDate: "2026-03-31", opponentSlug: "ahri", winRate: 51, pickRate: 2, winRateRank: 1, pickRateRank: 1 },
      { rank: "master_plus", lane: "top", dataDate: "2026-03-31", opponentSlug: "teemo", winRate: 52, pickRate: 3, winRateRank: 1, pickRateRank: 1 },
    ],
    buildRows: [],
  });

  assert.deepEqual(payload.availableRanks, ["diamond_plus", "master_plus", "challenger"]);
  assert.deepEqual(payload.availableLanes, ["top", "jungle", "adc"]);
});

test("buildRiftGgGuidePayload resolves opponent aliases without breaking local icon slugs", () => {
  const payload = buildRiftGgGuidePayload({
    matchupRows: [
      { rank: "diamond_plus", lane: "jungle", dataDate: "2026-03-31", opponentSlug: "wukong", winRate: 51, pickRate: 2, winRateRank: 1, pickRateRank: 1 },
      { rank: "diamond_plus", lane: "jungle", dataDate: "2026-03-31", opponentSlug: "master-yi", winRate: 50, pickRate: 3, winRateRank: 2, pickRateRank: 2 },
    ],
    buildRows: [],
    opponentRows: [
      { slug: "monkeyking", slugAliases: ["wukong"], name: "Wukong", icon: "monkeyking.webp", roles: ["fighter"] },
      { slug: "masteryi", slugAliases: ["master-yi"], name: "Master Yi", icon: "masteryi.webp", roles: ["fighter"] },
    ],
  });

  assert.equal(payload.matchups[0].entries[0].opponent?.slug, "monkeyking");
  assert.match(payload.matchups[0].entries[0].opponent?.iconUrl || "", /monkeyking/);
  assert.equal(payload.matchups[0].entries[1].opponent?.slug, "masteryi");
  assert.match(payload.matchups[0].entries[1].opponent?.iconUrl || "", /masteryi/);
});

test("buildRiftGgGuidePayload emits S3 icon urls for matchup opponents in public asset mode", () => {
  withEnv(
    {
      S3_ENDPOINT: "https://s3.twcstorage.ru",
      S3_BUCKET: "bucket-name",
      S3_ACCESS_KEY_ID: "key",
      S3_SECRET_ACCESS_KEY: "secret",
      S3_PUBLIC_BASE_URL: "https://s3.twcstorage.ru/bucket-name",
      ASSET_PUBLIC_MODE: "s3",
    },
    () => {
      const payload = buildRiftGgGuidePayload({
        matchupRows: [
          {
            rank: "diamond_plus",
            lane: "jungle",
            dataDate: "2026-03-31",
            opponentSlug: "rammus",
            winRate: 48.2,
            pickRate: 2.4,
            winRateRank: 24,
            pickRateRank: 7,
          },
        ],
        buildRows: [],
        opponentRows: [
          {
            slug: "rammus",
            name: "Rammus",
            icon: "https://game.gtimg.cn/images/lgamem/act/lrlib/img/HeadIcon/H_S_10064.png",
            roles: ["tank"],
          },
        ],
      });

      assert.equal(
        payload.matchups[0].entries[0].opponent?.iconUrl,
        "https://s3.twcstorage.ru/bucket-name/icons/rammus.png",
      );
      assert.equal(
        payload.matchups[0].entries[0].opponent?.iconUrl?.includes("src="),
        false,
      );
    },
  );
});

test("buildRiftGgGuidePayload keeps public item asset urls instead of raw donor urls", () => {
  withEnv(
    {
      S3_ENDPOINT: "https://s3.twcstorage.ru",
      S3_BUCKET: "bucket-name",
      S3_ACCESS_KEY_ID: "key",
      S3_SECRET_ACCESS_KEY: "secret",
      S3_PUBLIC_BASE_URL: "https://s3.twcstorage.ru/bucket-name",
      ASSET_PUBLIC_MODE: "s3",
    },
    () => {
      const payload = buildRiftGgGuidePayload({
        matchupRows: [],
        buildRows: [
          {
            rank: "diamond_plus",
            lane: "support",
            dataDate: "2026-04-08",
            buildType: "coreItems",
            entrySlugs: ["imperial-mandate"],
            winRate: 55.4,
            pickRate: 1.9,
            winRateRank: 1,
            pickRateRank: 1,
          },
        ],
        itemRows: [
          {
            kind: "item",
            slug: "imperial-mandate",
            name: "Imperial Mandate",
            imageUrl: "https://www.wildriftfire.com/images/items/imperial-mandate.png",
            tooltipImageUrl: "https://www.wildriftfire.com/images/items/imperial-mandate.png",
            rawPayload: {
              slug: "imperial-mandate",
              name: "Imperial Mandate",
              imageUrl: "https://www.wildriftfire.com/images/items/imperial-mandate.png",
              tooltipImageUrl: "https://www.wildriftfire.com/images/items/imperial-mandate.png",
            },
          },
        ],
      });

      assert.equal(
        payload.dictionaries.items["imperial-mandate"].imageUrl,
        "https://s3.twcstorage.ru/bucket-name/assets/guide-item-imperial-mandate-image.png",
      );
      assert.equal(
        payload.dictionaries.items["imperial-mandate"].tooltipImageUrl,
        "https://s3.twcstorage.ru/bucket-name/assets/guide-item-imperial-mandate-tooltip.png",
      );

      const imperialMandateImageUrl = new URL(
        payload.dictionaries.items["imperial-mandate"].imageUrl,
      );

      assert.equal(
        imperialMandateImageUrl.hostname,
        "s3.twcstorage.ru",
      );
      assert.notEqual(
        imperialMandateImageUrl.hostname,
        "www.wildriftfire.com",
      );
      assert.notEqual(
        imperialMandateImageUrl.hostname,
        "wildriftfire.com",
      );
    },
  );
});
