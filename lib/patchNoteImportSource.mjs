import { shouldSkipPatchReparse } from "./patchParserVersionPolicy.mjs";

export function resolvePatchImportSource({
  stored,
  parserVersion,
  auditedArchive = null,
  reparse = false,
  refreshSource = false,
  offline = false,
}) {
  if (shouldSkipPatchReparse(stored, parserVersion, { force: refreshSource, reparse })) {
    return { action: "skip" };
  }

  if (stored?.raw_html && !refreshSource) {
    return {
      action: "parse-archive",
      html: stored.raw_html,
      contentHash: stored.content_hash,
      ...(stored.parsed_payload?.sourceAlias ? { sourceAlias: stored.parsed_payload.sourceAlias } : {}),
      ...(!stored.parsed_payload?.sourceAlias && auditedArchive?.sourceAlias
        ? { sourceAlias: auditedArchive.sourceAlias }
        : {}),
    };
  }

  if (!refreshSource && auditedArchive?.cacheFile && auditedArchive?.sourceUrl) {
    return {
      action: "parse-audited-archive",
      cacheFile: auditedArchive.cacheFile,
      sourceUrl: auditedArchive.sourceUrl,
      sourceAlias: auditedArchive.sourceAlias || null,
    };
  }

  return offline ? { action: "missing-archive" } : { action: "fetch" };
}
