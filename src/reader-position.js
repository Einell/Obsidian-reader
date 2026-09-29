// Foliate 1.0.1 uses 1500 units of linear section size per reading location.
// These are stable reading positions, not layout-dependent screen pages.
export const ENGINE_LOCATION_SIZE = 1500;

export function flattenPageList(items = []) {
    if (!Array.isArray(items)) return [];
    return items.flatMap(item => [
        ...(typeof item?.href === "string" && String(item.label || "").trim()
            ? [{ label: String(item.label).trim(), href: item.href }] : []),
        ...flattenPageList(item?.subitems || []),
    ]);
}

export function enginePositionModel(detail, book, fixedIndex = 0) {
    const pages = flattenPageList(book?.pageList);
    if (pages.length) return { kind: "original", pages, current: detail?.pageItem?.label || "", total: pages.length, fraction: detail?.fraction || 0 };
    if (book?.rendition?.layout === "pre-paginated") {
        return { kind: "page", current: (detail?.section?.current ?? fixedIndex) + 1, total: book.sections.length, fraction: detail?.fraction || 0 };
    }
    const size = (book?.sections || []).reduce((sum, section) => sum + (section.linear !== "no" && section.size > 0 ? section.size : 0), 0);
    const total = Math.ceil(size / ENGINE_LOCATION_SIZE);
    return { kind: total ? "location" : "percent", size, total,
        current: Math.min(total, Math.max(1, (detail?.location?.current || 0) + 1)), fraction: detail?.fraction || 0 };
}

export function parseReaderPosition(raw, model, mode = model.kind) {
    const value = String(raw).trim();
    if (mode === "percent" || value.endsWith("%")) {
        const number = value.replace(/%$/, "");
        const percent = Number(number);
        return /^(?:\d+(?:\.\d+)?|\.\d+)$/.test(number) && percent >= 0 && percent <= 100
            ? { fraction: percent / 100 } : null;
    }
    if (mode === "original") {
        const matches = model.pages.filter(page => page.label.toLocaleLowerCase() === value.toLocaleLowerCase());
        return matches.length === 1 ? { href: matches[0].href } : null;
    }
    const number = Number(value);
    if (!/^\d+$/.test(value) || !Number.isSafeInteger(number) || number < 1 || number > model.total) return null;
    return mode === "location"
        ? { fraction: (number - 1) * ENGINE_LOCATION_SIZE / model.size }
        : { page: number };
}
