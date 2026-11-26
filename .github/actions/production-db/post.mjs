import fs from "node:fs/promises";
import path from "node:path";

const pid = Number(process.env.STATE_tunnelPid);
if (Number.isInteger(pid) && pid > 1) {
  try { process.kill(-pid, "SIGTERM"); } catch (error) { if (error.code !== "ESRCH") throw error; }
}
const directory = process.env.STATE_directory;
const parent = process.env.RUNNER_TEMP;
if (directory && parent && path.dirname(directory) === path.resolve(parent) && path.basename(directory).startsWith("wildrift-db-")) {
  await fs.rm(directory, { recursive: true, force: true });
}
