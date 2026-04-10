import { randomBytes } from "node:crypto";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import {
  adminIdentities,
  adminRoles,
  adminSessions,
  adminUserRoles,
  adminUsers,
  siteIdentities,
  siteUsers,
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
export const MANAGED_ADMIN_ROLE_DEFINITIONS = Object.freeze([
  { key: "owner", label: "Owner", description: "Full access, can manage roles and admin users" },
  { key: "admin", label: "Admin", description: "Operational access to admin tools" },
  { key: "streamer", label: "Streamer", description: "Access to streamer-only sections" },
  { key: "patron", label: "Patron", description: "Access to patron-only sections" },
]);
const MANAGED_ADMIN_ROLE_KEY_SET = new Set(
  MANAGED_ADMIN_ROLE_DEFINITIONS.map((role) => role.key),
);

function createAccessError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function buildIdentityLookupKey(provider, subject) {
  const normalizedProvider = String(provider || "").trim();
  const normalizedSubject = String(subject || "").trim();
  if (!normalizedProvider || !normalizedSubject) return "";
  return `${normalizedProvider}:${normalizedSubject}`;
}

function uniqueStrings(values = []) {
  return Array.from(new Set(values.filter(Boolean)));
}

function normalizeRoleKey(roleKey) {
  return String(roleKey || "").trim().toLowerCase();
}

export function normalizeManagedAdminRoleKeys(roleKeys = []) {
  return uniqueStrings(
    (Array.isArray(roleKeys) ? roleKeys : [roleKeys])
      .map(normalizeRoleKey)
      .filter((roleKey) => MANAGED_ADMIN_ROLE_KEY_SET.has(roleKey)),
  ).sort();
}

function splitManagedAndLegacyRoles(roleKeys = []) {
  const normalized = uniqueStrings((Array.isArray(roleKeys) ? roleKeys : []).map(normalizeRoleKey));

  return {
    managedRoles: normalized
      .filter((roleKey) => MANAGED_ADMIN_ROLE_KEY_SET.has(roleKey))
      .sort(),
    legacyRoles: normalized
      .filter((roleKey) => !MANAGED_ADMIN_ROLE_KEY_SET.has(roleKey))
      .sort(),
  };
}

function pickPrimaryEmail(siteUser, identities = []) {
  const identityEmail = identities.find((identity) => identity.providerEmail)?.providerEmail;
  return String(siteUser?.primaryEmail || identityEmail || "").trim() || null;
}

function pickDisplayName(siteUser, identities = []) {
  const fallbackIdentity = identities.find(
    (identity) => identity.profile?.name || identity.providerUsername,
  );

  return (
    String(
      siteUser?.displayName ||
        fallbackIdentity?.profile?.name ||
        fallbackIdentity?.providerUsername ||
        "",
    ).trim() || "Admin user"
  );
}

function normalizeIdentityProfile(identity) {
  return {
    ...(identity?.profile && typeof identity.profile === "object" ? identity.profile : {}),
    provider: identity.provider,
    subject: identity.providerSubject,
    email: identity.providerEmail || identity.profile?.email || "",
    username: identity.providerUsername || identity.profile?.username || "",
    name: identity.profile?.name || "",
    avatarUrl: identity.profile?.avatarUrl || "",
  };
}

function buildIdentityMaps(siteIdentityRows = [], adminIdentityRows = []) {
  const siteIdentityKeys = uniqueStrings(
    siteIdentityRows.map((identity) =>
      buildIdentityLookupKey(identity.provider, identity.providerSubject),
    ),
  );
  const siteIdentityKeySet = new Set(siteIdentityKeys);
  const identityToAdminUserId = new Map();
  const adminUserIds = new Set();

  for (const identity of adminIdentityRows) {
    const lookupKey = buildIdentityLookupKey(identity.provider, identity.providerSubject);
    if (!siteIdentityKeySet.has(lookupKey)) continue;
    identityToAdminUserId.set(lookupKey, identity.userId);
    adminUserIds.add(identity.userId);
  }

  return {
    siteIdentityKeys,
    identityToAdminUserId,
    matchedAdminUserIds: Array.from(adminUserIds),
  };
}

async function findExistingAdminLinks(executor, siteIdentityRows) {
  const providers = uniqueStrings(siteIdentityRows.map((identity) => identity.provider));
  const subjects = uniqueStrings(siteIdentityRows.map((identity) => identity.providerSubject));

  if (providers.length === 0 || subjects.length === 0) {
    return {
      siteIdentityKeys: [],
      identityToAdminUserId: new Map(),
      matchedAdminUserIds: [],
    };
  }

  const adminIdentityRows = await executor
    .select({
      userId: adminIdentities.userId,
      provider: adminIdentities.provider,
      providerSubject: adminIdentities.providerSubject,
    })
    .from(adminIdentities)
    .where(
      and(
        inArray(adminIdentities.provider, providers),
        inArray(adminIdentities.providerSubject, subjects),
      ),
    );

  return buildIdentityMaps(siteIdentityRows, adminIdentityRows);
}

async function fetchSiteUsersWithIdentities() {
  const users = await db.select().from(siteUsers);
  if (users.length === 0) return [];

  const userIds = users.map((user) => user.id);
  const identityRows = await db
    .select({
      id: siteIdentities.id,
      userId: siteIdentities.userId,
      provider: siteIdentities.provider,
      providerSubject: siteIdentities.providerSubject,
      providerEmail: siteIdentities.providerEmail,
      providerUsername: siteIdentities.providerUsername,
      profile: siteIdentities.profile,
      lastLoginAt: siteIdentities.lastLoginAt,
    })
    .from(siteIdentities)
    .where(inArray(siteIdentities.userId, userIds));

  return users.map((user) => ({
    user,
    identities: identityRows.filter((identity) => identity.userId === user.id),
  }));
}

function sortAccessUsers(left, right) {
  const leftWeight = left.roles.length + left.legacyRoles.length > 0 ? 1 : 0;
  const rightWeight = right.roles.length + right.legacyRoles.length > 0 ? 1 : 0;
  if (leftWeight !== rightWeight) return rightWeight - leftWeight;

  const leftTime = left.lastLoginAt ? new Date(left.lastLoginAt).getTime() : 0;
  const rightTime = right.lastLoginAt ? new Date(right.lastLoginAt).getTime() : 0;
  if (leftTime !== rightTime) return rightTime - leftTime;

  return String(left.displayName || "").localeCompare(String(right.displayName || ""), "ru");
}

async function upsertAdminIdentities(executor, adminUserId, identities) {
  for (const identity of identities) {
    await executor
      .insert(adminIdentities)
      .values({
        userId: adminUserId,
        provider: identity.provider,
        providerSubject: identity.providerSubject,
        providerEmail: identity.providerEmail || null,
        providerUsername: identity.providerUsername || null,
        profile: normalizeIdentityProfile(identity),
        lastLoginAt: identity.lastLoginAt || null,
      })
      .onConflictDoUpdate({
        target: [adminIdentities.provider, adminIdentities.providerSubject],
        set: {
          userId: adminUserId,
          providerEmail: identity.providerEmail || null,
          providerUsername: identity.providerUsername || null,
          profile: normalizeIdentityProfile(identity),
          updatedAt: new Date(),
          lastLoginAt: identity.lastLoginAt || null,
        },
      });
  }
}

async function replaceUserRoles(executor, adminUserId, roleKeys) {
  await executor.delete(adminUserRoles).where(eq(adminUserRoles.userId, adminUserId));

  if (!roleKeys.length) return;

  await executor.insert(adminUserRoles).values(
    roleKeys.map((roleKey) => ({
      userId: adminUserId,
      roleKey,
    })),
  );
}

async function revokeActiveAdminSessions(executor, adminUserId) {
  await executor
    .update(adminSessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(adminSessions.userId, adminUserId), isNull(adminSessions.revokedAt)));
}

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
    .values(MANAGED_ADMIN_ROLE_DEFINITIONS)
    .onConflictDoNothing();
}

async function getUserRolesWithExecutor(executor, userId) {
  const rows = await executor
    .select({ roleKey: adminUserRoles.roleKey })
    .from(adminUserRoles)
    .where(eq(adminUserRoles.userId, userId));

  return rows.map((row) => row.roleKey).sort();
}

async function getUserRoles(userId) {
  return await getUserRolesWithExecutor(db, userId);
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

export async function listAccessUsers() {
  await ensureRoleSeeds();

  const siteUsersWithIdentities = await fetchSiteUsersWithIdentities();
  if (siteUsersWithIdentities.length === 0) return [];

  const identityRows = siteUsersWithIdentities.flatMap((entry) => entry.identities);
  const linkedAdminUsers = await findExistingAdminLinks(db, identityRows);
  const matchedAdminUserIds = linkedAdminUsers.matchedAdminUserIds;
  const roleRows =
    matchedAdminUserIds.length > 0
      ? await db
          .select({ userId: adminUserRoles.userId, roleKey: adminUserRoles.roleKey })
          .from(adminUserRoles)
          .where(inArray(adminUserRoles.userId, matchedAdminUserIds))
      : [];

  return siteUsersWithIdentities
    .map(({ user, identities }) => {
      const matchedIds = uniqueStrings(
        identities
          .map((identity) =>
            linkedAdminUsers.identityToAdminUserId.get(
              buildIdentityLookupKey(identity.provider, identity.providerSubject),
            ),
          )
          .filter(Boolean),
      );
      const rawRoles =
        matchedIds.length === 1
          ? roleRows
              .filter((row) => row.userId === matchedIds[0])
              .map((row) => row.roleKey)
          : [];
      const { managedRoles, legacyRoles } = splitManagedAndLegacyRoles(rawRoles);

      return {
        siteUserId: user.id,
        displayName: user.displayName || "",
        primaryEmail: pickPrimaryEmail(user, identities),
        status: user.status,
        lastLoginAt: user.lastLoginAt,
        roles: managedRoles,
        legacyRoles,
        effectiveRoles: ["user", ...managedRoles, ...legacyRoles],
        linkedAdminUserId: matchedIds.length === 1 ? matchedIds[0] : null,
        hasAccessConflict: matchedIds.length > 1,
        identities: identities.map((identity) => ({
          id: identity.id,
          provider: identity.provider,
          providerSubject: identity.providerSubject,
          providerEmail: identity.providerEmail || "",
          providerUsername: identity.providerUsername || "",
          lastLoginAt: identity.lastLoginAt,
        })),
      };
    })
    .sort(sortAccessUsers);
}

async function ensureNotRemovingLastOwner(executor, adminUserId, nextRoleKeys) {
  const currentRoleKeys = await getUserRolesWithExecutor(executor, adminUserId);
  const removesOwner = currentRoleKeys.includes("owner") && !nextRoleKeys.includes("owner");
  if (!removesOwner) return;

  const [row] = await executor
    .select({ count: sql`count(*)::int` })
    .from(adminUserRoles)
    .where(eq(adminUserRoles.roleKey, "owner"));

  if (Number(row?.count || 0) <= 1) {
    throw createAccessError("last_owner_required");
  }
}

async function createAdminUserFromSiteUser(executor, siteUser, identities) {
  const [inserted] = await executor
    .insert(adminUsers)
    .values({
      displayName: pickDisplayName(siteUser, identities),
      primaryEmail: pickPrimaryEmail(siteUser, identities),
      status: "active",
      lastLoginAt: siteUser.lastLoginAt || null,
    })
    .returning({ id: adminUsers.id });

  return inserted.id;
}

export async function updateSiteUserAccessRoles(siteUserIdInput, roleKeysInput) {
  await ensureRoleSeeds();

  const siteUserId = Number(siteUserIdInput || 0);
  if (!Number.isInteger(siteUserId) || siteUserId <= 0) {
    throw createAccessError("invalid_site_user");
  }

  const roleKeys = normalizeManagedAdminRoleKeys(roleKeysInput);

  await db.transaction(async (tx) => {
    const [siteUser] = await tx.select().from(siteUsers).where(eq(siteUsers.id, siteUserId)).limit(1);
    if (!siteUser) {
      throw createAccessError("site_user_not_found");
    }

    const identities = await tx
      .select({
        provider: siteIdentities.provider,
        providerSubject: siteIdentities.providerSubject,
        providerEmail: siteIdentities.providerEmail,
        providerUsername: siteIdentities.providerUsername,
        profile: siteIdentities.profile,
        lastLoginAt: siteIdentities.lastLoginAt,
      })
      .from(siteIdentities)
      .where(eq(siteIdentities.userId, siteUserId));

    if (roleKeys.length > 0 && identities.length === 0) {
      throw createAccessError("site_user_identities_required");
    }

    const linkedAdminUsers = await findExistingAdminLinks(tx, identities);
    if (linkedAdminUsers.matchedAdminUserIds.length > 1) {
      throw createAccessError("admin_identity_conflict");
    }

    let adminUserId = linkedAdminUsers.matchedAdminUserIds[0] || null;
    if (!adminUserId && roleKeys.length === 0) {
      return;
    }

    if (!adminUserId) {
      adminUserId = await createAdminUserFromSiteUser(tx, siteUser, identities);
    }

    await ensureNotRemovingLastOwner(tx, adminUserId, roleKeys);

    await tx
      .update(adminUsers)
      .set({
        displayName: pickDisplayName(siteUser, identities),
        primaryEmail: pickPrimaryEmail(siteUser, identities),
        status: "active",
        updatedAt: new Date(),
      })
      .where(eq(adminUsers.id, adminUserId));

    if (identities.length > 0) {
      await upsertAdminIdentities(tx, adminUserId, identities);
    }

    await replaceUserRoles(tx, adminUserId, roleKeys);
    await revokeActiveAdminSessions(tx, adminUserId);
  });

  const users = await listAccessUsers();
  return users.find((user) => user.siteUserId === siteUserId) || null;
}

export function getAdminCookieName() {
  return ADMIN_COOKIE_NAME;
}
