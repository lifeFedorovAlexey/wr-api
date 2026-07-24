import { createHash } from "node:crypto";

export const PUBLIC_TIERLIST_CREATE_LIMIT = 5;
export const PUBLIC_TIERLIST_CREATE_WINDOW_MS = 60 * 60 * 1000;
const MAX_BUCKETS = 5_000;

const buckets = new Map();

function identityKey(identity) {
  return createHash("sha256").update(String(identity || "unknown")).digest("hex");
}

function pruneExpired(now) {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }

  while (buckets.size >= MAX_BUCKETS) {
    const oldestKey = buckets.keys().next().value;
    if (!oldestKey) break;
    buckets.delete(oldestKey);
  }
}

export function consumePublicTierlistCreateAttempt(
  identity,
  {
    now = Date.now(),
    limit = PUBLIC_TIERLIST_CREATE_LIMIT,
    windowMs = PUBLIC_TIERLIST_CREATE_WINDOW_MS,
  } = {},
) {
  pruneExpired(now);
  const key = identityKey(identity);
  const current = buckets.get(key);

  if (!current || current.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterSeconds: 0 };
  }

  if (current.count >= limit) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000)),
    };
  }

  current.count += 1;
  return { allowed: true, retryAfterSeconds: 0 };
}

export function resetPublicTierlistCreateRateLimit() {
  buckets.clear();
}
