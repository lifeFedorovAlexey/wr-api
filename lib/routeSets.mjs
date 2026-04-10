import championsHandler from "../api/champions.js";
import championHistoryHandler from "../api/champion-history.js";
import championEventsHandler from "../api/champion-events.js";
import cronImportChampionsHandler from "../api/cron-import-champions.js";
import adminLogoutHandler from "../api/admin-logout.js";
import adminProfileHandler from "../api/admin-profile.js";
import adminAccessUsersHandler from "../api/admin-access-users.js";
import adminSessionExchangeHandler from "../api/admin-session-exchange.js";
import adminSessionHandler from "../api/admin-session.js";
import adminSessionTelegramWebAppHandler from "../api/admin-session-telegram-webapp.js";
import adminUsersHandler from "../api/admin-users.js";
import guidesDetailHandler from "../api/guides-detail.js";
import guidesImportHandler from "../api/guides-import.js";
import guidesHandler from "../api/guides.js";
import healthHandler from "../api/health.js";
import latestStatsSnapshotHandler from "../api/latest-stats-snapshot.js";
import tierlistBulkHandler from "../api/tierlist-bulk.js";
import tierlistHandler from "../api/tierlist.js";
import updatedAtHandler from "../api/updated-at.js";
import userLogoutHandler from "../api/user-logout.js";
import userProfileHandler from "../api/user-profile.js";
import userSessionExchangeHandler from "../api/user-session-exchange.js";
import userSessionHandler from "../api/user-session.js";
import userSessionTelegramWebAppHandler from "../api/user-session-telegram-webapp.js";
import winratesSnapshotHandler from "../api/winrates-snapshot.js";
import webappOpenHandler from "../api/webapp-open.js";
import { isAuthGatewayPath } from "./gatewayRouting.mjs";

export const publicRoutes = new Map([
  ["/api/champions", championsHandler],
  ["/api/champion-history", championHistoryHandler],
  ["/api/champion-events", championEventsHandler],
  ["/api/cron-import-champions", cronImportChampionsHandler],
  ["/api/guides", guidesHandler],
  ["/api/guides/import", guidesImportHandler],
  ["/api/health", healthHandler],
  ["/api/latest-stats-snapshot", latestStatsSnapshotHandler],
  ["/api/tierlist-bulk", tierlistBulkHandler],
  ["/api/tierlist", tierlistHandler],
  ["/api/updated-at", updatedAtHandler],
  ["/api/winrates-snapshot", winratesSnapshotHandler],
]);

export const authRoutes = new Map([
  ["/api/admin/logout", adminLogoutHandler],
  ["/api/admin/access-users", adminAccessUsersHandler],
  ["/api/admin/profile", adminProfileHandler],
  ["/api/admin/session", adminSessionHandler],
  ["/api/admin/session/exchange", adminSessionExchangeHandler],
  ["/api/admin/session/telegram-webapp", adminSessionTelegramWebAppHandler],
  ["/api/admin/users", adminUsersHandler],
  ["/api/health", healthHandler],
  ["/api/user/logout", userLogoutHandler],
  ["/api/user/profile", userProfileHandler],
  ["/api/user/session", userSessionHandler],
  ["/api/user/session/exchange", userSessionExchangeHandler],
  ["/api/user/session/telegram-webapp", userSessionTelegramWebAppHandler],
  ["/api/webapp-open", webappOpenHandler],
]);

export const monolithRoutes = new Map([...publicRoutes, ...authRoutes]);

export const guideDetailRoute = {
  matches(pathname) {
    return pathname.startsWith("/api/guides/");
  },
  getParams(pathname) {
    return {
      slug: decodeURIComponent(pathname.slice("/api/guides/".length)),
    };
  },
  handler: guidesDetailHandler,
};

export { isAuthGatewayPath };
