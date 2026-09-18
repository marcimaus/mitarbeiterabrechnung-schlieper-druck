// One-Off: Indiziert Lohnbüro-PDF-Abrechnungen nach Firestore.
// Eingabe: lokales JSON-File `lohnbuero-index.json` mit der Form
//   {
//     abrechnungen: LohnbueroAbrechnung[],   // ohne id
//     anmeldungen: LohnbueroAnmeldung[],     // ohne id
//   }
// Doc-ID ist deterministisch: `${fileId}_${seite}` (Abrechnungen) bzw.
// `${fileId}_${seite}_${typ}` (Anmeldungen) → idempotent.
// MA-Matching: Token-Set über `nameRoh` gegen Firestore-Mitarbeiter.
//
// Usage:
//   node index-lohnbuero-pdfs.mjs           # Dry-Run
//   node index-lohnbuero-pdfs.mjs write     # Schreiben

import { initializeApp } from 'firebase/app';
import {
  getFirestore, collection, getDocs, setDoc, doc, getDoc,
} from 'firebase/firestore';
import { readFileSync } from 'node:fs';

const INDIZIER_VERSION = 1;

const env = Object.fromEntries(
  readFileSync('.env', 'utf8').split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1)]; })
);
const app = initializeApp({
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.VITE_FIREBASE_APP_ID,
});
const db = getFirestore(app);

const write = process.argv[2] === 'write';

// ---- Helpers ------------------------------------------------

function tokenize(s) {
  return s.toLowerCase()
    .replace(/[^\p{L}\s-]/gu, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1)
    .sort();
}
function tokenKey(s) { return tokenize(s).join(' '); }

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[m][n];
}

function findMa(nameRoh, mitarbeiter, byTokenKey) {
  const key = tokenKey(nameRoh);
  if (!key) return null;
  // Exakte Token-Set-Übereinstimmung
  const exact = byTokenKey.get(key);
  if (exact && exact.length === 1) return exact[0].id;
  // Fuzzy: Levenshtein auf Token-Set-Strings
  let best = null;
  for (const m of mitarbeiter) {
    const k = tokenKey(m.name);
    if (!k) continue;
    const d = levenshtein(key, k);
    const maxLen = Math.max(key.length, k.length);
    const ratio = 1 - d / maxLen;
    if (!best || ratio > best.ratio) best = { ma: m, ratio };
  }
  if (best && best.ratio >= 0.8) return best.ma.id;
  return null;
}

// ---- Daten laden --------------------------------------------

const data = JSON.parse(readFileSync('lohnbuero-index.json', 'utf8'));
console.log(`Eingangsdaten: ${data.abrechnungen?.length ?? 0} Abrechnungen, ${data.anmeldungen?.length ?? 0} Anmeldungen.`);

console.log('Lade Mitarbeiter aus Firestore...');
const maSnap = await getDocs(collection(db, 'mitarbeiter'));
const mitarbeiter = maSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
const byTokenKey = new Map();
for (const m of mitarbeiter) {
  const k = tokenKey(m.name);
  if (!byTokenKey.has(k)) byTokenKey.set(k, []);
  byTokenKey.get(k).push(m);
}
console.log(`Mitarbeiter geladen: ${mitarbeiter.length}.`);

// ---- Matching + Vorbereitung --------------------------------

const indiziertAm = Date.now();
let matchAbr = 0, noMatchAbr = 0;
const abrechnungen = (data.abrechnungen ?? []).map((a) => {
  const maId = findMa(a.nameRoh, mitarbeiter, byTokenKey);
  if (maId) matchAbr++; else noMatchAbr++;
  return {
    ...a,
    mitarbeiterId: maId,
    indiziertAm,
    indizierVersion: INDIZIER_VERSION,
  };
});

let matchAnm = 0, noMatchAnm = 0;
const anmeldungen = (data.anmeldungen ?? []).map((a) => {
  const maId = findMa(a.nameRoh, mitarbeiter, byTokenKey);
  if (maId) matchAnm++; else noMatchAnm++;
  return {
    ...a,
    mitarbeiterId: maId,
    indiziertAm,
    indizierVersion: INDIZIER_VERSION,
  };
});

console.log(`Match-Ergebnis:`);
console.log(`  Abrechnungen: ${matchAbr} gematcht, ${noMatchAbr} ohne Match`);
console.log(`  Anmeldungen:  ${matchAnm} gematcht, ${noMatchAnm} ohne Match`);

if (noMatchAbr > 0) {
  console.log('  No-Match-Namen (Abrechnungen, max 20):');
  abrechnungen.filter((a) => !a.mitarbeiterId).slice(0, 20).forEach((a) =>
    console.log(`    - ${a.nameRoh}  (Seite ${a.seite}, ${a.fileName})`));
}

if (!write) {
  console.log('\nDry-Run. Zum Schreiben:  node index-lohnbuero-pdfs.mjs write');
  process.exit(0);
}

// ---- Schreiben ----------------------------------------------

function stripUndef(o) {
  const out = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined) out[k] = v;
  return out;
}

// WICHTIG: Wenn ein Datensatz bereits in Firestore existiert und eine
// `mitarbeiterId` gesetzt ist, NICHT überschreiben. Sie wurde
// vermutlich manuell in der UI (Zuordnen-Modal, Legacy-Anlage etc.)
// vergeben — würde der Script den frischen Token-Set-Match darüber
// schreiben, gingen die manuellen Zuordnungen verloren.
async function preserveExistingMitarbeiterId(coll, id, neuerEintrag) {
  if (neuerEintrag.mitarbeiterId) return neuerEintrag;
  const existing = await getDoc(doc(db, coll, id));
  if (existing.exists()) {
    const e = existing.data();
    if (e.mitarbeiterId) {
      return { ...neuerEintrag, mitarbeiterId: e.mitarbeiterId };
    }
  }
  return neuerEintrag;
}

console.log(`\nSchreibe ${abrechnungen.length} Abrechnungen + ${anmeldungen.length} Anmeldungen...`);
let i = 0;
for (const a of abrechnungen) {
  const id = `${a.fileId}_${a.seite}`;
  const merged = await preserveExistingMitarbeiterId('lohnbueroAbrechnungen', id, a);
  await setDoc(doc(db, 'lohnbueroAbrechnungen', id), stripUndef(merged));
  if (++i % 25 === 0) console.log(`  ${i}/${abrechnungen.length} Abrechnungen…`);
}
console.log(`  ✓ ${i} Abrechnungen geschrieben.`);

let j = 0;
for (const a of anmeldungen) {
  const id = `${a.fileId}_${a.seite}_${a.typ}`;
  const merged = await preserveExistingMitarbeiterId('lohnbueroAnmeldungen', id, a);
  await setDoc(doc(db, 'lohnbueroAnmeldungen', id), stripUndef(merged));
  j++;
}
console.log(`  ✓ ${j} Anmeldungen geschrieben.`);

// ---- Drive-Links automatisch hinterlegen --------------------
// Wenn das Manifest einen `driveLinks`-Block enthält (Liste von
// { jahr, monat, url }), werden diese Monats-Links in die Collection
// `lohnbueroDriveLinks` geschrieben (Doc-ID `${jahr}-${monat}`).
// So ist der Drive-Ordner des importierten Monats direkt in der App
// verlinkt. Idempotent — bestehende Einträge werden überschrieben.
//
// Alternativ/zusätzlich kann das Manifest die Monats-Ordner-Links auch
// aus den Abrechnungs-Einträgen ableiten lassen: ist `driveLinks` leer,
// aber jede Abrechnung trägt `monatsordnerUrl`, wird daraus dedupliziert.
const driveLinks = data.driveLinks ?? [];
if (driveLinks.length === 0) {
  // Fallback: aus Abrechnungen ableiten, falls `monatsordnerUrl` gesetzt.
  const seen = new Set();
  for (const a of data.abrechnungen ?? []) {
    if (!a.monatsordnerUrl || a.jahr == null || a.monat == null) continue;
    const key = `${a.jahr}-${a.monat}`;
    if (seen.has(key)) continue;
    seen.add(key);
    driveLinks.push({ jahr: a.jahr, monat: a.monat, url: a.monatsordnerUrl });
  }
}
if (driveLinks.length > 0) {
  console.log(`\nSchreibe ${driveLinks.length} Drive-Link(s)...`);
  let k = 0;
  for (const dl of driveLinks) {
    if (dl.jahr == null || !dl.url) continue;
    const monat = dl.monat ?? null;
    const id = monat == null ? `${dl.jahr}` : `${dl.jahr}-${monat}`;
    await setDoc(doc(db, 'lohnbueroDriveLinks', id), {
      jahr: dl.jahr,
      monat,
      url: dl.url,
      aktualisiertAm: indiziertAm,
      aktualisiertVon: '— PDF-Import (Skript) —',
    });
    k++;
  }
  console.log(`  ✓ ${k} Drive-Links geschrieben.`);
}

console.log('\nFertig.');
process.exit(0);
