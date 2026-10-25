import path from "node:path";

export function commandsFor(job, root, slugs = []) {
  const api = path.join(root, "wr-api");
  const script = (name, args = []) => ({ name, cwd: api, args: [path.join(api, "scripts", name + ".mjs"), ...args] });
  if (job === "patch-notes") return [script("sync-patch-notes"), script("sync-patch-note-fallback-assets"), script("sync-patch-note-skin-assets", ["--apply", "--update-db"])];
  const flags = { stats: ["--skip-riftgg", "--skip-guides"], riftgg: ["--skip-cn-history", "--skip-guides"], guides: ["--skip-cn-history", "--skip-riftgg"] }[job];
  if (!flags) throw new Error("Unknown job");
  return [{ name: job, cwd: root, args: [path.join(root, "scripts", "sync-all-data.mjs"), ...flags, ...slugs] }];
}
