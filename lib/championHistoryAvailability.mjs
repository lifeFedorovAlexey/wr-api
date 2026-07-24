export function buildChampionHistoryAvailability(rows = []) {
  const seen = new Set();
  const result = [];

  for (const row of rows) {
    const rank = String(row?.rank || "").trim();
    const lane = String(row?.lane || "").trim();
    if (!rank || !lane) continue;
    const key = `${rank}:${lane}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ rank, lane });
  }

  return result;
}
