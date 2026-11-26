import { randomBytes } from "node:crypto";
import { and, eq, inArray, isNull } from "drizzle-orm";
import sharp from "sharp";
import { db } from "../db/client.js";
import {
  adminIdentities,
  adminUserRoles,
  siteIdentities,
  siteSessions,
  siteUsers,
} from "../db/schema.js";
import {
  createSignedEnvelope,
  getRequestIp,
  hashValue,
  normalizeNamedSecret,
  normalizeAuthProfile,
  readSessionToken,
  verifySignedEnvelope,
} from "./sessionAuthShared.mjs";
import { createObjectStorageClient, getObjectStorageConfig } from "./objectStorage.mjs";

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14;
const EXCHANGE_TTL_MS = 1000 * 60;
const USER_COOKIE_NAME = "wr_user_session";
const WILD_RIFT_GAME_NAME_RE = /^[\p{L}\p{N}](?:[\p{L}\p{N} ._'-]{1,22}[\p{L}\p{N}])?$/u;
const WILD_RIFT_TAG_RE = /^[\p{L}\p{N}]{3,5}$/u;
const MAX_MAIN_CHAMPIONS = 3;
const PEAK_RANK_OPTIONS = [
  "iron",
  "bronze",
  "silver",
  "gold",
  "platinum",
  "emerald",
  "diamond",
  "master",
  "grandmaster",
  "challenger",
  "sovereign",
];
const PEAK_RANK_SET = new Set(PEAK_RANK_OPTIONS);
const USER_AVATAR_UPLOAD_PREFIX = "avatars/site-users";
const USER_AVATAR_OUTPUT_SIZE = 512;
const USER_AVATAR_MAX_SOURCE_BYTES = 5 * 1024 * 1024;
const USER_AVATAR_CACHE_CONTROL = "public, max-age=31536000, immutable";

export function mergeSiteAndAdminRoles(adminRoles = []) {
  const normalizedAdminRoles = Array.isArray(adminRoles)
    ? adminRoles.map((role) => String(role || "").trim()).filter(Boolean)
    : [];

  return ["user", ...Array.from(new Set(normalizedAdminRoles)).sort()];
}

export function normalizeUserSessionSecret(env = process.env) {
  return normalizeNamedSecret(env, "USER_SESSION_SECRET");
}

export function createSignedUserExchangeEnvelope(payload, env = process.env) {
  return createSignedEnvelope(payload, {
    secret: normalizeUserSessionSecret(env),
    missingSecretError: "missing_user_session_secret",
  });
}

export function verifySignedUserExchangeEnvelope(payload, signature, env = process.env) {
  return verifySignedEnvelope(payload, signature, {
    secret: normalizeUserSessionSecret(env),
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

export function normalizeWildRiftHandle(value) {
  const normalized = String(value || "").trim();
  if (!normalized) return "";

  const parts = normalized.split("#");
  if (parts.length !== 2) return null;

  const [gameName, tag] = parts;
  if (!WILD_RIFT_GAME_NAME_RE.test(gameName) || !WILD_RIFT_TAG_RE.test(tag)) {
    return null;
  }

  return `${gameName}#${tag.toUpperCase()}`;
}

function normalizePeakRank(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return "";
  return PEAK_RANK_SET.has(normalized) ? normalized : null;
}

function normalizeMainChampionSlugs(input) {
  const source = Array.isArray(input) ? input : [input];
  return Array.from(
    new Set(
      source
        .map((slug) => String(slug || "").trim().toLowerCase())
        .filter(Boolean),
    ),
  ).slice(0, MAX_MAIN_CHAMPIONS);
}

function collectAllowedAvatarUrls(identities = []) {
  return new Set(
    (Array.isArray(identities) ? identities : [])
      .map((identity) => String(identity?.avatarUrl || identity?.profile?.avatarUrl || "").trim())
      .filter(Boolean),
  );
}

function buildTrustedUploadedAvatarPrefix(userId, env = process.env) {
  const publicBaseUrl = String(getObjectStorageConfig(env).publicBaseUrl || "").trim().replace(/\/+$/, "");
  if (!publicBaseUrl) return "";
  return `${publicBaseUrl}/${USER_AVATAR_UPLOAD_PREFIX}/${userId}/`;
}

function isTrustedUploadedAvatarUrl(userId, avatarUrl, env = process.env) {
  const normalizedAvatarUrl = String(avatarUrl || "").trim();
  if (!normalizedAvatarUrl) return false;
  const trustedPrefix = buildTrustedUploadedAvatarPrefix(userId, env);
  return Boolean(trustedPrefix) && normalizedAvatarUrl.startsWith(trustedPrefix);
}

function decodeAvatarUploadInput(imageBase64) {
  const normalized = String(imageBase64 || "").trim();
  const match = normalized.match(/^data:image\/(?:png|jpeg|jpg|webp);base64,([A-Za-z0-9+/=\s]+)$/i);
  if (!match?.[1]) {
    throw new Error("invalid_avatar_image");
  }

  const buffer = Buffer.from(match[1].replace(/\s+/g, ""), "base64");
  if (!buffer.length || buffer.length > USER_AVATAR_MAX_SOURCE_BYTES) {
    throw new Error("avatar_too_large");
  }

  return buffer;
}

function profileFromIdentity(identity = {}) {
  return normalizeAuthProfile({
    provider: identity.provider,
    subject: identity.providerSubject,
    email: identity.providerEmail || identity.profile?.email || "",
    name: identity.profile?.name || "",
    username: identity.providerUsername || identity.profile?.username || "",
    avatarUrl: identity.profile?.avatarUrl || "",
  });
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

  const identityKeys = identities
    .map((identity) => ({
      provider: String(identity.provider || "").trim(),
      subject: String(identity.providerSubject || "").trim(),
    }))
    .filter((identity) => identity.provider && identity.subject);

  let roles = ["user"];

  if (identityKeys.length) {
    const candidateAdminIdentities = await db
      .select({
        userId: adminIdentities.userId,
        provider: adminIdentities.provider,
        providerSubject: adminIdentities.providerSubject,
      })
      .from(adminIdentities)
      .where(
        and(
          inArray(
            adminIdentities.provider,
            Array.from(new Set(identityKeys.map((identity) => identity.provider))),
          ),
          inArray(
            adminIdentities.providerSubject,
            Array.from(new Set(identityKeys.map((identity) => identity.subject))),
          ),
        ),
      );

    const identityKeySet = new Set(
      identityKeys.map((identity) => `${identity.provider}:${identity.subject}`),
    );

    const matchedAdminUserIds = Array.from(
      new Set(
        candidateAdminIdentities
          .filter((identity) =>
            identityKeySet.has(
              `${String(identity.provider || "").trim()}:${String(identity.providerSubject || "").trim()}`,
            ),
          )
          .map((identity) => identity.userId)
          .filter(Boolean),
      ),
    );

    if (matchedAdminUserIds.length) {
      const adminRoleRows = await db
        .select({ roleKey: adminUserRoles.roleKey })
        .from(adminUserRoles)
        .where(inArray(adminUserRoles.userId, matchedAdminUserIds));

      roles = mergeSiteAndAdminRoles(adminRoleRows.map((row) => row.roleKey));
    }
  }

  return {
    id: user.id,
    displayName: user.displayName || "",
    avatarUrl: user.avatarUrl || "",
    wildRiftHandle: user.wildRiftHandle || "",
    peakRank: user.peakRank || "",
    mainChampionSlugs: Array.isArray(user.mainChampionSlugs) ? user.mainChampionSlugs : [],
    status: user.status,
    role: "user",
    roles,
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
      wildRiftHandle: null,
      peakRank: null,
      mainChampionSlugs: [],
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

export async function updateSiteUserProfile(userId, input = {}, options = {}) {
  const displayName = String(input.displayName || "").trim().slice(0, 48);
  const avatarUrl = String(input.avatarUrl || "").trim().slice(0, 1000);
  const wildRiftHandle = normalizeWildRiftHandle(input.wildRiftHandle);
  const peakRank = normalizePeakRank(input.peakRank);
  const mainChampionSlugs = normalizeMainChampionSlugs(input.mainChampionSlugs);
  const allowedAvatarUrls = collectAllowedAvatarUrls(options.identities);
  const updates = {
    updatedAt: new Date(),
  };

  if (displayName) {
    updates.displayName = displayName;
  }

  if (
    avatarUrl === "" ||
    allowedAvatarUrls.has(avatarUrl) ||
    isTrustedUploadedAvatarUrl(userId, avatarUrl, options.env || process.env)
  ) {
    updates.avatarUrl = avatarUrl || null;
  } else if (avatarUrl) {
    throw new Error("invalid_avatar_url");
  }

  if (wildRiftHandle === null) {
    throw new Error("invalid_wild_rift_handle");
  }

  if (peakRank === null) {
    throw new Error("invalid_peak_rank");
  }

  updates.wildRiftHandle = wildRiftHandle || null;
  updates.peakRank = peakRank || null;
  updates.mainChampionSlugs = mainChampionSlugs;

  await db.update(siteUsers).set(updates).where(eq(siteUsers.id, userId));
  return await buildUserView(userId);
}

export async function uploadSiteUserAvatar(userId, imageBase64, { env = process.env } = {}) {
  const normalizedUserId = Number(userId || 0);
  if (!Number.isInteger(normalizedUserId) || normalizedUserId <= 0) {
    throw new Error("invalid_site_user");
  }

  const storage = createObjectStorageClient(env);
  if (!storage?.config?.publicBaseUrl) {
    throw new Error("avatar_storage_unavailable");
  }

  const sourceBuffer = decodeAvatarUploadInput(imageBase64);

  let outputBuffer;
  try {
    outputBuffer = await sharp(sourceBuffer)
      .rotate()
      .resize(USER_AVATAR_OUTPUT_SIZE, USER_AVATAR_OUTPUT_SIZE, {
        fit: "cover",
        position: "attention",
      })
      .webp({ quality: 92 })
      .toBuffer();
  } catch {
    throw new Error("invalid_avatar_image");
  }

  const objectKey = `${USER_AVATAR_UPLOAD_PREFIX}/${normalizedUserId}/${Date.now()}-${randomBytes(6).toString("hex")}.webp`;
  const publicUrl = await storage.uploadBuffer(
    outputBuffer,
    objectKey,
    "image/webp",
    USER_AVATAR_CACHE_CONTROL,
  );

  return {
    avatarUrl: String(publicUrl || "").trim(),
    objectKey,
  };
}

export async function resolveSiteUserViewForAdminUser(adminUserId) {
  const identities = await db
    .select({
      provider: adminIdentities.provider,
      providerSubject: adminIdentities.providerSubject,
      providerEmail: adminIdentities.providerEmail,
      providerUsername: adminIdentities.providerUsername,
      profile: adminIdentities.profile,
    })
    .from(adminIdentities)
    .where(eq(adminIdentities.userId, adminUserId));

  if (!identities.length) {
    return null;
  }

  const identityKeys = identities
    .map((identity) => ({
      provider: String(identity.provider || "").trim(),
      subject: String(identity.providerSubject || "").trim(),
    }))
    .filter((identity) => identity.provider && identity.subject);

  let userId = null;

  if (identityKeys.length) {
    const candidateSiteIdentities = await db
      .select({
        userId: siteIdentities.userId,
        provider: siteIdentities.provider,
        providerSubject: siteIdentities.providerSubject,
      })
      .from(siteIdentities)
      .where(
        and(
          inArray(
            siteIdentities.provider,
            Array.from(new Set(identityKeys.map((identity) => identity.provider))),
          ),
          inArray(
            siteIdentities.providerSubject,
            Array.from(new Set(identityKeys.map((identity) => identity.subject))),
          ),
        ),
      );

    const identityKeySet = new Set(
      identityKeys.map((identity) => `${identity.provider}:${identity.subject}`),
    );

    userId =
      candidateSiteIdentities.find((identity) =>
        identityKeySet.has(
          `${String(identity.provider || "").trim()}:${String(identity.providerSubject || "").trim()}`,
        ),
      )?.userId || null;
  }

  const preferredProfile = profileFromIdentity(identities[0]);

  if (!userId) {
    userId = await createSiteUser(preferredProfile);
  }

  for (const identity of identities) {
    const profile = profileFromIdentity(identity);
    if (!profile.provider || !profile.subject) continue;
    await upsertIdentity(userId, profile);
  }

  await touchUser(userId, preferredProfile);
  return await buildUserView(userId);
}

export async function updateSiteProfileForAdminUser(adminUserId, input = {}) {
  const profile = await resolveSiteUserViewForAdminUser(adminUserId);
  if (!profile) {
    return null;
  }

  return await updateSiteUserProfile(profile.id, input, {
    identities: profile.identities,
  });
}

export async function listSiteUsersByIds(userIds) {
  if (!Array.isArray(userIds) || userIds.length === 0) return [];

  const users = await db.select().from(siteUsers).where(inArray(siteUsers.id, userIds));
  return users.sort((left, right) => left.id - right.id);
}

export function getUserCookieName() {
  return USER_COOKIE_NAME;
}
