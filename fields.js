/* Question definitions for the diary and the profile: labels, options, and how each answer is
   stored. Durations and counts are stored as {min, max} (exact when equal, max null = open-ended);
   "לא יודע" is null; an unanswered question is simply absent. Nothing here holds personal data:
   the profile starts empty and is filled in through the app. */

const r = (min, max = min) => ({ min, max });

export const DAY_TYPES = [
  { v: 'early_work', l: 'עבודה מוקדמת' },
  { v: 'regular_work', l: 'עבודה רגילה' },
  { v: 'evening_shift', l: 'משמרת ערב' },
  { v: 'day_off', l: 'יום חופשי' },
  { v: 'other', l: 'אחר' },
];
export const dayTypeLabel = v => (DAY_TYPES.find(d => d.v === v) || {}).l || '—';

// Morning diary (§5.2). `other: true` opens a number field; `unknown: true` stores null.
export const SOL_OPTIONS = [
  ...[5, 10, 15, 20, 30, 45, 60].map(n => ({ l: `${n} ד׳`, v: r(n) })),
  { l: 'אחר', other: true },
  { l: 'לא יודע', unknown: true },
];
export const NWAK_OPTIONS = [
  ...[0, 1, 2, 3].map(n => ({ l: String(n), v: r(n) })),
  { l: '\u200e4+', v: r(4, null) },
  { l: 'לא יודע', unknown: true },
];
export const WASO_OPTIONS = [
  { l: 'פחות מ־5 ד׳', v: r(0, 5) },
  ...[5, 10, 15, 20, 30, 45, 60, 90].map(n => ({ l: `${n} ד׳`, v: r(n) })),
  { l: '120 ד׳ ומעלה', v: r(120, null) },
  { l: 'משך אחר', other: true },
  { l: 'לא יודע', unknown: true },
];
export const SQ_OPTIONS = ['גרועה מאוד', 'גרועה', 'בינונית', 'טובה', 'מצוינת'].map((l, i) => ({ l: `${i + 1} · ${l}`, v: i + 1 }));
export const MR_OPTIONS = ['מותש', 'עייף', 'בסדר', 'רענן', 'רענן מאוד'].map((l, i) => ({ l: `${i + 1} · ${l}`, v: i + 1 }));
export const FUNCTION_OPTIONS = ['בכלל לא', 'מעט', 'במידה בינונית', 'במידה רבה', 'במידה רבה מאוד'].map((l, i) => ({ l, v: i }));
export const DREAM_OPTIONS = [
  { v: 'dont_remember', l: 'לא זוכר' }, { v: 'regular', l: 'חלומות רגילים' }, { v: 'vivid', l: 'חלומות חיים במיוחד' },
  { v: 'nightmares', l: 'סיוטים' }, { v: 'skip', l: 'מעדיף לדלג' },
];
export const RESUME_OPTIONS = [{ v: 'no', l: 'לא' }, { v: 'yes', l: 'כן' }, { v: 'dont_remember', l: 'לא זוכר' }];

// Optional per-awakening detail (§5.2).
export const AWAKENING_WHEN = [
  { v: '00-02', l: '00:00–02:00' }, { v: '02-04', l: '02:00–04:00' }, { v: '04-06', l: '04:00–06:00' },
  { v: '06-08', l: '06:00–08:00' }, { v: 'unknown', l: 'לא יודע' },
];
export const AWAKENING_CAUSE = [
  { v: 'unknown', l: 'לא יודע' }, { v: 'noise', l: 'רעש' }, { v: 'light', l: 'אור' }, { v: 'dream', l: 'חלום' },
  { v: 'bathroom', l: 'צורך בשירותים' }, { v: 'pain', l: 'כאב' }, { v: 'temperature', l: 'חום או קור' }, { v: 'other', l: 'אחר' },
];
export const AWAKENING_ACTION = [
  { v: 'stayed_in_bed', l: 'נשארתי במיטה' }, { v: 'bathroom', l: 'קמתי לשירותים' }, { v: 'calm_activity', l: 'קמתי לפעילות רגועה' },
  { v: 'phone', l: 'השתמשתי בטלפון' }, { v: 'other', l: 'אחר' },
];
export const AWAKENING_RETURNED = [{ v: 'yes', l: 'כן' }, { v: 'no', l: 'לא' }, { v: 'unknown', l: 'לא יודע' }];

// Evening diary (§5.1).
// Neutral defaults; the evening screen uses the wake times from the profile instead when it has them.
export const PLANNED_WAKE_CHIPS = ['06:00', '07:00', '08:00'];
export const COFFEE_OPTIONS = [...[0, 1, 2, 3].map(n => ({ l: String(n), v: r(n) })), { l: '\u200e4+', v: r(4, null) }];
export const EXERCISE_OPTIONS = [
  { v: 'none', l: 'לא' }, { v: 'walk', l: 'הליכה' }, { v: 'strength', l: 'כוח' }, { v: 'aerobic', l: 'אירובי' }, { v: 'other', l: 'אחר' },
];
export const UNUSUAL_OPTIONS = [
  { v: 'stress', l: 'מתח חריג' }, { v: 'alcohol', l: 'אלכוהול' }, { v: 'nicotine', l: 'ניקוטין' },
  { v: 'illness_pain', l: 'מחלה או כאב' }, { v: 'medication_change', l: 'שינוי בתרופות' },
  { v: 'heavy_late_meal', l: 'ארוחה כבדה או מאוחרת' }, { v: 'nap', l: 'תנומה במהלך היום' },
  { v: 'travel_timezone', l: 'נסיעה או שינוי אזור זמן' }, { v: 'other_event', l: 'אירוע משמעותי אחר' },
];

// Extra evening fields, each off by default and switched on in Settings (§5.1).
export const EVENING_EXTRAS = [
  { key: 'morning_light', l: 'חשיפה לאור טבעי בבוקר' },
  { key: 'exercise_detail', l: 'משך הפעילות הגופנית ועצימותה' },
  { key: 'screens_before_bed', l: 'שימוש במסכים לפני השינה' },
  { key: 'stress_level', l: 'רמת מתח (0–4)' },
  { key: 'alcohol_detail', l: 'אלכוהול: מנות ושעה' },
  { key: 'nap_detail', l: 'תנומה: שעה ומשך' },
  { key: 'caffeine_log', l: 'מצב מתקדם: כל משקה עם קפאין, שעה וכמות' },
];
export const MORNING_LIGHT_OPTIONS = [
  { l: 'אין', v: r(0) }, { l: 'עד 15 ד׳', v: r(1, 15) }, { l: '15–30 ד׳', v: r(15, 30) }, { l: 'מעל 30 ד׳', v: r(30, null) },
];
export const INTENSITY_OPTIONS = [{ v: 'light', l: 'קלה' }, { v: 'moderate', l: 'בינונית' }, { v: 'vigorous', l: 'גבוהה' }];
export const STRESS_OPTIONS = [0, 1, 2, 3, 4].map(n => ({ l: String(n), v: n }));
export const CAFFEINE_DRINKS = [
  { v: 'espresso', l: 'אספרסו' }, { v: 'coffee', l: 'קפה' }, { v: 'tea', l: 'תה' }, { v: 'energy', l: 'משקה אנרגיה' },
  { v: 'cola', l: 'קולה' }, { v: 'other', l: 'אחר' },
];

/* Profile (§4.1–4.2). Types:
     time            "HH:MM"
     time_range      {from, to} "HH:MM"
     range           {min, max} numbers, with `unit`
     number, text    plain
     choice          one of options
     multi           array of option values
     meds            [{name, dose, time, start_date}]
   Every answer is saved as {value, source:'self_report', initial_report:true}: a first report, shown
   as "טרם אומת ביומן" until the diary has data to compare it with. */
const TRI = [{ v: 'yes', l: 'כן' }, { v: 'no', l: 'לא' }, { v: 'unknown', l: 'לא ידוע' }];
const YES_NO_SOMETIMES = [{ v: 'yes', l: 'כן' }, { v: 'no', l: 'לא' }, { v: 'sometimes', l: 'לעיתים' }];
const YES_NO = [{ v: 'yes', l: 'כן' }, { v: 'no', l: 'לא' }];
const YES_NO_NA = [{ v: 'yes', l: 'כן' }, { v: 'no', l: 'לא' }, { v: 'na', l: 'לא רלוונטי' }];
const USE = [{ v: 'uses', l: 'משתמש' }, { v: 'not', l: 'לא משתמש' }, { v: 'decline', l: 'מעדיף לא לענות' }];
const FREQ = [{ v: 'never', l: 'אף פעם' }, { v: 'rarely', l: 'לעיתים רחוקות' }, { v: 'sometimes', l: 'לפעמים' }, { v: 'often', l: 'לרוב' }, { v: 'nightly', l: 'כל לילה' }];
const WEEKDAYS = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'].map((l, i) => ({ v: i, l }));

export const PROFILE_SECTIONS = [
  {
    title: 'שגרת שינה ודפוס הקושי',
    fields: [
      { key: 'problem_onset_kind', l: 'מתי התחילו קשיי השינה?', type: 'choice', options: [{ v: 'approx_date', l: 'תאריך משוער' }, { v: 'years', l: 'מספר שנים' }, { v: 'unknown', l: 'לא יודע' }] },
      { key: 'problem_onset_value', l: 'תאריך משוער או מספר שנים', type: 'text', showIf: p => ['approx_date', 'years'].includes(p.problem_onset_kind) },
      { key: 'usual_bedtime', l: 'שעת שינה רגילה', type: 'time' },
      { key: 'preferred_bedtime', l: 'שעת שינה מועדפת', type: 'time' },
      { key: 'preferred_waketime', l: 'שעת קימה מועדפת', type: 'time' },
      { key: 'typical_sol', l: 'זמן הירדמות רגיל', type: 'range', unit: 'דקות' },
      { key: 'typical_awakenings', l: 'מספר יקיצות רגיל בלילה', type: 'range', unit: 'יקיצות' },
      { key: 'nights_with_awakenings', l: 'בכמה לילות בשבוע יש יקיצות', type: 'range', unit: 'לילות' },
      { key: 'typical_awakening_time', l: 'שעות היקיצה הרגילות', type: 'multi', options: [{ v: '00-02', l: '00–02' }, { v: '02-04', l: '02–04' }, { v: '04-06', l: '04–06' }, { v: 'varies', l: 'משתנה' }, { v: 'unknown', l: 'לא יודע' }] },
      { key: 'typical_awake_duration', l: 'משך ערות רגיל ביקיצה', type: 'range', unit: 'דקות' },
      { key: 'returns_to_sleep', l: 'חזרה לשינה אחרי יקיצה', type: 'choice', options: [{ v: 'always', l: 'תמיד' }, { v: 'almost_always', l: 'כמעט תמיד' }, { v: 'sometimes', l: 'לפעמים' }, { v: 'rarely', l: 'לעיתים רחוקות' }, { v: 'unknown', l: 'לא יודע' }] },
      { key: 'estimated_sleep_hours', l: 'משך שינה משוער', type: 'range', unit: 'שעות' },
      { key: 'wake_time_early_work', l: 'שעת קימה בימי עבודה מוקדמים', type: 'time' },
      { key: 'wake_time_regular', l: 'שעת קימה בימים רגילים', type: 'time_range' },
      { key: 'naps', l: 'תנומות', type: 'choice', options: [{ v: 'none', l: 'בדרך כלל אין' }, { v: 'sometimes', l: 'לפעמים' }, { v: 'usually', l: 'בדרך כלל כן' }] },
    ],
  },
  {
    title: 'השפעה ותסמינים',
    fields: [
      { key: 'impact', l: 'עד כמה הקושי מפריע לתפקוד? (0–4)', type: 'choice', options: [0, 1, 2, 3, 4].map(n => ({ v: n, l: String(n) })) },
      { key: 'daytime_sleepiness', l: 'ישנוניות משמעותית ביום', type: 'choice', options: TRI },
      { key: 'stress_low_mood', l: 'מתח או ירידה במצב הרוח', type: 'choice', options: [{ v: 'no', l: 'לא' }, { v: 'sometimes', l: 'לעיתים' }, { v: 'often', l: 'לעיתים קרובות' }, { v: 'decline', l: 'מעדיף לא לענות' }] },
      { key: 'snoring', l: 'נחירות', type: 'choice', options: TRI },
      { key: 'breathing_pauses', l: 'הפסקות נשימה בשינה', type: 'choice', options: TRI, warning: true },
      { key: 'choking_awakenings', l: 'יקיצות בחנק או בהתנשפות', type: 'choice', options: TRI, warning: true },
      { key: 'dry_mouth', l: 'יובש בפה בבוקר', type: 'choice', options: YES_NO_SOMETIMES },
      { key: 'morning_headache', l: 'כאבי ראש בבוקר', type: 'choice', options: YES_NO_SOMETIMES },
      { key: 'nasal_congestion', l: 'גודש באף', type: 'choice', options: YES_NO_SOMETIMES },
      { key: 'leg_urge', l: 'דחף להזיז את הרגליים במנוחה בערב', type: 'choice', options: YES_NO },
      { key: 'sleepwalking', l: 'הליכה בשינה', type: 'choice', options: TRI },
      { key: 'dream_enactment', l: 'התנהגות חריגה בזמן חלומות', type: 'choice', options: TRI },
      { key: 'sleep_paralysis', l: 'שיתוק שינה', type: 'choice', options: TRI },
      { key: 'medical_factors', l: 'גורמים רפואיים שמפריעים לשינה', type: 'multi', options: [{ v: 'pain', l: 'כאבים' }, { v: 'reflux', l: 'רפלוקס' }, { v: 'breathing', l: 'בעיות נשימה' }, { v: 'urination', l: 'הטלת שתן' }, { v: 'none', l: 'אין' }] },
      { key: 'involuntary_sleep', l: 'הירדמות לא רצונית במהלך היום', type: 'choice', options: YES_NO_NA, warning: true },
      { key: 'drowsy_driving', l: 'נמנום בנהיגה', type: 'choice', options: YES_NO_NA, warning: true },
    ],
  },
  {
    title: 'תרופות וחומרים',
    fields: [
      { key: 'medications', l: 'תרופות קבועות', type: 'meds' },
      { key: 'caffeine_use', l: 'קפאין', type: 'choice', options: USE },
      { key: 'caffeine_typical', l: 'כמה משקאות עם קפאין ביום בדרך כלל', type: 'range', unit: 'משקאות', showIf: p => p.caffeine_use === 'uses' },
      { key: 'nicotine_use', l: 'ניקוטין', type: 'choice', options: USE },
      { key: 'alcohol_use', l: 'אלכוהול', type: 'choice', options: USE },
      { key: 'other_substances_use', l: 'חומרים אחרים', type: 'choice', options: USE },
    ],
  },
  {
    title: 'עבודה',
    fields: [
      { key: 'work_days', l: 'ימי עבודה', type: 'multi', options: WEEKDAYS },
      { key: 'work_hours', l: 'שעות עבודה רגילות', type: 'text' },
      { key: 'shift_work', l: 'משמרות', type: 'choice', options: [{ v: 'none', l: 'לא' }, { v: 'fixed', l: 'משמרות קבועות' }, { v: 'rotating', l: 'משמרות מתחלפות' }] },
      { key: 'early_wake_days', l: 'ימים עם קימה מוקדמת', type: 'multi', options: WEEKDAYS },
    ],
  },
  {
    title: 'סביבה והרגלים',
    fields: [
      { key: 'environment', l: 'תנאי החדר', type: 'multi', options: [{ v: 'light', l: 'אור' }, { v: 'outside_noise', l: 'רעשי חוץ' }, { v: 'hot', l: 'חם' }, { v: 'cold', l: 'קר' }, { v: 'sleeps_alone', l: 'ישן לבד' }, { v: 'sleeps_with_someone', l: 'ישן עם אדם נוסף' }] },
      { key: 'screens_in_bed', l: 'שימוש במסכים במיטה', type: 'choice', options: FREQ },
      { key: 'reading_in_bed', l: 'קריאה במיטה', type: 'choice', options: FREQ },
      { key: 'clock_checking', l: 'בדיקת השעה בלילה', type: 'choice', options: FREQ },
      { key: 'notes', l: 'הערות', type: 'text', long: true },
    ],
  },
];

export const PROFILE_FIELDS = PROFILE_SECTIONS.flatMap(s => s.fields);

// §16: answers that call for a doctor's opinion. The app says so plainly and diagnoses nothing.
export const warningSigns = profileValues =>
  PROFILE_FIELDS.filter(f => f.warning && profileValues[f.key] === 'yes').map(f => f.l);
