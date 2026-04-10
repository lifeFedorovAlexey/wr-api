// scripts/import-champions.mjs
// Локальный скрипт: node scripts/import-champions.mjs

import "dotenv/config";
import { updateChampions } from "../lib/updateChampions.mjs";

async function main() {
  const report = await updateChampions();
  console.log("[import-champions] report:", JSON.stringify(report, null, 2));
  process.exit(0);
}

main().catch((e) => {
  console.error("[import] error:", e);
  process.exit(1);
});
