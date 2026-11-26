const AUTH_PREFIXES = [
  "/api/admin/",
  "/api/user/",
  "/api/users/me/",
  "/api/internal/",
  "/api/quizzes",
  "/api/quiz-attempts/",
];

export function isAuthGatewayPath(pathname = "") {
  if (pathname === "/api/webapp-open") {
    return true;
  }

  return AUTH_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}
