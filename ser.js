/* Madrid SER: is the regulated parking at this spot paid right now, and for how long?
 *
 * Rules, from madrid.es "Servicio de Estacionamiento Regulado (SER). Horario, delimitación
 * territorial y ámbitos diferenciados" (read 2026-11-09):
 *   Lunes a viernes, no festivos           9-21 h
 *   Sábados                                9-15 h
 *   Agosto (lunes a sábado, no festivos)   9-15 h
 *   24 y 31 de diciembre                   9-15 h
 *   Domingos y festivos                    sin servicio
 * Maximum stay: verde 2 h for non-residents (residents unlimited in their own barrio), azul
 * 4 h, alta rotación 45 min unless a sign says otherwise, rojo (ADHOS, hospitals) 4 h,
 * naranja (ADD) the whole 12-hour service day on one ticket at 0,50 €/h.
 * Festivos come from the city's own calendario laboral (data.json `hol`); past its last
 * year every day is treated as ordinary, so the page says "de pago": the safe way to be wrong.
 * All times are Madrid's (Europe/Madrid) whatever zone the phone is in.
 */

export const RULES = {
  'Verde': { name: 'plaza verde', maxMin: 120, who: 'no residentes; residentes del barrio sin límite' },
  'Azul': { name: 'plaza azul', maxMin: 240, who: 'cualquier usuario' },
  'Alta Rotación': { name: 'alta rotación', maxMin: 45, who: 'salvo otra señal' },
  'Rojo': { name: 'ámbito hospitalario (rojo)', maxMin: 240, who: 'cualquier usuario' },
  'Naranja': { name: 'ámbito disuasorio (naranja)', maxMin: 720, who: 'un solo tique, 0,50 €/h' },
};

const DAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/** Weekday (0 = domingo), minutes since midnight and 'YYYY-MM-DD', in Madrid. */
export function madridClock(date) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Madrid', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date).map(x => [x.type, x.value]));
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday);
  return { day, min: (+p.hour % 24) * 60 + (+p.minute), ymd: `${p.year}-${p.month}-${p.day}` };
}

const addDays = (ymd, k) => new Date(Date.parse(ymd + 'T12:00:00Z') + k * 864e5).toISOString().slice(0, 10);
const dow = ymd => new Date(ymd + 'T12:00:00Z').getUTCDay();

/** The SER service window on a Madrid date: { from, to } in minutes, or { why } when none. */
export function serviceOn(ymd, hol = {}) {
  const d = dow(ymd);
  if (hol[ymd] !== undefined) return { why: `festivo${hol[ymd] ? ': ' + hol[ymd] : ''}` };
  if (d === 0) return { why: 'domingo' };
  const md = ymd.slice(5);
  if (d === 6 || md.startsWith('08-') || md === '12-24' || md === '12-31') return { from: 540, to: 900 };
  return { from: 540, to: 1260 };
}

const hhmm = m => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
function whenLabel(today, ymd) {
  const k = Math.round((Date.parse(ymd) - Date.parse(today)) / 864e5);
  if (k === 0) return 'hoy';
  if (k === 1) return 'mañana';
  if (k < 7) return `el ${DAYS[dow(ymd)]}`;
  return `el ${DAYS[dow(ymd)]} ${+ymd.slice(8)} ${MONTHS[+ymd.slice(5, 7) - 1]}`;
}

/** The next service start strictly after Madrid {ymd, min}: { ymd, from } or null within 30 days. */
export function nextStart(now, hol = {}) {
  for (let k = 0; k < 30; k++) {
    const ymd = addDays(now.ymd, k), s = serviceOn(ymd, hol);
    if (s.from !== undefined && (k > 0 || now.min < s.from)) return { ymd, from: s.from };
  }
  return null;
}

/**
 * The rule at `colour` for `date`:
 *   { paid: true,  text: 'De pago hasta las 21:00', stay: 'Máximo 2 h (no residentes; …)', leave: '…' }
 *   { paid: false, text: 'Gratis ahora (domingo)', next: 'De pago desde mañana a las 9:00' }
 * `leave` answers "if I park now, until when?": the max stay, unless the service day ends
 * first, in which case the car may stay until the next service start.
 */
export function serNow(colour, date = new Date(), hol = {}) {
  const rule = RULES[colour];
  if (!rule) return null;
  const now = madridClock(date), s = serviceOn(now.ymd, hol);
  const nx = nextStart(now, hol);
  const nextText = nx ? `De pago desde ${whenLabel(now.ymd, nx.ymd)} a las ${hhmm(nx.from)}` : '';
  if (s.from !== undefined && now.min >= s.from && now.min < s.to) {
    const stay = `Máximo ${rule.maxMin >= 60 ? rule.maxMin / 60 + ' h' : rule.maxMin + ' min'} (${rule.who})`;
    const end = now.min + rule.maxMin;
    const leave = end < s.to
      ? `Si aparcas ahora: hasta las ${hhmm(end)}`
      : `Si aparcas ahora: el servicio acaba a las ${hhmm(s.to)} y el coche puede quedarse hasta ${nx ? whenLabel(now.ymd, nx.ymd) + ' a las ' + hhmm(nx.from) : 'el próximo día de servicio'}`;
    return { paid: true, text: `De pago hasta las ${hhmm(s.to)}`, stay, leave };
  }
  const why = s.why || (now.min < s.from ? 'aún no empieza' : 'fuera de horario');
  return { paid: false, text: `Gratis ahora (${why})`, next: nextText };
}

const RAD = Math.PI / 180;
export function metres(a, b) {
  const dy = (a.lat - b.lat) * 111320, dx = (a.lon - b.lon) * 111320 * Math.cos(a.lat * RAD);
  return Math.hypot(dx, dy);
}

/** Index data.json's segments into ~220 m cells so a lookup reads a 3x3 block, not 34,503 rows. */
export function indexSegments(data) {
  const cell = 0.002, grid = new Map();
  data.seg.forEach((s, i) => {
    const k = `${Math.floor(s[0] / cell)},${Math.floor(s[1] / cell)}`;
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(i);
  });
  return { data, grid, cell };
}

/**
 * SER segments within `nearM` of `p`, nearest first, one per colour:
 *   [{ colour, m, street, number, spaces }]
 * Empty means no SER segment is mapped that close: outside the SER, or a gap in the data,
 * and the page says exactly that rather than "free".
 */
export function serAt(p, idx, { nearM = 50 } = {}) {
  if (!p || !Number.isFinite(+p.lat) || !Number.isFinite(+p.lon)) return [];
  const { data, grid, cell } = idx, ci = Math.floor(p.lat / cell), cj = Math.floor(p.lon / cell);
  const hits = [];
  for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++)
    for (const i of grid.get(`${ci + di},${cj + dj}`) || []) {
      const s = data.seg[i], m = metres(p, { lat: s[0], lon: s[1] });
      if (m <= nearM) hits.push({ colour: data.col[s[2]], m, street: data.str[s[4]], number: s[5], spaces: s[3] });
    }
  // Sorted on the exact distance, rounded only for display: sorting the rounded metres let
  // 47.4 m beat 46.6 m whenever the grid happened to read it first (Calle de Cartagena).
  hits.sort((a, b) => a.m - b.m);
  const seen = new Set();
  return hits.filter(h => !seen.has(h.colour) && seen.add(h.colour)).map(h => ({ ...h, m: Math.round(h.m) }));
}

/** The `limit` nearest municipal car parks: [{ name, m, hours, spaces, url, lat, lon }]. */
export function nearestParks(p, data, { limit = 3 } = {}) {
  if (!p || !Number.isFinite(+p.lat)) return [];
  return data.parks.map(([name, lat, lon, hours, spaces, url]) =>
    ({ name, lat, lon, hours, spaces, url, m: Math.round(metres(p, { lat, lon })) }))
    .sort((a, b) => a.m - b.m).slice(0, limit);
}
