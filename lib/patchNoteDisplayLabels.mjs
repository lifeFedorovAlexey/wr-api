const RUSSIAN_LABELS = new Map([
  ["new", "Новое"],
  ["new items", "Новые предметы"],
  ["new runes", "Новые руны"],
  ["new champions", "Новые чемпионы"],
  ["removed", "Удалено"],
  ["removed items", "Удаленные предметы"],
  ["removed runes", "Удаленные руны"],
  ["buff", "Усиление"],
  ["nerf", "Ослабление"],
  ["adjustment", "Изменение"],
  ["rework", "Переработка"],
  ["big bully", "Большой задира"],
]);

function labelKey(value) {
  return String(value || "")
    .trim()
    .replace(/[.!?]+$/u, "")
    .replace(/\s+/gu, " ")
    .toLocaleLowerCase("en-US");
}

function localizeLabel(value, locale) {
  if (locale !== "ru-ru" || typeof value !== "string") return value;
  return RUSSIAN_LABELS.get(labelKey(value)) || value;
}

/** Localize generic section and detail labels without changing the stored source text. */
export function localizePatchNoteDisplayLabels(row, locale = "ru-ru") {
  if (!row || typeof row !== "object" || locale !== "ru-ru") return row;
  return {
    ...row,
    sectionName: localizeLabel(row.sectionName, locale),
    changeName: localizeLabel(row.changeName, locale),
    details: Array.isArray(row.details)
      ? row.details.map((detail) => {
        const localizedDetail = { ...detail };
        if (typeof detail.label === "string") localizedDetail.label = localizeLabel(detail.label, locale);
        if (typeof detail.component === "string") localizedDetail.component = localizeLabel(detail.component, locale);
        return localizedDetail;
      })
      : row.details,
  };
}
