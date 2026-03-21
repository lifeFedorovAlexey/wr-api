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

export const championStatsHistory = pgTable("champion_stats_history", {
  id: serial("id").primaryKey(),
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
});

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

export const championGuides = pgTable("champion_guides", {
  slug: text("slug").primaryKey(),
  name: text("name").notNull(),
  title: text("title"),
  icon: text("icon"),
  patch: text("patch"),
  tier: text("tier"),
  recommendedRole: text("recommended_role"),
  roles: jsonb("roles"),
  buildCount: integer("build_count").default(1).notNull(),
  sourceSite: text("source_site").notNull(),
  sourceUrl: text("source_url"),
  contentHash: text("content_hash"),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }),
  payload: jsonb("payload").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
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

export const guideEntities = pgTable("guide_entities", {
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
});

export const guideOfficialMeta = pgTable("guide_official_meta", {
  guideSlug: text("guide_slug").primaryKey(),
  championName: text("champion_name"),
  championTitle: text("champion_title"),
  roles: text("roles").array(),
  difficulty: text("difficulty"),
  heroRemoteVideoUrl: text("hero_remote_video_url"),
  heroLocalVideoPath: text("hero_local_video_path"),
});

export const guideAbilities = pgTable("guide_abilities", {
  id: serial("id").primaryKey(),
  guideSlug: text("guide_slug").notNull(),
  orderIndex: integer("order_index").notNull(),
  abilitySlug: text("ability_slug").notNull(),
  name: text("name").notNull(),
  subtitle: text("subtitle"),
  description: text("description"),
  iconUrl: text("icon_url"),
  videoUrl: text("video_url"),
});

export const guideBuildBreakdowns = pgTable("guide_build_breakdowns", {
  guideSlug: text("guide_slug").primaryKey(),
  featuredItemSlugs: text("featured_item_slugs").array(),
  paragraphs: text("paragraphs").array(),
});

export const guideVariants = pgTable("guide_variants", {
  id: serial("id").primaryKey(),
  guideSlug: text("guide_slug").notNull(),
  variantKey: text("variant_key").notNull(),
  title: text("title").notNull(),
  lane: text("lane"),
  tier: text("tier"),
  isDefault: boolean("is_default").default(false).notNull(),
  orderIndex: integer("order_index").notNull(),
});

export const guideVariantSections = pgTable("guide_variant_sections", {
  id: serial("id").primaryKey(),
  guideSlug: text("guide_slug").notNull(),
  variantKey: text("variant_key").notNull(),
  sectionType: text("section_type").notNull(),
  sectionKey: text("section_key").notNull(),
  label: text("label"),
  orderIndex: integer("order_index").notNull(),
  entitySlugs: text("entity_slugs").array(),
});

export const guideVariantSkillOrders = pgTable("guide_variant_skill_orders", {
  id: serial("id").primaryKey(),
  guideSlug: text("guide_slug").notNull(),
  variantKey: text("variant_key").notNull(),
  quickOrder: text("quick_order").array(),
});

export const guideVariantSkillRows = pgTable("guide_variant_skill_rows", {
  id: serial("id").primaryKey(),
  guideSlug: text("guide_slug").notNull(),
  variantKey: text("variant_key").notNull(),
  abilitySlug: text("ability_slug").notNull(),
  rowName: text("row_name").notNull(),
  orderIndex: integer("order_index").notNull(),
  levels: integer("levels").array(),
});

export const guideVariantMatchups = pgTable("guide_variant_matchups", {
  id: serial("id").primaryKey(),
  guideSlug: text("guide_slug").notNull(),
  variantKey: text("variant_key").notNull(),
  matchupType: text("matchup_type").notNull(),
  championSlug: text("champion_slug").notNull(),
  orderIndex: integer("order_index").notNull(),
});
