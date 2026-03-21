// api/cron-import-champions.js
// Legacy HTTP entrypoint for manual/remote cron triggering.

import { updateChampions } from "../lib/updateChampions.mjs";

export default async function handler(req, res) {
  try {
    await updateChampions();
    res.status(200).json({ ok: true });
  } catch (e) {
    console.error("[cron] error:", e);
    res.status(500).json({ ok: false, error: String(e) });
  }
}
