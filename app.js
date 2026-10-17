/* SleepLab: screens, forms and routing. Data comes from firebase.js, metrics from calc.js.

   Routes (hash): #/today  #/morning/{date}  #/evening/{date}  #/night/{date}  #/history[/{YYYY-MM}]
                  #/settings  #/profile
   A form keeps its draft in S.form while the route stays the same, so live updates from Firestore
   never wipe what's being typed. A save shows "נשמר" only after the server confirms it; a failed
   save keeps the draft and says so. */

import { watchAuth, signIn, signOutUser, watchUserData, loadAwakenings, saveNight, saveEvening, saveProfile, saveSettings, REMOVE } from './firebase.js';
import { computeNight, derivedFor, summarizeNights, splitByDayType, nightsInWindow, hasMorning, exact, known, isExact, DAY_TYPES_SPLIT } from './calc.js';
import { DEFAULT_TZ, resolveSequence, toIso, isoToHM, todayIn, addDays, wallParts, nextWall, nightAnchor, wallInstants, minutesFromAnchor } from './time.js';
import * as F from './fields.js';
import { barChart, timelineChart } from './charts.js';
import { nightsCsv, profileCsv, download } from './csv.js';

const S = {
  user: undefined, profile: undefined, settings: undefined, nights: {}, factors: {},
  loaded: false, loadError: null, unwatch: null, form: null, flash: null, range: 7, signInError: null,
};
const root = document.getElementById('app');

// ---------- small helpers ----------

function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'svg') el.innerHTML = v; // only ever charts.js output, which escapes its text
    else if (k === 'value') el.value = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid === null || kid === undefined || kid === false) continue;
    el.append(kid.nodeType ? kid : String(kid));
  }
  return el;
}
const tz = () => (S.settings && S.settings.timezone) || DEFAULT_TZ;
const nightTz = n => (n && n.timezone) || tz();
const sameRange = (a, b) => known(a) && known(b) && a.min === b.min && a.max === b.max;
const pad = n => String(n).padStart(2, '0');
const hm = m => `${Math.floor(m / 60)}:${pad(Math.round(m % 60) === 60 ? 0 : Math.round(m % 60))}`;
const hmRound = m => hm(Math.round(m));
const mins = m => `${Math.round(m)} ד׳`;
const one = v => (Math.round(v * 10) / 10).toString();
const pct = v => `${one(v)}%`;

// A {min, max} (or number) for display: exact, a range, open-ended, or unknown.
function fmtVal(v, f) {
  if (v === null || v === undefined) return 'לא ידוע';
  if (typeof v === 'number') return f(v);
  if (v.min === v.max) return f(v.min);
  if (v.max === null) return `${f(v.min)} ומעלה`;
  return `${f(v.min)}–${f(v.max)}`;
}
// A self-reported answer: not answered (—) is different from "לא ידוע" (null).
const selfVal = (raw, f) => (raw === undefined ? '—' : fmtVal(raw, f));
// A computed metric that can't be computed from what was reported.
const calcVal = (v, f) => (v === null || v === undefined ? 'אין מספיק נתונים' : fmtVal(v, f));
const outOf5 = v => `${v}/5`;
const fmtAvg = (s, f) => (s.value ? fmtVal(s.value.max !== null && Math.abs(s.value.max - s.value.min) < 1e-9 ? s.value.min : s.value, f) : '—');

function dateLabel(date, opts = { weekday: 'long', day: 'numeric', month: 'long' }) {
  return new Intl.DateTimeFormat('he-IL', { ...opts, timeZone: 'UTC' }).format(new Date(date + 'T12:00:00Z'));
}
const nightLabel = date => `ליל ${dateLabel(date, { weekday: 'short', day: 'numeric', month: 'short' })}`;

const tagSelf = () => h('span', { class: 'tag self' }, 'דיווח עצמי');
const tagCalc = () => h('span', { class: 'tag calc' }, 'חישוב');
const tagDerived = () => h('span', { class: 'tag calc' }, 'נגזר');
const disclaimer = () => h('p', { class: 'disclaimer' }, 'מבוסס על יומן שינה (דיווח עצמי), לא בדיקת שינה. האפליקציה לא מאבחנת ולא ממליצה על טיפול או תרופות.');

const nightsList = () => Object.entries(S.nights).map(([d, n]) => ({ ...n, night_date: d })).sort((a, b) => (a.night_date < b.night_date ? -1 : 1));
const morningDate = () => addDays(todayIn(tz()), -1);
const eveningDate = () => (wallParts(Date.now(), tz()).h < 5 ? addDays(todayIn(tz()), -1) : todayIn(tz()));
const profileValues = () => Object.fromEntries(Object.entries((S.profile && S.profile.fields) || {}).map(([k, a]) => [k, a.value]));

function chips(options, isOn, onPick, { prev, cls } = {}) {
  return h('div', { class: 'chips' + (cls ? ' ' + cls : '') }, options.map(o => h('button', {
    type: 'button', class: 'chip' + (isOn(o) ? ' on' : '') + (prev && prev(o) ? ' prev' : ''),
    'aria-pressed': isOn(o) ? 'true' : 'false', onclick: () => onPick(o),
  }, o.l)));
}
const field = (label, ...kids) => h('div', { class: 'field' }, h('div', { class: 'label' }, label), ...kids);

function timeInput(value, onChange, { prev } = {}) {
  const input = h('input', { type: 'time', value: value || '', oninput: e => onChange(e.target.value || undefined) });
  return h('div', { class: 'time-row' }, input,
    prev && prev !== value ? h('button', { type: 'button', class: 'chip prev', onclick: () => { onChange(prev); render(); } }, `כמו בפעם הקודמת · ${prev}`) : null,
    value ? h('button', { type: 'button', class: 'link', onclick: () => { onChange(undefined); render(); } }, 'נקה') : null);
}

function numberInput(value, onChange, { placeholder, min = 0, max } = {}) {
  return h('input', {
    type: 'number', inputmode: 'numeric', min, max, placeholder, value: value ?? '', class: 'num',
    oninput: e => { const n = e.target.value === '' ? undefined : Number(e.target.value); onChange(Number.isFinite(n) && n >= min ? n : undefined); },
  });
}

// Chips for a {min, max} answer with "אחר" (number) and "לא יודע" (null).
function rangeChoice(d, key, options, { prev } = {}) {
  const v = d[key];
  const otherKey = key + '_other';
  const matched = o => o.v && sameRange(o.v, v);
  const isOther = d[otherKey] || (known(v) && !options.some(matched));
  const isOn = o => (o.unknown ? v === null : o.other ? isOther : !d[otherKey] && matched(o));
  const out = [chips(options, isOn, o => {
    if (isOn(o)) { d[key] = undefined; d[otherKey] = false; } else if (o.unknown) { d[key] = null; d[otherKey] = false; } else if (o.other) { d[otherKey] = true; d[key] = undefined; } else { d[key] = o.v; d[otherKey] = false; }
    render();
  }, { prev: prev === undefined ? null : o => (o.unknown ? prev === null : o.v && sameRange(o.v, prev)) })];
  if (isOther) out.push(h('div', { class: 'inline' }, numberInput(known(v) ? v.min : undefined, n => { d[key] = n === undefined ? undefined : exact(n); }, { placeholder: 'דקות' }), h('span', { class: 'muted' }, 'דקות')));
  return out;
}

function valueChoice(d, key, options, { prev, toggle = true } = {}) {
  return chips(options, o => d[key] === o.v, o => { d[key] = toggle && d[key] === o.v ? undefined : o.v; render(); },
    { prev: prev === undefined ? null : o => prev === o.v });
}

const ERROR_TEXT = {
  order: 'סדר השעות לא הגיוני. בדוק את השעות שהזנת.',
  gap_18h: 'יש פער של יותר מ־18 שעות בין שתי שעות. ייתכן ששעה הוזנה מוקדמת מהשעה שלפניה (למשל ניסיון להירדם לפני הכניסה למיטה).',
  tib_24h: 'הזמן במיטה יוצא 24 שעות או יותר. בדוק את השעות.',
  tst_negative: 'זמן ההירדמות וזמן הערות יחד ארוכים מכל הלילה. תקן אחד מהם.',
  nwak_zero_waso: 'סימנת 0 יקיצות אבל גם זמן ערות במהלך הלילה. תקן אחד מהם.',
  resume_exceeds_terminal: 'זמן הניסיון לחזור לישון ארוך מהזמן שבין היקיצה הסופית ליציאה מהמיטה.',
};
const WARNING_TEXT = {
  tib_long: 'יותר מ־14 שעות במיטה.',
  sol_long: 'זמן הירדמות של יותר משלוש שעות.',
};

// ---------- data ----------

watchAuth(user => {
  if (S.unwatch) { S.unwatch(); S.unwatch = null; }
  S.user = user;
  S.profile = S.settings = undefined;
  S.nights = {};
  S.factors = {};
  S.loaded = false;
  S.loadError = null;
  S.form = null;
  if (user) {
    const seen = new Set();
    const mark = what => { seen.add(what); if (seen.size === 4 && !S.loaded) S.loaded = true; render(); };
    S.unwatch = watchUserData(user.uid, {
      onProfile: p => { S.profile = p; mark('profile'); },
      onSettings: s => { S.settings = s; mark('settings'); },
      onNights: n => { S.nights = n; mark('nights'); },
      onFactors: f => { S.factors = f; mark('factors'); },
      onError: (what, err) => { console.error('sleeplab: loading ' + what + ' failed', err); S.loadError = what; render(); },
    });
  }
  render();
});

window.addEventListener('hashchange', () => { S.flash = S.flashNext || null; S.flashNext = null; render(); window.scrollTo(0, 0); });

// ---------- shell ----------

function route() {
  const parts = (location.hash || '#/today').replace(/^#\/?/, '').split('/');
  return { name: parts[0] || 'today', arg: parts[1] };
}

function render() {
  root.replaceChildren(view());
}

function view() {
  if (S.user === undefined) return h('div', { class: 'center muted' }, 'טוען…');
  if (!S.user) return signInView();
  if (S.loadError) return shell(h('div', { class: 'banner error' }, 'לא ניתן לטעון את הנתונים. נסה לרענן את הדף.'));
  if (!S.loaded) return shell(h('div', { class: 'center muted' }, 'טוען נתונים…'));
  const r = route();
  const isDate = /^\d{4}-\d{2}-\d{2}$/.test(r.arg || '');
  switch (r.name) {
    case 'morning': return shell(morningView(isDate ? r.arg : morningDate()), 'morning');
    case 'evening': return shell(eveningView(isDate ? r.arg : eveningDate()), 'evening');
    case 'night': return shell(isDate ? nightView(r.arg) : todayView(), 'history');
    case 'history': return shell(historyView(r.arg), 'history');
    case 'settings': return shell(settingsView(), 'settings');
    case 'profile': return shell(profileView(), 'settings');
    default: return shell(todayView(), 'today');
  }
}

function shell(content, tab) {
  const tabs = [['today', 'היום', '#/today'], ['morning', 'בוקר', '#/morning/' + morningDate()], ['evening', 'ערב', '#/evening/' + eveningDate()], ['history', 'היסטוריה', '#/history'], ['settings', 'הגדרות', '#/settings']];
  return h('div', { class: 'shell' },
    h('header', { class: 'top' }, h('span', { class: 'brand' }, 'SleepLab'), h('span', { class: 'muted' }, dateLabel(todayIn(tz())))),
    S.flash ? h('div', { class: 'banner ok', role: 'status' }, S.flash) : null,
    h('main', null, content),
    h('nav', { class: 'tabs' }, tabs.map(([k, l, href]) => h('a', { href, class: k === tab ? 'on' : '', 'aria-current': k === tab ? 'page' : null }, l))));
}

function signInView() {
  const form = h('form', {
    class: 'card signin', onsubmit: async e => {
      e.preventDefault();
      const fd = new FormData(e.target);
      S.signInError = null;
      try {
        await signIn(String(fd.get('email')).trim(), String(fd.get('password')));
      } catch (err) {
        console.error('sleeplab: sign-in failed', err);
        S.signInError = ['auth/invalid-credential', 'auth/wrong-password', 'auth/user-not-found', 'auth/invalid-email'].includes(err.code)
          ? 'אימייל או סיסמה שגויים.' : err.code === 'auth/too-many-requests' ? 'יותר מדי ניסיונות. נסה שוב מאוחר יותר.' : 'ההתחברות נכשלה. בדוק את החיבור ונסה שוב.';
        render();
      }
    },
  },
  h('h1', null, 'SleepLab'),
  h('p', { class: 'muted' }, 'יומן שינה אישי. כניסה בלבד, אין הרשמה.'),
  h('label', null, 'אימייל', h('input', { name: 'email', type: 'email', autocomplete: 'username', required: true, dir: 'ltr' })),
  h('label', null, 'סיסמה', h('input', { name: 'password', type: 'password', autocomplete: 'current-password', required: true, dir: 'ltr' })),
  S.signInError ? h('div', { class: 'banner error' }, S.signInError) : null,
  h('button', { type: 'submit', class: 'primary' }, 'כניסה'));
  return h('div', { class: 'shell' }, h('main', null, form));
}

function safetyBanner() {
  const signs = F.warningSigns(profileValues());
  if (!signs.length) return null;
  return h('div', { class: 'banner warn', role: 'note' },
    h('strong', null, 'כדאי להתייעץ עם רופא. '),
    `סימנת בפרופיל: ${signs.join(', ')}. אלה סימנים שמצדיקים בירור רפואי. האפליקציה לא מאבחנת ולא יכולה לשלול בעיה.`);
}

// ---------- today / dashboard ----------

function metricCard(label, value, sub, tag) {
  return h('div', { class: 'metric' }, h('div', { class: 'm-label' }, label), h('div', { class: 'm-value' }, value), sub ? h('div', { class: 'm-sub' }, sub) : null, tag);
}

function todayView() {
  const list = nightsList();
  const md = morningDate(), ed = eveningDate();
  const last = [...list].reverse().find(hasMorning);
  const lastR = last && computeNight(last);
  const week = summarizeNights(nightsInWindow(list, md, 7));
  const out = [safetyBanner()];

  if (!S.profile) out.push(h('a', { class: 'card cta', href: '#/profile' }, h('strong', null, 'פרופיל שינה'), h('span', { class: 'muted' }, 'שאלון חד־פעמי. אפשר למלא עכשיו או מאוחר יותר.')));

  const todo = [];
  if (!S.nights[md] || !hasMorning(S.nights[md])) todo.push(h('a', { class: 'primary btn', href: '#/morning/' + md }, 'מילוי יומן הבוקר'));
  if (!S.factors[ed]) todo.push(h('a', { class: 'btn', href: '#/evening/' + ed }, 'מילוי יומן הערב'));
  if (todo.length) out.push(h('div', { class: 'actions' }, todo));

  out.push(h('section', { class: 'card' },
    h('h2', null, 'השינה שלך בלילה האחרון'),
    last ? [
      h('div', { class: 'muted small' }, nightLabel(last.night_date), ' · ', h('a', { href: '#/night/' + last.night_date }, 'פרטים')),
      lastR.errors.length ? h('div', { class: 'banner error' }, 'ברשומה הזאת יש שעות שלא מסתדרות. ', h('a', { href: '#/morning/' + last.night_date }, 'תקן')) :
        h('div', { class: 'metrics' },
          metricCard('משך שינה', calcVal(lastR.metrics.TST, hmRound), lastR.metrics.TST ? 'שעות' : null, tagCalc()),
          metricCard('יקיצות', selfVal(last.awakening_count, one), null, tagSelf()),
          metricCard('ערות במהלך הלילה', selfVal(last.wake_after_sleep_onset_minutes, mins), null, last.sources && last.sources.wake_after_sleep_onset_minutes === 'derived' ? tagDerived() : tagSelf()),
          metricCard('איכות שינה', selfVal(last.sleep_quality_rating, outOf5), null, tagSelf())),
    ] : h('p', { class: 'muted' }, 'עדיין אין לילות ביומן.')));

  out.push(h('section', { class: 'card' },
    h('h2', null, 'השינה שלך — 7 הימים האחרונים'),
    h('div', { class: 'muted small' }, `${week.recorded} מתוך 7 לילות תועדו`, week.invalid ? ` · ${week.invalid} דורשים תיקון ולא נספרו` : ''),
    h('div', { class: 'metrics' },
      metricCard('שעות שינה (ממוצע)', fmtAvg(week.TST, hmRound), nOf(week.TST), tagCalc()),
      metricCard('יקיצות (ממוצע ללילה)', fmtAvg(week.NWAK, one), nOf(week.NWAK), tagCalc()),
      metricCard('זמן ערות (ממוצע)', fmtAvg(week.WASO, mins), nOf(week.WASO), tagCalc()),
      metricCard('איכות שינה (ממוצע)', week.SQ.value ? `${one(week.SQ.value.min)}/5` : '—', nOf(week.SQ), tagCalc()))));

  out.push(chartsSection(list, md));
  out.push(splitSection(list, md));
  out.push(disclaimer());
  return h('div', { class: 'stack' }, out);
}

const nOf = s => (s.n ? `לפי ${s.n} לילות${s.excluded ? ` · ${s.excluded} ללא נתון` : ''}` : 'אין מספיק נתונים');

function chartsSection(list, endDate) {
  const days = [];
  for (let i = S.range - 1; i >= 0; i--) {
    const date = addDays(endDate, -i);
    const n = S.nights[date];
    const rec = n && hasMorning(n);
    const r = rec ? computeNight({ ...n, night_date: date }) : null;
    const ok = r && !r.errors.length;
    days.push({ date, n, r: ok ? r : null, recorded: rec });
  }
  const pick = key => days.map(d => ({ date: d.date, recorded: d.recorded, value: d.r ? d.r.metrics[key] : null }));
  const refOn = !S.settings || S.settings.reference_line !== false;

  const rows = days.filter(d => d.r).map(d => {
    const n = d.n, t = nightTz(n), date = d.date;
    const at = iso => (known(iso) ? minutesFromAnchor(date, Date.parse(iso), t) : null);
    const attempt = at(n.sleep_attempt_at);
    const sol = n.sleep_onset_latency_minutes;
    return {
      date, dayType: n.day_type, bed: at(n.bed_entry_at), attempt,
      onset: attempt !== null && isExact(sol) ? attempt + sol.min : null,
      final: at(n.final_awakening_at), out: at(n.out_of_bed_at),
      wakes: (n.awakening_times || []).map(at).filter(v => v !== null),
    };
  }).reverse();

  return h('section', { class: 'card' },
    h('div', { class: 'row-between' }, h('h2', null, 'גרפים'),
      chips([7, 14, 30, 90].map(v => ({ v, l: String(v) })), o => S.range === o.v, o => { S.range = o.v; render(); }, { cls: 'small' })),
    h('h3', null, 'משך השינה'),
    h('div', { svg: barChart({ days: pick('TST'), fmt: v => hm(Math.round(v)), refLine: refOn ? 420 : null, title: 'משך שינה לפי לילה', yMax: 540 }) }),
    h('p', { class: 'legend' }, legend(), refOn ? [h('span', { class: 'key ref' }), '7 שעות: קו השוואה, לא ציון'] : null),
    h('h3', null, 'רציפות השינה'),
    h('div', { class: 'muted small' }, 'מספר יקיצות'),
    h('div', { svg: barChart({ days: pick('NWAK'), fmt: v => one(v), title: 'מספר יקיצות לפי לילה', yMax: 3 }) }),
    h('div', { class: 'muted small' }, 'ערות לאחר הירדמות (דקות)'),
    h('div', { svg: barChart({ days: pick('WASO'), fmt: v => String(Math.round(v)), title: 'ערות לאחר הירדמות לפי לילה', yMax: 30 }) }),
    h('h3', null, 'שעות השינה והקימה'),
    rows.length ? h('div', { svg: timelineChart({ rows, title: 'ציר זמן לילי' }) }) : h('p', { class: 'muted' }, 'אין לילות להצגה בטווח הזה.'),
    h('p', { class: 'legend' },
      h('span', { class: 'key tl-bed' }), 'במיטה ', h('span', { class: 'key tl-sol' }), 'ניסיון להירדם ', h('span', { class: 'key tl-sleep' }), 'שינה משוערת ',
      h('span', { class: 'key tl-wake' }), 'יקיצה (אם פורטה שעה) · ',
      h('span', { class: 'key dt dt-early_work' }), 'עבודה מוקדמת ', h('span', { class: 'key dt dt-regular_work' }), 'רגילה ', h('span', { class: 'key dt dt-evening_shift' }), 'משמרת ערב'));
}

const legend = () => [h('span', { class: 'key bar' }), 'ערך מדויק ', h('span', { class: 'key bar-range' }), 'טווח ', h('span', { class: 'muted' }, '? = לא ידוע · קו על הבסיס = 0 · משבצת ריקה = לא תועד ')];

function splitSection(list, endDate) {
  const inRange = nightsInWindow(list, endDate, S.range);
  const split = splitByDayType(inRange);
  return h('section', { class: 'card' },
    h('h2', null, `לפי סוג יום · ${S.range} ימים`),
    h('div', { class: 'table-wrap' }, h('table', { class: 'split' },
      h('thead', null, h('tr', null, h('th', null, 'סוג היום'), h('th', null, 'לילות'), h('th', null, 'שינה'), h('th', null, 'ערות'), h('th', null, 'איכות'))),
      h('tbody', null, DAY_TYPES_SPLIT.map(t => {
        const s = split[t];
        return h('tr', null, h('td', null, h('span', { class: 'key dt dt-' + t }), F.dayTypeLabel(t)), h('td', null, String(s.recorded)),
          h('td', null, fmtAvg(s.TST, hmRound)), h('td', null, fmtAvg(s.WASO, mins)), h('td', null, s.SQ.value ? one(s.SQ.value.min) : '—'));
      })))),
    h('p', { class: 'muted small' }, 'ממוצעים לפי הלילות שיש בהם נתון. בקבוצה קטנה ההבדלים עלולים להיות מקריים, ולכן לא מוצגת השוואה או מסקנה.',
      split.untyped ? ` ${split.untyped} לילות בלי סוג יום.` : ''));
}

// ---------- morning diary ----------

function prevMorning(date) {
  return nightsList().filter(n => n.night_date < date && hasMorning(n)).pop();
}

function morningDraft(date) {
  const n = S.nights[date] || {};
  const t = nightTz(n);
  return {
    date, existing: hasMorning(n), askDayType: !known(n.day_type), day_type: n.day_type,
    bed: isoToHM(n.bed_entry_at, t) || undefined,
    attempt_mode: n.sleep_attempt_same_as_bed ? 'same' : known(n.sleep_attempt_at) ? 'time' : undefined,
    attempt: n.sleep_attempt_same_as_bed ? undefined : isoToHM(n.sleep_attempt_at, t) || undefined,
    sol: n.sleep_onset_latency_minutes, final: isoToHM(n.final_awakening_at, t) || undefined, out: isoToHM(n.out_of_bed_at, t) || undefined,
    nwak: n.awakening_count,
    waso: n.sources && n.sources.wake_after_sleep_onset_minutes === 'derived' ? undefined : n.wake_after_sleep_onset_minutes,
    sq: n.sleep_quality_rating, mr: n.morning_refreshment_rating, fn: n.daytime_function_rating, dreams: n.dreams, notes: n.notes,
    resume_status: n.attempt_to_resume_status, resume_minutes: n.attempt_to_resume_status === 'yes' && known(n.attempt_to_resume_after_final_wake_minutes) ? n.attempt_to_resume_after_final_wake_minutes.min : undefined,
    awakenings: null, awakeningsPrevCount: n.awakening_detail_count || 0, showMore: false,
  };
}

function formFor(key, make) {
  if (!S.form || S.form.key !== key) S.form = { key, draft: make(), status: '', errors: [], warnings: [], confirmed: false };
  return S.form;
}

function morningView(date) {
  const form = formFor('morning/' + date, () => morningDraft(date));
  const d = form.draft;
  const prev = prevMorning(date);
  const pt = prev && nightTz(prev);
  const p = prev ? {
    bed: isoToHM(prev.bed_entry_at, pt), attempt: prev.sleep_attempt_same_as_bed ? undefined : isoToHM(prev.sleep_attempt_at, pt),
    final: isoToHM(prev.final_awakening_at, pt), out: isoToHM(prev.out_of_bed_at, pt), sol: prev.sleep_onset_latency_minutes,
  } : {};
  if (d.awakenings === null && d.awakeningsPrevCount && S.user) {
    d.awakenings = [];
    const at = nightTz(S.nights[date]);
    // Stored shape -> form shape: {at: ISO | null, window} -> {when_kind, time, window}.
    loadAwakenings(S.user.uid, date).then(list => {
      d.awakenings = list.map(({ n, at: iso, window, source, ...rest }) => ({
        ...rest,
        when_kind: known(iso) ? 'time' : window ? 'window' : iso === null ? 'unknown' : undefined,
        time: known(iso) ? isoToHM(iso, at) : undefined,
        window,
      }));
      render();
    })
      .catch(err => { console.error('sleeplab: loading awakenings failed', err); d.awakeningsError = true; render(); });
  }
  const set = key => v => { d[key] = v; };

  const out = [
    h('h1', null, 'יומן בוקר'),
    h('div', { class: 'muted' }, nightLabel(date), ' · ', h('a', { href: '#/morning/' + addDays(date, -1) }, 'לילה קודם'),
      date < morningDate() ? [' · ', h('a', { href: '#/morning/' + addDays(date, 1) }, 'לילה הבא')] : null),
  ];
  if (d.askDayType) {
    out.push(h('section', { class: 'card' }, field('מה סוג היום היום?', valueChoice(d, 'day_type', F.DAY_TYPES)),
      h('p', { class: 'muted small' }, 'לא מולא יומן ערב ללילה הזה, אז סוג היום נשאל כאן.')));
  }
  out.push(h('section', { class: 'card' },
    h('h2', null, 'שעות'),
    field('1. באיזו שעה נכנסת למיטה?', timeInput(d.bed, set('bed'), { prev: p.bed })),
    field('2. באיזו שעה התחלת לנסות להירדם?',
      chips([{ v: 'same', l: 'מיד כשנכנסתי למיטה' }, { v: 'time', l: 'בשעה אחרת' }], o => d.attempt_mode === o.v, o => { d.attempt_mode = d.attempt_mode === o.v ? undefined : o.v; render(); }),
      d.attempt_mode === 'time' ? timeInput(d.attempt, set('attempt'), { prev: p.attempt }) : null),
    field('3. כמה זמן לקח לך להירדם?', rangeChoice(d, 'sol', F.SOL_OPTIONS, { prev: prev ? p.sol : undefined })),
    field('4. באיזו שעה התעוררת בפעם האחרונה?', timeInput(d.final, set('final'), { prev: p.final })),
    field('5. באיזו שעה יצאת מהמיטה?', timeInput(d.out, set('out'), { prev: p.out }))));

  out.push(h('section', { class: 'card' },
    h('h2', null, 'יקיצות'),
    field('6. כמה פעמים התעוררת במהלך הלילה, בלי לספור את היקיצה הסופית?', rangeChoice(d, 'nwak', F.NWAK_OPTIONS, { prev: prev ? prev.awakening_count : undefined })),
    d.nwak && d.nwak.max === 0 ? h('p', { class: 'muted small' }, 'בלי יקיצות, זמן הערות בלילה נרשם כ־0 (נגזר).') :
      field('7. כמה זמן היית ער בסך הכול במהלך היקיצות?', rangeChoice(d, 'waso', F.WASO_OPTIONS))));

  out.push(h('section', { class: 'card' },
    h('h2', null, 'איך היה'),
    field('8. איכות השינה הלילה', valueChoice(d, 'sq', F.SQ_OPTIONS)),
    field('9. איך אתה מרגיש עכשיו?', valueChoice(d, 'mr', F.MR_OPTIONS))));

  out.push(h('button', { type: 'button', class: 'link more', 'aria-expanded': d.showMore ? 'true' : 'false', onclick: () => { d.showMore = !d.showMore; render(); } }, d.showMore ? 'פחות פרטים' : 'פרטים נוספים'));
  if (d.showMore) {
    out.push(h('section', { class: 'card' },
      d.askDayType ? null : field('סוג היום', valueChoice(d, 'day_type', F.DAY_TYPES)),
      field('10. האם השינה פגעה בתפקוד הצפוי שלך היום?', valueChoice(d, 'fn', F.FUNCTION_OPTIONS)),
      field('11. האם חלמת חלומות בולטים?', valueChoice(d, 'dreams', F.DREAM_OPTIONS)),
      field('לאחר שהתעוררת סופית, האם המשכת לנסות להירדם?', valueChoice(d, 'resume_status', F.RESUME_OPTIONS),
        d.resume_status === 'yes' ? h('div', { class: 'inline' }, numberInput(d.resume_minutes, set('resume_minutes'), { placeholder: 'דקות' }), h('span', { class: 'muted' }, 'דקות (ריק = לא ידוע)')) : null),
      field('12. הערות', h('textarea', { rows: 3, value: d.notes || '', oninput: e => { d.notes = e.target.value; } }))));
    out.push(awakeningsSection(d));
  }

  if (form.errors.length) out.push(h('div', { class: 'banner error', role: 'alert' }, h('strong', null, 'לא נשמר. '), form.errors.map(e => ERROR_TEXT[e.code] || e.code).join(' ')));
  if (form.warnings.length && !form.confirmed) {
    out.push(h('div', { class: 'banner warn', role: 'alert' }, 'ערכים חריגים: ', form.warnings.map(w => WARNING_TEXT[w.code] || w.code).join(' '), ' ',
      h('button', { type: 'button', class: 'btn', onclick: () => { form.confirmed = true; saveMorning(form); } }, 'הערכים נכונים, שמור')));
  }
  out.push(saveBar(form, () => saveMorning(form)));
  out.push(disclaimer());
  return h('div', { class: 'stack' }, out);
}

function awakeningsSection(d) {
  if (d.awakeningsError) return h('div', { class: 'banner error' }, 'לא ניתן לטעון את פירוט היקיצות. רענן לפני עריכה, כדי לא לדרוס אותו.');
  const list = d.awakenings || (d.awakenings = []);
  const nwak = d.nwak;
  const mismatch = list.length && known(nwak) && (list.length < nwak.min || (nwak.max !== null && list.length > nwak.max));
  return h('section', { class: 'card' },
    h('h2', null, 'פירוט יקיצות (רשות)'),
    h('p', { class: 'muted small' }, 'החישובים לפי שאלות 6 ו־7. הפירוט נשמר בנפרד ולא נספר פעמיים. היקיצה הסופית לא נכללת כאן.'),
    mismatch ? h('div', { class: 'banner warn' }, `פירטת ${list.length} יקיצות, ובשאלה 6 סימנת ${fmtVal(nwak, one)}.`) : null,
    list.map((a, i) => h('div', { class: 'sub-card' },
      h('div', { class: 'row-between' }, h('strong', null, `יקיצה ${i + 1}`), h('button', { type: 'button', class: 'link', onclick: () => { list.splice(i, 1); render(); } }, 'הסר')),
      field('מתי התעוררת?',
        chips([{ v: 'time', l: 'שעה משוערת' }, ...F.AWAKENING_WHEN], o => (o.v === 'time' ? a.when_kind === 'time' : a.when_kind === 'window' ? a.window === o.v : a.when_kind === 'unknown' && o.v === 'unknown'),
          o => { if (o.v === 'time') a.when_kind = 'time'; else if (o.v === 'unknown') { a.when_kind = 'unknown'; a.window = undefined; } else { a.when_kind = 'window'; a.window = o.v; } render(); }),
        a.when_kind === 'time' ? timeInput(a.time, v => { a.time = v; }) : null),
      field('כמה זמן היית ער?', rangeChoice(a, 'duration', F.WASO_OPTIONS)),
      field('מה לדעתך העיר אותך?', valueChoice(a, 'cause', F.AWAKENING_CAUSE)),
      field('מה עשית?', valueChoice(a, 'action', F.AWAKENING_ACTION)),
      field('חזרת לישון?', valueChoice(a, 'returned', F.AWAKENING_RETURNED)))),
    list.length < 20 ? h('button', { type: 'button', class: 'btn', onclick: () => { list.push({}); render(); } }, 'הוסף יקיצה') : null);
}

function saveBar(form, onSave) {
  const text = { saving: 'שומר… (אם אין חיבור, השמירה תחכה לו)', saved: 'נשמר', error: 'השמירה נכשלה. מה שהזנת לא נמחק; נסה שוב.' }[form.status];
  return h('div', { class: 'savebar' },
    h('button', { type: 'button', class: 'primary', disabled: form.status === 'saving', onclick: () => { form.confirmed = false; onSave(); } }, 'שמירה'),
    text ? h('span', { class: form.status === 'error' ? 'error-text' : 'muted', role: 'status' }, text) : null);
}

async function runSave(form, write, after) {
  form.status = 'saving';
  render();
  try {
    await write();
    form.status = 'saved';
    if (after) after();
  } catch (err) {
    console.error('sleeplab: save failed', err);
    form.status = 'error';
  }
  render();
}

function saveMorning(form) {
  const d = form.draft, date = d.date;
  const stored = S.nights[date] || {};
  const t = known(stored.timezone) ? stored.timezone : tz();
  const attemptHM = d.attempt_mode === 'same' ? d.bed : d.attempt_mode === 'time' ? d.attempt : undefined;
  const [bed, attempt, final, out] = resolveSequence(date, [d.bed, attemptHM, d.final, d.out], t);
  const iso = v => (v === null || v === undefined ? REMOVE : toIso(v, t));
  const v = x => (x === undefined ? REMOVE : x);
  const derivedWaso = d.nwak && d.nwak.max === 0 && d.waso === undefined;
  const resume = d.resume_status === undefined ? REMOVE : d.resume_status === 'no' ? exact(0) : d.resume_status === 'yes' && d.resume_minutes !== undefined ? exact(d.resume_minutes) : null;
  const notes = (d.notes || '').trim();

  const list = (d.awakenings || []).map(a => {
    const x = { source: 'self_report' };
    if (a.when_kind === 'time' && a.time) x.at = toIso(nextWall(attempt ?? bed ?? nightAnchor(date, t), a.time, t), t);
    else if (a.when_kind === 'window') x.window = a.window;
    else if (a.when_kind === 'unknown') x.at = null;
    for (const k of ['duration', 'cause', 'action', 'returned']) if (a[k] !== undefined) x[k] = a[k];
    return x;
  });

  const fields = {
    timezone: t,
    bed_entry_at: iso(bed), sleep_attempt_at: iso(attempt), sleep_attempt_same_as_bed: d.attempt_mode === 'same' && bed != null ? true : REMOVE,
    sleep_onset_latency_minutes: v(d.sol), final_awakening_at: iso(final), out_of_bed_at: iso(out),
    awakening_count: v(d.nwak), wake_after_sleep_onset_minutes: derivedWaso ? exact(0) : v(d.waso),
    attempt_to_resume_status: v(d.resume_status), attempt_to_resume_after_final_wake_minutes: resume,
    sleep_quality_rating: v(d.sq), morning_refreshment_rating: v(d.mr), daytime_function_rating: v(d.fn),
    dreams: v(d.dreams), notes: notes ? notes : REMOVE,
    awakening_detail_count: list.length, awakening_times: list.filter(a => known(a.at)).map(a => a.at),
  };
  if (d.day_type !== undefined && d.day_type !== stored.day_type) { fields.day_type = d.day_type; fields.day_type_entered_in = 'morning'; }
  const sources = {};
  for (const k of ['bed_entry_at', 'sleep_attempt_at', 'sleep_onset_latency_minutes', 'final_awakening_at', 'out_of_bed_at', 'awakening_count', 'wake_after_sleep_onset_minutes',
    'attempt_to_resume_after_final_wake_minutes', 'sleep_quality_rating', 'morning_refreshment_rating', 'daytime_function_rating', 'dreams', 'notes']) {
    sources[k] = fields[k] === REMOVE ? REMOVE : 'self_report';
  }
  if (derivedWaso) sources.wake_after_sleep_onset_minutes = 'derived';
  if (fields.day_type) sources.day_type = 'self_report';
  fields.sources = sources;

  const merged = { ...stored, night_date: date };
  for (const [k, x] of Object.entries(fields)) { if (x === REMOVE) delete merged[k]; else merged[k] = x; }
  const result = computeNight(merged);
  form.errors = result.errors;
  form.warnings = result.warnings;
  if (result.errors.length) { form.status = ''; render(); return; }
  if (result.warnings.length && !form.confirmed) { form.status = ''; render(); return; }

  const now = new Date();
  fields.derived = derivedFor(merged, now);
  fields.recorded_at = stored.recorded_at || now.toISOString();
  if (d.existing || stored.recorded_at) fields.edited_at = now.toISOString();
  fields.morning_saved_at = now.toISOString();

  runSave(form, () => saveNight(S.user.uid, date, fields, d.awakenings === null ? undefined : list, d.awakeningsPrevCount),
    () => { S.flashNext = 'יומן הבוקר נשמר'; S.form = null; location.hash = '#/night/' + date; });
}

// ---------- evening diary ----------

function eveningDraft(date) {
  const n = S.nights[date] || {};
  const f = S.factors[date] || {};
  const t = nightTz(n);
  const planned = isoToHM(n.planned_wake_at, t) || undefined;
  return {
    date, existing: !!S.factors[date],
    planned, planned_other: planned && !wakeChips().includes(planned),
    day_type: n.day_type, coffee: f.coffee_count,
    caffeine_kind: f.last_caffeine && f.last_caffeine.kind, caffeine_time: f.last_caffeine && f.last_caffeine.at ? isoToHM(f.last_caffeine.at, t) : undefined,
    exercise: f.exercise, mask: f.sleep_mask, unusual: f.unusual ? [...f.unusual] : [], unusualOpen: !!(f.unusual && f.unusual.length),
    morning_light: f.morning_light, exercise_minutes: f.exercise_minutes, exercise_intensity: f.exercise_intensity,
    screens_minutes: f.screens_before_bed_minutes, stress: f.stress_level, alcohol_drinks: f.alcohol_drinks,
    alcohol_time: f.alcohol_at ? isoToHM(f.alcohol_at, t) : undefined, nap_start: f.nap_start_at ? isoToHM(f.nap_start_at, t) : undefined, nap_minutes: f.nap_minutes,
    caffeine_log: (f.caffeine_log || []).map(c => ({ time: isoToHM(c.at, t), drink: c.drink, servings: c.servings })),
  };
}
// Planned-wake chips: the wake times from the profile first, filled up to four with neutral defaults.
function wakeChips() {
  const p = profileValues();
  const fromProfile = [p.wake_time_early_work, p.wake_time_regular && p.wake_time_regular.from, p.wake_time_regular && p.wake_time_regular.to, p.preferred_waketime]
    .filter(Boolean);
  return [...new Set([...fromProfile, ...F.PLANNED_WAKE_CHIPS])].slice(0, 4).sort();
}
const extraOn = key => !!(S.settings && S.settings.evening_extras && S.settings.evening_extras[key]);

function eveningView(date) {
  const form = formFor('evening/' + date, () => eveningDraft(date));
  const d = form.draft;
  const set = key => v => { d[key] = v; };
  const out = [
    h('h1', null, 'יומן ערב'),
    h('div', { class: 'muted' }, `${dateLabel(date)} · לפני ${nightLabel(date)}`),
    h('section', { class: 'card' },
      field('מתי אתה מתכנן לקום מחר?',
        chips([...wakeChips().map(v => ({ v, l: v })), { v: 'other', l: 'שעה אחרת' }],
          o => (o.v === 'other' ? !!d.planned_other : !d.planned_other && d.planned === o.v),
          o => { if (o.v === 'other') { d.planned_other = !d.planned_other; if (!d.planned_other) d.planned = undefined; } else { d.planned_other = false; d.planned = d.planned === o.v ? undefined : o.v; } render(); }),
        d.planned_other ? timeInput(d.planned, set('planned')) : null),
      field('מה סוג היום מחר?', valueChoice(d, 'day_type', F.DAY_TYPES)),
      field('כמה קפה שתית היום?', rangeChoice(d, 'coffee', F.COFFEE_OPTIONS)),
      field('מתי צרכת קפאין בפעם האחרונה?',
        chips([{ v: 'time', l: 'בשעה' }, { v: 'unknown', l: 'לא זוכר' }, { v: 'none', l: 'לא צרכתי' }], o => d.caffeine_kind === o.v, o => { d.caffeine_kind = d.caffeine_kind === o.v ? undefined : o.v; render(); }),
        d.caffeine_kind === 'time' ? timeInput(d.caffeine_time, set('caffeine_time')) : null),
      field('האם התאמנת היום?', valueChoice(d, 'exercise', F.EXERCISE_OPTIONS)),
      field('האם אתה משתמש במסכת שינה הלילה?', valueChoice(d, 'mask', [{ v: true, l: 'כן' }, { v: false, l: 'לא' }])),
      h('button', { type: 'button', class: 'link more', 'aria-expanded': d.unusualOpen ? 'true' : 'false', onclick: () => { d.unusualOpen = !d.unusualOpen; render(); } }, 'האם משהו היה חריג היום?'),
      d.unusualOpen ? chips(F.UNUSUAL_OPTIONS, o => d.unusual.includes(o.v), o => { d.unusual = d.unusual.includes(o.v) ? d.unusual.filter(x => x !== o.v) : [...d.unusual, o.v]; render(); }) : null),
  ];

  const extras = [];
  if (extraOn('morning_light')) extras.push(field('חשיפה לאור טבעי בבוקר', rangeChoice(d, 'morning_light', F.MORNING_LIGHT_OPTIONS)));
  if (extraOn('exercise_detail')) extras.push(field('משך ועצימות הפעילות', h('div', { class: 'inline' }, numberInput(d.exercise_minutes, set('exercise_minutes'), { placeholder: 'דקות' }), h('span', { class: 'muted' }, 'דקות')), valueChoice(d, 'exercise_intensity', F.INTENSITY_OPTIONS)));
  if (extraOn('screens_before_bed')) extras.push(field('מסכים בשעה שלפני השינה', h('div', { class: 'inline' }, numberInput(d.screens_minutes, set('screens_minutes'), { placeholder: 'דקות' }), h('span', { class: 'muted' }, 'דקות'))));
  if (extraOn('stress_level')) extras.push(field('רמת מתח היום (0–4)', valueChoice(d, 'stress', F.STRESS_OPTIONS)));
  if (extraOn('alcohol_detail')) extras.push(field('אלכוהול', h('div', { class: 'inline' }, numberInput(d.alcohol_drinks, set('alcohol_drinks'), { placeholder: 'מנות' }), h('span', { class: 'muted' }, 'מנות, שעה אחרונה:')), timeInput(d.alcohol_time, set('alcohol_time'))));
  if (extraOn('nap_detail')) extras.push(field('תנומה', timeInput(d.nap_start, set('nap_start')), h('div', { class: 'inline' }, numberInput(d.nap_minutes, set('nap_minutes'), { placeholder: 'דקות' }), h('span', { class: 'muted' }, 'דקות'))));
  if (extraOn('caffeine_log')) {
    extras.push(field('כל משקה עם קפאין היום',
      d.caffeine_log.map((c, i) => h('div', { class: 'sub-card' },
        h('div', { class: 'row-between' }, h('strong', null, `משקה ${i + 1}`), h('button', { type: 'button', class: 'link', onclick: () => { d.caffeine_log.splice(i, 1); render(); } }, 'הסר')),
        timeInput(c.time, v => { c.time = v; }), valueChoice(c, 'drink', F.CAFFEINE_DRINKS),
        h('div', { class: 'inline' }, numberInput(c.servings, v => { c.servings = v; }, { placeholder: 'כמות' }), h('span', { class: 'muted' }, 'מנות')))),
      h('button', { type: 'button', class: 'btn', onclick: () => { d.caffeine_log.push({}); render(); } }, 'הוסף משקה')));
  }
  if (extras.length) out.push(h('section', { class: 'card' }, h('h2', null, 'שדות נוספים'), extras));
  out.push(saveBar(form, () => saveEveningForm(form)));
  return h('div', { class: 'stack' }, out);
}

function saveEveningForm(form) {
  const d = form.draft, date = d.date;
  const stored = S.nights[date] || {};
  const t = known(stored.timezone) ? stored.timezone : tz();
  const v = x => (x === undefined ? REMOVE : x);
  // A time during the evening's day: same calendar day, or after midnight if before 05:00.
  const dayTime = hmv => {
    if (!hmv) return REMOVE;
    const day = +hmv.slice(0, 2) < 5 ? addDays(date, 1) : date;
    return toIso(wallInstants(day, hmv, t)[0] ?? nextWall(nightAnchor(day, t) - 12 * 3600000, hmv, t), t);
  };
  const now = new Date().toISOString();
  const nightFields = {
    timezone: t,
    planned_wake_at: d.planned ? toIso(resolveSequence(date, [d.planned], t)[0], t) : REMOVE,
    evening_saved_at: now,
    sources: { planned_wake_at: d.planned ? 'self_report' : REMOVE },
  };
  if (d.day_type !== stored.day_type) {
    nightFields.day_type = v(d.day_type);
    nightFields.day_type_entered_in = d.day_type === undefined ? REMOVE : 'evening';
    nightFields.sources.day_type = d.day_type === undefined ? REMOVE : 'self_report';
  }
  const factors = {
    timezone: t, coffee_count: v(d.coffee),
    last_caffeine: d.caffeine_kind === undefined ? REMOVE : d.caffeine_kind === 'time' ? (d.caffeine_time ? { kind: 'time', at: dayTime(d.caffeine_time) } : REMOVE) : { kind: d.caffeine_kind, at: null },
    exercise: v(d.exercise), sleep_mask: v(d.mask), unusual: d.unusual,
    source: 'self_report', recorded_at: (S.factors[date] && S.factors[date].recorded_at) || now,
  };
  if (d.existing) factors.edited_at = now;
  if (extraOn('morning_light')) factors.morning_light = v(d.morning_light);
  if (extraOn('exercise_detail')) { factors.exercise_minutes = v(d.exercise_minutes); factors.exercise_intensity = v(d.exercise_intensity); }
  if (extraOn('screens_before_bed')) factors.screens_before_bed_minutes = v(d.screens_minutes);
  if (extraOn('stress_level')) factors.stress_level = v(d.stress);
  if (extraOn('alcohol_detail')) { factors.alcohol_drinks = v(d.alcohol_drinks); factors.alcohol_at = dayTime(d.alcohol_time); }
  if (extraOn('nap_detail')) { factors.nap_start_at = dayTime(d.nap_start); factors.nap_minutes = v(d.nap_minutes); }
  if (extraOn('caffeine_log')) {
    factors.caffeine_log = d.caffeine_log.filter(c => c.time || c.drink || c.servings !== undefined)
      .map(c => ({ at: c.time ? dayTime(c.time) : null, drink: c.drink ?? null, servings: c.servings ?? null }));
  }
  runSave(form, () => saveEvening(S.user.uid, date, nightFields, factors),
    () => { S.flashNext = 'יומן הערב נשמר'; S.form = null; location.hash = '#/today'; });
}

// ---------- one night ----------

function nightView(date) {
  const n = S.nights[date];
  const f = S.factors[date];
  if (!n && !f) {
    return h('div', { class: 'stack' }, h('h1', null, nightLabel(date)), h('p', { class: 'muted' }, 'אין רשומה ללילה הזה.'),
      h('div', { class: 'actions' }, h('a', { class: 'btn primary', href: '#/morning/' + date }, 'מילוי יומן בוקר'), h('a', { class: 'btn', href: '#/evening/' + date }, 'מילוי יומן ערב')));
  }
  const night = { ...(n || {}), night_date: date };
  const r = computeNight(night);
  const t = nightTz(n);
  const src = k => (n && n.sources && n.sources[k] === 'derived' ? tagDerived() : tagSelf());
  const row = (label, value, tag) => h('tr', null, h('th', null, label), h('td', null, value), h('td', null, tag));
  const timeOf = k => (known(night[k]) ? isoToHM(night[k], t) : night[k] === null ? 'לא ידוע' : '—');
  const opt = (options, val) => (val === undefined ? '—' : (options.find(o => o.v === val) || {}).l || String(val));
  const QUALITY = { complete: 'נתונים מלאים', range: 'חלק מהערכים הם טווח', partial: 'חלק מהנתונים חסרים', insufficient: 'אין מספיק נתונים לחישוב משך השינה', invalid: 'יש שעות שלא מסתדרות' };

  return h('div', { class: 'stack' },
    h('h1', null, nightLabel(date)),
    h('div', { class: 'muted' }, 'סוג היום: ', F.dayTypeLabel(night.day_type), night.day_type_entered_in === 'morning' ? ' (נשאל בבוקר)' : ''),
    h('div', { class: 'actions' }, h('a', { class: 'btn primary', href: '#/morning/' + date }, hasMorning(night) ? 'עריכת יומן הבוקר' : 'מילוי יומן בוקר'), h('a', { class: 'btn', href: '#/evening/' + date }, f ? 'עריכת יומן הערב' : 'מילוי יומן ערב')),
    r.errors.length ? h('div', { class: 'banner error' }, r.errors.map(e => ERROR_TEXT[e.code] || e.code).join(' ')) : null,
    h('section', { class: 'card' }, h('h2', null, 'מדדים'),
      h('div', { class: 'muted small' }, 'איכות הנתונים: ', QUALITY[r.data_quality]),
      h('table', { class: 'kv' }, h('tbody', null,
        row('זמן במיטה (TIB)', calcVal(r.metrics.TIB, hmRound), tagCalc()),
        row('זמן הירדמות (SOL)', selfVal(night.sleep_onset_latency_minutes, mins), tagSelf()),
        row('משך שינה משוער (TST)', calcVal(r.metrics.TST, hmRound), tagCalc()),
        row('ערות לאחר הירדמות (WASO)', selfVal(night.wake_after_sleep_onset_minutes, mins), src('wake_after_sleep_onset_minutes')),
        row('מספר יקיצות (NWAK)', selfVal(night.awakening_count, one), tagSelf()),
        row('ערות לאחר היקיצה הסופית', calcVal(r.metrics.TWAK, mins), tagCalc()),
        row('יעילות שינה (SE)', calcVal(r.metrics.SE, pct), tagCalc()),
        row('איכות שינה (SQ)', selfVal(night.sleep_quality_rating, outOf5), tagSelf()),
        row('רעננות בבוקר (MR)', selfVal(night.morning_refreshment_rating, outOf5), tagSelf()))),
      h('p', { class: 'muted small' }, '— = לא נענה · לא ידוע = נבחר "לא יודע"'),
      h('p', { class: 'muted small' }, 'SE = משך שינה ÷ זמן במיטה. TST = יקיצה סופית − תחילת ניסיון להירדם − SOL − WASO.')),
    hasMorning(night) ? h('section', { class: 'card' }, h('h2', null, 'מה דיווחת בבוקר'),
      h('table', { class: 'kv' }, h('tbody', null,
        row('כניסה למיטה', timeOf('bed_entry_at'), tagSelf()),
        row('תחילת ניסיון להירדם', night.sleep_attempt_same_as_bed ? 'מיד כשנכנסתי' : timeOf('sleep_attempt_at'), tagSelf()),
        row('יקיצה סופית', timeOf('final_awakening_at'), tagSelf()),
        row('יציאה מהמיטה', timeOf('out_of_bed_at'), tagSelf()),
        row('ניסיון לחזור לישון אחרי היקיצה', opt(F.RESUME_OPTIONS, night.attempt_to_resume_status) + (night.attempt_to_resume_status === 'yes' ? ` · ${fmtVal(night.attempt_to_resume_after_final_wake_minutes, mins)}` : ''), tagSelf()),
        row('פגיעה בתפקוד', opt(F.FUNCTION_OPTIONS, night.daytime_function_rating), tagSelf()),
        row('חלומות', opt(F.DREAM_OPTIONS, night.dreams), tagSelf()),
        row('פירוט יקיצות', night.awakening_detail_count ? `${night.awakening_detail_count} רשומות` : '—', tagSelf()),
        night.notes ? row('הערות', night.notes, tagSelf()) : null))) : null,
    f ? h('section', { class: 'card' }, h('h2', null, 'יומן הערב'),
      h('table', { class: 'kv' }, h('tbody', null,
        row('קימה מתוכננת', known(night.planned_wake_at) ? isoToHM(night.planned_wake_at, t) : '—', tagSelf()),
        row('קפה', fmtVal(f.coffee_count, one), tagSelf()),
        row('קפאין אחרון', !f.last_caffeine ? '—' : f.last_caffeine.kind === 'time' ? isoToHM(f.last_caffeine.at, t) : f.last_caffeine.kind === 'none' ? 'לא צרכתי' : 'לא זוכר', tagSelf()),
        row('אימון', opt(F.EXERCISE_OPTIONS, f.exercise), tagSelf()),
        row('מסכת שינה', f.sleep_mask === undefined ? '—' : f.sleep_mask ? 'כן' : 'לא', tagSelf()),
        row('חריג', f.unusual && f.unusual.length ? f.unusual.map(u => opt(F.UNUSUAL_OPTIONS, u)).join(', ') : '—', tagSelf())))) : null,
    disclaimer());
}

// ---------- history ----------

function historyView(arg) {
  const month = /^\d{4}-\d{2}$/.test(arg || '') ? arg : todayIn(tz()).slice(0, 7);
  const [y, m] = month.split('-').map(Number);
  const first = `${month}-01`;
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const lead = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const prevM = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7);
  const nextM = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7);
  const today = todayIn(tz());
  const cells = [];
  for (let i = 0; i < lead; i++) cells.push(h('span', { class: 'day empty' }));
  for (let dd = 1; dd <= days; dd++) {
    const date = `${month}-${pad(dd)}`;
    const n = S.nights[date];
    const morning = n && hasMorning(n);
    const bad = morning && computeNight({ ...n, night_date: date }).errors.length;
    const evening = !!S.factors[date];
    const cls = 'day' + (morning ? ' rec' : '') + (evening && !morning ? ' eve' : '') + (bad ? ' bad' : '') + (date === today ? ' today' : '') + (date > today ? ' future' : '');
    const label = `${dd}${morning ? ', יומן בוקר' : ''}${evening ? ', יומן ערב' : ''}${bad ? ', דורש תיקון' : ''}`;
    cells.push(date > today ? h('span', { class: cls }, String(dd)) : h('a', { class: cls, href: '#/night/' + date, 'aria-label': label }, String(dd)));
  }
  const recorded = Object.keys(S.nights).filter(d => d.startsWith(month) && hasMorning(S.nights[d])).length;
  return h('div', { class: 'stack' },
    h('h1', null, 'היסטוריה'),
    h('section', { class: 'card' },
      h('div', { class: 'row-between' }, h('a', { href: '#/history/' + prevM, class: 'btn' }, '→ הקודם'),
        h('strong', null, new Intl.DateTimeFormat('he-IL', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(first + 'T12:00:00Z'))),
        h('a', { href: '#/history/' + nextM, class: 'btn' }, 'הבא ←')),
      h('div', { class: 'cal' }, ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'].map(w => h('span', { class: 'wd' }, w)), cells),
      h('p', { class: 'legend' }, h('span', { class: 'key cal-rec' }), 'יומן בוקר ', h('span', { class: 'key cal-eve' }), 'ערב בלבד ', h('span', { class: 'key cal-bad' }), 'דורש תיקון'),
      h('p', { class: 'muted small' }, `${recorded} לילות תועדו בחודש הזה. לחיצה על יום פותחת את הלילה שמתחיל בערב שלו.`)));
}

// ---------- settings ----------

function settingsView() {
  const st = S.settings || {};
  const extras = st.evening_extras || {};
  const status = S.settingsStatus;
  const put = async data => {
    S.settingsStatus = 'saving'; render();
    try { await saveSettings(S.user.uid, data); S.settingsStatus = 'saved'; } catch (err) { console.error('sleeplab: saving settings failed', err); S.settingsStatus = 'error'; }
    render();
  };
  const toggle = (label, on, onChange) => h('label', { class: 'toggle' }, h('input', { type: 'checkbox', checked: on, onchange: e => onChange(e.target.checked) }), h('span', null, label));
  const TZS = ['Asia/Jerusalem', 'Europe/Madrid', 'Europe/London', 'Europe/Berlin', 'America/New_York', 'Asia/Bangkok', 'UTC'];
  return h('div', { class: 'stack' },
    h('h1', null, 'הגדרות'),
    status ? h('div', { class: status === 'error' ? 'banner error' : 'muted small', role: 'status' }, { saving: 'שומר…', saved: 'נשמר', error: 'השמירה נכשלה. נסה שוב.' }[status]) : null,
    h('section', { class: 'card' }, h('h2', null, 'פרופיל שינה'),
      h('p', { class: 'muted' }, S.profile ? 'השאלון הראשוני. אפשר לעדכן בכל זמן.' : 'עדיין לא מולא.'),
      h('a', { class: 'btn', href: '#/profile' }, S.profile ? 'עריכת הפרופיל' : 'מילוי הפרופיל')),
    h('section', { class: 'card' }, h('h2', null, 'שדות נוספים ביומן הערב'),
      h('p', { class: 'muted small' }, 'כבויים כברירת מחדל. מה שמופעל יופיע ביומן הערב.'),
      F.EVENING_EXTRAS.map(x => toggle(x.l, !!extras[x.key], on => put({ evening_extras: { [x.key]: on } })))),
    h('section', { class: 'card' }, h('h2', null, 'תצוגה'),
      toggle('קו ייחוס של 7 שעות בגרף משך השינה (קו השוואה, לא ציון)', st.reference_line !== false, on => put({ reference_line: on })),
      field('אזור זמן לרשומות חדשות', h('select', { onchange: e => put({ timezone: e.target.value }) }, TZS.map(z => h('option', { value: z, selected: z === tz() }, z))),
        h('p', { class: 'muted small' }, 'כל לילה שומר את אזור הזמן שבו נרשם, כך ששינוי כאן לא משנה לילות קודמים.'))),
    h('section', { class: 'card' }, h('h2', null, 'ייצוא נתונים'),
      h('p', { class: 'muted small' }, 'קובץ CSV עם כל נתוני המקור והמדדים המחושבים. ערך "לא ידוע" נכתב כ־null, ושאלה שלא נענתה נשארת ריקה. טווחים בשתי עמודות (_min, _max).'),
      h('div', { class: 'actions' },
        h('button', { type: 'button', class: 'btn', onclick: exportNights }, 'ייצוא לילות (CSV)'),
        h('button', { type: 'button', class: 'btn', onclick: () => download(`sleeplab-profile-${todayIn(tz())}.csv`, profileCsv(S.profile)) }, 'ייצוא פרופיל (CSV)')),
      S.exportStatus ? h('div', { class: S.exportStatus === 'error' ? 'banner error' : 'muted small', role: 'status' }, S.exportStatus === 'error' ? 'הייצוא נכשל. נסה שוב.' : 'מכין קובץ…') : null),
    h('section', { class: 'card' }, h('h2', null, 'חשבון'),
      h('p', { class: 'muted small' }, S.user.email),
      h('button', { type: 'button', class: 'btn', onclick: () => signOutUser().catch(err => console.error('sleeplab: sign-out failed', err)) }, 'יציאה')),
    disclaimer());
}

async function exportNights() {
  S.exportStatus = 'working'; render();
  try {
    const awakenings = {};
    for (const [date, n] of Object.entries(S.nights)) {
      if (n.awakening_detail_count) awakenings[date] = (await loadAwakenings(S.user.uid, date)).map(({ n: i, ...a }) => a);
    }
    download(`sleeplab-nights-${todayIn(tz())}.csv`, nightsCsv(S.nights, S.factors, awakenings));
    S.exportStatus = null;
  } catch (err) {
    console.error('sleeplab: export failed', err);
    S.exportStatus = 'error';
  }
  render();
}

// ---------- profile ----------

function profileView() {
  const form = formFor('profile', () => ({ values: JSON.parse(JSON.stringify(profileValues())) }));
  const p = form.draft.values;
  const out = [
    h('h1', null, 'פרופיל שינה'),
    h('p', { class: 'muted' }, 'שאלון חד־פעמי על רקע השינה. הוא לא נשאל בכל בוקר. כל מה שמוזן כאן הוא דיווח ראשוני, ומסומן "טרם אומת ביומן". אפשר לדלג על כל שאלה, ו"לא ידוע" שונה מ"לא".'),
    safetyBanner(),
  ];
  for (const sec of F.PROFILE_SECTIONS) {
    out.push(h('section', { class: 'card' }, h('h2', null, sec.title),
      sec.fields.filter(fd => !fd.showIf || fd.showIf(p)).map(fd => profileField(fd, p))));
  }
  out.push(saveBar(form, () => saveProfileForm(form)));
  out.push(disclaimer());
  return h('div', { class: 'stack' }, out);
}

function profileField(fd, p) {
  const stored = S.profile && S.profile.fields && S.profile.fields[fd.key];
  const badge = stored && stored.initial_report ? h('span', { class: 'tag pending' }, 'טרם אומת ביומן') : null;
  const set = v => { p[fd.key] = v; };
  let input;
  switch (fd.type) {
    case 'choice': input = valueChoice(p, fd.key, fd.options); break;
    case 'multi': input = chips(fd.options, o => (p[fd.key] || []).includes(o.v), o => { const cur = p[fd.key] || []; const next = cur.includes(o.v) ? cur.filter(x => x !== o.v) : [...cur, o.v]; p[fd.key] = next.length ? next : undefined; render(); }); break;
    case 'time': input = timeInput(p[fd.key], set); break;
    case 'time_range': {
      const cur = p[fd.key] || {};
      const upd = (k, v) => { const next = { ...(p[fd.key] || {}), [k]: v }; p[fd.key] = next.from || next.to ? { from: next.from ?? null, to: next.to ?? null } : undefined; };
      input = h('div', { class: 'inline' }, h('span', { class: 'muted' }, 'בין'), timeInput(cur.from || undefined, v => upd('from', v)), h('span', { class: 'muted' }, 'ל־'), timeInput(cur.to || undefined, v => upd('to', v)));
      break;
    }
    case 'range': {
      const cur = p[fd.key] || {};
      const upd = (k, v) => {
        const next = { ...(p[fd.key] || {}), [k]: v };
        const min = next.min ?? null, max = next.max ?? null;
        p[fd.key] = min === null && max === null ? undefined : { min: min ?? max, max: max ?? min };
      };
      input = h('div', { class: 'inline' }, h('span', { class: 'muted' }, 'מ־'), numberInput(cur.min, v => upd('min', v)), h('span', { class: 'muted' }, 'עד'), numberInput(cur.max, v => upd('max', v)), h('span', { class: 'muted' }, fd.unit));
      break;
    }
    case 'meds': {
      const list = p[fd.key] || (p[fd.key] = []);
      input = [list.map((m, i) => h('div', { class: 'sub-card' },
        h('div', { class: 'row-between' }, h('strong', null, `תרופה ${i + 1}`), h('button', { type: 'button', class: 'link', onclick: () => { list.splice(i, 1); render(); } }, 'הסר')),
        h('label', null, 'שם', h('input', { value: m.name || '', oninput: e => { m.name = e.target.value; } })),
        h('label', null, 'מינון', h('input', { value: m.dose || '', oninput: e => { m.dose = e.target.value; } })),
        h('label', null, 'שעת נטילה', timeInput(m.time, v => { m.time = v; })),
        h('label', null, 'תאריך התחלה', h('input', { type: 'date', value: m.start_date || '', oninput: e => { m.start_date = e.target.value || undefined; } })))),
      h('button', { type: 'button', class: 'btn', onclick: () => { list.push({}); render(); } }, 'הוסף תרופה')];
      break;
    }
    default:
      input = fd.long ? h('textarea', { rows: 3, value: p[fd.key] || '', oninput: e => { p[fd.key] = e.target.value || undefined; } })
        : h('input', { value: p[fd.key] || '', oninput: e => { p[fd.key] = e.target.value || undefined; } });
  }
  return h('div', { class: 'field' }, h('div', { class: 'label' }, fd.l, ' ', badge), input);
}

function saveProfileForm(form) {
  const p = form.draft.values;
  const old = (S.profile && S.profile.fields) || {};
  const now = new Date().toISOString();
  const clean = (fd, v) => {
    if (fd.type === 'meds') {
      const list = (v || []).map(m => Object.fromEntries(Object.entries(m).filter(([, x]) => x !== undefined && x !== ''))).filter(m => Object.keys(m).length);
      return list.length ? list : undefined;
    }
    if (typeof v === 'string') return v.trim() ? v.trim() : undefined;
    return v;
  };
  const fields = {};
  for (const fd of F.PROFILE_FIELDS) {
    const v = clean(fd, p[fd.key]);
    if (v === undefined) { if (old[fd.key]) fields[fd.key] = REMOVE; continue; }
    const same = old[fd.key] && JSON.stringify(old[fd.key].value) === JSON.stringify(v);
    if (same) continue;
    fields[fd.key] = { value: v, source: 'self_report', initial_report: true, updated_at: now };
  }
  runSave(form, () => saveProfile(S.user.uid, { fields, updated_at: now, created_at: (S.profile && S.profile.created_at) || now }),
    () => { S.flashNext = 'הפרופיל נשמר'; S.form = null; location.hash = '#/today'; });
}

render();
