export const GAP_SECONDS = Object.freeze([
  ...Array.from({ length: 11 }, (_, index) => index / 10),
  ...Array.from({ length: 8 }, (_, index) => 1.5 + index / 2),
  ...Array.from({ length: 25 }, (_, index) => index + 6)
]);
export const DEFAULT_GAP_SECONDS = 0.3;

export function normalizeGapSeconds(value) {
  const number = Number(value);
  if (value === undefined || value === null || value === "" || !Number.isFinite(number)) return DEFAULT_GAP_SECONDS;
  if (number < 1) return Math.max(0, Math.round(number * 10) / 10);
  if (number < 5) return Math.round(number * 2) / 2;
  return Math.min(30, Math.round(number));
}

export function gapSliderIndex(seconds) {
  return GAP_SECONDS.indexOf(normalizeGapSeconds(seconds));
}

export function gapSecondsAtIndex(index) {
  return GAP_SECONDS[Math.max(0, Math.min(GAP_SECONDS.length - 1, Math.round(Number(index) || 0)))];
}
