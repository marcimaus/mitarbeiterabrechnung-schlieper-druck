// Klont die Produktiv-Firestore (NUR LESEND) in den lokalen Firestore-Emulator
// (localhost:8080). Damit kann der Monatswechsel-Flow gefahrlos auf einer
// isolierten Kopie der echten Daten getestet werden.
//
// Voraussetzung: Emulator läuft (firebase emulators:start --only firestore).
// Aufruf: node scripts/clone-prod-to-emulator.mjs
//
// Es wird ausschließlich aus der Produktiv-DB GELESEN und in den EMULATOR
// GESCHRIEBEN — die Produktivdaten bleiben unverändert.

import { initializeApp } from 'firebase/app';
import {
  getFirestore,
  collection,
  getDocs,
  doc,
  writeBatch,
  connectFirestoreEmulator,
} from 'firebase/firestore';
import { config } from 'dotenv';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '.env') });

const cfg = {
  apiKey: process.env.VITE_FIREBASE_API_KEY,
  authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.VITE_FIREBASE_APP_ID,
};

// Quelle = Produktiv (kein Emulator). Ziel = Emulator (localhost:8080).
const prodDb = getFirestore(initializeApp(cfg, 'prod'));
const emuDb = getFirestore(initializeApp({ ...cfg }, 'emu'));
connectFirestoreEmulator(emuDb, 'localhost', 8080);

// Alle Top-Level-Collections der App (Client-SDK kann nicht auflisten —
// daher explizit). Nicht existierende Namen liefern leere Snapshots.
// Optional: nur bestimmte Collections via CLI-Argumente kopieren, z. B.
//   node scripts/clone-prod-to-emulator.mjs meta
const ALL_COLLECTIONS = [
  'meta', // enthält u. a. meta/parameter (PIN-Hashes + Berechnungsparameter)
  'mitarbeiter',
  'touren',
  'teilgebiete',
  'sondervereinbarungen',
  'ausgaben',
  'beilagen',
  'auslieferungsmemos',
  'abrechnungsperioden',
  'einsaetze',
  'zusammentragezeiten',
  'arbeitszeiten',
  'fahrten',
  'vorschuesse',
  'reklamationen',
  'variablePeriodenZusatz',
  'mitarbeiterMemos',
  'mitarbeiterDarlehen',
  'lohnkontoBuchungen',
  'stueckzahlAnpassungen',
  'umgesetzteAnpassungen',
  'lohnbueroAbrechnungen',
  'lohnbueroAnmeldungen',
  'lohnbueroDriveLinks',
  'austraegerwechselPlan',
  'urlaubsplanung',
  'drucksaalPlanung',
  'fahrerPlanung',
  'zusammentragerPlanung',
];

// Wenn CLI-Argumente angegeben sind, nur diese Collections kopieren.
const COLLECTIONS = process.argv.length > 2 ? process.argv.slice(2) : ALL_COLLECTIONS;

const BATCH = 400;
let total = 0;

for (const coll of COLLECTIONS) {
  const snap = await getDocs(collection(prodDb, coll));
  if (snap.empty) {
    console.log(`· ${coll}: 0`);
    continue;
  }
  let batch = writeBatch(emuDb);
  let inBatch = 0;
  let n = 0;
  for (const d of snap.docs) {
    batch.set(doc(emuDb, coll, d.id), d.data());
    inBatch++;
    n++;
    if (inBatch >= BATCH) {
      await batch.commit();
      batch = writeBatch(emuDb);
      inBatch = 0;
    }
  }
  if (inBatch > 0) await batch.commit();
  total += n;
  console.log(`✓ ${coll}: ${n}`);
}

console.log(`\nFertig — ${total} Dokumente in den Emulator kopiert.`);
process.exit(0);
