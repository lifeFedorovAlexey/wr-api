import assert from "node:assert/strict";
import test from "node:test";

import { createApiServer } from "../lib/httpApiServer.mjs";

test("createApiServer prefers exact routes over matching detail routes", async () => {
  const server = createApiServer({
    routes: new Map([
      [
        "/api/guides/import",
        async (req, res) => {
          res.status(200).json({ route: "exact", method: req.method });
        },
      ],
    ]),
    detailRoutes: [
      {
        matches(pathname) {
          return pathname.startsWith("/api/guides/");
        },
        getParams(pathname) {
          return { slug: pathname.slice("/api/guides/".length) };
        },
        async handler(req, res) {
          res.status(200).json({ route: "detail", slug: req.params.slug, method: req.method });
        },
      },
    ],
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : null;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/guides/import`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ ok: true }),
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      route: "exact",
      method: "POST",
    });
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});
