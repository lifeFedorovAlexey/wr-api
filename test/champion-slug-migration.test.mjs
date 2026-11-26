import test from "node:test";
import assert from "node:assert/strict";

import { classifyChampionSlugMigrations } from "../lib/championSlugMigration.mjs";

test("classifyChampionSlugMigrations migrates known legacy aliases to canonical Riot slugs", () => {
  const result = classifyChampionSlugMigrations(
    ["nunu", "xinzhao", "lee-sin", "old-ghost"],
    ["nunu-and-willump", "xin-zhao", "lee-sin", "lux"],
  );

  assert.deepEqual(result.aliasMigrations, [
    { from: "nunu", to: "nunu-and-willump" },
    { from: "xinzhao", to: "xin-zhao" },
  ]);
  assert.deepEqual(result.staleSlugs, ["old-ghost"]);
});

test("classifyChampionSlugMigrations does not treat canonical slugs as stale", () => {
  const result = classifyChampionSlugMigrations(
    ["wukong", "master-yi"],
    ["wukong", "master-yi"],
  );

  assert.deepEqual(result.aliasMigrations, []);
  assert.deepEqual(result.staleSlugs, []);
});
