# MarsShield: scientific validation, research experience and Mars expansion (final report, November 2026)

## 1. Summary

| Phase | Work | Commits |
|---|---|---|
| 1 | Scientific corrections, solar particle event screening, Maria Gordon Notch geometry audit, export provenance | `5d6e418`, `4d4cb75` |
| 2 | Research dock, linked charts, Evidence reading view, 11 accessibility fixes | `f814361` |
| 3 | Mars overview, Jezero Crater, Olympus Mons caldera, regional manifests, capability matrix | `593edc6` |
| 4 | Tests, live verification, this report | this commit |

Live site, verified in a browser: https://marsshield.vercel.app (commit `593edc6`).

## 2. Scientific corrections (Phase 1)

There are 15 corrections. Each one keeps its earlier value in [SCIENCE_AUDIT.md](SCIENCE_AUDIT.md), and no source data or reference result was altered.

| Correction | Before | After |
|---|---|---|
| Per-stop units | 100 × log ratio, labelled "%" | Actual percent change |
| Model claim in the story | 9.8 % | 9.8 % on MarsShield's notch reconstruction, 13.3 % with the published geometry |
| Effective sample size | "n ≈ 294" | Removed |
| Notch and parking text | Generic | Site-specific |
| Exports | — | `mid_sol` defined, column definitions and an input manifest added |

## 3. Solar particle events

Two events were found in the time-resolved RAD records:
- Sep 2017: 10–13 Sep
- Oct 2021: 28–29 Oct

**Screening results:**
- **Reference (full sample, kept):** RMSE 3.95 → 3.49 (−11.7 %).
- **Both events removed:** −26.6 %.
- **Absolute gain:** essentially unchanged by screening.
- **Model comparison:** the terrain model and the blocked-sky rule stay indistinguishable.

**What was not done:** no SPE dose model was built; only Level A screening was done ([SPE_FEASIBILITY.md](SPE_FEASIBILITY.md)).

## 4. Maria Gordon Notch and the parking comparisons

**Blocked sky at P6:** 0.332 here against 0.379 published. A 1 m change in rover position or a different DEM resolution covers the gap.

**P6 prediction against measurement:**

| | Dose change at P6 |
|---|---|
| Model, MarsShield geometry | −9.8 % |
| Model, published geometry | −13.3 % |
| Measured | −19.4 % |

**Ranking the models:** at the eight parking periods, the ranking flips with the inputs, and site resampling never separates the models.

**Unresolved:** the P7 difference (197.5 here against 190.4 µGy/day published).

## 5. Research workspace (Phase 2)

- **Experiment:** keeps a narrow panel for the reasoning. A resizable bottom dock holds charts, tables and downloads, all linked to one selection on chart, table and terrain.
- **Evidence:** reading-width panel plus a full-width reading view.
- **Phones:** the dock follows the panel and tables show 25 rows at a time.

Details: [RESEARCH_WORKSPACE.md](RESEARCH_WORKSPACE.md).

## 6. Accessibility

All 11 listed items were fixed, with automated checks for each: skip links and landmarks, ARIA tabs, keyboard grid tables, focus after Reveal, 24 px targets, labelled sliders, label clamping, layer control dismissal, the phone story slider, measured compute times, and re-clicking the active mode.

## 7. Mars regions (Phase 3)

| Region | Data | Payload |
|---|---|---|
| Mars overview | MOLA | 0.7 MB |
| Jezero | USGS CTX DTM 20 m, plus 708 Perseverance waypoints | 1.8 MB |
| Olympus Mons caldera | HRSC/MOLA blend 200 m, plus the USGS SIM 3470 geologic map | 2.2 MB |

**How regions work:**
- Each region is loaded only when opened.
- Each has a capability matrix labelled Validated, Exploratory model or Unavailable.
- Radiation is unavailable outside Gale.

**Consistency checks:**
- Jezero DTM against rover elevations: median −1.1 m.
- Olympus Mons high point: 21,226 m in the blend against 21,290 m published.

Details: [REGIONS.md](REGIONS.md).

## 8. Tests

- **Python:** 46 pytest tests pass (34 earlier, 12 for regions).
- **Verifiers:** the engine, stats, story and export verifiers pass (40 export checks).
- **Code:** typecheck and lint are clean.
- **CI:** green on every phase push.

## 9. Live verification

| Site | Result |
|---|---|
| **Vercel** (https://marsshield.vercel.app) | The Phase 1, 2 and 3 browser probes passed at 1440 × 900, 1024 × 768 and 390 × 844, with zero console errors. The site serves commit `593edc6`. |
| **GitHub Pages** (https://snehal707.github.io/MarsShield/) | Deploy workflow green, HTTP 200, and the scripts carry commit `593edc6`. The browser probes timed out loading the page (over 180 s) from this machine, so Pages is **not** claimed as browser-verified. |

## 10. Limitations and blockers

- **Timings:** headless software-WebGL timings only; no real-device timing.
- **Testing:** no screen-reader session, and no human usability test.
- **Unresolved science:** P7, and exact P6 geometry reconciliation (the published panoramic method was not reproduced).
- **Not used:** Jezero HiRISE 1 m DTM (1.8 GB; needs a defined study site) and HRSC single-orbit DTMs.
- **GitHub Pages:** browser verification blocked by load time from this network.

## 11. Screenshots

- Phase 2: `docs/img/phase2/`
- Phase 3: `docs/img/phase3/`, desktop, tablet and phone

The same probes also produced screenshots of the live Vercel site; those were saved locally and are not committed.
