/**
 * Firestore-Import: Stammdaten aus ODS + Gebietsdokumentation aus XLSX
 *
 * Quellen:
 *   ODS : Streuplan Beilagenauftrag Austrägerabrechnung...ods
 *   XLSX: Gebietsdokumentation mit Protokoll...xlsx
 *
 * Ausführen: node scripts/import-firestore.mjs
 */

import { createRequire } from 'module';
import { initializeApp } from 'firebase/app';
import {
  getFirestore,
  collection,
  doc,
  setDoc,
  addDoc,
  updateDoc,
  getDocs,
  writeBatch,
} from 'firebase/firestore';

const require = createRequire(import.meta.url);
const XLSX = require('xlsx');

// ── Firebase-Konfiguration ─────────────────────────────────────────────────

const firebaseConfig = {
  apiKey: 'AIzaSyBGbMres7hAZLIaku_IAC4UAYKZyPNthNg',
  authDomain: 'mitarbeiterabrechnung-sdruck.firebaseapp.com',
  projectId: 'mitarbeiterabrechnung-sdruck',
  storageBucket: 'mitarbeiterabrechnung-sdruck.firebasestorage.app',
  messagingSenderId: '972533708202',
  appId: '1:972533708202:web:f180967ef9066e25f267d3',
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// ── Dateipfade ─────────────────────────────────────────────────────────────

const ODS_PATH =
  'C:/Users/marcs/Downloads/Streuplan Beilagenauftrag Austrägerabrechnung mit Blattschutzmakro.ods';
const XLSX_PATH =
  'C:/Users/marcs/Downloads/Gebietsdokumentation mit Protokoll Mengenprüfungen (Einwürfe strassengenau).xlsx';

// ── Hilfsfunktionen ────────────────────────────────────────────────────────

/** Excel-Seriennummer → ISO-Datum (YYYY-MM-DD) */
function excelDatumZuIso(serial) {
  if (!serial || typeof serial !== 'number' || serial < 1) return '';
  const ms = (serial - 25569) * 86400 * 1000;
  const d = new Date(ms);
  if (isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

/** Adresse parsen: "Straße, PLZ, Ort" → { strasse, plz, ort } */
function parseAdresse(raw) {
  if (!raw || raw === '0' || typeof raw !== 'string') {
    return { strasse: '', plz: '', ort: '' };
  }
  const plzMatch = raw.match(/\b(\d{5})\b/);
  if (!plzMatch) return { strasse: raw.trim(), plz: '', ort: '' };
  const plz = plzMatch[1];
  const plzIdx = raw.indexOf(plz);
  const strasse = raw.slice(0, plzIdx).replace(/[,\s]+$/, '').trim();
  const ort = raw.slice(plzIdx + plz.length).replace(/^[,\s]+/, '').trim();
  return { strasse, plz, ort };
}

/** "Name Name, 90XXX" → Nummer-String */
function extractNummer(raw) {
  if (!raw) return '';
  const m = String(raw).match(/\b(9\d{4})\b/);
  return m ? m[1] : '';
}

/** Normierter Name für fuzzy-Matching */
function norm(s) {
  return String(s)
    .toLowerCase()
    .replace(/[/\s\-,.()]/g, '')
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss');
}

/** Tour-Schlüssel aus Rohwert ("Tour1 (Rot)" → "tour1") */
function tourKey(raw) {
  const m = String(raw).match(/tour(\d)/i);
  return m ? `tour${m[1]}` : null;
}

/** Tour-Metadaten */
const TOUR_META = {
  tour1: { name: 'Tour 1 (Rot)',   farbe: '#ef4444' },
  tour2: { name: 'Tour 2 (Gelb)',  farbe: '#eab308' },
  tour3: { name: 'Tour 3 (Blau)',  farbe: '#3b82f6' },
  tour4: { name: 'Tour 4 (Grün)', farbe: '#22c55e' },
  tour5: { name: 'Tour 5 (Weiß)', farbe: '#9ca3af' },
};

// ── Firestore-Helfer ───────────────────────────────────────────────────────

async function loescheKollektion(name) {
  const snap = await getDocs(collection(db, name));
  if (snap.empty) { process.stdout.write(`  ✓ ${name} — bereits leer\n`); return; }
  const chunks = [];
  let b = writeBatch(db), cnt = 0;
  for (const d of snap.docs) {
    b.delete(d.ref);
    if (++cnt === 490) { chunks.push(b.commit()); b = writeBatch(db); cnt = 0; }
  }
  if (cnt > 0) chunks.push(b.commit());
  await Promise.all(chunks);
  process.stdout.write(`  ✓ ${name} — ${snap.size} Dokumente gelöscht\n`);
}

// ── ODS-Daten parsen ───────────────────────────────────────────────────────

function parseOds() {
  console.log('\n📂 Lese ODS-Stammdaten …');
  const wb = XLSX.readFile(ODS_PATH);

  // 1. Touren ermitteln
  const vpRows = XLSX.utils.sheet_to_json(wb.Sheets['Verteilplan'], { header: 1, defval: '' });
  const tourKeys = new Set();
  for (const r of vpRows) { const k = tourKey(r[12]); if (k) tourKeys.add(k); }
  const touren = [...tourKeys].sort().map((k) => ({ key: k, ...TOUR_META[k] ?? { name: k, farbe: '#6b7280' } }));
  console.log(`  Touren: ${touren.map((t) => t.name).join(', ')}`);

  // 2. Teilgebiete
  const teilgebiete = [];
  for (const r of vpRows) {
    const name = r[2];
    const stueck = r[6];
    if (typeof name !== 'string' || !name.trim()) continue;
    if (typeof stueck !== 'number' || stueck <= 0) continue;
    teilgebiete.push({
      name: name.trim(),
      plz: r[1] ? String(Math.round(r[1])) : '',
      stueckzahl: Math.round(stueck),
      wegstreckeM: typeof r[11] === 'number' ? Math.round(r[11]) : 0,
      tourKey: tourKey(r[12]) ?? '',
      standardNummer: extractNummer(r[17]),
      isActive: true,
      stueckzahlManuell: false,
      strassen: [], sonderauslagen: [], nichtBeliefen: [],
    });
  }
  console.log(`  Teilgebiete: ${teilgebiete.length}`);

  // 3. Mitarbeiter
  const maRows = XLSX.utils.sheet_to_json(wb.Sheets['Austräger_Stammdaten'], { header: 1, defval: '' });
  const headerRow = maRows[0];
  const freigabenStart = 31;
  const freigabenNamen = headerRow.slice(freigabenStart).map((h) => String(h).trim());

  const mitarbeiter = [];
  for (let i = 1; i < maRows.length; i++) {
    const r = maRows[i];
    const nummer = r[1] ? String(Math.round(Number(r[1]))) : '';
    const nachname = r[2] ? String(r[2]).trim() : '';
    if (!nummer || !nachname) continue;
    const vorname = r[12] ? String(r[12]).trim() : '';
    const name = vorname ? `${nachname} ${vorname}` : nachname;

    // Freigaben
    const freigaben = [];
    for (let fi = 0; fi < freigabenNamen.length; fi++) {
      const v = r[freigabenStart + fi];
      if (v !== '' && v !== null && v !== undefined) freigaben.push(freigabenNamen[fi]);
    }

    const rollen = ['austräger'];
    if (r[6] && String(r[6]).toLowerCase() === 'z') rollen.push('zusammenträger');

    mitarbeiter.push({
      nummer,
      name,
      adresse: parseAdresse(r[5] ? String(r[5]).trim() : ''),
      telefon: r[4] ? String(r[4]).trim() : '',
      geburtsdatum: excelDatumZuIso(r[3]),
      rollen,
      abrechnungstyp: 'variabel',
      isActive: !(r[17] && String(r[17]).trim() !== ''),
      freigabenNamen: freigaben,
    });
  }
  console.log(`  Mitarbeiter: ${mitarbeiter.length} gesamt, ${mitarbeiter.filter((m) => m.isActive).length} aktiv`);

  // 4. Sondervereinbarungen
  const svRows = XLSX.utils.sheet_to_json(wb.Sheets['Austräger_Stamm_Sondervereinbarung'], { header: 1, defval: '' });
  const sondervereinbarungen = [];
  for (let i = 1; i < svRows.length; i++) {
    const r = svRows[i];
    const nummer = extractNummer(r[1]);
    const tgName = r[2] ? String(r[2]).trim() : '';
    const betrag = typeof r[3] === 'number' ? r[3] : parseFloat(String(r[3])) || 0;
    const memo = r[4] ? String(r[4]).trim() : '';
    if (nummer && tgName && betrag > 0) sondervereinbarungen.push({ nummer, tgName, betrag, memo });
  }
  console.log(`  Sondervereinbarungen: ${sondervereinbarungen.length}`);

  return { touren, teilgebiete, mitarbeiter, sondervereinbarungen };
}

// ── XLSX-Straßendaten parsen ───────────────────────────────────────────────

function parseStraßen() {
  console.log('\n📂 Lese Gebietsdokumentation …');
  const wb = XLSX.readFile(XLSX_PATH);
  const result = new Map();
  const SKIP = new Set(['Mengen Übersicht', 'Protokoll Gebietsüberprüfungen ', 'Parameter']);

  for (const sheetName of wb.SheetNames) {
    if (SKIP.has(sheetName)) continue;
    if (sheetName.toUpperCase().includes('INAKTIV')) continue;

    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: '' });
    const strassen = [], sonderauslagen = [], nichtBeliefen = [];
    let section = 'strassen';
    let idCnt = 1;

    for (let i = 3; i < rows.length; i++) {
      const r = rows[i];
      const col0 = String(r[0] ?? '').trim();
      if (!col0) continue;
      const lo = col0.toLowerCase();

      if (lo.startsWith('sonderauslage')) { section = 'sonderauslagen'; continue; }
      if (lo.startsWith('nicht zu beliefern')) { section = 'nichtbeliefen'; continue; }
      if (lo.startsWith('besonderheit')) { section = 'besonderheiten'; continue; }
      if (lo.startsWith('rest nach') || lo.startsWith('summe')) continue;
      if (section === 'besonderheiten') continue;

      const stueck = typeof r[1] === 'number' && r[1] > 0 ? Math.round(r[1]) : 0;
      const rawCode = String(r[2] ?? '').trim();
      const plusCode = rawCode.replace('https://plus.codes/', '') || undefined;
      const id = String(idCnt++);

      if (section === 'strassen') {
        strassen.push({ id, strassenname: col0, stueckzahl: stueck, ...(plusCode ? { plusCode } : {}) });
      } else if (section === 'sonderauslagen') {
        sonderauslagen.push({ id, bezeichnung: col0, stueckzahl: stueck, ...(plusCode ? { adresse: plusCode } : {}) });
      } else if (section === 'nichtbeliefen') {
        nichtBeliefen.push({ id, adresse: col0 });
      }
    }

    result.set(norm(sheetName), { strassen, sonderauslagen, nichtBeliefen });
  }
  console.log(`  ${result.size} Gebiets-Blätter gelesen`);
  return result;
}

// ── Haupt-Import ───────────────────────────────────────────────────────────

async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log('  Schlieper-Druck — Firestore-Daten-Import');
  console.log('═══════════════════════════════════════════════');

  const { touren, teilgebiete, mitarbeiter, sondervereinbarungen } = parseOds();
  const straßenMap = parseStraßen();

  // Straßendaten in Teilgebiete einbauen
  let straßenHits = 0;
  for (const tg of teilgebiete) {
    const hit = straßenMap.get(norm(tg.name));
    if (hit) {
      Object.assign(tg, hit);
      straßenHits++;
    }
  }
  console.log(`\n  Straßen-Matches: ${straßenHits}/${teilgebiete.length} Teilgebiete`);
  const ohneMatch = teilgebiete.filter((tg) => tg.strassen.length === 0 && tg.wegstreckeM > 0);
  if (ohneMatch.length) console.log(`  ⚠ Kein Match: ${ohneMatch.map((t) => t.name).join(', ')}`);

  // ── Löschen ──
  console.log('\n🗑  Lösche bestehende Daten …');
  for (const col of [
    'mitarbeiter', 'teilgebiete', 'touren', 'sondervereinbarungen',
    'einsaetze', 'arbeitszeiten', 'zusammentragezeiten',
    'fahrten', 'beilagen', 'ausgaben', 'abrechnungsperioden',
    'reklamationen', 'vorschuesse',
  ]) {
    await loescheKollektion(col);
  }

  const ts = Date.now();

  // ── Touren (feste IDs) ──
  console.log('\n📥 Importiere Touren …');
  for (const t of touren) {
    await setDoc(doc(db, 'touren', t.key), { name: t.name, farbe: t.farbe, erstelltAm: ts });
    console.log(`  ✓ ${t.name}`);
  }

  // ── Mitarbeiter ──
  console.log('\n📥 Importiere Mitarbeiter …');
  const maIdMap = new Map(); // nummer → docId
  let maCnt = 0;
  for (const ma of mitarbeiter) {
    const ref = await addDoc(collection(db, 'mitarbeiter'), {
      nummer: ma.nummer,
      name: ma.name,
      adresse: ma.adresse,
      telefon: ma.telefon,
      geburtsdatum: ma.geburtsdatum,
      rollen: ma.rollen,
      abrechnungstyp: ma.abrechnungstyp,
      isActive: ma.isActive,
      teilgebietFreigaben: [],
      erstelltAm: ts,
      aktualisiertAm: ts,
    });
    maIdMap.set(ma.nummer, ref.id);
    if (++maCnt % 25 === 0) console.log(`  … ${maCnt}/${mitarbeiter.length}`);
  }
  console.log(`  ✓ ${maCnt} Mitarbeiter`);

  // ── Teilgebiete ──
  console.log('\n📥 Importiere Teilgebiete …');
  const tgNameToId = new Map(); // name → docId
  const tgNormToId = new Map(); // norm(name) → docId

  for (const tg of teilgebiete) {
    const standardId = tg.standardNummer ? (maIdMap.get(tg.standardNummer) ?? null) : null;
    const tourId = tg.tourKey ? tg.tourKey : null; // Tour-IDs = key

    const ref = await addDoc(collection(db, 'teilgebiete'), {
      name: tg.name,
      plz: tg.plz,
      stueckzahl: tg.stueckzahl,
      stueckzahlManuell: false,
      wegstreckeM: tg.wegstreckeM,
      tourId,
      standardAustraegerId: standardId,
      isActive: true,
      strassen: tg.strassen,
      sonderauslagen: tg.sonderauslagen,
      nichtBeliefen: tg.nichtBeliefen,
      erstelltAm: ts,
      aktualisiertAm: ts,
    });
    tgNameToId.set(tg.name, ref.id);
    tgNormToId.set(norm(tg.name), ref.id);
  }
  console.log(`  ✓ ${teilgebiete.length} Teilgebiete`);

  // ── Freigaben aktualisieren ──
  console.log('\n🔄 Aktualisiere Gebiets-Freigaben …');
  let freigabenCnt = 0;
  for (const ma of mitarbeiter) {
    if (!ma.freigabenNamen.length) continue;
    const maId = maIdMap.get(ma.nummer);
    if (!maId) continue;
    const ids = ma.freigabenNamen
      .map((n) => tgNameToId.get(n) ?? tgNormToId.get(norm(n)))
      .filter(Boolean);
    if (ids.length) {
      await updateDoc(doc(db, 'mitarbeiter', maId), { teilgebietFreigaben: ids, aktualisiertAm: ts });
      freigabenCnt++;
    }
  }
  console.log(`  ✓ ${freigabenCnt} Mitarbeiter mit Freigaben`);

  // ── Sondervereinbarungen ──
  console.log('\n📥 Importiere Sondervereinbarungen …');
  let svOk = 0;
  const svFail = [];
  for (const sv of sondervereinbarungen) {
    const maId = maIdMap.get(sv.nummer);
    const tgId = tgNameToId.get(sv.tgName) ?? tgNormToId.get(norm(sv.tgName));
    if (!maId || !tgId) { svFail.push(`${sv.nummer}+${sv.tgName}`); continue; }
    await addDoc(collection(db, 'sondervereinbarungen'), {
      mitarbeiterId: maId, teilgebietId: tgId,
      betragEur: sv.betrag, begruendung: sv.memo,
      erstelltAm: ts,
    });
    svOk++;
  }
  console.log(`  ✓ ${svOk} Sondervereinbarungen`);
  if (svFail.length) console.log(`  ⚠ Nicht aufgelöst: ${svFail.join(', ')}`);

  // ── Zusammenfassung ──
  console.log('\n═══════════════════════════════════════════════');
  console.log('✅ Import erfolgreich abgeschlossen!');
  console.log(`   Touren:                ${touren.length}`);
  console.log(`   Mitarbeiter (gesamt):  ${maCnt}`);
  console.log(`   Mitarbeiter (aktiv):   ${mitarbeiter.filter((m) => m.isActive).length}`);
  console.log(`   Teilgebiete:           ${teilgebiete.length}`);
  console.log(`   Sondervereinbarungen:  ${svOk}`);
  console.log(`   Freigaben-Updates:     ${freigabenCnt}`);
  console.log('═══════════════════════════════════════════════\n');
  process.exit(0);
}

main().catch((err) => {
  console.error('\n❌ Fehler:', err.message ?? err);
  console.error(err.stack);
  process.exit(1);
});
