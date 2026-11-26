import test from "node:test";
import assert from "node:assert/strict";
import { JOBS, eligibility, parseJobs, sanitizeLog, scheduleSlot } from "../lib/scrapeSchedule.mjs";
import { commandsFor } from "../lib/scrapeCommands.mjs";

test("hourly fallback starts exactly after two hours since success, including unchanged data", () => {
  const state = { last_success_at: "2026-10-25T08:25:00Z" };
  assert.equal(eligibility(JOBS.stats, state, "2026-10-25T10:24:59Z", { fallback: true }).due, false);
  assert.equal(eligibility(JOBS.stats, state, "2026-10-25T10:25:00Z", { fallback: true }).due, true);
  assert.equal(eligibility(JOBS.stats, state, "2026-10-25T09:17:00Z").due, true);
});
test("success from either executor prevents duplicate runs within the current slot", () => {
  assert.equal(eligibility(JOBS.stats, { last_success_at: "2026-10-25T09:30:00Z", last_executor: "github" }, "2026-10-25T09:40:00Z").due, false);
});
test("daily fallback is relative to missed scheduled slot, not age of yesterday's result", () => {
  const state = { last_success_at: "2026-10-24T03:25:00Z" };
  assert.equal(eligibility(JOBS.riftgg, state, "2026-10-25T04:00:00Z", { fallback: true }).due, false);
  assert.equal(eligibility(JOBS.riftgg, state, "2026-10-25T05:20:00Z", { fallback: true }).due, true);
});
test("weekly slot respects Sunday UTC and next week", () => {
  assert.equal(scheduleSlot(JOBS.guides, "2026-10-25T04:16:00Z").current, Date.parse("2026-10-18T04:17:00Z"));
  assert.equal(eligibility(JOBS.guides, { last_success_at: "2026-10-18T05:00:00Z" }, "2026-10-25T06:16:59Z", { fallback: true }).due, false);
  assert.equal(eligibility(JOBS.guides, {}, "2026-10-25T06:17:00Z", { fallback: true }).due, true);
});
test("missing state, retry backoff and explicit manual run", () => {
  assert.equal(eligibility(JOBS.stats, {}, "2026-10-25T08:30:00Z", { fallback: true }).due, false);
  const state = { last_started_at: "2026-10-25T08:30:00Z" };
  assert.equal(eligibility(JOBS.stats, state, "2026-10-25T08:31:00Z").reason, "retry-backoff");
  assert.equal(eligibility(JOBS.stats, state, "2026-10-25T08:31:00Z", { force: true }).due, true);
  assert.equal(eligibility(JOBS.stats, { created_at: "2026-10-25T06:00:00Z" }, "2026-10-25T08:00:00Z", { fallback: true }).due, true);
});
test("job selection cannot inject arguments; commands isolate source schedules", () => {
  assert.throws(() => parseJobs("stats; echo x"));
  assert.deepEqual(parseJobs("stats,stats,guides"), ["stats", "guides"]);
  assert.ok(commandsFor("guides", "/repo")[0].args.includes("--skip-cn-history"));
  assert.equal(commandsFor("patch-notes", "/repo").length, 3);
  assert.throws(() => commandsFor("unknown", "/repo"));
});
test("dashboard logs redact environment secrets and signed URLs", () => {
  const text = sanitizeLog("secretvalue postgres://name:pass@db/a https://s3/a?X-Amz-Signature=abc&x=1", { S3_SECRET_ACCESS_KEY: "secretvalue" });
  assert.ok(!text.includes("secretvalue") && !text.includes("name:pass") && !text.includes("Signature=abc"));
});
