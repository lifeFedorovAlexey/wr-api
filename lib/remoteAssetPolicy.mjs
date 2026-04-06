const ALLOWED_REMOTE_ASSET_HOSTS = [
  "game.gtimg.cn",
  "lolm.qq.com",
  "wildrift.leagueoflegends.com",
  "www.wildriftfire.com",
  "wildriftfire.com",
  "www.mobafire.com",
  "mobafire.com",
  "riftgg.app",
  "cmsassets.rgpub.io",
  "cdn.modelviewer.lol",
];

export function normalizeRemoteAssetUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;

  if (raw.startsWith("//")) {
    return `https:${raw}`;
  }

  if (raw.startsWith("http://")) {
    return `https://${raw.slice("http://".length)}`;
  }

  return raw;
}

function isIpLikeHost(hostname) {
  return (
    /^(\d{1,3}\.){3}\d{1,3}$/.test(hostname) ||
    /^\[[0-9a-f:]+\]$/i.test(hostname)
  );
}

function matchesAllowedHost(hostname) {
  return ALLOWED_REMOTE_ASSET_HOSTS.some(
    (allowedHost) =>
      hostname === allowedHost || hostname.endsWith(`.${allowedHost}`),
  );
}

export function isAllowedRemoteAssetUrl(value) {
  try {
    const normalized = normalizeRemoteAssetUrl(value);
    if (!normalized) return false;

    const url = new URL(normalized);
    const hostname = url.hostname.toLowerCase();

    if (url.protocol !== "https:") return false;
    if (!hostname || hostname === "localhost") return false;
    if (isIpLikeHost(hostname)) return false;

    return matchesAllowedHost(hostname);
  } catch {
    return false;
  }
}

export { ALLOWED_REMOTE_ASSET_HOSTS };
