export function isQuizPlayable(quiz) {
  return quiz?.status === "published" && Boolean(quiz?.currentVersionId);
}
