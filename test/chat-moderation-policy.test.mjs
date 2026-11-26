import test from "node:test";
import assert from "node:assert/strict";

import {
  CHAT_ATTACHMENT_MAX_BYTES,
  calculateAntispamMuteSeconds,
  calculateNextAntispamPenalty,
  CHAT_SPAM_MAX_MUTE_SECONDS,
  CHAT_SPAM_RESET_MS,
  validateChatAttachmentInput,
} from "../lib/chatPolicy.mjs";
import { isGlobalChatAdmin } from "../lib/chatPermissions.mjs";

test("automatic mute starts at five seconds, doubles and caps at one day", () => {
  assert.equal(calculateAntispamMuteSeconds(0), 5);
  assert.equal(calculateAntispamMuteSeconds(1), 10);
  assert.equal(calculateAntispamMuteSeconds(2), 20);
  assert.equal(calculateAntispamMuteSeconds(30), CHAT_SPAM_MAX_MUTE_SECONDS);
});

test("automatic mute escalation resets two hours after the previous penalty", () => {
  const firstAt = new Date("2026-07-19T10:00:00.000Z");
  const repeated = calculateNextAntispamPenalty(
    { escalationLevel: 2, lastViolationAt: firstAt },
    new Date(firstAt.getTime() + CHAT_SPAM_RESET_MS - 1),
  );
  const reset = calculateNextAntispamPenalty(
    { escalationLevel: 2, lastViolationAt: firstAt },
    new Date(firstAt.getTime() + CHAT_SPAM_RESET_MS),
  );

  assert.deepEqual(repeated, { escalationLevel: 3, durationSeconds: 40 });
  assert.deepEqual(reset, { escalationLevel: 0, durationSeconds: 5 });
});

test("only the explicit admin role grants global chat moderation", () => {
  assert.equal(isGlobalChatAdmin({ id: 1, roles: ["user", "admin"] }), true);
  assert.equal(isGlobalChatAdmin({ id: 1, roles: ["owner"] }), false);
  assert.equal(isGlobalChatAdmin({ id: 1, roles: ["user"] }), false);
});

test("chat media accepts supported files up to 15 MB per file", () => {
  const valid = validateChatAttachmentInput({
    fileName: "clip.mp4",
    mimeType: "video/mp4",
    sizeBytes: CHAT_ATTACHMENT_MAX_BYTES,
  });
  assert.equal(valid.kind, "video");
  assert.equal(valid.sizeBytes, CHAT_ATTACHMENT_MAX_BYTES);

  assert.throws(
    () => validateChatAttachmentInput({
      fileName: "too-large.mp4",
      mimeType: "video/mp4",
      sizeBytes: CHAT_ATTACHMENT_MAX_BYTES + 1,
    }),
    /chat_attachment_too_large/,
  );
  assert.throws(
    () => validateChatAttachmentInput({
      fileName: "payload.svg",
      mimeType: "image/svg+xml",
      sizeBytes: 100,
    }),
    /chat_attachment_type_unsupported/,
  );
});
