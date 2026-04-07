export function parseBackfillCliArgs(argv) {
  const args = argv.slice(2);
  const options = {
    dryRun: false,
    force: false,
    requireS3: false,
    slugs: [],
  };

  for (const arg of args) {
    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }

    if (arg === "--force") {
      options.force = true;
      continue;
    }

    if (arg === "--require-s3") {
      options.requireS3 = true;
      continue;
    }

    options.slugs.push(String(arg || "").trim().toLowerCase());
  }

  return options;
}

export function attachBackfillShutdown(mainPromise, client, label) {
  mainPromise
    .then(async () => {
      try {
        await client.end();
      } catch (error) {
        console.warn(
          `[${label}] failed to close Postgres client:`,
          error instanceof Error ? error.message : String(error),
        );
      }
      process.exit(0);
    })
    .catch(async (error) => {
      console.error(`[${label}] error:`, error);
      try {
        await client.end();
      } catch (closeError) {
        console.warn(
          `[${label}] failed to close Postgres client:`,
          closeError instanceof Error ? closeError.message : String(closeError),
        );
      }
      process.exit(1);
    });
}
