// CN ranked seasons only. Dates are explicitly stated in Tencent's release
// notes, not inferred from patch publication or the separate entertainment season.
// Keep the source with each entry; never extrapolate future season dates.
const APP_STORE = "https://apps.apple.com/cn/app/id1455054000";

export const RANKED_SEASONS = [
  { id: "cn-s20", name: "Сезон 20", date: "2026-01-23", region: "CN", sourceUrl: `${APP_STORE}?ct=tas` },
  { id: "cn-s21", name: "Сезон 21", date: "2026-04-10", region: "CN", sourceUrl: `${APP_STORE}?ct=Tap176911` },
  { id: "cn-s22", name: "Сезон 22", date: "2026-07-10", region: "CN", sourceUrl: "https://bbs.4399.cn/thread-view-tid-53424833" },
  { id: "cn-s23", name: "Сезон 23", date: "2026-09-23", region: "CN", sourceUrl: "https://a.4399.cn/gg/54170068_141120.html" },
];
