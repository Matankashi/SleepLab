# SleepLab

**Version: v1.0**

A personal sleep diary built on clinical sleep-diary methods (Consensus Sleep Diary): a one-time
sleep profile, a short evening diary and a morning diary, a metrics engine
(TIB/SOL/TST/WASO/NWAK/terminal wake/SE/SQ/MR), a dashboard, history, and CSV export. Static files
on GitHub Pages (`https://matankashi.github.io/SleepLab/`, repo `git@github.com:Matankashi/SleepLab.git`,
served from `main`), Firestore in its own Firebase project `sleeplab-59eb4` (eur3), email/password
sign-in. Part of the Thegg app set: its row lives in `~/app-registry`.

The build brief and the spec are `private/brief.md` and `private/spec.md`. **`private/` is gitignored
and must never be committed**: the spec holds personal health details and the repo is public.

## Working rules

Standing rules from the user, for every session:

1. **Security first, and stop and tell first.** If you find a problem, a risk, or anything the user
   should know, stop and tell them before acting.
2. **Explicit approval per action.** Never commit, push, tag, deploy rules, or change anything in
   Firebase, Google Cloud or GitHub without the user's go-ahead for that specific action. Console
   steps are written out for the user, who does them and confirms.
3. **No personal or medical data in the repo**: not in code, tests, seed data or commit messages.
   The profile is built empty; the user fills it in through the app. Before each commit, grep the
   tracked files for values from `private/spec.md` §4.1.
4. **Don't tag `v1.0` (or any version) before the user has checked the live site.**
5. **One font: Arial, no web fonts** (all the user's apps). `'Arial','Arial Hebrew',Helvetica,sans-serif`,
   weights 400/600/700 only.
6. **Nothing third-party** beyond the Firebase SDK: no analytics, no chart or UI libraries, no CDN fonts.
7. **The app diagnoses nothing and recommends no medication** (spec §16). Warning signs in the
   profile produce a plain "see a doctor" message, nothing more.
8. **No delete-all in v1** (the user's decision, 2026-10-17). CSV export only. If data ever has to
   be deleted, Claude does it by hand with the Firebase CLI, after export and explicit approval.

Repo conventions:

- No build step, no npm. ES modules. The Firebase SDK comes from gstatic, pinned to `12.18.0`, and
  only `firebase.js` imports it.
- Stage files by name, never `git add -A`/`.`. Show the diff before committing.
- Every `catch` logs with `console.error('sleeplab: ...', err)`, even when there's a fallback.
- Tags: `vX.Y`. Bump the version line here and in README.md when tagging.

## Files

`index.html`, `styles.css` (tokens, light/dark), `app.js` (routing, screens, forms, saving),
`firebase.js` (sign-in, reads, writes), `firebase-config.js` (public web config), `fields.js`
(question definitions), `time.js` (clock times to instants, DST), `calc.js` (metrics engine, pure),
`charts.js` (hand-drawn SVG), `csv.js` (export), `firestore.rules`, `firebase.json`, `.firebaserc`,
`tests/`.

## Data (Firestore, `users/{uid}/`)

- `profile/main`: `{fields: {key: {value, source:'self_report', initial_report:true, updated_at}}, created_at, updated_at}`.
  Only answered questions are stored. Every value shows "טרם אומת ביומן" (initial report).
- `settings/main`: `{evening_extras: {key: bool}, reference_line, timezone}`.
- `nights/{night_date}`: night_date is the evening the night starts. Times are ISO strings with
  offset (`bed_entry_at`, `sleep_attempt_at`, `final_awakening_at`, `out_of_bed_at`,
  `planned_wake_at`) plus `timezone`. Durations and counts are `{min, max}` (exact when equal,
  `max: null` = open-ended). Also `sources{field: self_report|derived}`, `day_type` (`early_work`,
  `regular_work`, `evening_shift`, `day_off`, `other`) with `day_type_entered_in` (`evening` or
  `morning`), `awakening_detail_count`, `awakening_times`, `recorded_at`/`edited_at`, and
  `derived{formula_version, computed_at, metrics, data_quality}`, which sits next to the source
  data and never replaces it.
- `nights/{night_date}/awakenings/{n}`: optional detail, `{at | window, duration, cause, action, returned, source}`.
- `dailyFactors/{night_date}`: the evening diary.
- **null = the user answered "לא יודע"; a missing field = not asked or not answered. Never 0.**
- Each form owns its fields and writes all of them (`REMOVE` → `deleteField()` for a cleared answer),
  merged into the document, so a morning save never touches evening fields.
- Firestore keeps its default memory cache (no IndexedDB): all github.io sites of this account share
  one origin.

## Engine (calc.js), formula version 1

- Clock times are placed in diary order, each the first matching moment after the previous one,
  starting from noon on night_date (`time.js`). Durations are measured between real instants, so
  midnight and DST are handled.
- `TST = final − attempt − SOL − WASO`, as a range when an input is a range. `SE = TST / TIB × 100`.
  `TWAK = out − final`.
- Errors block the save with a Hebrew correction request: wrong order, a gap over 18h (a clock time
  typed earlier than the previous one), TIB of 24h or more, negative TST, 0 awakenings with WASO > 0,
  resume-trying longer than terminal wake. Warnings (TIB over 14h, SOL over 3h) ask for confirmation.
- Averages use only nights that have the value. Ranged nights average as `[mean(min), mean(max)]`.
  Missing nights aren't zeros. The day-type split covers early work / regular work / evening shift.
- If a formula changes, bump `FORMULA_VERSION`. Stored `derived` blocks keep their old version, and
  the screens and CSV always recompute from the source fields.

## Testing (emulator only, never the real project)

- Engine and CSV: `/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc -m tests/calc-test.mjs`
- Rules: `JAVA_HOME=~/.local/jdk/Contents/Home PATH="$HOME/.local/jdk/Contents/Home/bin:$PATH" firebase emulators:exec --only firestore --project demo-sleeplab "python3 tests/rules-test.py"`
- UI: start the emulators (`... firebase emulators:start --only auth,firestore --project demo-sleeplab`),
  then `python3 tests/serve-test.py --seed`, then open http://localhost:8020 with test@example.com / test-password.
  The seed is made-up nights only.

## Status

2026-10-17: built and tested locally (engine 59/59, rules 99/99, UI walk-through on the emulator).
Rules deployed and `main` pushed; Pages live. 2026-10-17: the user checked the live site on the
phone (sign-in, profile, evening + morning entry, edit, CSV export), then `v1.0` was tagged and the
SleepLab row added to `~/app-registry`.
