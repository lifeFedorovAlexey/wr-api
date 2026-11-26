import test from "node:test";
import assert from "node:assert/strict";

import { buildChampionHistoryAvailability } from "../lib/championHistoryAvailability.mjs";

test("champion history availability returns unique rank and lane pairs", () => {
  assert.deepEqual(
    buildChampionHistoryAvailability([
      { rank: "diamondPlus", lane: "jungle" },
      { rank: "diamondPlus", lane: "jungle" },
      { rank: "masterPlus", lane: "top" },
      { rank: null, lane: "mid" },
    ]),
    [
      { rank: "diamondPlus", lane: "jungle" },
      { rank: "masterPlus", lane: "top" },
    ],
  );
});
