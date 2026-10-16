import test from "node:test";
import assert from "node:assert/strict";
import { buildTrendEvents, currentGuideRelations, validEventDate } from "./trendEvents.mjs";

const patch = (version, date, extra = {}) => ({ patchVersion: version, locale: "ru-ru", effectiveDate: date, effectiveRegion: "CN", ...extra });
const change = (version, kind, slug, type = "buff", extra = {}) => ({ patchVersion: version, entityKind: kind, entitySlug: slug, entityName: slug, changeType: type, locale: "ru-ru", details: [], ...extra });
const build = (extra = {}) => buildTrendEvents({ patches: [patch("7.1", "2026-04-09")], changes: [change("7.1", "champion", "ahri")], slug: "ahri", from: "2026-04-01", to: "2026-04-30", ...extra });

test("uses actual CN dates, never publication dates or another region", () => {
  for (const row of [patch("7.1", null, { publishedAt: "2026-04-09" }), patch("7.1", "2026-04-09", { effectiveRegion: "EU" })]) {
    assert.deepEqual(build({ patches: [row] }).patches, []);
  }
  assert.equal(build().patches[0].date, "2026-04-09");
  assert.equal(validEventDate("2026-02-30"), false);
});

test("next patch bounds include versions without changes to the champion", () => {
  const result = build({ patches: [patch("7.1b", "2026-04-16"), patch("7.1", "2026-04-09")] });
  assert.equal(result.patches.length, 1);
  assert.equal(result.patches[0].nextDate, "2026-04-16");
});

test("does not bridge an intervening patch with unknown application date", () => {
  const result = build({ patches: [patch("7.1", "2026-04-09"), patch("7.1a", null), patch("7.1b", "2026-04-16")] });
  assert.equal(result.patches[0].nextDate, null);
});

test("groups abilities once per entity; mixed buffs/nerfs remain adjustments", () => {
  const result = build({ changes: [change("7.1", "champion", "ahri", "buff"), change("7.1", "champion", "ahri", "nerf")] });
  assert.equal(result.patches[0].changes.length, 1);
  assert.equal(result.patches[0].changes[0].records.length, 2);
  assert.equal(result.patches[0].changes[0].changeType, "adjustment");
});

test("uses Russian per entity while retaining English-only item changes", () => {
  const relations = new Map([["item:ludens-echo", { kind: "current-guide", patch: "7.3a" }]]);
  const result = build({ relations, patches: [patch("7.1", "2026-04-09", { locale: "en-us" }), patch("7.1", "2026-04-09")], changes: [
    change("7.1", "champion", "ahri", "buff", { locale: "en-us" }), change("7.1", "champion", "ahri", "nerf"),
    change("7.1", "item", "ludens-echo", "buff", { locale: "en-us" }), change("7.1", "item", "unrelated"), change("7.1", "champion", "lux"),
  ] });
  const entities = result.patches[0].changes;
  assert.deepEqual(entities.map((row) => row.entitySlug), ["ahri", "ludens-echo"]);
  assert.equal(entities[0].records.length, 1);
  assert.equal(entities[0].changeType, "nerf");
  assert.equal(entities[1].relation.patch, "7.3a");
});

test("current guide matches role, core items and runes only", () => {
  const input = { lane: "mid", summary: { recommendedRole: "Мид", patch: "7.3a" }, variants: [{ variantKey: "default", lane: null, isDefault: true }], sections: [
    { variantKey: "default", sectionType: "itemBuild", sectionKey: "core", entitySlugs: ["ludens-echo"] },
    { variantKey: "default", sectionType: "spellsAndRunes", sectionKey: "runes", entitySlugs: ["electrocute"] },
    { variantKey: "default", sectionType: "itemBuild", sectionKey: "situational", entitySlugs: ["other"] },
    { variantKey: "different", sectionType: "itemBuild", sectionKey: "core", entitySlugs: ["other"] },
  ] };
  assert.deepEqual([...currentGuideRelations(input).keys()], ["item:ludens-echo", "rune:electrocute"]);
  assert.equal(currentGuideRelations({ ...input, lane: "top" }).size, 0);
  assert.equal(currentGuideRelations({ ...input, summary: {} }).size, 0);
});

test("season starts are independent of patch/champion events and filtered by region/date", () => {
  const result = build({ patches: [], changes: [], seasons: [
    { id: "s21", date: "2026-04-10", region: "CN" }, { id: "s22", date: "2026-07-10", region: "CN" }, { id: "eu", date: "2026-04-10", region: "EU" },
  ] });
  assert.deepEqual(result.seasons.map((row) => row.id), ["s21"]);
});
