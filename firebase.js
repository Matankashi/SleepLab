/* Firebase: sign-in, and reading and writing the owner's documents under users/{uid}/.

   Paths (the only ones firestore.rules allows):
     profile/main, settings/main
     nights/{night_date}                 one document per night (night_date = the evening it starts)
     nights/{night_date}/awakenings/{n}  optional per-awakening detail, n = 1, 2, ...
     dailyFactors/{night_date}           the evening diary

   Firestore keeps its default memory cache: nothing is persisted to IndexedDB, because every
   github.io site of this account shares one origin and this is health data.

   Writes merge into the document: each form owns its fields and writes every one of them, with
   REMOVE for an answer that was cleared, so a morning save never touches the evening's fields.
   A save's promise resolves only once the server has the write, and the app shows "נשמר" only then.

   tests/serve-test.py --emulator rewrites the two SDK import lines below and the getFirestore line
   to point at the local emulators. If you change those lines, update the rewrites there too. */

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";
import { getFirestore, collection, doc, onSnapshot, getDocs, writeBatch, deleteField } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";
import { firebaseConfig } from './firebase-config.js';

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

export const REMOVE = Symbol('remove');

export const watchAuth = callback => onAuthStateChanged(auth, callback);
export const signIn = (email, password) => signInWithEmailAndPassword(auth, email, password);
export const signOutUser = () => signOut(auth);

const userDoc = (uid, ...path) => doc(db, 'users', uid, ...path);
const userCol = (uid, ...path) => collection(db, 'users', uid, ...path);

// REMOVE -> deleteField(), recursively through plain objects.
function forWrite(value) {
  if (value === REMOVE) return deleteField();
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const out = {};
    for (const [k, v] of Object.entries(value)) if (v !== undefined) out[k] = forWrite(v);
    return out;
  }
  return value;
}

// Follows everything the app shows. Each callback gets plain data; onError gets (what, err).
export function watchUserData(uid, { onProfile, onSettings, onNights, onFactors, onError }) {
  const fail = what => err => onError(what, err);
  const unsubs = [
    onSnapshot(userDoc(uid, 'profile', 'main'), s => onProfile(s.exists() ? s.data() : null), fail('profile')),
    onSnapshot(userDoc(uid, 'settings', 'main'), s => onSettings(s.exists() ? s.data() : null), fail('settings')),
    onSnapshot(userCol(uid, 'nights'), s => onNights(Object.fromEntries(s.docs.map(d => [d.id, d.data()]))), fail('nights')),
    onSnapshot(userCol(uid, 'dailyFactors'), s => onFactors(Object.fromEntries(s.docs.map(d => [d.id, d.data()]))), fail('dailyFactors')),
  ];
  return () => unsubs.forEach(u => u());
}

export async function loadAwakenings(uid, nightDate) {
  const snap = await getDocs(userCol(uid, 'nights', nightDate, 'awakenings'));
  return snap.docs.map(d => ({ n: +d.id, ...d.data() })).sort((a, b) => a.n - b.n);
}

// One batch: the night's fields, and, when `awakenings` is given, the detail list replacing the
// old one (documents 1..k written, k+1..previousCount deleted).
export async function saveNight(uid, nightDate, fields, awakenings, previousCount = 0) {
  const batch = writeBatch(db);
  batch.set(userDoc(uid, 'nights', nightDate), forWrite(fields), { merge: true });
  if (awakenings) {
    awakenings.forEach((a, i) => batch.set(userDoc(uid, 'nights', nightDate, 'awakenings', String(i + 1)), forWrite(a)));
    for (let n = awakenings.length + 1; n <= previousCount; n++) {
      batch.delete(userDoc(uid, 'nights', nightDate, 'awakenings', String(n)));
    }
  }
  await batch.commit();
}

// The evening diary: its own fields in the night document plus the day's factors.
export async function saveEvening(uid, nightDate, nightFields, factors) {
  const batch = writeBatch(db);
  batch.set(userDoc(uid, 'nights', nightDate), forWrite(nightFields), { merge: true });
  batch.set(userDoc(uid, 'dailyFactors', nightDate), forWrite(factors), { merge: true });
  await batch.commit();
}

export async function saveProfile(uid, data) {
  const batch = writeBatch(db);
  batch.set(userDoc(uid, 'profile', 'main'), forWrite(data), { merge: true });
  await batch.commit();
}

export async function saveSettings(uid, data) {
  const batch = writeBatch(db);
  batch.set(userDoc(uid, 'settings', 'main'), forWrite(data), { merge: true });
  await batch.commit();
}
