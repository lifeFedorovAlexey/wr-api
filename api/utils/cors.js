const ALLOWED_ORIGINS = new Set([
  "https://wildriftallstats.ru",
  "https://wildriftchampions-data.vercel.app",
  "http://localhost:3000",
]);

export function setCors(req, res) {
  const origin = req.headers.origin;

  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    // Чтобы CDN/браузер не переиспользовали ответ для другого Origin.
    // Если где-то ещё добавляется Vary — не перетираем его.
    const prevVary = res.getHeader("Vary");
    if (!prevVary) {
      res.setHeader("Vary", "Origin");
    } else if (typeof prevVary === "string" && !prevVary.includes("Origin")) {
      res.setHeader("Vary", `${prevVary}, Origin`);
    }
  }

  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}
