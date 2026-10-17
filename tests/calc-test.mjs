/* Unit tests for the metrics engine (calc.js) and the time placement (time.js).
   No dependencies; runs with the JavaScriptCore shell that ships with macOS. From the repo root:

     /System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc -m tests/calc-test.mjs

   Exits non-zero (an uncaught error) if any test fails. All data here is made up. */

import { computeNight, summarize, summarizeNights, splitByDayType, nightsInWindow, exact } from '../calc.js';
import { resolveSequence, toIso, isoToHM, offsetMinutes } from '../time.js';
import { nightsCsv, profileCsv } from '../csv.js';

const log = typeof print === 'function' ? print : console.log;
let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) passed++;
  else { failed++; log('FAIL  ' + name + (detail !== undefined ? '  -> ' + JSON.stringify(detail) : '')); }
}
const close = (a, b, eps = 0.05) => typeof a === 'number' && Math.abs(a - b) < eps;
const TZ = 'Asia/Jerusalem';

// Builds a night from clock times the way the morning form does: placed in diary order after
// noon on night_date, stored as ISO strings with offset.
function night(nightDate, t, rest = {}) {
  const [bed, attempt, final, out] = resolveSequence(nightDate, [t.bed, t.attempt, t.final, t.out], TZ);
  const n = { night_date: nightDate, timezone: TZ, ...rest };
  if (bed != null) n.bed_entry_at = toIso(bed, TZ);
  if (attempt != null) n.sleep_attempt_at = toIso(attempt, TZ);
  if (final != null) n.final_awakening_at = toIso(final, TZ);
  if (out != null) n.out_of_bed_at = toIso(out, TZ);
  return n;
}

// §6.3: bed 22:30, attempt 23:00, SOL 10, one awakening, WASO 25, final 06:45, out 07:00.
{
  const n = night('2026-10-05', { bed: '22:30', attempt: '23:00', final: '06:45', out: '07:00' }, {
    sleep_onset_latency_minutes: exact(10), awakening_count: exact(1), wake_after_sleep_onset_minutes: exact(25),
    sleep_quality_rating: 3, morning_refreshment_rating: 3,
  });
  const r = computeNight(n);
  check('6.3 no errors', r.errors.length === 0, r.errors);
  check('6.3 TIB 8:30', r.metrics.TIB.min === 510 && r.metrics.TIB.max === 510, r.metrics.TIB);
  check('6.3 TST 7:10', r.metrics.TST.min === 430 && r.metrics.TST.max === 430, r.metrics.TST);
  check('6.3 Terminal 0:15', r.metrics.TWAK.min === 15, r.metrics.TWAK);
  check('6.3 WASO 25', r.metrics.WASO.min === 25, r.metrics.WASO);
  check('6.3 SE ~84.3%', close(r.metrics.SE.min, 84.31) && r.metrics.SE.min === r.metrics.SE.max, r.metrics.SE);
  check('6.3 complete', r.data_quality === 'complete', r.data_quality);
  check('6.3 final awakening on the next morning', n.final_awakening_at === '2026-10-06T06:45:00+03:00', n.final_awakening_at);
}

// §15.3: attempt 23:00, SOL 10, final 06:00, WASO 120 -> TST 4:50. Same night with WASO 480 -> error.
{
  const base = { sleep_onset_latency_minutes: exact(10), awakening_count: exact(2) };
  const ok = computeNight(night('2026-10-06', { attempt: '23:00', final: '06:00' }, { ...base, wake_after_sleep_onset_minutes: exact(120) }));
  check('15.3 TST 4:50', ok.metrics.TST && ok.metrics.TST.min === 290 && ok.metrics.TST.max === 290, ok.metrics.TST);
  check('15.3 no TIB without bed/out times', ok.metrics.TIB === null && ok.metrics.SE === null);
  check('15.3 partial (no TIB, no ratings)', ok.data_quality === 'partial', ok.data_quality);

  const bad = computeNight(night('2026-10-06', { attempt: '23:00', final: '06:00' }, { ...base, wake_after_sleep_onset_minutes: exact(480) }));
  check('15.3 WASO 480 is a validation error', bad.errors.some(e => e.code === 'tst_negative'), bad.errors);
  check('15.3 WASO 480 gives no TST at all', bad.metrics.TST === null, bad.metrics.TST);
  check('15.3 WASO 480 marked invalid', bad.data_quality === 'invalid');
}

// A night that starts after midnight: bed 00:30 belongs to the night_date evening before.
{
  const n = night('2026-10-07', { bed: '00:30', attempt: '00:30', final: '07:30', out: '07:40' }, {
    sleep_onset_latency_minutes: exact(15), awakening_count: exact(0), wake_after_sleep_onset_minutes: exact(0),
  });
  check('after midnight: bed on the next calendar day', n.bed_entry_at === '2026-10-08T00:30:00+03:00', n.bed_entry_at);
  const r = computeNight(n);
  check('after midnight: TIB 7:10', r.metrics.TIB.min === 430, r.metrics.TIB);
  check('after midnight: TST 6:45', r.metrics.TST.min === 405, r.metrics.TST);
}

// DST: Israel goes back from +03:00 to +02:00 at 02:00 on 2026-10-25. Bed 23:00, out 07:00 is
// 9 real hours, not 8.
{
  const n = night('2026-10-24', { bed: '23:00', attempt: '23:00', final: '07:00', out: '07:00' }, {
    sleep_onset_latency_minutes: exact(10), awakening_count: exact(0), wake_after_sleep_onset_minutes: exact(0),
  });
  check('DST: offsets change during the night', n.bed_entry_at.endsWith('+03:00') && n.out_of_bed_at.endsWith('+02:00'), [n.bed_entry_at, n.out_of_bed_at]);
  const r = computeNight(n);
  check('DST: TIB is 9 real hours', r.metrics.TIB.min === 540, r.metrics.TIB);
  check('DST: TST 8:50', r.metrics.TST.min === 530, r.metrics.TST);
  check('DST: stored time reads back as the same clock time', isoToHM(n.out_of_bed_at, TZ) === '07:00');
  check('DST: offset before/after', offsetMinutes(Date.parse(n.bed_entry_at), TZ) === 180 && offsetMinutes(Date.parse(n.out_of_bed_at), TZ) === 120);
}

// DST forward (2027-03-26, 02:00 -> 03:00): a night of 23:00 -> 07:00 is 7 real hours.
{
  const n = night('2027-03-25', { bed: '23:00', out: '07:00' });
  check('DST forward: TIB 7h', computeNight(n).metrics.TIB.min === 420, computeNight(n).metrics.TIB);
}

// Unknown SOL or WASO: TST is unknown, never a number.
{
  const t = { attempt: '23:00', final: '06:00' };
  const r1 = computeNight(night('2026-10-08', t, { sleep_onset_latency_minutes: null, wake_after_sleep_onset_minutes: exact(10) }));
  check('SOL unknown -> TST unknown', r1.metrics.TST === null && r1.metrics.SOL === null && r1.data_quality === 'insufficient');
  const r2 = computeNight(night('2026-10-08', t, { sleep_onset_latency_minutes: exact(10), wake_after_sleep_onset_minutes: null }));
  check('WASO unknown -> TST and WASO unknown', r2.metrics.TST === null && r2.metrics.WASO === null);
  const r3 = computeNight(night('2026-10-08', { attempt: '23:00' }, { sleep_onset_latency_minutes: exact(10), wake_after_sleep_onset_minutes: exact(10) }));
  check('final awakening missing -> TST unknown', r3.metrics.TST === null);
}

// Ranges stay ranges: WASO "<5" (0-5) and "120+" (open-ended).
{
  const t = { bed: '23:00', attempt: '23:00', final: '07:00', out: '07:00' };
  const r1 = computeNight(night('2026-10-09', t, { sleep_onset_latency_minutes: exact(10), wake_after_sleep_onset_minutes: { min: 0, max: 5 }, awakening_count: exact(1) }));
  check('WASO <5: TST 465-470', r1.metrics.TST.min === 465 && r1.metrics.TST.max === 470, r1.metrics.TST);
  check('WASO <5: quality range', r1.data_quality === 'range');
  const r2 = computeNight(night('2026-10-09', t, { sleep_onset_latency_minutes: exact(10), wake_after_sleep_onset_minutes: { min: 120, max: null }, awakening_count: { min: 4, max: null } }));
  check('WASO 120+: TST 0-350', r2.metrics.TST.min === 0 && r2.metrics.TST.max === 350, r2.metrics.TST);
}

// Contradictions and order are errors, not saved values.
{
  const r1 = computeNight(night('2026-10-10', { attempt: '23:00', final: '06:00' }, { sleep_onset_latency_minutes: exact(10), awakening_count: exact(0), wake_after_sleep_onset_minutes: exact(30) }));
  check('0 awakenings with WASO 30 is an error', r1.errors.some(e => e.code === 'nwak_zero_waso'));
  const r2 = computeNight({ night_date: '2026-10-10', bed_entry_at: '2026-10-10T23:00:00+03:00', out_of_bed_at: '2026-10-10T22:00:00+03:00' });
  check('out of bed before bed is an order error', r2.errors.some(e => e.code === 'order'));
  const r3 = computeNight({ night_date: '2026-10-10', bed_entry_at: '2026-10-10T20:00:00+03:00', out_of_bed_at: '2026-10-11T21:00:00+03:00' });
  check('TIB over 24h is an error', r3.errors.some(e => e.code === 'tib_24h'));
  // Typo: trying to sleep at 23:00 after getting into bed at 23:40 lands 23h20m later.
  const r4 = computeNight(night('2026-10-10', { bed: '23:40', attempt: '23:00', final: '06:00' }, { sleep_onset_latency_minutes: exact(10), wake_after_sleep_onset_minutes: exact(0) }));
  check('attempt typed before bed is caught', r4.errors.some(e => e.code === 'gap_18h'), r4.errors);
}

// "לא יודע" doesn't skew averages; missing nights aren't zeros.
{
  check('summarize skips nulls', (() => { const s = summarize([exact(420), null, exact(360), undefined]); return s.n === 2 && s.excluded === 2 && s.value.min === 390 && s.value.max === 390; })());
  check('summarize of nothing is unknown, not 0', summarize([null, null]).value === null);
  const s = summarize([exact(10), { min: 0, max: 5 }]);
  check('range average', s.value.min === 5 && s.value.max === 7.5, s);
  check('open-ended max makes the mean max unknown', summarize([exact(1), { min: 4, max: null }]).value.max === null);

  const mk = (d, waso, type) => ({ ...night(d, { bed: '23:00', attempt: '23:00', final: '07:00', out: '07:00' }, {
    sleep_onset_latency_minutes: exact(10), awakening_count: exact(waso ? 1 : 0),
    wake_after_sleep_onset_minutes: waso === null ? null : exact(waso), sleep_quality_rating: 4,
  }), day_type: type });
  // 10 days, only 3 recorded; one has WASO unknown.
  const nights = [mk('2026-10-01', 20, 'early_work'), mk('2026-10-04', null, 'regular_work'), mk('2026-10-09', 0, 'evening_shift')];
  const w = nightsInWindow(nights, '2026-10-10', 7);
  check('window keeps only nights in range', w.length === 2 && w.every(n => n.night_date >= '2026-10-04'), w.map(n => n.night_date));
  const sum = summarizeNights(nights);
  check('3 recorded nights, missing dates not counted', sum.recorded === 3);
  check('TST mean over the 2 nights where it is known', sum.TST.n === 2 && sum.TST.value.min === (450 + 470) / 2, sum.TST);
  check('WASO mean ignores the unknown night', sum.WASO.n === 2 && sum.WASO.value.min === 10, sum.WASO);
  check('SQ mean over all 3', sum.SQ.n === 3 && sum.SQ.value.min === 4);

  const split = splitByDayType([...nights, { ...mk('2026-10-05', 0, undefined), day_type: undefined }]);
  check('split: early work', split.early_work.recorded === 1 && split.early_work.TST.value.min === 450);
  check('split: evening shift group', split.evening_shift.recorded === 1 && split.evening_shift.TST.value.min === 470);
  check('split: regular work (TST unknown)', split.regular_work.recorded === 1 && split.regular_work.TST.n === 0);
  check('split: untyped counted apart', split.untyped === 1);
}

// CSV export: nothing lost. null stays "null", unanswered stays empty, ranges get _min/_max.
{
  const nights = {
    '2026-10-11': { ...night('2026-10-11', { bed: '23:00', attempt: '23:00', final: '07:00', out: '07:10' }, {
      sleep_onset_latency_minutes: null, awakening_count: { min: 4, max: null }, wake_after_sleep_onset_minutes: { min: 0, max: 5 },
      notes: 'חלום, "מוזר"', day_type: 'evening_shift', sources: { bed_entry_at: 'self_report' },
    }), night_date: undefined },
  };
  delete nights['2026-10-11'].night_date;
  const factors = { '2026-10-11': { coffee_count: exact(2), last_caffeine: { kind: 'none', at: null }, unusual: ['stress'] } };
  const awak = { '2026-10-11': [{ at: '2026-10-12T03:10:00+03:00', cause: 'noise' }] };
  const csv = nightsCsv(nights, factors, awak);
  const lines = csv.replace(/^﻿/, '').trim().split('\r\n');
  const head = lines[0].split(',');
  // Split the data row respecting quotes.
  const row = []; let cur = '', q = false;
  for (const ch of lines[1]) {
    if (ch === '"') q = !q;
    if (ch === ',' && !q) { row.push(cur); cur = ''; } else cur += ch;
  }
  row.push(cur);
  const col = name => row[head.indexOf(name)];
  check('csv: BOM for Excel', csv.startsWith('﻿'));
  check('csv: one header + one night', lines.length === 2, lines.length);
  check('csv: "לא יודע" written as null', col('sleep_onset_latency_minutes') === 'null', col('sleep_onset_latency_minutes'));
  check('csv: unanswered is an empty cell', head.indexOf('sleep_quality_rating') === -1 || col('sleep_quality_rating') === '');
  check('csv: open range keeps max null', col('awakening_count_min') === '4' && col('awakening_count_max') === 'null');
  check('csv: range in two columns', col('wake_after_sleep_onset_minutes_min') === '0' && col('wake_after_sleep_onset_minutes_max') === '5');
  check('csv: metric TST unknown (SOL unknown)', col('metric.TST') === 'null', col('metric.TST'));
  check('csv: TIB computed', col('metric.TIB_min') === '490');
  check('csv: quotes escaped', col('notes') === '"חלום, ""מוזר"""', col('notes'));
  check('csv: evening factors', col('evening.coffee_count_min') === '2' && col('evening.last_caffeine.kind') === 'none' && col('evening.last_caffeine.at') === 'null');
  check('csv: awakenings detail kept', col('awakenings_detail').includes('03:10'));
  check('csv: day type and formula version', col('day_type') === 'evening_shift' && col('formula_version') === '1');
  const pcsv = profileCsv({ fields: { breathing_pauses: { value: 'unknown', source: 'self_report', initial_report: true } } });
  check('csv: profile row', pcsv.includes('breathing_pauses,unknown,self_report,true'));
}

log(`\n${passed} passed, ${failed} failed`);
if (failed) throw new Error(failed + ' test(s) failed');
