function readBearerToken(req) {
  const authHeader = String(req?.headers?.authorization || "");
  return authHeader.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length).trim()
    : "";
}

function readHeader(req, name) {
  return String(req?.headers?.[name] || "").trim();
}

function readEnvList(names = [], env = process.env) {
  return names
    .map((name) => String(env?.[name] || "").trim())
    .filter(Boolean);
}

export function isAuthorizedBySecrets(req, options = {}) {
  const {
    env = process.env,
    tokenEnvNames = [],
    secretHeader = "",
    secretEnvNames = [],
  } = options;

  const bearerToken = readBearerToken(req);
  const headerSecret = secretHeader ? readHeader(req, secretHeader) : "";
  const expectedTokens = readEnvList(tokenEnvNames, env);
  const expectedSecrets = readEnvList(secretEnvNames, env);

  if (bearerToken && expectedTokens.includes(bearerToken)) {
    return true;
  }

  if (headerSecret && expectedSecrets.includes(headerSecret)) {
    return true;
  }

  return false;
}

export function ensureAuthorized(req, res, options = {}) {
  const authorized = isAuthorizedBySecrets(req, options);
  if (authorized) return true;

  res.setHeader("Cache-Control", "no-store");
  res.status(401).json({ error: "Unauthorized" });
  return false;
}
