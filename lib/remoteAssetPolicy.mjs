const ALLOWED_REMOTE_ASSET_HOSTS = [
  "game.gtimg.cn",
  "lolm.qq.com",
  "wildrift.leagueoflegends.com",
  "www.wildriftfire.com",
  "wildriftfire.com",
  "riftgg.app",
  "cmsassets.rgpub.io",
  "cdn.modelviewer.lol",
];

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
    const url = new URL(String(value || ""));
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
