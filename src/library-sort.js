export function sortLibraryBooks(books, mode, customOrder, timeOf) {
  const list = [...(books || [])];
  const byName = (a, b) => String(a.basename || a.path).localeCompare(String(b.basename || b.path), "zh");
  if (mode === "custom") {
    const rank = new Map((customOrder || []).map((path, index) => [path, index]));
    list.sort((a, b) => {
      const left = rank.has(a.path) ? rank.get(a.path) : Number.MAX_SAFE_INTEGER;
      const right = rank.has(b.path) ? rank.get(b.path) : Number.MAX_SAFE_INTEGER;
      if (left !== right) return left - right;
      return byName(a, b);
    });
    return list;
  }
  const key = mode === "updated" || mode === "created" ? mode : "opened";
  list.sort((a, b) => (timeOf(b, key) || 0) - (timeOf(a, key) || 0) || byName(a, b));
  return list;
}

// Reorder the visible books, leaving books outside the current filter in their slots.
export function applyVisibleMove(order, visiblePaths, fromPath, toPath) {
  const visible = [...(visiblePaths || [])];
  const from = visible.indexOf(fromPath);
  const to = visible.indexOf(toPath);
  if (from < 0 || to < 0 || from === to) return [...(order || [])];
  const nextVisible = visible.filter((path) => path !== fromPath);
  nextVisible.splice(to, 0, fromPath);
  const queue = [...nextVisible];
  const visibleSet = new Set(visible);
  const seen = new Set();
  const next = [];
  for (const path of order || []) {
    if (!visibleSet.has(path)) {
      if (!seen.has(path)) { next.push(path); seen.add(path); }
      continue;
    }
    const placed = queue.shift();
    if (placed && !seen.has(placed)) { next.push(placed); seen.add(placed); }
  }
  for (const path of [...queue, ...(order || [])]) if (!seen.has(path)) { next.push(path); seen.add(path); }
  return next;
}
