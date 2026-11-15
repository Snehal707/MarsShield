# MarsShield demo script (about 3 minutes)

Use the public demo at https://snehal707.github.io/MarsShield/.
Everything below runs in the browser, with no Python backend. Routes, trade-offs and experiments are recalculated live from the precomputed terrain.

## 1. Opening (20 s)

The page opens on Maria Gordon Notch. The dark curtain over it is the sky its walls hide.

The panel gives two numbers side by side:
- **−19.4 %:** the dose rate Curiosity *measured* in the notch.
- **−9.8 %:** what the published terrain model *predicts* for the same comparison.

Measured values are white and model values are blue throughout the app. Planning assumptions are underlined with a gold dashed line.

Click **Plan a Marswalk**.

## 2. Mission (70 s)

1. **Destination.** The default is Maria Gordon Notch. Each of the nine targets shows its objective and source.
2. **Route.** Click **Plan the route**.
   - Four strategies are computed in the browser, return trip included, in about a second.
   - Point out that the lowest-dose and fastest routes match, while hugging the cliffs costs about 30 % more time and dose.
   - Move the walking-speed slider: everything recalculates.
3. **Activity.** Set the work duration and an optional EVA limit. The budget bar shows walking versus working time.
4. **Trade-off.** Ask "Where should the astronaut stand?"
   - Three candidate spots appear on the terrain, with a dose-versus-time chart.
   - At the notch's 30 m work radius the verdict is **Model cannot tell**: the spots differ by less than the model's validated error.
   - Widen the radius to see when a difference becomes resolvable.
5. **Evidence.** Shows the Curiosity RAD measurements near the stop and the published periods.
6. **Conclusion.** Gives the plan, what it does *not* tell you (effective dose, solar storms, rockfall, life support), and a JSON export.

## 3. Experiment (60 s)

Open **Experiment**, then **Does the landscape change the dose?**
- Choose a model and a baseline. Predictions for 322 rover stops are made on held-out time blocks, before any measurement is shown.
- Click **Reveal**. The verdict appears with its interval: the terrain model predicts better than time only, ΔMSE −3.44 pp² [−8.0, −0.7].

Then open **Physical model or simple rule?** and **Where would a measurement best separate the models?** Both end in **cannot distinguish**, with the reason given. This is the honest result.

## 4. Evidence (30 s)

The **RAD + pressure analysis** tab shows that pressure adds nothing measurable at stop level, that terrain adds +22 % skill, and that this signal is concentrated in a few strongly shielded stops.

**Validation** and **Limitations** list every number, including the P6 and P8 geometry misses.
