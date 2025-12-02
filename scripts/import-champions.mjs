// scripts/import-champions.mjs
// Локальный скрипт: node scripts/import-champions.mjs

import "dotenv/config";
import { updateChampions } from "../lib/updateChampions.mjs";

async function main() {
  await updateChampions();
  process.exit(0);
}

main().catch((e) => {
  console.error("[import] error:", e);
  process.exit(1);
});
