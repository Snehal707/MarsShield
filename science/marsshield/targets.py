"""Documented Curiosity science targets inside the MarsShield walk area.

Every scientific statement below is taken from the cited source (quoted where marked). Positions are NOT
hand-placed: each target is located at the NASA/JPL MMGIS waypoint Curiosity occupied longest during the
documented sol range of that campaign.

What is NOT from a source, and is labelled as such everywhere it appears:
* `activity` type, `duration_h` (nominal and range) and `work_radius_m` are MarsShield planning
  assumptions for a hypothetical crewed visit. They are not Curiosity operations data.
"""
from __future__ import annotations

import json

from . import config as C
from .sites import positions_during

BENNETT2023 = dict(
    cite="Bennett et al. (2023) The Curiosity rover's exploration of Glen Torridon, Gale crater, Mars: an overview of the "
         "campaign and scientific results. JGR Planets 128, e2022JE007185",
    url="https://doi.org/10.1029/2022JE007185")
FRAEMAN2021 = dict(cite="Fraeman, A. (2021, Dec 11) Sols 3323-3325: In the Shadow of Maria Gordon Notch. NASA Science, MSL mission blog",
                   url="https://science.nasa.gov/blogs/sols-3323-3325-in-the-shadow-of-maria-gordon-notch")
GUZEWICH2021 = dict(cite="Guzewich, S. (2021, Mar 15) Sol 3060: The Vastness of Time. NASA Science, MSL mission blog",
                    url="https://science.nasa.gov/missions/mars-science-laboratory/sol-3060-the-vastness-of-time/")
JPL2022 = dict(cite="NASA/JPL (2022, Oct 19) NASA's Curiosity Mars rover reaches long-awaited salty region",
               url="https://www.jpl.nasa.gov/news/nasas-curiosity-mars-rover-reaches-long-awaited-salty-region/")

# Planning assumptions for a crewed stop (MarsShield, not sourced): nominal and range of time on site.
ACTIVITY = {
    "sample": dict(label="Sample collection with documentation", duration_h=[1.0, 2.0, 3.0], work_radius_m=20.0),
    "outcrop": dict(label="Outcrop and section documentation", duration_h=[0.5, 1.0, 2.0], work_radius_m=75.0),
    "station": dict(label="Stationary instrument measurement beside the cliff", duration_h=[1.0, 3.0, 6.0], work_radius_m=30.0),
}

CATALOG = [
    dict(id="hutton", name="Hutton interval, Tower butte bench", curiosity_target="Hutton (drill)", sols=[2664, 2691],
         unit="Hutton interval of the Glasgow member (Murray formation)", activity="sample",
         objective="Test whether the colour variations near the pediment capping unit are due to diagenesis.",
         objective_quote="To capture differences in mineralogy and/or redox state between materials of different colors and to test "
                         "the hypothesis that the color variations are due to diagenesis",
         look_for="The anomalously light-toned Hutton interval and its diagenetic features: nodules, light and dark veins, and hollow circular features.",
         curiosity_found="Cristobalite, opal-CT and magnetite in higher abundances than elsewhere in Glen Torridon; fewer clay minerals (about 6 wt.%).",
         sources=[BENNETT2023], rad_period="P1"),
    dict(id="edinburgh", name="Edinburgh, Greenheugh pediment caprock", curiosity_target="Edinburgh (drill)", sols=[2702, 2729],
         unit="Stimson formation (pediment-capping sandstone)", activity="outcrop",
         objective="Investigate sedimentary structures and grain sizes of the wind-deposited sandstone that caps the Greenheugh pediment.",
         objective_quote="After investigating sedimentary structures and grain sizes, the Edinburgh drill sample was acquired in the Stimson formation",
         look_for="Platy-weathering Gleann Beag interval at the base of the caprock, overlain by the blockier, more massive Ladder and Edinburgh intervals.",
         curiosity_found="Caprock enriched in igneous minerals and magnetite, low in clay; more sanidine than earlier Stimson samples, 8.4% olivine and 7% smectite.",
         sources=[BENNETT2023], rad_period="BG2"),
    dict(id="glasgow", name="Glasgow, representative Glasgow member", curiosity_target="Glasgow (drill)", sols=[2747, 2780],
         unit="Glasgow member (Murray formation)", activity="sample",
         objective="Sample the typical grey Glasgow member for comparison with the light-toned Hutton interval.",
         objective_quote="The Glasgow drill sampled a representative Glasgow member facies that was the typical gray in color",
         look_for="Typical grey Glasgow member bedrock along the pediment scarp.",
         curiosity_found="SAM pyrolysis of Glen Etive, Glasgow and Hutton detected the greatest diversity of sulfur-bearing organic molecules yet seen in Gale crater (Millan et al. 2022).",
         sources=[BENNETT2023], rad_period=None),
    dict(id="bloodstone", name="Bloodstone Hill", curiosity_target="Bloodstone Hill investigation", sols=[2795, 2802],
         unit="Glasgow member outcrop", activity="outcrop",
         objective="Investigate the outcrop exposed at Bloodstone Hill during the drive along the pediment scarp.",
         objective_quote="2795–2802 Bloodstone Hill investigation (Table 2)",
         look_for="The outcrop exposed at Bloodstone Hill (Mastcam mosaic 2797ML14656). The source gives no further detail.",
         curiosity_found="Not described in detail in the cited overview.",
         sources=[BENNETT2023], rad_period="P3"),
    dict(id="mary_anning", name="Mary Anning, Knockfarril Hill member", curiosity_target="Mary Anning and Mary Anning 3 (drill)", sols=[2829, 2904],
         unit="Knockfarril Hill member (clay-bearing unit)", activity="sample",
         objective="Sample a phyllosilicate-rich site chosen for SAM wet-chemistry experiments designed to detect complex organic molecules and characterise past habitability.",
         objective_quote="SAM wet chemistry experiments designed to detect and identify complex organic molecules and characterize the habitability of the past environments in Glen Torridon",
         look_for="Cross-bedded sandstones that confirmed the site's position in the Knockfarril Hill member.",
         curiosity_found="The first TMAH experiment released aromatic organic molecules with up to two carbon rings (Millan et al. 2022; Williams et al. 2021).",
         sources=[BENNETT2023], rad_period=None),
    dict(id="groken", name="Groken, manganese-rich nodules", curiosity_target="Groken (drill)", sols=[2904, 2923],
         unit="Knockfarril Hill member", activity="sample",
         objective="Sample MnO-rich nodules: manganese oxides concentrate only in highly oxidising aqueous environments.",
         objective_quote="the identification of an MnO-rich layer of nodules prompted the decision to drill into these unique features at the target Groken",
         look_for="MnO-rich nodules with elevated phosphorus confined to discrete rock layers within a few metres of the Mary Anning targets.",
         curiosity_found="CheMin found no crystalline Mn or P phases: the elements are either in the X-ray amorphous component (about 27 wt.%) or the sample missed the nodules.",
         sources=[BENNETT2023], rad_period=None),
    dict(id="nontron", name="Nontron, base of Mont Mercou", curiosity_target="Nontron (drill)", sols=[3052, 3072],
         unit="Glasgow member, near the transition to the Mg-sulfate-bearing unit", activity="sample",
         objective="Collect a last Glen Torridon sample close to the transition into the overlying Mg-sulfate-bearing strata, for comparison as the traverse continues.",
         objective_quote="Curiosity collected one more drill sample, Nontron, close to the expected transition zone into the Mg sulfate-bearing strata",
         look_for="The roughly 6 m tall exposed cliff face of Mont Mercou; Curiosity's ChemCam also studied the cliff from this stop.",
         curiosity_found="Nontron mineralogy is similar to other Glasgow member drill samples.",
         sources=[BENNETT2023, GUZEWICH2021], rad_period="P4"),
    dict(id="mgn", name="Maria Gordon Notch, western cliff", curiosity_target="DAN measurements beside the notch wall", sols=[3322, 3326],
         unit="Notch walls exposing layered bedrock", activity="station",
         objective="Measure subsurface hydrogen (a proxy for water) beside the cliff with the DAN neutron instrument, from three positions.",
         objective_quote="DAN has the ability to measure the amount of hydrogen, a proxy for water, around the rover",
         look_for="Layering, veins and nodules exposed on the side of the outcrop, a few metres from the western cliff, in the notch's shadow.",
         curiosity_found="The cited post describes the plan, not results. RAD separately recorded a 19.4% lower dose rate at parking position P6 (stop 92_84, about 2 m from this waypoint) than at the notch mouth (BG6), 16 m away.",
         sources=[FRAEMAN2021], rad_period="P6"),
    dict(id="canaima", name="Canaima, first sulfate-unit drill", curiosity_target="Canaima (drill)", sols=[3608, 3625],
         unit="Sulfate-bearing unit, south of Paraitepuy Pass", activity="sample",
         objective="Sample the sulfate-bearing unit reached after crossing Paraitepuy Pass; the sample was for CheMin and SAM analysis.",
         objective_quote="The pulverized rock sample was acquired on Oct. 3, 2022, the mission's 3,612th Martian day, or sol.",
         look_for="The hills of Paraitepuy Pass, which blocked the rover's view of the sky.",
         curiosity_found="The release reports sample collection and planned CheMin/SAM analysis, not results.",
         sources=[JPL2022], rad_period=None),
]


def build() -> list[dict]:
    """Attach NASA waypoint positions (longest occupancy within the documented sols) and measured RAD context."""
    obs_path = C.PROC / "observations.json"
    stops = json.loads(obs_path.read_text())["stops"] if obs_path.exists() else []
    out = []
    for t in CATALOG:
        pos = positions_during(t["sols"][0], t["sols"][1] + 1)
        p = max(pos, key=lambda q: q["weight"])
        rad = next((s for s in stops if s["rmc"] == p["rmc"] and s.get("E_mean") is not None), None)
        a = ACTIVITY[t["activity"]]
        out.append(dict(t, x=p["x"], y=p["y"], z=p["z"], waypoint=dict(rmc=p["rmc"], sol=p["sol"], occupancy_sols=p["weight"]),
                        activity_label=a["label"], duration_h=a["duration_h"], work_radius_m=a["work_radius_m"],
                        assumption_note="Activity type, duration and work radius are MarsShield planning assumptions, not Curiosity data.",
                        measured_rad=None if rad is None else dict(
                            sol=rad["sol"], utc_start=rad.get("utc_start"), utc_end=rad.get("utc_end"),
                            E_mean_uGy_d=rad["E_mean"], E_sem=rad.get("E_sem"), n_obs=rad["n_obs"],
                            local_anomaly=rad.get("anomaly_obs"), data_sols=rad.get("data_sols"))))
    return out


if __name__ == "__main__":
    for t in build():
        print(t["id"], round(t["x"]), round(t["y"]), t["waypoint"], t["measured_rad"] and round(t["measured_rad"]["E_mean_uGy_d"], 1))
