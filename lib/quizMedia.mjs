import { randomUUID } from "node:crypto";

import {
  buildObjectStoragePublicUrl,
  createObjectStorageClient,
} from "./objectStorage.mjs";
import {
  QUIZ_CAPABILITIES,
  requireQuizCapability,
} from "./quizPermissions.mjs";

const MAX_BYTES = 5 * 1024 * 1024;
const MIME_EXTENSIONS = Object.freeze({
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
});

function appError(code, statusCode) {
  return Object.assign(new Error(code), { statusCode });
}

export async function createQuizMediaUpload(
  actor,
  input = {},
  {
    storage = createObjectStorageClient(process.env),
    env = process.env,
    id = randomUUID(),
  } = {},
) {
  requireQuizCapability(actor, QUIZ_CAPABILITIES.CREATE);

  const contentType = String(input.contentType || "")
    .trim()
    .toLowerCase();
  const extension = MIME_EXTENSIONS[contentType];
  if (!extension) throw appError("unsupported_image_type", 415);

  const size = Number(input.size);
  if (!Number.isInteger(size) || size <= 0)
    throw appError("image_required", 400);
  if (size > MAX_BYTES) throw appError("image_too_large", 413);
  if (!storage) throw appError("quiz_media_storage_unavailable", 503);

  const key = `assets/quizzes/${Number(actor.id)}/${id}.${extension}`;
  const url = buildObjectStoragePublicUrl(key, env);
  if (!url) throw appError("quiz_media_storage_unavailable", 503);

  const upload = await storage.createPresignedPostUpload(key, contentType, {
    expiresIn: 300,
    minBytes: 1,
    maxBytes: MAX_BYTES,
  });

  return {
    key,
    url,
    uploadUrl: upload.url,
    uploadFields: upload.fields,
    contentType,
    maxBytes: MAX_BYTES,
  };
}
