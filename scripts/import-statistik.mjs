/**
 * Import der historischen Statistik-Werte (Seitenzahl + Beilagensumme) aus den
 * vorbereiteten JSON-Dateien in die Firestore-Collection `statistik`.
 *
 * Quelle der JSONs: Online-Datei (Google Sheet) → CSV exportiert →
 *   scripts/parse-statistik-csv.mjs  → scripts/statistik-seiten.json
 *   (Beilagen analog → scripts/statistik-beilagen.json, sobald verfügbar)
 *
 * Aufruf:
 *   node scripts/import-statistik.mjs
 *
 * Verhalten:
 *   - schreibt pro (typ, jahr) ein Doc `statistik/${typ}_${jahr}` (merge),
 *   - importiert NUR Jahre ≤ 2025 (ab 2026 berechnet die App die Werte),
 *   - KW-Bezeichnungen → `statistikMeta/config`,
 *   - idempotent: erneutes Ausführen überschreibt dieselben Docs.
 *
 * JSON-Format je Datei:
 *   { kwBezeichnungen: { [kw]: string },
 *     jahre: { [jahr]: { [kw]: number } } }
 */

import { initializeApp } from 'firebase/app';
import { getFirestore, doc, setDoc } from 'firebase/firestore';
import { readFileSync, existsSync } from 'node:fs';
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

const MAX_JAHR = 2025; // ab 2026 kommen die Werte aus der App

/** Lädt eine JSON-Quelle, sofern vorhanden. */
function ladeQuelle(dateiname) {
  const p = join(__dirname, dateiname);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, 'utf8'));
}

/** Importiert eine Quelle für einen Typ; liefert Anzahl geschriebener Jahres-Docs. */
async function importiereTyp(typ, quelle) {
  if (!quelle) {
    console.log(`• ${typ}: keine JSON-Datei → übersprungen`);
    return { docs: 0, bezeichnungen: quelle?.kwBezeichnungen ?? {} };
  }
  let docs = 0;
  for (const [jahrStr, zellenRaw] of Object.entries(quelle.jahre ?? {})) {
    const jahr = Number(jahrStr);
    if (!Number.isFinite(jahr) || jahr > MAX_JAHR) continue;
    const zellen = {};
    for (const [kwStr, wert] of Object.entries(zellenRaw)) {
      const kw = Number(kwStr);
      if (!Number.isInteger(kw) || kw < 1 || kw > 53) continue;
      if (wert == null) continue;
      zellen[kw] = { wert: Number(wert) };
    }
    if (Object.keys(zellen).length === 0) continue;
    await setDoc(
      doc(db, 'statistik', `${typ}_${jahr}`),
      { typ, jahr, zellen, aktualisiertAm: Date.now() },
      { merge: true },
    );
    docs++;
  }
  console.log(`• ${typ}: ${docs} Jahres-Dokumente geschrieben (≤ ${MAX_JAHR})`);
  return { docs, bezeichnungen: quelle.kwBezeichnungen ?? {} };
}

async function main() {
  console.log('Import Statistik-Altdaten → Firestore');
  console.log('Projekt:', firebaseConfig.projectId || '(keine .env?)');

  const seitenQuelle = ladeQuelle('statistik-seiten.json');
  const beilagenQuelle = ladeQuelle('statistik-beilagen.json');

  const seiten = await importiereTyp('seiten', seitenQuelle);
  const beilagen = await importiereTyp('beilagen', beilagenQuelle);

  // KW-Bezeichnungen zusammenführen (Seiten-Quelle hat sie; Beilagen ergänzt).
  const kwBezeichnungen = { ...beilagen.bezeichnungen, ...seiten.bezeichnungen };
  if (Object.keys(kwBezeichnungen).length > 0) {
    await setDoc(
      doc(db, 'statistikMeta', 'config'),
      { kwBezeichnungen },
      { merge: true },
    );
    console.log(`• statistikMeta/config: ${Object.keys(kwBezeichnungen).length} KW-Bezeichnungen`);
  }

  console.log('Fertig.');
  process.exit(0);
}

main().catch((e) => {
  console.error('Fehler beim Import:', e);
  process.exit(1);
});
