import { getSiteUserSessionFromRequest } from "../lib/siteUserAuth.mjs";
import { respondQuizError } from "../lib/quizHttpErrors.mjs";
import { createQuiz, listQuizzes } from "../lib/quizzes.mjs";

export default async function handler(req, res) {
  try {
    const session = await getSiteUserSessionFromRequest(req);
    if (!session?.user) return res.status(401).json({ error: "unauthorized" });
    if (req.method === "GET") {
      const managed =
        req.query?.managed === "1" || req.query?.managed === "true";
      return res
        .status(200)
        .json({ quizzes: await listQuizzes(session.user, { managed }) });
    }
    if (req.method === "POST")
      return res
        .status(201)
        .json({ quiz: await createQuiz(session.user, req.body || {}) });
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method Not Allowed" });
  } catch (error) {
    return respondQuizError(res, error);
  }
}
