export const FALLBACK_MS = 2 * 60 * 60 * 1000;
export const LEASE_MS = 90_000;
export const RETRY_MS = 15 * 60 * 1000;

export const JOBS = {
  stats: { title: "Чемпионы и CN-статистика", period: "hourly", minute: 17, timeoutMs: 50 * 60_000 },
  riftgg: { title: "RiftGG", period: "daily", hour: 3, minute: 20, timeoutMs: 50 * 60_000 },
  guides: { title: "Гайды", period: "weekly", day: 0, hour: 4, minute: 17, timeoutMs: 90 * 60_000 },
  "patch-notes": { title: "Патчноуты", period: "daily", hour: 5, minute: 41, timeoutMs: 30 * 60_000 },
};

export function scheduleSlot(job, now) {
  const date = new Date(now);
  date.setUTCSeconds(0, 0);
  date.setUTCMinutes(job.minute);
  if (job.period !== "hourly") date.setUTCHours(job.hour);
  if (job.period === "weekly") date.setUTCDate(date.getUTCDate() - (date.getUTCDay() - job.day + 7) % 7);
  const interval = job.period === "hourly" ? 3_600_000 : job.period === "daily" ? 86_400_000 : 604_800_000;
  if (+date > +new Date(now)) date.setTime(+date - interval);
  return { current: +date, next: +date + interval };
}

export function eligibility(job, state, now, { fallback = false, force = false } = {}) {
  const time = +new Date(now);
  const slot = scheduleSlot(job, time);
  const success = state?.last_success_at ? +new Date(state.last_success_at) : null;
  const attempt = state?.last_started_at ? +new Date(state.last_started_at) : null;
  const firstSeen = state?.created_at ? +new Date(state.created_at) : slot.current;
  const fallbackAt = job.period === "hourly" ? (success ?? firstSeen) + FALLBACK_MS : slot.current + FALLBACK_MS;
  const base = { scheduledAt: new Date(slot.current).toISOString(), nextAt: new Date(slot.next).toISOString(), fallbackAt: new Date(fallbackAt).toISOString() };
  if (!force && success !== null && success >= slot.current) return { ...base, due: false, reason: "already-successful" };
  if (!force && attempt !== null && time - attempt < RETRY_MS) return { ...base, due: false, reason: "retry-backoff" };
  if (!force && fallback && time < fallbackAt) return { ...base, due: false, reason: "primary-grace" };
  return { ...base, due: true, reason: force ? "manual" : fallback ? "fallback" : "schedule" };
}

export function parseJobs(value = Object.keys(JOBS).join(",")) {
  const jobs = [...new Set(value.split(",").map(item => item.trim()))];
  if (!jobs.length || jobs.some(job => !Object.hasOwn(JOBS, job))) throw new Error("Unknown scrape job");
  return jobs;
}

export function sanitizeLog(value, env = process.env) {
  let text = String(value ?? "");
  for (const [key, secret] of Object.entries(env)) {
    if (/(?:SECRET|PASSWORD|TOKEN|DATABASE_URL|ACCESS_KEY)/i.test(key) && secret?.length >= 6) text = text.split(secret).join("[redacted]");
  }
  return text.replace(/\b(postgres(?:ql)?|https?):\/\/[^\s/@]+:[^\s/@]+@/gi, "$1://[redacted]@")
    .replace(/([?&](?:X-Amz-[\w-]+|token|secret|password)=)[^\s&]+/gi, "$1[redacted]")
    .replaceAll(String.fromCharCode(27), "").slice(-12_000);
}
