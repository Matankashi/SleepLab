# SleepLab

**Version: v1.0**

A personal sleep diary in Hebrew, based on clinical sleep-diary methods (the Consensus Sleep
Diary). Each night has a short evening entry and a morning entry. The app computes the standard
diary metrics and shows them by night, as 7-day averages, as graphs over 7/14/30/90 days, and split
by type of day (early work, regular work, evening shift). Everything is self-reported diary data,
not a sleep study, and the app diagnoses nothing.

Live: https://matankashi.github.io/SleepLab/ (sign-in only; there is no sign-up).

## What's in v1.0

- **Sleep profile:** a one-time questionnaire, editable in Settings. Answers are marked as an
  initial report ("טרם אומת ביומן"). "No" and "don't know" are kept apart. Some answers
  (breathing pauses, choking, dozing while driving, involuntary sleep) bring up a plain
  recommendation to see a doctor.
- **Evening diary:** planned wake time, tomorrow's type of day, coffee, last caffeine, exercise,
  sleep mask, "something unusual". More fields can be switched on in Settings.
- **Morning diary:** bed time, start of trying to sleep, time to fall asleep, final awakening, out
  of bed, awakenings, time awake, quality, refreshment. More under "פרטים נוספים", including
  optional detail per awakening. If the evening entry is missing, the morning asks for the type of
  day. Last night's answers are offered as one-tap shortcuts, never saved on their own.
- **Metrics:** TIB, SOL, TST, WASO, NWAK, terminal wake, SE, quality, refreshment. "Don't know" stays
  unknown, a range stays a range, and impossible combinations (such as more time awake than the
  night is long) ask for a correction instead of producing a number.
- **History:** a calendar of recorded nights. Editing a past night recomputes everything.
- **CSV export** of all source data and computed metrics.

Not in v1.0: experiments, PDF report, advanced analysis and insights, ISI/ESS/STOP-Bang
questionnaires, Apple Health, AI, deleting data from the app.

## Files

| File | What it does |
|---|---|
| `index.html`, `styles.css` | Page shell and styles (light and dark, Arial only) |
| `app.js` | Screens, forms, routing, saving |
| `firebase.js` | Sign-in and Firestore reads/writes |
| `firebase-config.js` | Public Firebase web config |
| `fields.js` | Question definitions and options |
| `time.js` | Clock times to real instants (midnight, DST) |
| `calc.js` | The metrics engine |
| `charts.js` | SVG charts, no library |
| `csv.js` | Export |
| `firestore.rules` | Security rules, deployed with the Firebase CLI |
| `firebase.json`, `.firebaserc` | CLI settings: rules and emulators only, no Hosting |
| `tests/` | Engine/CSV unit tests, rules test, local test server, made-up seed data |

## Security and privacy

- **Sign-in:** email and password only. The one account is created by hand in the Firebase
  console. Sign-up and self-delete are off.
- **Rules:** only the owner's UID, only these paths under `/users/{uid}`: `profile/main`,
  `settings/main`, `nights/{date}`, `nights/{date}/awakenings/{n}`, `dailyFactors/{date}`.
  Everything else is denied, including any other account. Nothing can be deleted except a single
  awakening detail while editing a night. `tests/rules-test.py` checks this against the emulator
  before every deploy.
- **API key:** public by design. It's restricted by HTTP referrer and to the Auth and Firestore APIs
  in Google Cloud Console; the rules are what protect the data.
- **No personal data in the repo.** The spec (`private/`) is gitignored. The profile starts empty.
  No analytics and no third-party scripts besides the Firebase SDK. Data isn't cached on disk in
  the browser.

## Testing

See CLAUDE.md "Testing". Everything runs against the local emulators with made-up data.
