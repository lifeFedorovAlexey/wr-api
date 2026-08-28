import { spawn as defaultSpawn } from "node:child_process";
import path from "node:path";

export function describeError(error) {
  const message = error instanceof Error ? error.message : String(error);
  const cause = error && typeof error === "object" ? error.cause : null;
  const causeCode = cause && typeof cause === "object" && "code" in cause ? String(cause.code) : "";
  const causeMessage = cause instanceof Error ? cause.message : "";
  const details = [causeCode, causeMessage].filter(Boolean).join(": ");
  return details ? `${message} (${details})` : message;
}

function getDockerCandidates({ platform, env }) {
  if (platform !== "win32") return ["docker"];
  const candidates = [];
  if (env.DOCKER_EXE) candidates.push(env.DOCKER_EXE);
  if (env.ProgramFiles) candidates.push(path.join(env.ProgramFiles, "Docker", "Docker", "resources", "bin", "docker.exe"));
  candidates.push("docker.exe");
  return [...new Set(candidates)];
}

function getDockerDesktopCandidates({ platform, env }) {
  if (platform !== "win32") return [];
  const candidates = [];
  if (env.ProgramFiles) candidates.push(path.join(env.ProgramFiles, "Docker", "Docker", "Docker Desktop.exe"));
  candidates.push("C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe");
  return [...new Set(candidates)];
}

function launch(plan, { platform, env, spawnImpl }) {
  return new Promise((resolve, reject) => {
    let child;
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      callback(value);
    };
    try {
      child = spawnImpl(plan.executable, plan.args, {
        detached: plan.detached,
        env,
        stdio: "ignore",
        windowsHide: platform === "win32",
      });
    } catch (error) {
      reject(error);
      return;
    }
    child.once("error", (error) => finish(reject, error));
    child.once("spawn", () => {
      if (!plan.waitForExit) {
        child.unref?.();
        finish(resolve);
      }
    });
    if (plan.waitForExit) {
      child.once("close", (code) => {
        if (code === 0) finish(resolve);
        else finish(reject, new Error(`${plan.label} exited with code ${code}`));
      });
    }
  });
}

export function createOllamaRuntime({
  origin,
  executable,
  platform = process.platform,
  env = process.env,
  fetchImpl = fetch,
  spawnImpl = defaultSpawn,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  maxWaitAttempts = 30,
  pollMs = 1000,
  failureCooldownMs = 30000,
} = {}) {
  if (!origin) throw new Error("Ollama origin is required");
  const configuredExecutable = executable || env.OLLAMA_EXE;
  const nativePlans = configuredExecutable
    ? [{ executable: configuredExecutable, args: ["serve"], detached: true, waitForExit: false, label: configuredExecutable }]
    : platform !== "win32"
      ? [{ executable: "ollama", args: ["serve"], detached: true, waitForExit: false, label: "ollama" }]
      : null;
  const dockerCandidates = getDockerCandidates({ platform, env });
  const composeFile = env.OLLAMA_DOCKER_COMPOSE_FILE || "D:\\ai-stack\\docker-compose.yml";
  const desktopCandidates = getDockerDesktopCandidates({ platform, env });
  let recoveryPromise = null;
  let retryAfter = 0;
  let lastFailure = null;

  async function probe() {
    const response = await fetchImpl(`${origin}/api/tags`, { signal: AbortSignal.timeout(2000) });
    if (!response.ok) throw new Error(`Ollama health HTTP ${response.status}`);
    return true;
  }

  async function findDocker() {
    const errors = [];
    for (const docker of dockerCandidates) {
      try {
        await launch({
          executable: docker,
          args: ["info"],
          detached: false,
          waitForExit: true,
          label: `${docker} info`,
        }, { platform, env, spawnImpl });
        return docker;
      } catch (error) {
        errors.push(`${docker}: ${describeError(error)}`);
      }
    }
    return { errors };
  }

  async function startDockerOllama() {
    let docker = await findDocker();
    if (typeof docker !== "string") {
      let desktopStarted = false;
      for (const desktop of desktopCandidates) {
        try {
          await launch({ executable: desktop, args: [], detached: true, waitForExit: false, label: desktop }, { platform, env, spawnImpl });
          desktopStarted = true;
          break;
        } catch (error) {
          docker.errors.push(`${desktop}: ${describeError(error)}`);
        }
      }
      if (!desktopStarted) {
        throw new Error(`Docker Desktop could not start (${docker.errors.join("; ")})`);
      }
      for (let attempt = 0; attempt < maxWaitAttempts; attempt += 1) {
        if (attempt > 0) await sleep(pollMs);
        const result = await findDocker();
        if (typeof result === "string") {
          docker = result;
          break;
        }
        docker.errors.push(...result.errors);
      }
    }
    if (typeof docker !== "string") {
      throw new Error(`Docker Engine did not become ready after ${maxWaitAttempts} attempts (${docker.errors.at(-1) || "unknown error"})`);
    }

    const errors = [];
    for (const args of [["start", "ollama"], ["compose", "-f", composeFile, "up", "-d", "ollama"]]) {
      try {
        await launch({
          executable: docker,
          args,
          detached: false,
          waitForExit: true,
          label: `${docker} ${args.join(" ")}`,
        }, { platform, env, spawnImpl });
        return;
      } catch (error) {
        errors.push(describeError(error));
      }
    }
    throw new Error(`Ollama Docker container could not start (${errors.join("; ")})`);
  }

  async function ensureAvailable() {
    try {
      await probe();
      return;
    } catch {
      // Start or recover Ollama below.
    }

    if (recoveryPromise) return recoveryPromise;
    if (lastFailure && Date.now() < retryAfter) throw lastFailure;

    recoveryPromise = (async () => {
      if (nativePlans) {
        await launch(nativePlans[0], { platform, env, spawnImpl });
      } else {
        await startDockerOllama();
      }

      let lastProbeError = null;
      for (let attempt = 0; attempt < maxWaitAttempts; attempt += 1) {
        try {
          await probe();
          return;
        } catch (error) {
          lastProbeError = error;
          if (attempt + 1 < maxWaitAttempts) await sleep(pollMs);
        }
      }
      throw new Error(`Ollama did not become ready after ${maxWaitAttempts} attempts: ${describeError(lastProbeError)}`);
    })()
      .catch((error) => {
        lastFailure = error;
        retryAfter = Date.now() + failureCooldownMs;
        throw error;
      })
      .finally(() => {
        recoveryPromise = null;
      });

    return recoveryPromise;
  }

  return { ensureAvailable, probe };
}