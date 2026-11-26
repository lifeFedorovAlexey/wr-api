import path from "node:path";

export const CHAT_SPAM_MESSAGE_LIMIT = 10;
export const CHAT_SPAM_WINDOW_MS = 5_000;
export const CHAT_SPAM_INITIAL_MUTE_SECONDS = 5;
export const CHAT_SPAM_RESET_MS = 2 * 60 * 60 * 1_000;
export const CHAT_SPAM_MAX_MUTE_SECONDS = 24 * 60 * 60;
export const CHAT_ATTACHMENT_MAX_BYTES = 15 * 1024 * 1024;
export const CHAT_CONTENT_RETENTION_DAYS = 90;

const SUPPORTED_CHAT_MEDIA = new Map([
  ["image/jpeg", { kind: "image", extension: ".jpg" }],
  ["image/png", { kind: "image", extension: ".png" }],
  ["image/webp", { kind: "image", extension: ".webp" }],
  ["image/gif", { kind: "image", extension: ".gif" }],
  ["image/avif", { kind: "image", extension: ".avif" }],
  ["video/mp4", { kind: "video", extension: ".mp4" }],
  ["video/webm", { kind: "video", extension: ".webm" }],
  ["video/quicktime", { kind: "video", extension: ".mov" }],
]);

export function normalizeChatMediaMimeType(value) {
  return String(value || "").trim().toLowerCase().split(";", 1)[0];
}

function normalizeFileName(value) {
  return Array.from(path.basename(String(value || "file")))
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code >= 32 && code !== 127;
    })
    .join("")
    .trim()
    .slice(0, 180) || "file";
}

export function getChatMediaDefinition(mimeType) {
  return SUPPORTED_CHAT_MEDIA.get(normalizeChatMediaMimeType(mimeType)) || null;
}

export function validateChatAttachmentInput(input = {}) {
  const fileName = normalizeFileName(input.fileName);
  const mimeType = normalizeChatMediaMimeType(input.mimeType);
  const sizeBytes = Number(input.sizeBytes || 0);
  const media = getChatMediaDefinition(mimeType);

  if (!media) throw new Error("chat_attachment_type_unsupported");
  if (!Number.isInteger(sizeBytes) || sizeBytes <= 0 || sizeBytes > CHAT_ATTACHMENT_MAX_BYTES) {
    throw new Error("chat_attachment_too_large");
  }
  return { fileName, mimeType, sizeBytes, ...media };
}

export function calculateAntispamMuteSeconds(escalationLevel) {
  const normalizedLevel = Math.max(0, Math.min(Number(escalationLevel) || 0, 30));
  return Math.min(
    CHAT_SPAM_MAX_MUTE_SECONDS,
    CHAT_SPAM_INITIAL_MUTE_SECONDS * 2 ** normalizedLevel,
  );
}

export function calculateNextAntispamPenalty(state, nowInput = new Date()) {
  const now = nowInput instanceof Date ? nowInput : new Date(nowInput);
  const lastViolationMs = state?.lastViolationAt
    ? new Date(state.lastViolationAt).getTime()
    : 0;
  const keepsEscalation =
    lastViolationMs > 0 && now.getTime() - lastViolationMs < CHAT_SPAM_RESET_MS;
  const escalationLevel = keepsEscalation
    ? Math.max(0, Number(state?.escalationLevel) || 0) + 1
    : 0;
  return {
    escalationLevel,
    durationSeconds: calculateAntispamMuteSeconds(escalationLevel),
  };
}
