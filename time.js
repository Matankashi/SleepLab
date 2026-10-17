/* Wall-clock times <-> absolute instants, in a named time zone (default Asia/Jerusalem).

   The diary asks for clock times ("23:10"). They're stored as full ISO strings with the offset that
   applied at that moment ("2026-10-16T23:10:00+03:00"), so every duration is measured between real
   instants: a night that crosses midnight or a DST change comes out right.

   Rule for placing a clock time: night_date is the evening the night starts. The first time of the
   night is the first moment with that clock reading at or after 12:00 on night_date; each later
   time is the first moment with its reading at or after the previous one. So bed 22:30, final wake
   06:45 lands on the next morning, and bed 00:30 lands after midnight. */

export const DEFAULT_TZ = 'Asia/Jerusalem';
const MIN = 60000;
const DAY = 1440 * MIN;

const partsCache = new Map();
function formatter(tz) {
  if (!partsCache.has(tz)) {
    partsCache.set(tz, new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    }));
  }
  return partsCache.get(tz);
}

// The wall-clock reading in tz at instant ms: {y, m, d, h, mi, s}.
export function wallParts(ms, tz = DEFAULT_TZ) {
  const p = {};
  for (const { type, value } of formatter(tz).formatToParts(new Date(ms))) p[type] = value;
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour, mi: +p.minute, s: +p.second };
}

// Offset of tz from UTC at instant ms, in minutes (Israel summer: +180).
export function offsetMinutes(ms, tz = DEFAULT_TZ) {
  const w = wallParts(ms, tz);
  return Math.round((Date.UTC(w.y, w.m - 1, w.d, w.h, w.mi, w.s) - Math.floor(ms / 1000) * 1000) / MIN);
}

export function parseDate(dateStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr || '');
  if (!m) throw new Error('bad date ' + dateStr);
  return { y: +m[1], m: +m[2], d: +m[3] };
}

export function parseHM(hm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hm || '');
  if (!m || +m[1] > 23 || +m[2] > 59) throw new Error('bad time ' + hm);
  return { h: +m[1], mi: +m[2] };
}

export function addDays(dateStr, n) {
  const { y, m, d } = parseDate(dateStr);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

// Every instant at which tz's clock reads dateStr hm: usually one, two in the repeated hour when
// clocks go back, none in the skipped hour when clocks go forward.
export function wallInstants(dateStr, hm, tz = DEFAULT_TZ) {
  const { y, m, d } = parseDate(dateStr);
  const { h, mi } = parseHM(hm);
  const naive = Date.UTC(y, m - 1, d, h, mi);
  const found = new Set();
  for (const probe of [naive - DAY / 2, naive, naive + DAY / 2]) {
    const t = naive - offsetMinutes(probe, tz) * MIN;
    const w = wallParts(t, tz);
    if (w.y === y && w.m === m && w.d === d && w.h === h && w.mi === mi) found.add(t);
  }
  return [...found].sort((a, b) => a - b);
}

// The first instant at or after `after` whose clock reading in tz is hm. In a skipped DST hour the
// reading never happens; the time is then taken as the same number of minutes past the jump.
export function nextWall(after, hm, tz = DEFAULT_TZ) {
  const w = wallParts(after, tz);
  const base = `${w.y}-${String(w.m).padStart(2, '0')}-${String(w.d).padStart(2, '0')}`;
  for (let i = 0; i < 3; i++) {
    const date = addDays(base, i);
    const hits = wallInstants(date, hm, tz).filter(t => t >= after);
    if (hits.length) return hits[0];
    if (!wallInstants(date, hm, tz).length) {
      // Skipped hour: shift by the offset before the jump.
      const { y, m, d } = parseDate(date);
      const { h, mi } = parseHM(hm);
      const naive = Date.UTC(y, m - 1, d, h, mi);
      const t = naive - offsetMinutes(naive - DAY / 2, tz) * MIN;
      if (t >= after) return t;
    }
  }
  throw new Error('no instant for ' + hm);
}

// Noon on night_date: the anchor the first time of a night is placed after.
export function nightAnchor(nightDate, tz = DEFAULT_TZ) {
  return wallInstants(nightDate, '12:00', tz)[0];
}

// Places a list of clock times in diary order (nulls allowed and skipped). Returns instants (ms).
export function resolveSequence(nightDate, hms, tz = DEFAULT_TZ) {
  let after = nightAnchor(nightDate, tz);
  return hms.map(hm => {
    if (hm == null) return null;
    const t = nextWall(after, hm, tz);
    after = t;
    return t;
  });
}

// ISO string with the offset that applied in tz at instant ms: 2026-10-16T23:10:00+03:00.
export function toIso(ms, tz = DEFAULT_TZ) {
  const w = wallParts(ms, tz);
  const off = offsetMinutes(ms, tz);
  const sign = off < 0 ? '-' : '+';
  const a = Math.abs(off);
  const p2 = n => String(n).padStart(2, '0');
  return `${w.y}-${p2(w.m)}-${p2(w.d)}T${p2(w.h)}:${p2(w.mi)}:${p2(w.s)}${sign}${p2(Math.floor(a / 60))}:${p2(a % 60)}`;
}

export const isoToMs = iso => (iso == null ? null : Date.parse(iso));

// "23:10" in tz for an ISO string (for showing and editing a stored time).
export function isoToHM(iso, tz = DEFAULT_TZ) {
  if (iso == null) return null;
  const w = wallParts(Date.parse(iso), tz);
  return `${String(w.h).padStart(2, '0')}:${String(w.mi).padStart(2, '0')}`;
}

// Today's date in tz, YYYY-MM-DD.
export function todayIn(tz = DEFAULT_TZ, now = Date.now()) {
  const w = wallParts(now, tz);
  return `${w.y}-${String(w.m).padStart(2, '0')}-${String(w.d).padStart(2, '0')}`;
}

// Minutes from noon on night_date to instant ms, for drawing a night on a clock axis.
export function minutesFromAnchor(nightDate, ms, tz = DEFAULT_TZ) {
  return (ms - nightAnchor(nightDate, tz)) / MIN;
}
