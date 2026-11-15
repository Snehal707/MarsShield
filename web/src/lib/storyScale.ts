// Scale of the notch story's drop chart. Zero-based; extends past 25 % in steps of 5 only when the reader's guess
// (0 to 40 %) needs it, so the guess line is always inside the plot.
export const GUESS_MAX = 40;

export function dropScale(values: number[], guess: number | null) {
  const need = Math.max(25, ...values, guess ?? 0);
  const max = Math.min(GUESS_MAX, Math.ceil(need / 5) * 5);
  const ticks = Array.from({ length: Math.floor(max / 10) + 1 }, (_, i) => i * 10);
  return { max, ticks, grid: Array.from({ length: max / 5 + 1 }, (_, i) => i * 5) };
}
