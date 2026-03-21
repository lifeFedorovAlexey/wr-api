// db/schema.js
import {
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
