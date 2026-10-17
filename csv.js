/* CSV export (brief §4 item 7): every source field, the evening factors, the per-awakening detail
   and the computed metrics, with nothing lost.

   - {min, max} values become two columns, name_min and name_max.
   - null (the user answered "לא יודע") is written as the literal  null ; a question never answered
     is an empty cell. So the two stay distinguishable.
   - Arrays and nested objects that aren't ranges are written as JSON in one cell.
   - Metrics are recomputed from the source fields with the current formula; the stored derived
     block (with its formula_version) is exported too, under stored_derived.*.
   - UTF-8 with a byte-order mark, so Hebrew opens correctly in Excel and Numbers. */

import { computeNight, FORMULA_VERSION } from './calc.js';

const isRange = v => v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 2 && 'min' in v && 'max' in v;

function flatten(obj, prefix, out) {
  for (const [k, v] of Object.entries(obj || {})) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (isRange(v)) {
      out[key + '_min'] = v.min;
      out[key + '_max'] = v.max;
    } else if (v && typeof v === 'object' && !Array.isArray(v) && prefix.split('.').length < 3) {
      flatten(v, key, out);
    } else {
      out[key] = v;
    }
  }
  return out;
}

function cell(v) {
  if (v === undefined) return '';
  if (v === null) return 'null';
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function toCsv(rows, leading) {
  const keys = new Set(leading);
  rows.forEach(r => Object.keys(r).forEach(k => keys.add(k)));
  const cols = [...keys];
  const lines = [cols.map(cell).join(',')];
  for (const r of rows) lines.push(cols.map(c => cell(r[c])).join(','));
  return '﻿' + lines.join('\r\n') + '\r\n';
}

// nights: {date: doc}, factors: {date: doc}, awakenings: {date: [detail, ...]}
export function nightsCsv(nights, factors, awakenings) {
  const dates = [...new Set([...Object.keys(nights), ...Object.keys(factors)])].sort();
  const rows = dates.map(date => {
    const n = nights[date] || {};
    const { derived, ...source } = n;
    const row = { night_date: date };
    flatten(source, '', row);
    flatten(factors[date] || {}, 'evening', row);
    if (awakenings[date]) row.awakenings_detail = awakenings[date];
    const now = computeNight({ night_date: date, ...source });
    row.formula_version = FORMULA_VERSION;
    row.data_quality = now.data_quality;
    flatten(now.metrics, 'metric', row);
    row.validation_errors = now.errors.length ? now.errors.map(e => e.code) : undefined;
    if (derived) flatten(derived, 'stored_derived', row);
    return row;
  });
  return toCsv(rows, ['night_date', 'timezone', 'day_type', 'formula_version', 'data_quality']);
}

export function profileCsv(profile) {
  const fields = (profile && profile.fields) || {};
  const rows = Object.entries(fields).map(([field, a]) => ({
    field, value: a.value, source: a.source, initial_report: a.initial_report, updated_at: a.updated_at,
  }));
  return toCsv(rows, ['field', 'value', 'source', 'initial_report', 'updated_at']);
}

export function download(filename, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
