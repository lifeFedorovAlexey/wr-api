const ORIGIN = "https://wildrift.leagueoflegends.com";

function nextData(html) {
  const marker = '<script id="__NEXT_DATA__" type="application/json">';
  const start = html.indexOf(marker);
  if (start < 0) throw new Error("Riot __NEXT_DATA__ is missing");
  const bodyStart = start + marker.length;
  const end = html.indexOf("</script>", bodyStart);
  return JSON.parse(html.slice(bodyStart, end));
}

export function extractChampionMechanics(html) {
  const page = nextData(html)?.props?.pageProps?.page;
  const blade = page?.blades?.find((item) => item?.type === "iconTab" && Array.isArray(item.groups)
    && item.groups.some((group) => group?.content?.description?.body));
  const abilities = (blade?.groups || []).map((group) => ({
    name: String(group?.content?.title || group?.label || "").trim(),
    slot: String(group?.content?.subtitle || "").trim(),
    description: String(group?.content?.description?.body || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
  })).filter((item) => item.name && item.description);
  if (abilities.length < 3) throw new Error("Official Riot abilities are missing");
  return { championName: String(page?.title || "").trim(), abilities };
}

export async function fetchChampionMechanics(slug, locale = "ru-ru") {
  const sourceUrl = `${ORIGIN}/${locale}/champions/${slug}/`;
  const response = await fetch(sourceUrl, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${sourceUrl}`);
  return { ...extractChampionMechanics(await response.text()), sourceUrl };
}
