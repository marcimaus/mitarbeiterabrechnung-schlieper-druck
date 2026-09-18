/**
 * Import: Arbeitszeiten Jörg Gottlewski (2020–heute)
 *
 * Quelle: scripts/gottlewski-arbeitszeiten.json
 * (aus Google Sheet https://docs.google.com/spreadsheets/d/1yC3csP9yjzpr8E214ynzpYj3xJxBUdcjDLsrp4tWuDE)
 *
 * Ausführen: node scripts/import-gottlewski-arbeitszeiten.mjs
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
import { dirname, join } from 'node:path';
import { config as dotenvConfig } from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..');
dotenvConfig({ path: join(projectRoot, '.env') });

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

// ── Hilfsfunktionen ──────────────────────────────────────────────────────────

/** "HH:MM" + ISO-Datum → Unix-Timestamp ms (Europe/Berlin) */
function zeitZuTimestamp(datumISO, zeitHHMM) {
  const [h, m] = zeitHHMM.split(':').map(Number);
  const [yyyy, mm, dd] = datumISO.split('-').map(Number);
  // Einfache Näherung: UTC-Offset für Deutschland (CET=+1, CEST=+2)
  // Wir rechnen als UTC und korrigieren um -1h (CET) bzw. -2h (CEST).
  // Sommer: Monate 4–10 (April bis Oktober) → CEST = UTC+2
  const isSommer = mm >= 4 && mm <= 10;
  const offsetH = isSommer ? 2 : 1;
  const utcMs = Date.UTC(yyyy, mm - 1, dd, h - offsetH, m, 0, 0);
  return utcMs;
}

/** Deterministischer Doc-Name, damit wiederholtes Ausführen idempotent bleibt */
function makeDocId(mitarbeiterId, datumISO, von, bis) {
  const key = `${mitarbeiterId}|${datumISO}|${von}|${bis}`;
  return 'import-' + createHash('sha1').update(key).digest('hex').substring(0, 12);
}

// ── Hauptlogik ───────────────────────────────────────────────────────────────

async function main() {
  // 1. Jörg Gottlewski in Firestore suchen
  console.log('Suche Jörg Gottlewski in Firestore…');
  const mitarbeiterSnap = await getDocs(collection(db, 'mitarbeiter'));
  let gottlewskiId = null;
  let gottlewskiName = null;

  for (const d of mitarbeiterSnap.docs) {
    const data = d.data();
    if (data.name && data.name.toLowerCase().includes('gottlewski')) {
      gottlewskiId = d.id;
      gottlewskiName = data.name;
      break;
    }
  }

  if (!gottlewskiId) {
    console.error('Jörg Gottlewski nicht in Firestore gefunden!');
    console.log('Vorhandene Mitarbeiter:');
    for (const d of mitarbeiterSnap.docs) {
      console.log(' -', d.data().name);
    }
    process.exit(1);
  }

  console.log(`Gefunden: "${gottlewskiName}" (ID: ${gottlewskiId})`);

  // 2. JSON-Daten laden
  const jsonPath = join(__dirname, 'gottlewski-arbeitszeiten.json');
  const eintraege = JSON.parse(readFileSync(jsonPath, 'utf8'));
  console.log(`Einträge aus JSON: ${eintraege.length}`);

  // 3. Prüfe, ob Einträge bereits vorhanden
  const bestehendSnap = await getDocs(
    query(collection(db, 'arbeitszeiten'), where('mitarbeiterId', '==', gottlewskiId))
  );
  const bestehendIds = new Set(bestehendSnap.docs.map((d) => d.id));
  console.log(`Bereits in Firestore: ${bestehendIds.size} Einträge für diesen MA`);

  // 4. Neue Einträge schreiben (Batch, max 500 pro Batch)
  const now = Date.now();
  let neu = 0;
  let uebersprungen = 0;
  let batch = writeBatch(db);
  let batchCount = 0;

  for (const e of eintraege) {
    const docId = makeDocId(gottlewskiId, e.datum, e.von, e.bis);

    if (bestehendIds.has(docId)) {
      uebersprungen++;
      continue;
    }

    const startTime = zeitZuTimestamp(e.datum, e.von);
    const endTime = zeitZuTimestamp(e.datum, e.bis);

    const arbeitszeit = {
      id: docId,
      mitarbeiterId: gottlewskiId,
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

    // Batch-Grenze: 499 Operationen
    if (batchCount >= 499) {
      await batch.commit();
      console.log(`  Batch committed (${neu} bisher)`);
      batch = writeBatch(db);
      batchCount = 0;
    }
  }

  if (batchCount > 0) {
    await batch.commit();
  }

  console.log(`\nFertig!`);
  console.log(`  Neu eingefügt:    ${neu}`);
  console.log(`  Übersprungen:     ${uebersprungen} (bereits vorhanden)`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
