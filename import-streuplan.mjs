// One-Off: Importiert Monats-Bewegungsdaten aus der ODS-Abrechnungsdatei
// „Streuplan Beilagenauftrag Austrägerabrechnung mit Blattschutzmakro.ods"
// nach Firestore — Ausgaben (Seitenzahl, Stapelanzahl), Beilagen und
// Zusammentragen-Zuordnung.
//
// Aufruf:
//   node import-streuplan.mjs                              # Dry-Run (Default-Pfad)
//   node import-streuplan.mjs <pfad.ods>                   # Dry-Run mit anderem Pfad
//   node import-streuplan.mjs <pfad.ods> write             # Tatsächlich schreiben
//
// Doc-IDs sind deterministisch (Prefix `streuplan-`) → idempotenter
// Re-Import. Bestehende Werte in `ausgaben`-Docs werden NICHT überschrieben,
// wenn die ODS sie nicht liefert (z. B. seitenzahl noch nicht eingepflegt).

import { initializeApp } from 'firebase/app';
import {
  getFirestore, collection, getDocs, setDoc, doc, getDoc, query, where, deleteDoc,
} from 'firebase/firestore';
import { readFileSync } from 'node:fs';
import xlsx from 'xlsx';

const DEFAULT_PFAD = 'C:/Users/marcs/Desktop/Streuplan Beilagenauftrag Austrägerabrechnung mit Blattschutzmakro.ods';

// ---- Args ---------------------------------------------------

const args = process.argv.slice(2);
const pfad = args.find((a) => !/^(write|--.+)$/.test(a)) ?? DEFAULT_PFAD;
const write = args.includes('write');

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

function cellVal(sheet, addr) {
  const c = sheet[addr];
  return c == null ? undefined : c.v;
}
function cellStr(sheet, addr) {
  const v = cellVal(sheet, addr);
  if (v == null) return undefined;
  const s = String(v).trim();
  return s.length > 0 ? s : undefined;
}
function cellNum(sheet, addr) {
  const v = cellVal(sheet, addr);
  if (v == null || v === '') return undefined;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : undefined;
}

/** Extrahiert die erste Zahl aus einem String („3 Stapel + Beilagen" → 3). */
function ersteZahl(s) {
  if (s == null) return undefined;
  const m = String(s).match(/(\d+)/);
  return m ? Number(m[1]) : undefined;
}

function stripUndef(o) {
  const out = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined) out[k] = v;
  return out;
}

/** Stabiler Hash (DJB2) als Hex-String — für deterministische Doc-IDs aus
 *  Schlüssel-Strings. */
function djb2(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16);
}

/** ISO-KW-Anzahl eines Jahres (52 oder 53). */
function maxKwInJahr(jahr) {
  // ISO 8601: Jahr hat 53 Wochen, wenn der 1.1. oder 31.12. ein Donnerstag ist,
  // oder Schaltjahr und einer von beiden ein Mittwoch.
  const dec28 = new Date(Date.UTC(jahr, 11, 28));
  const dayNum = (dec28.getUTCDay() + 6) % 7;
  const monday = new Date(dec28);
  monday.setUTCDate(dec28.getUTCDate() - dayNum);
  const yearStart = new Date(Date.UTC(monday.getUTCFullYear(), 0, 1));
  return Math.ceil(((monday - yearStart) / 86400000 + 1) / 7);
}

// ---- ODS einlesen -------------------------------------------

console.log(`Lese ODS: ${pfad}`);
const wb = xlsx.readFile(pfad, { cellFormula: false });
const aa = wb.Sheets['Abrechnung_Austragen'];
const beilSheet = wb.Sheets['Beilagen'];
if (!aa) { console.error('Sheet `Abrechnung_Austragen` fehlt.'); process.exit(1); }
if (!beilSheet) { console.error('Sheet `Beilagen` fehlt.'); process.exit(1); }

const jahr = cellNum(aa, 'R1');
const monat = cellNum(aa, 'O1');
if (!jahr || !monat) {
  console.error(`Jahr/Monat nicht lesbar (R1=${jahr}, O1=${monat}).`);
  process.exit(1);
}
console.log(`Jahr ${jahr}, Monat ${monat}`);

// Pro Ausgabe-Slot: KW-Anker, Beilagen-Range, Zusammen-Spalte.
// Seitenzahl + Stapelanzahl werden NICHT auf starre Zellen gemappt,
// sondern aus Reihe 1 heuristisch gelesen (Headertext „Seitenzahl" /
// „Anzahl Stapel" + Wert in der Zelle rechts daneben; in Reihenfolge
// der gefundenen Treffer den Ausgaben zugeordnet) — die Abstände
// zwischen den Blöcken sind in der ODS nicht regelmäßig.
const SLOTS = [
  { kwAddr: 'AA3', beilRange: 'BN5:BW105', zusammenCol: 'AS' },
  { kwAddr: 'BY3', beilRange: 'DL5:DU105', zusammenCol: 'CQ' },
  { kwAddr: 'DW3', beilRange: 'FJ5:FS105', zusammenCol: 'EO' },
  { kwAddr: 'FU3', beilRange: 'HH5:HQ105', zusammenCol: 'GM' },
  { kwAddr: 'HS3', beilRange: 'JF5:JO105', zusammenCol: 'IK' },
];

// Reihe 1 nach Seitenzahl- und Anzahl-Stapel-Headern scannen.
// Pro Treffer Wert direkt rechts daneben merken (Reihenfolge = Col-Index).
function scanReihe1FuerHeader(headerRegex) {
  const ref = aa['!ref']; if (!ref) return [];
  const endCol = xlsx.utils.decode_cell(ref.split(':')[1]).c;
  const treffer = [];
  for (let c = 0; c <= endCol; c++) {
    const headerAddr = xlsx.utils.encode_cell({ c, r: 0 });
    const h = cellVal(aa, headerAddr);
    if (typeof h !== 'string') continue;
    if (!headerRegex.test(h)) continue;
    const wertAddr = xlsx.utils.encode_cell({ c: c + 1, r: 0 });
    treffer.push({ col: c, headerAddr, wertAddr, wert: cellVal(aa, wertAddr) });
  }
  return treffer;
}

const seitenTreffer = scanReihe1FuerHeader(/^seitenzahl/i);
const stapelTreffer = scanReihe1FuerHeader(/^anzahl\s*stapel/i);

const ausgaben = []; // { idx (0..4), kw, seitenzahl?, stapelAnzahl?, slot }
for (let i = 0; i < SLOTS.length; i++) {
  const kw = cellNum(aa, SLOTS[i].kwAddr);
  if (!kw) break; // weitere Slots leer → fertig
  // Heuristik: das i-te Vorkommen des Headers gehört zur i-ten Ausgabe.
  const seiteVal = seitenTreffer[i]?.wert;
  const stapelVal = stapelTreffer[i]?.wert;
  ausgaben.push({
    idx: i,
    kw,
    seitenzahl: typeof seiteVal === 'number' ? seiteVal : ersteZahl(seiteVal),
    stapelAnzahl: typeof stapelVal === 'number' ? stapelVal : ersteZahl(stapelVal),
    slot: SLOTS[i],
  });
}
console.log(`Ausgaben: ${ausgaben.map((a) => `KW${a.kw}`).join(', ')} (${ausgaben.length})`);
for (const a of ausgaben) {
  console.log(`  KW${a.kw}: seitenzahl=${a.seitenzahl ?? '—'}, stapelAnzahl=${a.stapelAnzahl ?? '—'}`);
}

// Teilgebiet-Spalte C5..C105 → Mapping row → name (oder null bei Lücke).
const tgZeilen = []; // { row, name } — nur die mit Namen
for (let r = 5; r <= 105; r++) {
  const v = cellVal(aa, `C${r}`);
  if (v == null || v === 0 || v === '0') continue;
  const name = String(v).trim();
  // Whitespace-only / leere Strings sowie der explizite Lücken-Marker "0"
  // werden übersprungen.
  if (!name || name === '0') continue;
  tgZeilen.push({ row: r, name });
}
console.log(`Teilgebiet-Zeilen erkannt: ${tgZeilen.length}`);

// ---- Beilagen-Sheet einlesen --------------------------------

const beilagen = []; // { row, arbeitstitel, kundenname, gewichtGStk, ausgabeKw, kennzeichen, schluessel }
for (let r = 4; r <= 200; r++) {
  const b = cellStr(beilSheet, `B${r}`);
  if (!b) continue;
  beilagen.push({
    row: r,
    arbeitstitel: b,
    kundenname: cellStr(beilSheet, `C${r}`) ?? '',
    gewichtGStk: cellNum(beilSheet, `E${r}`) ?? 0,
    ausgabeKw: cellNum(beilSheet, `F${r}`),
    kennzeichen: (cellStr(beilSheet, `G${r}`) ?? '').replace(/\.$/, '').toLowerCase() === 'ext' ? 'ext' : 'int',
    schluessel: cellStr(beilSheet, `H${r}`) ?? '',
  });
}
console.log(`Beilagen-Einträge im Sheet: ${beilagen.length}`);

// Schlüssel → Beilage (für Marker-Mapping)
const beilageBySchluessel = new Map();
for (const b of beilagen) {
  if (b.schluessel) beilageBySchluessel.set(b.schluessel, b);
}

// ---- Beilagen-Marker pro Ausgabe lesen ----------------------

/** Parst ein Range-String wie "BN5:BW105" → { startCol, endCol, startRow, endRow }. */
function parseRange(rangeStr) {
  const m = rangeStr.match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/);
  if (!m) throw new Error(`Ungültiger Range: ${rangeStr}`);
  return {
    startCol: xlsx.utils.decode_col(m[1]),
    endCol: xlsx.utils.decode_col(m[3]),
    startRow: Number(m[2]),
    endRow: Number(m[4]),
  };
}

const tgRowSet = new Set(tgZeilen.map((t) => t.row));
const tgByRow = new Map(tgZeilen.map((t) => [t.row, t.name]));

// Pro Beilage die Liste der TG-Namen, in denen sie ausgetragen wird.
// Schlüssel: `${beilage.row}` (eindeutig pro ODS-Eintrag).
const tgsProBeilage = new Map();

for (const a of ausgaben) {
  const r = parseRange(a.slot.beilRange);
  let markersInThisAusgabe = 0;
  for (let row = r.startRow; row <= r.endRow; row++) {
    if (!tgRowSet.has(row)) continue;
    for (let col = r.startCol; col <= r.endCol; col++) {
      const addr = xlsx.utils.encode_cell({ c: col, r: row - 1 });
      const v = cellStr(aa, addr);
      if (!v) continue;
      const b = beilageBySchluessel.get(v);
      if (!b) {
        console.warn(`  ⚠ Beilagen-Marker ohne Match: ${addr} = "${v}" (kein Schlüssel im Beilagen-Sheet)`);
        continue;
      }
      if (b.ausgabeKw !== a.kw) {
        console.warn(`  ⚠ Marker für Beilage (KW${b.ausgabeKw}) in falscher Ausgabe-Spalte (KW${a.kw}): ${addr}`);
      }
      if (!tgsProBeilage.has(b.row)) tgsProBeilage.set(b.row, new Set());
      tgsProBeilage.get(b.row).add(tgByRow.get(row));
      markersInThisAusgabe++;
    }
  }
  console.log(`  KW${a.kw}: ${markersInThisAusgabe} Beilagen-Marker`);
}

// ---- Zusammentragen einlesen --------------------------------

// Liste: { ausgabeKw, tgName, name, nummer }
const zusammen = [];
for (const a of ausgaben) {
  const col = a.slot.zusammenCol;
  let count = 0;
  for (const tg of tgZeilen) {
    const cell = cellStr(aa, `${col}${tg.row}`);
    if (!cell) continue;
    // Format: "Name, 90705"
    const parts = cell.split(',');
    if (parts.length < 2) continue;
    const nummer = parts[parts.length - 1].trim();
    const name = parts.slice(0, -1).join(',').trim();
    if (!nummer) continue;
    zusammen.push({ ausgabeKw: a.kw, tgName: tg.name, tgRow: tg.row, name, nummer });
    count++;
  }
  console.log(`  KW${a.kw}: ${count} Zusammentragen-Zuordnungen`);
}

// ---- Firestore-Lookups laden --------------------------------

console.log('\nLade Stammdaten aus Firestore…');
const [tgSnap, maSnap, periodenSnap] = await Promise.all([
  getDocs(collection(db, 'teilgebiete')),
  getDocs(collection(db, 'mitarbeiter')),
  getDocs(collection(db, 'abrechnungsperioden')),
]);
const tgByName = new Map();
for (const d of tgSnap.docs) {
  const data = d.data();
  if (data.name) tgByName.set(String(data.name).trim(), { id: d.id, ...data });
}
const maByNummer = new Map();
for (const d of maSnap.docs) {
  const data = d.data();
  if (data.nummer) maByNummer.set(String(data.nummer).trim(), { id: d.id, ...data });
}
const perioden = periodenSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
console.log(`  Teilgebiete: ${tgByName.size}, Mitarbeiter: ${maByNummer.size}, Perioden: ${perioden.length}`);

// ---- TG-/MA-Mapping --------------------------------

const tgMismatches = new Set();
const maMismatches = new Set();

const tgIdByName = new Map();
for (const tg of tgZeilen) {
  const match = tgByName.get(tg.name);
  if (match) tgIdByName.set(tg.name, match.id);
  else tgMismatches.add(tg.name);
}

const maIdByNummer = new Map();
for (const z of zusammen) {
  if (!maIdByNummer.has(z.nummer)) {
    const m = maByNummer.get(z.nummer);
    if (m) maIdByNummer.set(z.nummer, m.id);
    else maMismatches.add(`${z.name} (${z.nummer})`);
  }
}

if (tgMismatches.size > 0) {
  console.log(`\n⚠ TG-Mismatches (${tgMismatches.size}) — Zeilen werden übersprungen:`);
  for (const n of tgMismatches) console.log(`  · ${n}`);
}
if (maMismatches.size > 0) {
  console.log(`\n⚠ MA-Mismatches (${maMismatches.size}) — Einsätze werden übersprungen:`);
  for (const n of maMismatches) console.log(`  · ${n}`);
}

// ---- Perioden-Sperre prüfen ---------------------------------

function periodeFuerAusgabe(kw) {
  return perioden.find((p) => p.jahr === jahr && (p.kalenderwochen ?? []).includes(kw));
}

const gesperrteKws = new Set();
for (const a of ausgaben) {
  const p = periodeFuerAusgabe(a.kw);
  if (p && (p.status === 'abgeschlossen' || p.monatswechselSnapshot)) {
    console.log(`  ⚠ KW${a.kw}/${jahr} gehört zu Periode „${p.bezeichnung}" mit Snapshot → wird übersprungen.`);
    gesperrteKws.add(a.kw);
  }
}

// ---- Existierende Ausgaben suchen ---------------------------

async function findeAusgabeId(jahr, kw) {
  const q = query(collection(db, 'ausgaben'), where('jahr', '==', jahr), where('kw', '==', kw));
  const snap = await getDocs(q);
  if (snap.empty) return null;
  return snap.docs[0].id;
}

// ---- Schreibplan --------------------------------------------

const planAusgaben = []; // { docId, neu?, payload, kw }
const planBeilagen = []; // { docId, payload, ausgabeKw, beilagenSchluessel }
const planZusammen = []; // { docId, payload, ausgabeKw, tgName, maNummer }

console.log('\nErmittle Schreibplan…');
for (const a of ausgaben) {
  if (gesperrteKws.has(a.kw)) continue;
  const existId = await findeAusgabeId(jahr, a.kw);
  const docId = existId ?? `streuplan-${jahr}-${a.kw}`;
  // Existiert → wir merken uns nur die geänderten Felder; sonst Default-Anlage.
  const payload = existId
    ? stripUndef({
        seitenzahl: a.seitenzahl,
        stapelAnzahl: a.stapelAnzahl,
      })
    : stripUndef({
        kw: a.kw,
        jahr,
        seitenzahl: a.seitenzahl ?? 0,
        stapelAnzahl: a.stapelAnzahl ?? 0,
        grammaturGqm: 65,
        seitenformatMm: { breite: 305, hoehe: 215 },
        status: 'geplant',
        vorarbeitFreigegeben: false,
      });
  planAusgaben.push({ docId, neu: !existId, payload, kw: a.kw });
}

// Doc-ID-Strategie für Beilagen + Zusammentragen: benötigt die Ausgabe-ID.
// Wir bestimmen sie aus dem Plan (oder existId).
function ausgabeDocIdFuerKw(kw) {
  const p = planAusgaben.find((x) => x.kw === kw);
  return p?.docId;
}

for (const b of beilagen) {
  if (b.ausgabeKw == null) continue;
  if (gesperrteKws.has(b.ausgabeKw)) continue;
  const ausgabeDocId = ausgabeDocIdFuerKw(b.ausgabeKw);
  if (!ausgabeDocId) continue; // KW gehört zu keiner importierten Ausgabe
  const tgs = tgsProBeilage.get(b.row) ?? new Set();
  const teilgebietIds = [];
  for (const tgName of tgs) {
    const id = tgIdByName.get(tgName);
    if (id) teilgebietIds.push(id);
  }
  const beilDocId = `streuplan-${ausgabeDocId}-${djb2(b.schluessel || `${b.arbeitstitel}|${b.kundenname}|${b.gewichtGStk}`)}`;
  planBeilagen.push({
    docId: beilDocId,
    ausgabeKw: b.ausgabeKw,
    beilagenSchluessel: b.schluessel,
    payload: stripUndef({
      ausgabeId: ausgabeDocId,
      arbeitstitel: b.arbeitstitel,
      kundenname: b.kundenname,
      gewichtGStk: b.gewichtGStk,
      format: 'A4',
      kennzeichen: b.kennzeichen,
      teilgebietIds,
    }),
  });
}

for (const z of zusammen) {
  if (gesperrteKws.has(z.ausgabeKw)) continue;
  const ausgabeDocId = ausgabeDocIdFuerKw(z.ausgabeKw);
  if (!ausgabeDocId) continue;
  const tgId = tgIdByName.get(z.tgName);
  const maId = maIdByNummer.get(z.nummer);
  if (!tgId || !maId) continue;
  const stapel = (ausgaben.find((a) => a.kw === z.ausgabeKw)?.stapelAnzahl) ?? 0;
  const docId = `streuplan-${ausgabeDocId}-${tgId}-${maId}`;
  planZusammen.push({
    docId,
    ausgabeKw: z.ausgabeKw,
    tgName: z.tgName,
    maNummer: z.nummer,
    payload: {
      ausgabeId: ausgabeDocId,
      teilgebietId: tgId,
      mitarbeiterId: maId,
      stapelBearbeitet: stapel,
      istVorarbeit: false,
    },
  });
}

// ---- Zusammenfassung ----------------------------------------

console.log('\n=== Schreibplan ===');
console.log(`Ausgaben:           ${planAusgaben.length} (${planAusgaben.filter((x) => x.neu).length} neu, ${planAusgaben.filter((x) => !x.neu).length} Update)`);
console.log(`Beilagen:           ${planBeilagen.length}`);
for (const b of planBeilagen) {
  const tgCount = (b.payload.teilgebietIds ?? []).length;
  console.log(`  · KW${b.ausgabeKw}: ${b.payload.arbeitstitel}/${b.payload.kundenname} → ${tgCount} TGs`);
}
console.log(`Zusammentragen-Einsätze: ${planZusammen.length}`);
const zaehlerProKw = new Map();
for (const z of planZusammen) zaehlerProKw.set(z.ausgabeKw, (zaehlerProKw.get(z.ausgabeKw) ?? 0) + 1);
for (const [kw, n] of [...zaehlerProKw].sort()) console.log(`  · KW${kw}: ${n} Einsätze`);

// Detail-Ansicht pro MA: TG-Liste je KW. Kompakt aggregiert, damit der
// User beim Dry-Run prüfen kann, welche Mitarbeiter welche Teilgebiete
// in welcher KW zusammentragen.
const ausgabenKws = ausgaben.map((a) => a.kw);
const tgNameById = new Map();
for (const tg of tgSnap.docs) {
  const d = tg.data();
  if (d?.name) tgNameById.set(tg.id, String(d.name));
}
const maNameById = new Map();
for (const m of maSnap.docs) {
  const d = m.data();
  if (d?.name) maNameById.set(m.id, { name: String(d.name), nummer: String(d.nummer ?? '') });
}
// Pro MA: Map<kw, tgNames[]>
const proMa = new Map();
for (const z of planZusammen) {
  if (!proMa.has(z.payload.mitarbeiterId)) proMa.set(z.payload.mitarbeiterId, new Map());
  const m = proMa.get(z.payload.mitarbeiterId);
  if (!m.has(z.ausgabeKw)) m.set(z.ausgabeKw, []);
  m.get(z.ausgabeKw).push(tgNameById.get(z.payload.teilgebietId) ?? '?');
}
// Auslagestellen werden naturgemäß nicht zusammengetragen — wir
// filtern sie aus der „fehlt"-Liste raus, damit der Output sauber
// zeigt was wirklich nicht eingepflegt ist.
const istAuslagestelleTg = new Set();
for (const tg of tgSnap.docs) {
  const d = tg.data();
  if (d?.istAuslagestelle && d?.name) istAuslagestelleTg.add(String(d.name).trim());
}

console.log('\n--- TGs ohne Zusammenträger (pro KW) ---');
for (const a of ausgaben) {
  const tgsMitZuordnung = new Set(
    planZusammen.filter((z) => z.ausgabeKw === a.kw).map((z) => z.tgName),
  );
  const zuPruefen = tgZeilen.filter(
    (tg) => !tgsMitZuordnung.has(tg.name) && !istAuslagestelleTg.has(tg.name),
  );
  if (zuPruefen.length === 0) {
    const skipped = tgZeilen.filter((t) => istAuslagestelleTg.has(t.name)).length;
    console.log(
      `  KW${a.kw}: alle Zusammenträger-TGs zugeordnet ✓  (${skipped} Auslagestellen übersprungen)`,
    );
    continue;
  }
  console.log(`  KW${a.kw}: ${zuPruefen.length} TGs ohne Zuordnung:`);
  for (const tg of zuPruefen) {
    const cell = cellStr(aa, `${a.slot.zusammenCol}${tg.row}`);
    const tgFound = tgIdByName.has(tg.name);
    let grund;
    if (!cell) grund = 'leer in ODS';
    else if (!tgFound) grund = 'TG nicht in Firestore';
    else {
      const parts = cell.split(',');
      const nummer = parts[parts.length - 1]?.trim();
      grund = maIdByNummer.has(nummer) ? '?' : `MA-Nummer ${nummer} nicht in Firestore`;
    }
    console.log(`    · ${tg.name}  (${grund})`);
  }
}

console.log('\n--- Zusammentragen-Detail (pro Mitarbeiter, je KW komma-separiert) ---');
const sortierte = [...proMa.entries()].sort((a, b) => {
  const na = maNameById.get(a[0])?.name ?? '';
  const nb = maNameById.get(b[0])?.name ?? '';
  return na.localeCompare(nb, 'de');
});
for (const [maId, perKw] of sortierte) {
  const info = maNameById.get(maId);
  const name = `${info?.name ?? '?'} (${info?.nummer ?? '?'})`;
  console.log(`  ${name}`);
  for (const kw of ausgabenKws) {
    const tgs = perKw.get(kw) ?? [];
    if (tgs.length === 0) continue;
    console.log(`    KW${kw} (${tgs.length}): ${tgs.join(', ')}`);
  }
}

if (!write) {
  console.log('\nDry-Run. Zum Schreiben:  node import-streuplan.mjs <pfad> write');
  process.exit(0);
}

// ---- Schreiben ----------------------------------------------

console.log('\nSchreibe nach Firestore…');
const ts = Date.now();

for (const a of planAusgaben) {
  const ref = doc(db, 'ausgaben', a.docId);
  if (a.neu) {
    await setDoc(ref, { ...a.payload, erstelltAm: ts, aktualisiertAm: ts });
  } else {
    // Update: bestehende Felder erhalten, nur die mitgegebenen überschreiben.
    const existing = await getDoc(ref);
    const base = existing.exists() ? existing.data() : {};
    await setDoc(ref, { ...base, ...a.payload, aktualisiertAm: ts });
  }
}
console.log(`  ✓ ${planAusgaben.length} Ausgaben`);

// Vor dem Beilagen-/Zusammentragen-Write: pro betroffener Ausgabe alle
// alten `streuplan-`-Dokumente entfernen (= aus früheren Imports).
// Manuell in der App angelegte Beilagen/Zusammentrag-Einsätze (ohne
// diesen Doc-ID-Prefix) bleiben unberührt. Damit bleibt der Import
// idempotent — auch wenn der User in der ODS Beilagen löscht oder
// MAs an einem TG wechselt, gibt es keine Karteileichen.
const betroffeneAusgabenIds = new Set([
  ...planBeilagen.map((b) => b.payload.ausgabeId),
  ...planZusammen.map((z) => z.payload.ausgabeId),
]);
let entfernt = 0;
for (const ausgabeId of betroffeneAusgabenIds) {
  for (const collName of ['beilagen', 'zusammentragezeiten']) {
    const snap = await getDocs(
      query(collection(db, collName), where('ausgabeId', '==', ausgabeId)),
    );
    for (const d of snap.docs) {
      if (d.id.startsWith('streuplan-')) {
        await deleteDoc(d.ref);
        entfernt++;
      }
    }
  }
}
if (entfernt > 0) console.log(`  ✓ ${entfernt} alte Streuplan-Docs entfernt`);

for (const b of planBeilagen) {
  const ref = doc(db, 'beilagen', b.docId);
  await setDoc(ref, { ...b.payload, erstelltAm: ts });
}
console.log(`  ✓ ${planBeilagen.length} Beilagen`);

for (const z of planZusammen) {
  const ref = doc(db, 'zusammentragezeiten', z.docId);
  await setDoc(ref, { ...z.payload, erstelltAm: ts, aktualisiertAm: ts });
}
console.log(`  ✓ ${planZusammen.length} Zusammentragen-Einsätze`);

console.log('\nFertig.');
process.exit(0);
