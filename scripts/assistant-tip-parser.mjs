export function parseAssistantTipResponse(payload) {
  const text = [payload?.response, payload?.thinking, payload?.message?.content, payload?.message?.thinking]
    .filter((value) => typeof value === "string" && value.trim())
    .join("\n")
    .trim();

  if (!text) throw new Error("Ollama returned an empty tip selection");

  const candidates = [text, ...text.matchAll(/\{[^{}]{0,200}\}/g)].map((candidate) => (typeof candidate === "string" ? candidate : candidate[0]));
  for (const candidate of candidates.reverse()) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && Object.prototype.hasOwnProperty.call(parsed, "tipIndex")) return parsed;
    } catch {
      // Continue with the explicit-key fallback below.
    }
  }

  const matches = [...text.matchAll(/\btipIndex\b\s*(?:is|=|:)?\s*(null|\d+)/gi)];
  const lastMatch = matches.at(-1);
  if (lastMatch) return { tipIndex: lastMatch[1].toLowerCase() === "null" ? null : Number(lastMatch[1]) };

  throw new Error("Ollama returned no parseable tipIndex");
}
