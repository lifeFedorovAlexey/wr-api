import "dotenv/config";
import fs from "node:fs/promises";
import { requireAcceptedCount } from "./assistant-sync-contract.mjs";
import { buildAssistantSyncBatches } from "../lib/assistant-sync-batches.mjs";

const apiOrigin = String(process.env.WR_API_ORIGIN || "http://127.0.0.1:3002").replace(/\/$/, "");
const secret = process.env.GUIDES_SYNC_SECRET;
if (!secret) throw new Error("GUIDES_SYNC_SECRET is required");

const rawItems = process.env.REPKA_SYNC_ITEMS_FILE
  ? await fs.readFile(process.env.REPKA_SYNC_ITEMS_FILE, "utf8")
  : process.env.REPKA_SYNC_ITEMS_JSON || "[]";
let items;
try {
  items = JSON.parse(rawItems);
} catch (error) {
  throw new Error(`REPKA_SYNC_ITEMS_JSON is invalid: ${error.message}`, { cause: error });
}
if (!Array.isArray(items)) throw new Error("REPKA_SYNC_ITEMS_JSON must be an array");
if (!items.length) {
  console.log("[sync] no validated results");
  process.exit(0);
}

const batches = buildAssistantSyncBatches(items);
let accepted = 0;
for (const [index, batch] of batches.entries()) {
  const response = await fetch(`${apiOrigin}/api/assistant/sync`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-guides-sync-secret": secret,
    },
    body: JSON.stringify({ items: batch }),
  });
  if (!response.ok) {
    throw new Error(
      `WR API sync batch ${index + 1}/${batches.length} ${response.status}: ${await response.text()}`,
    );
  }
  const payload = await response.json();
  accepted += requireAcceptedCount(payload, batch.length, `assistant sync batch ${index + 1}`);
}
console.log(`[sync] saved=${accepted} batches=${batches.length}`);
