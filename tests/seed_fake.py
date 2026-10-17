"""Made-up nights for the emulator (never real data). Used by serve-test.py --seed.

Writes nights/{date} and dailyFactors/{date} for the last 21 days through the emulator's REST API
with the admin token, which only exists in the emulator. Some dates are left empty, some answers
are "לא יודע" (null) or ranges, and the day types include every option, so the dashboard's
handling of gaps, unknowns and the day-type split can be checked by eye.
"""
import datetime as dt
import json
import random
import urllib.request
from zoneinfo import ZoneInfo

TZ = 'Asia/Jerusalem'


def value(v):
    if v is None:
        return {'nullValue': None}
    if isinstance(v, bool):
        return {'booleanValue': v}
    if isinstance(v, int):
        return {'integerValue': str(v)}
    if isinstance(v, float):
        return {'doubleValue': v}
    if isinstance(v, str):
        return {'stringValue': v}
    if isinstance(v, list):
        return {'arrayValue': {'values': [value(x) for x in v]}}
    if isinstance(v, dict):
        return {'mapValue': {'fields': {k: value(x) for k, x in v.items()}}}
    raise TypeError(type(v))


def put(project, path, data):
    url = 'http://127.0.0.1:8080/v1/projects/%s/databases/(default)/documents/%s' % (project, path)
    body = json.dumps({'fields': {k: value(x) for k, x in data.items()}}).encode()
    req = urllib.request.Request(url, data=body, method='PATCH',
                                 headers={'Content-Type': 'application/json', 'Authorization': 'Bearer owner'})
    urllib.request.urlopen(req).read()


def iso(day, hhmm, plus_days=0):
    h, m = map(int, hhmm.split(':'))
    t = dt.datetime.combine(day + dt.timedelta(days=plus_days), dt.time(h, m), ZoneInfo(TZ))
    return t.isoformat()


def r(lo, hi=None):
    return {'min': lo, 'max': lo if hi is None else hi}


def seed(project, uid, days=21):
    rnd = random.Random(7)
    today = dt.datetime.now(ZoneInfo(TZ)).date()
    types = ['early_work', 'regular_work', 'evening_shift', 'regular_work', 'day_off', 'early_work', 'other']
    count = 0
    for i in range(days, 0, -1):
        day = today - dt.timedelta(days=i)
        date = day.isoformat()
        if i in (1, 4, 11):       # no record at all (1 = last night, so the morning diary asks for the day type)
            continue
        day_type = types[i % len(types)]
        bed = {'early_work': '22:40', 'evening_shift': '00:50'}.get(day_type, '23:20')
        bed_next = 1 if bed < '12:00' else 0
        final = {'early_work': '05:40', 'evening_shift': '09:10'}.get(day_type, '07:20')
        out = {'early_work': '05:50', 'evening_shift': '09:30'}.get(day_type, '07:40')
        nwak = rnd.choice([0, 1, 1, 2])
        waso = r(0) if nwak == 0 else rnd.choice([r(15), r(25), r(0, 5), r(30), None])
        night = {
            'timezone': TZ, 'day_type': day_type, 'day_type_entered_in': 'evening',
            'bed_entry_at': iso(day, bed, bed_next), 'sleep_attempt_at': iso(day, bed, bed_next), 'sleep_attempt_same_as_bed': True,
            'sleep_onset_latency_minutes': rnd.choice([r(10), r(15), r(5), None if i == 9 else r(20)]),
            'final_awakening_at': iso(day, final, 1), 'out_of_bed_at': iso(day, out, 1),
            'awakening_count': r(nwak), 'wake_after_sleep_onset_minutes': waso,
            'sleep_quality_rating': rnd.choice([2, 3, 3, 4, 4, 5]), 'morning_refreshment_rating': rnd.choice([2, 3, 4]),
            'sources': {'bed_entry_at': 'self_report', 'wake_after_sleep_onset_minutes': 'derived' if nwak == 0 else 'self_report'},
            'awakening_detail_count': 0, 'awakening_times': [iso(day, '03:10', 1)] if nwak else [],
            'recorded_at': iso(day, out, 1),
        }
        if i == 6:                # evening only, no morning yet
            night = {'timezone': TZ, 'day_type': day_type, 'day_type_entered_in': 'evening'}
        put(project, 'users/%s/nights/%s' % (uid, date), night)
        put(project, 'users/%s/dailyFactors/%s' % (uid, date), {
            'timezone': TZ, 'coffee_count': r(rnd.choice([1, 2, 2, 3])),
            'last_caffeine': {'kind': 'time', 'at': iso(day, '13:30')}, 'exercise': rnd.choice(['none', 'walk', 'strength']),
            'sleep_mask': rnd.choice([True, False]), 'unusual': [], 'source': 'self_report',
        })
        count += 1
    return count
