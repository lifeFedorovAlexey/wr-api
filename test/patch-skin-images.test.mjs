import assert from "node:assert/strict";
import test from "node:test";

import { enrichPatchSkinImages } from "../lib/patchSkinImages.mjs";

function galleryResponse(label, imageUrl) {
  const data = JSON.stringify({ props: { pageProps: { page: { blades: [{
    type: "landingMediaCarousel",
    groups: [{ label, content: { media: { url: imageUrl } } }],
  }] } } } });
  return new Response(`<script id="__NEXT_DATA__" type="application/json">${data}</script>`, { status: 200 });
}

test("retries a transient Riot gallery failure and resolves English and Russian skin rows", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  const imageUrl = "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/pool-party-taliyah-1280x720.jpg?accountingTag=WR";
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) return new Response("temporarily unavailable", { status: 503 });
    return galleryResponse("POOL PARTY TALIYAH", imageUrl);
  };

  try {
    const changes = await enrichPatchSkinImages([
      { entityKind: "skin", entitySlug: "taliyah-pool-party-taliyah", entityName: "Pool Party Taliyah", sourceChampionSlug: "taliyah" },
      { entityKind: "skin", entitySlug: "taliyah-pool-party-taliyah", entityName: "Тусовая Талия", sourceChampionSlug: "taliyah" },
    ]);

    assert.equal(calls, 2);
    assert.deepEqual(changes.map(({ sourceImageUrl }) => sourceImageUrl), [imageUrl, imageUrl]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("resolves Norra's skin image from the Riot champion gallery", async () => {
  const originalFetch = globalThis.fetch;
  const imageUrl = "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/cafe-cuties-norra-1280x720.jpg?accountingTag=WR";
  const promoImageUrl = "https://cmsassets.rgpub.io/sanity/images/dsfx7636/news_live/norra-promo-1920x1080.jpg";
  globalThis.fetch = async () => galleryResponse("CAFE CUTIES NORRA", imageUrl);

  try {
    const [change] = await enrichPatchSkinImages([{
      entityKind: "skin",
      entitySlug: "norra-cafe-cuties-norra",
      entityName: "Норра из кафе красоты",
      sourceChampionSlug: "norra",
      sourceImageUrl: promoImageUrl,
    }]);
    assert.equal(change.sourceImageUrl, imageUrl);
    assert.equal(change.sourceAssetSlug, "norra-cafe-cuties-norra");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
