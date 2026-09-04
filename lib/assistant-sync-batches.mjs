const DEFAULT_SYNC_BATCH_BYTES = 192 * 1024;

function jsonByteLength(items) {
  return Buffer.byteLength(JSON.stringify({ items }), "utf8");
}

export function buildAssistantSyncBatches(
  items,
  maxBytes = DEFAULT_SYNC_BATCH_BYTES,
) {
  if (!Array.isArray(items)) throw new TypeError("items must be an array");
  if (!Number.isInteger(maxBytes) || maxBytes <= 0) {
    throw new TypeError("maxBytes must be a positive integer");
  }

  const batches = [];
  let current = [];

  for (const item of items) {
    const candidate = [...current, item];
    if (jsonByteLength(candidate) <= maxBytes) {
      current = candidate;
      continue;
    }

    if (!current.length) {
      throw new Error(`assistant sync item exceeds ${maxBytes} bytes`);
    }

    batches.push(current);
    current = [item];
    if (jsonByteLength(current) > maxBytes) {
      throw new Error(`assistant sync item exceeds ${maxBytes} bytes`);
    }
  }

  if (current.length) batches.push(current);
  return batches;
}

export { DEFAULT_SYNC_BATCH_BYTES };
