import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflowUrl = new URL("../.github/workflows/deploy-timeweb.yml", import.meta.url);

test("production deployment prepares quiz schema and S3 CORS before canary startup", async () => {
  const workflow = await readFile(workflowUrl, "utf8");
  const schemaSetup = workflow.indexOf("npm run setup:quizzes");
  const mediaSetup = workflow.indexOf("npm run setup:quiz-media-storage");
  const canaryStartup = workflow.indexOf('log_step "start canary public/auth/gateway"');

  assert.ok(schemaSetup > 0, "quiz schema setup is missing from deployment");
  assert.ok(mediaSetup > schemaSetup, "quiz media storage setup must follow schema setup");
  assert.ok(canaryStartup > mediaSetup, "quiz setup must finish before canary startup");
});
