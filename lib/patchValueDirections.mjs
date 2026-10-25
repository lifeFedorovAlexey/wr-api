/** Compare aligned values without cancelling buffs at one rank against nerfs at another. */
export function compareNumericChangeDirection(beforeValue, afterValue) {
  const parseGroups = (value) => String(value || "")
    .replace(/\([^)]*\s*(?:→|->)\s*[^)]*\)/g, "")
    .replace(/\((?=[^)]*(?:based on|depending on|at level|level|в зависимости от|уровне))(?=[^)]*[a-zа-я])(?![^)]*\d\s*[+×*/-])[^)]*\)/gi, "")
    .split(/\s*\+\s*/)
    .map((group) => group.match(/\d+(?:[.,]\d+)?/g)
      ?.map((number) => Number(number.replace(",", "."))) || [])
    .filter((group) => group.length);

  const beforeGroups = parseGroups(beforeValue);
  const afterGroups = parseGroups(afterValue);
  const nestedTransitions = Array.from(String(afterValue || "").matchAll(/\(([^()]*)\s*(?:→|->)\s*([^()]*)\)/g));
  for (const transition of nestedTransitions) {
    const beforeTransitionGroups = parseGroups(transition[1]);
    const afterTransitionGroups = parseGroups(transition[2]);
    if (!beforeTransitionGroups.length || beforeTransitionGroups.length !== afterTransitionGroups.length) return "incomparable";
    beforeGroups.push(...beforeTransitionGroups);
    afterGroups.push(...afterTransitionGroups);
  }
  if (!beforeGroups.length || beforeGroups.length !== afterGroups.length) return "incomparable";

  const directions = [];
  for (let index = 0; index < beforeGroups.length; index += 1) {
    const before = beforeGroups[index];
    const after = afterGroups[index];
    if (before.length !== after.length) return "incomparable";
    const differences = after.map((value, valueIndex) => value - before[valueIndex]);
    const changed = differences.filter(Boolean);
    if (!changed.length) continue;
    directions.push(...changed.map(Math.sign));
  }

  if (!directions.length) return "unchanged";
  if (new Set(directions).size > 1) return "mixed";
  return directions[0] > 0 ? "increase" : "decrease";
}

/** A threshold's benefit depends on its stated condition, never the item identity. */
export function classifyThresholdChange(label, direction) {
  if (!/threshold|порог/i.test(label)) return null;
  if (!["increase", "decrease"].includes(direction)) return "adjustment";
  const healthExecution = /health|здоров/i.test(label) && /\bexecut(?:e|ion)\b|казн/i.test(label);
  const minimumRequirement = /\b(?:minimum|required|requirement|at least)\b|минимальн|требуем|необходим|не менее/i.test(label);
  if (!healthExecution && !minimumRequirement) return "adjustment";
  const beneficial = healthExecution ? "increase" : "decrease";
  return direction === beneficial ? "buff" : "nerf";
}
