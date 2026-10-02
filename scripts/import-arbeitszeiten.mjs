/**
 * Generischer Import von Arbeitszeiten aus einer JSON-Datei.
 *
 * Aufruf:
 *   node scripts/import-arbeitszeiten.mjs <Suchname> <JSON-Datei>
 *
 * Beispiele:
 *   node scripts/import-arbeitszeiten.mjs gottlewski scripts/gottlewski-arbeitszeiten.json
 *   node scripts/import-arbeitszeiten.mjs kreike     scripts/kreike-arbeitszeiten.json
 *
 * JSON-Format: Array von { datum, von, bis, pauseMin } — siehe Parse-Skripte.
 *
 * Idempotent: Doc-ID = sha1(maId|datum|von|bis), wiederholtes Ausführen
 * überspringt bereits importierte Einträge.
 */

import { initializeApp } from 'firebase/app';
import {
  getFirestore,
  collection,
  getDocs,
  writeBatch,
  doc,
  query,
  where,
} from 'firebase/firestore';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join, isAbsolute } from 'node:path';
import { config as dotenvConfig } from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..');
dotenvConfig({ path: join(projectRoot, '.env') });

const [, , suchName, jsonArg] = process.argv;
if (!suchName || !jsonArg) {
  console.error('Aufruf: node scripts/import-arbeitszeiten.mjs <Suchname> <JSON-Datei>');
  process.exit(1);
}
const jsonPath = isAbsolute(jsonArg) ? jsonArg : join(projectRoot, jsonArg);

const firebaseConfig = {
  apiKey: process.env.VITE_FIREBASE_API_KEY,
  authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.VITE_FIREBASE_APP_ID,
};
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

function zeitZuTimestamp(datumISO, zeitHHMM) {
  const [h, m] = zeitHHMM.split(':').map(Number);
  const [yyyy, mm, dd] = datumISO.split('-').map(Number);
  const isSommer = mm >= 4 && mm <= 10;
  const offsetH = isSommer ? 2 : 1;
  return Date.UTC(yyyy, mm - 1, dd, h - offsetH, m, 0, 0);
}

function makeDocId(maId, datum, von, bis) {
  return 'import-' + createHash('sha1').update(`${maId}|${datum}|${von}|${bis}`).digest('hex').substring(0, 12);
}

async function main() {
  console.log(`Suche Mitarbeiter mit Name enthält "${suchName}"…`);
  const mitarbeiterSnap = await getDocs(collection(db, 'mitarbeiter'));
  const treffer = mitarbeiterSnap.docs.filter((d) =>
    (d.data().name ?? '').toLowerCase().includes(suchName.toLowerCase())
  );

  if (treffer.length === 0) {
    console.error(`Kein Treffer für "${suchName}".`);
    process.exit(1);
  }
  if (treffer.length > 1) {
    console.error(`Mehrere Treffer für "${suchName}":`);
    treffer.forEach((t) => console.error(`  - ${t.data().name} (${t.id})`));
    console.error('Bitte spezifischer suchen.');
    process.exit(1);
  }

  const maId = treffer[0].id;
  const maName = treffer[0].data().name;
  console.log(`Gefunden: "${maName}" (ID: ${maId})`);

  const eintraege = JSON.parse(readFileSync(jsonPath, 'utf8'));
  console.log(`Einträge aus JSON: ${eintraege.length}`);

  const bestehendSnap = await getDocs(
    query(collection(db, 'arbeitszeiten'), where('mitarbeiterId', '==', maId))
  );
  const bestehendIds = new Set(bestehendSnap.docs.map((d) => d.id));
  console.log(`Bereits in Firestore: ${bestehendIds.size} Einträge für diesen MA`);

  const now = Date.now();
  let neu = 0;
  let uebersprungen = 0;
  let batch = writeBatch(db);
  let batchCount = 0;

  for (const e of eintraege) {
    const docId = makeDocId(maId, e.datum, e.von, e.bis);
    if (bestehendIds.has(docId)) {
      uebersprungen++;
      continue;
    }
    const startTime = zeitZuTimestamp(e.datum, e.von);
    const endTime = zeitZuTimestamp(e.datum, e.bis);
    const arbeitszeit = {
      id: docId,
      mitarbeiterId: maId,
      startTime,
      endTime,
      status: 'abgeschlossen',
      quelle: 'manuell',
      typ: 'sonstige',
      pausen: [],
      gesamtPauseMinuten: e.pauseMin ?? 0,
      korrekturLog: [],
      erstelltAm: now,
      aktualisiertAm: now,
    };
    const ref = doc(collection(db, 'arbeitszeiten'), docId);
    batch.set(ref, arbeitszeit);
    batchCount++;
    neu++;
    if (batchCount >= 499) {
      await batch.commit();
      console.log(`  Batch committed (${neu} bisher)`);
      batch = writeBatch(db);
      batchCount = 0;
    }
  }
  if (batchCount > 0) await batch.commit();

  console.log(`\nFertig!`);
  console.log(`  Neu eingefügt:    ${neu}`);
  console.log(`  Übersprungen:     ${uebersprungen}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
