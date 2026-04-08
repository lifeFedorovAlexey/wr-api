import "dotenv/config";

import { createGatewayServer } from "./lib/gatewayProxy.mjs";
import { listenServer } from "./lib/httpApiServer.mjs";

const server = createGatewayServer({
  host: process.env.UPSTREAM_HOST || "127.0.0.1",
  publicUpstreamPort: Number(process.env.PUBLIC_UPSTREAM_PORT || 3002),
  authUpstreamPort: Number(process.env.AUTH_UPSTREAM_PORT || 3003),
});

listenServer(server, {
  port: Number(process.env.PORT || 3001),
  host: process.env.HOST || "127.0.0.1",
  logLabel: "[wr-api-gateway]",
});

