export function localDatabaseUrl(configuration, port) {
  const lines = configuration.split(/\r?\n/).filter(line => line.startsWith("DATABASE_URL="));
  if (lines.length !== 1) throw new Error("Canonical DATABASE_URL is missing or ambiguous");
  const value = lines[0].slice("DATABASE_URL=".length);
  if (/\s/.test(value)) throw new Error("Canonical DATABASE_URL contains whitespace");
  const url = new URL(value);
  if (!["postgres:", "postgresql:"].includes(url.protocol) ||
      url.hostname !== "127.0.0.1" || url.port !== "55432" || url.pathname !== "/wildrift" ||
      !url.username || !url.password || !Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error("Canonical database must use the private kolvrt tunnel");
  }
  url.port = String(port);
  return { url: url.toString(), password: decodeURIComponent(url.password) };
}
