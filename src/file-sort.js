export const FILE_SORT_STORAGE_KEY = "yu-file-sort";
export const DEFAULT_FILE_SORT = Object.freeze({ field: "modified", direction: "desc" });

const fields = new Set(["name", "modified", "size", "type"]);
const collator = new Intl.Collator("zh-CN", { numeric: true, sensitivity: "base" });
const text = (value) => typeof value === "string" ? value : "";
const number = (value) => Number.isFinite(value) ? value : 0;

export function normalizeFileSort(raw) {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)
    || !fields.has(raw.field) || !["asc", "desc"].includes(raw.direction)) {
    return { ...DEFAULT_FILE_SORT };
  }
  return { field: raw.field, direction: raw.direction };
}

function compareId(first, second) {
  const a = text(first?.id);
  const b = text(second?.id);
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Return a sorted copy. Secondary ordering stays ascending in both directions. */
export function sortFiles(items, sort) {
  const { field, direction } = normalizeFileSort(sort);
  const sign = direction === "asc" ? 1 : -1;
  const type = (item) => (text(item?.extension) || text(item?.type)).replace(/^\./, "").toLocaleLowerCase("en-US");
  return (Array.isArray(items) ? [...items] : []).sort((first, second) => {
    const byName = collator.compare(text(first?.name), text(second?.name));
    let primary = 0;
    if (field === "name") primary = byName;
    else if (field === "modified") primary = number(first?.modifiedAt) - number(second?.modifiedAt);
    else if (field === "size") primary = number(first?.sizeBytes) - number(second?.sizeBytes);
    else if (field === "type") primary = collator.compare(type(first), type(second));
    return primary ? primary * sign : byName || compareId(first, second);
  });
}
