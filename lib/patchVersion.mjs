const PATCH_VERSION_PATTERN = /^(\d+)\.(\d+)([a-z]*)$/i;
const CLOSED_BETA_VERSION = "0.0-beta";
const PATCH_VERSION_PREFIX_PATTERN = /^(0\.0-[bB][eE][tT][aA]|\d+\.\d+(?:[a-z]+|[A-Z]+(?=$|\s|[^.a-zA-Z0-9]|\.(?!\d)))?)(?=$|\s|[A-Z]|[^.a-z0-9]|\.(?!\d))/;

/** Parse a Wild Rift major.minor patch version with an optional letter suffix. */
export function parsePatchVersion(value) {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (text.toLowerCase() === CLOSED_BETA_VERSION) {
    return { major: 0, minor: 0, suffix: "-beta", value: CLOSED_BETA_VERSION, source: text };
  }
  const match = text.match(PATCH_VERSION_PATTERN);
  if (!match) return null;

  const major = Number(match[1]);
  const minor = Number(match[2]);
  if (!Number.isSafeInteger(major) || !Number.isSafeInteger(minor)) return null;
  const suffix = match[3].toLowerCase();
  return {
    major,
    minor,
    suffix,
    value: `${match[1]}.${match[2]}${suffix}`,
    source: text,
  };
}

export function isValidPatchVersion(value) {
  return parsePatchVersion(value) !== null;
}

export function requirePatchVersion(value, label = "patch version") {
  const parsed = parsePatchVersion(value);
  if (!parsed) throw new TypeError(`${label} must use the major.minor[letters] format`);
  return parsed.value;
}

/** Parse a patch version at the start of source text, stopping before prose. */
export function matchPatchVersionPrefix(value) {
  const source = String(value ?? "");
  const match = source.match(PATCH_VERSION_PREFIX_PATTERN);
  const parsed = match ? parsePatchVersion(match[1]) : null;
  return parsed
    ? { ...parsed, matchedText: match[1], matchLength: match[0].length }
    : null;
}

export function comparePatchVersions(left, right) {
  const a = parsePatchVersion(left);
  const b = parsePatchVersion(right);
  if (!a || !b) throw new TypeError("Patch versions must use the major.minor[letters] format");
  return a.major - b.major
    || a.minor - b.minor
    || a.suffix.localeCompare(b.suffix);
}
