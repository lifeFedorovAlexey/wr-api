// db/schema.js
import {
  boolean,
  pgTable,
  text,
  jsonb,
  date as pgDate,
  integer,
  doublePrecision,
  timestamp,
  serial,
  bigint,
  uniqueIndex,
  index,
  primaryKey,
} from "drizzle-orm/pg-core";

export const champions = pgTable("champions", {
  slug: text("slug").primaryKey(),
  cnHeroId: text("cn_hero_id"),
  nameLocalizations: jsonb("name_localizations"),
  name: text("name"),
  roles: jsonb("roles"),
  rolesLocalizations: jsonb("roles_localizations"),
  difficulty: text("difficulty"),
  difficultyLocalizations: jsonb("difficulty_localizations"),
  icon: text("icon"),
});

export const championStatsHistory = pgTable(
  "champion_stats_history",
  {
    id: serial("id").primaryKey(),
    snapshotId: integer("snapshot_id"),
    date: pgDate("date").notNull(),
    slug: text("slug").notNull(),
    cnHeroId: text("cn_hero_id").notNull(),
    rank: text("rank").notNull(), // overall / diamondPlus / masterPlus / king / peak
    lane: text("lane").notNull(), // mid / top / adc / support / jungle
    position: integer("position"),
    winRate: doublePrecision("win_rate"),
    pickRate: doublePrecision("pick_rate"),
    banRate: doublePrecision("ban_rate"),
    strengthLevel: integer("strength_level"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    snapshotSlugRankLaneUidx: uniqueIndex(
      "champion_stats_history_snapshot_slug_rank_lane_uidx",
    ).on(
      table.snapshotId,
      table.slug,
      table.rank,
      table.lane,
    ),
    dateIdx: index("champion_stats_history_date_idx").on(table.date),
    snapshotIdx: index("champion_stats_history_snapshot_idx").on(table.snapshotId),
    rankLaneDateIdx: index("champion_stats_history_rank_lane_date_idx").on(
      table.rank,
      table.lane,
      table.date,
    ),
    slugDateIdx: index("champion_stats_history_slug_date_idx").on(table.slug, table.date),
  }),
);

// 👇 новая таблица логов открытий WebApp
export const webappOpens = pgTable("webapp_opens", {
  id: serial("id").primaryKey(),

  tgId: bigint("tg_id", { mode: "number" }).notNull(),
  username: text("username"),
  firstName: text("first_name"),
  lastName: text("last_name"),

  openedAt: timestamp("opened_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const guideSummaries = pgTable("guide_summaries", {
  slug: text("slug").primaryKey(),
  name: text("name").notNull(),
  title: text("title"),
  icon: text("icon"),
  patch: text("patch"),
  tier: text("tier"),
  recommendedRole: text("recommended_role"),
  roles: text("roles").array(),
  buildCount: integer("build_count").default(1).notNull(),
  sourceSite: text("source_site").notNull(),
  sourceUrl: text("source_url"),
  contentHash: text("content_hash"),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const guideEntities = pgTable(
  "guide_entities",
  {
    id: serial("id").primaryKey(),
    kind: text("kind").notNull(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    imageUrl: text("image_url"),
    lane: text("lane"),
    entityId: integer("entity_id"),
    entityKind: text("entity_kind"),
    videoUrl: text("video_url"),
    tooltipTitle: text("tooltip_title"),
    tooltipCost: text("tooltip_cost"),
    tooltipImageUrl: text("tooltip_image_url"),
    tooltipStats: text("tooltip_stats").array(),
    tooltipLines: text("tooltip_lines").array(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    kindSlugUidx: uniqueIndex("guide_entities_kind_slug_uidx").on(table.kind, table.slug),
    slugIdx: index("guide_entities_slug_idx").on(table.slug),
  }),
);

export const guideOfficialMeta = pgTable("guide_official_meta", {
  guideSlug: text("guide_slug").primaryKey(),
  championName: text("champion_name"),
  championTitle: text("champion_title"),
  roles: text("roles").array(),
  difficulty: text("difficulty"),
  heroRemoteVideoUrl: text("hero_remote_video_url"),
  heroLocalVideoPath: text("hero_local_video_path"),
});

export const guideAbilities = pgTable(
  "guide_abilities",
  {
    id: serial("id").primaryKey(),
    guideSlug: text("guide_slug").notNull(),
    orderIndex: integer("order_index").notNull(),
    abilitySlug: text("ability_slug").notNull(),
    name: text("name").notNull(),
    subtitle: text("subtitle"),
    description: text("description"),
    iconUrl: text("icon_url"),
    videoUrl: text("video_url"),
  },
  (table) => ({
    guideOrderIdx: index("guide_abilities_guide_order_idx").on(table.guideSlug, table.orderIndex),
  }),
);

export const guideBuildBreakdowns = pgTable("guide_build_breakdowns", {
  guideSlug: text("guide_slug").primaryKey(),
  featuredItemSlugs: text("featured_item_slugs").array(),
  paragraphs: text("paragraphs").array(),
});

export const guideVariants = pgTable(
  "guide_variants",
  {
    id: serial("id").primaryKey(),
    guideSlug: text("guide_slug").notNull(),
    variantKey: text("variant_key").notNull(),
    title: text("title").notNull(),
    lane: text("lane"),
    tier: text("tier"),
    isDefault: boolean("is_default").default(false).notNull(),
    orderIndex: integer("order_index").notNull(),
  },
  (table) => ({
    slugKeyUidx: uniqueIndex("guide_variants_slug_key_uidx").on(table.guideSlug, table.variantKey),
    slugOrderIdx: index("guide_variants_slug_order_idx").on(table.guideSlug, table.orderIndex),
  }),
);

export const guideVariantSections = pgTable(
  "guide_variant_sections",
  {
    id: serial("id").primaryKey(),
    guideSlug: text("guide_slug").notNull(),
    variantKey: text("variant_key").notNull(),
    sectionType: text("section_type").notNull(),
    sectionKey: text("section_key").notNull(),
    label: text("label"),
    orderIndex: integer("order_index").notNull(),
    entitySlugs: text("entity_slugs").array(),
  },
  (table) => ({
    slugVariantTypeIdx: index("guide_sections_slug_variant_idx").on(
      table.guideSlug,
      table.variantKey,
      table.sectionType,
    ),
  }),
);

export const guideVariantSkillOrders = pgTable(
  "guide_variant_skill_orders",
  {
    id: serial("id").primaryKey(),
    guideSlug: text("guide_slug").notNull(),
    variantKey: text("variant_key").notNull(),
    quickOrder: text("quick_order").array(),
  },
  (table) => ({
    slugVariantUidx: uniqueIndex("guide_skill_orders_slug_variant_uidx").on(
      table.guideSlug,
      table.variantKey,
    ),
  }),
);

export const guideVariantSkillRows = pgTable(
  "guide_variant_skill_rows",
  {
    id: serial("id").primaryKey(),
    guideSlug: text("guide_slug").notNull(),
    variantKey: text("variant_key").notNull(),
    abilitySlug: text("ability_slug").notNull(),
    rowName: text("row_name").notNull(),
    orderIndex: integer("order_index").notNull(),
    levels: integer("levels").array(),
  },
  (table) => ({
    slugVariantIdx: index("guide_skill_rows_slug_variant_idx").on(
      table.guideSlug,
      table.variantKey,
    ),
  }),
);

export const guideVariantMatchups = pgTable(
  "guide_variant_matchups",
  {
    id: serial("id").primaryKey(),
    guideSlug: text("guide_slug").notNull(),
    variantKey: text("variant_key").notNull(),
    matchupType: text("matchup_type").notNull(),
    championSlug: text("champion_slug").notNull(),
    orderIndex: integer("order_index").notNull(),
  },
  (table) => ({
    slugVariantTypeIdx: index("guide_matchups_slug_variant_idx").on(
      table.guideSlug,
      table.variantKey,
      table.matchupType,
    ),
  }),
);

export const riftggCnDictionaries = pgTable(
  "riftgg_cn_dictionaries",
  {
    id: serial("id").primaryKey(),
    kind: text("kind").notNull(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    rawPayload: jsonb("raw_payload").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    kindSlugUidx: uniqueIndex("riftgg_cn_dictionaries_kind_slug_uidx").on(
      table.kind,
      table.slug,
    ),
    kindIdx: index("riftgg_cn_dictionaries_kind_idx").on(table.kind),
  }),
);

export const riftggCnMatchups = pgTable(
  "riftgg_cn_matchups",
  {
    id: serial("id").primaryKey(),
    championSlug: text("champion_slug").notNull(),
    rank: text("rank").notNull(),
    lane: text("lane").notNull(),
    dataDate: pgDate("data_date"),
    opponentSlug: text("opponent_slug").notNull(),
    winRate: doublePrecision("win_rate"),
    pickRate: doublePrecision("pick_rate"),
    winRateRank: integer("win_rate_rank"),
    pickRateRank: integer("pick_rate_rank"),
    rawPayload: jsonb("raw_payload").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    championFilterIdx: index("riftgg_cn_matchups_champion_filter_idx").on(
      table.championSlug,
      table.rank,
      table.lane,
    ),
    championOpponentUidx: uniqueIndex("riftgg_cn_matchups_champion_opponent_uidx").on(
      table.championSlug,
      table.rank,
      table.lane,
      table.dataDate,
      table.opponentSlug,
    ),
  }),
);

export const riftggCnBuilds = pgTable(
  "riftgg_cn_builds",
  {
    id: serial("id").primaryKey(),
    championSlug: text("champion_slug").notNull(),
    rank: text("rank").notNull(),
    lane: text("lane").notNull(),
    dataDate: pgDate("data_date"),
    buildType: text("build_type").notNull(),
    buildKey: text("build_key").notNull(),
    entrySlugs: text("entry_slugs").array().notNull(),
    winRate: doublePrecision("win_rate"),
    pickRate: doublePrecision("pick_rate"),
    winRateRank: integer("win_rate_rank"),
    pickRateRank: integer("pick_rate_rank"),
    rawPayload: jsonb("raw_payload").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    championTypeIdx: index("riftgg_cn_builds_champion_type_idx").on(
      table.championSlug,
      table.buildType,
      table.rank,
      table.lane,
    ),
    championBuildUidx: uniqueIndex("riftgg_cn_builds_champion_build_uidx").on(
      table.championSlug,
      table.rank,
      table.lane,
      table.dataDate,
      table.buildType,
      table.buildKey,
    ),
  }),
);

export const newsArticles = pgTable(
  "news_articles",
  {
    id: serial("id").primaryKey(),
    sourceUrl: text("source_url").notNull(),
    normalizedUrl: text("normalized_url"),
    title: text("title"),
    description: text("description"),
    category: text("category"),
    locale: text("locale"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    contentId: text("content_id"),
    bodyText: text("body_text"),
    rawPayload: jsonb("raw_payload").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    sourceUrlUidx: uniqueIndex("news_articles_source_url_uidx").on(table.sourceUrl),
    publishedAtIdx: index("news_articles_published_at_idx").on(table.publishedAt),
    categoryIdx: index("news_articles_category_idx").on(table.category),
  }),
);

export const championEvents = pgTable(
  "champion_events",
  {
    id: serial("id").primaryKey(),
    articleId: integer("article_id").notNull(),
    eventDate: pgDate("event_date").notNull(),
    championSlug: text("champion_slug").notNull(),
    eventType: text("event_type").notNull(),
    scope: text("scope").notNull(),
    abilityName: text("ability_name"),
    skinName: text("skin_name"),
    title: text("title"),
    summary: text("summary"),
    details: jsonb("details").notNull(),
    confidence: doublePrecision("confidence"),
    sourceMethod: text("source_method").notNull(),
    dedupeKey: text("dedupe_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    dedupeKeyUidx: uniqueIndex("champion_events_dedupe_key_uidx").on(table.dedupeKey),
    articleIdIdx: index("champion_events_article_id_idx").on(table.articleId),
    championDateIdx: index("champion_events_champion_date_idx").on(
      table.championSlug,
      table.eventDate,
    ),
    typeIdx: index("champion_events_event_type_idx").on(table.eventType),
  }),
);

export const adminUsers = pgTable(
  "admin_users",
  {
    id: serial("id").primaryKey(),
    displayName: text("display_name"),
    primaryEmail: text("primary_email"),
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  },
  (table) => ({
    primaryEmailIdx: uniqueIndex("admin_users_primary_email_uidx").on(table.primaryEmail),
    statusIdx: index("admin_users_status_idx").on(table.status),
  }),
);

export const adminIdentities = pgTable(
  "admin_identities",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull(),
    provider: text("provider").notNull(),
    providerSubject: text("provider_subject").notNull(),
    providerEmail: text("provider_email"),
    providerUsername: text("provider_username"),
    profile: jsonb("profile").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  },
  (table) => ({
    providerSubjectUidx: uniqueIndex("admin_identities_provider_subject_uidx").on(
      table.provider,
      table.providerSubject,
    ),
    userIdx: index("admin_identities_user_idx").on(table.userId),
    providerEmailIdx: index("admin_identities_provider_email_idx").on(table.providerEmail),
  }),
);

export const adminRoles = pgTable("admin_roles", {
  key: text("key").primaryKey(),
  label: text("label").notNull(),
  description: text("description"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const adminUserRoles = pgTable(
  "admin_user_roles",
  {
    userId: integer("user_id").notNull(),
    roleKey: text("role_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.userId, table.roleKey], name: "admin_user_roles_pk" }),
    userIdx: index("admin_user_roles_user_idx").on(table.userId),
    roleIdx: index("admin_user_roles_role_idx").on(table.roleKey),
  }),
);

export const adminSessions = pgTable(
  "admin_sessions",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull(),
    sessionHash: text("session_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    userAgent: text("user_agent"),
    ipHash: text("ip_hash"),
  },
  (table) => ({
    sessionHashUidx: uniqueIndex("admin_sessions_session_hash_uidx").on(table.sessionHash),
    userIdx: index("admin_sessions_user_idx").on(table.userId),
    expiresIdx: index("admin_sessions_expires_idx").on(table.expiresAt),
  }),
);

export const siteUsers = pgTable(
  "site_users",
  {
    id: serial("id").primaryKey(),
    displayName: text("display_name"),
    avatarUrl: text("avatar_url"),
    wildRiftHandle: text("wild_rift_handle"),
    peakRank: text("peak_rank"),
    mainChampionSlugs: text("main_champion_slugs").array().notNull().default([]),
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  },
  (table) => ({
    statusIdx: index("site_users_status_idx").on(table.status),
  }),
);

export const siteIdentities = pgTable(
  "site_identities",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull(),
    provider: text("provider").notNull(),
    providerSubject: text("provider_subject").notNull(),
    providerEmail: text("provider_email"),
    providerUsername: text("provider_username"),
    profile: jsonb("profile").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  },
  (table) => ({
    providerSubjectUidx: uniqueIndex("site_identities_provider_subject_uidx").on(
      table.provider,
      table.providerSubject,
    ),
    userIdx: index("site_identities_user_idx").on(table.userId),
    providerEmailIdx: index("site_identities_provider_email_idx").on(table.providerEmail),
  }),
);

export const siteSessions = pgTable(
  "site_sessions",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull(),
    sessionHash: text("session_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    userAgent: text("user_agent"),
    ipHash: text("ip_hash"),
  },
  (table) => ({
    sessionHashUidx: uniqueIndex("site_sessions_session_hash_uidx").on(table.sessionHash),
    userIdx: index("site_sessions_user_idx").on(table.userId),
    expiresIdx: index("site_sessions_expires_idx").on(table.expiresAt),
  }),
);

export const championStatsSnapshots = pgTable(
  "champion_stats_snapshots",
  {
    id: serial("id").primaryKey(),
    source: text("source").notNull(),
    statsDate: pgDate("stats_date").notNull(),
    status: text("status").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    championCount: integer("champion_count"),
    matchedChampionCount: integer("matched_champion_count"),
    rowCount: integer("row_count"),
    missingChampionCount: integer("missing_champion_count"),
    metadata: jsonb("metadata"),
  },
  (table) => ({
    sourceDateIdx: index("champion_stats_snapshots_source_date_idx").on(
      table.source,
      table.statsDate,
    ),
    sourceStatusDateIdx: index("champion_stats_snapshots_source_status_date_idx").on(
      table.source,
      table.status,
      table.statsDate,
    ),
  }),
);
export const chatGroups = pgTable(
  "chat_groups",
  {
    id: serial("id").primaryKey(),
    ownerUserId: integer("owner_user_id").notNull(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    isPrivate: boolean("is_private").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    ownerIdx: index("chat_groups_owner_idx").on(table.ownerUserId),
    slugUidx: uniqueIndex("chat_groups_slug_uidx").on(table.slug),
  }),
);

export const chatGroupMembers = pgTable(
  "chat_group_members",
  {
    groupId: integer("group_id").notNull(),
    userId: integer("user_id").notNull(),
    role: text("role").notNull().default("member"),
    joinedAt: timestamp("joined_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.groupId, table.userId], name: "chat_group_members_pk" }),
    userIdx: index("chat_group_members_user_idx").on(table.userId),
    roleIdx: index("chat_group_members_role_idx").on(table.role),
  }),
);

export const chatGroupInvites = pgTable(
  "chat_group_invites",
  {
    id: serial("id").primaryKey(),
    groupId: integer("group_id").notNull(),
    inviterUserId: integer("inviter_user_id").notNull(),
    inviteeUserId: integer("invitee_user_id").notNull(),
    status: text("status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    respondedAt: timestamp("responded_at", { withTimezone: true }),
  },
  (table) => ({
    groupInviteeIdx: index("chat_group_invites_group_invitee_idx").on(
      table.groupId,
      table.inviteeUserId,
    ),
    statusIdx: index("chat_group_invites_status_idx").on(table.status),
  }),
);

export const chatGroupBans = pgTable(
  "chat_group_bans",
  {
    groupId: integer("group_id").notNull(),
    userId: integer("user_id").notNull(),
    bannedByUserId: integer("banned_by_user_id").notNull(),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.groupId, table.userId], name: "chat_group_bans_pk" }),
    userIdx: index("chat_group_bans_user_idx").on(table.userId),
    bannedByIdx: index("chat_group_bans_banned_by_idx").on(table.bannedByUserId),
  }),
);

export const chatChannels = pgTable(
  "chat_channels",
  {
    id: serial("id").primaryKey(),
    groupId: integer("group_id").notNull(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    kind: text("kind").notNull().default("text"),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    groupSlugUidx: uniqueIndex("chat_channels_group_slug_uidx").on(table.groupId, table.slug),
    groupPositionIdx: index("chat_channels_group_position_idx").on(table.groupId, table.position),
  }),
);

export const chatMessages = pgTable(
  "chat_messages",
  {
    id: serial("id").primaryKey(),
    channelId: integer("channel_id").notNull(),
    authorUserId: integer("author_user_id").notNull(),
    body: text("body").notNull(),
    editedAt: timestamp("edited_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    channelCreatedIdx: index("chat_messages_channel_created_idx").on(
      table.channelId,
      table.createdAt,
    ),
    authorIdx: index("chat_messages_author_idx").on(table.authorUserId),
  }),
);

export const chatChannelReads = pgTable(
  "chat_channel_reads",
  {
    channelId: integer("channel_id").notNull(),
    userId: integer("user_id").notNull(),
    lastReadMessageId: integer("last_read_message_id"),
    lastReadAt: timestamp("last_read_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.channelId, table.userId], name: "chat_channel_reads_pk" }),
    userIdx: index("chat_channel_reads_user_idx").on(table.userId),
  }),
);
