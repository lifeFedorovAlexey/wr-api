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
const ROWS_TIMEOUT_MS = 20_000;

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function navigatePage(page, url, label) {
  try {
    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: NAVIGATION_TIMEOUT_MS,
    });
  } catch (error) {
    const isNavigationTimeout = String(error?.message || "").includes(
      "Navigation timeout",
    );
    const hasDocument = await page
      .evaluate(() => document.readyState !== "loading")
      .catch(() => false);
    if (!isNavigationTimeout || !hasDocument) throw error;
    console.warn(
      `[cn-stats-verify] ${label} navigation timed out; continuing with loaded DOM`,
    );
  }
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

async function clickVisibleText(page, text, { expectActive = false } = {}) {
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
          normalize(candidate.getAttribute("aria-label") || candidate.textContent) ===
          expectedText,
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
        normalize(candidate.getAttribute("aria-label") || candidate.textContent) ===
        expectedText,
    );
    if (!element) return false;
    element.click();
    return true;
  }, normalizedText);

  if (!clicked) throw new Error(`control not found: ${text}`);
  if (expectActive) {
    await page.waitForFunction(
      (expectedText) => {
        const normalize = (value) =>
          String(value || "")
            .replace(/\s+/g, " ")
            .trim()
            .toLocaleLowerCase();
        const candidate = [...document.querySelectorAll("button")].find(
          (button) =>
            normalize(button.getAttribute("aria-label") || button.textContent) ===
            expectedText,
        );
        return Boolean(
          candidate &&
          (candidate.getAttribute("aria-pressed") === "true" ||
            [...candidate.classList].some((className) =>
              className.toLocaleLowerCase().includes("buttonactive"),
            )),
        );
      },
      { timeout: 5_000 },
      normalizedText,
    );
  }
  await sleep(500);
}

async function readSiteRows(page) {
  return page.evaluate(() => {
    // CSS-module class names are generated during the UI build and have
    // already changed without changing the table markup. The row itself has
    // a stable tabIndex, while each metric cell exposes the stable CSS
    // variable used for its accent color.
    const rowElements = [...document.querySelectorAll('div[tabindex="0"]')];
    return rowElements
      .map((row) => {
        const name = row.querySelector('span[title]')?.textContent?.trim() || "";
        const cells = [...row.querySelectorAll('div[style*="--metric-accent"]')];
        const values = cells.map((cell) => {
          const matches = [
            ...(cell.textContent || "").matchAll(/(-?\d+(?:\.\d+)?)\s*%/g),
          ];
          return matches.length ? Number(matches.at(-1)[1]) : NaN;
        });
        return { name, values };
      })
      .filter(
        (row) =>
          row.name &&
          row.values.length >= 3 &&
          row.values.slice(0, 3).every(Number.isFinite),
      )
      .map((row) => ({ ...row, values: row.values.slice(0, 3) }));
  });
}

async function readSourceRows(page) {
  return page.evaluate(() => {
    const rows = [...document.querySelectorAll("#data-list li")];
    return rows
      .map((row) => {
        const text = row.innerText || row.textContent || "";
        return {
          name: row.querySelector(".hero-name")?.textContent?.trim() || "",
          text,
          values: [...text.matchAll(/(-?\d+(?:\.\d+)?)\s*%/g)].map((match) =>
            Number(match[1]),
          ),
        };
      })
      .filter((row) => row.values.length >= 3);
  });
}

async function readRowsSignature(page, reader) {
  return page.evaluate((kind) => {
    const rows = kind === "source"
      ? [...document.querySelectorAll("#data-list li")]
      : [...document.querySelectorAll('div[tabindex="0"]')];
    const signatureFor = (row) => {
      if (kind === "source") {
        return (row.textContent || row.innerText || "").replace(/\s+/g, " ").trim();
      }
      const name = row.querySelector('span[title]')?.textContent?.trim() || "";
      const metrics = [...row.querySelectorAll('div[style*="--metric-accent"]')]
        .map((cell) => {
          const matches = [
            ...(cell.textContent || "").matchAll(/(-?\d+(?:\.\d+)?)\s*%/g),
          ];
          return matches.length ? matches.at(-1)[1] : "";
        })
        .join("|");
      return `${name}|${metrics}`;
    };
    return rows
      .slice(0, 5)
      .map(signatureFor)
      .join("||");
  }, reader);
}

// The browser-side diagnostics and readiness checks intentionally live here
// so one poll observes the same DOM state before rows are parsed.
// eslint-disable-next-line max-lines-per-function
async function waitForRows(
  page,
  reader,
  label,
  previousSignature = null,
  selectedControl = null,
) {
  try {
    await page.waitForFunction(
      (kind, previous, expectedControl) => {
        const normalizedExpectedControl = expectedControl
          ? String(expectedControl)
            .replace(/\s+/g, " ")
            .trim()
            .toLocaleLowerCase()
          : "";
        const rows = kind === "source"
          ? [...document.querySelectorAll("#data-list li")]
          : [...document.querySelectorAll('div[tabindex="0"]')];
        const hasRows = kind === "source"
          ? rows.some((row) => /\d+(?:\.\d+)?\s*%/.test(row.innerText || row.textContent || ""))
          : rows.some((row) => {
            const name = row.querySelector('span[title]')?.textContent?.trim() || "";
            const metrics = [...row.querySelectorAll('div[style*="--metric-accent"]')];
            return Boolean(name) && metrics.length >= 3 && metrics.every((cell) =>
              /-?\d+(?:\.\d+)?\s*%/.test(cell.textContent || ""),
            );
          });
        const pageText = document.body?.innerText || "";
        const hasEmptyState = kind === "source"
          ? pageText.includes("暂无数据")
          : pageText.includes("Нет данных");
        const signatureFor = (row) => {
          if (kind === "source") {
            return (row.textContent || row.innerText || "").replace(/\s+/g, " ").trim();
          }
          const name = row.querySelector('span[title]')?.textContent?.trim() || "";
          const metrics = [...row.querySelectorAll('div[style*="--metric-accent"]')]
            .map((cell) => {
              const matches = [
                ...(cell.textContent || "").matchAll(/(-?\d+(?:\.\d+)?)\s*%/g),
              ];
              return matches.length ? matches.at(-1)[1] : "";
            })
            .join("|");
          return `${name}|${metrics}`;
        };
        const signature = rows
          .slice(0, 5)
          .map(signatureFor)
          .join("||");
        const controlIsActive = kind === "site" && expectedControl
          ? [...document.querySelectorAll("button")].some((button) => {
            const normalize = (value) =>
              String(value || "")
                .replace(/\s+/g, " ")
                .trim()
                .toLocaleLowerCase();
            return (
              normalize(button.getAttribute("aria-label") || button.textContent) ===
                normalizedExpectedControl &&
              (button.getAttribute("aria-pressed") === "true" ||
                [...button.classList].some((className) =>
                  className.toLocaleLowerCase().includes("buttonactive"),
                ))
            );
          })
          : false;
        return hasEmptyState ||
          (hasRows &&
            (!previous || signature !== previous || controlIsActive));
      },
      { timeout: ROWS_TIMEOUT_MS },
      reader,
      previousSignature,
      selectedControl,
    );
  } catch (error) {
    const diagnostics = await page.evaluate((kind) => {
      const dataList = document.querySelector("#data-list");
      const rowSelector = 'div[tabindex="0"]';
      const siteRows = [...document.querySelectorAll(rowSelector)];
      return {
        url: window.location.href,
        title: document.title,
        dataListText: dataList?.innerText?.trim() || null,
        sourceRows: dataList?.querySelectorAll("li").length || 0,
        siteRows: siteRows.length,
        siteRowsWithMetrics: siteRows.filter((row) =>
          row.querySelectorAll('div[style*="--metric-accent"]').length >= 3,
        ).length,
        activeControls: [...document.querySelectorAll("button")]
          .filter((button) =>
            [...button.classList].some((className) =>
              className.toLocaleLowerCase().includes("buttonactive"),
            ),
          )
          .map((button) =>
            button.getAttribute("aria-label") || button.textContent?.trim(),
          )
          .filter(Boolean),
        bodyText: (document.body?.innerText || "").replace(/\s+/g, " ").trim().slice(0, 240),
        signature: [...(kind === "source"
          ? document.querySelectorAll("#data-list li")
          : document.querySelectorAll(rowSelector))]
          .slice(0, 5)
          .map((row) => {
            if (kind === "source") {
              return (row.textContent || row.innerText || "").replace(/\s+/g, " ").trim();
            }
            const name = row.querySelector('span[title]')?.textContent?.trim() || "";
            const metrics = [...row.querySelectorAll('div[style*="--metric-accent"]')]
              .map((cell) => {
                const matches = [
                  ...(cell.textContent || "").matchAll(/(-?\d+(?:\.\d+)?)\s*%/g),
                ];
                return matches.length ? matches.at(-1)[1] : "";
              })
              .join("|");
            return `${name}|${metrics}`;
          })
          .join("||"),
        kind,
      };
    }, reader);
    const sourceHint = reader === "source" && diagnostics.dataListText?.includes("获取数据中")
      ? " official source API did not populate #data-list"
      : "";
    throw new Error(
      `${label}: rows did not load within ${ROWS_TIMEOUT_MS}ms.${sourceHint} diagnostics=${JSON.stringify(diagnostics)}`,
      { cause: error },
    );
  }

  const pageState = await page.evaluate((kind) => {
    const rowSelector = 'div[tabindex="0"]';
    const dataList = document.querySelector("#data-list");
    const pageText = document.body?.innerText || "";
    return {
      hasEmptyState: kind === "source"
        ? pageText.includes("暂无数据")
        : pageText.includes("Нет данных"),
      hasRows: kind === "source"
        ? [...(dataList?.querySelectorAll("li") || [])].some((row) =>
          /\d+(?:\.\d+)?\s*%/.test(row.innerText || row.textContent || ""),
        )
        : [...document.querySelectorAll(rowSelector)].some((row) =>
          row.querySelectorAll('div[style*="--metric-accent"]').length >= 3,
        ),
    };
  }, reader);
  if (pageState.hasEmptyState && !pageState.hasRows) return [];

  const rows = reader === "source" ? await readSourceRows(page) : await readSiteRows(page);
  if (!rows.length) throw new Error(`${label}: table has no readable rows`);
  return rows;
}

export async function verifyWebsiteStats() {
  const browser = await puppeteer.launch({
    headless: "new",
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
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
      navigatePage(sitePage, SITE_URL, "site"),
      navigatePage(sourcePage, SOURCE_URL, "source"),
    ]);

    const errors = [];
    const samples = [];
    const skippedSlices = [];

    for (const [rankIndex, rank] of RANKS.entries()) {
      const rankPreviousSignatures = rankIndex === 0
        ? [null, null]
        : await Promise.all([
          readRowsSignature(sitePage, "site"),
          readRowsSignature(sourcePage, "source"),
        ]);
      // Both public pages open on the first rank and first lane by default.
      // Avoid clicking the already-selected SSR default before hydration.
      if (rankIndex > 0) {
        await clickVisibleText(sitePage, rank.site, { expectActive: true });
        await clickVisibleText(sourcePage, rank.source);
      }

      for (const [laneIndex, lane] of LANES.entries()) {
        const previousSignatures = laneIndex === 0
          ? rankPreviousSignatures
          : await Promise.all([
            readRowsSignature(sitePage, "site"),
            readRowsSignature(sourcePage, "source"),
          ]);
        if (rankIndex > 0 || laneIndex > 0) {
          await clickVisibleText(sitePage, lane.site, { expectActive: true });
          await clickVisibleText(sourcePage, lane.source);
        }

        const [siteRows, sourceRows] = await Promise.all([
          waitForRows(
            sitePage,
            "site",
            `site ${rank.site}/${lane.site}`,
            previousSignatures[0],
            laneIndex === 0 ? rank.site : lane.site,
          ),
          waitForRows(
            sourcePage,
            "source",
            `source ${rank.source}/${lane.source}`,
            previousSignatures[1],
          ),
        ]);
        if (!siteRows.length && !sourceRows.length) {
          skippedSlices.push(`${rank.site}/${lane.site}`);
          continue;
        }
        if (!siteRows.length || !sourceRows.length) {
          errors.push(
            `${rank.site}/${lane.site}: one site has no data (site=${siteRows.length}, source=${sourceRows.length})`,
          );
          continue;
        }
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

    return { errors, samples, skippedSlices };
  } finally {
    await browser.close();
  }
}

async function main() {
  try {
    const report = await verifyWebsiteStats();
    console.log(
      `[cn-stats-verify] website samples=${report.samples.length} skipped=${report.skippedSlices.length} tolerance=${TOLERANCE}`,
    );
    for (const slice of report.skippedSlices) {
      console.log(`[cn-stats-verify] SKIP ${slice}: both websites show no data`);
    }
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
