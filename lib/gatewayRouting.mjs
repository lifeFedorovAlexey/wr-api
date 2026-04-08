const AUTH_PREFIXES = ["/api/admin/", "/api/user/"];

export function isAuthGatewayPath(pathname = "") {
  if (pathname === "/api/webapp-open") {
    return true;
  }

  return AUTH_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

