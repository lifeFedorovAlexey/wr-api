export function requireAcceptedCount(payload, expected, label = "sync") {
  const accepted = Number.isInteger(payload?.accepted) ? payload.accepted : null;
  if (accepted !== expected) {
    const received = accepted === null ? "missing" : accepted;
    throw new Error(`${label} accepted=${received} expected=${expected}`);
  }
  return accepted;
}
