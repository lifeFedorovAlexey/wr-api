// api/utils/telegram.js
import crypto from "crypto";

/**
 * Telegram WebApp initData verification
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-web-app
 */
export function verifyTelegramInitData(initData, botToken) {
  if (!initData || typeof initData !== "string") {
    return { ok: false, reason: "missing_init_data" };
  }
  if (!botToken) {
    return { ok: false, reason: "missing_bot_token" };
  }

  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return { ok: false, reason: "missing_hash" };

  params.delete("hash");

  const dataCheckString = Array.from(params.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");

  const secretKey = crypto
    .createHmac("sha256", "WebAppData")
    .update(botToken)
    .digest();

  const computedHash = crypto
    .createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest("hex");

  if (computedHash !== hash) return { ok: false, reason: "bad_hash" };
  return { ok: true };
}

export function extractTelegramUser(initData) {
  const params = new URLSearchParams(initData);
  const userRaw = params.get("user");
  if (!userRaw) return null;

  try {
    return JSON.parse(userRaw);
  } catch {
    return null;
  }
}

export function extractTelegramUserId(initData) {
  const user = extractTelegramUser(initData);
  const id = user?.id;
  return typeof id === "number" ? id : null;
}
