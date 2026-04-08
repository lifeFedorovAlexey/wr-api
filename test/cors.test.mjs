import test from "node:test";
import assert from "node:assert/strict";

import { setCors } from "../api/utils/cors.js";

function createResponse() {
  const headers = new Map();

  return {
    setHeader(name, value) {
      headers.set(name, value);
    },
    getHeader(name) {
      return headers.get(name);
    },
    headers,
  };
}

test("setCors reflects only allowlisted origins", () => {
  const res = createResponse();
  setCors({ headers: { origin: "https://wildriftallstats.ru" } }, res);

  assert.equal(
    res.getHeader("Access-Control-Allow-Origin"),
    "https://wildriftallstats.ru",
  );
  assert.equal(res.getHeader("Vary"), "Origin");
});

test("setCors does not emit wildcard origin for null or missing origin", () => {
  const nullOriginRes = createResponse();
  setCors({ headers: { origin: "null" } }, nullOriginRes);
  assert.equal(nullOriginRes.getHeader("Access-Control-Allow-Origin"), undefined);

  const missingOriginRes = createResponse();
  setCors({ headers: {} }, missingOriginRes);
  assert.equal(missingOriginRes.getHeader("Access-Control-Allow-Origin"), undefined);
});
