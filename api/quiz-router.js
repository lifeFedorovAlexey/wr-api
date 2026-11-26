import { getSiteUserSessionFromRequest } from "../lib/siteUserAuth.mjs";
import { respondQuizError } from "../lib/quizHttpErrors.mjs";
import {
  cancelQuizAttempt,
  getQuizAttempt,
  getQuizAttemptResult,
  listUserQuizAttempts,
  startQuizAttempt,
  submitQuizAnswer,
} from "../lib/quizAttempts.mjs";
import {
  changeQuizStatus,
  cloneQuiz,
  getQuiz,
  getQuizStatistics,
  publishQuiz,
  updateQuiz,
} from "../lib/quizzes.mjs";

function allow(res, methods) {
  res.setHeader("Allow", methods.join(", "));
  return res.status(405).json({ error: "Method Not Allowed" });
}

export default async function handler(req, res) {
  try {
    const session = await getSiteUserSessionFromRequest(req);
    if (!session?.user) return res.status(401).json({ error: "unauthorized" });
    const actor = session.user;
    const { resource, id, action } = req.params || {};

    if (resource === "me-attempts") {
      if (req.method !== "GET") return allow(res, ["GET"]);
      return res
        .status(200)
        .json({ attempts: await listUserQuizAttempts(actor) });
    }

    if (resource === "attempt") {
      if (!action && req.method === "GET")
        return res
          .status(200)
          .json({ attempt: await getQuizAttempt(actor, id) });
      if (action === "answers" && req.method === "POST")
        return res
          .status(200)
          .json(await submitQuizAnswer(actor, id, req.body || {}));

      if (action === "cancel" && req.method === "POST")
        return res
          .status(200)
          .json({ attempt: await cancelQuizAttempt(actor, id) });
      if (action === "result" && req.method === "GET")
        return res
          .status(200)
          .json({ attempt: await getQuizAttemptResult(actor, id) });
      return allow(res, ["GET", "POST"]);
    }

    if (resource === "quiz") {
      if (!action && req.method === "GET") {
        const manage =
          req.query?.manage === "1" || req.query?.manage === "true";
        return res
          .status(200)
          .json({ quiz: await getQuiz(actor, id, { manage }) });
      }
      if (!action && req.method === "PATCH")
        return res
          .status(200)
          .json({ quiz: await updateQuiz(actor, id, req.body || {}) });
      if (!action && req.method === "DELETE")
        return res
          .status(200)
          .json({ quiz: await changeQuizStatus(actor, id, "delete") });
      if (action === "publish" && req.method === "POST")
        return res.status(200).json(await publishQuiz(actor, id));
      if (
        ["unpublish", "archive", "restore", "block"].includes(action) &&
        req.method === "POST"
      ) {
        return res
          .status(200)
          .json({
            quiz: await changeQuizStatus(actor, id, action, req.body?.reason),
          });
      }
      if (action === "clone" && req.method === "POST")
        return res.status(201).json({ quiz: await cloneQuiz(actor, id) });
      if (action === "preview" && req.method === "GET")
        return res
          .status(200)
          .json({ quiz: await getQuiz(actor, id, { manage: true }) });
      if (action === "statistics" && req.method === "GET")
        return res
          .status(200)
          .json({ statistics: await getQuizStatistics(actor, id) });
      if (action === "attempts" && req.method === "POST")
        return res.status(201).json(await startQuizAttempt(actor, id));
      return allow(res, ["GET", "PATCH", "DELETE", "POST"]);
    }

    return res.status(404).json({ error: "Not Found" });
  } catch (error) {
    return respondQuizError(res, error);
  }
}

export const quizDetailRoute = {
  matches(pathname) {
    return (
      pathname === "/api/users/me/quiz-attempts" ||
      /^\/api\/quizzes\/\d+(?:\/[a-z-]+)?$/.test(pathname) ||
      /^\/api\/quiz-attempts\/\d+(?:\/[a-z-]+)?$/.test(pathname)
    );
  },
  getParams(pathname) {
    if (pathname === "/api/users/me/quiz-attempts")
      return { resource: "me-attempts" };
    const quizMatch = pathname.match(/^\/api\/quizzes\/(\d+)(?:\/([a-z-]+))?$/);
    if (quizMatch)
      return {
        resource: "quiz",
        id: quizMatch[1],
        action: quizMatch[2] || null,
      };
    const attemptMatch = pathname.match(
      /^\/api\/quiz-attempts\/(\d+)(?:\/([a-z-]+))?$/,
    );
    return {
      resource: "attempt",
      id: attemptMatch?.[1],
      action: attemptMatch?.[2] || null,
    };
  },
  handler,
};
