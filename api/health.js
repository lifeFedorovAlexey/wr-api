import { setCors } from "./utils/cors.js";

function setNoStore(res) {
  res.setHeader("Cache-Control", "no-store");
}

export default async function handler(req, res) {
  setCors(req, res);

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    setNoStore(res);
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  setNoStore(res);

  if (req.method === "HEAD") {
    return res.status(200).end();
  }

  return res.status(200).json({
    ok: true,
    service: "wr-api",
    now: new Date().toISOString(),
  });
}
