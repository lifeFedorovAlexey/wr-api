function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseJsonValueAt(text, startIndex) {
  const opening = text[startIndex];
  if (opening !== "[" && opening !== "{") {
    throw new Error("Next Flight property has an invalid JSON value");
  }

  const expectedClosers = [];
  let inString = false;
  let escaped = false;
  for (let index = startIndex; index < text.length; index += 1) {
    const character = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }

    if (character === '"') {
      inString = true;
      continue;
    }
    if (character === "[") expectedClosers.push("]");
    else if (character === "{") expectedClosers.push("}");
    else if (character === "]" || character === "}") {
      if (expectedClosers.pop() !== character) {
        throw new Error("Next Flight property has unbalanced JSON");
      }
      if (expectedClosers.length === 0) {
        const endIndex = index + 1;
        return { value: JSON.parse(text.slice(startIndex, endIndex)), endIndex };
      }
    }
  }

  throw new Error("Next Flight property has unterminated JSON");
}

/** Extract one JSON property from the serialized React Server Components payloads in a Next.js page. */
export function parseNextFlightProperty($, propertyName) {
  if (typeof propertyName !== "string" || !/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(propertyName)) {
    throw new TypeError("propertyName must be a valid JavaScript property name");
  }

  const flightPrefix = "self.__next_f.push(";
  const propertyPattern = new RegExp(`"${escapeRegExp(propertyName)}"\\s*:`);
  const matches = [];
  for (const element of $("script").toArray()) {
    const scriptText = $(element).text();
    let cursor = 0;
    while (true) {
      const callIndex = scriptText.indexOf(flightPrefix, cursor);
      if (callIndex < 0) break;
      const argumentStart = callIndex + flightPrefix.length;
      const { value: pushArguments, endIndex } = parseJsonValueAt(scriptText, argumentStart);
      cursor = endIndex;
      if (!Array.isArray(pushArguments)) continue;

      const flightPayload = pushArguments.find((value) => (
        typeof value === "string" && propertyPattern.test(value)
      ));
      if (!flightPayload) continue;

      const fieldMatch = flightPayload.match(propertyPattern);
      if (!fieldMatch || fieldMatch.index === undefined) continue;
      const valueStart = fieldMatch.index + fieldMatch[0].length;
      let valueIndex = valueStart;
      while (/\s/.test(flightPayload[valueIndex] ?? "")) valueIndex += 1;
      const { value } = parseJsonValueAt(flightPayload, valueIndex);
      matches.push(value);
    }
  }

  if (matches.length > 1) {
    throw new Error(`Next Flight page contains ambiguous ${propertyName} datasets`);
  }
  return matches[0] ?? null;
}
