/**
 * Reset-Aktivkennzeichen auf Basis der Standardausträger.
 *
 * Setzt isActive = true für ALLE Mitarbeiter, die aktuell als
 * `standardAustraegerId` einem Teilgebiet zugeordnet sind, und isActive = false
 * für alle anderen.
 *
 * Hintergrund: Beim Excel-Import wurden zu viele Mitarbeiter als „aktiv"
 * gekennzeichnet. Tatsächlich aktiv sind nur Standard-Austräger; weitere
 * aktive Mitarbeiter (Büro etc.) werden manuell nachgepflegt.
 *
 * Trockenlauf:    node scripts/reset-aktive-mitarbeiter.mjs
 * Echte Änderung: node scripts/reset-aktive-mitarbeiter.mjs --confirm
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

const istBestaetigt = process.argv.includes('--confirm');

if (!firebaseConfig.projectId) {
  console.error('❌ VITE_FIREBASE_*-Variablen fehlen.');
  process.exit(1);
}

console.log(`🔌 Verbinde zu Firestore (Projekt: ${firebaseConfig.projectId})…\n`);
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// 1) Alle Teilgebiete laden, IDs der Standardausträger sammeln
const tgSnap = await getDocs(collection(db, 'teilgebiete'));
const standardAustraegerIds = new Set();
let tgMitAustraeger = 0;
for (const d of tgSnap.docs) {
  const data = d.data();
  if (data.standardAustraegerId) {
    standardAustraegerIds.add(data.standardAustraegerId);
    tgMitAustraeger++;
  }
}
console.log(`📍 ${tgSnap.size} Teilgebiete geladen.`);
console.log(`   davon ${tgMitAustraeger} mit Standardausträger.`);
console.log(`   ergibt ${standardAustraegerIds.size} eindeutige Mitarbeiter-IDs (manche tragen mehrere TG aus).\n`);

// 2) Alle Mitarbeiter laden + analysieren
const maSnap = await getDocs(collection(db, 'mitarbeiter'));
console.log(`👥 ${maSnap.size} Mitarbeiter geladen.\n`);

let zuAktivieren = 0;   // standard-austräger, aber aktuell isActive=false
let zuDeaktivieren = 0; // kein standard-austräger, aber aktuell isActive=true
let unverändertAktiv = 0;
let unverändertInaktiv = 0;
let fehlerNichtGefunden = 0;

const aenderungen = [];

for (const d of maSnap.docs) {
  const data = d.data();
  const istStandardAustraeger = standardAustraegerIds.has(d.id);
  const istAktuellAktiv = data.isActive === true;
  const sollAktiv = istStandardAustraeger;

  if (sollAktiv === istAktuellAktiv) {
    if (sollAktiv) unverändertAktiv++;
    else unverändertInaktiv++;
  } else {
    aenderungen.push({ id: d.id, name: data.name, von: istAktuellAktiv, nach: sollAktiv });
    if (sollAktiv) zuAktivieren++;
    else zuDeaktivieren++;
  }
}

// Standardausträger-IDs, die KEIN Mitarbeiter-Dokument haben (Datenqualität)
const maIds = new Set(maSnap.docs.map((d) => d.id));
for (const id of standardAustraegerIds) {
  if (!maIds.has(id)) fehlerNichtGefunden++;
}

console.log('Auswertung:');
console.log(`  unverändert aktiv (= Standardausträger, schon isActive)       : ${unverändertAktiv}`);
console.log(`  unverändert inaktiv (= kein Standardaustr., schon !isActive)  : ${unverändertInaktiv}`);
console.log(`  zu aktivieren  (Standardausträger, war !isActive)             : ${zuAktivieren}`);
console.log(`  zu DEAKTIVIEREN (kein Standardausträger, war isActive)        : ${zuDeaktivieren}`);
if (fehlerNichtGefunden > 0) {
  console.log(`  ⚠ Standardausträger-IDs ohne Mitarbeiter-Dokument            : ${fehlerNichtGefunden}`);
}
console.log('');

if (zuDeaktivieren > 0) {
  console.log('Beispiele (max. 10) der Mitarbeiter, die DEAKTIVIERT würden:');
  aenderungen.filter((a) => a.nach === false).slice(0, 10).forEach((a) =>
    console.log(`   – ${a.name}  (${a.id})`)
  );
  console.log('');
}

if (!istBestaetigt) {
  console.log(`⚠  Trockenlauf — KEINE Änderung. Echtes Schreiben mit:`);
  console.log(`   node scripts/reset-aktive-mitarbeiter.mjs --confirm`);
  process.exit(0);
}

// 3) Änderungen schreiben (Batches à 500)
console.log(`✍  Schreibe ${aenderungen.length} Änderungen…`);
const ts = Date.now();
let geschrieben = 0;
for (let i = 0; i < aenderungen.length; i += 500) {
  const batch = writeBatch(db);
  const chunk = aenderungen.slice(i, i + 500);
  for (const a of chunk) {
    batch.update(doc(db, 'mitarbeiter', a.id), {
      isActive: a.nach,
      aktualisiertAm: ts,
    });
  }
  await batch.commit();
  geschrieben += chunk.length;
  process.stdout.write(`   …${geschrieben}/${aenderungen.length}\r`);
}

console.log(`\n✅ Fertig. ${zuAktivieren} aktiviert, ${zuDeaktivieren} deaktiviert.`);
process.exit(0);
