#!/usr/bin/env python3
"""site/data.json -> site/story/story.json: in the centre, not one blue space.

    python3 build_story.py        # stdlib only; BUILD_OUT=... writes elsewhere (publish.sh compares)

The page answers "do I pay here?" one kerb at a time. This asks where the blue spaces (4 h,
anyone) are, against the green (2 h for a visitor), on the page's own site/data.json:

  centro     segments build_data.py marks seg[6] > 0, i.e. distrito Centro, the ZBEDEP
  rings      blue share of all SER spaces, per 500 m from the Puerta del Sol
  gap        for every green segment, the distance to the nearest blue segment (metres, flat
             projection about Sol at 111,320 m a degree, as ser.js measures)

Found by looking, 2026-11-16, so the story says so and the gap carries its check:
  null       the same number of blue segments dealt at random among the same green+blue kerbs
             (Park-Miller 16807 shuffle, seeds 1-3, reproduced exactly by layout.js), once over
             the whole city and once with distrito Centro left out, so the empty centre cannot
             be what makes the blue look clumped.

test/story.test.mjs recomputes every number in `check`, and the null itself, in JS from
data.json (site/story/layout.js stats() and nullGap()) and requires the two to agree.
"""
import json, math, os

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.environ.get("BUILD_OUT", os.path.join(HERE, "site", "story", "story.json"))
SOL = (40.41689, -3.70348)       # kilometre zero, Puerta del Sol
SEEDS, RING, GAP_BIN, GAP_MAX = (1, 2, 3), 500, 20, 400
KX = 111320 * math.cos(SOL[0] * math.pi / 180)


def xy(s):
    return ((s[1] - SOL[1]) * KX, (s[0] - SOL[0]) * 111320)


def median(v):
    s = sorted(v)
    k = len(s) // 2
    return s[k] if len(s) % 2 else (s[k - 1] + s[k]) / 2


def p90(v):
    return sorted(v)[int(len(v) * 0.9)]


def nearest(src, dst, cell=200):
    """Exact nearest-neighbour distance from each src point to the dst set, by grid rings."""
    g = {}
    for x, y in dst:
        g.setdefault((math.floor(x / cell), math.floor(y / cell)), []).append((x, y))
    out = []
    for x, y in src:
        ci, cj, best, r = math.floor(x / cell), math.floor(y / cell), math.inf, 1
        while True:
            for i in range(ci - r, ci + r + 1):
                for j in range(cj - r, cj + r + 1):
                    for a, b in g.get((i, j), ()):
                        d = (a - x) ** 2 + (b - y) ** 2
                        if d < best:
                            best = d
            # every point not yet read is at least r cells away
            if best <= (r * cell) ** 2:
                break
            r += 1
        out.append(math.sqrt(best))
    return out


def shuffled(n, seed):
    a, s = list(range(n)), seed
    for i in range(n - 1, 0, -1):
        s = s * 16807 % 2147483647
        j = s % (i + 1)
        a[i], a[j] = a[j], a[i]
    return a


def gap(pool):
    """pool: [(x, y, is_blue)] -> distances from each green to the nearest blue."""
    return nearest([(x, y) for x, y, b in pool if not b], [(x, y) for x, y, b in pool if b])


def null_gap(pool, seed):
    nb = sum(b for _, _, b in pool)
    blue = set(shuffled(len(pool), seed)[:nb])
    return gap([(x, y, i in blue) for i, (x, y, _) in enumerate(pool)])


def hist(d):
    h = [0] * (GAP_MAX // GAP_BIN + 1)        # the last bin is "400 m or more"
    for v in d:
        h[min(len(h) - 1, int(v // GAP_BIN))] += 1
    return h


def main():
    P = json.load(open(os.path.join(HERE, "site", "data.json")))
    seg = P["seg"]
    pts = [xy(s) for s in seg]
    vb = [(x, y, s[2] == 1) for (x, y), s in zip(pts, seg) if s[2] in (0, 1)]
    vb_out = [(x, y, s[2] == 1) for (x, y), s in zip(pts, seg) if s[2] in (0, 1) and not s[6]]
    real, real_out = gap(vb), gap(vb_out)
    null = {"all": [], "out": []}
    for seed in SEEDS:
        for k, pool in (("all", vb), ("out", vb_out)):
            d = null_gap(pool, seed)
            null[k].append({"seed": seed, "median": median(d), "p90": p90(d), "hist": hist(d) if seed == SEEDS[0] else None})

    spaces = sum(s[3] for s in seg)
    blue = sum(s[3] for s in seg if s[2] == 1)
    centro = [s for s in seg if s[6]]
    rings = {}
    for (x, y), s in zip(pts, seg):
        r = rings.setdefault(int(math.hypot(x, y) // RING), [0, 0])
        r[0] += s[3]
        r[1] += s[3] * (s[2] == 1)
    inner = [rings.get(k, [0, 0]) for k in range(2)]
    outer = [v for k, v in rings.items() if k >= 2]
    share = lambda rs: sum(r[1] for r in rs) / sum(r[0] for r in rs)
    D = {"source": "the page's site/data.json (calles-ser-2026-09-30.csv, datos.madrid.es, CC BY 4.0)",
         "sol": SOL, "ring": RING, "gap_bin": GAP_BIN, "gap_max": GAP_MAX, "seeds": list(SEEDS), "null": null}
    D["check"] = {
        "n_seg": len(seg), "spaces": spaces, "blue": blue, "blue_share": blue / spaces,
        "centro_seg": len(centro), "centro_spaces": sum(s[3] for s in centro),
        "centro_blue": sum(s[3] for s in centro if s[2] == 1),
        "inside": sum(s[6] == 1 for s in seg), "edge": sum(s[6] == 2 for s in seg),
        "blue_sol": min(math.hypot(x, y) for (x, y), s in zip(pts, seg) if s[2] == 1),
        "inner_share": share(inner), "outer_share": share(outer),
        "n_green": len(real), "gap_median": median(real), "gap_p90": p90(real),
        "gap_out_median": median(real_out), "gap_hist": hist(real),
        "far": sum(v >= 200 for v in real) / len(real),
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        json.dump(D, f, ensure_ascii=False, separators=(",", ":"))
        f.write("\n")
    c = D["check"]
    print("  ".join(f"{k} {round(v, 3) if isinstance(v, float) else v}" for k, v in c.items() if k != "gap_hist"))
    print("null:", {k: [(n["median"], n["p90"]) for n in v] for k, v in null.items()})


if __name__ == "__main__":
    main()
