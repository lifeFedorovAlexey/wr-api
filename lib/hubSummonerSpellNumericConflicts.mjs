const METRIC_TERMS = [
  ["cooldown", /\bcooldown\b|クールダウン/iu],
  ["channel", /\bchannel(?:ing)?\b|詠唱/iu],
  ["stack", /\bstacks?\b|スタック/iu],
  ["movement-speed", /\b(?:movement|move) speed\b|移動速度/iu],
  ["attack-speed", /\battack speed\b|攻撃速度/iu],
  ["shield", /\bshield\b|シールド/iu],
  ["healing", /\bheal(?:s|ing)?\b|\bhealth\b|体力|回復/iu],
  ["damage", /\bdamage\b|ダメージ/iu],
  ["immunity", /\bimmunit(?:y|ies)\b|\bimmune\b|免疫|受けなくなる/iu],
  ["slow", /\bslow(?:s|ed)?\b|スロウ/iu],
  ["gold", /\bgold\b|ゴールド/iu],
  ["range", /\brange\b|射程/iu],
];

function normalizeValue(value) {
  return String(value).replaceAll(",", ".").replace(/\s+/g, "").replace(/[–—〜～]/g, "-");
}

function sentenceStartAt(text, index) {
  let start = 0;
  for (let position = 0; position < index; position += 1) {
    const punctuation = text[position];
    if (![".", "!", "?", "。", "；"].includes(punctuation)) continue;
    if (punctuation === "." && /\d/.test(text[position - 1] || "") && /\d/.test(text[position + 1] || "")) continue;
    start = position + 1;
  }
  return start;
}

function sentenceFor(text, index) {
  const start = sentenceStartAt(text, index);
  let end = text.length;
  for (const stop of [".", "!", "?", "。", "；"]) {
    let position = text.indexOf(stop, index);
    while (position >= 0 && stop === "." && /\d/.test(text[position - 1] || "") && /\d/.test(text[position + 1] || "")) {
      position = text.indexOf(stop, position + 1);
    }
    if (position >= 0 && position < end) end = position + 1;
  }
  return text.slice(start, end).trim();
}

function nearestMetric(text, index) {
  let nearest = null;
  for (const [metric, expression] of METRIC_TERMS) {
    const pattern = new RegExp(expression.source, expression.flags + "g");
    for (const match of text.matchAll(pattern)) {
      const distance = index < match.index
        ? match.index - index
        : index > match.index + match[0].length
          ? index - (match.index + match[0].length)
          : 0;
      if (!nearest || distance < nearest.distance) nearest = { metric, distance };
    }
  }
  return nearest;
}

function createFact({ metric, relation, unit, value, source, language, excerpt }) {
  if (!metric) return null;
  const valueShape = String(value).includes("-") ? "range" : "scalar";
  return {
    key: [metric, relation, unit, valueShape].join(":"),
    metric,
    relation,
    unit,
    valueShape,
    value: normalizeValue(value),
    rawValue: String(value),
    source,
    language,
    excerpt,
  };
}

function allSpellNamesIn(sentence, knownSpellNames) {
  return knownSpellNames.filter((name) => {
    const escaped = String(name).replace(/[.*+?^$|()[\]\\]/g, "\\$&");
    return new RegExp("\\b" + escaped + "\\b", "i").test(sentence);
  });
}

function splitSentences(text) {
  const parts = [];
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    const punctuation = text[index];
    if (![".", "!", "?", "。", "；"].includes(punctuation)) continue;
    if (punctuation === "." && /\d/.test(text[index - 1] || "") && /\d/.test(text[index + 1] || "")) continue;
    if (punctuation !== "。" && punctuation !== "；" && text[index + 1] && !/\s/.test(text[index + 1])) continue;
    const part = text.slice(start, index + 1).trim();
    if (part) parts.push(part);
    start = index + 1;
    while (start < text.length && /\s/.test(text[start])) start += 1;
  }
  const remainder = text.slice(start).trim();
  if (remainder) parts.push(remainder);
  return parts;
}

function extractFactsFromText(text, source) {
  const facts = [];

  const intervalPatterns = [
    [/(?:\bevery\b|\bper\b)\s+(\d+(?:[.,]\d+)?)\s*(seconds?|secs?|minutes?|mins?)\b/giu,
      (unit) => /^m/i.test(unit) ? "minutes" : "seconds"],
    [/((?:\d+(?:[.,]\d+)?))\s*(秒|分)\s*ごと(?:に)?/gu,
      (unit) => unit === "分" ? "minutes" : "seconds"],
  ];
  for (const [expression, unitFor] of intervalPatterns) {
    for (const match of text.matchAll(expression)) {
      const start = sentenceStartAt(text, match.index);
      const excerpt = sentenceFor(text, match.index);
      const valuePosition = match.index + match[0].indexOf(match[1]);
      const metricMatch = nearestMetric(excerpt, valuePosition - start);
      const metric = metricMatch && metricMatch.distance <= 55 ? metricMatch.metric : null;
      const fact = createFact({
        metric,
        relation: "interval",
        unit: unitFor(match[2]),
        value: match[1],
        source: source.source,
        language: source.language,
        excerpt,
      });
      if (fact) facts.push(fact);
    }
  }

  const durationPatterns = [
    {
      expression: /\b(?:for|over|during|lasts?)\s+(\d+(?:[.,]\d+)?)\s*(seconds?|secs?|minutes?|mins?)\b/giu,
      valueIndex: 1,
      unitIndex: 2,
      unitFor: (unit) => /^m/i.test(unit) ? "minutes" : "seconds",
    },
    {
      expression: /(\d+(?:[.,]\d+)?)\s*[- ]\s*(seconds?|secs?|minutes?|mins?)\s+(?:of\s+)?(channel|duration|immunity|immunities)\b/giu,
      valueIndex: 1,
      unitIndex: 2,
      unitFor: (unit) => /^m/i.test(unit) ? "minutes" : "seconds",
    },
    {
      expression: /(\d+(?:[.,]\d+)?)\s*(秒|分)(?:間|かけて)/gu,
      valueIndex: 1,
      unitIndex: 2,
      unitFor: (unit) => unit === "分" ? "minutes" : "seconds",
    },
  ];
  for (const { expression, valueIndex, unitIndex, unitFor } of durationPatterns) {
    for (const match of text.matchAll(expression)) {
      const excerpt = sentenceFor(text, match.index);
      const valuePosition = match.index + match[0].indexOf(match[valueIndex]);
      const metricMatch = nearestMetric(excerpt, valuePosition - sentenceStartAt(text, match.index));
      const metric = metricMatch && metricMatch.distance <= 55 ? metricMatch.metric : null;
      const fact = createFact({
        metric,
        relation: metric === "channel" ? "channel-duration" : "duration",
        unit: unitFor(match[unitIndex]),
        value: match[valueIndex],
        source: source.source,
        language: source.language,
        excerpt,
      });
      if (fact) facts.push(fact);
    }
  }

  const percentPattern = /(\d+(?:[.,]\d+)?)\s*%/gu;
  for (const match of text.matchAll(percentPattern)) {
    const excerpt = sentenceFor(text, match.index);
    const sentenceStart = Math.max(
      text.lastIndexOf(".", match.index - 1),
      text.lastIndexOf("!", match.index - 1),
      text.lastIndexOf("?", match.index - 1),
      text.lastIndexOf("。", match.index - 1),
      text.lastIndexOf("；", match.index - 1),
    ) + 1;
    const localStart = match.index - sentenceStart;
    const metricMatch = nearestMetric(excerpt, localStart);
    const metric = metricMatch && metricMatch.distance <= 55 ? metricMatch.metric : null;
    const fact = createFact({
      metric,
      relation: "percentage",
      unit: "percent",
      value: match[1],
      source: source.source,
      language: source.language,
      excerpt,
    });
    if (fact) facts.push(fact);
  }

  const amountPattern = /(\d+(?:[.,]\d+)?)(?:\s*\(\s*(\d+(?:[.,]\d+)?\s*[-–]\s*\d+(?:[.,]\d+)?)(?:\s+by\s+level)?\s*\))?\s*(true\s+damage|physical\s+damage|magic\s+damage|damage|health|gold)(?:\s*\(\s*(\d+(?:[.,]\d+)?\s*[-–]\s*\d+(?:[.,]\d+)?)(?:\s+by\s+level)?\s*\))?/giu;
  const japaneseAmountPattern = /(\d+(?:[.,]\d+)?)(?:\s*[（(]\s*(\d+(?:[.,]\d+)?\s*[-〜～–]\s*\d+(?:[.,]\d+)?)[^）)]*[）)])?\s*(?:の)?(確定ダメージ|ダメージ|体力|回復|ゴールド)(?:\s*[（(]\s*(\d+(?:[.,]\d+)?\s*[-〜～–]\s*\d+(?:[.,]\d+)?)[^）)]*[）)])?/gu;
  for (const [pattern, language] of [[amountPattern, "en"], [japaneseAmountPattern, "ja"]]) {
    for (const match of text.matchAll(pattern)) {
      const excerpt = sentenceFor(text, match.index);
      const value = match[1];
      const range = language === "ja" ? (match[2] || match[5]) : (match[2] || match[5]);
      const unitText = language === "ja" ? match[3] : match[3];
      const metric = /gold|ゴールド/i.test(unitText) ? "gold"
        : /health|体力|回復/i.test(unitText) ? "healing"
          : /damage|ダメージ/i.test(unitText) ? "damage"
              : null;
      // Tier ladders describe distinct conditional values, not conflicting
      // values for one parameter (for example, Smite's 600/1000/1400 tiers).
      if (metric === "damage" && /\b(?:rising|upgrad(?:e|es|ed|ing)|after\s+\d+\s+stacks?)\b|(?:アップグレード|消費すると)/iu.test(excerpt)) {
        continue;
      }
      if (metric && value) {
        const unit = metric === "stack" ? "stacks" : metric === "gold" ? "gold" : metric === "healing" ? "health" : "damage";
        const baseFact = createFact({
          metric, relation: "value", unit, value,
          source: source.source, language: source.language, excerpt,
        });
        if (baseFact) facts.push(baseFact);
        if (range) {
          const rangeFact = createFact({
            metric, relation: "value", unit, value: range,
            source: source.source, language: source.language, excerpt,
          });
          if (rangeFact) facts.push(rangeFact);
        }
      }
    }
  }

  const cooldownPatterns = [
    /\bcooldown\s*(?:is|of|:)?\s*(\d+(?:[.,]\d+)?)\s*(seconds?|secs?|s)\b/giu,
    /(\d+(?:[.,]\d+)?)\s*[- ]?\s*(seconds?|secs?|s)\s+cooldown\b/giu,
    /クールダウン[はが:：]?\s*(\d+(?:[.,]\d+)?)\s*(秒)/gu,
  ];
  for (const expression of cooldownPatterns) {
    for (const match of text.matchAll(expression)) {
      const fact = createFact({
        metric: "cooldown",
        relation: "cooldown",
        unit: "seconds",
        value: match[1],
        source: source.source,
        language: source.language,
        excerpt: sentenceFor(text, match.index),
      });
      if (fact) facts.push(fact);
    }
  }

  return facts;
}

function faqSentencesForSpell(evidence, spellName, knownSpellNames) {
  const answer = String(evidence?.answer || "");
  const sentences = splitSentences(answer);
  if (Array.isArray(evidence?.spellSlugs) && evidence.spellSlugs.length <= 1) return sentences;
  return sentences.filter((sentence) => {
    const matchingNames = allSpellNamesIn(sentence, knownSpellNames);
    return matchingNames.length === 1 && matchingNames[0].toLowerCase() === spellName.toLowerCase();
  });
}

/**
 * Compare source number facts only when concept, relation, unit and value shape
 * all match. Every finding retains the original text and source section.
 */
export function findHubSummonerSpellNumericConflicts({
  name = "",
  cooldownSeconds = null,
  effectSummary = null,
  structuredDetails = null,
  faqEvidence = [],
  knownSpellNames = [],
} = {}) {
  const sources = [];
  if (Number.isFinite(cooldownSeconds)) {
    sources.push({ source: "catalog-cooldown", language: "en", text: String(cooldownSeconds) + " seconds cooldown" });
  }
  if (typeof effectSummary?.rawText === "string" && effectSummary.rawText.trim()) {
    sources.push({ source: "effect-summary", language: "en", text: effectSummary.rawText });
  }
  if (Number.isFinite(effectSummary?.cooldownSeconds)) {
    sources.push({ source: "effect-summary-cooldown", language: "en", text: String(effectSummary.cooldownSeconds) + " seconds cooldown" });
  }
  if (typeof structuredDetails?.descriptionEn === "string" && structuredDetails.descriptionEn.trim()) {
    for (const text of splitSentences(structuredDetails.descriptionEn)) {
      // Keep all sentences from one source field together. If it describes
      // several conditional values for the same mechanic, comparing those
      // values against a shorter summary would create a false conflict.
      sources.push({ source: "description-en", language: "en", text });
    }
  }
  if (typeof structuredDetails?.descriptionJa === "string" && structuredDetails.descriptionJa.trim()) {
    for (const text of splitSentences(structuredDetails.descriptionJa)) {
      sources.push({ source: "description-ja", language: "ja", text });
    }
  }
  for (const evidence of Array.isArray(faqEvidence) ? faqEvidence : []) {
    const sentences = faqSentencesForSpell(evidence, name, knownSpellNames);
    for (const [index, text] of sentences.entries()) {
      sources.push({
        source: "faq:" + (evidence.id || "entry") + ":" + (index + 1),
        language: "en",
        text,
      });
    }
  }

  const facts = sources.flatMap((source) => extractFactsFromText(source.text, source));
  const byKey = new Map();
  for (const fact of facts) {
    const sourceValues = byKey.get(fact.key) ?? new Map();
    const valueEvidence = sourceValues.get(fact.source) ?? new Map();
    const evidence = valueEvidence.get(fact.value) ?? [];
    evidence.push({
      source: fact.source,
      language: fact.language,
      rawValue: fact.rawValue,
      excerpt: fact.excerpt,
    });
    valueEvidence.set(fact.value, evidence);
    sourceValues.set(fact.source, valueEvidence);
    byKey.set(fact.key, sourceValues);
  }

  const conflicts = [];
  for (const [key, sourceValues] of byKey) {
    // A sentence that contains multiple values for the same fact may describe
    // separate conditions. Ignore that sentence for this fact, while still
    // comparing unambiguous sentences from the same description.
    const values = new Map();
    for (const sourceEvidence of sourceValues.values()) {
      if (sourceEvidence.size > 1) continue;
      for (const [value, evidence] of sourceEvidence) {
        const existing = values.get(value) ?? [];
        existing.push(...evidence);
        values.set(value, existing);
      }
    }
    if (sourceValues.size < 2 || values.size < 2) continue;
    const [metric, relation, unit, valueShape] = key.split(":");
    conflicts.push({
      key,
      metric,
      relation,
      unit,
      valueShape,
      values: [...values.entries()].map(([value, evidence]) => ({ value, evidence })),
      resolution: "unresolved-source-conflict",
    });
  }
  return conflicts;
}
