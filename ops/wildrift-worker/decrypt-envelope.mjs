import fs from "node:fs";
import { constants, privateDecrypt, createDecipheriv } from "node:crypto";

const envelope = JSON.parse(fs.readFileSync("/envelope/worker-envelope.json", "utf8"));
const key = privateDecrypt({ key: fs.readFileSync("/secrets/provision-private.pem"), padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" }, Buffer.from(envelope.key, "base64"));
const cipher = createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.iv, "base64"));
cipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
const config = JSON.parse(Buffer.concat([cipher.update(Buffer.from(envelope.data, "base64")), cipher.final()]).toString());
for (const name of ["worker", "monitor"]) {
  const target = `/secrets/${name}.env`;
  if (fs.existsSync(target)) throw new Error("Existing credentials preserved; refusing overwrite");
  const lines = Object.entries(config[name]).map(([key, value]) => {
    if (!/^[A-Z][A-Z0-9_]*$/.test(key) || /[\r\n]/.test(value)) throw new Error("Invalid environment entry");
    // Docker Compose single quoted values preserve literal dollar signs.
    return `${key}='${String(value).replaceAll("'", "\\'")}'`;
  });
  fs.writeFileSync(target, lines.join("\n") + "\n", { mode: 0o600, flag: "wx" });
}
key.fill(0);
console.log("Worker and read-only monitor credentials installed; values not printed.");
