// node site/test.mjs            run the suite against ser.js and data.json
// node site/test.mjs --plants   also run it against planted faults, each of which must red it
import { readFileSync, writeFileSync, mkdtempSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const data = JSON.parse(readFileSync(join(HERE, 'data.json'), 'utf8'));

// Madrid wall-clock times, written with their UTC offset: CET +01:00, CEST +02:00.
const at = s => new Date(s);
let checks = 0;

async function suite(mod) {
  const { serNow, serAt, indexSegments, nearestParks, serviceOn } = mod;
  const fails = [];
  const eq = (name, got, want) => { checks++; if (got !== want) fails.push(`${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); };
  const hol = data.hol;
  const r = (c, t) => serNow(c, at(t), hol);

  // Ordinary weekday, morning and evening.
  eq('mon 10:00 verde paid', r('Verde', '2026-11-16T10:00+01:00').text, 'De pago hasta las 21:00');
  eq('mon 10:00 verde leave', r('Verde', '2026-11-16T10:00+01:00').leave, 'Si aparcas ahora: hasta las 12:00');
  eq('mon 20:00 verde leave', r('Verde', '2026-11-16T20:00+01:00').leave,
    'Si aparcas ahora: el servicio acaba a las 21:00 y el coche puede quedarse hasta mañana a las 9:00');
  eq('mon 21:00 free', r('Azul', '2026-11-16T21:00+01:00').text, 'Gratis ahora (fuera de horario)');
  eq('mon 08:59 free', r('Azul', '2026-11-16T08:59+01:00').text, 'Gratis ahora (aún no empieza)');
  eq('mon 08:59 next', r('Azul', '2026-11-16T08:59+01:00').next, 'De pago desde hoy a las 9:00');
  eq('alta rotación 45 min', r('Alta Rotación', '2026-11-16T10:00+01:00').leave, 'Si aparcas ahora: hasta las 10:45');
  // The other two maximum stays. Both were unasserted: azul's 4 h survived maxMin=999, and
  // rojo was not named anywhere in this file, though data.json has 33 rojo segments.
  eq('azul 4 h', r('Azul', '2026-11-16T10:00+01:00').leave, 'Si aparcas ahora: hasta las 14:00');
  eq('rojo 4 h', r('Rojo', '2026-11-16T10:00+01:00').leave, 'Si aparcas ahora: hasta las 14:00');
  eq('rojo paid', r('Rojo', '2026-11-16T10:00+01:00').text, 'De pago hasta las 21:00');
  eq('naranja whole day', r('Naranja', '2026-11-16T09:00+01:00').leave,
    'Si aparcas ahora: el servicio acaba a las 21:00 y el coche puede quedarse hasta mañana a las 9:00');

  // Saturday: 9-15, and Sunday is skipped when naming the next start.
  eq('sat 14:00 paid', r('Verde', '2026-11-14T14:00+01:00').text, 'De pago hasta las 15:00');
  eq('sat 16:00 next', r('Verde', '2026-11-14T16:00+01:00').next, 'De pago desde el lunes a las 9:00');
  eq('sun free', r('Verde', '2026-11-15T12:00+01:00').text, 'Gratis ahora (domingo)');

  // Festivos from the city's calendar: today (Almudena), and a run of them in December.
  eq('almudena', r('Verde', '2026-11-09T10:00+01:00').text, 'Gratis ahora (festivo: Nuestra Señora de la Almudena)');
  eq('almudena next', r('Verde', '2026-11-09T10:00+01:00').next, 'De pago desde mañana a las 9:00');
  eq('puente next', r('Azul', '2026-12-05T16:00+01:00').next, 'De pago desde el miércoles a las 9:00');

  // Short days: August and 24/31 December.
  eq('aug 10:00', r('Azul', '2027-08-10T10:00+02:00').text, 'De pago hasta las 15:00');
  eq('aug 16:00', r('Azul', '2027-08-10T16:00+02:00').text, 'Gratis ahora (fuera de horario)');
  eq('dec 24 13:00 azul', r('Azul', '2026-12-24T13:00+01:00').leave,
    'Si aparcas ahora: el servicio acaba a las 15:00 y el coche puede quedarse hasta el sábado a las 9:00');
  eq('july is ordinary', serviceOn('2027-07-13', hol).to, 1260);

  // Daylight saving: the first weekday after the March change, in CEST.
  eq('dst 08:59', r('Verde', '2027-03-29T08:59+02:00').paid, false);
  eq('dst 09:00', r('Verde', '2027-03-29T09:00+02:00').paid, true);

  // The phone's own zone must not matter: the same instant, built from UTC.
  eq('utc instant', serNow('Verde', new Date(Date.UTC(2026, 10, 16, 19, 30)), hol).text, 'De pago hasta las 21:00');

  // Lookup: a segment's own point finds its colour at 0 m; a point in California finds nothing.
  const idx = indexSegments(data);
  for (const i of [0, 777, 20000, data.seg.length - 1]) {
    const s = data.seg[i], hit = serAt({ lat: s[0], lon: s[1] }, idx);
    eq(`seg ${i} colour`, hit[0] && hit[0].m === 0 && hit.some(h => h.colour === data.col[s[2]]), true);
  }
  // A probe in the cell south of a segment that sits just above a cell edge, chosen so that
  // nothing in the probe's own cell is as close: only the 3x3 read can find the nearest hit.
  const { metres } = mod;
  let probe = null;
  for (const s of data.seg) {
    if (s[0] / idx.cell - Math.floor(s[0] / idx.cell) > 0.05) continue;
    const p = { lat: Math.floor(s[0] / idx.cell) * idx.cell - 0.00003, lon: s[1] };
    const d = metres(p, { lat: s[0], lon: s[1] });
    const own = idx.grid.get(`${Math.floor(p.lat / idx.cell)},${Math.floor(p.lon / idx.cell)}`) || [];
    if (own.every(i => metres(p, { lat: data.seg[i][0], lon: data.seg[i][1] }) > d + 5)) { probe = { p, d }; break; }
  }
  eq('edge probe exists', !!probe, true);
  if (probe) {
    // Reference: brute force over every segment, independent of the grid.
    const best = Math.round(Math.min(...data.seg.map(s => metres(probe.p, { lat: s[0], lon: s[1] }))));
    eq('across a cell edge', (serAt(probe.p, idx)[0] || {}).m, best);
  }
  eq('stanford empty', serAt({ lat: 37.4275, lon: -122.1697 }, idx).length, 0);
  eq('parks sorted', nearestParks({ lat: 40.4168, lon: -3.7038 }, data).every((p, i, a) => !i || a[i - 1].m <= p.m), true);

  // mutation-audit 2026-11-11: what the checks above never pinned.
  // serAt against brute force over every segment (no grid), on probes scattered around and
  // between real segments: nearest per colour within 50 m, with street/number/spaces decoded
  // from build_data.py's documented layout [lat, lon, colour, spaces, street, number].
  const brute = (p) => {
    const best = new Map();
    data.seg.forEach((g) => {
      const m = metres(p, { lat: g[0], lon: g[1] });
      if (m <= 50 && !(best.has(g[2]) && best.get(g[2]).m0 <= m)) best.set(g[2], { m0: m, g });
    });
    return [...best.values()].sort((x, y) => x.m0 - y.m0).map(({ m0, g }) =>
      [data.col[g[2]], Math.round(m0), data.str[g[4]], g[5], g[3]].join('|')).join(' ; ');
  };
  let seed = 3, mism = 0, multi = 0;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let t = 0; t < 120; t++) {
    const g = data.seg[Math.floor(rnd() * data.seg.length)];
    const p = { lat: g[0] + (rnd() - 0.5) * 0.0012, lon: g[1] + (rnd() - 0.5) * 0.0016 };
    const got = serAt(p, idx).map((h) => [h.colour, h.m, h.street, h.number, h.spaces].join('|')).join(' ; ');
    if (got !== brute(p)) mism++;
    if (got.includes(' ; ')) multi++;
  }
  eq('serAt matches brute force on 120 probes', mism, 0);
  eq('...and the probes include multi-colour spots (else dedupe is untested)', multi > 5, true);
  // Exactly where the 50 m edge falls: a segment with nothing else within 80 m, probed due east.
  let lone = null;
  for (const g of data.seg) {
    const near = idx.grid.get(`${Math.floor(g[0] / idx.cell)},${Math.floor(g[1] / idx.cell)}`) || [];
    if (data.seg.every((h) => h === g || metres({ lat: g[0], lon: g[1] }, { lat: h[0], lon: h[1] }) > 80)) { lone = g; break; }
    if (near.length > 1) continue;
  }
  eq('a lone segment exists', !!lone, true);
  if (lone) {
    const east = (m) => ({ lat: lone[0], lon: lone[1] + m / (111320 * Math.cos(lone[0] * Math.PI / 180)) });
    eq('49.6 m east is found, 50.4 m east is not', [serAt(east(49.6), idx).length, serAt(east(50.4), idx).length].join(), '1,0');
  }
  eq('1 degree of latitude is 111,320 m (the equirectangular convention)', metres({ lat: 40.4, lon: -3.7 }, { lat: 40.41, lon: -3.7 }).toFixed(3), '1113.200');
  eq('east-west shrinks by cos(lat)', metres({ lat: 60, lon: 0 }, { lat: 60, lon: 0.01 }).toFixed(3), (1113.2 * Math.cos(Math.PI / 3)).toFixed(3));
  eq('no position, no answer', [serAt(null, idx), serAt({ lat: NaN, lon: -3.7 }, idx), serAt({ lat: 40.4, lon: 'x' }, idx),
    nearestParks(null, data), nearestParks({ lat: NaN, lon: 1 }, data)].map((x) => x.length).join(), '0,0,0,0,0');
  const parks = nearestParks({ lat: 40.4168, lon: -3.7038 }, data);
  const bestPark = Math.min(...data.parks.map((q) => Math.round(metres({ lat: 40.4168, lon: -3.7038 }, { lat: q[1], lon: q[2] }))));
  eq('three parks by default, the nearest first', [parks.length, parks[0].m].join(), `3,${bestPark}`);
  // the clock reads minutes, and the stay text for every colour
  eq('mon 14:37 verde leave', r('Verde', '2026-11-16T14:37+01:00').leave, 'Si aparcas ahora: hasta las 16:37');
  eq('stay texts', ['Verde', 'Azul', 'Alta Rotación', 'Rojo', 'Naranja'].map((c) => r(c, '2026-11-16T10:00+01:00').stay).join(' / '),
    'Máximo 2 h (no residentes; residentes del barrio sin límite) / Máximo 4 h (cualquier usuario) / Máximo 45 min (salvo otra señal) / Máximo 4 h (cualquier usuario) / Máximo 12 h (un solo tique, 0,50 €/h)');
  // a long run of festivos: the label gains the date from 7 days out; past 30 days, no next start
  const run = (k) => Object.fromEntries(Array.from({ length: k }, (_, i) => [new Date(Date.UTC(2026, 10, 17 + i)).toISOString().slice(0, 10), '']));
  eq('next start 5 days out has no date', serNow('Verde', at('2026-11-16T22:00+01:00'), run(4)).next, 'De pago desde el sábado a las 9:00');
  eq('next start 7 days out names the date', serNow('Verde', at('2026-11-16T22:00+01:00'), run(6)).next, 'De pago desde el lunes 23 nov a las 9:00');
  eq('next start 29 days out is found', serNow('Verde', at('2026-11-16T22:00+01:00'), run(28)).next, 'De pago desde el martes 15 dic a las 9:00');
  eq('a start exactly 30 days out is past the window', serNow('Verde', at('2026-11-16T22:00+01:00'), run(29)).next, '');
  eq('no start within 30 days says so', serNow('Verde', at('2026-11-16T20:30+01:00'), run(40)).leave,
    'Si aparcas ahora: el servicio acaba a las 21:00 y el coche puede quedarse hasta el próximo día de servicio');
  eq('...and leaves next empty', serNow('Verde', at('2026-11-16T22:00+01:00'), run(40)).next, '');

  // The data agrees with the raw CSV's colour counts (calles-ser-2026-09-30.csv).
  const counts = data.col.map((_, k) => data.seg.filter(s => s[2] === k).length);
  eq('colour counts', counts.join(','), '30190,4150,73,57,33');
  return fails;
}

const fails = await suite(await import('./ser.js'));
const ran = checks;
for (const f of fails) console.log('FAIL', f);
console.log(`${ran - fails.length} passed, ${fails.length} failed`);   // the shape bin/mutate and lab test read
let bad = fails.length;

if (process.argv.includes('--plants')) {
  // Each plant changes one rule in a copy of ser.js; the suite must red on every one.
  const src = readFileSync(join(HERE, 'ser.js'), 'utf8');
  const PLANTS = {
    'weekday ends at 20': ["return { from: 540, to: 1260 };", "return { from: 540, to: 1200 };"],
    'august forgotten': ["md.startsWith('08-') || ", ''],
    'festivos ignored': ['if (hol[ymd] !== undefined)', 'if (false)'],
    'verde 4 h': ["'Verde': { name: 'plaza verde', maxMin: 120", "'Verde': { name: 'plaza verde', maxMin: 240"],
    'azul 2 h': ["'Azul': { name: 'plaza azul', maxMin: 240", "'Azul': { name: 'plaza azul', maxMin: 120"],
    'rojo 2 h': ["'Rojo': { name: 'ámbito hospitalario (rojo)', maxMin: 240", "'Rojo': { name: 'ámbito hospitalario (rojo)', maxMin: 120"],
    'clock in UTC': ["timeZone: 'Europe/Madrid'", "timeZone: 'UTC'"],
    'lookup off by a cell': ['for (let di = -1; di <= 1; di++)', 'for (let di = 0; di <= 0; di++)'],
  };
  const dir = mkdtempSync(join(tmpdir(), 'madrid-ser-plant-'));
  for (const [name, [from, to]] of Object.entries(PLANTS)) {
    if (!src.includes(from)) { console.log(`PLANT ${name}: anchor not found, fix the plant`); bad++; continue; }
    const f = join(dir, `${name.replace(/\W+/g, '-')}.mjs`);
    writeFileSync(f, src.replace(from, to));
    const n = (await suite(await import(pathToFileURL(f).href))).length;
    console.log(`PLANT ${name}: ${n ? `red (${n} failures)` : 'GREEN — the suite cannot see this fault'}`);
    if (!n) bad++;
  }
}
process.exit(bad ? 1 : 0);
