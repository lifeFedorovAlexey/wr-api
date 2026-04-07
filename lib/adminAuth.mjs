import { randomBytes } from "node:crypto";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import {
  adminIdentities,
  adminRoles,
  adminSessions,
  adminUserRoles,
  adminUsers,
} from "../db/schema.js";
import {
  createSignedEnvelope,
  getRequestIp,
  hashValue,
  normalizeAuthProfile,
  normalizeEmail,
  normalizeId,
  normalizeSecret,
  normalizeUsername,
  readSessionToken,
  verifySignedEnvelope,
} from "./sessionAuthShared.mjs";

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14;
const EXCHANGE_TTL_MS = 1000 * 60;
const ADMIN_COOKIE_NAME = "wr_admin_session";

function parseList(value, normalizer = (item) => item) {
  return new Set(
    String(value || "")
      .split(/[\s,]+/)
      .map((item) => normalizer(item.trim()))
      .filter(Boolean),
  );
}

export function createSignedExchangeEnvelope(payload, env = process.env) {
  return createSignedEnvelope(payload, {
    secret: normalizeSecret(env),
    missingSecretError: "missing_admin_session_secret",
  });
}

export function verifySignedExchangeEnvelope(payload, signature, env = process.env) {
  return verifySignedEnvelope(payload, signature, {
    secret: normalizeSecret(env),
    ttlMs: EXCHANGE_TTL_MS,
  });
}

export function canBootstrapAdmin(profile, env = process.env) {
  const normalized = normalizeAuthProfile(profile);

  const bootstrapEmails = parseList(env.ADMIN_BOOTSTRAP_EMAILS, normalizeEmail);
  const bootstrapTelegramIds = parseList(env.ADMIN_BOOTSTRAP_TELEGRAM_IDS, normalizeId);
  const bootstrapTelegramUsernames = parseList(
    env.ADMIN_BOOTSTRAP_TELEGRAM_USERNAMES,
    normalizeUsername,
  );
  const bootstrapVkIds = parseList(env.ADMIN_BOOTSTRAP_VK_IDS, normalizeId);

  if (normalized.email && bootstrapEmails.has(normalized.email)) return true;
  if (normalized.provider === "telegram") {
    if (normalized.subject && bootstrapTelegramIds.has(normalized.subject)) return true;
    if (normalized.username && bootstrapTelegramUsernames.has(normalized.username)) return true;
  }
  if (normalized.provider === "vk" && normalized.subject && bootstrapVkIds.has(normalized.subject)) {
    return true;
  }

  return false;
}

async function ensureRoleSeeds() {
  await db
    .insert(adminRoles)
    .values([
      { key: "owner", label: "Owner", description: "Full access, can manage roles and admin users" },
      { key: "admin", label: "Admin", description: "Operational access to admin tools" },
      { key: "editor", label: "Editor", description: "Content management access" },
      { key: "viewer", label: "Viewer", description: "Read-only admin access" },
    ])
    .onConflictDoNothing();
}

async function getUserRoles(userId) {
  const rows = await db
    .select({ roleKey: adminUserRoles.roleKey })
    .from(adminUserRoles)
    .where(eq(adminUserRoles.userId, userId));

  return rows.map((row) => row.roleKey).sort();
}

async function buildUserView(userId) {
  const [user] = await db.select().from(adminUsers).where(eq(adminUsers.id, userId)).limit(1);
  if (!user || user.status !== "active") return null;

  const roles = await getUserRoles(userId);
  const identities = await db
    .select({
      id: adminIdentities.id,
      provider: adminIdentities.provider,
      providerSubject: adminIdentities.providerSubject,
      providerEmail: adminIdentities.providerEmail,
      providerUsername: adminIdentities.providerUsername,
      lastLoginAt: adminIdentities.lastLoginAt,
    })
    .from(adminIdentities)
    .where(eq(adminIdentities.userId, userId));

  return {
    id: user.id,
    displayName: user.displayName || "",
    primaryEmail: user.primaryEmail || "",
    status: user.status,
    roles,
    lastLoginAt: user.lastLoginAt,
    identities,
  };
}

async function countActiveAdminUsers() {
  const [row] = await db
    .select({ count: sql`count(*)::int` })
    .from(adminUsers)
    .where(eq(adminUsers.status, "active"));

  return Number(row?.count || 0);
}

async function linkIdentityToExistingUser(profile) {
  if (!profile.email) return null;

  const [existingUser] = await db
    .select()
    .from(adminUsers)
    .where(and(eq(adminUsers.primaryEmail, profile.email), eq(adminUsers.status, "active")))
    .limit(1);

  return existingUser || null;
}

async function createBootstrapOwner(profile) {
  return await db.transaction(async (tx) => {
    const [insertedUser] = await tx
      .insert(adminUsers)
      .values({
        displayName: profile.name || profile.username || profile.email || profile.subject,
        primaryEmail: profile.email || null,
        status: "active",
        lastLoginAt: new Date(),
      })
      .returning({ id: adminUsers.id });

    await tx.insert(adminIdentities).values({
      userId: insertedUser.id,
      provider: profile.provider,
      providerSubject: profile.subject,
      providerEmail: profile.email || null,
      providerUsername: profile.username || null,
      profile,
      lastLoginAt: new Date(),
    });

    await tx.insert(adminUserRoles).values([
      { userId: insertedUser.id, roleKey: "owner" },
      { userId: insertedUser.id, roleKey: "admin" },
    ]);

    return insertedUser.id;
  });
}

async function upsertIdentity(userId, profile) {
  await db
    .insert(adminIdentities)
    .values({
      userId,
      provider: profile.provider,
      providerSubject: profile.subject,
      providerEmail: profile.email || null,
      providerUsername: profile.username || null,
      profile,
      lastLoginAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [adminIdentities.provider, adminIdentities.providerSubject],
      set: {
        userId,
        providerEmail: profile.email || null,
        providerUsername: profile.username || null,
        profile,
        updatedAt: new Date(),
        lastLoginAt: new Date(),
      },
    });
}

async function touchUser(userId, profile) {
  const updates = {
    updatedAt: new Date(),
    lastLoginAt: new Date(),
  };

  if (profile.name) updates.displayName = profile.name;
  if (profile.email) updates.primaryEmail = profile.email;

  await db.update(adminUsers).set(updates).where(eq(adminUsers.id, userId));
}

async function issueSession(userId, req) {
  const rawToken = randomBytes(32).toString("base64url");
  const sessionHash = hashValue(rawToken);

  await db.insert(adminSessions).values({
    userId,
    sessionHash,
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    userAgent: String(req.headers["user-agent"] || "").slice(0, 512),
    ipHash: hashValue(getRequestIp(req)),
  });

  return rawToken;
}

export async function exchangeAdminIdentityForSession(
  profileInput,
  req,
  env = process.env,
  options = {},
) {
  await ensureRoleSeeds();

  const profile = normalizeAuthProfile(profileInput);
  if (!profile.provider || !profile.subject) {
    return { ok: false, error: "invalid_profile" };
  }
  const preferredUserId = Number(options.linkToUserId || 0) || null;

  const [existingIdentity] = await db
    .select()
    .from(adminIdentities)
    .where(
      and(
        eq(adminIdentities.provider, profile.provider),
        eq(adminIdentities.providerSubject, profile.subject),
      ),
    )
    .limit(1);

  let userId = existingIdentity?.userId || null;

  if (!userId && preferredUserId) {
    userId = preferredUserId;
  }

  if (!userId) {
    const existingUser = await linkIdentityToExistingUser(profile);
    if (existingUser) {
      userId = existingUser.id;
    }
  }

  if (!userId) {
    const activeAdminCount = await countActiveAdminUsers();
    if (activeAdminCount === 0 && canBootstrapAdmin(profile, env)) {
      userId = await createBootstrapOwner(profile);
    } else if (activeAdminCount === 0) {
      return { ok: false, error: "bootstrap_required" };
    }
  }

  if (!userId) {
    return { ok: false, error: "admin_not_allowed" };
  }

  await upsertIdentity(userId, profile);
  await touchUser(userId, profile);

  const user = await buildUserView(userId);
  if (!user || user.roles.length === 0) {
    return { ok: false, error: "admin_not_allowed" };
  }

  const sessionToken = await issueSession(userId, req);
  return { ok: true, sessionToken, user };
}

export async function getAdminSessionFromRequest(req) {
  const sessionToken = readSessionToken(req, ADMIN_COOKIE_NAME);
  if (!sessionToken) return null;

  const sessionHash = hashValue(sessionToken);
  const [session] = await db
    .select()
    .from(adminSessions)
    .where(
      and(
        eq(adminSessions.sessionHash, sessionHash),
        isNull(adminSessions.revokedAt),
      ),
    )
    .limit(1);

  if (!session || new Date(session.expiresAt).getTime() <= Date.now()) {
    return null;
  }

  await db
    .update(adminSessions)
    .set({ lastSeenAt: new Date() })
    .where(eq(adminSessions.id, session.id));

  const user = await buildUserView(session.userId);
  if (!user) return null;

  return {
    token: sessionToken,
    user,
    sessionId: session.id,
  };
}

export async function revokeAdminSession(req) {
  const sessionToken = readSessionToken(req, ADMIN_COOKIE_NAME);
  if (!sessionToken) return false;

  const sessionHash = hashValue(sessionToken);
  await db
    .update(adminSessions)
    .set({ revokedAt: new Date() })
    .where(
      and(eq(adminSessions.sessionHash, sessionHash), isNull(adminSessions.revokedAt)),
    );

  return true;
}

export function userHasAnyRole(user, roleKeys) {
  const roleSet = new Set(user?.roles || []);
  return roleKeys.some((roleKey) => roleSet.has(roleKey));
}

export async function listAdminUsers() {
  const users = await db.select().from(adminUsers).where(eq(adminUsers.status, "active"));
  if (users.length === 0) return [];

  const userIds = users.map((user) => user.id);
  const roleRows = await db
    .select({ userId: adminUserRoles.userId, roleKey: adminUserRoles.roleKey })
    .from(adminUserRoles)
    .where(inArray(adminUserRoles.userId, userIds));
  const identityRows = await db
    .select({
      userId: adminIdentities.userId,
      provider: adminIdentities.provider,
      providerEmail: adminIdentities.providerEmail,
      providerUsername: adminIdentities.providerUsername,
      lastLoginAt: adminIdentities.lastLoginAt,
    })
    .from(adminIdentities)
    .where(inArray(adminIdentities.userId, userIds));

  return users
    .map((user) => ({
      id: user.id,
      displayName: user.displayName || "",
      primaryEmail: user.primaryEmail || "",
      status: user.status,
      lastLoginAt: user.lastLoginAt,
      roles: roleRows
        .filter((row) => row.userId === user.id)
        .map((row) => row.roleKey)
        .sort(),
      identities: identityRows.filter((row) => row.userId === user.id),
    }))
    .sort((left, right) => left.id - right.id);
}

export function getAdminCookieName() {
  return ADMIN_COOKIE_NAME;
}
