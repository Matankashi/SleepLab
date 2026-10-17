#!/usr/bin/env python3
"""Local test server, emulator only. It never touches the real Firebase project.

From the repo root, start the emulators first (Java: ~/.local/jdk):
  JAVA_HOME=~/.local/jdk/Contents/Home PATH="$HOME/.local/jdk/Contents/Home/bin:$PATH" \
    firebase emulators:start --only auth,firestore --project demo-sleeplab
then:
  python3 tests/serve-test.py [--seed] [port]        default port 8020, open http://localhost:8020

- Serves a demo firebase-config.js and rewrites firebase.js as it's served so it talks to the local
  Auth and Firestore emulators. Files on disk are never modified.
- Sends Cache-Control: no-store, so Chrome never runs a stale module after an edit.
- Adds a red TEST bar to the page.
- Creates the login test@example.com / test-password in the Auth emulator, with the UID that
  firestore.rules allows, so the real rules apply unchanged.
- --seed writes made-up nights (tests/seed_fake.py) for the last 21 days into the emulator.
  Never real data.
- Listens on 127.0.0.1 only.
"""
import http.server
import json
import os
import re
import sys
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
DEMO_PROJECT = 'demo-sleeplab'
TEST_EMAIL, TEST_PASSWORD = 'test@example.com', 'test-password'
ports = [a for a in sys.argv[1:] if not a.startswith('--')]
PORT = int(ports[0]) if ports else 8020

REWRITES = {
    '/firebase.js': [
        ('import { getAuth, ', 'import { getAuth, connectAuthEmulator, '),
        ('import { getFirestore, ', 'import { getFirestore, connectFirestoreEmulator, '),
        ('const db = getFirestore(app);',
         "const db = getFirestore(app);\n"
         "connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });\n"
         "connectFirestoreEmulator(db, '127.0.0.1', 8080);"),
    ],
    '/index.html': [
        ('<body>', '<body>\n<div style="position:sticky;top:0;z-index:9;background:#B8352C;color:#fff;'
                   'text-align:center;font:700 13px/1.8 Arial,sans-serif">TEST (emulator, made-up data)</div>'),
    ],
}
DEMO_CONFIG = ('export const firebaseConfig = { apiKey: "demo-key", authDomain: "%s.firebaseapp.com", '
               'projectId: "%s", appId: "demo-app" };\n' % (DEMO_PROJECT, DEMO_PROJECT))


def owner_uid():
    with open(os.path.join(ROOT, 'firestore.rules'), encoding='utf-8') as f:
        return re.search(r"request\.auth\.uid == '([^']+)'", f.read()).group(1)


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, max-age=0')
        super().end_headers()

    def do_GET(self):
        path = self.path.split('?')[0]
        if path == '/':
            path = '/index.html'
        if path.startswith('/private/') or path.startswith('/.git'):
            return self.send_error(404)
        if path == '/firebase-config.js':
            return self.send_text(DEMO_CONFIG, 'text/javascript')
        if path in REWRITES:
            with open(os.path.join(ROOT, path.lstrip('/')), encoding='utf-8') as f:
                src = f.read()
            for old, new in REWRITES[path]:
                if old not in src:
                    return self.send_error(500, 'serve-test.py: %s no longer contains %r' % (path, old))
                src = src.replace(old, new, 1)
            return self.send_text(src, 'text/html' if path.endswith('.html') else 'text/javascript')
        super().do_GET()

    def send_text(self, text, ctype):
        body = text.encode('utf-8')
        self.send_response(200)
        self.send_header('Content-Type', ctype + '; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *a):
        pass


def ensure_test_user(uid):
    req = urllib.request.Request(
        'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/projects/%s/accounts' % DEMO_PROJECT,
        data=json.dumps({'localId': uid, 'email': TEST_EMAIL, 'password': TEST_PASSWORD}).encode(),
        method='POST', headers={'Content-Type': 'application/json', 'Authorization': 'Bearer owner'})
    try:
        urllib.request.urlopen(req).read()
        print('Test login created: %s / %s (uid %s)' % (TEST_EMAIL, TEST_PASSWORD, uid))
    except urllib.error.HTTPError as err:
        msg = err.read().decode(errors='replace')
        if 'DUPLICATE' in msg or 'EXISTS' in msg:
            print('Test login already exists: %s / %s (uid %s)' % (TEST_EMAIL, TEST_PASSWORD, uid))
        else:
            print('Could not create the test login (HTTP %d): %s' % (err.code, msg))
    except urllib.error.URLError as err:
        sys.exit('The Auth emulator is not reachable (%s). Start the emulators first (see the top of this file).' % err.reason)


if __name__ == '__main__':
    uid = owner_uid()
    ensure_test_user(uid)
    if '--seed' in sys.argv:
        import seed_fake
        print('Seeded %d made-up nights.' % seed_fake.seed(DEMO_PROJECT, uid))
    http.server.ThreadingHTTPServer.allow_reuse_address = True
    with http.server.ThreadingHTTPServer(('127.0.0.1', PORT), Handler) as srv:
        print('Serving %s at http://localhost:%d (emulator mode)' % (ROOT, PORT))
        srv.serve_forever()
