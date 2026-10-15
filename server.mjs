import "dotenv/config";
import { createApiServer, listenServer } from "./lib/httpApiServer.mjs";
import { guideDetailRoute, monolithRoutes, patchNotesDetailRoute, quizDetailRoute } from "./lib/routeSets.mjs";

const server = createApiServer({
  routes: monolithRoutes,
  detailRoutes: [guideDetailRoute, patchNotesDetailRoute, quizDetailRoute],
  enableIcons: true,
  enableGuideAssets: true,
  enableGuideHeroMedia: true,
  logLabel: "[wr-api]",
});

listenServer(server, { logLabel: "[wr-api]" });

