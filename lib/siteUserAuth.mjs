import { randomBytes } from "node:crypto";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "../db/client.js";
import { siteIdentities, siteSessions, siteUsers } from "../db/schema.js";
import {
  createSignedEnvelope,
  getRequestIp,
  hashValue,
  normalizeAuthProfile,
  normalizeSecret,
  readSessionToken,
  verifySignedEnvelope,
} from "./sessionAuthShared.mjs";

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14;
const EXCHANGE_TTL_MS = 1000 * 60;
const USER_COOKIE_NAME = "wr_user_session";

export function createSignedUserExchangeEnvelope(payload, env = process.env) {
  return createSignedEnvelope(payload, {
    secret: normalizeSecret(env),
    missingSecretError: "missing_admin_session_secret",
  });
}

export function verifySignedUserExchangeEnvelope(payload, signature, env = process.env) {
  return verifySignedEnvelope(payload, signature, {
    secret: normalizeSecret(env),
    ttlMs: EXCHANGE_TTL_MS,
  });
}

function getFallbackDisplayName(profile) {
  return (
    profile.name ||
    profile.username ||
    {
      google: "Google user",
      yandex: "Yandex user",
      vk: "VK user",
      telegram: "Telegram user",
    }[profile.provider] ||
    "User"
  );
}

async function buildUserView(userId) {
  const [user] = await db.select().from(siteUsers).where(eq(siteUsers.id, userId)).limit(1);
  if (!user || user.status !== "active") return null;

  const identities = await db
    .select({
      id: siteIdentities.id,
      provider: siteIdentities.provider,
      providerSubject: siteIdentities.providerSubject,
      providerUsername: siteIdentities.providerUsername,
      lastLoginAt: siteIdentities.lastLoginAt,
      profile: siteIdentities.profile,
    })
    .from(siteIdentities)
    .where(eq(siteIdentities.userId, userId));

  return {
    id: user.id,
    displayName: user.displayName || "",
    avatarUrl: user.avatarUrl || "",
    status: user.status,
    role: "user",
    lastLoginAt: user.lastLoginAt,
    identities: identities.map((identity) => ({
      id: identity.id,
      provider: identity.provider,
      subject: identity.providerSubject,
      username: identity.providerUsername || "",
      avatarUrl: String(identity.profile?.avatarUrl || ""),
      name: String(identity.profile?.name || ""),
    })),
  };
}

async function createSiteUser(profile) {
  const [insertedUser] = await db
    .insert(siteUsers)
    .values({
      displayName: getFallbackDisplayName(profile),
      avatarUrl: profile.avatarUrl || null,
      status: "active",
      lastLoginAt: new Date(),
    })
    .returning({ id: siteUsers.id });

  return insertedUser.id;
}

async function upsertIdentity(userId, profile) {
  await db
    .insert(siteIdentities)
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
      target: [siteIdentities.provider, siteIdentities.providerSubject],
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
  const [currentUser] = await db.select().from(siteUsers).where(eq(siteUsers.id, userId)).limit(1);
  if (!currentUser) return;

  const updates = {
    updatedAt: new Date(),
    lastLoginAt: new Date(),
  };

  if (!currentUser.displayName && getFallbackDisplayName(profile)) {
    updates.displayName = getFallbackDisplayName(profile);
  }

  if ((!currentUser.avatarUrl || currentUser.avatarUrl === "") && profile.avatarUrl) {
    updates.avatarUrl = profile.avatarUrl;
  }

  await db.update(siteUsers).set(updates).where(eq(siteUsers.id, userId));
}

async function issueSession(userId, req) {
  const rawToken = randomBytes(32).toString("base64url");
  const sessionHash = hashValue(rawToken);

  await db.insert(siteSessions).values({
    userId,
    sessionHash,
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    userAgent: String(req.headers["user-agent"] || "").slice(0, 512),
    ipHash: hashValue(getRequestIp(req)),
  });

  return rawToken;
}

export async function exchangeSiteIdentityForSession(
  profileInput,
  req,
  _env = process.env,
  options = {},
) {
  const profile = normalizeAuthProfile(profileInput);
  if (!profile.provider || !profile.subject) {
    return { ok: false, error: "invalid_profile" };
  }

  const preferredUserId = Number(options.linkToUserId || 0) || null;

  const [existingIdentity] = await db
    .select()
    .from(siteIdentities)
    .where(
      and(
        eq(siteIdentities.provider, profile.provider),
        eq(siteIdentities.providerSubject, profile.subject),
      ),
    )
    .limit(1);

  let userId = existingIdentity?.userId || null;

  if (!userId && preferredUserId) {
    userId = preferredUserId;
  }

  if (!userId) {
    userId = await createSiteUser(profile);
  }

  await upsertIdentity(userId, profile);
  await touchUser(userId, profile);

  const user = await buildUserView(userId);
  if (!user) {
    return { ok: false, error: "user_not_available" };
  }

  const sessionToken = await issueSession(userId, req);
  return { ok: true, sessionToken, user };
}

export async function getSiteUserSessionFromRequest(req) {
  const sessionToken = readSessionToken(req, USER_COOKIE_NAME);
  if (!sessionToken) return null;

  const sessionHash = hashValue(sessionToken);
  const [session] = await db
    .select()
    .from(siteSessions)
    .where(and(eq(siteSessions.sessionHash, sessionHash), isNull(siteSessions.revokedAt)))
    .limit(1);

  if (!session || new Date(session.expiresAt).getTime() <= Date.now()) {
    return null;
  }

  await db
    .update(siteSessions)
    .set({ lastSeenAt: new Date() })
    .where(eq(siteSessions.id, session.id));

  const user = await buildUserView(session.userId);
  if (!user) return null;

  return {
    token: sessionToken,
    user,
    sessionId: session.id,
  };
}

export async function revokeSiteUserSession(req) {
  const sessionToken = readSessionToken(req, USER_COOKIE_NAME);
  if (!sessionToken) return false;

  const sessionHash = hashValue(sessionToken);
  await db
    .update(siteSessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(siteSessions.sessionHash, sessionHash), isNull(siteSessions.revokedAt)));

  return true;
}

export async function updateSiteUserProfile(userId, input = {}) {
  const displayName = String(input.displayName || "").trim().slice(0, 48);
  const avatarUrl = String(input.avatarUrl || "").trim().slice(0, 1000);
  const updates = {
    updatedAt: new Date(),
  };

  if (displayName) {
    updates.displayName = displayName;
  }

  if (avatarUrl === "" || /^https?:\/\//i.test(avatarUrl)) {
    updates.avatarUrl = avatarUrl || null;
  }

  await db.update(siteUsers).set(updates).where(eq(siteUsers.id, userId));
  return await buildUserView(userId);
}

export async function listSiteUsersByIds(userIds) {
  if (!Array.isArray(userIds) || userIds.length === 0) return [];

  const users = await db.select().from(siteUsers).where(inArray(siteUsers.id, userIds));
  return users.sort((left, right) => left.id - right.id);
}

export function getUserCookieName() {
  return USER_COOKIE_NAME;
}
