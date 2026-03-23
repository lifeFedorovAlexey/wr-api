import "dotenv/config";

import { client } from "../db/client.js";

async function main() {
  await client`
    create table if not exists news_articles (
      id serial primary key,
      source_url text not null,
      normalized_url text,
      title text,
      description text,
      category text,
      locale text,
      published_at timestamptz,
      content_id text,
      body_text text,
      raw_payload jsonb not null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
  `;

  await client`
    create table if not exists champion_events (
      id serial primary key,
      article_id integer not null,
      event_date date not null,
      champion_slug text not null,
      event_type text not null,
      scope text not null,
      ability_name text,
      skin_name text,
      title text,
      summary text,
      details jsonb not null,
      confidence double precision,
      source_method text not null,
      dedupe_key text not null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
  `;

  await client`
    create unique index if not exists news_articles_source_url_uidx
    on news_articles (source_url);
  `;

  await client`
    create index if not exists news_articles_published_at_idx
    on news_articles (published_at);
  `;

  await client`
    create index if not exists news_articles_category_idx
    on news_articles (category);
  `;

  await client`
    create unique index if not exists champion_events_dedupe_key_uidx
    on champion_events (dedupe_key);
  `;

  await client`
    create index if not exists champion_events_article_id_idx
    on champion_events (article_id);
  `;

  await client`
    create index if not exists champion_events_champion_date_idx
    on champion_events (champion_slug, event_date);
  `;

  await client`
    create index if not exists champion_events_event_type_idx
    on champion_events (event_type);
  `;

  console.log("news tables are ready");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await client.end({ timeout: 5 });
  });
