// db/schema.js
import { pgTable, text, jsonb } from "drizzle-orm/pg-core";

export const champions = pgTable("champions", {
  slug: text("slug").primaryKey(), // Главный ключ (уникален)
  cnHeroId: text("cn_hero_id"), // Из CN, может быть null

  // Локализованные имена (в формате словаря)
  nameLocalizations: jsonb("name_localizations"),

  // Имя, выбранное по ?lang= (хранить не обязательно)
  name: text("name"),

  // Роли (ключи, например ["mage","assassin"])
  roles: jsonb("roles"),

  // Локализации ролей: { ru_ru: ["Маг"], en_us: ["Mage"], zh_cn: ["法师"] }
  rolesLocalizations: jsonb("roles_localizations"),

  // Сложность (ключ: "easy" | "medium" | "hard")
  difficulty: text("difficulty"),

  // Локализации сложности: { ru_ru: "Лёгкая", en_us: "Easy", zh_cn: "简单" }
  difficultyLocalizations: jsonb("difficulty_localizations"),

  // baseImgUrl / icon
  icon: text("icon"),
});
