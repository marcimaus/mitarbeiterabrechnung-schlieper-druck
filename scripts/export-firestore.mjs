/**
 * Firestore-Export: sichert alle relevanten Collections als JSON-Dateien.
 *
 * Schreibt in einen Ordner `backups/firestore-YYYY-MM-DD-HHmm/` (eine .json-Datei
 * je Collection). Verwendet die Web-Firebase-Konfiguration aus der `.env` —
 * wenn dort die Firestore-Rules öffentliches Lesen erlauben oder der Admin
 * angemeldet ist, geht das ohne Service-Account.
 *
 * Aufruf:
 *   node scripts/export-firestore.mjs
 *
 * Voraussetzungen:
 *   - `.env` mit den VITE_FIREBASE_*-Variablen vorhanden (gleicher Stand wie die App).
 *   - `npm install` wurde ausgeführt (firebase-Paket vorhanden).
 *
 * Empfehlung: einmal pro Woche manuell laufen lassen oder via Windows-
 * Aufgabenplanung automatisieren. Ergänzt — nicht ersetzt — die Managed
 * Backups in der Firebase-Konsole.
 */

import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs } from 'firebase/firestore';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as dotenvConfig } from 'dotenv';

// .env aus dem Projekt-Root laden
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

// Alle zu sichernden Collections (siehe types.ts / db.ts)
const COLLECTIONS = [
  'mitarbeiter',
  'teilgebiete',
  'touren',
  'ausgaben',
  'beilagen',
  'einsaetze',
  'arbeitszeiten',
  'zusammentragezeiten',
  'fahrten',
  'vorschuesse',
  'lohnkontoBuchungen',
  'variablePeriodenZusatz',
  'abrechnungsperioden',
  'parameter',
  'meta',          // enthält das Parameter-Singleton meta/parameter
  'auditlog',
  'auslieferungsmemos',
  'sondervereinbarungen',
  'reklamationen',
];

function timestampSlug() {
  const d = new Date();
  const pad = (n) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

async function main() {
  console.log(`🔌 Verbinde zu Firestore (Projekt: ${firebaseConfig.projectId})…`);
  const app = initializeApp(firebaseConfig);
  const db = getFirestore(app);

  const ts = timestampSlug();
  const outDir = join(projectRoot, 'backups', `firestore-${ts}`);
  if (!existsSync(outDir)) {
    mkdirSync(outDir, { recursive: true });
  }

  const summary = [];
  for (const name of COLLECTIONS) {
    process.stdout.write(`  → ${name.padEnd(28)} `);
    try {
      const snap = await getDocs(collection(db, name));
      const docs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      const file = join(outDir, `${name}.json`);
      writeFileSync(file, JSON.stringify(docs, null, 2), 'utf8');
      console.log(`${docs.length.toString().padStart(5)} Doc(s) → ${file}`);
      summary.push({ collection: name, count: docs.length });
    } catch (err) {
      console.log(`FEHLER: ${err.message}`);
      summary.push({ collection: name, error: err.message });
    }
  }

  // Übersichts-Datei mit Metadaten
  writeFileSync(
    join(outDir, '_summary.json'),
    JSON.stringify(
      {
        projectId: firebaseConfig.projectId,
        erstelltAm: new Date().toISOString(),
        collections: summary,
      },
      null,
      2
    ),
    'utf8'
  );

  const gesamt = summary.reduce((s, x) => s + (x.count ?? 0), 0);
  console.log(`\n✅ Backup fertig: ${gesamt} Dokumente in ${outDir}`);
  process.exit(0);
}

main().catch((err) => {
  console.error('❌ Backup fehlgeschlagen:', err);
  process.exit(1);
});
