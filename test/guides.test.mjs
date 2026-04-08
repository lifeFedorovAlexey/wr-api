import test from "node:test";
import assert from "node:assert/strict";

import {
  collectGuideEntityRefs,
  localizeRole,
  shouldSkipGuideImport,
  summarizeGuide,
} from "../lib/guides.mjs";
import { buildGuideAssetKey, buildPublicGuideAssetPath } from "../lib/guideAssets.mjs";

test("localizeRole normalizes common lane names", () => {
  assert.equal(localizeRole("Support Lane"), "Саппорт");
  assert.equal(localizeRole("Mid"), "Мид");
  assert.equal(localizeRole("Jungle"), "Лес");
});

test("summarizeGuide builds lightweight summary for list endpoint", () => {
  const summary = summarizeGuide({
    source: {
      site: "wildriftfire",
      url: "https://example.com/guide/lux",
      contentHash: "abc123",
      fetchedAt: "2026-03-21T12:00:00.000Z",
    },
    champion: {
      slug: "lux",
      name: "Lux",
      title: "Леди сияния",
      iconUrl: "https://example.com/lux.png",
    },
    metadata: {
      patch: "7.0f",
      tier: "B",
      recommendedRole: "Support Lane",
    },
    variants: [
      {
        guideId: "support",
        title: "Support Build",
        lane: "Support Lane",
        tier: "B",
        isDefault: true,
      },
      {
        guideId: "mid",
        title: "Mid Build",
        lane: "Mid Lane",
        tier: "A",
      },
    ],
  });

  assert.equal(summary.slug, "lux");
  assert.equal(summary.name, "Lux");
  assert.equal(summary.patch, "7.0f");
  assert.equal(summary.recommendedRole, "Саппорт");
  assert.deepEqual(summary.roles, ["Саппорт", "Мид"]);
  assert.equal(summary.buildCount, 2);
});

test("guide asset helpers build stable proxied paths", () => {
  const assetKey = buildGuideAssetKey("guide", "lux", "q", "ability");

  assert.equal(assetKey, "guide-lux-q-ability");
  assert.equal(
    buildPublicGuideAssetPath(assetKey, "https://example.com/lux-q.png"),
    "/wr-api/assets/guide-lux-q-ability?src=https%3A%2F%2Fexample.com%2Flux-q.png",
  );
});

test("collectGuideEntityRefs keeps entity kinds so equal slugs do not collide", () => {
  const refs = collectGuideEntityRefs({
    abilities: [{ abilitySlug: "ignite" }],
    buildBreakdown: { featuredItemSlugs: ["ignite"] },
    sections: [
      { sectionType: "itemBuild", sectionKey: "core", entitySlugs: ["boots"] },
      {
        sectionType: "spellsAndRunes",
        sectionKey: "summonerSpells",
        entitySlugs: ["ignite"],
      },
    ],
    skillOrders: [{ quickOrder: ["ignite"] }],
    skillRows: [{ abilitySlug: "ignite" }],
    matchups: [{ championSlug: "lux" }],
  });

  assert.deepEqual(refs, [
    { kind: "item", slug: "boots" },
    { kind: "summonerSpell", slug: "ignite" },
    { kind: "ability", slug: "ignite" },
    { kind: "item", slug: "ignite" },
    { kind: "champion", slug: "lux" },
  ]);
});

test("shouldSkipGuideImport returns true only for matching non-empty content hashes", () => {
  assert.equal(
    shouldSkipGuideImport({ contentHash: "abc123" }, { contentHash: "abc123" }),
    true,
  );
  assert.equal(
    shouldSkipGuideImport({ contentHash: "abc123" }, { contentHash: "def456" }),
    false,
  );
  assert.equal(
    shouldSkipGuideImport({ contentHash: "" }, { contentHash: "abc123" }),
    false,
  );
  assert.equal(
    shouldSkipGuideImport({ contentHash: "abc123" }, { contentHash: "" }),
    false,
  );
  assert.equal(shouldSkipGuideImport(null, { contentHash: "abc123" }), false);
});
