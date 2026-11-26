const DEFAULT_JSON_BODY_LIMIT = 256 * 1024;

function buildPayloadTooLargeError(limit) {
  const error = new Error(`JSON body exceeds ${limit} bytes`);
  error.statusCode = 413;
  return error;
}

function parseContentLength(value) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export async function readJsonBody(req, { maxBytes = DEFAULT_JSON_BODY_LIMIT } = {}) {
  if (req.method === "GET" || req.method === "HEAD") {
    return undefined;
  }

  const contentLength = parseContentLength(req.headers?.["content-length"]);
  if (contentLength != null && contentLength > maxBytes) {
    throw buildPayloadTooLargeError(maxBytes);
  }

  const chunks = [];
  let totalBytes = 0;

  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.length;

    if (totalBytes > maxBytes) {
      throw buildPayloadTooLargeError(maxBytes);
    }

    chunks.push(buffer);
  }

  if (!chunks.length) {
    return undefined;
  }

  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) {
    return undefined;
  }

  try {
    return JSON.parse(raw);
  } catch {
    const error = new Error("Invalid JSON body");
    error.statusCode = 400;
    throw error;
  }
}

export { DEFAULT_JSON_BODY_LIMIT };
