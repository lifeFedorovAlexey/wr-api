import { createSignedEnvelope, normalizeNamedSecret } from "./sessionAuthShared.mjs";

const CHAT_EXCHANGE_TTL_MS = 1000 * 60 * 2;

export function normalizeChatSharedSecret(env = process.env) {
  return normalizeNamedSecret(env, "WR_CHAT_SHARED_SECRET");
}

export function getChatPublicOrigin(env = process.env) {
  return String(env.WR_CHAT_PUBLIC_ORIGIN || "").trim().replace(/\/$/, "");
}

export function createSignedChatExchangeEnvelope(user, env = process.env) {
  if (!user?.id) {
    throw new Error("invalid_chat_user");
  }

  const secret = normalizeChatSharedSecret(env);
  const now = Date.now();

  const envelope = createSignedEnvelope(
    {
      iss: "wr-api",
      aud: "wr-chat",
      sub: String(user.id),
      displayName: String(user.displayName || ""),
      avatarUrl: String(user.avatarUrl || ""),
      roles: Array.isArray(user.roles) ? user.roles : ["user"],
      exp: now + CHAT_EXCHANGE_TTL_MS,
    },
    {
      secret,
      missingSecretError: "missing_wr_chat_shared_secret",
    },
  );

  return {
    ...envelope,
    expiresInMs: CHAT_EXCHANGE_TTL_MS,
    origin: getChatPublicOrigin(env),
  };
}

