/** Compare numeric values by stat component while still aggregating ranks within each component. */
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
    const total = changed.reduce((sum, difference) => sum + difference, 0);
    if (!total) return "mixed";
    directions.push(Math.sign(total));
  }

  if (!directions.length) return "unchanged";
  if (new Set(directions).size > 1) return "mixed";
  return directions[0] > 0 ? "increase" : "decrease";
}
