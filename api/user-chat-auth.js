import { getSiteUserSessionFromRequest } from "../lib/siteUserAuth.mjs";
import { createSignedChatExchangeEnvelope } from "../lib/chatAuth.mjs";
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

  const session = await getSiteUserSessionFromRequest(req);
  if (!session) {
    if (req.method === "HEAD") {
      return res.status(401).end();
    }

    return res.status(401).json({ authenticated: false });
  }

  if (req.method === "HEAD") {
    return res.status(200).end();
  }

  try {
    const chat = createSignedChatExchangeEnvelope(session.user, process.env);
    return res.status(200).json({
      authenticated: true,
      user: session.user,
      chat,
    });
  } catch (error) {
    return res.status(500).json({
      authenticated: true,
      user: session.user,
      error: error instanceof Error ? error.message : "chat_auth_failed",
    });
  }
}

