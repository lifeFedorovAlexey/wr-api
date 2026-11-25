export function shouldSkipPatchReparse(stored, parserVersion, { force = false, reparse = false } = {}) {
  if (!stored || stored.parse_status !== "parsed") return false;
  const storedVersion = Number(stored.parser_version);
  if (storedVersion > parserVersion) return true;
  return storedVersion === parserVersion && !force && !reparse;
}
