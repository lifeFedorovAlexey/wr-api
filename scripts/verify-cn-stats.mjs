import { randomInt } from "node:crypto";
import { request as httpsRequest } from "node:https";
import { pathToFileURL } from "node:url";
import puppeteer from "puppeteer";

const SITE_URL =
  process.env.CN_STATS_SITE_URL || "https://wildriftallstats.ru/winrates";
const SITE_API_URL =
  process.env.CN_STATS_SITE_API_URL ||
  new URL("/api/winrates-snapshot", SITE_URL).toString();
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
const SOURCE_API_URL =
  process.env.CN_STATS_SOURCE_API_URL ||
  "https://mlol.qt.qq.com/go/lgame_battle_info/hero_rank_list_v2";
const SOURCE_API_TIMEOUT_MS = Math.max(
  5_000,
  Number(process.env.CN_STATS_SOURCE_API_TIMEOUT_MS || "30000"),
);
const SOURCE_API_RETRIES = Math.max(
  1,
  Number(process.env.CN_STATS_SOURCE_API_RETRIES || "3"),
);

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
  { site: "Алмаз", source: "钻石以上", api: "1", siteApi: "diamondPlus" },
  { site: "Мастер", source: "大师以上", api: "2", siteApi: "masterPlus" },
  { site: "ГМ", source: "王者", api: "3", siteApi: "king" },
  { site: "Претендент", source: "峡谷之巅", api: "4", siteApi: "peak" },
];
const LANES = [
  { site: "Топ", source: "上单", api: "2", siteApi: "top" },
  { site: "Лес", source: "打野", api: "5", siteApi: "jungle" },
  { site: "Мид", source: "中路", api: "1", siteApi: "mid" },
  { site: "Стрелок", source: "下路", api: "3", siteApi: "adc" },
  { site: "Поддержка", source: "辅助", api: "4", siteApi: "support" },
];

let sourceApiPromise = null;
let siteApiPromise = null;

async function loadSiteApi() {
  if (!siteApiPromise) {
    siteApiPromise = (async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), NAVIGATION_TIMEOUT_MS);
      try {
        const response = await fetch(SITE_API_URL, {
          signal: controller.signal,
          headers: { accept: "application/json" },
        });
        if (!response.ok) throw new Error(`site API HTTP ${response.status}`);
        const payload = await response.json();
        if (!payload?.rowsBySlice || typeof payload.rowsBySlice !== "object") {
          throw new Error("site API payload has no rowsBySlice object");
        }
        console.warn(`[cn-stats-verify] using site API fallback: ${SITE_API_URL}`);
        return payload;
      } finally {
        clearTimeout(timeout);
      }
    })();
  }
  return siteApiPromise;
}

function fetchSourceApiOnce() {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(SOURCE_API_URL);
    const request = httpsRequest(
      {
        protocol: parsedUrl.protocol,
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || 443,
        path: `${parsedUrl.pathname}${parsedUrl.search}`,
        method: "GET",
        family: 4,
        headers: {
          accept: "application/json,text/plain,*/*",
          referer: SOURCE_URL,
          "user-agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/135.0.0.0 Safari/537.36",
        },
      },
      (response) => {
        const chunks = [];
        response.setEncoding("utf8");
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          const status = response.statusCode || 0;
          const body = chunks.join("");
          if (status < 200 || status >= 300) {
            reject(new Error(`source API HTTP ${status}: ${body.slice(0, 200)}`));
            return;
          }
          try {
            resolve(JSON.parse(body));
          } catch (error) {
            reject(new Error("source API returned invalid JSON", { cause: error }));
          }
        });
      },
    );
    request.setTimeout(SOURCE_API_TIMEOUT_MS, () => {
      request.destroy(new Error(`source API timeout after ${SOURCE_API_TIMEOUT_MS}ms`));
    });
    request.on("error", reject);
    request.end();
  });
}

async function loadSourceApi() {
  if (!sourceApiPromise) {
    sourceApiPromise = (async () => {
      let lastError = null;
      for (let attempt = 1; attempt <= SOURCE_API_RETRIES; attempt += 1) {
        try {
          const payload = await fetchSourceApiOnce();
          if (!payload?.data || typeof payload.data !== "object") {
            throw new Error("source API payload has no data object");
          }
          console.warn(
            `[cn-stats-verify] using official source API fallback: ${SOURCE_API_URL}`,
          );
          return payload;
        } catch (error) {
          lastError = error;
          if (attempt < SOURCE_API_RETRIES) await sleep(1_000 * attempt);
        }
      }
      throw new Error(
        `official source API unavailable after ${SOURCE_API_RETRIES} attempts: ${lastError?.message || lastError}`,
        { cause: lastError },
      );
    })();
  }
  return sourceApiPromise;
}

function readSourcePercent(item, explicitKey, ratioKey) {
  const explicit = Number(item?.[explicitKey]);
  if (Number.isFinite(explicit)) return explicit;
  const ratio = Number(item?.[ratioKey]);
  if (!Number.isFinite(ratio)) return NaN;
  return ratio >= 0 && ratio <= 1 ? ratio * 100 : ratio;
}

function readSourceApiRows(payload, rank, lane) {
  const rawRows = payload?.data?.[rank.api]?.[lane.api];
  if (!Array.isArray(rawRows)) {
    throw new Error(`official source API has no rows for ${rank.source}/${lane.source}`);
  }
  return [...rawRows]
    .sort(
      (left, right) =>
        readSourcePercent(right, "win_rate_percent", "win_rate") -
        readSourcePercent(left, "win_rate_percent", "win_rate"),
    )
    .map((item) => ({
      name: String(item?.hero_id || ""),
      text: `official-api hero=${item?.hero_id || ""}`,
      values: [
        readSourcePercent(item, "win_rate_percent", "win_rate"),
        readSourcePercent(item, "appear_rate_percent", "appear_rate"),
        readSourcePercent(item, "forbid_rate_percent", "forbid_rate"),
      ],
    }))
    .filter((row) => row.values.every(Number.isFinite));
}

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

  const controlSelector = 'button, a, [role="button"]';
  const candidateIndex = await page.evaluate((expectedText) => {
    const normalize = (value) =>
      String(value || "")
        .replace(/\s+/g, " ")
        .trim()
        .toLocaleLowerCase();
    const candidates = [...document.querySelectorAll('button, a, [role="button"]')];
    const matches = candidates
      .map((candidate, index) => ({ candidate, index }))
      .filter(
        ({ candidate }) =>
          normalize(candidate.getAttribute("aria-label") || candidate.textContent) ===
          expectedText,
      );
    const visible = matches.find(({ candidate }) => candidate.getClientRects().length > 0);
    return (visible || matches[0])?.index ?? -1;
  }, normalizedText);

  if (candidateIndex < 0) throw new Error(`control not found: ${text}`);
  const candidates = await page.$$(controlSelector);
  const candidate = candidates[candidateIndex];
  if (!candidate) throw new Error(`control not found: ${text}`);
  try {
    await candidate.click();
  } catch {
    await candidate.evaluate((element) => element.click());
  }
  await Promise.all(candidates.map((handle) => handle.dispose()));
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

function readSiteApiRows(payload, rank, lane) {
  const rawRows = payload?.rowsBySlice?.[`${rank.siteApi}|${lane.siteApi}`];
  if (!Array.isArray(rawRows)) {
    throw new Error(`site API has no rows for ${rank.site}/${lane.site}`);
  }
  return rawRows
    .map((row) => ({
      name: String(row?.name || row?.slug || ""),
      values: [
        Number(row?.winRate),
        Number(row?.pickRate),
        Number(row?.banRate),
      ],
    }))
    .filter((row) => row.name && row.values.every(Number.isFinite));
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
  const sourcePayload = await loadSourceApi();
  const browser = await puppeteer.launch({
    headless: "new",
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const sitePage = await browser.newPage();
    await sitePage.setViewport({ width: 1440, height: 1200 });

    await navigatePage(sitePage, SITE_URL, "site");

    const errors = [];
    const samples = [];
    const skippedSlices = [];
    let siteApiFallback = false;
    let sitePayload = null;

    const readSiteApiSlice = async (rank, lane) => {
      sitePayload ||= await loadSiteApi();
      return readSiteApiRows(sitePayload, rank, lane);
    };

    for (const [rankIndex, rank] of RANKS.entries()) {
      const rankPreviousSignatures = rankIndex === 0 || siteApiFallback
        ? null
        : await readRowsSignature(sitePage, "site");
      // Both public pages open on the first rank and first lane by default.
      // Avoid clicking the already-selected SSR default before hydration.
      if (rankIndex > 0 && !siteApiFallback) {
        try {
          await clickVisibleText(sitePage, rank.site);
        } catch (error) {
          siteApiFallback = true;
          console.warn(
            `[cn-stats-verify] site UI rank switch unavailable; using site API: ${error.message}`,
          );
        }
      }

      for (const [laneIndex, lane] of LANES.entries()) {
        const previousSignatures = laneIndex === 0 || siteApiFallback
          ? rankPreviousSignatures
          : await readRowsSignature(sitePage, "site");
        if ((rankIndex > 0 || laneIndex > 0) && !siteApiFallback) {
          try {
            await clickVisibleText(sitePage, lane.site);
          } catch (error) {
            siteApiFallback = true;
            console.warn(
              `[cn-stats-verify] site UI lane switch unavailable; using site API: ${error.message}`,
            );
          }
        }

        let siteRows;
        if (siteApiFallback) {
          siteRows = await readSiteApiSlice(rank, lane);
        } else {
          try {
            siteRows = await waitForRows(
              sitePage,
              "site",
              `site ${rank.site}/${lane.site}`,
              previousSignatures,
              laneIndex === 0 ? rank.site : lane.site,
            );
          } catch (error) {
            siteApiFallback = true;
            console.warn(
              `[cn-stats-verify] site UI rows did not switch; using site API: ${error.message}`,
            );
            siteRows = await readSiteApiSlice(rank, lane);
          }
        }
        const sourceRows = readSourceApiRows(sourcePayload, rank, lane);
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
