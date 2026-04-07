import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export function normalizeSecret(env = process.env) {
  return String(env.ADMIN_SESSION_SECRET || "").trim();
}

export function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

export function normalizeUsername(value) {
  return String(value || "").trim().replace(/^@/, "").toLowerCase();
}

export function normalizeId(value) {
  return String(value || "").trim();
}

export function hashValue(value) {
  return createHash("sha256").update(String(value || "")).digest("hex");
}

export function getRequestIp(req) {
  const forwarded = String(req.headers["x-forwarded-for"] || "").trim();
  return forwarded.split(",")[0]?.trim() || req.socket?.remoteAddress || "";
}

export function createSignedEnvelope(
  payload,
  { secret, missingSecretError = "missing_admin_session_secret" } = {},
) {
  if (!secret) {
    throw new Error(missingSecretError);
  }

  const serialized = JSON.stringify({
    ...payload,
    ts: Date.now(),
    nonce: randomBytes(16).toString("hex"),
  });
  const encoded = Buffer.from(serialized).toString("base64url");
  const signature = createHmac("sha256", secret).update(encoded).digest("base64url");

  return { payload: encoded, signature };
}

export function verifySignedEnvelope(payload, signature, { secret, ttlMs } = {}) {
  if (!secret || !payload || !signature) return null;

  const expected = createHmac("sha256", secret).update(payload).digest();
  const actual = Buffer.from(String(signature), "base64url");

  if (!actual.length || actual.length !== expected.length) {
    return null;
  }

  if (!timingSafeEqual(actual, expected)) {
    return null;
  }

  try {
    const decoded = JSON.parse(Buffer.from(String(payload), "base64url").toString("utf8"));
    if (Math.abs(Date.now() - Number(decoded.ts || 0)) > ttlMs) {
      return null;
    }
    return decoded;
  } catch {
    return null;
  }
}

export function readSessionToken(req, cookieName) {
  const authHeader = String(req.headers.authorization || "").trim();
  if (authHeader.startsWith("Bearer ")) {
    return authHeader.slice("Bearer ".length).trim();
  }

  const cookieHeader = String(req.headers.cookie || "");
  for (const part of cookieHeader.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === cookieName) {
      return rest.join("=").trim();
    }
  }

  return "";
}

export function normalizeAuthProfile(profile = {}) {
  return {
    provider: String(profile.provider || "").trim(),
    subject: normalizeId(profile.subject),
    email: normalizeEmail(profile.email),
    name: String(profile.name || "").trim(),
    username: normalizeUsername(profile.username),
    avatarUrl: String(profile.avatarUrl || "").trim(),
  };
}
