export function mobileColumnPercent(columnWidth: number): number {
  const clampedWidth = Math.max(320, Math.min(980, columnWidth));
  return Math.round(84 + ((clampedWidth - 320) / 660) * 16);
}
