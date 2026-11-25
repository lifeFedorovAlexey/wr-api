import fs from "node:fs/promises";
import path from "node:path";
import net from "node:net";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { localDatabaseUrl, commandValue } from "./connection.mjs";

const exec = promisify(execFile);
let child;
let directory;

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function isListening(port) {
  return new Promise(resolve => {
    const socket = net.connect({ host: "127.0.0.1", port });
    socket.setTimeout(1000);
    const finish = ok => { socket.destroy(); resolve(ok); };
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.once("timeout", () => finish(false));
  });
}

try {
  const host = process.env["INPUT_SSH-HOST"];
  const user = process.env["INPUT_SSH-USER"];
  const password = process.env["INPUT_SSH-PASSWORD"];
  if (!/^[a-zA-Z0-9][a-zA-Z0-9.-]*$/.test(host || "") || !/^[a-z_][a-z0-9_-]*$/i.test(user || "") || !password) {
    throw new Error("Existing deployment SSH credentials are required");
  }
  directory = await fs.mkdtemp(path.join(process.env.RUNNER_TEMP, "wildrift-db-"));
  await fs.chmod(directory, 0o700);
  await fs.writeFile(path.join(directory, "askpass"), '#!/bin/sh\nprintf \'%s\\n\' "$WR_SSH_PASSWORD"\n', { mode: 0o700 });
  await fs.writeFile(path.join(directory, "known_hosts"),
    "wildrift-production ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIBfMb1HX+oexiMuSL7BQSG4IT/R1Fh8LjoOWNkrbHBhU\n", { mode: 0o600 });
  const env = { ...process.env, WR_SSH_PASSWORD: password, SSH_ASKPASS: path.join(directory, "askpass"), SSH_ASKPASS_REQUIRE: "force", DISPLAY: ":0" };
  const args = ["-T", "-o", "StrictHostKeyChecking=yes", "-o", "HostKeyAlias=wildrift-production",
    "-o", `UserKnownHostsFile=${path.join(directory, "known_hosts")}`, "-o", "GlobalKnownHostsFile=/dev/null",
    "-o", "HostKeyAlgorithms=ssh-ed25519", "-o", "PreferredAuthentications=password,keyboard-interactive",
    "-o", "PubkeyAuthentication=no", "-o", "NumberOfPasswordPrompts=1", "-o", "ConnectTimeout=10",
    "-o", "ServerAliveInterval=20", "-o", "ServerAliveCountMax=3"];
  const port = await freePort();
  let configuration;
  try {
    ({ stdout: configuration } = await exec("ssh", [...args, `${user}@${host}`, "cat /var/www/wr-api/shared/database.env"], { env, timeout: 20000, maxBuffer: 65536 }));
  } catch {
    throw new Error("Cannot read canonical database configuration over verified SSH; refusing legacy credentials");
  }
  const database = localDatabaseUrl(configuration, port);
  console.log(`::add-mask::${commandValue(database.url)}`);
  console.log(`::add-mask::${commandValue(database.password)}`);
  child = spawn("ssh", [...args, "-o", "ExitOnForwardFailure=yes", "-N", "-L", `127.0.0.1:${port}:127.0.0.1:55432`, `${user}@${host}`], { env, detached: true, stdio: "ignore" });
  let spawnError;
  child.on("error", error => { spawnError = error; });
  child.unref();
  const deadline = Date.now() + 20000;
  while (!(await isListening(port))) {
    if (spawnError || child.exitCode !== null || Date.now() > deadline) throw new Error("Private PostgreSQL SSH forward did not start");
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  try {
    const { default: postgres } = await import("postgres");
    const sql = postgres(database.url, { max: 1, connect_timeout: 10, onnotice() {}, connection: { default_transaction_read_only: "on", statement_timeout: 10000 } });
    try {
      const [row] = await sql`select current_database() as name, to_regclass('public.scrape_job_state')::text as coordinator`;
      if (row.name !== "wildrift" || !row.coordinator) throw new Error("Unexpected production database");
    } finally {
      await sql.end({ timeout: 3 });
    }
  } catch {
    throw new Error("Private PostgreSQL database is unavailable through the VPS tunnel");
  }
  await fs.appendFile(process.env.GITHUB_STATE, `tunnelPid=${child.pid}\ndirectory=${directory}\n`);
  await fs.appendFile(process.env.GITHUB_ENV, `DATABASE_URL=${database.url}\n`);
  console.log("Connected to production PostgreSQL through the VPS private tunnel");
} catch (error) {
  if (child?.pid) { try { process.kill(-child.pid, "SIGTERM"); } catch { /* Already exited. */ } }
  if (directory) await fs.rm(directory, { recursive: true, force: true });
  // SSH error objects can contain captured configuration; only emit our own summaries.
  const message = error.message.startsWith("Canonical ") || error.message.startsWith("Cannot read ") || error.message.startsWith("Private ") || error.message.startsWith("Existing ")
    ? error.message : "Production database tunnel setup failed";
  console.error(`::error::${commandValue(message)}`);
  process.exitCode = 1;
}
