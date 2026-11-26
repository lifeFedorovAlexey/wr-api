export async function runInferenceWithRecovery({
  attempt,
  retries,
  autoStart,
  ensureAvailable,
  onRecovery,
}) {
  const maxRetries = Math.max(1, Number(retries) || 1);
  let inferenceAttempts = 0;
  let lastError = null;
  let recoveryAttempted = false;

  while (inferenceAttempts < maxRetries) {
    try {
      const result = await attempt();
      inferenceAttempts += 1;
      if (result !== null && result !== undefined) return result;
    } catch (error) {
      if (autoStart && error?.code === "OLLAMA_FETCH_FAILED" && !recoveryAttempted) {
        recoveryAttempted = true;
        await onRecovery?.(error);
        try {
          await ensureAvailable();
        } catch (recoveryError) {
          throw new Error(`${error.message}; auto-start failed: ${recoveryError.message}`, { cause: recoveryError });
        }
        continue;
      }
      lastError = error;
      inferenceAttempts += 1;
    }
  }

  if (lastError) throw lastError;
  return null;
}
