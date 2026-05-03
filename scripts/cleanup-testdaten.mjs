/**
 * Cleanup-Skript: löscht Test-/Bewegungsdaten vor Live-Start.
 *
 * Stammdaten (mitarbeiter, teilgebiete, touren, sondervereinbarungen,
 * parameter, meta) bleiben unverändert — nur die operativen Daten
 * (Ausgaben, Einsätze, Arbeitszeiten, Abrechnungsperioden, …) werden
 * geleert.
 *
 * Sicherheitshalber nur mit `--confirm` ausführbar:
 *   node scripts/cleanup-testdaten.mjs --confirm
 *
 * Vorher unbedingt ein Backup ziehen:
 *   node scripts/export-firestore.mjs
 */

import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, writeBatch, doc } from 'firebase/firestore';
import { config as dotenvConfig } from 'dotenv';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

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

if (!firebaseConfig.projectId) {
  console.error('❌ VITE_FIREBASE_*-Variablen fehlen. Bitte .env prüfen.');
  process.exit(1);
}

// Genau die Collections, die geleert werden sollen.
// Stammdaten (mitarbeiter, teilgebiete, touren, sondervereinbarungen,
// parameter, meta, reklamationen, auditlog) sind bewusst NICHT enthalten.
const ZU_LEEREN = [
  'ausgaben',
  'beilagen',
  'einsaetze',
  'zusammentragezeiten',
  'arbeitszeiten',
  'auslieferungsmemos',
  'abrechnungsperioden',
  'vorschuesse',
  'variablePeriodenZusatz',
  'lohnkontoBuchungen',
  'fahrten',
];

const istBestaetigt = process.argv.includes('--confirm');

if (!istBestaetigt) {
  console.log('⚠  Trockenlauf — es wird nichts gelöscht.');
  console.log('   Zum echten Löschen: node scripts/cleanup-testdaten.mjs --confirm\n');
}

console.log(`🔌 Verbinde zu Firestore (Projekt: ${firebaseConfig.projectId})…\n`);
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

let gesamtGeloescht = 0;
let gesamtGefunden = 0;

for (const name of ZU_LEEREN) {
  process.stdout.write(`  → ${name.padEnd(28)} `);
  try {
    const snap = await getDocs(collection(db, name));
    const anzahl = snap.size;
    gesamtGefunden += anzahl;

    if (anzahl === 0) {
      console.log('leer');
      continue;
    }

    if (!istBestaetigt) {
      console.log(`würde ${anzahl.toString().padStart(5)} Doc(s) löschen`);
      continue;
    }

    // Echte Löschung in Batches à 500 (Firestore-Limit)
    let geloescht = 0;
    const docs = snap.docs;
    for (let i = 0; i < docs.length; i += 500) {
      const batch = writeBatch(db);
      const chunk = docs.slice(i, i + 500);
      for (const d of chunk) {
        batch.delete(doc(db, name, d.id));
      }
      await batch.commit();
      geloescht += chunk.length;
    }
    gesamtGeloescht += geloescht;
    console.log(`${geloescht.toString().padStart(5)} Doc(s) gelöscht ✓`);
  } catch (err) {
    console.log(`FEHLER: ${err.message}`);
  }
}

console.log('');
if (istBestaetigt) {
  console.log(`✅ Cleanup fertig: ${gesamtGeloescht} von ${gesamtGefunden} Dokumenten gelöscht.`);
  console.log('   Stammdaten (mitarbeiter, teilgebiete, touren, …) sind unverändert.');
} else {
  console.log(`ℹ  Trockenlauf abgeschlossen: ${gesamtGefunden} Dokumente würden gelöscht.`);
  console.log('   Echtes Löschen mit: node scripts/cleanup-testdaten.mjs --confirm');
}
process.exit(0);
