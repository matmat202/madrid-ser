/* The scrolling story: each <section class="step"> names a layout in data-step; as the
 * reader scrolls into a step, the chart redraws in that layout. Numbers in the prose are
 * not typed in: a <b data-fact="..."> is computed here from story.json and the page's own
 * ../data.json, and test/story.test.mjs checks each against the `check` block
 * build_story.py computed in python. Copied from metamer-day/site/story. */
import { layout, stats, STEPS } from './layout.js';

const pct = (v) => `${Math.round(v * 100)}\u00a0%`;
/* Spanish thousands with a point, 4-digit numbers too, whatever the browser's ICU */
const int = (v) => String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const metres = (v) => `${Math.round(v)}\u00a0m`;

/* Unknown names throw: a typo must not render as blank */
export function fact(D, f) {
  const S = stats(D);
  switch (f) {
    case 'n_seg': case 'spaces': case 'blue': case 'centro_seg': case 'centro_spaces': case 'centro_blue':
    case 'inside': case 'edge': case 'n_green': return int(S[f]);
    case 'blue_share': case 'inner_share': case 'outer_share': case 'far': return pct(S[f]);
    case 'blue_sol': case 'gap_median': case 'gap_p90': case 'gap_out_median': case 'null_median': case 'null_out_median': case 'null_p90': return metres(S[f]);
    case 'seeds': return String(D.seeds.length);
    default: throw new Error(`unknown fact ${f}`);
  }
}

const NS = 'http://www.w3.org/2000/svg';
const el = (tag, attrs = {}) => { const e = document.createElementNS(NS, tag); for (const k in attrs) if (attrs[k] != null) e.setAttribute(k, attrs[k]); return e; };

async function main() {
  const [D, page] = await Promise.all(['story.json', '../data.json'].map(async (u) => (await fetch(u)).json()));
  D.page = page;
  for (const e of document.querySelectorAll('[data-fact]')) e.textContent = fact(D, e.dataset.fact);
  const steps = [...document.querySelectorAll('.step')];
  for (const s of steps) if (!STEPS[s.dataset.step]) throw new Error(`unknown step ${s.dataset.step}`);
  const plot = document.getElementById('plot');
  const svg = el('svg', { id: 'chart' });
  const gAxis = el('g', { class: 'axis' }), gS = el('g'), gLab = el('g', { class: 'labels' });
  svg.append(gAxis, gS, gLab);
  plot.append(svg);
  const tick = (g, x, y, text, cls = 'tick') => { const t = el('text', { x, y, class: cls }); t.textContent = text; g.append(t); };
  const grid = (x1, y1, x2, y2, cls = 'grid') => gAxis.append(el('line', { x1, x2, y1, y2, class: cls }));

  let shown = -1;
  const draw = (i) => {
    const name = steps[i].dataset.step;
    const box = plot.getBoundingClientRect(), W = box.width, H = box.height;
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    const L = layout(name, D, W, H);
    const narrow = W < 420;
    gAxis.replaceChildren(); gLab.replaceChildren();
    if (STEPS[name] === 'plane') {
      for (const [x, label] of L.xt) { grid(x, L.T, x, L.B); tick(gAxis, x + 2, L.B + 15, label); }
      for (const [y, label] of L.yt) { grid(L.L, y, L.R, y); tick(gAxis, L.L + 2, y - 3, label); }
      tick(gLab, L.cx + 4, L.cy - 4, 'Sol', 'tick lab');
    } else {
      for (const [x, label] of L.xt) { grid(x, L.T, x, L.B); tick(gAxis, x + 2, L.B + 15, label); }
      for (const [y, label] of L.yt) tick(gAxis, L.L - 5, y, label, 'tick end');
      grid(L.L, L.B, L.R, L.B, 'grid axisline');
    }
    const cap = {
      map: narrow ? 'cada cuadro, 150 m: azul si tiene plaza azul' : 'cuadros de 150 m: azul si tiene alguna plaza azul, si no verde',
      centro: narrow ? 'distrito Centro, en negro' : `distrito Centro en negro (sus ${int(stats(D).centro_seg)} tramos), el resto atenuado`,
      rings: narrow ? 'plazas azules, por anillo de 500 m' : 'parte azul de las plazas SER, por anillos de 500 m desde Sol',
      gap: narrow ? 'de un tramo verde a la azul más cercana' : 'de cada tramo verde a la azul más cercana; contorno: azules al azar',
      zbe: narrow ? 'ZBE Centro: dentro, y su borde' : 'ZBE Distrito Centro: dentro (ocre), calles del perímetro (negro)',
    }[name];
    tick(gAxis, 4, L.T - 9, cap, 'tick cat');
    gS.replaceChildren();
    for (const m of L.marks) {
      const e = el('rect', { x: m.x, y: m.y, width: Math.max(0, m.w), height: Math.max(0, m.h), fill: m.fill, class: m.cls });
      if (m.tip) { e.append(el('title')); e.firstChild.textContent = m.tip; }
      gS.append(e);
    }
    document.body.dataset.step = i;
    window.__story = { step: i, name, shown: L.marks.length };
  };

  const pick = () => {
    const line = innerHeight * 0.5;
    let i = 0;
    for (let k = 0; k < steps.length; k++) if (steps[k].getBoundingClientRect().top < line) i = k;
    if (i !== shown) { shown = i; draw(i); }
  };
  addEventListener('scroll', pick, { passive: true });
  addEventListener('resize', () => { shown = -1; pick(); });
  pick();
}

if (typeof document !== 'undefined') main().catch((e) => {
  document.body.classList.add('failed');
  document.getElementById('err').textContent = String(e.message || e);
  console.error(e);
});
