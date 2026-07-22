export function respondQuizError(res, error, fallback = "quiz_request_failed") {
  const status = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
  if (status >= 500) {
    console.error("Quiz request failed", error);
    return res.status(status).json({ error: fallback });
  }
  return res.status(status).json({
    error: error?.message || fallback,
    details: error?.details || null,
  });
}
