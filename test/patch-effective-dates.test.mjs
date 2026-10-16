import assert from "node:assert/strict";
import test from "node:test";

import { getPatchEffectiveDateMetadata } from "../lib/patchEffectiveDates.mjs";
import { parsePatchArticle } from "../lib/patchNotesParser.mjs";

const confirmedDates = new Map([
  ["7.3", ["2026-09-22", "https://game.xiaomi.com/viewpoint/1359077112_1790049273565_149"]],
  ["7.2b", ["2026-07-30", "https://m.wywyx.com/news/202607/581297.html"]],
  ["7.2", ["2026-07-09", "https://www.lolfun.cn/news/detail/22289.html"]],
  ["7.1f", ["2026-05-28", "https://www.sohu.com/a/1028896436_122598898"]],
  ["7.1c", ["2026-04-23", "https://www.wywyx.com/news/202604/560132.html"]],
  ["7.1", ["2026-04-09", "https://www.qieyou.com/content/155989"]],
]);

const unconfirmedVersions = [
  "7.3b", "7.3a", "7.2f", "7.2e", "7.2d", "7.2c", "7.2a",
  "7.1h", "7.1g", "7.1e", "7.1d", "7.1b", "7.1a", "7.0g", "7.0f",
];

test("returns only CN dates supported by actual rollout reports", () => {
  for (const [version, [date, sourceUrl]] of confirmedDates) {
    const metadata = getPatchEffectiveDateMetadata(version);
    assert.deepEqual(metadata, {
      effectiveDate: date,
      effectiveRegion: "CN",
      effectiveDateSourceUrl: sourceUrl,
    });

    assert.match(date, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10), date);
    assert.match(sourceUrl, /^https:\/\//);
  }
});

test("leaves dates null when CN rollout is not confirmed", () => {
  for (const version of [...unconfirmedVersions, "unknown-version"]) {
    assert.deepEqual(getPatchEffectiveDateMetadata(version), {
      effectiveDate: null,
      effectiveRegion: null,
      effectiveDateSourceUrl: null,
    });
  }
});

test("keeps article publication date separate and CN rollout metadata locale-independent", () => {
  const metadataByLocale = ["en-us", "ru-ru"].map((locale) => {
    const page = {
      url: `https://wildrift.leagueoflegends.com/${locale}/news/game-updates/wild-rift-patch-notes-7-3/`,
      blades: [
        { type: "articleMasthead", title: "Wild Rift Patch Notes 7.3", publishDate: "2026-09-21" },
        { type: "articleRichText", richText: { body: "<h2>CHAMPION ADJUSTMENTS</h2>" } },
      ],
    };
    const html = `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
      props: { pageProps: { page } },
    })}</script>`;
    const parsed = parsePatchArticle(html, "7.3", locale, {
      champions: new Map(), items: new Map(), runes: new Map(), spells: new Map(),
    });
    return {
      publishedAt: parsed.publishedAt,
      effectiveDate: parsed.effectiveDate,
      effectiveRegion: parsed.effectiveRegion,
      effectiveDateSourceUrl: parsed.effectiveDateSourceUrl,
    };
  });

  assert.equal(metadataByLocale[0].publishedAt, "2026-09-21");
  assert.equal(metadataByLocale[0].effectiveDate, "2026-09-22");
  assert.equal(metadataByLocale[0].effectiveRegion, "CN");
  assert.equal(
    metadataByLocale[0].effectiveDateSourceUrl,
    "https://game.xiaomi.com/viewpoint/1359077112_1790049273565_149",
  );
  assert.deepEqual(metadataByLocale[0], metadataByLocale[1]);
});
