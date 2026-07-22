import { getSiteUserSessionFromRequest } from "../lib/siteUserAuth.mjs";
import { createQuizMediaUpload } from "../lib/quizMedia.mjs";
import { respondQuizError } from "../lib/quizHttpErrors.mjs";

export default async function handler(req, res) {
  try {
    const session = await getSiteUserSessionFromRequest(req);
    if (!session?.user) return res.status(401).json({ error: "unauthorized" });
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ error: "Method Not Allowed" });
    }
    return res
      .status(201)
      .json(await createQuizMediaUpload(session.user, req.body || {}));
  } catch (error) {
    return respondQuizError(res, error, "quiz_media_upload_failed");
  }
}
