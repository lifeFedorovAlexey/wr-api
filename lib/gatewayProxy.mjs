import http from "node:http";

import { isAuthGatewayPath } from "./gatewayRouting.mjs";

export function pickGatewayUpstream(pathname = "") {
  return isAuthGatewayPath(pathname) ? "auth" : "public";
}

export function createGatewayServer({
  host = process.env.HOST || "127.0.0.1",
  publicUpstreamPort = Number(process.env.PUBLIC_UPSTREAM_PORT || 3002),
  authUpstreamPort = Number(process.env.AUTH_UPSTREAM_PORT || 3003),
  logLabel = "[wr-api-gateway]",
} = {}) {
  return http.createServer((req, res) => {
    const requestUrl = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    const upstreamType = pickGatewayUpstream(requestUrl.pathname);
    const upstreamPort = upstreamType === "auth" ? authUpstreamPort : publicUpstreamPort;

    const upstreamReq = http.request(
      {
        host,
        port: upstreamPort,
        method: req.method,
        path: `${requestUrl.pathname}${requestUrl.search}`,
        headers: req.headers,
      },
      (upstreamRes) => {
        res.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers);
        upstreamRes.pipe(res);
      },
    );

    upstreamReq.on("error", (error) => {
      console.error(
        `${logLabel} upstream error for ${requestUrl.pathname} -> ${upstreamType}:${upstreamPort}:`,
        error,
      );

      if (!res.headersSent) {
        res.statusCode = 502;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
      }

      res.end(JSON.stringify({ error: "Bad Gateway" }));
    });

    req.pipe(upstreamReq);
  });
}
