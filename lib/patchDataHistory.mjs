import { isDeepStrictEqual } from "node:util";

const PATCH_VERSION_PATTERN = /^(\d+)\.(\d+)([a-z]?)$/i;
const VALUE_TYPES = new Set(["number", "string", "boolean", "null", "object", "array"]);
const FORBIDDEN_PATH_SEGMENTS = new Set(["__proto__", "prototype", "constructor"]);

function cleanText(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value.trim();
}

export function comparePatchVersions(left, right) {
  const a = cleanText(left, "left patch version").match(PATCH_VERSION_PATTERN);
  const b = cleanText(right, "right patch version").match(PATCH_VERSION_PATTERN);
  if (!a || !b) throw new TypeError("Patch versions must use the major.minor[letter] format");
  return Number(a[1]) - Number(b[1])
    || Number(a[2]) - Number(b[2])
    || a[3].toLowerCase().localeCompare(b[3].toLowerCase());
}

function valueType(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function validateTransitionValues(transition) {
  const { before, after, valueType: type, changeType } = transition;
  if (!VALUE_TYPES.has(type)) throw new TypeError("Unsupported transition valueType");
  // JSON null is explicit evidence of absence; valueType describes the present side.
  if (changeType === "new") {
    if (before !== null || type === "null" || valueType(after) !== type) {
      throw new TypeError("New transitions require null before and a typed non-null after-value");
    }
  } else if (changeType === "removed") {
    if (after !== null || type === "null" || valueType(before) !== type) {
      throw new TypeError("Removed transitions require a typed non-null before-value and null after");
    }
  } else if (valueType(before) !== type || valueType(after) !== type) {
    throw new TypeError(`Transition values do not match ${type}`);
  }
  if (changeType === "unchanged" && !sameValue(before, after)) {
    throw new TypeError("Unchanged transitions require equal before and after values");
  }
}

function validateTransition(transition) {
  if (!transition || typeof transition !== "object" || Array.isArray(transition)) {
    throw new TypeError("Transition must be an object");
  }
  cleanText(transition.patchVersion, "patchVersion");
  cleanText(transition.locale, "locale");
  cleanText(transition.mode, "mode");
  cleanText(transition.dataset, "dataset");
  cleanText(transition.entityKind, "entityKind");
  cleanText(transition.entitySlug, "entitySlug");
  if (!["en-us", "ru-ru"].includes(transition.locale)) throw new TypeError("Unsupported transition locale");
  if (!["new", "buff", "nerf", "rework", "adjustment", "removed", "unchanged"].includes(transition.changeType)) {
    throw new TypeError("Unsupported transition changeType");
  }
  const propertyPath = cleanText(transition.propertyPath, "propertyPath");
  const segments = propertyPath.split(".");
  if (segments.some((segment) => !segment || FORBIDDEN_PATH_SEGMENTS.has(segment))) {
    throw new TypeError(`Unsafe or invalid propertyPath: ${propertyPath}`);
  }
  validateTransitionValues(transition);
  cleanText(transition.sourceKind, "sourceKind");
  cleanText(transition.sourceUrl, "sourceUrl");
  if (!Array.isArray(transition.sourceEvidence) || transition.sourceEvidence.length === 0) {
    throw new TypeError("Transition requires sourceEvidence");
  }
  if (transition.verificationStatus !== "verified") {
    throw new Error("Only verified transitions can be used to reconstruct history");
  }
  return segments;
}

function readPath(state, segments) {
  let current = state;
  for (const segment of segments) {
    if (!current || typeof current !== "object" || !Object.hasOwn(current, segment)) {
      throw new Error(`Snapshot does not contain property ${segments.join(".")}`);
    }
    current = current[segment];
  }
  return current;
}

function writePath(state, segments, value) {
  let current = state;
  for (const segment of segments.slice(0, -1)) {
    if (!current || typeof current !== "object" || !Object.hasOwn(current, segment)) {
      throw new Error(`Snapshot does not contain property ${segments.join(".")}`);
    }
    current = current[segment];
  }
  const key = segments.at(-1);
  if (!current || typeof current !== "object" || !Object.hasOwn(current, key)) {
    throw new Error(`Snapshot does not contain property ${segments.join(".")}`);
  }
  current[key] = structuredClone(value);
}

function sameValue(left, right) {
  return isDeepStrictEqual(left, right);
}

/** Apply a reviewed delta only when the source snapshot exactly matches its recorded before-value. */
export function applyPatchDataTransition(state, transition) {
  const segments = validateTransition(transition);
  const actual = readPath(state, segments);
  if (!sameValue(actual, transition.before)) {
    throw new Error(
      `Cannot apply ${transition.patchVersion} ${transition.entitySlug} ${transition.propertyPath}: `
      + `expected ${JSON.stringify(transition.before)}, found ${JSON.stringify(actual)}`,
    );
  }
  const next = structuredClone(state);
  writePath(next, segments, transition.after);
  return next;
}

/** Reverse a reviewed delta only when the source snapshot exactly matches its recorded after-value. */
export function reversePatchDataTransition(state, transition) {
  const segments = validateTransition(transition);
  const actual = readPath(state, segments);
  if (!sameValue(actual, transition.after)) {
    throw new Error(
      `Cannot reverse ${transition.patchVersion} ${transition.entitySlug} ${transition.propertyPath}: `
      + `expected ${JSON.stringify(transition.after)}, found ${JSON.stringify(actual)}`,
    );
  }
  const previous = structuredClone(state);
  writePath(previous, segments, transition.before);
  return previous;
}

/** Replay only an explicitly supplied contiguous patch sequence; never infer missing no-change patches. */
export function reversePatchDataHistory(currentState, transitions, expectedPatchVersions, expectedPropertyPaths) {
  if (!Array.isArray(transitions) || !Array.isArray(expectedPatchVersions) || !Array.isArray(expectedPropertyPaths)) {
    throw new TypeError("transitions, expectedPatchVersions, and expectedPropertyPaths must be arrays");
  }
  const expected = expectedPatchVersions.map((version) => cleanText(version, "expected patch version"));
  const paths = expectedPropertyPaths.map((path) => cleanText(path, "expected property path"));
  const keys = new Set();
  let chainIdentity = null;
  for (const transition of transitions) {
    validateTransition(transition);
    const identity = [transition.locale, transition.mode, transition.dataset, transition.entityKind, transition.entitySlug].join("\u0000");
    if (chainIdentity && chainIdentity !== identity) {
      throw new Error("History chain contains more than one locale, mode, dataset, or entity");
    }
    chainIdentity = identity;
    const key = `${transition.patchVersion}\u0000${transition.propertyPath}`;
    if (keys.has(key)) throw new Error(`Duplicate transition for ${transition.patchVersion} ${transition.propertyPath}`);
    keys.add(key);
  }
  const actualVersions = [...new Set(transitions.map((transition) => transition.patchVersion))];
  for (const version of actualVersions) {
    if (!expected.includes(version)) throw new Error(`Transition contains unexpected patch ${version}`);
  }
  const unexpectedPaths = [...new Set(transitions.map((transition) => transition.propertyPath))]
    .filter((path) => !paths.includes(path));
  if (unexpectedPaths.length) throw new Error(`Transition contains untracked properties: ${unexpectedPaths.join(", ")}`);
  const missing = expected.flatMap((version) => paths
    .filter((path) => !keys.has(`${version}\u0000${path}`))
    .map((path) => `${version} ${path}`));
  if (missing.length) throw new Error(`History is incomplete; missing verified change or no-change evidence for: ${missing.join(", ")}`);

  const orderedVersions = [...expected].sort((left, right) => comparePatchVersions(right, left));
  let state = structuredClone(currentState);
  for (const version of orderedVersions) {
    const patchTransitions = transitions.filter((transition) => transition.patchVersion === version);
    for (const transition of patchTransitions) state = reversePatchDataTransition(state, transition);
  }
  return state;
}
