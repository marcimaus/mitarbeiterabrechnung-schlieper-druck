/**
 * Verschiebt die importierten Arbeitszeiten (Doc-IDs mit Prefix 'import-')
 * von einem MA auf einen anderen, basierend auf einer JSON-Quelldatei.
 *
 * Aufruf: node scripts/reassign-import.mjs <vonSuchName> <nachSuchName> <JSON-Datei>
 */
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, writeBatch, doc, query, where } from 'firebase/firestore';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join, isAbsolute } from 'node:path';
import { config } from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..');
config({ path: join(projectRoot, '.env') });

const [, , vonSuch, nachSuch, jsonArg] = process.argv;
if (!vonSuch || !nachSuch || !jsonArg) {
  console.error('Aufruf: node scripts/reassign-import.mjs <von> <nach> <JSON>');
  process.exit(1);
}
const jsonPath = isAbsolute(jsonArg) ? jsonArg : join(projectRoot, jsonArg);

const app = initializeApp({
  apiKey: process.env.VITE_FIREBASE_API_KEY,
  authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.VITE_FIREBASE_APP_ID,
});
const db = getFirestore(app);

function findOne(snap, name) {
  const hits = snap.docs.filter((d) => (d.data().name ?? '').toLowerCase().includes(name.toLowerCase()));
  if (hits.length !== 1) {
    console.error(`Treffer für "${name}": ${hits.length}`);
    hits.forEach((h) => console.error('  -', h.data().name, h.id));
    process.exit(1);
  }
  return { id: hits[0].id, name: hits[0].data().name };
}

function zeitZuTimestamp(datumISO, zeitHHMM) {
  const [h, m] = zeitHHMM.split(':').map(Number);
  const [yyyy, mm, dd] = datumISO.split('-').map(Number);
  const offsetH = mm >= 4 && mm <= 10 ? 2 : 1;
  return Date.UTC(yyyy, mm - 1, dd, h - offsetH, m, 0, 0);
}
function makeDocId(maId, datum, von, bis) {
  return 'import-' + createHash('sha1').update(`${maId}|${datum}|${von}|${bis}`).digest('hex').substring(0, 12);
}

const mitarbeiterSnap = await getDocs(collection(db, 'mitarbeiter'));
const von = findOne(mitarbeiterSnap, vonSuch);
const nach = findOne(mitarbeiterSnap, nachSuch);
console.log(`Von:  "${von.name}" (${von.id})`);
console.log(`Nach: "${nach.name}" (${nach.id})`);

// 1) Lösche alle import-* Einträge des "von"-MA
const vonSnap = await getDocs(
  query(collection(db, 'arbeitszeiten'), where('mitarbeiterId', '==', von.id))
);
const zuLoeschen = vonSnap.docs.filter((d) => d.id.startsWith('import-'));
console.log(`Lösche ${zuLoeschen.length} import-Einträge von "${von.name}"…`);
let batch = writeBatch(db);
let i = 0;
for (const d of zuLoeschen) {
  batch.delete(d.ref);
  i++;
  if (i % 499 === 0) { await batch.commit(); batch = writeBatch(db); }
}
if (i > 0 && i % 499 !== 0) await batch.commit();
console.log(`  Gelöscht: ${i}`);

// 2) Importiere neu auf "nach"-MA
const eintraege = JSON.parse(readFileSync(jsonPath, 'utf8'));
console.log(`Importiere ${eintraege.length} Einträge auf "${nach.name}"…`);
const bestNach = await getDocs(
  query(collection(db, 'arbeitszeiten'), where('mitarbeiterId', '==', nach.id))
);
const vorhandenIds = new Set(bestNach.docs.map((d) => d.id));

const now = Date.now();
let neu = 0, ueb = 0;
batch = writeBatch(db);
let count = 0;
for (const e of eintraege) {
  const docId = makeDocId(nach.id, e.datum, e.von, e.bis);
  if (vorhandenIds.has(docId)) { ueb++; continue; }
  const az = {
    id: docId,
    mitarbeiterId: nach.id,
    startTime: zeitZuTimestamp(e.datum, e.von),
    endTime: zeitZuTimestamp(e.datum, e.bis),
    status: 'abgeschlossen',
    quelle: 'manuell',
    typ: 'sonstige',
    pausen: [],
    gesamtPauseMinuten: e.pauseMin ?? 0,
    korrekturLog: [],
    erstelltAm: now,
    aktualisiertAm: now,
  };
  batch.set(doc(collection(db, 'arbeitszeiten'), docId), az);
  count++; neu++;
  if (count >= 499) { await batch.commit(); batch = writeBatch(db); count = 0; }
}
if (count > 0) await batch.commit();

console.log(`\nFertig!`);
console.log(`  Neu eingefügt: ${neu}`);
console.log(`  Übersprungen:  ${ueb}`);
process.exit(0);
