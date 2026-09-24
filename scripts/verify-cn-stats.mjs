import { randomInt } from "node:crypto";
import { pathToFileURL } from "node:url";
import puppeteer from "puppeteer";

const SITE_URL =
  process.env.CN_STATS_SITE_URL || "https://wildriftallstats.ru/winrates";
const SOURCE_URL =
  process.env.CN_STATS_SOURCE_URL ||
  "https://lolm.qq.com/act/a20220818raider/index.html";
const SAMPLES_PER_SLICE = Math.max(
  2,
  Number.parseInt(process.env.CN_STATS_SAMPLES_PER_SLICE || "2", 10),
);
const TOLERANCE = Number(process.env.CN_STATS_TOLERANCE || "0.02");
const NAVIGATION_TIMEOUT_MS = 60_000;

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function normalizeControlText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase();
}

const RANKS = [
  { site: "Алмаз", source: "钻石以上" },
  { site: "Мастер", source: "大师以上" },
  { site: "ГМ", source: "王者" },
  { site: "Претендент", source: "峡谷之巅" },
];
const LANES = [
  { site: "Топ", source: "上单" },
  { site: "Лес", source: "打野" },
  { site: "Мид", source: "中路" },
  { site: "Стрелок", source: "下路" },
  { site: "Поддержка", source: "辅助" },
];

function normalizeName(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase();
}

function compareMetric(label, expected, actual) {
  if (!Number.isFinite(expected) || !Number.isFinite(actual)) {
    return `${label}: missing percentage (source=${expected}, site=${actual})`;
  }
  if (Math.abs(expected - actual) > TOLERANCE) {
    return `${label}: source=${expected.toFixed(2)}% site=${actual.toFixed(2)}%`;
  }
  return null;
}

async function clickVisibleText(page, text) {
  const normalizedText = normalizeControlText(text);
  await page.waitForFunction(
    (expectedText) => {
      const normalize = (value) =>
        String(value || "")
          .replace(/\s+/g, " ")
          .trim()
          .toLocaleLowerCase();
      return [...document.querySelectorAll('button, a, [role="button"]')].some(
        (candidate) =>
          candidate.getClientRects().length > 0 &&
          normalize(candidate.textContent) === expectedText,
      );
    },
    { timeout: NAVIGATION_TIMEOUT_MS },
    normalizedText,
  );

  const clicked = await page.evaluate((expectedText) => {
    const normalize = (value) =>
      String(value || "")
        .replace(/\s+/g, " ")
        .trim()
        .toLocaleLowerCase();
    const candidates = [
      ...document.querySelectorAll('button, a, [role="button"]'),
    ];
    const element = candidates.find(
      (candidate) =>
        candidate.getClientRects().length > 0 &&
        normalize(candidate.textContent) === expectedText,
    );
    if (!element) return false;
    element.click();
    return true;
  }, normalizedText);

  if (!clicked) throw new Error(`control not found: ${text}`);
  await sleep(500);
}

async function readSiteRows(page) {
  return page.evaluate(() => {
    const rowElements = [
      ...document.querySelectorAll('[class*="WinratesTable"][class*="row"]'),
    ];
    return rowElements
      .map((row) => {
        const name = row.querySelector('[class*="heroName"]')?.textContent?.trim() || "";
        const cells = [...row.querySelectorAll('[class*="metricCell"]')];
        const values = cells.map((cell) => {
          const value = cell.lastElementChild?.textContent?.trim() || "";
          const match = value.match(/(-?\d+(?:\.\d+)?)\s*%/);
          return match ? Number(match[1]) : NaN;
        });
        return { name, values };
      })
      .filter((row) => row.name && row.values.length === 3);
  });
}

async function readSourceRows(page) {
  return page.evaluate(() => {
    const rows = [...document.querySelectorAll("#data-list li")];
    return rows
      .map((row) => ({
        text: row.innerText || row.textContent || "",
        values: [...(row.innerText || row.textContent || "").matchAll(
          /(-?\d+(?:\.\d+)?)\s*%/g,
        )].map((match) => Number(match[1])),
      }))
      .filter((row) => row.values.length >= 3);
  });
}

async function waitForRows(page, reader, label) {
  await page.waitForFunction(
    (kind) => {
      const rows = kind === "source"
        ? [...document.querySelectorAll("#data-list li")]
        : [...document.querySelectorAll('[class*="WinratesTable"][class*="row"]')];
      return kind === "source"
        ? rows.some((row) => /\d+(?:\.\d+)?\s*%/.test(row.innerText || row.textContent || ""))
        : rows.length > 0;
    },
    { timeout: NAVIGATION_TIMEOUT_MS },
    reader,
  );

  const rows = reader === "source" ? await readSourceRows(page) : await readSiteRows(page);
  if (!rows.length) throw new Error(`${label}: table has no readable rows`);
  return rows;
}

export async function verifyWebsiteStats() {
  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const sitePage = await browser.newPage();
    const sourcePage = await browser.newPage();
    await Promise.all([
      sitePage.setViewport({ width: 1440, height: 1200 }),
      sourcePage.setViewport({ width: 1440, height: 1200 }),
    ]);

    await Promise.all([
      sitePage.goto(SITE_URL, {
        waitUntil: "networkidle2",
        timeout: NAVIGATION_TIMEOUT_MS,
      }),
      sourcePage.goto(SOURCE_URL, {
        waitUntil: "networkidle2",
        timeout: NAVIGATION_TIMEOUT_MS,
      }),
    ]);

    const errors = [];
    const samples = [];

    for (const rank of RANKS) {
      await clickVisibleText(sitePage, rank.site);
      await clickVisibleText(sourcePage, rank.source);

      for (const lane of LANES) {
        await clickVisibleText(sitePage, lane.site);
        await clickVisibleText(sourcePage, lane.source);

        const [siteRows, sourceRows] = await Promise.all([
          waitForRows(sitePage, "site", `site ${rank.site}/${lane.site}`),
          waitForRows(sourcePage, "source", `source ${rank.source}/${lane.source}`),
        ]);
        const sampleCount = Math.min(
          SAMPLES_PER_SLICE,
          siteRows.length,
          sourceRows.length,
        );

        if (sampleCount < SAMPLES_PER_SLICE) {
          errors.push(
            `${rank.site}/${lane.site}: not enough rows for ${SAMPLES_PER_SLICE} samples (site=${siteRows.length}, source=${sourceRows.length})`,
          );
        }

        const selectedIndexes = new Set();
        while (selectedIndexes.size < sampleCount) {
          selectedIndexes.add(randomInt(Math.min(siteRows.length, sourceRows.length)));
        }

        for (const index of selectedIndexes) {
          const siteRow = siteRows[index];
          const sourceRow = sourceRows[index];
          const sourceValues = sourceRow.values.slice(-3);
          const siteValues = siteRow.values;
          const label = `${rank.site}/${lane.site}/#${index + 1}/${normalizeName(siteRow.name)}`;
          const rowErrors = [
            compareMetric(`${label} WR`, sourceValues[0], siteValues[0]),
            compareMetric(`${label} PR`, sourceValues[1], siteValues[1]),
            compareMetric(`${label} BR`, sourceValues[2], siteValues[2]),
          ].filter(Boolean);

          samples.push({
            rank: rank.site,
            lane: lane.site,
            position: index + 1,
            siteName: siteRow.name,
            sourceText: sourceRow.text.replace(/\s+/g, " ").trim(),
            siteValues,
            sourceValues,
            errors: rowErrors,
          });
          errors.push(...rowErrors);
        }
      }
    }

    return { errors, samples };
  } finally {
    await browser.close();
  }
}

async function main() {
  try {
    const report = await verifyWebsiteStats();
    console.log(
      `[cn-stats-verify] website samples=${report.samples.length} tolerance=${TOLERANCE}`,
    );
    for (const sample of report.samples) {
      console.log(
        `[cn-stats-verify] ${sample.rank}/${sample.lane}/#${sample.position} ${sample.siteName}: site=${sample.siteValues.join(",")} source=${sample.sourceValues.join(",")}`,
      );
    }

    if (report.errors.length) {
      console.error(`[cn-stats-verify] FAILED (${report.errors.length} errors)`);
      for (const error of report.errors) console.error(`- ${error}`);
      process.exitCode = 1;
      return;
    }

    console.log("[cn-stats-verify] OK — websites match");
  } catch (error) {
    console.error(`[cn-stats-verify] FAILED: ${error?.stack || error}`);
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
