export const AUTH_PROFILES = {
  championsSync: {
    tokenEnvNames: ["CHAMPIONS_SYNC_TOKEN"],
    secretHeader: "x-champions-sync-secret",
    secretEnvNames: ["CHAMPIONS_SYNC_SECRET"],
  },
  guidesSync: {
    secretHeader: "x-guides-sync-secret",
    secretEnvNames: ["GUIDES_SYNC_SECRET"],
  },
  newsSync: {
    tokenEnvNames: ["NEWS_SYNC_TOKEN"],
    secretHeader: "x-news-sync-secret",
    secretEnvNames: ["NEWS_SYNC_SECRET"],
  },
};
