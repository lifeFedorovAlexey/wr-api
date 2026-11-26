import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPatchSkinAssetKey,
  enrichPatchSkinImages,
  resolvePatchSkinImageFallback,
} from "../lib/patchSkinImages.mjs";

process.env.DATABASE_URL ||= "postgres://localhost/wildrift_patch_skin_test";
const { resolveChangeImageUrl } = await import("../api/patch-notes.js");

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

test("offline enrichment preserves source images without fetching Riot galleries", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("offline enrichment must not make a network request");
  };

  try {
    const [change] = await enrichPatchSkinImages([{
      entityKind: "skin",
      entitySlug: "norra-cafe-cuties-norra",
      entityName: "Cafe Cuties Norra",
      sourceChampionSlug: "norra",
      sourceImageUrl: "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/cafe-cuties-norra-1280x720.jpg",
    }], [], { fetchGalleries: false });
    assert.equal(change.sourceImageUrl, "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/cafe-cuties-norra-1280x720.jpg");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("official Riot fallbacks resolve null skin images to one base-art public path per family", () => {
  const cases = [
    {
      rows: [
        { entitySlug: "kayle-dragonslayer-kayle", entityName: "Убийца драконов Кейл" },
        { entitySlug: "kayle-dragonslayer-kayle-amber", entityName: "Убийца драконов Кейл (янтарный)" },
      ],
      assetSlug: "kayle-dragonslayer-kayle",
      sourceUrl: "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data/6d00e24d052cbae5428239d746a39bda1be6d0ec-1280x720.jpg?accountingTag=WR",
    },
    {
      rows: [
        { entitySlug: "renekton-blackfrost-renekton", entityName: "Ренектон Черная Стужа" },
        { entitySlug: "renekton-blackfrost-renekton-purple", entityName: "Ренектон Черная Стужа (фиолетовый)" },
      ],
      assetSlug: "renekton-blackfrost-renekton",
      sourceUrl: "https://cmsassets.rgpub.io/sanity/images/dsfx7636/news_live/4721ed43e43d610939a8f3b34b17e4a42a562cec-1280x720.jpg?accountingTag=WR",
    },
    {
      rows: [
        { entitySlug: "smolder-reindeer-smolder", entityName: "Олень Смолдер" },
        { entitySlug: "smolder-reindeer-smolder-pink", entityName: "Олень Смолдер (розовый)" },
      ],
      assetSlug: "smolder-reindeer-smolder",
      sourceUrl: "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/a74f6f10ccce08a834bb14bba2125d545a6ea84e-1280x720.jpg?accountingTag=WR",
    },
    {
      rows: [
        { entitySlug: "volibear-legends-showdown-volibear-chromas", entityName: "Legends Showdown Volibear chromas" },
        { entitySlug: "volibear-гроза-легенд-волибир-цветовые-схемы", entityName: "Гроза легенд Волибир (цветовые схемы)" },
        { entitySlug: "volibear-гроза-легенд-волибир-lpl", entityName: "Гроза легенд Волибир (LPL)" },
        { entitySlug: "volibear-гроза-легенд-волибир-lck", entityName: "Гроза легенд Волибир (LCK)" },
        { entitySlug: "volibear-гроза-легенд-волибир-lec", entityName: "Гроза легенд Волибир (LEC)" },
        { entitySlug: "volibear-гроза-легенд-волибир-cblol", entityName: "Гроза легенд Волибир (CBLOL)" },
        { entitySlug: "volibear-гроза-легенд-волибир-lcs", entityName: "Гроза легенд Волибир (LCS)" },
        { entitySlug: "volibear-гроза-легенд-волибир-lcp", entityName: "Гроза легенд Волибир (LCP)" },
      ],
      assetSlug: "volibear-legends-showdown-volibear",
      sourceUrl: "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/7f60b578b8f9aead78f85cdb04ac6dc38e283667-1280x720.jpg?accountingTag=WR",
    },
    {
      rows: [
        { entitySlug: "milio-glorious-eminence-milio", entityName: "Блистательная знаменитость Милио" },
        { entitySlug: "milio-glorious-eminence-milio", entityName: "Glorious Eminence Milio" },
      ],
      assetSlug: "milio-glorious-eminence-milio",
      sourceUrl: "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/c270233ec5e9ef931637502af4c2b4177e23efb8-1280x720.jpg?accountingTag=WR",
    },
    {
      rows: [
        { entitySlug: "kogmaw-pencil-sharpener-kogmaw", entityName: "Точилка для карандашей Ког'Мао" },
        { entitySlug: "kogmaw-ascended-pencil-sharpener-kogmaw", entityName: "Вознесшаяся Точилка для карандашей Ког'Мао" },
        { entitySlug: "kogmaw-ascended-pencil-sharpener-kogmaw", entityName: "Ascended Pencil Sharpener Kog'Maw" },
      ],
      assetSlug: "kogmaw-pencil-sharpener-kogmaw",
      sourceUrl: "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/de89db0bbeb18e797cf6942d3eedcd52777288a6-1280x720.jpg?accountingTag=WR",
    },
    {
      rows: [
        { entitySlug: "thresh-dream-raider-thresh", entityName: "Похититель снов Треш" },
        { entitySlug: "thresh-dream-raider-thresh", entityName: "Dream Raider Thresh" },
        { entitySlug: "thresh-unleashed-dream-raider-thresh", entityName: "Освобожденный Похититель снов Треш" },
        { entitySlug: "thresh-unleashed-dream-raider-thresh", entityName: "Unleashed Dream Raider Thresh" },
      ],
      assetSlug: "thresh-dream-raider-thresh",
      sourceUrl: "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data/1b423fac7488d3466ebb590f98ac5ffc71544deb-1280x720.jpg?accountingTag=WR",
    },
    {
      rows: [
        { entitySlug: "amumu-food-spirits-amumu", entityName: "Гурман Амуму" },
        { entitySlug: "amumu-food-spirits-amumu", entityName: "Food Spirits Amumu" },
        { entitySlug: "amumu-ascended-food-spirits-amumu", entityName: "Вознесшийся Гурман Амуму" },
        { entitySlug: "amumu-ascended-food-spirits-amumu", entityName: "Ascended Food Spirits Amumu" },
      ],
      assetSlug: "amumu-food-spirits-amumu",
      sourceUrl: "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data/26475e5b9a0baf4230973fcb3325d531059a73a6-1280x720.jpg?accountingTag=WR",
    },
    {
      rows: [
        { entitySlug: "urgot-battlecast-urgot", entityName: "Модифицированный Ургот" },
        { entitySlug: "urgot-battlecast-urgot", entityName: "Battlecast Urgot" },
      ],
      assetSlug: "urgot-battlecast-urgot",
      sourceUrl: "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/202890954c5b7acad3d641e15543cfea859dec22-1280x720.jpg?accountingTag=WR",
    },
    {
      rows: [
        { entitySlug: "renekton-glorious-eminence-renekton", entityName: "Блистательная знаменитость Ренектон" },
        { entitySlug: "renekton-glorious-eminence-renekton", entityName: "Glorious Eminence Renekton" },
      ],
      assetSlug: "renekton-glorious-eminence-renekton",
      sourceUrl: "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/e8d9a59178abdf0ed58ee68f7ee501b3e9644c95-1280x720.jpg?accountingTag=WR",
    },
    {
      rows: [
        { entitySlug: "nasus-battlecast-nasus", entityName: "Модифицированный Насус" },
        { entitySlug: "nasus-battlecast-nasus", entityName: "Battlecast Nasus" },
      ],
      assetSlug: "nasus-battlecast-nasus",
      sourceUrl: "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/4d85237e8f86e57ad9ef6e36b3649878b0643f69-1920x1080.jpg?accountingTag=WR",
    },
    {
      rows: [
        { entitySlug: "khazix-dream-raider-khazix", entityName: "Похититель снов Ка'Зикс" },
        { entitySlug: "khazix-dream-raider-khazix", entityName: "Dream Raider Kha'Zix" },
        { entitySlug: "khazix-ascended-dream-raider-khazix", entityName: "Вознесшийся Похититель снов Ка'Зикс" },
        { entitySlug: "khazix-ascended-dream-raider-khazix", entityName: "Ascended Dream Raider Kha'Zix" },
      ],
      assetSlug: "khazix-dream-raider-khazix",
      sourceUrl: "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/eb880dc7284eda38d639253fb8530eac697e657b-1280x720.jpg?accountingTag=WR",
    },
    {
      rows: [
        { entitySlug: "jayce-superhero-jayce", entityName: "Супергерой Джейс" },
        { entitySlug: "jayce-superhero-jayce", entityName: "Superhero Jayce" },
        { entitySlug: "jayce-ascended-superhero-jayce", entityName: "Вознесшийся супергерой Джейс" },
        { entitySlug: "jayce-ascended-superhero-jayce", entityName: "Ascended Superhero Jayce" },
      ],
      assetSlug: "jayce-superhero-jayce",
      sourceUrl: "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data/4a3651390a1f6831b6b290619a4d02cfedccd15c-1280x720.jpg?accountingTag=WR",
    },
    {
      rows: [
        { entitySlug: "xayah-elderwood-xayah", entityName: "Дух леса Шая" },
        { entitySlug: "xayah-elderwood-xayah", entityName: "Elderwood Xayah" },
        { entitySlug: "xayah-elderwood-xayah-indigo", entityName: "Дух леса Шая (темно-синий)" },
        { entitySlug: "xayah-elderwood-xayah-indigo", entityName: "Elderwood Xayah (Indigo)" },
      ],
      assetSlug: "xayah-elderwood-xayah",
      sourceUrl: "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data/cdf2c0392d79ceb83db60b8570a58ee465c0e29e-1280x720.jpg?accountingTag=WR&fm=jpg",
    },
    {
      rows: [
        { entitySlug: "rakan-elderwood-rakan", entityName: "Дух леса Рэйкан" },
        { entitySlug: "rakan-elderwood-rakan", entityName: "Elderwood Rakan" },
        { entitySlug: "rakan-elderwood-rakan-turquoise", entityName: "Дух леса Рэйкан (бирюзовый)" },
        { entitySlug: "rakan-elderwood-rakan-turquoise", entityName: "Elderwood Rakan (Turquoise)" },
      ],
      assetSlug: "rakan-elderwood-rakan",
      sourceUrl: "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data/ef93809df745175cd5de133bc38252a825e8777a-1280x720.jpg?accountingTag=WR",
    },
    {
      rows: [
        { entitySlug: "lulu-purple-garlic-lulu", entityName: "Фиолетовый чеснок Лулу" },
        { entitySlug: "lulu-purple-garlic-lulu", entityName: "Purple Garlic Lulu" },
      ],
      assetSlug: "lulu-purple-garlic-lulu",
      sourceUrl: "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/1c29b337b9ac289046fecf694cd71fb5292a81d5-1280x720.jpg?accountingTag=WR",
    },
    {
      rows: [
        { entitySlug: "ryze-movie-director-ryze", entityName: "Режиссер Райз" },
        { entitySlug: "ryze-ascended-movie-director-ryze", entityName: "Вознесшийся режиссер Райз" },
        { entitySlug: "ryze-ascended-movie-director-ryze", entityName: "Ascended Movie Director Ryze" },
      ],
      assetSlug: "ryze-movie-director-ryze",
      sourceUrl: "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/896caf3a676f87a8f3d30f09404370460a91593b-1280x720.jpg?accountingTag=WR&fm=jpg",
    },
    {
      rows: [
        { entitySlug: "skarner-scorpio-deity-skarner", entityName: "Космическое жало Скарнер" },
        { entitySlug: "skarner-scorpio-deity-skarner", entityName: "Scorpio Deity Skarner" },
        { entitySlug: "skarner-scorpio-deity-ancient-wisdom-skarner", entityName: "Scorpio Deity Ancient Wisdom Skarner" },
      ],
      assetSlug: "skarner-cosmic-sting-skarner",
      sourceUrl: "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/c1eb24ab30c6327950140c1b5bc9a1a6e2ac9b80-1280x720.jpg?accountingTag=WR&fm=jpg",
    },
  ];

  for (const family of cases) {
    const expectedPath = `/wr-api/api/assets/${buildPatchSkinAssetKey(family.assetSlug, family.sourceUrl)}?src=${encodeURIComponent(family.sourceUrl)}`;
    const paths = family.rows.map((row) => {
      const change = { entityKind: "skin", imageUrl: null, ...row };
      const fallback = resolvePatchSkinImageFallback(change);
      assert.deepEqual(fallback, { assetSlug: family.assetSlug, imageUrl: family.sourceUrl });
      return resolveChangeImageUrl(change, { champions: new Map(), guideEntities: new Map() }, {
        ASSET_PUBLIC_MODE: "local",
      });
    });

    assert.deepEqual(paths, family.rows.map(() => expectedPath));
  }
});


test("resolves generic chroma collection labels through base gallery art", async () => {
  const originalFetch = globalThis.fetch;
  const imageUrl = "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data/astral-bear.jpg";
  globalThis.fetch = async () => galleryResponse("Astral Bear", imageUrl);
  try {
    const changes = await enrichPatchSkinImages(["Astral Bear chromas", "Astral Bear (chromas)"].map((entityName) => ({
      entityKind: "skin", entitySlug: "test-chroma-bear", sourceChampionSlug: "test-chroma-bear", entityName,
    })));
    assert.deepEqual(changes.map((change) => change.sourceImageUrl), [imageUrl, imageUrl]);
    assert.equal(resolvePatchSkinImageFallback({ entityKind: "skin", entityName: "Glorious Eminence (chromas)" }), null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
