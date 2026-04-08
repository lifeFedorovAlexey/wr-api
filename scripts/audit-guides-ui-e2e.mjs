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

const RIFT_BUILD_TITLE = {
  coreItems: "Основные предметы",
  runes: "Руны",
  spells: "Заклинания",
};

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
  return repairGuideText(laneLabel || variant?.title || variant?.lane || "").trim();
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

function buildRiftExpectationMap(normalized) {
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
    expectationMap: buildRiftExpectationMap(normalized),
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
    const labels = Array.from(section.querySelectorAll("h3"))
      .map((node) => node.textContent.trim())
      .filter(Boolean);

    return { exists: true, text, labels, itemNames };
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

function collectExpectedWrfLabels(wrfGuide) {
  return (wrfGuide?.variants || [])
    .filter(variantHasBuilds)
    .map(normalizeWrfVariantLabel)
    .filter(Boolean);
}

function createIssue(section, message, extra = {}) {
  return { section, message, ...extra };
}

async function auditGuide({
  browser,
  uiOrigin,
  apiOrigin,
  slug,
}) {
  const issues = [];
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
        issues.push(createIssue("ui-tabs", "Lane tab is missing in UI", {
          rank,
          lane,
          expectedLabels: laneAliases,
          availableButtons: await listButtonLabels(page),
        }));
        continue;
      }

      for (const [buildType, title] of Object.entries(RIFT_BUILD_TITLE)) {
        const expected = riftExpectation.expectationMap.get(`${rank}::${lane}::${buildType}`) || {
          count: 0,
          sampleNames: [],
        };
        const snapshot = await getGuideSectionSnapshot(page, title);

        if (!snapshot.exists) {
          issues.push(createIssue("riftgg", "UI section is missing", {
            title,
            rank,
            lane,
            expectedCount: expected.count,
          }));
          continue;
        }

        const hasEmptyState = snapshot.text.includes("RiftGG пока не отдаёт этот блок");

        if (expected.count > 0 && hasEmptyState) {
          issues.push(createIssue("riftgg", "UI shows empty state while source has entries", {
            title,
            rank,
            lane,
            expectedCount: expected.count,
            sampleNames: expected.sampleNames,
          }));
          continue;
        }

        if (expected.count > 0 && expected.sampleNames.length) {
          const matchedName = expected.sampleNames.find((name) =>
            snapshot.text.includes(name) || snapshot.itemNames.includes(name),
          );

          if (!matchedName) {
            issues.push(createIssue("riftgg", "UI section does not show expected source items", {
              title,
              rank,
              lane,
              sampleNames: expected.sampleNames,
            }));
          }
        }

        if (expected.count === 0 && !hasEmptyState && !snapshot.text.includes("Процент побед")) {
          issues.push(createIssue("riftgg", "UI section looks filled although source has no entries", {
            title,
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
      checkedCombos: Array.from(checkedCombos),
      expectedWrfVariants: expectedWrfLabels.length,
    };
  } finally {
    await page.close();
  }
}

function printResult(result) {
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
