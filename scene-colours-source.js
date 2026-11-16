// Recompute the palette from the current objects so colours disappear when no
// object uses them. Keep the exact RGB value, including for imported scenes.
export function sceneColours(items = []) {
  const groups = new Map();
  if (!Array.isArray(items)) return [];
  for (const item of items) {
    if (!item || typeof item.color !== 'string' || item.color.length !== 7 || !/^#[\da-f]{6}$/i.test(item.color)) continue;
    const color = item.color.toLowerCase();
    let group = groups.get(color);
    if (!group) {
      group = { color, labels: new Set(), count: 0 };
      groups.set(color, group);
    }
    const name = typeof item.material === 'string' ? item.material.trim() : '';
    group.labels.add(name || 'Unnamed material');
    group.count++;
  }
  return [...groups.values()]
    .sort((a, b) => a.color.localeCompare(b.color, 'en'))
    .map(({ color, labels, count }) => ({
      color,
      labels: [...labels].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }) || a.localeCompare(b, 'en')),
      count,
    }));
}
