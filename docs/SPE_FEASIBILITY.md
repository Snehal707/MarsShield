# Solar particle event (SPE) dose modelling: feasibility assessment

**Decision: no SPE dose model is implemented in MarsShield.**

What *is* implemented is **Level A**: visualisation and screening of the dose rate RAD actually observed during two SPEs (`science/marsshield/sep_events.py`). It is not a model.

The reasons are given below. Status: November 2026. Citations were checked by web search during this assessment; anything not verified is marked as such.

## Validation levels used here

| Level | Meaning | MarsShield status |
|---|---|---|
| A | Visualisation of historically observed RAD radiation | **Implemented:** hourly RAD detector-E series and record-level event windows for September 2017 and October 2021 |
| B | Retrospective reconstruction using observations from the same event | Not implemented |
| C | Physics-based prediction compared against observations not used for calibration | Not feasible with the data and code available to this project (below) |
| D | Terrain-dependent SPE predictions independently validated for the intended application | Not feasible: no measurements exist (below) |

## Observations available

**RAD Level 2 detector-E dose rate** (NASA SPDF), at about 17-minute resolution:

| Event | Cached here | Detected at Mars (10 % rule) | Peak | After the enhancement |
|---|---|---|---|---|
| 10–13 Sep 2017 | yes | 2017-09-10 21:14 → 09-13 04:02 UTC | 2.24 × the quiet baseline | Forbush decrease to 0.84 × baseline, recovered about 25 Sep |
| 28–29 Oct 2021 | yes | 2021-10-28 17:00 → 10-29 17:11 UTC | 2.29 × the quiet baseline | Forbush decrease to 0.93 × baseline |
| 15 Feb 2022 | no | — | — | — |

**February 2022.** This event is not cached because no Curiosity stop in the 3.5 × 3 km study area falls within ±15 sols of it. The study area has no stop between 21 December 2021 and spring 2022. The data exist at SPDF, but the event cannot affect the terrain analysis.

**Upstream particle spectra at Mars.**
- **MAVEN SEP (public, PDS)** covers protons only up to a few MeV. Surface dose behind about 20 g/cm² of CO₂ is dominated by protons above about 100 MeV, so MAVEN alone cannot drive a surface calculation.
- **15 Feb 2022:** a 1–1000 MeV proton spectrum at Mars was reconstructed by combining Tianwen-1 MEPA, MAVEN, TGO and Curiosity data (GRL 2024, doi 10.1029/2024GL111775). Because that reconstruction uses Curiosity's measurements, a comparison with RAD built on it would be Level B, not C. I did not verify whether its tabulated spectrum is public.
- **September 2017 and October 2021:** high-energy spectra at Mars come mainly from RAD itself (Zeitlin et al. 2018; Ehresmann et al. 2018). Using them to predict RAD's dose is circular (Level B). Spacecraft near Earth sat at very different heliolongitudes: Mars and Earth were about 180° apart magnetically during the October 2021 event (NASA). So Earth-based spectra cannot be transferred without a propagation model, which would itself need validation.

## Transport frameworks

| Framework | Scientific basis | Mars SPE use | Access | Suitability here |
|---|---|---|---|---|
| **AtRIS** (Banjac, Herbst & Heber 2019, JGR Space Physics) | Geant4 Monte Carlo through layered atmospheres | Applied to Mars and benchmarked against RAD surface spectra for GCR ([Guo et al. 2019, SWSC](https://arxiv.org/pdf/1901.01787)) | Public release **not confirmed** | Needs the event spectrum (above), an atmosphere profile and a RAD response model. Heavy compute per event; not runnable in a browser |
| **dMEREM** (LIP / ESA) | Geant4 per location, with Mars Climate Database atmosphere and soil composition | GCR validation against RAD ([Frontiers 2022](https://dx.doi.org/10.3389/fspas.2022.833144)); the SEP comparison was deferred to later work | Through ESA SPENVIS (registration); terms not checked | Same input problem. No published SEP-versus-RAD validation found |
| **HZETRN / OLTARIS** (NASA LaRC) | Deterministic Boltzmann transport | Surface SPE studies (e.g. Carrington-class estimates); the 2016 SWSC benchmark against RAD covered GCR only ([link](https://www.swsc-journal.org/articles/swsc/full_html/2016/01/swsc150074/swsc150074.html)) | OLTARIS is web-based and needs an account; HZETRN source distribution is restricted (not verified) | Not reproducible inside an open static application |
| **Geant4 / PLANETOCOSMICS** | Open Monte Carlo toolkit | Basis of AtRIS and dMEREM | Geant4 is open source | A new Mars SPE model built on it would be a research project, needing its own validation |

**RAD detector response.** Converting a transported particle field into detector-E dose needs RAD's response functions or a full instrument geometry. MarsShield has neither. A plastic-slab approximation would add an unquantified error.

## Terrain dependence for SPEs

The GCR terrain model in MarsShield multiplies a zenith-angle dose distribution by the sky the terrain blocks. Low-energy SPE protons are attenuated far more strongly along slant paths, so the SPE zenith distribution is more sharply peaked towards the vertical than the GCR one. Blocking the low-elevation sky should therefore remove a smaller share of SPE dose than of GCR dose. This is a reasoned expectation, not a measured result.

No dataset contains simultaneous SPE measurements at sheltered and open positions on Mars. **Re-using the GCR terrain multiplier for SPEs would be unjustified, and Level D cannot be validated with existing observations.**

## Conclusion

| Requirement for Level C | Available? |
|---|---|
| Independent upstream spectrum at Mars, >100 MeV | No for 2017 and 2021. For 2022 only a reconstruction that includes RAD |
| Reproducible transport code under open terms | Geant4 is open; Mars-specific codes are not confirmed public |
| RAD detector-E response | No |
| Terrain-dependent SPE measurements | No |

MarsShield therefore:
1. shows the observed RAD time series of the two events (Level A)
2. uses them only to screen records from the GCR terrain analysis, as a sensitivity analysis
3. makes no SPE dose prediction, storm forecast, shelter recommendation or astronaut-safety claim

**What would change the decision:**
- a published, machine-readable SPE spectrum at Mars from instruments other than RAD
- an openly available, validated Mars transport code with a RAD-E response
- ideally, paired measurements at different terrain positions during an event

## Regional SPE scenarios (November 2026 review)

Before the three-region radiation phase, the earlier findings above were rechecked rather than repeated, and the regional question was added: can a historical event be computed at Jezero or Olympus Mons?

**Verdict: not yet.** The transport review found no published SPE surface response at Martian surface pressures in a form we can reproduce:
- The Zhang et al. (2022) archive covers galactic cosmic rays only.
- AtRIS could not be obtained, so there was no rerun.

GCR and SPE analyses therefore stay separate. The Gale screening of September 2017 and October 2021 is unchanged, and no storm shelter guidance or forecast is offered.

**What would be needed:** event proton spectra at Mars, for example from MAVEN SEP or RAD-derived spectra, plus a pressure-resolved SPE surface response with angular resolution.
