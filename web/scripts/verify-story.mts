// Focused test: the notch story's drop chart keeps every plotted value inside its scale, including extreme guesses.
// Run: node scripts/verify-story.mts
import { readFileSync } from "node:fs";
import { dropScale, GUESS_MAX } from "../src/lib/storyScale.ts";

const v = JSON.parse(readFileSync(new URL("../public/data/validation.json", import.meta.url), "utf8"));
const p6 = v.pairs.find((q: { pair: string }) => q.pair.startsWith("P6"));
const values = [-p6.measured_ours, -p6.pred_albedo_019, -p6.pred_proportional].map((x: number) => x * 100);
let fails = 0;
const ok = (name: string, cond: boolean) => { if (!cond) fails++; console.log(`${cond ? "ok  " : "FAIL"} ${name}`); };

for (const g of [null, 0, 1, 12, 19, 25, 26, 33, 39, GUESS_MAX]) {
  const s = dropScale(values, g);
  const all = values.concat(g == null ? [] : [g]);
  ok(`guess ${g}: scale 0-${s.max} contains ${all.map((x) => x.toFixed(1)).join(", ")}`, all.every((x) => x >= 0 && x <= s.max));
  ok(`guess ${g}: scale is a multiple of 5 within 25-${GUESS_MAX}`, s.max % 5 === 0 && s.max >= 25 && s.max <= GUESS_MAX);
  ok(`guess ${g}: last tick within scale`, s.ticks[s.ticks.length - 1] <= s.max && s.grid[s.grid.length - 1] === s.max);
}
ok("no guess keeps the original 25 % scale", dropScale(values, null).max === 25);
ok("guess 40 extends the scale to 40 %", dropScale(values, 40).max === 40);
console.log(fails ? `\n${fails} FAILURES` : "\nALL CHECKS PASSED");
process.exit(fails ? 1 : 0);
