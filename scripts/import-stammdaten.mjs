/**
 * Import Stammdaten (Steuer-ID + Telefon/Mobilnummer) aus der ODS-Datei
 * "Stammdatenimpoort.ods" in die Mitarbeiter-Collection.
 *
 * Aufruf:
 *   node scripts/import-stammdaten.mjs <ODS-Datei> [--apply]
 *
 * Ohne --apply läuft das Skript im Dry-Run-Modus (zeigt nur, was es tun würde).
 * Mit --apply werden die Änderungen tatsächlich nach Firestore geschrieben.
 *
 * Spaltenzuordnung (0-basiert):
 *   B (1)  = Mitarbeiter-Nr.    → Identifikation
 *   C (2)  = Nachname           → Sanity-Check
 *   E (4)  = Telefon            → telefon / mobilnummer
 *   T (19) = Steuer-ID          → steuerId
 *
 * Regeln:
 *   - Steuer-ID: nur 11-stellige Zahlen übernehmen; "x", "X", "-" und leere
 *     Felder werden ignoriert.
 *   - Telefon: bei mehreren Nummern (Komma-getrennt) wird jede einzeln
 *     klassifiziert (mobil = beginnt mit 015/016/017; sonst Festnetz).
 *     Beim Schreiben werden in der App vorhandene Werte nie überschrieben.
 *   - Steuer-ID wird ebenfalls nur gesetzt, wenn das Feld leer ist.
 */

import XLSX from 'xlsx';
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, writeBatch, doc } from 'firebase/firestore';
import { fileURLToPath } from 'node:url';
import { dirname, join, isAbsolute } from 'node:path';
import { config as dotenvConfig } from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..');
dotenvConfig({ path: join(projectRoot, '.env') });

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const odsArg = args.find((a) => !a.startsWith('--'));
if (!odsArg) {
  console.error('Aufruf: node scripts/import-stammdaten.mjs <ODS-Datei> [--apply]');
  process.exit(1);
}
const odsPath = isAbsolute(odsArg) ? odsArg : join(projectRoot, odsArg);

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

// --- Spalten-Parser -------------------------------------------------------

function normalisiereSteuerId(roh) {
  if (roh == null) return null;
  const trimmed = String(roh).trim();
  if (!trimmed) return null;
  if (trimmed === '-' || trimmed.toLowerCase() === 'x') return null;
  const nurZiffern = trimmed.replace(/\s+/g, '');
  return /^\d{11}$/.test(nurZiffern) ? nurZiffern : null;
}

function istMobilnummer(num) {
  const ziffern = num.replace(/\D/g, '');
  return /^01[567]\d+/.test(ziffern);
}

/**
 * Liefert { telefon, mobilnummer, warnung } aus dem rohen Zellinhalt.
 * Mehrere Nummern werden über Komma getrennt.
 */
function klassifiziereTelefon(roh) {
  const trimmed = (roh ?? '').toString().trim();
  if (!trimmed) return { telefon: null, mobilnummer: null, warnung: null };
  const teile = trimmed.split(',').map((s) => s.trim()).filter(Boolean);
  let telefon = null;
  let mobilnummer = null;
  const warnungen = [];
  for (const t of teile) {
    if (istMobilnummer(t)) {
      if (mobilnummer == null) mobilnummer = t;
      else warnungen.push(`zweite Mobilnummer ignoriert: "${t}"`);
    } else {
      if (telefon == null) telefon = t;
      else warnungen.push(`zweite Festnetznummer ignoriert: "${t}"`);
    }
  }
  return {
    telefon,
    mobilnummer,
    warnung: warnungen.length ? warnungen.join(' / ') : null,
  };
}

// --- Haupt-Logik ---------------------------------------------------------

async function main() {
  console.log(`ODS-Datei: ${odsPath}`);
  const wb = XLSX.readFile(odsPath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false });
  console.log(`Zeilen in ODS:        ${rows.length - 1} (ohne Kopf)`);

  // Map Nr. → { nachname, telefon, mobilnummer, steuerId, warnung }
  const odsByNr = new Map();
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const nr = String(r[1] ?? '').trim();
    if (!nr) continue;
    const nachname = String(r[2] ?? '').trim();
    const steuerId = normalisiereSteuerId(r[19]);
    const tel = klassifiziereTelefon(r[4]);
    if (steuerId == null && tel.telefon == null && tel.mobilnummer == null) continue;
    odsByNr.set(nr, {
      nachname,
      steuerId,
      telefon: tel.telefon,
      mobilnummer: tel.mobilnummer,
      telWarnung: tel.warnung,
    });
  }
  console.log(`Zeilen mit Daten:     ${odsByNr.size}`);

  console.log('\nLade Mitarbeiter aus Firestore…');
  const mitarbeiterSnap = await getDocs(collection(db, 'mitarbeiter'));
  const maByNr = new Map();
  for (const d of mitarbeiterSnap.docs) {
    const data = d.data();
    if (data.nummer) maByNr.set(String(data.nummer), { id: d.id, ...data });
  }
  console.log(`Mitarbeiter geladen:  ${maByNr.size}`);

  let updateSteuerId = 0;
  let updateTelefon = 0;
  let updateMobil = 0;
  let skipNamensMismatch = 0;
  let skipKeineMatch = 0;
  let skipBereitsGesetzt = 0;
  const updates = []; // { id, name, nummer, change }
  const fehlend = [];
  const warnungen = [];

  for (const [nr, ods] of odsByNr) {
    const ma = maByNr.get(nr);
    if (!ma) {
      skipKeineMatch++;
      fehlend.push(`${nr} ${ods.nachname}`);
      continue;
    }
    // Sanity-Check Nachname (case-insensitive, Teilstring genügt)
    if (ods.nachname && ma.name) {
      const maLower = ma.name.toLowerCase();
      const odsLower = ods.nachname.toLowerCase();
      if (!maLower.includes(odsLower) && !odsLower.includes(maLower.split(/[\s,]/)[0])) {
        warnungen.push(`Nr ${nr}: ODS-Nachname "${ods.nachname}" ≠ App-Name "${ma.name}" — wird übersprungen`);
        skipNamensMismatch++;
        continue;
      }
    }
    if (ods.telWarnung) {
      warnungen.push(`Nr ${nr} (${ma.name}): ${ods.telWarnung}`);
    }

    const change = {};
    if (ods.steuerId && !(ma.steuerId && ma.steuerId.trim())) {
      change.steuerId = ods.steuerId;
      updateSteuerId++;
    }
    if (ods.telefon && !(ma.telefon && ma.telefon.trim())) {
      change.telefon = ods.telefon;
      updateTelefon++;
    }
    if (ods.mobilnummer && !(ma.mobilnummer && ma.mobilnummer.trim())) {
      change.mobilnummer = ods.mobilnummer;
      updateMobil++;
    }
    if (Object.keys(change).length === 0) {
      skipBereitsGesetzt++;
      continue;
    }
    updates.push({ id: ma.id, nummer: nr, name: ma.name, change });
  }

  console.log('\n--- Geplante Updates ---');
  console.log(`Steuer-ID neu gesetzt:       ${updateSteuerId}`);
  console.log(`Telefon neu gesetzt:         ${updateTelefon}`);
  console.log(`Mobilnummer neu gesetzt:     ${updateMobil}`);
  console.log(`MAs unverändert:             ${skipBereitsGesetzt}`);
  console.log(`Übersprungen (Namens-Konf.): ${skipNamensMismatch}`);
  console.log(`Nicht gefunden:              ${skipKeineMatch}`);
  console.log(`MAs mit Änderungen:          ${updates.length}`);

  if (warnungen.length) {
    console.log('\n--- Warnungen ---');
    warnungen.slice(0, 50).forEach((w) => console.log('  ' + w));
    if (warnungen.length > 50) console.log(`  … (${warnungen.length - 50} weitere)`);
  }

  if (fehlend.length) {
    console.log('\n--- Nicht in App gefunden (erste 50) ---');
    fehlend.slice(0, 50).forEach((f) => console.log('  ' + f));
    if (fehlend.length > 50) console.log(`  … (${fehlend.length - 50} weitere)`);
  }

  console.log('\n--- Beispiel-Updates (erste 20) ---');
  updates.slice(0, 20).forEach((u) => {
    console.log(`  ${u.nummer} ${u.name}: ${JSON.stringify(u.change)}`);
  });

  if (!apply) {
    console.log('\nDry-Run (kein --apply): es wurde NICHTS geschrieben.');
    console.log('Zum tatsächlichen Schreiben: erneut mit  --apply  ausführen.');
    process.exit(0);
  }

  console.log('\nSchreibe Änderungen nach Firestore…');
  const now = Date.now();
  let batch = writeBatch(db);
  let batchCount = 0;
  let geschrieben = 0;
  for (const u of updates) {
    const ref = doc(collection(db, 'mitarbeiter'), u.id);
    batch.set(ref, { ...u.change, aktualisiertAm: now }, { merge: true });
    batchCount++;
    geschrieben++;
    if (batchCount >= 400) {
      await batch.commit();
      console.log(`  Batch committed (${geschrieben} bisher)`);
      batch = writeBatch(db);
      batchCount = 0;
    }
  }
  if (batchCount > 0) await batch.commit();

  console.log(`\nFertig — ${geschrieben} Mitarbeiter aktualisiert.`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
