export interface PositionedTextItem {
  str: string;
  transform: number[];
  width: number;
  height: number;
}

function median(values: number[]): number {
  if (values.length === 0) return 5;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
}

export function reconstructPdfLines(items: PositionedTextItem[]): string[] {
  const groups: Array<{ y: number; height: number; items: PositionedTextItem[] }> = [];
  for (const item of items.filter((candidate) => candidate.str.trim())) {
    const y = item.transform[5] ?? 0;
    const tolerance = Math.max(1.5, Math.abs(item.height || item.transform[3] || 8) * 0.35);
    const group = groups.find((candidate) => Math.abs(candidate.y - y) <= Math.max(tolerance, candidate.height * 0.35));
    if (group) {
      group.items.push(item);
      group.y = (group.y * (group.items.length - 1) + y) / group.items.length;
      group.height = Math.max(group.height, Math.abs(item.height || item.transform[3] || 8));
    } else {
      groups.push({ y, height: Math.abs(item.height || item.transform[3] || 8), items: [item] });
    }
  }

  return groups
    .sort((left, right) => right.y - left.y)
    .map((group) => {
      const ordered = group.items.sort((left, right) => (left.transform[4] ?? 0) - (right.transform[4] ?? 0));
      const characterWidth = Math.max(2, median(ordered
        .filter((item) => item.width > 0 && item.str.trim().length > 0)
        .map((item) => item.width / item.str.length)));
      let line = '';
      let rightEdge: number | null = null;
      for (const item of ordered) {
        const x = item.transform[4] ?? 0;
        if (rightEdge !== null) {
          const gap = x - rightEdge;
          if (gap > characterWidth * 0.35 && !line.endsWith(' ') && !item.str.startsWith(' ')) {
            line += ' '.repeat(Math.min(80, Math.max(1, Math.round(gap / characterWidth))));
          }
        }
        line += item.str;
        rightEdge = Math.max(rightEdge ?? x, x + Math.max(0, item.width));
      }
      return line.trimEnd();
    });
}
