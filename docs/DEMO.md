# MarsShield demo script (about 3 minutes)

Use the public demo at https://snehal707.github.io/MarsShield/. Everything below works without the Python backend.

## 1. The finding (20 s)

The opening card states the result: *on a Marswalk, where you stop matters more than how you walk.* Its labels:
- **Measured:** Curiosity's RAD saw up to 19.4 % lower dose rates next to cliffs.
- **Modeled:** rerouting a walk to hug shelter almost never pays.
- **Modeled:** where you stand while working can matter, and the app says when it cannot tell.

Click **Start the science Marswalk**.

## 2. A real science walk (60 s)

- The map shows the route Nontron → Maria Gordon Notch → Canaima over the real USGS 1 m terrain, built from MRO HiRISE stereo.
- In the side panel, open each stop. Point out:
  - **Objective:** quoted from Bennett et al. 2023 or the NASA mission blog, with links.
  - **Look for:** for example, the 6 m cliff of Mont Mercou, or the layering, veins and nodules on the notch wall.
  - **What Curiosity found.**
  - **Activity duration and work radius:** labelled *Assumption*.
  - **Modeled dose rate** and **measured RAD:** Curiosity's own dose rate at that stop, with dates.
- At Maria Gordon Notch the decision chip reads **"Model cannot rank the stops"**. The better-sheltered spot nearby differs by less than the model's validated error, so the plan keeps the astronaut at the target.
- Scroll to **How big is this dose?** It compares the 82.6 µGy walk with one day on open ground, with Curiosity's measured surface and cruise averages, and with the model error.

## 3. When shelter does pay (45 s)

Open **Break-even** and choose **Maria Gordon Notch, 150 m radius**.
- The chart shows dose against stop duration relative to the least-walking spot. The sheltered option crosses zero at **21 minutes** and is **Resolved**: 12.8 rate points against a 5.2-point model error.
- Point out the flags under option C: a steep stop below terrain that rises 20 m, with rockfall not modeled.
- Switch to **Mt Mercou, 150 m radius**. Everything is **Unresolved**: dashed lines, struck-through times, no recommendation.

## 4. The evidence (40 s)

- On the map, click a white-ringed RAD marker to see a measured observation: sol, dates, µGy/day and local anomaly.
- Switch the layer to **Orbital image** to show the HiRISE orthophoto.
- Open **Evidence**. The dot plot compares measured RAD drops with three models over all eight periods. The table states plainly that the physical model is not demonstrably better than a naive proxy at n = 8.
- Point to the audit box: 136 table cells checked, and the paper's own 19.4 % vs 17 % inconsistency.
- Close on **Findings → Which conclusions rest on observations?**

## With the science service running (optional)

Run the service locally (see the README). Then:
- **Science Marswalk:** pick other objectives, for example add Mary Anning, and click **Plan this Marswalk** (about 1–2 minutes).
- **Explore the sky:** click any point.
- **Break-even:** place a custom science target.
