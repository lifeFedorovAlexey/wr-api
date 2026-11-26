import test from "node:test";
import assert from "node:assert/strict";
process.env.DATABASE_URL ||= "postgres://localhost:5432/test";
const { createLuxHandler } = await import("../api/user-chat-lux.js");

function response() {
  return { code: 0, body: null, setHeader() {}, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; }, end() {} };
}
test("Lux endpoint rejects anonymous access and scopes every operation to the session", async () => {
  const calls = [];
  const service = { history: async id => { calls.push(id); return { turns: [] }; }, send: async id => { calls.push(id); return { accepted: true }; }, reset: async id => calls.push(id) };
  let session = null;
  const handler = createLuxHandler({ getSession: async () => session, authorizeChannel: async user => calls.push(user.id), getStatus: async () => ({}), reset: service.reset, enabled: () => true });
  const res = response();
  await handler({ method: "GET", headers: {} }, res);
  assert.equal(res.code, 401); assert.deepEqual(calls, []);
  session = { user: { id: 7 } };
  for (const method of ["GET", "DELETE"]) {
    await handler({ method, headers: {}, query: { userId: 99, channelId: 2 }, body: { userId: 99 } }, response());
  }
  assert.deepEqual(calls, [7, 7]);
  const post = response();
  await handler({ method: 'POST', headers: {} }, post);
  assert.equal(post.code, 405);
});
test("Lux endpoint validates cursors and hides internal failures", async () => {
  const handler = createLuxHandler({ getSession: async () => ({ user: { id: 1 } }), authorizeChannel: async () => { throw new Error("database password secret"); }, enabled: () => true });
  const invalid = response();
  await handler({ method: "GET", headers: {}, query: { channelId: "-1" } }, invalid);
  assert.equal(invalid.code, 400);
  const failed = response();
  await handler({ method: "GET", headers: {}, query: { channelId: 2 } }, failed);
  assert.deepEqual(failed.body, { error: "lux_unavailable" });
});
