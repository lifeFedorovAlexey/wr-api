/* global document */
import puppeteer from "puppeteer";
import { createRequire } from "node:module";

import { parseRiftGgCnStatsHtml, normalizeRiftGgCnStats } from "../lib/riftggCnStats.mjs";

const require = createRequire(import.meta.url);
const { scrapeGuide } = require("../../ui/scripts/parse-wildriftfire-guide.js");
const guideShared = require("../../ui/shared/guides-shared.js");

const {
  mapToRiotSlug,
  localizeGuideLane,
  repairGuideText,
} = guideShared;

const DEFAULT_UI_ORIGIN = process.env.UI_ORIGIN || "http://127.0.0.1:3000";
const DEFAULT_API_ORIGIN =
  process.env.API_ORIGIN ||
  process.env.STATS_API_ORIGIN ||
  process.env.API_PROXY_TARGET ||
  "http://127.0.0.1:3001";

const RIFT_BUILD_KIND = {
  coreItems: "item",
  runes: "rune",
  spells: "spell",
};

const RIFT_SECTION_REPORTS = [
  {
    key: "matchups",
    title: "Матчапы",
    label: "матчапы",
    expectedVisibleCount: (count) => count,
    expandAll: true,
  },
  {
    key: "coreItems",
    title: "Основные предметы",
    label: "предметы",
    expectedVisibleCount: (count) => Math.min(count, 7),
    expandAll: false,
  },
  {
    key: "runes",
    title: "Руны",
    label: "руны",
    expectedVisibleCount: (count) => Math.min(count, 7),
    expandAll: false,
  },
  {
    key: "spells",
    title: "Заклинания",
    label: "заклинания",
    expectedVisibleCount: (count) => Math.min(count, 7),
    expandAll: false,
  },
];

const RIFT_BUILD_VISIBLE_LIMIT = 7;

const RIFT_RANK_LABEL = {
  diamond_plus: "Алмаз",
  master_plus: "Мастер",
  challenger: "ГМ",
  super_server: "Претендент",
};

const RIFT_RANK_ALIASES = {
  diamond_plus: ["Алмаз", "Diamond+"],
  master_plus: ["Мастер", "Master+"],
  challenger: ["ГМ", "Challenger"],
  super_server: ["Претендент", "Super Server"],
};

const RIFT_LANE_ALIASES = {
  top: ["Барон", "Baron", "Solo", "Top"],
  jungle: ["Лес", "Jungle"],
  mid: ["Мид", "Mid"],
  adc: ["Дракон", "Dragon", "ADC", "Duo"],
  support: ["Саппорт", "Support"],
};

function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    slug: null,
    limit: null,
    uiOrigin: DEFAULT_UI_ORIGIN,
    apiOrigin: DEFAULT_API_ORIGIN,
    headless: true,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--slug") {
      options.slug = argv[index + 1] || null;
      index += 1;
      continue;
    }

    if (arg === "--limit") {
      const value = Number.parseInt(argv[index + 1] || "", 10);
      options.limit = Number.isFinite(value) && value > 0 ? value : null;
      index += 1;
      continue;
    }

    if (arg === "--ui-origin") {
      options.uiOrigin = String(argv[index + 1] || options.uiOrigin).replace(/\/+$/, "");
      index += 1;
      continue;
    }

    if (arg === "--api-origin") {
      options.apiOrigin = String(argv[index + 1] || options.apiOrigin).replace(/\/+$/, "");
      index += 1;
      continue;
    }

    if (arg === "--headful") {
      options.headless = false;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      options.help = true;
    }
  }

  return options;
}

function printHelp() {
  console.log(`
Usage:
  npm run audit:guides:ui -- [--slug kalista] [--limit 10] [--ui-origin http://127.0.0.1:3000] [--api-origin http://127.0.0.1:3001] [--headful]

What it checks:
  - local guide pages in the browser
  - local wr-api guide payloads
  - WildRiftFire donor guide variants
  - RiftGG CN stats source

Examples:
  npm run audit:guides:ui -- --slug kalista
  npm run audit:guides:ui -- --limit 20
  npm run audit:guides:ui -- --ui-origin https://wildriftallstats.ru --api-origin https://wildriftallstats.ru/wr-api
`);
}

async function fetchJson(url) {
  const response = await fetch(url, { cache: "no-store" });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`);
  }

  return await response.json();
}

async function fetchGuideSlugs(apiOrigin) {
  const payload = await fetchJson(`${apiOrigin}/api/guides?fields=slug`);
  const items = Array.isArray(payload) ? payload : payload?.items || [];

  return Array.from(
    new Set(
      items
        .map((item) => String(item?.slug || item || "").trim())
        .filter(Boolean),
    ),
  );
}

async function fetchGuidePayload(apiOrigin, slug) {
  return await fetchJson(`${apiOrigin}/api/guides/${encodeURIComponent(slug)}?lang=ru_ru`);
}

function normalizeWrfVariantLabel(variant) {
  const laneLabel = localizeGuideLane(variant?.lane || variant?.title || "");
  const fallbackLabel = repairGuideText(variant?.title || variant?.lane || "").trim();

  if (!laneLabel && /^build\s*\d+$/i.test(fallbackLabel)) {
    return "";
  }

  if (!laneLabel && /^guide\s*\d+$/i.test(fallbackLabel)) {
    return "";
  }

  return repairGuideText(laneLabel || fallbackLabel).trim();
}

function variantHasBuilds(variant) {
  const itemBuild = variant?.itemBuild || {};
  return [
    itemBuild.starting,
    itemBuild.core,
    itemBuild.boots,
    itemBuild.finalBuild,
  ].some((items) => Array.isArray(items) && items.length);
}

function buildRiftBuildExpectationMap(normalized) {
  const dictionaries = {
    item: new Map(),
    rune: new Map(),
    spell: new Map(),
  };

  for (const row of normalized?.dictionaries || []) {
    if (!row?.slug || !dictionaries[row.kind]) continue;
    dictionaries[row.kind].set(row.slug, row.name || row.slug);
  }

  const expectations = new Map();

  for (const row of normalized?.builds || []) {
    const key = `${row.rank}::${row.lane}::${row.buildType}`;
    if (!expectations.has(key)) {
      expectations.set(key, {
        count: 0,
        sampleNames: [],
        visibleNames: [],
      });
    }

    const target = expectations.get(key);
    target.count += 1;

    if (!target.sampleNames.length) {
      const kind = RIFT_BUILD_KIND[row.buildType];
      target.sampleNames = (row.entrySlugs || [])
        .slice(0, 3)
        .map((slug) => dictionaries[kind]?.get(slug) || slug)
        .filter(Boolean);
    }

    if (target.visibleNames.length < RIFT_BUILD_VISIBLE_LIMIT * 3) {
      const kind = RIFT_BUILD_KIND[row.buildType];
      target.visibleNames.push(
        ...(row.entrySlugs || [])
          .map((slug) => dictionaries[kind]?.get(slug) || slug)
          .filter(Boolean),
      );
    }
  }

  return expectations;
}

function buildRiftMatchupExpectationMap(normalized) {
  const expectations = new Map();

  for (const row of normalized?.matchups || []) {
    const key = `${row.rank}::${row.lane}::matchups`;
    if (!expectations.has(key)) {
      expectations.set(key, {
        count: 0,
        sampleNames: [],
        sampleSlugs: [],
      });
    }

    const target = expectations.get(key);
    target.count += 1;

    const opponentSlug = String(row?.opponentSlug || "").trim();
    if (opponentSlug && target.sampleSlugs.length < 5 && !target.sampleSlugs.includes(opponentSlug)) {
      target.sampleSlugs.push(opponentSlug);
    }

    if (target.sampleNames.length < 5) {
      const rawName =
        row?.rawPayload?.heroName ||
        row?.rawPayload?.name ||
        row?.opponentSlug ||
        "";
      const repairedName = repairGuideText(String(rawName).trim());
      if (repairedName && !target.sampleNames.includes(repairedName)) {
        target.sampleNames.push(repairedName);
      }
    }
  }

  return expectations;
}

async function fetchRiftExpectation(slug) {
  const sourceSlug = mapToRiotSlug(slug);
  const url = `https://www.riftgg.app/en/champions/${encodeURIComponent(sourceSlug)}/cn-stats`;
  const response = await fetch(url, { cache: "no-store" });

  if (!response.ok) {
    throw new Error(`RiftGG HTTP ${response.status} for ${url}`);
  }

  const html = await response.text();
  const parsed = parseRiftGgCnStatsHtml(html);
  const normalized = normalizeRiftGgCnStats(slug, parsed);

  return {
    url,
    expectationMaps: {
      matchups: buildRiftMatchupExpectationMap(normalized),
      builds: buildRiftBuildExpectationMap(normalized),
    },
  };
}

async function listButtonLabels(page) {
  return await page.evaluate(() =>
    Array.from(document.querySelectorAll("button"))
      .map((button) => button.innerText.trim())
      .filter(Boolean),
  );
}

async function clickButtonByLabels(page, labels) {
  const clicked = await page.evaluate((targetLabels) => {
    const buttons = Array.from(document.querySelectorAll("button"));
    const normalizedTargets = targetLabels
      .map((value) => String(value || "").trim().toLowerCase())
      .filter(Boolean);
    const target = buttons.find((button) =>
      normalizedTargets.includes(button.innerText.trim().toLowerCase()),
    );
    if (!target) return null;
    target.click();
    return target.innerText.trim();
  }, labels);

  await page.waitForFunction(
    () => document.readyState === "complete",
    { timeout: 2000 },
  ).catch(() => {});
  await new Promise((resolve) => setTimeout(resolve, 120));

  return clicked;
}

async function expandMatchupsSection(page) {
  const clicked = await page.evaluate(() => {
    const headings = Array.from(document.querySelectorAll("h2"));
    const heading = headings.find((node) => node.textContent.trim() === "Матчапы");
    const section = heading?.closest("section");
    if (!section) return false;

    const buttons = Array.from(section.querySelectorAll("button"));
    const target = buttons.find((button) => /весь список/i.test(button.innerText.trim()));
    if (!target) return false;

    target.click();
    return true;
  });

  if (clicked) {
    await new Promise((resolve) => setTimeout(resolve, 120));
  }

  return clicked;
}

async function getGuideSectionSnapshot(page, title) {
  return await page.evaluate((targetTitle) => {
    const headings = Array.from(document.querySelectorAll("h2"));
    const heading = headings.find((node) => node.textContent.trim() === targetTitle);
    const section = heading?.closest("section");

    if (!section) {
      return { exists: false, text: "", labels: [], itemNames: [] };
    }

    const text = section.innerText || "";
    const itemNames = Array.from(
      section.querySelectorAll("img[alt]"),
    )
      .map((img) => img.getAttribute("alt") || "")
      .map((value) => value.trim())
      .filter(Boolean);
    const matchupNames = Array.from(section.querySelectorAll("a[href], article"))
      .map((node) => {
        const values = Array.from(node.querySelectorAll("div"))
          .map((child) => child.textContent?.trim() || "")
          .filter(Boolean);
        return (
          values.find(
            (value) =>
              !["Процент побед", "Коэффициент выбора", "Лучшие", "Худшие"].includes(value) &&
              !value.startsWith("#"),
          ) || ""
        );
      })
      .filter(Boolean);
    const linkedGuideSlugs = Array.from(section.querySelectorAll("a[href]"))
      .map((link) => link.getAttribute("href") || "")
      .map((href) => {
        const match = href.match(/\/guides\/([^/?#]+)/i);
        return match?.[1] || "";
      })
      .filter(Boolean);
    const labels = Array.from(section.querySelectorAll("h3"))
      .map((node) => node.textContent.trim())
      .filter(Boolean);
    const visibleEntryCount = Array.from(section.querySelectorAll("*")).filter(
      (node) => node.textContent.trim() === "Процент побед",
    ).length;
    const totalMatch = text.match(/Весь список \((\d+)\)/);
    const totalCount = Number.parseInt(totalMatch?.[1] || "", 10);
    const uniqueItemNames = Array.from(new Set(itemNames));

    return {
      exists: true,
      text,
      labels,
      itemNames: uniqueItemNames,
      matchupNames: Array.from(new Set(matchupNames)),
      linkedGuideSlugs: Array.from(new Set(linkedGuideSlugs)),
      visibleEntryCount,
      totalCount: Number.isFinite(totalCount) ? totalCount : visibleEntryCount,
    };
  }, title);
}

function collectUiCombos(apiGuide) {
  const combos = new Set();

  for (const collectionKey of ["matchups", "coreItems", "runes", "spells"]) {
    for (const row of apiGuide?.riftgg?.[collectionKey] || []) {
      if (!row?.rank || !row?.lane) continue;
      combos.add(`${row.rank}::${row.lane}`);
    }
  }

  return Array.from(combos);
}

function collectUiLanesForRank(apiGuide, rank) {
  const lanes = new Set();

  for (const collectionKey of ["matchups", "coreItems", "runes", "spells"]) {
    for (const row of apiGuide?.riftgg?.[collectionKey] || []) {
      if (row?.rank !== rank || !row?.lane) continue;
      lanes.add(row.lane);
    }
  }

  return Array.from(lanes);
}

function collectExpectedWrfLabels(wrfGuide) {
  return (wrfGuide?.variants || [])
    .filter(variantHasBuilds)
    .map(normalizeWrfVariantLabel)
    .filter(Boolean);
}

function createIssue(section, message, extra = {}) {
  return { section, message, ...extra };
}

function getExpectedSectionData(riftExpectation, rank, lane, sectionKey) {
  if (sectionKey === "matchups") {
    return (
      riftExpectation.expectationMaps.matchups.get(`${rank}::${lane}::matchups`) || {
        count: 0,
        sampleNames: [],
        sampleSlugs: [],
        visibleNames: [],
      }
    );
  }

  return (
    riftExpectation.expectationMaps.builds.get(`${rank}::${lane}::${sectionKey}`) || {
      count: 0,
      sampleNames: [],
      sampleSlugs: [],
      visibleNames: [],
    }
  );
}

function normalizeNames(values = []) {
  return Array.from(
    new Set(
      values
        .map((value) => repairGuideText(String(value || "").trim()))
        .filter(Boolean),
    ),
  );
}

function summarizeNames(values = [], limit = 5) {
  const names = normalizeNames(values).slice(0, limit);
  return names.length ? names.join(", ") : "нет";
}

function computeSectionComparison({ report, snapshot, expected }) {
  const siteVisibleCount = snapshot?.visibleEntryCount || 0;
  const siteTotalCount = snapshot?.totalCount || siteVisibleCount;
  const sourceTotalCount = expected.count || 0;
  const sourceVisibleCount = report.expectedVisibleCount(sourceTotalCount);
  const siteNames = normalizeNames(
    report.key === "matchups" ? snapshot?.matchupNames || [] : snapshot?.itemNames || [],
  );
  const sourceNames = normalizeNames(
    report.key === "matchups" ? expected.sampleNames || [] : expected.visibleNames || expected.sampleNames || [],
  );
  const siteSlugs = normalizeNames(snapshot?.linkedGuideSlugs || []);
  const sourceSlugs = normalizeNames(expected.sampleSlugs || []);
  const namesOverlap =
    report.key === "matchups"
      ? (!sourceSlugs.length || sourceSlugs.every((slug) => siteSlugs.includes(slug))) &&
        (!sourceNames.length || sourceNames.some((name) => siteNames.includes(name)))
      : sourceNames.length === siteNames.length &&
        sourceNames.every((name, index) => siteNames[index] === name);
  const countsMatch =
    report.key === "matchups"
      ? siteTotalCount === sourceTotalCount
      : siteVisibleCount === sourceVisibleCount;

  return {
    sectionKey: report.key,
    sectionLabel: report.label,
    siteVisibleCount,
    siteTotalCount,
    sourceVisibleCount,
    sourceTotalCount,
    siteNames,
    sourceNames,
    siteSlugs,
    sourceSlugs,
    ok: countsMatch && namesOverlap,
  };
}

async function auditGuide({
  browser,
  uiOrigin,
  apiOrigin,
  slug,
}) {
  const issues = [];
  const comparisons = [];
  const page = await browser.newPage();

  try {
    const [apiGuide, wrfGuide, riftExpectation] = await Promise.all([
      fetchGuidePayload(apiOrigin, slug),
      scrapeGuide(slug),
      fetchRiftExpectation(slug),
    ]);

    await page.goto(`${uiOrigin}/guides/${encodeURIComponent(slug)}`, {
      waitUntil: "networkidle2",
      timeout: 60000,
    });

    const pageText = await page.evaluate(() => document.body.innerText || "");
    const championName = repairGuideText(apiGuide?.champion?.name || slug);

    if (!pageText.includes(championName)) {
      issues.push(createIssue("page", "UI page is missing champion name", { championName }));
    }

    const wrfSection = await getGuideSectionSnapshot(page, "Сборки WildRiftFire");
    const expectedWrfLabels = collectExpectedWrfLabels(wrfGuide);

    if (expectedWrfLabels.length && !wrfSection.exists) {
      issues.push(createIssue("wildriftfire", "WildRiftFire builds section is missing", {
        expectedLabels: expectedWrfLabels,
      }));
    }

    if (wrfSection.exists) {
      for (const label of expectedWrfLabels) {
        if (!wrfSection.labels.some((item) => item.includes(label))) {
          issues.push(createIssue("wildriftfire", "Missing WildRiftFire build variant label", {
            label,
          }));
        }
      }
    }

    const combos = collectUiCombos(apiGuide);
    const checkedCombos = new Set();

    for (const combo of combos) {
      const [rank, lane] = combo.split("::");
      const rankLabel = RIFT_RANK_LABEL[rank];
      const laneLabel = localizeGuideLane(lane);
      const rankAliases = RIFT_RANK_ALIASES[rank] || [rankLabel].filter(Boolean);
      const laneAliases = RIFT_LANE_ALIASES[lane] || [laneLabel].filter(Boolean);
      const lanesForRank = collectUiLanesForRank(apiGuide, rank);

      if (!rankLabel || !laneLabel) continue;
      if (checkedCombos.has(combo)) continue;
      checkedCombos.add(combo);

      const clickedRank = await clickButtonByLabels(page, rankAliases);
      if (!clickedRank) {
        issues.push(createIssue("ui-tabs", "Rank tab is missing in UI", {
          rank,
          expectedLabels: rankAliases,
          availableButtons: await listButtonLabels(page),
        }));
        continue;
      }

      const clickedLane = await clickButtonByLabels(page, laneAliases);
      if (!clickedLane) {
        if (!(lanesForRank.length === 1 && lanesForRank[0] === lane)) {
          issues.push(createIssue("ui-tabs", "Lane tab is missing in UI", {
            rank,
            lane,
            expectedLabels: laneAliases,
            availableButtons: await listButtonLabels(page),
          }));
          continue;
        }
      }

      for (const report of RIFT_SECTION_REPORTS) {
        if (report.expandAll) {
          await expandMatchupsSection(page);
        }

        const expected = getExpectedSectionData(riftExpectation, rank, lane, report.key);
        const snapshot = await getGuideSectionSnapshot(page, report.title);
        comparisons.push({
          rank,
          lane,
          ...computeSectionComparison({
            report,
            snapshot,
            expected,
          }),
        });

        if (!snapshot.exists) {
          issues.push(createIssue("riftgg", "UI section is missing", {
            title: report.title,
            rank,
            lane,
            expectedCount: expected.count,
          }));
          continue;
        }

        const hasEmptyState = snapshot.text.includes("RiftGG пока не отдаёт этот блок");

        if (expected.count > 0 && hasEmptyState) {
          issues.push(createIssue("riftgg", "UI shows empty state while source has entries", {
            title: report.title,
            rank,
            lane,
            expectedCount: expected.count,
            sampleNames: expected.sampleNames,
            sampleSlugs: expected.sampleSlugs,
          }));
          continue;
        }

        if (
          expected.count > 0 &&
          ((report.key === "matchups" && expected.sampleSlugs?.length) ||
            (report.key !== "matchups" && (expected.visibleNames?.length || expected.sampleNames.length)))
        ) {
          const matchedName =
            report.key === "matchups"
              ? expected.sampleSlugs.find((item) => snapshot.linkedGuideSlugs.includes(item))
              : (expected.visibleNames || expected.sampleNames).find((name) =>
                  snapshot.text.includes(name) || snapshot.itemNames.includes(name),
                );

          if (!matchedName) {
            issues.push(createIssue("riftgg", "UI section does not show expected source items", {
              title: report.title,
              rank,
              lane,
              sampleNames: expected.sampleNames,
              visibleNames: expected.visibleNames,
              sampleSlugs: expected.sampleSlugs,
              siteNames: snapshot.itemNames,
              siteSlugs: snapshot.linkedGuideSlugs,
            }));
          }
        }

        if (expected.count === 0 && !hasEmptyState && !snapshot.text.includes("Процент побед")) {
          issues.push(createIssue("riftgg", "UI section looks filled although source has no entries", {
            title: report.title,
            rank,
            lane,
          }));
        }
      }
    }

    return {
      slug,
      ok: issues.length === 0,
      issues,
      comparisons,
      checkedCombos: Array.from(checkedCombos),
      expectedWrfVariants: expectedWrfLabels.length,
    };
  } finally {
    await page.close();
  }
}

function printComparisonRows(result) {
  const grouped = new Map();

  for (const row of result.comparisons || []) {
    const key = `${row.rank}::${row.lane}`;
    if (!grouped.has(key)) {
      grouped.set(key, []);
    }
    grouped.get(key).push(row);
  }

  for (const [key, rows] of grouped) {
    const [rank, lane] = key.split("::");
    const comboLabel = `${RIFT_RANK_LABEL[rank] || rank} / ${localizeGuideLane(lane) || lane}`;
    console.log(`[guides-ui-audit] ${result.slug} ${comboLabel}`);

    for (const row of rows) {
      const siteCountText =
        row.sectionKey === "matchups"
          ? `total=${row.siteTotalCount} visible=${row.siteVisibleCount}`
          : `visible=${row.siteVisibleCount}`;
      const sourceCountText =
        row.sectionKey === "matchups"
          ? `total=${row.sourceTotalCount} visible=${row.sourceVisibleCount}`
          : `total=${row.sourceTotalCount} visible=${row.sourceVisibleCount}`;
      const siteNamesText =
        row.sectionKey === "matchups"
          ? summarizeNames(row.siteSlugs.length ? row.siteSlugs : row.siteNames)
          : summarizeNames(row.siteNames);
      const sourceNamesText =
        row.sectionKey === "matchups"
          ? summarizeNames(row.sourceSlugs.length ? row.sourceSlugs : row.sourceNames)
          : summarizeNames(row.sourceNames);

      console.log(
        `  ${row.sectionLabel}: сайт ${siteCountText} names=[${siteNamesText}]`,
      );
      console.log(
        `  ${row.sectionLabel}: RiftGG ${sourceCountText} names=[${sourceNamesText}]`,
      );
      console.log(`  итог: ${row.ok ? "совпало" : "не совпало"}`);
    }
  }
}

function printResult(result) {
  printComparisonRows(result);

  if (result.ok) {
    console.log(
      `[guides-ui-audit] ${result.slug} -> ok | combos=${result.checkedCombos.length} wrfVariants=${result.expectedWrfVariants}`,
    );
    return;
  }

  console.log(
    `[guides-ui-audit] ${result.slug} -> failed | issues=${result.issues.length} combos=${result.checkedCombos.length}`,
  );

  for (const issue of result.issues) {
    const details = Object.entries(issue)
      .filter(([key]) => !["section", "message"].includes(key))
      .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
      .join(" ");
    console.log(`  - [${issue.section}] ${issue.message}${details ? ` | ${details}` : ""}`);
  }
}

async function main() {
  const options = parseArgs();

  if (options.help) {
    printHelp();
    return;
  }

  const slugs = options.slug
    ? [options.slug]
    : (await fetchGuideSlugs(options.apiOrigin)).slice(0, options.limit || undefined);

  if (!slugs.length) {
    throw new Error("No guide slugs resolved from local API");
  }

  const browser = await puppeteer.launch({
    headless: options.headless,
  });

  const results = [];

  try {
    for (const slug of slugs) {
      console.log(`[guides-ui-audit] start ${slug}`);
      const result = await auditGuide({
        browser,
        uiOrigin: options.uiOrigin,
        apiOrigin: options.apiOrigin,
        slug,
      });
      results.push(result);
      printResult(result);
    }
  } finally {
    await browser.close();
  }

  const failed = results.filter((result) => !result.ok);
  const passed = results.length - failed.length;

  console.log(
    `[guides-ui-audit] done -> total=${results.length} passed=${passed} failed=${failed.length}`,
  );

  if (failed.length) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("[guides-ui-audit] fatal", error);
  process.exitCode = 1;
});
