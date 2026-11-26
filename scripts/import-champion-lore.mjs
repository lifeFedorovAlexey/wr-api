import "dotenv/config";

import { eq, inArray, sql } from "drizzle-orm";

import { db, client } from "../db/client.js";
import { championLore, champions } from "../db/schema.js";
import { filterChampionsForPublicPool } from "../lib/championPublicPool.mjs";
import {
  buildChampionLoreRecord,
  createOfficialRiotLorePageSource,
  toStoredLoreLocale,
} from "../lib/championLoreImport.mjs";

function parseArgs(argv) {
  const options = {
    dryRun: false,
    force: false,
    locale: "ru_RU",
    concurrency: 3,
    missingOnly: false,
    slugs: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--force") options.force = true;
    else if (arg === "--locale") options.locale = argv[++index] || options.locale;
    else if (arg === "--concurrency") {
      options.concurrency = Math.max(1, Math.min(6, Number(argv[++index]) || 3));
    }
    else if (arg === "--missing-only") options.missingOnly = true;
    else if (arg === "--slug") options.slugs.push(String(argv[++index] || "").trim().toLowerCase());
    else throw new Error(`Unknown argument: ${arg}`);
  }

  options.slugs = [...new Set(options.slugs.filter(Boolean))];
  return options;
}

async function loadPublicChampions(slugs) {
  const query = db
    .select({
      slug: champions.slug,
      name: champions.name,
      nameLocalizations: champions.nameLocalizations,
    })
    .from(champions);
  const rows = await (slugs.length
    ? query.where(inArray(champions.slug, slugs))
    : query);

  return filterChampionsForPublicPool(rows).sort((left, right) =>
    left.slug.localeCompare(right.slug),
  );
}

async function upsertLore(record) {
  await db
    .insert(championLore)
    .values(record)
    .onConflictDoUpdate({
      target: [championLore.championSlug, championLore.locale],
      set: {
        title: record.title,
        shortLore: record.shortLore,
        officialLore: record.officialLore,
        generationFacts: record.generationFacts,
        sourceKind: record.sourceKind,
        sourceUrl: record.sourceUrl,
        canonicalUrl: record.canonicalUrl,
        contentHash: record.contentHash,
        reviewStatus: sql`case
          when ${championLore.contentHash} = ${record.contentHash}
            then ${championLore.reviewStatus}
          else 'pending'
        end`,
        importedAt: new Date(),
        updatedAt: new Date(),
      },
    });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const storedLocale = toStoredLoreLocale(options.locale);
  let publicChampions = await loadPublicChampions(options.slugs);
  if (!publicChampions.length) throw new Error("No public champions matched the import request");

  const existingRows = await db
    .select({
      championSlug: championLore.championSlug,
      contentHash: championLore.contentHash,
    })
    .from(championLore)
    .where(eq(championLore.locale, storedLocale));
  const existingHashes = new Map(existingRows.map((row) => [row.championSlug, row.contentHash]));
  if (options.missingOnly) {
    publicChampions = publicChampions.filter((champion) => !existingHashes.has(champion.slug));
  }
  if (!publicChampions.length) {
    console.log("[champion-lore] all requested champions already have lore");
    return;
  }
  const source = await createOfficialRiotLorePageSource({ locale: options.locale });
  const report = {
    locale: storedLocale,
    requested: publicChampions.length,
    insertedOrUpdated: 0,
    unchanged: 0,
    missing: [],
    failed: [],
    dryRun: options.dryRun,
    concurrency: options.concurrency,
    missingOnly: options.missingOnly,
  };

  try {
    let cursor = 0;
    const worker = async () => {
      while (cursor < publicChampions.length) {
        const champion = publicChampions[cursor];
        cursor += 1;
      try {
        const pageContent = await source.loadChampion(champion);
        if (!pageContent.officialLore) {
          report.missing.push(champion.slug);
          continue;
        }
        const record = buildChampionLoreRecord({
          championSlug: champion.slug,
          locale: source.locale,
          ...pageContent,
        });

        if (!options.force && existingHashes.get(champion.slug) === record.contentHash) {
          report.unchanged += 1;
          continue;
        }

        if (!options.dryRun) await upsertLore(record);
        report.insertedOrUpdated += 1;
      } catch (error) {
        report.failed.push({ championSlug: champion.slug, error: String(error?.message || error) });
      }
      }
    };
    await Promise.all(
      Array.from(
        { length: Math.min(options.concurrency, publicChampions.length) },
        () => worker(),
      ),
    );
  } finally {
    await source.close();
  }

  console.log("[champion-lore] report:", JSON.stringify(report, null, 2));
  if (report.failed.length) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error("[champion-lore] fatal:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await client.end({ timeout: 5 });
  });
