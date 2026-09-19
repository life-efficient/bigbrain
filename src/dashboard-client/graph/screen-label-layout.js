export function layoutGraphScreenLabels(labels, viewport) {
  const occupied = [];
  const width = Math.max(0, viewport.width);
  const height = Math.max(0, viewport.height);

  return labels.map((label) => {
    const labelWidth = Math.max(1, label.width);
    const labelHeight = Math.max(1, label.height);
    const candidates = [];
    const offsets = label.focus
      ? [0]
      : [0, -1, 1, -2, 2, -3, 3, -4, 4, -5, 5, -6, 6];
    for (const offset of offsets) {
      const top = label.y + offset * (labelHeight + 3);
      candidates.push({ left: label.x + 12, top });
      if (!label.focus) candidates.push({ left: label.x - labelWidth - 12, top });
    }

    let best = null;
    let bestOverlap = Number.POSITIVE_INFINITY;
    for (const candidate of candidates) {
      const left = clamp(candidate.left, 4, Math.max(4, width - labelWidth - 4));
      const top = clamp(candidate.top, labelHeight / 2 + 4, Math.max(labelHeight / 2 + 4, height - labelHeight / 2 - 4));
      const rect = {
        left,
        right: left + labelWidth,
        top: top - labelHeight / 2,
        bottom: top + labelHeight / 2,
      };
      const overlap = occupied.reduce((total, placed) => (
        total + Math.max(0, Math.min(rect.right + 3, placed.right + 3) - Math.max(rect.left - 3, placed.left - 3))
          * Math.max(0, Math.min(rect.bottom + 3, placed.bottom + 3) - Math.max(rect.top - 3, placed.top - 3))
      ), 0);
      if (overlap < bestOverlap) {
        best = { left, top, rect };
        bestOverlap = overlap;
      }
      if (overlap === 0) break;
    }
    occupied.push(best.rect);
    return { slug: label.slug, left: best.left, top: best.top };
  });
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}
