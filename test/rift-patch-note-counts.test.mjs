import assert from "node:assert/strict";
import test from "node:test";

import { parseRiftPatchNotesCounts } from "../lib/riftPatchNotesCounts.mjs";

test("reads champion buff, nerf, and other counts from patch index cards", () => {
  const rows = parseRiftPatchNotesCounts(`
    <a href="/patch/wild-rift-patch-notes-7-3b"><h2>7.3b</h2></a>
    <a href="/patch/wild-rift-patch-notes-7-3b">
      <h2>7.3b</h2><span>8 champions</span>
      <span class="text-buff"><span class="dot"></span>3<span class="sr-only"> buffs</span></span>
      <span class="text-nerf"><span class="dot"></span>4<span class="sr-only"> nerfs</span></span>
      <span class="text-adjust"><span class="dot"></span>1<span class="sr-only"> other change</span></span>
    </a>
    <a href="/patch/wild-rift-patch-notes-0-0-beta">
      <h2>0.0-beta</h2><span>21 champions</span>
      <span class="text-buff"><span class="dot"></span>10</span>
      <span class="text-nerf"><span class="dot"></span>9</span>
      <span class="text-adjust"><span class="dot"></span>2</span>
    </a>
  `);

  assert.deepEqual(rows, [
    {
      patchVersion: "7.3b",
      totalChampions: 8,
      hasExplicitChampionTotal: true,
      counts: { buff: 3, nerf: 4, other: 1 },
    },
    {
      patchVersion: "0.0-beta",
      totalChampions: 21,
      hasExplicitChampionTotal: true,
      counts: { buff: 10, nerf: 9, other: 2 },
    },
  ]);
});
