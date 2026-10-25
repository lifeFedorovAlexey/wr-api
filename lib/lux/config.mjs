export const LUX_PERSONA = Object.freeze({ id: "lux", displayName: "Люкс", title: "Леди Света · Демасия" });

function integer(value, fallback, min, max) {
  const number = Number(value);
  return Number.isInteger(number) && number >= min && number <= max ? number : fallback;
}

export function luxConfig(env = process.env) {
  const baseUrl = new URL(env.LUX_LM_STUDIO_URL || "http://127.0.0.1:1234/v1");
  if (!["http:", "https:"].includes(baseUrl.protocol) || baseUrl.username || baseUrl.password || baseUrl.search || baseUrl.hash) {
    throw new Error("lux_config_invalid");
  }
  return {
    enabled: env.LUX_ENABLED === "true" || (env.LUX_ENABLED !== "false" && env.WR_LOCAL_DEV === "true"),
    baseUrl: baseUrl.href.replace(/\/+$/, ""),
    model: String(env.LUX_LM_STUDIO_MODEL || "").trim(),
    apiKey: String(env.LUX_LM_STUDIO_API_KEY || ""),
    contextTokens: integer(env.LUX_CONTEXT_TOKENS, 16384, 8192, 131072),
    replyTokens: 800,
    timeoutMs: integer(env.LUX_TIMEOUT_MS, 60000, 1000, 90000),
  };
}

export function luxError(code, status = 503) {
  return Object.assign(new Error(code), { status });
}
