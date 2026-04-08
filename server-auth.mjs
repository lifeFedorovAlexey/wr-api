import "dotenv/config";

import { createApiServer, listenServer } from "./lib/httpApiServer.mjs";
import { authRoutes } from "./lib/routeSets.mjs";

const server = createApiServer({
  routes: authRoutes,
  logLabel: "[wr-api-auth]",
});

listenServer(server, {
  port: Number(process.env.PORT || 3003),
  logLabel: "[wr-api-auth]",
});

