# Research workspace and accessibility (Phase 2, November 2026)

This phase changes the layout and interaction only. No calculation, dataset or displayed result changed. The headline (RMSE 3.95 → 3.49, −11.7 %) and the parking and disagreement values are identical before and after. The checks under Verification confirm this.

## Layout

| Mode | Before | After |
|---|---|---|
| Experiment | One sidebar that widened to 64 % of the screen ("Expand analysis") | Narrow panel (400 px) for the steps and the verdict. A **research dock** along the bottom of the terrain holds the charts, the data table and the downloads. It has Collapse, Split and Expand sizes and can be dragged or resized from the keyboard. The camera re-centres in the visible terrain. |
| Evidence | Same widening sidebar | A reading-width panel (480–600 px) beside the terrain, plus a **reading view**: full width, with a section list on the left and text at most 780 px wide. Charts are capped at 640 px (panel) and 720 px (reading view). |
| Phones and tablets ≤ 860 px | Sidebar content stacked | The dock follows the panel in the page. Charts use the full width, and the table shows 25 rows with a "Show more" button. Wide columns appear only in the expanded dock. |

## Charts (`web/src/components/ResearchCharts.tsx`)

- **Drawing:** charts are drawn at the container's real pixel size, so text stays 11–12 px at any width.
- **Encoding:** shape as well as colour. A measured value is an open ring. The model is a filled circle, sky only a triangle, the proportional rule a square.
- **Over time:** brush to zoom, with a Reset zoom button. Thin lines join each prediction to its measurement.
- **Measured against predicted:**
  - A 1:1 line.
  - The calibration slope with its 95 % interval, drawn as a curve. The slope is fitted on the log anomaly; the axes are in actual percent.
- **Uncertainty:** interval plots of the tested differences (ΔMSE by site and time-block resampling; parking and disagreement RMSE differences), each against a zero line.
- **Linked selection:** chart ↔ table ↔ terrain.
  - In the terrain experiment, clicking one of Curiosity's stops on the map selects it in the chart and the table.
  - Selecting a parking period draws its parking and background positions and the line between them.

## Accessibility items

| # | Item | Fix |
|---|---|---|
| 1 | Offscreen markers reachable by keyboard | Terrain markers are no longer tab stops (`aria-hidden`). Every marker action has a panel equivalent: destination buttons, spot list, table rows. |
| 2 | Focus lost after Reveal | Focus moves to the Result heading. |
| 3 | Undersized markers | 24 px hit area on clickable markers and chart points. |
| 4 | Unnamed sliders | Sliders use `<label for>` and `aria-valuetext`, including the story's guess slider. |
| 5 | Keyboard for tabs and tables | WAI-ARIA tabs (one tab stop; arrow keys, Home, End) for modes, Evidence sections and chart views. Modes use manual activation. Data tables are grids: arrow keys, Page Up/Down, Home/End, Enter or Space selects. |
| 6 | Map label overlap and clipping | Labels are kept inside the visible terrain (left of the panel, above the dock). A label that would overlap another is hidden; the selected one wins. |
| 7 | Layer control dismissal | Closes on Escape (focus returns to the button), on an outside click, and when the mode or story step changes. Layer choices are radios with arrow keys. |
| 8 | Phone story slider covered by the sticky bar | The story buttons are in the normal flow on phones. Verified: the slider's centre is the topmost element. |
| 9 | Landmarks and skip link | `header`, `nav`, `main#panel`, a labelled analysis region. Skip links go to the panel and to the analysis. |
| 10 | Compute feedback | Times are measured with `performance.now()` around each worker call and each experiment recalculation, then shown in place and in the header (see Measured times). |
| 11 | Markers vanished when the active mode was clicked again | Re-selecting the current mode is a no-op. |

## Measured times

Headless Chrome with software WebGL (SwiftShader) on the development laptop, local static build. These are not real-device measurements.

| Calculation | Time |
|---|---|
| Three routes to Maria Gordon Notch (worker) | 2.07 s |
| Where to stand, 50 candidate spots (worker) | 2.04–2.11 s |
| Terrain experiment: cross-validation and both bootstraps | 188 ms |
| Parking experiment: predictions and site bootstrap | 26 ms |
| Disagreement experiment: site bootstrap | 46 ms |

## Verification

**Browser probe** `p2` (1440×900, 1024×768 and 390×844; zero console errors):
- The first Tab reaches the skip link.
- Arrow keys move between the mode tabs.
- After Reveal, focus is on "Result".
- Clicking a chart point selected the same stop in the table, the selection card and the terrain label.
- Arrow keys and Enter in the table select a row.
- The dock grows by 80 px on two ArrowUp presses.
- Escape and an outside click close the layer control.
- Zoom and Reset zoom work.
- The parking selection draws P6, BG6 and the line between them.
- CSV download works from the dock.
- The dock is hidden in Mission.
- The reading view is 780 px wide.
- No horizontal overflow on the tablet or the phone.
- The phone table shows 25 rows and "Show 50 more".

**Regression probes:**
- The Phase 1 probe: story numbers, site-specific evidence, table row 92_84 −19.3 / −11.0 / −8.4, a ZIP with `input_manifest.json` and 7 screening rows, Audit headings.
- The full walkthrough: Mission, Story, three experiments, no-WebGL fallback, zero console errors.
- One walkthrough step fails because it clicks an "Export this experiment" button that an earlier phase replaced with the download bar. The Phase 1 probe covers the current package instead.

**Tests:** engine, stats, story and export verifiers pass; 34 pytest tests pass; typecheck and lint are clean.

**Screenshots** (`docs/img/phase2/*.jpg`): `p2_experiment_normal`, `p2_expanded_analysis`, `p2_linked_selection`, `p2_uncertainty`, `p2_parking`, `p2_evidence_panel`, `p2_evidence_reading`, `p2_tablet_experiment`, `p2_phone_experiment`, `p2_phone_dock`, `p2_phone_story`.

## Not done

- No screen-reader session (NVDA or VoiceOver) and no real phone was used. The checks above are automated.
- Human usability testing (`docs/USABILITY_TEST.md`) has not been run.
