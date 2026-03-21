import test from "node:test";
import assert from "node:assert/strict";

import { localizeRole, summarizeGuide } from "../lib/guides.mjs";

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
