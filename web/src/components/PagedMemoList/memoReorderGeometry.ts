export interface MemoReorderTarget {
  name: string;
  rect: Pick<DOMRect, "top" | "bottom" | "left" | "right" | "width" | "height">;
}

/** Resolve a physical hit to a feed index, without sorting DOM entries by their x coordinate. */
export function memoInsertionIndex(targets: MemoReorderTarget[], x: number, y: number, rtl: boolean): number {
  let closest = -1;
  let distance = Number.POSITIVE_INFINITY;
  targets.forEach(({ rect }, index) => {
    const dx = Math.max(rect.left - x, 0, x - rect.right);
    const dy = Math.max(rect.top - y, 0, y - rect.bottom);
    const next = dx * dx + dy * dy;
    if (next < distance) {
      distance = next;
      closest = index;
    }
  });
  if (closest < 0) return 0;
  const rect = targets[closest].rect;
  const middleY = (rect.top + rect.bottom) / 2;
  // A horizontal approach to a tile uses its logical inline half. Vertical
  // approaches (including flow lists) use the top/bottom half instead.
  const horizontal = (x < rect.left || x > rect.right) && Math.abs(y - middleY) < rect.height / 2;
  const after = horizontal ? (rtl ? x < rect.left : x > rect.right) : y >= middleY;
  return closest + (after ? 1 : 0);
}

/** Explicitly anchor even the final loaded destination; it is not necessarily the global end.
 * The API names the preceding neighbor `before` and the following neighbor `after`.
 */
export function memoMoveAnchors(names: string[], name: string, destination: number) {
  const remaining = names.filter((value) => value !== name);
  const index = Math.max(0, Math.min(destination, remaining.length));
  return {
    name,
    ...(remaining[index - 1] ? { before: remaining[index - 1] } : {}),
    ...(remaining[index] ? { after: remaining[index] } : {}),
  };
}
