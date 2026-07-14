import test from "node:test";
import assert from "node:assert/strict";
import { extractChampionMechanics } from "../lib/riotChampionMechanics.mjs";

test("extractChampionMechanics reads official Next champion ability groups", () => {
  const data = { props: { pageProps: { page: { title: "ЛЮКС", blades: [{ type: "iconTab", groups: [
    { label: "Пассивное", content: { title: "Иллюминация", subtitle: "ПАССИВНОЕ", description: { body: "Описание первой механики" } } },
    { label: "Первое", content: { title: "Сковывание", subtitle: "1", description: { body: "Описание второй механики" } } },
    { label: "Второе", content: { title: "Барьер", subtitle: "2", description: { body: "Описание третьей механики" } } },
  ] }] } } } };
  const html = `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify(data)}</script>`;
  const result = extractChampionMechanics(html);
  assert.equal(result.championName, "ЛЮКС");
  assert.equal(result.abilities.length, 3);
  assert.equal(result.abilities[1].name, "Сковывание");
});
