import "dotenv/config";

import { client } from "../db/client.js";

async function main() {
  await client`
    create unique index if not exists champion_stats_history_date_slug_rank_lane_uidx
    on champion_stats_history (date, slug, rank, lane);
  `;

  await client`
    create index if not exists champion_stats_history_date_idx
    on champion_stats_history (date);
  `;

  await client`
    create index if not exists champion_stats_history_rank_lane_date_idx
    on champion_stats_history (rank, lane, date);
  `;

  await client`
    create index if not exists champion_stats_history_slug_date_idx
    on champion_stats_history (slug, date);
  `;

  console.log("stats table indexes are ready");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await client.end({ timeout: 5 });
  });
