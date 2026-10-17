#!/usr/bin/env python3
"""Firestore rules test against the local emulator. No dependencies.

From the repo root:
  JAVA_HOME=~/.local/jdk/Contents/Home PATH="$HOME/.local/jdk/Contents/Home/bin:$PATH" \
    firebase emulators:exec --only firestore --project demo-sleeplab "python3 tests/rules-test.py"

A demo- project exists only inside the emulator, so this never touches the real project. The owner
UID is read from firestore.rules, so the test always checks the rules exactly as written.
Same approach as ProjectsDash's tests/rules-test.py.
"""
import base64
import json
import os
import re
import sys
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HOST = os.environ.get('FIRESTORE_EMULATOR_HOST', '127.0.0.1:8080')
PROJECT = os.environ.get('GCLOUD_PROJECT', 'demo-sleeplab')
DOCS = 'http://%s/v1/projects/%s/databases/(default)/documents' % (HOST, PROJECT)

with open(os.path.join(ROOT, 'firestore.rules'), encoding='utf-8') as f:
    OWNER = re.search(r"request\.auth\.uid == '([^']+)'", f.read()).group(1)
OTHER = 'someone-else'
ADMIN = object()   # the emulator's "Bearer owner" token: bypasses rules, used only to seed data


def b64(obj):
    return base64.urlsafe_b64encode(json.dumps(obj).encode()).rstrip(b'=').decode()


def id_token(uid, provider='password'):
    # Unsigned, built the way @firebase/rules-unit-testing builds it. The emulator doesn't check
    # signatures; production would reject this outright.
    payload = {
        'iss': 'https://securetoken.google.com/' + PROJECT, 'aud': PROJECT,
        'iat': 0, 'exp': 2 ** 31 - 1, 'auth_time': 0,
        'sub': uid, 'user_id': uid,
        'firebase': {'sign_in_provider': provider, 'identities': {}},
    }
    return b64({'alg': 'none', 'type': 'JWT'}) + '.' + b64(payload) + '.'


def call(method, path, who=None):
    body = json.dumps({'fields': {'x': {'stringValue': 'y'}}}).encode() if method == 'PATCH' else None
    req = urllib.request.Request(DOCS + '/' + path, data=body, method=method)
    req.add_header('Content-Type', 'application/json')
    if who is ADMIN:
        req.add_header('Authorization', 'Bearer owner')
    elif who:
        req.add_header('Authorization', 'Bearer ' + id_token(who))
    try:
        with urllib.request.urlopen(req) as res:
            return res.status
    except urllib.error.HTTPError as err:
        return err.code


def u(uid, rest):
    return 'users/%s/%s' % (uid, rest)


# The whitelisted documents, and whether the owner may delete them.
DOCS_OK = [
    ('profile/main', False),
    ('settings/main', False),
    ('nights/2026-10-16', False),
    ('nights/2026-10-16/awakenings/1', True),
    ('dailyFactors/2026-10-16', False),
]
LISTS_OK = ['nights', 'dailyFactors', 'nights/2026-10-16/awakenings']
# Paths outside the whitelist: a write (create) is denied even for the owner.
OUTSIDE = [
    'users/%s' % OWNER,
    u(OWNER, 'profile/other'),
    u(OWNER, 'settings/other'),
    u(OWNER, 'nights/16-10-2026'),
    u(OWNER, 'nights/2026-10-16/awakenings/0'),
    u(OWNER, 'nights/2026-10-16/awakenings/abc'),
    u(OWNER, 'nights/2026-10-16/other/1'),
    u(OWNER, 'dailyFactors/today'),
    u(OWNER, 'experiments/1'),
    'misc/doc',
]

for uid in (OWNER, OTHER):
    for path, _ in DOCS_OK:
        if call('PATCH', u(uid, path), ADMIN) != 200:
            sys.exit('could not seed %s in the emulator' % u(uid, path))
for path in OUTSIDE:
    call('PATCH', path, ADMIN)

OK, DENIED = 200, 403
CASES = []
for path, can_delete in DOCS_OK:
    own, theirs = u(OWNER, path), u(OTHER, path)
    CASES += [
        ('signed out: read %s' % path, 'GET', own, None, DENIED),
        ('signed out: write %s' % path, 'PATCH', own, None, DENIED),
        ('signed out: delete %s' % path, 'DELETE', own, None, DENIED),
        ('other account: read owner %s' % path, 'GET', own, OTHER, DENIED),
        ('other account: write owner %s' % path, 'PATCH', own, OTHER, DENIED),
        ('other account: delete owner %s' % path, 'DELETE', own, OTHER, DENIED),
        ('other account: read its own %s' % path, 'GET', theirs, OTHER, DENIED),
        ('other account: write its own %s' % path, 'PATCH', theirs, OTHER, DENIED),
        ('owner: read another user\'s %s' % path, 'GET', theirs, OWNER, DENIED),
        ('owner: write another user\'s %s' % path, 'PATCH', theirs, OWNER, DENIED),
        ('owner: read %s' % path, 'GET', own, OWNER, OK),
        ('owner: write %s' % path, 'PATCH', own, OWNER, OK),
    ]
for coll in LISTS_OK:
    CASES += [
        ('signed out: list %s' % coll, 'GET', u(OWNER, coll), None, DENIED),
        ('other account: list owner %s' % coll, 'GET', u(OWNER, coll), OTHER, DENIED),
        ('other account: list its own %s' % coll, 'GET', u(OTHER, coll), OTHER, DENIED),
        ('owner: list %s' % coll, 'GET', u(OWNER, coll), OWNER, OK),
    ]
CASES += [
    ('owner: create a new night', 'PATCH', u(OWNER, 'nights/2026-10-17'), OWNER, OK),
    ('owner: create a new awakening', 'PATCH', u(OWNER, 'nights/2026-10-17/awakenings/12'), OWNER, OK),
]
for path in OUTSIDE:
    CASES += [
        ('owner: write outside whitelist %s' % path, 'PATCH', path, OWNER, DENIED),
        ('owner: read outside whitelist %s' % path, 'GET', path, OWNER, DENIED),
    ]
# Deletes last, so the reads above see seeded documents.
for path, can_delete in DOCS_OK:
    CASES.append(('owner: delete %s' % path, 'DELETE', u(OWNER, path), OWNER, OK if can_delete else DENIED))

print('Owner UID from firestore.rules: %s' % OWNER)
failed = 0
for name, method, path, who, expected in CASES:
    got = call(method, path, who)
    ok = got == expected
    failed += not ok
    print('%s  %-60s %-6s -> %d%s' % ('PASS' if ok else 'FAIL', name, method, got,
                                      '' if ok else '  (expected %d)' % expected))
print('\n%d of %d passed' % (len(CASES) - failed, len(CASES)))
sys.exit(1 if failed else 0)
