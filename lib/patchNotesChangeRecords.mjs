import { createHash } from "node:crypto";

import { buildPublicIconPath } from "./championIcons.mjs";
import { buildGuideAssetKey, buildGuideAssetProxyPath, buildPublicGuideAssetPath } from "./guideAssets.mjs";
import { buildPatchSkinAssetKey } from "./patchSkinImages.mjs";
import { inArray } from "drizzle-orm";

function normalizeName(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^a-z0-9а-я]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function createAliasMap(records, aliasesForRecord) {
  const aliases = new Map();
  for (const record of records) {
    for (const alias of aliasesForRecord(record)) {
      const key = normalizeName(alias);
      if (key && !aliases.has(key)) aliases.set(key, record);
    }
  }
  return aliases;
}

function extractGuideAssetSourceUrl(value) {
  let source = String(value || "");
  for (let depth = 0; depth < 6; depth += 1) {
    if (/^https:\/\//i.test(source)) return source;
    const encoded = source.match(/[?&]src=([^&]+)/)?.[1];
    if (!encoded) return null;
    try {
      source = decodeURIComponent(encoded);
    } catch {
      return null;
    }
  }
  return /^https:\/\//i.test(source) ? source : null;
}

function registerRuneAliases(historicalMaps, runes, spells) {
  for (const [alias, slug] of [
    ["Казнь электричеством", "electrocute"],
    ["Грязный прием", "cheap-shot"],
    ["Хватка нежити", "grasp-of-the-undying"],
    ["Пушинка", "aery"],
    ["Смертельный темп", "lethal-tempo"],
    ["Завоеватель", "conqueror"],
    ["Снос", "demolish"],
    ["Полная сосредоточенность", "absolute-focus"],
    ["Боевое рвение", "battle-zeal"],
    ["Гордыня", "hubris"],
    ["Психическая волна", "psychic-wave"],
    ["Удар щитом", "shield-bash"],
    ["Преданность", "loyalty"],
    ["Сладкоежка", "sweet-tooth"],
    ["Ботаник", "botanist"],
    ["Вспышка", "flash"],
    ["Поджог", "ignite"],
    ["Исцеление", "heal"],
    ["Барьер", "barrier"],
    ["Призрак", "ghost"],
    ["Изнурение", "exhaust"],
    ["Кара", "smite"],
    ["Телепорт", "teleport"],
    ["Леденящая кара", "smite"],
    ["Беспощадный охотник", "relentless-hunter"],
    ["Relentless Hunter", "relentless-hunter"],
    ["Легенда: ускорение", "legend-haste"],
    ["Legend: Haste", "legend-haste"],
    ["Создание предметов", "item-crafting"],
    ["Item Crafting", "item-crafting"],
    ["Рынок будущего", "futures-market"],
    ["Future's Market", "futures-market"],
    ["Future’s Market", "futures-market"],
    ["Psychic Wave", "psychic-wave"],
    ["Shield Bash", "shield-bash"],
    ["Sweet Tooth", "sweet-tooth"],
    ["Второе дыхание", "second-wind"],
    ["Костяная пластина", "bone-plating"],
    ["Разрастание", "overgrowth"],
    ["Мужество колосса", "courage-of-the-colossus"],
    ["Живой источник", "font-of-life"],
    ["Настойчивость", "perseverance"],
    ["Легенда: Рвение", "legend-alacrity"],
    ["Жестокость", "brutal"],
    ["Триумф", "triumph"],
    ["Надвигающаяся буря", "gathering-storm"],
    ["Мастер Аксиом", "axiom-arcanist"],
    ["Поток маны", "manaflow-band"],
    ["Быстрота", "celerity"],
    ["Ожог", "scorch"],
    ["Сфера уничтожения", "nullifying-orb"],
    ["Сияющий плащ", "nimbus-cloak"],
    ["Hexflash", "hextech-flashtraption"],
    ["Eyeball Collection", "eyeball-collector"],
    ["Боевое рвение", "battle-zeal"],
    ["Серия атак", "chain-assault"],
    ["Реванш", "last-stand"],
    ["Ледяной нарост", "ice-overlord"],
    ["Дрожь земли", "aftershock"],
    ["Изобретательный охотник", "ingenious-hunter"],
    ["Банка для семян", "ixtali-seedjar"],
    ["Абсолютная концентрация", "absolute-focus"],
    ["Темная жатва", "dark-harvest"],
    ["Усиление", "empowerment"],
    ["Искусное лавирование", "fleet-footwork"],
    ["Страж", "guardian"],
    ["Магическая комета", "arcane-comet"],
    ["Фазовый рывок", "phase-rush"],
    ["Удар на опережение", "first-strike"],
    ["Владыка льда", "glacial-augment"],
    ["Внезапный удар", "sudden-impact"],
    ["Коллекция глаз", "eyeball-collector"],
    ["Тотем-зомби", "zombie-ward"],
    ["Усиленная атака", "empowered-attack"],
    ["Тиран", "tyrant"],
    ["Превосходство", "transcendence"],
    ["Хекс-скачок", "hextech-flashtraption"],
    ["Незыблемость", "unshakeable"],
    ["Психическая волна", "psychic-wave"],
    ["Снос", "demolish"],
  ]) {
    const entity = runes.find((record) => record.slug === slug) || spells.find((record) => record.slug === slug);
    if (entity) (runes.some((record) => record.slug === slug) ? historicalMaps.rune : historicalMaps.spell)
      .set(normalizeName(alias), entity);
  }
 }

function addPatchRuneFallbacks(runes) {
  for (const [slug, name] of [
    ["relentless-hunter", "Relentless Hunter"],
    ["legend-haste", "Legend: Haste"],
    ["item-crafting", "Item Crafting"],
    ["futures-market", "Future's Market"],
  ]) {
    if (runes.some((record) => record.slug === slug)) continue;
    const imageUrl = `https://www.wildriftfire.com/images/runes/${slug}.png`;
    runes.push({ slug, name, imageUrl, tooltipImageUrl: imageUrl });
  }
}

function addPatchItemFallbacks(items) {
  const entries = [
    ["immortal-treads", "Immortal Treads", "Бессмертные шаги", "https://hub-game.com/wildrift/images/items/webp/177.webp"],
    ["crimson-lucidity", "Crimson Lucidity", "Алое просветление", "https://www.wildriftmeta.com/assets/item/icon/item-crimson-lucidity-icon.png"],
    ["armorcrusher-boots", "Armorcrusher Boots", "Ботинки крушителя брони", "https://www.wildriftmeta.com/assets/item/icon/item-armorcrusher-boots-icon.png"],
    ["gunmetal-greaves", "Gunmetal Greaves", "Наголенники из орудийной стали", "https://www.wildriftmeta.com/assets/item/icon/item-gunmetal-greaves-icon.png"],
    ["spellslingers-shoes", "Spellslinger's Shoes", "Сапоги заклинателя", "https://www.wildriftmeta.com/assets/item/icon/item-spellslingers-shoes-icon.png"],
    ["armored-advance", "Armored Advance", "Тяжелое наступление", "https://www.wildriftmeta.com/assets/item/icon/item-armored-advance-icon.png"],
    ["chainlaced-crushers", "Chainlaced Crushers", "Цепные крушители", "https://www.wildriftmeta.com/assets/item/icon/item-chainlaced-crushers-icon.png"],
    ["verdant-barrier", "Verdant Barrier", "Изумрудный оберег", "https://www.wildriftfire.com/images/items/verdant-barrier.png"],
    ["fated-ashes", "Fated Ashes", "Роковой пепел", "https://www.wildriftfire.com/images/items/fated-ashes.png"],
    ["void-amethyst", "Void Amethyst", "Аметист Бездны", "https://www.wildriftfire.com/images/items/void-amethyst.png"],
    ["mikaels-blessing", "Mikael's Blessing", "Благословение Микаэля", "https://www.wildriftfire.com/images/items/mikaels-blessing.png"],
    ["bloodletters-curse", "Bloodletter's Curse", "Проклятие кровопускателя", "https://www.wildriftfire.com/images/items/bloodletters-curse.png"],
    ["blackfire-torch", "Blackfire Torch", "Факел темного огня", "https://www.wildriftfire.com/images/items/blackfire-torch.png"],
    ["stormsurge", "Stormsurge", "Штормовой прилив", "https://www.wildriftfire.com/images/items/stormsurge.png"],
    ["dusk-and-dawn", "Dusk and Dawn", "Закат и рассвет", "https://www.wildriftfire.com/images/items/dusk-and-dawn.png"],
    ["cryptbloom", "Cryptbloom", "Могильный цветок", "https://www.wildriftfire.com/images/items/cryptbloom.png"],
    ["diadem-of-songs", "Diadem of Songs", "Диадема песен", "https://www.wildriftfire.com/images/items/diadem-of-songs.png"],
    ["whispering-circlet", "Whispering Circlet", "Шепчущая диадема", "https://www.wildriftfire.com/images/items/whispering-circlet.png"],
    ["echoes-of-helia", "Echoes of Helia", "Эхо Гелии", "https://www.wildriftfire.com/images/items/echoes-of-helia.png"],
  ];
  for (const [slug, name, russianName, imageUrl] of entries) {
    const existing = items.find((record) => record.slug === slug);
    if (existing) {
      if (!existing.imageUrl && !existing.tooltipImageUrl) {
        existing.imageUrl = imageUrl;
        existing.tooltipImageUrl = imageUrl;
      }
      existing.aliases = [...(existing.aliases || []), russianName];
    } else {
      items.push({ slug, name, aliases: [russianName], imageUrl, tooltipImageUrl: imageUrl });
    }
  }
}

const PATCH_NOTE_ITEM_ALIASES = [
  ["Runaan's Hurricane", "runaans-hurricane"],
  ["Ураган Рунаан", "runaans-hurricane"],
  ["Spear of Shojin", "spear-of-shojin"],
  ["Копье Седзина", "spear-of-shojin"],
  ["Quicksilver Sash", "quicksilver-enchant"],
  ["Quicksilver", "quicksilver-enchant"],
  ["Кушак стремительного серебра", "quicksilver-enchant"],
  ["Зачарование Живого серебра", "quicksilver-enchant"],
  ["Смерть Разума", "wits-end"],
  ["Terminus", "terminus"],
  ["Светотень", "terminus"],
  ["Navori Quickblades", "navori-quickblades"],
  ["Быстрые клинки Навори", "navori-quickblades"],
  ["Infinity Edge", "infinity-edge"],
  ["Грань Бесконечности", "infinity-edge"],
  ["Soul Transfer", "soul-transfer"],
  ["Перенос души", "soul-transfer"],
  ["Nashor's Talon", "nashors-talon"],
  ["Коготь Нашора", "nashors-talon"],
  ["Diadem of Songs", "diadem-of-songs"],
  ["Диадема песен", "diadem-of-songs"],
  ["Whispering Circlet", "whispering-circlet"],
  ["Шепчущая диадема", "whispering-circlet"],
  ["Echoes of Helia", "echoes-of-helia"],
  ["Эхо Гелии", "echoes-of-helia"],
  ["Hextech Rocketbelt", "protobelt-enchant"],
  ["Protobelt", "protobelt-enchant"],
  ["Хекстековый ракетный ремень", "protobelt-enchant"],
  ["Gargoyle Stoneplate", "stoneplate-enchant"],
  ["Каменный доспех гаргульи", "stoneplate-enchant"],
  ["Zhonya's Hourglass", "stasis-enchant"],
  ["Stasis", "stasis-enchant"],
  ["Стазис", "stasis-enchant"],
  ["Песочные часы Жони", "stasis-enchant"],
  ["Stridebreaker", "stridebreaker"],
  ["Костолом", "stridebreaker"],
  ["Goredrinker", "goredrinker"],
  ["Потрошитель", "goredrinker"],
  ["Mercurial Scimitar", "mercurial-scimitar"],
  ["Ртутный ятаган", "mercurial-scimitar"],
  ["Galeforce", "galeforce"],
  ["Сила шторма", "galeforce"],
  ["Seeker's Armguard", "seekers-armguard"],
  ["Наручи Искательницы", "seekers-armguard"],
  ["Redemption", "redemption"],
  ["Искупление", "redemption"],
  ["Locket of the Iron Solari", "locket-enchant"],
  ["Locket", "locket-enchant"],
  ["Медальон Железных Солари", "locket-enchant"],
  ["Glorious Enchant", "glorious-enchant"],
  ["Зачарование славы", "glorious-enchant"],
  ["Veil Enchant", "veil-enchant"],
  ["Зачарование завесы", "veil-enchant"],
  ["Dream Maker", "dream-maker"],
  ["Сновичок", "dream-maker"],
  ["Boots of Mana", "boots-of-mana"],
  ["Ботинки маны", "boots-of-mana"],
  ["Mercury's Treads", "mercurys-treads"],
  ["Поступь Меркурия", "mercurys-treads"],
  ["Berserker's Greaves", "berserkers-greaves"],
  ["Наголенники берсерка", "berserkers-greaves"],
  ["Plated Steelcaps", "plated-steelcaps"],
  ["Бронированные сапоги", "plated-steelcaps"],
  ["Gluttonous Greaves", "gluttonous-greaves"],
  ["Алчные наголенники", "gluttonous-greaves"],
  ["Boots of Dynamism", "boots-of-dynamism"],
  ["Ботинки динамичности", "boots-of-dynamism"],
  ["Ionian Boots of Lucidity", "ionian-boots-of-lucidity"],
  ["Ионийские сапоги просветления", "ionian-boots-of-lucidity"],
  ["Amplifying Tome", "amplifying-tome"],
  ["Усиливающий фолиант", "amplifying-tome"],
  ["Lost Chapter", "lost-chapter"],
  ["Потерянная глава", "lost-chapter"],
  ["Hextech Alternator", "hextech-alternator"],
  ["Хекстек-альтернатор", "hextech-alternator"],
  ["Fiendish Codex", "fiendish-codex"],
  ["Бесовской манускрипт", "fiendish-codex"],
  ["Needlessly Large Rod", "needlessly-large-rod"],
  ["Слишком Большой Жезл", "needlessly-large-rod"],
  ["Haunting Guise", "haunting-guise"],
  ["Преследующая маска", "haunting-guise"],
  ["Rod of Ages", "rod-of-ages"],
  ["Жезл веков", "rod-of-ages"],
  ["Infinity Orb", "infinity-orb"],
  ["Сфера бесконечности", "infinity-orb"],
  ["Stormsurge", "stormsurge"],
  ["Штормовой прилив", "stormsurge"],
  ["Verdant Barrier", "verdant-barrier"],
  ["Изумрудный оберег", "verdant-barrier"],
  ["Liandry's Torment", "liandrys-torment"],
  ["Мучения Лиандри", "liandrys-torment"],
  ["Cosmic Drive", "cosmic-drive"],
  ["Космический ускоритель", "cosmic-drive"],
  ["Riftmaker", "riftmaker"],
  ["Творец разломов", "riftmaker"],
  ["Archangel's Staff", "archangels-staff"],
  ["Посох архангела", "archangels-staff"],
  ["Seraph's Embrace", "seraphs-embrace"],
  ["Объятья серафима", "seraphs-embrace"],
  ["Rabadon's Deathcap", "rabadons-deathcap"],
  ["Смертельная шляпа Рабадона", "rabadons-deathcap"],
  ["Oceanid's Trident", "oceanids-trident"],
  ["Трезубец океаниды", "oceanids-trident"],
  ["Luden’s Echo", "ludens-echo"],
  ["Эхо Людена", "ludens-echo"],
  ["Malignance", "malignance"],
  ["Пагубность", "malignance"],
  ["Lich Bane", "lich-bane"],
  ["Гроза Личей", "lich-bane"],
  ["Rylai's Crystal Scepter", "rylais-crystal-scepter"],
  ["Хрустальный скипетр Рилай", "rylais-crystal-scepter"],
  ["Horizon Focus", "horizon-focus"],
  ["Хекстековый прицел", "horizon-focus"],
  ["Morellonomicon", "morellonomicon"],
  ["Мореллономикон", "morellonomicon"],
  ["Prophet's Pendant", "prophets-pendant"],
  ["Талисман пророка", "prophets-pendant"],
  ["Bandle Fantasy", "bandle-fantasy"],
  ["Бандловая фантазия", "bandle-fantasy"],
  ["Psychic Projector", "psychic-projector"],
  ["Духовный проектор", "psychic-projector"],
  ["Crown of the Shattered Queen", "crown-of-the-shattered-queen"],
  ["Венец Расколотой королевы", "crown-of-the-shattered-queen"],
  ["Awakened Soulstealer", "awakened-soulstealer"],
  ["Пробужденный пожиратель душ", "awakened-soulstealer"],
  ["Ring of Revelation", "ring-of-revelation"],
  ["Кольцо откровений", "ring-of-revelation"],
  ["Harmonic Echo", "harmonic-echo"],
  ["Мелодичное эхо", "harmonic-echo"],
  ["Forbidden Idol", "forbidden-idol"],
  ["Запретный идол", "forbidden-idol"],
  ["Ardent Censer", "ardent-censer"],
  ["Пылающая кадильница", "ardent-censer"],
  ["Staff of Flowing Waters", "staff-of-flowing-waters"],
  ["Посох водного потока", "staff-of-flowing-waters"],
  ["Imperial Mandate", "imperial-mandate"],
  ["Имперский мандат", "imperial-mandate"],
  ["Frozen Heart", "frozen-heart"],
  ["Ледяное сердце", "frozen-heart"],
  ["Yordle Trap", "yordle-trap"],
  ["Ловушка йордлов", "yordle-trap"],
  ["Tear of the Goddess", "tear-of-the-goddess"],
  ["Слеза богини", "tear-of-the-goddess"],
  ["Guardian Angel", "guardian-angel"],
  ["Ангел-хранитель", "guardian-angel"],
  ["Sterak's Gage", "steraks-gage"],
  ["Испытание Стерака", "steraks-gage"],
  ["Maw of Malmortius", "maw-of-malmortius"],
  ["Зев Малмортиуса", "maw-of-malmortius"],
  ["Mantle of the Twelfth Hour", "mantle-of-the-twelfth-hour"],
  ["Мантия двенадцатого часа", "mantle-of-the-twelfth-hour"],
  ["Edge of Night", "edge-of-night"],
  ["Грань ночи", "edge-of-night"],
  ["Force of Nature", "force-of-nature"],
  ["Сила природы", "force-of-nature"],
  ["Serylda's Grudge", "seryldas-grudge"],
  ["Злоба Серильды", "seryldas-grudge"],
  ["Essence Reaver", "essence-reaver"],
  ["Похититель сущности", "essence-reaver"],
  ["Chemtech Chainsword", "chempunk-chainsword"],
  ["Нож-пила химпанка", "chempunk-chainsword"],
  ["Blade of the Ruined King", "blade-of-the-ruined-king"],
  ["Клинок Падшего короля", "blade-of-the-ruined-king"],
  ["Sunfire Aegis", "sunfire-aegis"],
  ["Эгида солнечного пламени", "sunfire-aegis"],
  ["Thornmail", "thornmail"],
  ["Шипованный доспех", "thornmail"],
  ["Sapphire Crystal", "sapphire-crystal"],
  ["Сапфировый кристалл", "sapphire-crystal"],
  ["Призрачный клинок Йомуу", "youmuus-ghostblade"],
  ["Доспех Вармога", "warmogs-armor"],
  ["Сборщик долгов", "the-collector"],
  ["Магнитный бластер", "magnetic-blaster"],
  ["Плащ ловкости", "cloak-of-agility"],
];

function findHistoricalItemEntity(slug, historicalRows, fallbackName) {
  const historical = historicalRows.find((row) => row.kind === "item" && row.slug === slug && row.name);
  const sourceUrl = extractGuideAssetSourceUrl(historical?.imageUrl);
  return sourceUrl
    ? { slug, name: historical.name, imageUrl: sourceUrl, tooltipImageUrl: sourceUrl }
    : { slug, name: fallbackName };
}

function registerItemAliases(items, historicalRows, itemAliases) {
  const bySlug = new Map(items.map((record) => [record.slug, record]));
  for (const [alias, slug] of [
    ["Locket of the Iron Solari", "locket-enchant"],
    ["Медальон Железных Солари", "locket-enchant"],
    ["Thornmail", "thornmail"],
    ["Шипованный доспех", "thornmail"],
    ["Warmog's Heart", "warmogs-armor"],
    ["Сердце Вармога", "warmogs-armor"],
    ["Эгида солнечного пламени", "sunfire-aegis"],
    ["Великанская зима", "fimbulwinter"],
    ["Слеза богини", "tear-of-the-goddess"],
    ["Танец смерти", "deaths-dance"],
    ["Манамунэ", "manamune"],
    ["Мурамана", "muramana"],
    ["Объятья серафима", "seraphs-embrace"],
    ["Объятия серафима", "seraphs-embrace"],
    ["Клинок Падшего короля", "blade-of-the-ruined-king"],
    ["Armorcrusher Boots", "armorcrusher-boots"],
    ["Ботинки крушителя брони", "armorcrusher-boots"],
    ["Цепные крушители", "chainlaced-crushers"],
    ["Chainlaced Crushers", "chainlaced-crushers"],
    ["Gunmetal Greaves", "gunmetal-greaves"],
    ["Наголенники из орудийной стали", "gunmetal-greaves"],
    ["Armored Advance", "armored-advance"],
    ["Тяжелое наступление", "armored-advance"],
    ["Большой задира", "big-bully"],
    ["Big Bully", "big-bully"],
    ["Spellslinger's Shoes", "spellslingers-shoes"],
    ["Сапоги заклинателя", "spellslingers-shoes"],
    ["Грань ночи", "edge-of-night"],
    ["Штормовой прилив", "stormsurge"],
    ["Эхо Людена", "ludens-echo"],
    ["Эгида солнечного пламени", "sunfire-aegis"],
    ["Костолом", "stridebreaker"],
    ["Stridebreaker", "stridebreaker"],
    ["Благословение Микаэля", "mikaels-blessing"],
    ["Кейниковый рукерн", "kaenic-rookern"],
    ["Нож-пила химпанка", "chempunk-chainsword"],
    ["Хладорожденная рукавица", "iceborn-gauntlet"],
    ["Скорострельная пушка", "rapid-firecannon"],
    ["Полуденный колчан", "noonquiver"],
    ["Стрелы борца с демонами", "fiendhunter-bolts"],
    ["Дикие стрелы Юнталь", "yun-tal-wildarrows"],
    ["Хекс-прицел С44", "hexoptics-c44"],
    ["Хекс-прицел C44", "hexoptics-c44"],
    ["Заточка Статикка", "statikk-shiv"],
    ["Бронированные сапоги", "plated-steelcaps"],
    ["Благословение Микаэля", "mikaels-blessing"],
    ["Поклон лорда Доминика", "lord-dominiks-regard"],
    ["Lord Dominik's Regards", "lord-dominiks-regard"],
    ["Magnetic Blaster", "magnetic-blaster"],
    ["Наручи Искательницы", "seekers-armguard"],
    ["Seeker's Armguard", "seekers-armguard"],
    ["Изумрудный оберег", "verdant-barrier"],
    ["Verdant Barrier", "verdant-barrier"],
    ["Штормовой прилив", "stormsurge"],
    ["Зачарование очищения", "purify"],
    ["Наручи Искательницы", "seekers-armguard"],
    ["Изумрудный оберег", "verdant-barrier"],
    ["Черная секира", "black-cleaver"],
    ["Знамение Рандуина", "randuins-omen"],
    ["Randuin's Omen", "randuins-omen"],
    ["Рандуинова наковальня", "randuins-omen"],
    ["Устойчивость", "randuins-omen"],
    ["Тяжелая артиллерия", "kraken-slayer"],
    ["Удар Лайтшилда", "sundered-sky"],
    ["Дикострел Юн Тала", "yun-tal-wildarrows"],
    ["Ртутные сапоги", "mercurys-treads"],
    ["Клинок черного тумана", "black-cleaver"],
    ["Forbidden Idol", "forbidden-idol"],
    ["Запретный идол", "forbidden-idol"],
    ["Harmonic Echo", "harmonic-echo"],
    ["Мелодичное эхо", "harmonic-echo"],
    ["Staff of Flowing Water", "staff-of-flowing-water"],
    ["Посох водного потока", "staff-of-flowing-water"],
    ["Ardent Censer", "ardent-censer"],
    ["Пылающая кадильница", "ardent-censer"],
    ["Trinity Force", "trinity-force"],
    ["Тройственный Союз", "trinity-force"],
    ["Nashor's Tooth", "nashors-tooth"],
    ["Зуб Нашора", "nashors-tooth"],
    ["Protector's Vow", "protectors-vow"],
    ["Клятва защитника", "protectors-vow"],
    ["Giant Slayer", "giant-slayer"],
    ["Убийца великанов", "giant-slayer"],
    ["Searing Crown", "searing-crown"],
    ["Обжигающая корона", "searing-crown"],
    ["Surging Scales", "surging-scales"],
    ["Вздымающаяся чешуя", "surging-scales"],
    ["Stinger", "stinger"],
    ["Жало", "stinger"],
    ["Затмение", "eclipse"],
    ["Eclipse", "eclipse"],
    ["Убийца кракенов", "kraken-slayer"],
    ["Клятва рыцаря", "knights-vow"],
    ["Кровавая кольчуга господина", "overlords-bloodmail"],
    ["Экспериментальная хекстековая броня", "experimental-hexplate"],
    ["Титаническая гидра", "titanic-hydra"],
    ["Бесконечное отчаяние", "unending-despair"],
    ["Unending Despair", "unending-despair"],
  ]) {
    const historical = historicalRows
      .filter((row) => row.kind === "item" && row.slug === slug && row.name)
      .map((row) => {
        const sourceUrl = extractGuideAssetSourceUrl(row.imageUrl);
        return sourceUrl
          ? { slug: row.slug, name: row.name, imageUrl: sourceUrl, tooltipImageUrl: sourceUrl }
          : null;
      })
      .find(Boolean);
    const entity = bySlug.get(slug) || historical || { slug, name: alias };
    if (entity) itemAliases.set(normalizeName(alias), entity);
  }
  for (const [alias, slug] of PATCH_NOTE_ITEM_ALIASES) {
    const entity = bySlug.get(slug) || findHistoricalItemEntity(slug, historicalRows, alias);
    itemAliases.set(normalizeName(alias), entity);
  }
 }

function hydrateHistoricalAliases(historicalRows, maps, recordsByKind) {
  for (const row of historicalRows) {
    if (!row.slug || !row.name || row.slug.startsWith("__debug_")) continue;
    const map = maps[row.kind];
    if (!map) continue;
    const key = normalizeName(row.name);
    if (map.has(key)) continue;
    const base = recordsByKind[row.kind]?.find((record) => record.slug === row.slug);
    const sourceUrl = extractGuideAssetSourceUrl(row.imageUrl);
    if (base) map.set(key, base);
    else if (row.kind === "item" && sourceUrl) map.set(key, {
      slug: row.slug,
      name: row.name,
      imageUrl: sourceUrl,
      tooltipImageUrl: sourceUrl,
    });
  }
}

export async function loadPatchChangeCatalog(dbSchema, db) {
  const champions = await db.select({
    slug: dbSchema.champions.slug,
    name: dbSchema.champions.name,
    nameLocalizations: dbSchema.champions.nameLocalizations,
    icon: dbSchema.champions.icon,
  }).from(dbSchema.champions);
  const guideRecords = await db.select({
    kind: dbSchema.guideEntities.kind,
    slug: dbSchema.guideEntities.slug,
    name: dbSchema.guideEntities.name,
    tooltipTitle: dbSchema.guideEntities.tooltipTitle,
    imageUrl: dbSchema.guideEntities.imageUrl,
    tooltipImageUrl: dbSchema.guideEntities.tooltipImageUrl,
  }).from(dbSchema.guideEntities).where(inArray(dbSchema.guideEntities.kind, ["item", "rune", "summonerSpell"]));
  const items = guideRecords.filter((record) => record.kind === "item" && !String(record.slug || "").startsWith("__debug_"));
  const runes = guideRecords.filter((record) => record.kind === "rune");
  const spells = guideRecords.filter((record) => record.kind === "summonerSpell");
  addPatchItemFallbacks(items);
  addPatchRuneFallbacks(runes);
  const historicalRows = await db.select({
    kind: dbSchema.patchNoteChanges.entityKind,
    slug: dbSchema.patchNoteChanges.entitySlug,
    name: dbSchema.patchNoteChanges.entityName,
    patchVersion: dbSchema.patchNoteChanges.patchVersion,
    changeType: dbSchema.patchNoteChanges.changeType,
    imageUrl: dbSchema.patchNoteChanges.imageUrl,
  }).from(dbSchema.patchNoteChanges).where(inArray(dbSchema.patchNoteChanges.entityKind, ["champion", "item", "rune", "spell", "skin"]));

  const itemAliases = createAliasMap(items, (record) => [record.slug, record.name, record.tooltipTitle, ...(record.aliases || [])]);
  const historicalMaps = {
    champion: createAliasMap(champions, (record) => [record.slug, record.name, ...Object.values(record.nameLocalizations || {})]),
    item: itemAliases,
    rune: createAliasMap(runes, (record) => [record.slug, record.name, record.tooltipTitle]),
    spell: createAliasMap(spells, (record) => [record.slug, record.name, record.tooltipTitle]),
  };
  for (const champion of [
    { slug: "hwei", name: "Хвэй", aliases: ["Hwei", "Хвэй"] },
    { slug: "yunara", name: "Юнара", aliases: ["Yunara", "Юнара"] },
    { slug: "skarner", name: "Скарнер", aliases: ["Skarner", "Скарнер"] },
    { slug: "taliyah", name: "Талия", aliases: ["Taliyah", "Талия"] },
    {
      slug: "chogath",
      name: "Cho'Gath",
      icon: "https://s3.twcstorage.ru/bc483358-49a0-429d-ac19-9ee918779236/icons/chogath.png",
      aliases: ["Cho'Gath", "Cho’Gath", "CHO'GATH", "Чо'Гат", "Чо’Гат", "cho-gath"],
    },
  ]) {
    const existing = champions.find((record) => record.slug === champion.slug);
    const entity = existing?.icon || !champion.icon
      ? existing || { slug: champion.slug, name: champion.name, icon: null }
      : { ...existing, icon: champion.icon };
    for (const alias of [champion.slug, champion.name, ...champion.aliases]) {
      historicalMaps.champion.set(normalizeName(alias), entity);
    }
  }
  hydrateHistoricalAliases(historicalRows, historicalMaps, { champion: champions, item: items, rune: runes, spell: spells });
  registerRuneAliases(historicalMaps, runes, spells);
  registerItemAliases(items, historicalRows, itemAliases);
  return {
    champions: historicalMaps.champion,
    items: itemAliases,
    runes: historicalMaps.rune,
    spells: historicalMaps.spell,
    historicalRows,
    itemRecords: items,
    runeRecords: runes,
    spellRecords: spells,
  };
}

function parseNumbers(value) {
  const comparable = String(value || "").replace(/\([^)]*(?:based on|depending on|at level|level|в зависимости от|уровне)[^)]*\)/gi, "");
  return comparable.match(/\d+(?:[.,]\d+)?/g)?.map((number) => Number(number.replace(",", "."))) || [];
}

function classifyLine(detail) {
  if (!detail?.before || !detail?.after) return null;
  const before = parseNumbers(detail.before);
  const after = parseNumbers(detail.after);
  if (!before.length || !after.length) return null;

  const count = Math.min(before.length, after.length);
  const difference = after.slice(0, count).reduce((sum, value, index) => sum + value - before[index], 0);
  if (!difference) return null;

  const label = normalizeName(detail.label || detail.text);
  const lowerIsBetter = /price|cost|cooldown|cool down|recharge|damage taken|урон.*получа|урон.*наносим.*(?:турел|башн)|(?:турел|башн).*урон.*получа|стоимост|цена|перезаряд/.test(label);
  const lowerIsWorse = /movement speed|gold|mana|скорость передвижения|получаемое золото|золото|мана/.test(label);
  const higherIsWorse = /threshold|порог/.test(label);
  let isBuff = difference > 0;
  if (lowerIsBetter || higherIsWorse) isBuff = difference < 0;
  if (lowerIsWorse) isBuff = difference > 0;
  return isBuff ? "buff" : "nerf";
}

function classifyItemPriceDirection(change) {
  if (change.entityKind !== "item") return null;
  const directions = change.details.flatMap((detail) => {
    const text = `${detail.label || ""} ${detail.text || ""}`;
    if (!/(?:price|cost|стоимост|цен)/i.test(text)) return [];
    if (/\b(?:increas(?:e|ed|ing)|rais(?:e|d|ing))\b.{0,40}\b(?:price|cost)\b|\b(?:price|cost)\b.{0,40}\b(?:increas(?:e|d)|rais(?:e|d))\b|повыс\w*.{0,40}(?:стоимост|цен)|увелич\w*.{0,40}(?:стоимост|цен)/i.test(text)) return ["nerf"];
    if (/\b(?:decreas(?:e|d|ing)|reduc(?:e|d|ing)|lower(?:ed|ing))\b.{0,40}\b(?:price|cost)\b|\b(?:price|cost)\b.{0,40}\b(?:decreas(?:e|d)|reduc(?:e|d)|lower(?:ed))\b|сниз\w*.{0,40}(?:стоимост|цен)|уменьш\w*.{0,40}(?:стоимост|цен)/i.test(text)) return ["buff"];
    return [];
  });
  return directions.length && directions.every((direction) => direction === directions[0]) ? directions[0] : null;
}

function classifyChangeDirections(change) {
  const priceDirection = classifyItemPriceDirection(change);
  return priceDirection ? [priceDirection] : change.details.map(classifyLine).filter(Boolean);
}

function classifyChange(change) {
  const structuralText = `${change.entityName} ${change.changeName || ""} ${change.details.map((detail) => detail.text).join(" ")}`;
  if (change.changeName === "removed") return "removed";
  if (change.changeName === "new") return "new";
  if (["champion", "item", "rune", "spell"].includes(change.entityKind)) {
    const headerText = `${change.sectionName || ""} ${change.entityName} ${change.changeName || ""}`;
    const removedSection = /^(?:removed|deleted)\s+(?:items?|champions?|runes?|spells?)$|^удаленные\s+(?:предметы|чемпионы|руны|заклинания)$/i.test(change.sectionName || "");
    const removedStatement = change.details.some((detail) => (
      /^(?:(?:this )?(?:item|champion|rune|spell|summoner spell) (?:has been )?removed from (?:the )?(?:game|wild rift)|removed from (?:the )?(?:game|wild rift))\.?$/i.test(detail.text.trim())
      || /^(?:предмет|чемпион|руна|заклинание)?\s*удален\w* из игры\.?$/i.test(detail.text.trim())
    ));
    if (removedSection || removedStatement) {
      return "removed";
    }
    const newSectionOrName = change.changeName === "new"
      || /\bnew\s+(?:champions?|items?|runes?|spells?)\b|нов(?:ый|ые)\s+(?:чемпион|предмет|рун|заклинан)/i.test(headerText);
    const newEntityStatement = change.details.some((detail) => (
      /^(?:(?:a )?new (?:champion|item)\b|(?:this )?(?:champion|item) is new\b|(?:a )?(?:champion|item) added to (?:the )?(?:game|wild rift)\b|нов(?:ый|ая|ое) (?:чемпион|предмет)\b|(?:чемпион|предмет) добавлен[ао]? в игру)/i.test(detail.text.trim())
    ));
    if (newSectionOrName || newEntityStatement) {
      return "new";
    }
  }
  if (/\brework(?:ed)?\b|переработ/i.test(structuralText)) return "rework";
  if (/\b(?:decreased?|reduced?)\s+(?:the\s+)?impact\b|снизил\w*.{0,40}влияни|ослабил\w*.{0,40}влияни/i.test(structuralText)) return "nerf";
  const directions = new Set(classifyChangeDirections(change));
  if (directions.size > 1) return "adjustment";
  if (directions.has("buff")) return "buff";
  if (directions.has("nerf")) return "nerf";
  return "adjustment";
}

function comparePatchVersions(left, right) {
  const a = String(left || "").match(/^(\d+)\.(\d+)([a-z]?)$/i) || [];
  const b = String(right || "").match(/^(\d+)\.(\d+)([a-z]?)$/i) || [];
  return Number(a[1] || 0) - Number(b[1] || 0)
    || Number(a[2] || 0) - Number(b[2] || 0)
    || String(a[3] || "").localeCompare(String(b[3] || ""));
}

function appearedInEarlierPatch(change, catalog, patchVersion) {
  if (!patchVersion || !catalog?.historicalRows?.length) return false;
  const entity = findCatalogEntity(change, catalog);
  const slug = entity?.slug || change.entitySlug;
  const name = normalizeName(change.entityName);
  return catalog.historicalRows.some((historical) => {
    if (historical.kind !== change.entityKind || comparePatchVersions(historical.patchVersion, patchVersion) >= 0) return false;
    return (slug && historical.slug === slug) || normalizeName(historical.name) === name;
  });
}

function findCatalogEntity(change, catalog) {
  if (!change || !catalog) return null;
  const map = {
    champion: catalog.champions,
    item: catalog.items,
    rune: catalog.runes,
    spell: catalog.spells,
  }[change.entityKind];
  if (!map) return null;
  const normalizedName = normalizeName(change.entityName);
  const directMatch = map?.get(normalizedName);
  if (directMatch || change.entityKind !== "spell") return directMatch || null;
  for (const [alias, entity] of map || []) {
    if (normalizedName.endsWith(` ${alias}`)) return entity;
  }
  return null;
}

function enrichChange(change, catalog) {
  const catalogEntity = findCatalogEntity(change, catalog);
  return {
    ...change,
    entitySlug: catalogEntity?.slug || change.entitySlug || null,
    imageUrl: resolveChangeImageUrl(change, catalogEntity),
  };
}

function resolveChangeImageUrl(change, entity) {
  if (change.entityKind === "champion" && entity?.icon) {
    if (String(entity.icon).startsWith("https://s3.twcstorage.ru/")) return entity.icon;
    return buildPublicIconPath(entity.slug, entity.icon);
  }
  if (["item", "rune", "spell"].includes(change.entityKind) && entity) return guideEntityImageUrl(change, entity);
  if (change.entityKind === "rune" && change.entitySlug === "legend-tenacity") {
    const sourceUrl = "https://www.wildriftfire.com/images/runes/legend-tenacity.png";
    const assetKey = buildGuideAssetKey("guide", "rune", change.entitySlug, "image");
    return buildPublicGuideAssetPath(assetKey, sourceUrl);
  }
  if (change.entityKind === "champion" && change.sourceImageUrl) return patchChampionImageUrl(change);
  if (change.entityKind === "skin") return patchSkinImageUrl(change);
  return null;
}

function guideEntityImageUrl(change, entity) {
  const sourceUrl = entity.tooltipImageUrl || entity.imageUrl || null;
  if (!sourceUrl) return null;
  const kind = change.entityKind === "spell" ? "summonerSpell" : change.entityKind;
  return buildPublicGuideAssetPath(buildGuideAssetKey("guide", kind, entity.slug, "image"), sourceUrl);
}

function patchChampionImageUrl(change) {
  const imageKey = createHash("sha1").update(normalizeName(change.entityName)).digest("hex").slice(0, 12);
  return buildPublicGuideAssetPath(buildGuideAssetKey("patch", "champion", imageKey), change.sourceImageUrl);
}

function patchSkinImageUrl(change) {
  if (!change.sourceImageUrl || !change.entitySlug) return null;
  try {
    const url = new URL(change.sourceImageUrl);
    if (url.protocol !== "https:" || url.hostname !== "cmsassets.rgpub.io") return null;
    const assetKey = buildPatchSkinAssetKey(change.sourceAssetSlug || change.entitySlug, url.toString());
    return buildGuideAssetProxyPath(assetKey, url.toString());
  } catch {
    return null;
  }
}

function itemDetailSignature(change) {
  const values = change.details.flatMap((detail) => {
    const source = detail.before && detail.after
      ? `${detail.before} ${detail.after}`
      : detail.text;
    return source.match(/\d[\d\s]*(?:[.,]\d+)?/g) || [];
  }).map((value) => {
    const normalized = value.replace(/\s/g, "");
    return /[,.]\d{3}$/.test(normalized)
      ? normalized.replace(/[,.]/g, "")
      : normalized.replace(",", ".");
  }).sort();
  return values.length ? values.join("|") : null;
}

function buildEnglishImageFallbackIndex(englishChanges) {
  const englishBySignature = new Map();
  for (const kind of ["item", "rune", "spell"]) {
    const english = (englishChanges || []).filter((change) => change.entityKind === kind);
    for (const englishChange of english) {
      const signature = itemDetailSignature(englishChange);
      if (!signature || !englishChange.entitySlug || !englishChange.imageUrl) continue;
      const key = `${kind}:${signature}`;
      const existing = englishBySignature.get(key);
      if (existing && existing.entitySlug !== englishChange.entitySlug) englishBySignature.set(key, null);
      else if (!englishBySignature.has(key)) englishBySignature.set(key, englishChange);
    }
  }

  return englishBySignature;
}

function toPatchChangeRow(rawChange, ordinal, catalog, englishBySignature, patchVersion) {
  const entityKind = rawChange.entityKind || "system";
  const catalogEntity = findCatalogEntity(rawChange, catalog);
  const fallbackKey = `${entityKind}:${itemDetailSignature(rawChange)}`;
  const imageFallback = !catalogEntity ? englishBySignature.get(fallbackKey) || null : null;
  const change = enrichChange(rawChange, catalog);
  const changeType = classifyChange(change);
  return {
    ordinal,
    entityKind,
    entitySlug: change.entitySlug || imageFallback?.entitySlug || null,
    entityName: change.entityName,
    imageUrl: change.imageUrl || imageFallback?.imageUrl || null,
    changeType: changeType === "new" && appearedInEarlierPatch(change, catalog, patchVersion) ? "adjustment" : changeType,
    sectionName: change.sectionName || null,
    changeName: change.changeName || null,
    details: change.details,
  };
}

export function buildPatchChangeRows(changes, catalog, englishChanges = [], patchVersion = null) {
  const englishBySignature = buildEnglishImageFallbackIndex(englishChanges);
  const rows = (changes || []).map((change, ordinal) => (
    toPatchChangeRow(change, ordinal, catalog, englishBySignature, patchVersion)
  ));
  return mergePatchChangeRows(rows);
}

function mergePatchChangeRows(rows) {
  const champions = new Map();
  const itemsByEntity = new Map();
  const others = [];
  const otherEntities = new Map();
  for (const row of rows) {
    if (row.entityKind === "item") {
      const key = row.entitySlug || normalizeName(row.entityName);
      const existing = itemsByEntity.get(key);
      if (existing) mergeItemRows(existing, row);
      else itemsByEntity.set(key, { ...row, details: [...row.details] });
      continue;
    }
    if (row.entityKind !== "champion") {
      if (["rune", "spell", "skin"].includes(row.entityKind)) {
        const key = `${row.entityKind}:${row.entitySlug || normalizeName(row.entityName)}`;
        const existing = otherEntities.get(key);
        if (existing) {
          mergeOtherEntityRow(existing, row);
        } else otherEntities.set(key, { ...row, details: [...row.details] });
        continue;
      }
      others.push(row);
      continue;
    }
    const key = row.entitySlug || normalizeName(row.entityName);
    const existing = champions.get(key);
    if (existing) {
      existing.details.push(...row.details.map((detail) => ({ ...detail, component: row.changeName })));
      existing.changeType = combineTypes(existing.changeType, row.changeType);
    } else {
      champions.set(key, {
        ...row,
        details: row.details.map((detail) => ({ ...detail, component: row.changeName })),
      });
    }
  }
  return [...champions.values(), ...itemsByEntity.values(), ...otherEntities.values(), ...others]
    .map((row, ordinal) => ({ ...row, ordinal }));
}

function mergeOtherEntityRow(existing, row) {
  const detailKeys = new Set(existing.details.map(detailSignature));
  for (const detail of row.details) addUniqueDetail(existing.details, detail, detailKeys);
  existing.changeType = combineTypes(existing.changeType, row.changeType);
}

function addUniqueDetail(details, detail, seen) {
  const signature = detailSignature(detail);
  if (seen.has(signature)) return;
  details.push(detail);
  seen.add(signature);
}

function detailSignature(detail) {
  return [detail.component, detail.label, detail.before, detail.after, detail.text]
    .map((value) => normalizeName(value || ""))
    .join("|");
}

function mergeItemRows(existing, row) {
  const detailKeys = new Set(existing.details.map(detailSignature));
  for (const detail of row.details) {
    const key = detailSignature(detail);
    if (detailKeys.has(key)) continue;
    detailKeys.add(key);
    existing.details.push(detail);
  }
  existing.changeType = combineTypes(existing.changeType, row.changeType);
}

function combineTypes(left, right) {
  if (left === right) return left;
  if (left === "adjustment") return right;
  if (right === "adjustment") return left;
  if (left === "removed" || right === "removed") return "removed";
  if (left === "new" || right === "new") return "new";
  if (left === "rework" || right === "rework") return "rework";
  return "adjustment";
}
