import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

import {
  buildTelegramAuthProfileFromInitData,
  extractTelegramUser,
  extractTelegramUserId,
  verifyTelegramInitData,
} from "../api/utils/telegram.js";

function buildInitData(payload, botToken) {
  const params = new URLSearchParams(payload);
  const dataCheckString = Array.from(params.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  const secretKey = crypto
    .createHmac("sha256", "WebAppData")
    .update(botToken)
    .digest();

  const hash = crypto
    .createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest("hex");

  params.set("hash", hash);
  return params.toString();
}

test("verifyTelegramInitData validates signed init data", () => {
  const botToken = "12345:test-token";
  const initData = buildInitData(
    {
      auth_date: "1710000000",
      query_id: "AAH123456789",
      user: JSON.stringify({
        id: 123456789,
        username: "life",
        first_name: "Life",
        last_name: "Fedorov",
      }),
    },
    botToken,
  );

  assert.deepEqual(verifyTelegramInitData(initData, botToken), { ok: true });
  assert.equal(extractTelegramUserId(initData), 123456789);
  assert.equal(extractTelegramUser(initData)?.username, "life");
});

test("verifyTelegramInitData rejects tampered payload", () => {
  const botToken = "12345:test-token";
  const initData = buildInitData(
    {
      auth_date: "1710000000",
      user: JSON.stringify({ id: 1 }),
    },
    botToken,
  );

  const tampered = `${initData}&extra=1`;
  assert.deepEqual(verifyTelegramInitData(tampered, botToken), {
    ok: false,
    reason: "bad_hash",
  });
});

test("buildTelegramAuthProfileFromInitData maps a valid Telegram webapp user", () => {
  const initData = buildInitData(
    {
      auth_date: "1710000000",
      user: JSON.stringify({
        id: 123456789,
        username: "life",
        first_name: "Life",
        last_name: "Fedorov",
        photo_url: "https://t.me/i/userpic/320/life.jpg",
      }),
    },
    "12345:test-token",
  );

  assert.deepEqual(buildTelegramAuthProfileFromInitData(initData), {
    provider: "telegram",
    subject: "123456789",
    email: "",
    name: "Life Fedorov",
    username: "life",
    avatarUrl: "https://t.me/i/userpic/320/life.jpg",
  });
});
