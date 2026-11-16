/* Where every mark sits on each step of the story. Pure: no DOM, so test/story.test.mjs
 * runs every layout at several plot sizes. Modelled on metamer-day/site/story.
 *
 * D is story.json with the page's own data.json attached as D.page. Three steps draw the
 * map (north up, one square per 150 m cell holding any SER segment), two draw bars:
 *   "map":    every cell, blue if it holds a blue space, else green (or another colour's)
 *   "centro": the same, distrito Centro's cells at full strength and the rest dimmed
 *   "rings":  x = km from the Puerta del Sol, the blue share of SER spaces per 500 m ring
 *   "gap":    x = metres from a green segment to the nearest blue; bars the city, outline
 *             the same blue dealt at random (seed 1)
 *   "zbe":    the map again: inside the ZBE, on its perimeter streets, and the rest dimmed
 */
export const STEPS = { map: 'plane', centro: 'plane', rings: 'bars', gap: 'bars', zbe: 'plane' };
export const CELL = 150;
export const INK = { green: '#1f7a45', blue: '#1f5fbf', other: '#8a857e', centro: '#1d1a18', inside: '#a8730f', edge: '#1d1a18' };

export const median = (xs) => { const s = [...xs].sort((a, b) => a - b), k = s.length >> 1; return s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2; };
const p90 = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length * 0.9)];
const memo = new WeakMap();

/* metres east and north of Sol, as build_story.py's xy() */
export function project(D) {
  const [la0, lo0] = D.sol, kx = 111320 * Math.cos((la0 * Math.PI) / 180);
  return D.page.seg.map((s) => [(s[1] - lo0) * kx, (s[0] - la0) * 111320]);
}

/* exact nearest distance from each src point to dst, by grid rings (build_story.py nearest()) */
export function nearest(src, dst, cell = 200) {
  const g = new Map();
  for (const [x, y] of dst) { const k = `${Math.floor(x / cell)},${Math.floor(y / cell)}`; if (!g.has(k)) g.set(k, []); g.get(k).push([x, y]); }
  return src.map(([x, y]) => {
    const ci = Math.floor(x / cell), cj = Math.floor(y / cell);
    let best = Infinity;
    for (let r = 1; ; r++) {
      for (let i = ci - r; i <= ci + r; i++) for (let j = cj - r; j <= cj + r; j++)
        for (const [a, b] of g.get(`${i},${j}`) || []) { const d = (a - x) ** 2 + (b - y) ** 2; if (d < best) best = d; }
      if (best <= (r * cell) ** 2) break;
    }
    return Math.sqrt(best);
  });
}

const gap = (pool) => nearest(pool.filter((p) => !p[2]), pool.filter((p) => p[2]));
/* the seeded Park-Miller shuffle build_story.py uses: 16807 * s stays below 2^53 */
export function shuffled(n, seed) {
  const a = Array.from({ length: n }, (_, i) => i);
  let s = seed;
  for (let i = n - 1; i > 0; i--) { s = (s * 16807) % 2147483647; const j = s % (i + 1); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
export function hist(d, D) {
  const h = Array(D.gap_max / D.gap_bin + 1).fill(0);
  for (const v of d) h[Math.min(h.length - 1, Math.floor(v / D.gap_bin))]++;
  return h;
}
function pools(D) {
  const P = project(D), seg = D.page.seg, all = [], out = [];
  seg.forEach((s, i) => { if (s[2] > 1) return; const p = [P[i][0], P[i][1], s[2] === 1]; all.push(p); if (!s[6]) out.push(p); });
  return { all, out };
}
/* the null, recomputed: slow-ish (six nearest-neighbour passes), so only the test calls it */
export function nullGap(D) {
  const pl = pools(D), res = { all: [], out: [] };
  for (const seed of D.seeds) for (const k of ['all', 'out']) {
    const pool = pl[k], nb = pool.filter((p) => p[2]).length, blue = new Set(shuffled(pool.length, seed).slice(0, nb));
    const d = gap(pool.map((p, i) => [p[0], p[1], blue.has(i)]));
    res[k].push({ seed, median: median(d), p90: p90(d), hist: seed === D.seeds[0] ? hist(d, D) : null });
  }
  return res;
}

/* -> the numbers the story quotes; build_story.py's `check` holds the same */
export function stats(D) {
  if (memo.has(D)) return memo.get(D);
  const seg = D.page.seg, P = project(D), pl = pools(D);
  const real = gap(pl.all), realOut = gap(pl.out);
  const sum = (xs, f) => xs.reduce((a, s) => a + f(s), 0);
  const spaces = sum(seg, (s) => s[3]), blue = sum(seg, (s) => (s[2] === 1 ? s[3] : 0));
  const centro = seg.filter((s) => s[6]);
  const rings = new Map();
  seg.forEach((s, i) => { const k = Math.floor(Math.hypot(...P[i]) / D.ring); const r = rings.get(k) || [0, 0]; r[0] += s[3]; r[1] += s[2] === 1 ? s[3] : 0; rings.set(k, r); });
  const share = (rs) => sum(rs, (r) => r[1]) / sum(rs, (r) => r[0]);
  const ringList = [...rings.entries()].sort((a, b) => a[0] - b[0]);
  let blueSol = Infinity;
  seg.forEach((s, i) => { if (s[2] === 1) blueSol = Math.min(blueSol, Math.hypot(...P[i])); });
  const nm = (k) => median(D.null[k].map((n) => n.median));
  const S = {
    n_seg: seg.length, spaces, blue, blue_share: blue / spaces,
    centro_seg: centro.length, centro_spaces: sum(centro, (s) => s[3]), centro_blue: sum(centro, (s) => (s[2] === 1 ? s[3] : 0)),
    inside: seg.filter((s) => s[6] === 1).length, edge: seg.filter((s) => s[6] === 2).length,
    blue_sol: blueSol,
    inner_share: share([0, 1].map((k) => rings.get(k) || [0, 0])), outer_share: share(ringList.filter(([k]) => k >= 2).map(([, r]) => r)),
    n_green: real.length, gap_median: median(real), gap_p90: p90(real), gap_out_median: median(realOut), gap_hist: hist(real, D),
    far: real.filter((v) => v >= 200).length / real.length,
    // derived, not in check: the null's middle seed, and the rings as bars
    null_median: nm('all'), null_out_median: nm('out'), null_p90: median(D.null.all.map((n) => n.p90)),
    rings: ringList.filter(([, r]) => r[0] >= 200).map(([k, r]) => ({ k, spaces: r[0], share: r[1] / r[0] })),
  };
  memo.set(D, S);
  return S;
}

function cells(D) {
  const P = project(D), m = new Map();
  D.page.seg.forEach((s, i) => {
    const k = `${Math.floor(P[i][0] / CELL)},${Math.floor(P[i][1] / CELL)}`;
    const c = m.get(k) || { i: Math.floor(P[i][0] / CELL), j: Math.floor(P[i][1] / CELL), blue: 0, green: 0, other: 0, zbe: 0 };
    if (s[2] === 1) c.blue += s[3]; else if (s[2] === 0) c.green += s[3]; else c.other += s[3];
    c.zbe = Math.max(c.zbe, s[6] === 1 ? 2 : s[6] === 2 ? 1 : 0);   // inside outranks edge
    m.set(k, c);
  });
  return [...m.values()];
}

/* -> { L, R, T, B, xt: [[x, label]], yt: [[y, label]], X, Y, marks } */
export function layout(name, D, W, H) {
  const kind = STEPS[name];
  if (!kind) throw new Error(`unknown step ${name}`);
  const L = 34, R = W - 8, T = 22, B = H - 22;
  if (kind === 'plane') {
    const C = memo.get(cells) || new WeakMap(); memo.set(cells, C);
    if (!C.has(D)) C.set(D, cells(D));
    const cs = C.get(D);
    const i0 = Math.min(...cs.map((c) => c.i)), i1 = Math.max(...cs.map((c) => c.i)) + 1;
    const j0 = Math.min(...cs.map((c) => c.j)), j1 = Math.max(...cs.map((c) => c.j)) + 1;
    const k = Math.min((R - L) / ((i1 - i0) * CELL), (B - T) / ((j1 - j0) * CELL));      // px per metre, one scale both ways
    const ox = L + ((R - L) - (i1 - i0) * CELL * k) / 2, oy = T + ((B - T) - (j1 - j0) * CELL * k) / 2;
    const X = (m) => ox + (m - i0 * CELL) * k, Y = (m) => oy + (j1 * CELL - m) * k;
    const sz = Math.max(1, CELL * k);
    const marks = cs.map((c) => {
      let fill = c.blue ? INK.blue : c.green ? INK.green : INK.other, cls = 'cell';
      if (name === 'centro') { if (c.zbe) fill = c.blue ? INK.blue : INK.centro; else cls = 'cell dim'; }
      if (name === 'zbe') { if (c.zbe === 2) fill = INK.inside; else if (c.zbe === 1) fill = INK.edge; else cls = 'cell dim'; }
      return { kind: 'rect', x: X(c.i * CELL), y: Y((c.j + 1) * CELL), w: sz, h: sz, fill, cls,
        tip: `${c.green} verdes, ${c.blue} azules${c.other ? `, ${c.other} de otro color` : ''}` };
    });
    const xt = [], yt = [];
    for (let km = -12, st = R - L < 400 ? 4 : 2; km <= 12; km += st) {
      const x = X(km * 1000), y = Y(km * 1000);
      if (x >= L && x <= R) xt.push([x, km ? `${km} km` : 'Sol']);
      if (km && y > T + 10 && y < B) yt.push([y, `${km > 0 ? '+' : ''}${km} km`]);
    }
    return { L, R, T, B, xt, yt, X, Y, cx: X(0), cy: Y(0), marks };
  }
  const S = stats(D);
  if (name === 'rings') {
    const n = Math.max(...S.rings.map((r) => r.k)) + 1, top = 0.2;
    const X = (k) => L + ((R - L) * k) / n, Y = (v) => B - ((B - T) * v) / top;
    const marks = S.rings.map((r) => ({ kind: 'bar', x: X(r.k) + 1, w: X(r.k + 1) - X(r.k) - 2, y: Y(Math.max(r.share, 0.002)), h: B - Y(Math.max(r.share, 0.002)),
      cls: r.k < 2 ? 'bar hot' : 'bar', tip: `${(r.k * D.ring / 1000).toFixed(1)}-${((r.k + 1) * D.ring / 1000).toFixed(1)} km: ${Math.round(r.share * 1000) / 10}% azul de ${r.spaces} plazas` }));
    const xt = []; for (let km = 0; km * 1000 / D.ring <= n; km += 2) xt.push([X((km * 1000) / D.ring), `${km} km`]);
    const yt = [0.05, 0.1, 0.15, 0.2].map((v) => [Y(v) + 4, `${Math.round(v * 100)}%`]);
    return { L, R, T, B, xt, yt, X, Y, marks };
  }
  // gap: the city's bars, the shuffle's outline
  const real = S.gap_hist, nul = D.null.all[0].hist, nb = real.length;
  const top = Math.max(...real, ...nul) * 1.05;
  const X = (b) => L + ((R - L) * b) / nb, Y = (v) => B - ((B - T) * v) / top;
  const marks = [];
  real.forEach((v, b) => { if (v) marks.push({ kind: 'bar', x: X(b) + 1, w: X(b + 1) - X(b) - 2, y: Y(v), h: B - Y(v), cls: 'bar g', tip: `${b * D.gap_bin}${b === nb - 1 ? '+' : `-${(b + 1) * D.gap_bin}`} m: ${v} tramos verdes` }); });
  nul.forEach((v, b) => { if (v) marks.push({ kind: 'bar', x: X(b) + 1, w: X(b + 1) - X(b) - 2, y: Y(v), h: B - Y(v), cls: 'bar null', tip: `al azar, ${b * D.gap_bin} m: ${v}` }); });
  const xt = [0, 100, 200, 300, 400].map((m) => [X(m / D.gap_bin), m === 400 ? '400+ m' : `${m} m`]);
  const yt = [2000, 4000, 6000, 8000, 10000, 12000].filter((v) => v < top).map((v) => [Y(v) + 4, String(v).replace(/\B(?=(\d{3})+(?!\d))/g, '.')]);
  return { L, R, T, B, xt, yt, X, Y, marks };
}
