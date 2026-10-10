// Importiert die in einer externen Anwendung ermittelten Abrechnungsbeträge
// der Aushilfen (Austragen + Zusammentragen + Vorarbeit) aus einem Excel-Blatt
// nach Firestore (Collection `externeAbrechnungswerte`).
//
// Zuordnung erfolgt über die 5-stellige Mitarbeiter-Nummer. Je Zeile werden
// eine 5-stellige Nummer und ein Betrag (EUR) erwartet; Namen werden zur
// Anzeige mitgelesen, aber nicht zum Matching benutzt.
//
// Aufruf:
//   node import-externe-abrechnungswerte.mjs <pfad.xlsx> <periode>           # Dry-Run
//   node import-externe-abrechnungswerte.mjs <pfad.xlsx> <periode> write     # schreiben
//
// <periode> = "JAHR-MONAT" (z. B. 2025-08) ODER Teil der Perioden-Bezeichnung
//             (z. B. "August 2025"). Muss genau eine Periode treffen.
//
// Doc-ID ist deterministisch `${periodeId}_${mitarbeiterId}` → idempotenter
// Re-Import (überschreibt den vorhandenen Wert sauber). Ein Betrag <= 0 löscht
// den Eintrag (damit greift wieder die App-Berechnung).

import { initializeApp } from 'firebase/app';
import {
  getFirestore, collection, getDocs, setDoc, deleteDoc, doc, getDoc,
} from 'firebase/firestore';
import { readFileSync } from 'node:fs';
import xlsx from 'xlsx';

// ---- Args ---------------------------------------------------

const args = process.argv.slice(2);
const write = args.includes('write');
const positional = args.filter((a) => a !== 'write' && !a.startsWith('--'));
const pfad = positional[0];
const periodeArg = positional[1];

if (!pfad || !periodeArg) {
  console.error('Aufruf: node import-externe-abrechnungswerte.mjs <pfad.xlsx> <periode> [write]');
  console.error('  <periode> = "JAHR-MONAT" (z. B. 2025-08) oder Teil der Bezeichnung ("August 2025")');
  process.exit(1);
}

// ---- Firebase -----------------------------------------------

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

// ---- Helpers ------------------------------------------------

/** Robustes Parsen eines EUR-Betrags: „1.234,56", „1234,56", „1234.56", „1234". */
function parseEuro(v) {
  if (v == null) return undefined;
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  let s = String(v).trim().replace(/[^\d.,-]/g, '');
  if (s === '') return undefined;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : undefined;
}

// ---- Periode ermitteln --------------------------------------

const periodenSnap = await getDocs(collection(db, 'abrechnungsperioden'));
const perioden = periodenSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

let periode;
const mJahrMonat = /^(\d{4})-(\d{1,2})$/.exec(periodeArg.trim());
if (mJahrMonat) {
  const jahr = Number(mJahrMonat[1]);
  const monat = Number(mJahrMonat[2]);
  const treffer = perioden.filter((p) => p.jahr === jahr && p.monat === monat);
  if (treffer.length === 1) periode = treffer[0];
  else if (treffer.length > 1) { console.error(`Mehrere Perioden für ${jahr}-${monat} gefunden.`); process.exit(1); }
} else {
  const q = periodeArg.trim().toLowerCase();
  const treffer = perioden.filter((p) => String(p.bezeichnung ?? '').toLowerCase().includes(q));
  if (treffer.length === 1) periode = treffer[0];
  else if (treffer.length > 1) {
    console.error(`Mehrdeutig — mehrere Perioden matchen "${periodeArg}":`);
    treffer.forEach((p) => console.error(`  - ${p.bezeichnung} (${p.jahr}-${p.monat})`));
    process.exit(1);
  }
}
if (!periode) {
  console.error(`Keine Periode gefunden für "${periodeArg}".`);
  console.error('Verfügbar:', perioden.map((p) => p.bezeichnung).join(', '));
  process.exit(1);
}
console.log(`Periode: ${periode.bezeichnung} (${periode.jahr}-${periode.monat}), Status: ${periode.status}`);
if (periode.status === 'abgeschlossen') {
  console.warn('⚠ Periode ist ABGESCHLOSSEN — der gespeicherte Abrechnungs-Snapshot');
  console.warn('  ändert sich durch den Import NICHT mehr. Erst wieder öffnen, importieren,');
  console.warn('  neu berechnen und abschließen. Import wird hier NICHT geschrieben.');
  if (write) process.exit(1);
}

// ---- Mitarbeiter laden --------------------------------------

const maSnap = await getDocs(collection(db, 'mitarbeiter'));
const mitarbeiter = maSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
const maByNummer = new Map(mitarbeiter.map((m) => [String(m.nummer), m]));

// ---- Excel lesen --------------------------------------------

const wb = xlsx.readFile(pfad, { cellDates: false });
// Blattwahl: Standard-Datei hat genau EIN Blatt (Nr. | P-Nr. | Name |
// Gesamtsumme) → nehmen. Bei der großen Mappe mit vielen Monatsblättern das
// zur Periode passende „JAHR-MM Liste"-Blatt wählen.
const mm = String(periode.monat).padStart(2, '0');
const prefix = `${periode.jahr}${mm}`;
const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
const sheetName =
  wb.SheetNames.length === 1
    ? wb.SheetNames[0]
    : wb.SheetNames.find((n) => norm(n).startsWith(prefix) && norm(n).includes('liste')) ??
      wb.SheetNames.find((n) => norm(n) === prefix);
if (!sheetName) {
  console.error(`Datei hat mehrere Blätter, aber kein Blatt "${periode.jahr}-${mm} Liste".`);
  console.error('Vorhandene Listen-Blätter:', wb.SheetNames.filter((n) => /liste/i.test(n)).join(', ') || '(keine)');
  console.error('Tipp: Eine Datei mit nur einem Blatt (Nr. | P-Nr. | Name | Gesamtsumme) verwenden.');
  process.exit(1);
}
console.log(`Blatt: ${sheetName}`);
const ws = wb.Sheets[sheetName];
const rows = xlsx.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: null });

const matched = [];
const unmatched = [];
const gesehen = new Set();

for (const row of rows) {
  if (!Array.isArray(row) || row.length === 0) continue;
  let nummer;
  let name;
  const betragKandidaten = [];
  for (const raw of row) {
    if (raw == null) continue;
    const s = String(raw).trim();
    if (!nummer && /^\d{5}$/.test(s)) { nummer = s; continue; }
    if (typeof raw === 'number') { betragKandidaten.push(raw); continue; }
    if (/[a-zA-ZäöüÄÖÜß]/.test(s)) { if (!name) name = s; continue; }
    const n = parseEuro(s);
    if (n != null && /\d/.test(s)) betragKandidaten.push(n);
  }
  if (!nummer) continue; // Header / Leerzeile
  const betrag = betragKandidaten.length ? betragKandidaten[betragKandidaten.length - 1] : undefined;
  if (betrag == null || !(betrag > 0)) continue;
  if (gesehen.has(nummer)) continue;
  gesehen.add(nummer);

  const ma = maByNummer.get(nummer);
  if (ma) matched.push({ maId: ma.id, name: ma.name, nummer, betrag });
  else unmatched.push({ nummer, name, betrag });
}

// ---- Ausgabe ------------------------------------------------

console.log(`\nErkannt: ${matched.length} zugeordnet, ${unmatched.length} ohne Zuordnung.\n`);
const fmt = (n) => n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
for (const m of matched) console.log(`  ✓ ${m.nummer}  ${m.name.padEnd(28)} ${fmt(m.betrag).padStart(12)}`);
if (unmatched.length) {
  console.log('\n  Ohne Zuordnung (übersprungen):');
  for (const u of unmatched) console.log(`  ✗ ${u.nummer ?? '?????'}  ${(u.name ?? '').padEnd(28)} ${fmt(u.betrag).padStart(12)}`);
}
const summe = matched.reduce((s, m) => s + m.betrag, 0);
console.log(`\n  Σ zugeordnet: ${fmt(summe)}`);

if (!write) {
  console.log('\n[Dry-Run] Nichts geschrieben. Zum Schreiben `write` anhängen.');
  process.exit(0);
}

// ---- Schreiben ----------------------------------------------

let geschrieben = 0;
for (const m of matched) {
  const id = `${periode.id}_${m.maId}`;
  const ref = doc(db, 'externeAbrechnungswerte', id);
  const snap = await getDoc(ref);
  const ts = Date.now();
  await setDoc(ref, {
    abrechnungsperiodeId: periode.id,
    mitarbeiterId: m.maId,
    betragEur: Math.round(m.betrag * 100) / 100,
    quelle: 'excel',
    aktualisiertAm: ts,
    ...(snap.exists() ? {} : { erstelltAm: ts }),
  }, { merge: true });
  geschrieben++;
}
console.log(`\n✓ ${geschrieben} externe Abrechnungswerte geschrieben (Periode ${periode.bezeichnung}).`);
console.log('  In der App: Abrechnung → Periode wählen → „Berechnen" → Werte erscheinen in der Spalte');
console.log('  „Wert externe Anwendung" und fließen in Brutto / An Lohnbüro / Lohnübermittlung.');
process.exit(0);
