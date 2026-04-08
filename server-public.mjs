import "dotenv/config";

import { createApiServer, listenServer } from "./lib/httpApiServer.mjs";
import { guideDetailRoute, publicRoutes } from "./lib/routeSets.mjs";

const server = createApiServer({
  routes: publicRoutes,
  detailRoutes: [guideDetailRoute],
  enableIcons: true,
  enableGuideAssets: true,
  enableGuideHeroMedia: true,
  logLabel: "[wr-api-public]",
});

listenServer(server, { logLabel: "[wr-api-public]" });

