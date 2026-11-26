import { revokeSiteUserSession } from "../lib/siteUserAuth.mjs";
import { setCors } from "./utils/cors.js";

function setNoStore(res) {
  res.setHeader("Cache-Control", "no-store");
}

export default async function handler(req, res) {
  setCors(req, res);

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    setNoStore(res);
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  setNoStore(res);
  await revokeSiteUserSession(req);
  return res.status(200).json({ ok: true });
}
