import { setCors } from "./utils/cors.js";
import { getSiteUserSessionFromRequest } from "../lib/siteUserAuth.mjs";
import {
  loadStreamerTierlistEditor,
  publishStreamerTierlist,
  streamerUserHasAccess,
} from "../lib/streamerTierlists.mjs";

function setNoStore(res) {
  res.setHeader("Cache-Control", "no-store");
}

export default async function handler(req, res) {
  setCors(req, res);

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  setNoStore(res);

  const session = await getSiteUserSessionFromRequest(req);
  if (!session) {
    return res.status(401).json({ error: "unauthorized" });
  }

  if (!streamerUserHasAccess(session.user)) {
    return res.status(403).json({ error: "forbidden" });
  }

  if (req.method === "GET") {
    try {
      const payload = await loadStreamerTierlistEditor(session.user.id);
      return res.status(200).json(payload);
    } catch (error) {
      const code = error instanceof Error ? error.message : "streamer_tierlist_editor_failed";
      const status =
        code === "invalid_site_user"
          ? 400
          : code === "site_user_not_found"
            ? 404
            : 500;
      return res.status(status).json({ error: code });
    }
  }

  if (req.method === "POST") {
    try {
      const { publication, publishAction } = await publishStreamerTierlist(
        session.user.id,
        req.body || {},
      );
      const payload = await loadStreamerTierlistEditor(session.user.id);
      return res.status(publishAction === "created" ? 201 : 200).json({
        ok: true,
        publication,
        publishAction,
        ...payload,
      });
    } catch (error) {
      const code = error instanceof Error ? error.message : "streamer_tierlist_publish_failed";
      const status =
        code === "invalid_site_user"
          ? 400
          : code === "site_user_not_found"
            ? 404
            : 500;
      return res.status(status).json({ error: code });
    }
  }

  return res.status(405).json({ error: "Method Not Allowed" });
}
