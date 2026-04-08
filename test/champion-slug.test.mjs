import assert from "node:assert/strict";
import test from "node:test";

import {
  getChampionSlugAliases,
  getChampionSlugRecord,
  getSourceChampionSlugCandidates,
  toCanonicalChampionSlug,
  toLegacyLocalChampionSlug,
} from "../lib/championSlug.mjs";
import { getSlugAliases, mapToLocalSlug, mapToRiotSlug } from "../utils/slugRemap.mjs";

test("toCanonicalChampionSlug resolves legacy local aliases to official wild rift slugs", () => {
  assert.equal(toCanonicalChampionSlug("legacyLocal", "monkeyking"), "wukong");
  assert.equal(toCanonicalChampionSlug("legacyLocal", "masteryi"), "master-yi");
  assert.equal(toCanonicalChampionSlug("legacyLocal", "nunu"), "nunu-willump");
});

test("toCanonicalChampionSlug accepts canonical slugs unchanged", () => {
  assert.equal(toCanonicalChampionSlug("riot", "lee-sin"), "lee-sin");
  assert.equal(toCanonicalChampionSlug("riftgg", "wukong"), "wukong");
  assert.equal(toCanonicalChampionSlug("riot", "ahri"), "ahri");
});

test("toLegacyLocalChampionSlug maps canonical slugs back to current storage slugs", () => {
  assert.equal(toLegacyLocalChampionSlug("wukong"), "monkeyking");
  assert.equal(toLegacyLocalChampionSlug("master-yi"), "masteryi");
  assert.equal(toLegacyLocalChampionSlug("ahri"), "ahri");
});

test("getChampionSlugAliases returns canonical and compatibility aliases", () => {
  assert.deepEqual(
    getChampionSlugAliases("monkeyking"),
    ["wukong", "monkeyking"],
  );
  assert.deepEqual(
    getChampionSlugAliases("master-yi"),
    ["master-yi", "masteryi"],
  );
});

test("getSourceChampionSlugCandidates returns source-specific slug candidates with preferred source first", () => {
  assert.deepEqual(
    getSourceChampionSlugCandidates("nunu", "riftgg"),
    ["nunu-and-willump", "nunu-willump", "nunu"],
  );
  assert.deepEqual(
    getSourceChampionSlugCandidates("monkeyking", "riftgg"),
    ["wukong", "monkeyking"],
  );
  assert.deepEqual(
    getSourceChampionSlugCandidates("xinzhao", "riot"),
    ["xin-zhao", "xinzhao"],
  );
});

test("getChampionSlugRecord exposes canonical, legacyLocal and alias list", () => {
  assert.deepEqual(getChampionSlugRecord("leesin"), {
    canonical: "lee-sin",
    legacyLocal: "leesin",
    aliases: ["lee-sin", "leesin"],
  });
});

test("legacy slugRemap wrapper stays consistent with central champion slug layer", () => {
  assert.equal(mapToRiotSlug("twistedfate"), "twisted-fate");
  assert.equal(mapToLocalSlug("twisted-fate"), "twistedfate");
  assert.deepEqual(getSlugAliases("drmundo"), ["dr-mundo", "drmundo"]);
});
