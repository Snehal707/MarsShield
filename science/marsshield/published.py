"""Published reference values, transcribed verbatim (used ONLY for validation, never as model input
for the site being validated).

Guo et al. (2026) JGR Planets 131, e2026JE009704, Table 1 and Section 3 (sol windows).
Ehresmann et al. (2021) JGR Planets 126, e2021JE006851 (Butte M12).
"""

# period: (site, sol_start, sol_end, D_RAD [uGy/d], measured decrease [frac or None], phi [MV],
#          D_GCRH, D_GCRHe, D_sky [uGy/d], D_sky decrease, ROS_integrated, Dalb_FT, FT albedo proportion [%])
GUO2026_TABLE1 = {
    "BG1":  ("Tower Buttes",       2643.5, 2657.5, 313.9, None,  384.5, 181.7, 35.0, 238.3, None,  0.079, 70.0, 21.5),
    "P1":   ("Tower Buttes",       2664.5, 2691.5, 301.3, 0.040, 383.9, 169.0, 33.6, 222.8, 0.065, 0.137, 69.0, 21.3),
    "BG2":  ("Tower Buttes",       2702.0, 2729.0, 323.5, None,  383.7, 186.5, 35.5, 244.2, None,  0.054, 75.2, 22.7),
    "P2":   ("Tower Buttes",       2734.5, 2742.5, 300.5, 0.071, 384.4, 165.9, 33.2, 219.0, 0.103, 0.148, 71.0, 21.7),
    "BG3":  ("Bloodstone Hill",    2790.5, 2795.5, 318.5, None,  382.8, 183.2, 35.1, 240.1, None,  0.072, 73.1, 22.2),
    "P3":   ("Bloodstone Hill",    2797.6, 2800.6, 297.8, 0.065, 381.9, 170.5, 33.5, 224.5, 0.065, 0.127, 65.0, 20.2),
    "BG45": ("Mt Mercou",          3052.6, 3072.6, 290.5, None,  396.4, 167.0, 33.5, 222.7, None,  0.118, 60.6, 19.4),
    "P4":   ("Mt Mercou",          3072.6, 3074.6, 279.3, 0.038, 403.7, 161.5, 32.5, 213.3, 0.042, 0.144, 57.7, 18.8),
    "P5":   ("Mt Mercou",          3076.6, 3079.6, 284.4, 0.021, 410.8, 165.9, 33.1, 218.9, 0.017, 0.114, 58.8, 19.3),
    "BG6":  ("Maria Gordon Notch", 3326.6, 3329.6, 285.1, None,  413.7, 152.4, 31.6, 202.5, None,  0.180, 70.0, 22.2),
    "P6":   ("Maria Gordon Notch", 3324.6, 3326.6, 229.8, 0.194, 403.0, 114.9, 24.8, 153.7, 0.241, 0.379, 55.2, 18.1),
    "BG7":  ("Paraitepuy",         3560.6, 3563.6, 215.5, None,  591.9, 106.7, 26.2, 146.2, None,  0.221, 56.8, 22.9),
    "P7":   ("Paraitepuy",         3564.6, 3565.6, 190.4, 0.098, 591.1,  90.2, 23.3, 124.9, 0.146, 0.328, 52.4, 21.5),
    "BG8":  ("Paraitepuy",         3571.6, 3576.6, 224.3, None,  568.8, 118.8, 28.2, 161.7, None,  0.178, 53.1, 21.3),
    "P8":   ("Paraitepuy",         3567.5, 3570.5, 202.0, 0.099, 624.1,  91.0, 23.7, 126.0, 0.220, 0.296, 58.6, 24.2),
}
FIELDS = ("site", "sol_start", "sol_end", "D_RAD", "meas_decrease", "phi", "D_GCRH", "D_GCRHe",
          "D_sky", "D_sky_decrease", "ROS_int", "Dalb_FT", "FT_albedo_pct")

# parking period -> its background period (Guo et al. 2026 Section 3)
PAIRS = {"P1": "BG1", "P2": "BG2", "P3": "BG3", "P4": "BG45", "P5": "BG45",
         "P6": "BG6", "P7": "BG7", "P8": "BG8"}

# Ehresmann et al. (2021): Butte M12, sols 1456-1467, 19 % of sky blocked, -4 % dose rate,
# -7.5 % neutral particles. Guo et al. (2021): (5 +/- 1) % decrease, modeled ~12 % downward decrease.
M12 = dict(sol_start=1456, sol_end=1467, blocked_sky=0.19, dose_decrease=0.04,
           neutral_decrease=0.075, dose_decrease_guo2021=0.05)


def table1(period: str) -> dict:
    return dict(zip(FIELDS, GUO2026_TABLE1[period]))
