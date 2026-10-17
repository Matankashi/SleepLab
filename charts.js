/* Hand-drawn SVG charts (no library, nothing loaded from outside). Colors come from CSS classes,
   so light and dark mode follow the page. Time runs left to right (oldest first), like a clock axis.

   Every chart shows exactly what the diary has: an exact value is a solid bar, a range is a solid
   bar to its minimum plus a lighter part to its maximum, an unknown value is a "?", and a date with
   no record is an empty slot (never a zero bar). */

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ddmm = date => `${date.slice(8, 10)}.${date.slice(5, 7)}`;

// days: [{date, value: {min, max} | number | null, recorded}]; fmt formats a y value.
export function barChart({ days, fmt, yMax, refLine, title }) {
  const W = 340, H = 150, L = 34, R = 6, T = 10, B = 20;
  const cw = W - L - R, ch = H - T - B;
  const top = Math.max(yMax || 0, refLine || 0, ...days.map(d => (d.value && (d.value.max ?? d.value.min)) || 0), 1);
  const y = v => T + ch - (Math.min(v, top) / top) * ch;
  const bw = cw / days.length;
  const barW = Math.max(1.5, Math.min(18, bw * 0.7));
  let s = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)}" direction="ltr">`;
  for (const v of [0, top / 2, top]) {
    s += `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/>`;
    s += `<text class="axis" x="${L - 4}" y="${y(v) + 3}" text-anchor="end">${esc(fmt(v))}</text>`;
  }
  days.forEach((d, i) => {
    const cx = L + bw * i + bw / 2, x = cx - barW / 2;
    if (!d.recorded) return;
    const v = d.value;
    if (v === null || v === undefined) {
      s += `<text class="unknown" x="${cx}" y="${T + ch - 3}" text-anchor="middle">?</text>`;
      return;
    }
    const min = v.min, max = v.max;
    // A zero is a real answer: draw it as a short mark on the baseline, unlike an unrecorded date.
    if (max === 0) {
      s += `<rect class="bar-zero" x="${x}" y="${T + ch - 2}" width="${barW}" height="2"><title>${esc(ddmm(d.date))}: ${esc(fmt(0))}</title></rect>`;
      return;
    }
    s += `<rect class="bar" x="${x}" y="${y(min)}" width="${barW}" height="${Math.max(0, T + ch - y(min))}"><title>${esc(ddmm(d.date))}: ${esc(max === min ? fmt(min) : max === null ? fmt(min) + '+' : fmt(min) + '–' + fmt(max))}</title></rect>`;
    if (max !== min) {
      const hi = max === null ? top : max;
      s += `<rect class="${max === null ? 'bar-open' : 'bar-range'}" x="${x}" y="${y(hi)}" width="${barW}" height="${Math.max(0, y(min) - y(hi))}"/>`;
    }
  });
  if (refLine) {
    s += `<line class="ref" x1="${L}" x2="${W - R}" y1="${y(refLine)}" y2="${y(refLine)}"/>`;
  }
  const idx = [...new Set([0, Math.floor((days.length - 1) / 2), days.length - 1])];
  for (const i of idx) s += `<text class="axis" x="${L + bw * i + bw / 2}" y="${H - 6}" text-anchor="middle">${esc(ddmm(days[i].date))}</text>`;
  return s + '</svg>';
}

// rows: [{date, dayType, bed, attempt, onset, final, out, wakes: []}] in minutes from noon on
// night_date (null when unknown). Axis 20:00 -> 12:00 next day.
export function timelineChart({ rows, title }) {
  const X0 = 8 * 60, X1 = 24 * 60;
  const W = 340, L = 44, R = 6, T = 16;
  const rowH = rows.length > 30 ? 5 : 10, gap = rows.length > 30 ? 1 : 4;
  const H = T + rows.length * (rowH + gap) + 6;
  const cw = W - L - R;
  const x = m => L + ((Math.min(Math.max(m, X0), X1) - X0) / (X1 - X0)) * cw;
  let s = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)}" direction="ltr">`;
  for (let m = X0; m <= X1; m += 120) {
    const hh = String(((m / 60) + 12) % 24).padStart(2, '0');
    s += `<line class="grid" x1="${x(m)}" x2="${x(m)}" y1="${T - 4}" y2="${H - 4}"/>`;
    s += `<text class="axis" x="${x(m)}" y="${T - 6}" text-anchor="middle">${hh}</text>`;
  }
  rows.forEach((r, i) => {
    const yy = T + i * (rowH + gap);
    if (rowH >= 8) s += `<text class="axis" x="${L - 12}" y="${yy + rowH - 1}" text-anchor="end">${esc(ddmm(r.date))}</text>`;
    s += `<circle class="dt dt-${esc(r.dayType || 'none')}" cx="${L - 6}" cy="${yy + rowH / 2}" r="${Math.min(3, rowH / 2)}"/>`;
    const seg = (a, b, cls) => {
      if (a === null || b === null || b <= a) return;
      s += `<rect class="${cls}" x="${x(a)}" y="${yy}" width="${Math.max(0.5, x(b) - x(a))}" height="${rowH}"/>`;
    };
    seg(r.bed, r.out, 'tl-bed');
    if (r.onset !== null) {
      seg(r.attempt, r.onset, 'tl-sol');
      seg(r.onset, r.final, 'tl-sleep');
    } else {
      seg(r.attempt, r.final, 'tl-sleep-unsure');
    }
    for (const w of r.wakes || []) s += `<rect class="tl-wake" x="${x(w) - 0.75}" y="${yy - 1}" width="1.5" height="${rowH + 2}"/>`;
  });
  return s + '</svg>';
}
