/* The metrics engine (spec §6, §15.3). Pure functions: no DOM, no Firebase.

   Input is a night document as stored (see README "Data"):
     bed_entry_at, sleep_attempt_at, final_awakening_at, out_of_bed_at   ISO strings
     sleep_onset_latency_minutes, wake_after_sleep_onset_minutes,
     awakening_count                                                      {min, max}
     sleep_quality_rating, morning_refreshment_rating (1-5), daytime_function_rating (0-4)
   For every field: null = the user answered "לא יודע"; missing (undefined) = not answered.
   A {min, max} with min === max is an exact value; otherwise a range (max null = open-ended, "4+").

   Every result is {min, max} too, or null when it can't be known. Nothing unknown is ever turned
   into 0, and no exact value is invented from a range. */

export const FORMULA_VERSION = 1;
const MIN = 60000;

export const known = v => v !== null && v !== undefined;
export const exact = n => ({ min: n, max: n });
export const isExact = r => known(r) && typeof r === 'object' && r.min === r.max;
const ms = iso => (known(iso) ? Date.parse(iso) : undefined);
const asRange = v => (typeof v === 'number' ? exact(v) : v);

export function computeNight(night) {
  const errors = [];
  const warnings = [];
  const bed = ms(night.bed_entry_at);
  const attempt = ms(night.sleep_attempt_at);
  const final = ms(night.final_awakening_at);
  const out = ms(night.out_of_bed_at);
  const sol = night.sleep_onset_latency_minutes;
  const waso = night.wake_after_sleep_onset_minutes;
  const nwak = night.awakening_count;

  // Times must run bed <= attempt <= final <= out (only the ones that are known).
  const order = [['bed_entry_at', bed], ['sleep_attempt_at', attempt], ['final_awakening_at', final], ['out_of_bed_at', out]]
    .filter(([, t]) => t !== undefined);
  for (let i = 1; i < order.length; i++) {
    if (order[i][1] < order[i - 1][1]) errors.push({ code: 'order', fields: [order[i - 1][0], order[i][0]] });
    // A clock time typed earlier than the one before it gets placed about a day later; no real gap
    // between two of these moments is that long.
    else if (order[i][1] - order[i - 1][1] > 18 * 60 * MIN) errors.push({ code: 'gap_18h', fields: [order[i - 1][0], order[i][0]] });
  }

  const tib = bed !== undefined && out !== undefined ? exact((out - bed) / MIN) : null;
  if (tib && tib.min >= 1440) errors.push({ code: 'tib_24h', fields: ['bed_entry_at', 'out_of_bed_at'] });
  else if (tib && tib.min > 14 * 60) warnings.push({ code: 'tib_long' });

  const terminal = final !== undefined && out !== undefined ? exact((out - final) / MIN) : null;

  // No awakenings but time awake during the night: the two answers contradict each other.
  if (known(nwak) && nwak.max === 0 && known(waso) && waso.min > 0) {
    errors.push({ code: 'nwak_zero_waso', fields: ['awakening_count', 'wake_after_sleep_onset_minutes'] });
  }

  // TST = final awakening - start of trying to sleep - SOL - WASO (§6.2).
  let tst = null;
  if (attempt !== undefined && final !== undefined && known(sol) && known(waso)) {
    const span = (final - attempt) / MIN;
    const max = span - sol.min - waso.min;
    const lower = sol.max === null || waso.max === null ? null : span - sol.max - waso.max;
    if (max < 0) {
      // §15.3: e.g. WASO of 8 hours in a 7-hour night. Ask for a correction; never a negative value.
      errors.push({ code: 'tst_negative', fields: ['sleep_onset_latency_minutes', 'wake_after_sleep_onset_minutes'] });
    } else {
      tst = { min: lower === null ? 0 : Math.max(0, lower), max };
    }
  }
  if (known(sol) && sol.min > 180) warnings.push({ code: 'sol_long' });

  const resume = night.attempt_to_resume_after_final_wake_minutes;
  if (terminal && known(resume) && resume.min > terminal.min) {
    errors.push({ code: 'resume_exceeds_terminal', fields: ['attempt_to_resume_after_final_wake_minutes'] });
  }

  // SE = TST / TIB x 100, time-in-bed denominator (§6.2).
  const se = tst && tib && tib.min > 0 ? { min: (tst.min / tib.min) * 100, max: (tst.max / tib.min) * 100 } : null;

  const metrics = {
    TIB: tib,
    SOL: known(sol) ? sol : null,
    TST: tst,
    WASO: known(waso) ? waso : null,
    NWAK: known(nwak) ? nwak : null,
    TWAK: terminal,
    SE: se,
    SQ: known(night.sleep_quality_rating) ? night.sleep_quality_rating : null,
    MR: known(night.morning_refreshment_rating) ? night.morning_refreshment_rating : null,
  };

  let quality;
  if (errors.length) quality = 'invalid';
  else if (!tst) quality = 'insufficient';
  else if (!isExact(tst) || (se && !isExact(se))) quality = 'range';
  else if (!tib || metrics.NWAK === null || metrics.SQ === null || metrics.MR === null) quality = 'partial';
  else quality = 'complete';

  return { formula_version: FORMULA_VERSION, metrics, data_quality: quality, errors, warnings };
}

// The derived block stored next to the source data (never over it).
export function derivedFor(night, now = new Date()) {
  const r = computeNight(night);
  return { formula_version: r.formula_version, computed_at: now.toISOString(), metrics: r.metrics, data_quality: r.data_quality };
}

// Mean of a list of values (numbers or {min, max}); unknowns are left out, not counted as 0.
// A range average is [mean of mins, mean of maxes]; one open-ended max makes the max unknown.
export function summarize(values) {
  const used = values.filter(known).map(asRange);
  const excluded = values.length - used.length;
  if (!used.length) return { n: 0, excluded, value: null };
  const n = used.length;
  const min = used.reduce((s, r) => s + r.min, 0) / n;
  const max = used.some(r => r.max === null) ? null : used.reduce((s, r) => s + r.max, 0) / n;
  return { n, excluded, value: { min, max } };
}

// Nights (with their computed metrics) whose night_date is in the `days` days ending on endDate.
// Dates with no record aren't in the list at all, so they can't count as zero.
export function nightsInWindow(nights, endDate, days) {
  const end = Date.parse(endDate + 'T00:00:00Z');
  const start = end - (days - 1) * 86400000;
  return nights.filter(n => {
    const t = Date.parse(n.night_date + 'T00:00:00Z');
    return t >= start && t <= end;
  });
}

// Averages of the dashboard metrics over a list of nights. Only nights with a morning entry count.
export function summarizeNights(nights) {
  const withMorning = nights.filter(hasMorning);
  const results = withMorning.map(n => computeNight(n));
  const valid = results.filter(r => !r.errors.length);
  const pick = key => valid.map(r => r.metrics[key]);
  return {
    recorded: withMorning.length,
    invalid: results.length - valid.length,
    TST: summarize(pick('TST')),
    NWAK: summarize(pick('NWAK')),
    WASO: summarize(pick('WASO')),
    SQ: summarize(pick('SQ')),
    SE: summarize(pick('SE')),
    SOL: summarize(pick('SOL')),
  };
}

export const DAY_TYPES_SPLIT = ['early_work', 'regular_work', 'evening_shift'];

// The day-type split (§18 criterion 8): early work / regular work / evening shift.
export function splitByDayType(nights) {
  const out = {};
  for (const type of DAY_TYPES_SPLIT) out[type] = summarizeNights(nights.filter(n => n.day_type === type));
  out.untyped = nights.filter(n => hasMorning(n) && !known(n.day_type)).length;
  return out;
}

// A night counts as having a morning entry once any morning field is saved.
export const MORNING_FIELDS = [
  'bed_entry_at', 'sleep_attempt_at', 'sleep_onset_latency_minutes', 'final_awakening_at', 'out_of_bed_at',
  'awakening_count', 'wake_after_sleep_onset_minutes', 'sleep_quality_rating', 'morning_refreshment_rating',
];
export const hasMorning = night => MORNING_FIELDS.some(f => night[f] !== undefined);
