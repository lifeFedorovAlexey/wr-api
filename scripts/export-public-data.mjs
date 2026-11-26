import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import dotenv from "dotenv";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const apiRoot = path.resolve(scriptDir, "..");
const workspaceRoot = path.resolve(apiRoot, "..");

dotenv.config({ path: path.join(apiRoot, ".env"), quiet: true });

const [routeSets, schemaModule, dbModule, scrapeStoreModule] = await Promise.all([
  import(pathToFileURL(path.join(apiRoot, "lib", "routeSets.mjs")).href),
  import(pathToFileURL(path.join(apiRoot, "db", "schema.js")).href),
  import(pathToFileURL(path.join(apiRoot, "db", "client.js")).href),
  import(pathToFileURL(path.join(apiRoot, "lib", "scrapeStore.mjs")).href),
]);

const { publicRoutes, guideDetailRoute, patchNotesDetailRoute } = routeSets;
const { champions } = schemaModule;
const { db, client } = dbModule;
const { connectScrapeStore, acquireCoordinator, releaseCoordinator } = scrapeStoreModule;

const SNAPSHOT_SCHEMA = "wildrift-public-snapshot";
const SNAPSHOT_VERSION = 1;
const LANGUAGES = ["ru_ru", "en_us"];
const LANES = ["top", "jungle", "mid", "adc", "support"];

function parseArgs(argv) {
  const options = {
    output: process.env.PUBLIC_DATA_EXPORT_DIR || path.join(workspaceRoot, ".runtime", "public-data"),
    releaseId: null,
    publish: false,
  };

  for (const arg of argv.slice(2)) {
    if (arg === "--publish") {
      options.publish = true;
      continue;
    }
    if (arg.startsWith("--output=")) {
      options.output = arg.slice("--output=".length);
      continue;
    }
    if (arg.startsWith("--release=")) {
      options.releaseId = arg.slice("--release=".length);
    }
  }

  return options;
}

function safeSegment(value) {
  const normalized = String(value || "").trim();
  if (!normalized || normalized === "." || normalized === "..") {
    throw new Error(`Invalid snapshot path segment: ${value}`);
  }
  return encodeURIComponent(normalized);
}

function createResponseCapture() {
  const headers = new Map();
  let payload = null;
  let statusCode = 200;

  const response = {
    statusCode,
    headersSent: false,
    status(code) {
      statusCode = Number(code) || 500;
      response.statusCode = statusCode;
      return response;
    },
    setHeader(name, value) {
      headers.set(String(name).toLowerCase(), String(value));
      return response;
    },
    getHeader(name) {
      return headers.get(String(name).toLowerCase());
    },
    json(value) {
      payload = value;
      response.headersSent = true;
      return response;
    },
    end(value) {
      if (value !== undefined && payload === null) payload = value;
      response.headersSent = true;
      return response;
    },
  };

  return {
    response,
    get result() {
      return { statusCode, headers, payload };
    },
  };
}

async function invoke(handler, { pathname, query = {}, params = {} }) {
  const capture = createResponseCapture();
  await handler(
    {
      method: "GET",
      url: pathname,
      query,
      params,
      headers: {},
      body: null,
    },
    capture.response,
  );

  const { statusCode, payload } = capture.result;
  if (statusCode < 200 || statusCode >= 300) {
    throw new Error(`${pathname} returned HTTP ${statusCode}`);
  }
  if (payload === null || payload === undefined) {
    throw new Error(`${pathname} returned an empty response`);
  }
  return payload;
}

function route(pathname) {
  const handler = publicRoutes.get(pathname);
  if (!handler) throw new Error(`Public route is not registered: ${pathname}`);
  return handler;
}

async function writeJson(releaseDir, relativePath, payload) {
  const target = path.join(releaseDir, relativePath);
  await fs.mkdir(path.dirname(target), { recursive: true });
  const serialized = `${JSON.stringify(payload)}\n`;
  await fs.writeFile(target, serialized, "utf8");
  return {
    file: relativePath.replaceAll(path.sep, "/"),
    size: Buffer.byteLength(serialized),
    sha256: crypto.createHash("sha256").update(serialized).digest("hex"),
  };
}

function buildReleaseId(value) {
  const candidate = String(value || "").trim();
  if (candidate) return candidate.replace(/[^a-zA-Z0-9._-]/g, "-");
  return new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 17);
}

async function publishLocal(outputRoot, releaseDir, releaseId) {
  const releasesDir = path.join(outputRoot, "releases");
  const currentPath = path.join(outputRoot, "current");
  const temporaryPath = path.join(outputRoot, `.current-${releaseId}-${process.pid}`);
  await fs.mkdir(releasesDir, { recursive: true });
  await fs.rename(releaseDir, path.join(releasesDir, releaseId));

  try {
    await fs.rm(temporaryPath, { recursive: true, force: true });
    await fs.symlink(path.join("releases", releaseId), temporaryPath, "junction");
    await fs.rename(temporaryPath, currentPath);
  } catch (error) {
    await fs.rm(temporaryPath, { recursive: true, force: true });
    throw error;
  }
}

async function main() {
  const options = parseArgs(process.argv);
  const outputRoot = path.resolve(options.output);
  const releaseId = buildReleaseId(options.releaseId);
  const stagingDir = path.join(outputRoot, `.staging-${releaseId}-${process.pid}`);

  await fs.rm(stagingDir, { recursive: true, force: true });
  await fs.mkdir(stagingDir, { recursive: true });

  const datasets = {};
  const add = async (name, relativePath, payload) => {
    datasets[name] = await writeJson(stagingDir, relativePath, payload);
  };

  console.log(`[public-export] release=${releaseId} step=champions`);
  for (const language of LANGUAGES) {
    const full = await invoke(route("/api/champions"), {
      pathname: `/api/champions?lang=${language}`,
      query: { lang: language },
    });
    const suffix = language.replace("_", "-");
    await add(`champions:${language}`, `champions.${suffix}.json`, full);
    await add(
      `champions:${language}:names`,
      `champions.${suffix}.names.json`,
      full.map((item) => ({ slug: item.slug, name: item.name })),
    );
    await add(
      `champions:${language}:index`,
      `champions.${suffix}.index.json`,
      full.map((item) => ({
        slug: item.slug,
        name: item.name,
        roles: Array.isArray(item.roles) ? item.roles : [],
        iconUrl: item.icon || null,
      })),
    );
  }

  console.log(`[public-export] release=${releaseId} step=stats`);
  await add("updated-at", "updated-at.json", await invoke(route("/api/updated-at"), {
    pathname: "/api/updated-at",
  }));
  await add(
    "latest-stats-snapshot",
    "latest-stats-snapshot.json",
    await invoke(route("/api/latest-stats-snapshot"), { pathname: "/api/latest-stats-snapshot" }),
  );
  await add(
    "winrates-snapshot",
    "winrates-snapshot.json",
    await invoke(route("/api/winrates-snapshot"), { pathname: "/api/winrates-snapshot" }),
  );
  await add(
    "champion-history",
    "champion-history.json",
    await invoke(route("/api/champion-history"), { pathname: "/api/champion-history" }),
  );
  await add(
    "tierlist-bulk:ru_ru",
    "tierlist-bulk.ru-ru.json",
    await invoke(route("/api/tierlist-bulk"), {
      pathname: "/api/tierlist-bulk?lang=ru_ru",
      query: { lang: "ru_ru" },
    }),
  );
  await add(
    "tierlist-bulk:en_us",
    "tierlist-bulk.en-us.json",
    await invoke(route("/api/tierlist-bulk"), {
      pathname: "/api/tierlist-bulk?lang=en_us",
      query: { lang: "en_us" },
    }),
  );

  console.log(`[public-export] release=${releaseId} step=guides`);
  const guideList = await invoke(route("/api/guides"), { pathname: "/api/guides" });
  const guideSlugs = await invoke(route("/api/guides"), {
    pathname: "/api/guides?fields=slug",
    query: { fields: "slug" },
  });
  await add("guides", "guides.json", guideList);
  await add("guides:slugs", "guides.slugs.json", guideSlugs);
  for (const slug of guideSlugs) {
    const encoded = safeSegment(slug);
    const payload = await invoke(guideDetailRoute.handler, {
      pathname: `/api/guides/${encoded}`,
      params: { slug },
      query: { lang: "ru_ru" },
    });
    await add(`guide:${slug}`, `guides/${encoded}.json`, payload);
  }

  console.log(`[public-export] release=${releaseId} step=patch-notes`);
  const patchList = await invoke(route("/api/patch-notes"), { pathname: "/api/patch-notes" });
  await add("patch-notes", "patch-notes.json", patchList);
  for (const patch of Array.isArray(patchList?.items) ? patchList.items : []) {
    const version = String(patch?.version || "").trim();
    if (!version) continue;
    const encoded = safeSegment(version);
    const payload = await invoke(patchNotesDetailRoute.handler, {
      pathname: `/api/patch-notes/${encoded}`,
      params: { version },
      query: {},
    });
    await add(`patch:${version}`, `patch-notes/${encoded}.json`, payload);
  }

  console.log(`[public-export] release=${releaseId} step=trend-events`);
  const championList = await db.select({ slug: champions.slug }).from(champions);
  for (const row of championList) {
    const slug = String(row?.slug || "").trim();
    if (!slug) continue;
    for (const lane of LANES) {
      const payload = await invoke(route("/api/trend-events"), {
        pathname: `/api/trend-events?slug=${slug}&lane=${lane}&from=2000-01-01&to=2100-12-31`,
        query: { slug, lane, from: "2000-01-01", to: "2100-12-31" },
      });
      await add(`trend-events:${slug}:${lane}`, `trend-events/${safeSegment(slug)}/${safeSegment(lane)}.json`, payload);
    }
  }

  const manifest = {
    schema: SNAPSHOT_SCHEMA,
    version: SNAPSHOT_VERSION,
    releaseId,
    generatedAt: new Date().toISOString(),
    datasets,
  };
  await fs.writeFile(
    path.join(stagingDir, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );

  if (options.publish) {
    await publishLocal(outputRoot, stagingDir, releaseId);
    console.log(`[public-export] published=${path.join(outputRoot, "current")}`);
  } else {
    const finalDir = path.join(outputRoot, "releases", releaseId);
    await fs.mkdir(path.dirname(finalDir), { recursive: true });
    await fs.rename(stagingDir, finalDir);
    console.log(`[public-export] release=${finalDir}`);
  }

  return manifest;
}

const coordinator = connectScrapeStore(process.env.DATABASE_URL, { readonly: true });
let coordinatorLockHeld = false;

try {
  if (process.env.PUBLIC_DATA_SKIP_COORDINATOR_LOCK === "true") {
    await main();
  } else {
    const lock = await acquireCoordinator(coordinator);
    if (!lock.acquired) {
      console.log("[public-export] another import is active; keeping the previous release");
    } else {
      coordinatorLockHeld = true;
      await main();
    }
  }
} catch (error) {
  console.error("[public-export] fatal:", error);
  process.exitCode = 1;
} finally {
  if (coordinatorLockHeld) {
    try {
      await releaseCoordinator(coordinator);
    } catch { /* connection may already be closed */ }
  }
  try {
    await coordinator.end({ timeout: 5 });
  } catch { /* best-effort cleanup */ }
  try {
    await client.end({ timeout: 5 });
  } catch { /* best-effort cleanup */ }
}
