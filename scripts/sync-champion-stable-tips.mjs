import "dotenv/config";
import { db, client } from "../db/client.js";
import { championStableTips } from "../db/schema.js";

const origin = String(process.env.WR_API_ORIGIN || "").replace(/\/$/, "");
const secret = process.env.GUIDES_SYNC_SECRET;
if (!origin || !secret) throw new Error("WR_API_ORIGIN and GUIDES_SYNC_SECRET are required");
const approved = (await db.select().from(championStableTips)).filter((row) => row.reviewStatus === "approved");
let synced = 0;
for (let index = 0; index < approved.length; index += 250) {
  const items = approved.slice(index, index + 250).map(({ id, createdAt, updatedAt, reviewStatus, ...item }) => item);
  const response = await fetch(`${origin}/api/assistant/tips/sync`, { method: "POST", headers: { "content-type": "application/json", "x-guides-sync-secret": secret }, body: JSON.stringify({ items }) });
  if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
  synced += (await response.json()).accepted;
}
await client.end({ timeout: 5 });
console.log(`[stable-tips] synced ${synced}/${approved.length}`);
