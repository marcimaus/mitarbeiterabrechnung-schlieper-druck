/**
 * Einmaliger Import der Interessenten aus der Google-Tabelle
 * „Interessenten Aushilfen" (als .xlsx heruntergeladen) in die
 * Mitarbeiter-Collection (istInteressent=true, keine Mitarbeiternummer).
 *
 * Aufruf:
 *   node scripts/import-interessenten.mjs <xlsx-Datei> [--apply] [--json <out>]
 *
 * Ohne --apply: Dry-Run (zeigt die bereinigten Datensätze).
 *
 * Spaltenzuordnung (Blatt „Daten erfassen"):
 *   A Name                         → name
 *   B Interessent Austragen (Ort)  → interessentOrte + Tätigkeit „austragen"
 *   C Interessent Zusammentragen   → Tätigkeit „zusammentragen"
 *   D Interessent Springer         → Tätigkeit „austragen" (+ Memo-Hinweis)
 *   E Aushilfe Produktion/Fahrer   → Tätigkeit „aushilfeProduktion"
 *   F Datum                        → interessentKontaktDatum
 *   H Adresse                      → adresse.strasse / plz / ort (Tabelle ADRESSEN)
 *   I Alter / Geburtsdatum         → interessentAlterBeiErfassung bzw. geburtsdatum
 *   J Tel.                         → telefon
 *   K Mail                         → email
 *   L Link (Mail)                  → interessentKorrespondenzLink (Hyperlink-Ziel)
 *   O Erfahrung Austragen?         → Memo-Zeile
 *   P Auto?                        → autoVorhanden
 *   Q Erledigungskennung           → „eingestellt" = Zeile überspringen,
 *                                    „kein Interesse mehr" = deinteressiert
 *   R Memo                         → interessentMemo
 *   M Mobil / N WhatsApp / G erfasst von → ignoriert
 *
 * Die Quelldaten sind handgepflegt und uneinheitlich; Sonderfälle sind unten
 * je Tabellenzeile (Excel-Zeilennummer) explizit aufgelöst.
 */

import XLSX from 'xlsx';
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, writeBatch, doc } from 'firebase/firestore';
import { fileURLToPath } from 'node:url';
import { dirname, join, isAbsolute } from 'node:path';
import { writeFileSync } from 'node:fs';
import { config as dotenvConfig } from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..');
dotenvConfig({ path: join(projectRoot, '.env') });

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const jsonIdx = args.indexOf('--json');
const jsonOut = jsonIdx >= 0 ? args[jsonIdx + 1] : null;
const fileArg = args.find((a, i) => !a.startsWith('--') && (jsonIdx < 0 || i !== jsonIdx + 1));
if (!fileArg) {
  console.error('Aufruf: node scripts/import-interessenten.mjs <xlsx-Datei> [--apply] [--json <out>]');
  process.exit(1);
}
const xlsxPath = isAbsolute(fileArg) ? fileArg : join(projectRoot, fileArg);

// --- Sonderfälle je Excel-Zeile ------------------------------------------

/** Zeilen, die nur Fortsetzungen anderer Zeilen sind (in OVERRIDES aufgelöst). */
const SKIP_ROWS = new Set([117, 118, 119, 126, 127]);

/**
 * Dubletten: erste Zeile ist die Basis, die weiteren werden hineingemischt.
 * Name der Basiszeile bleibt, sofern nicht per OVERRIDES geändert.
 */
const MERGE_GROUPS = [
  [47, 20],        // Wurm, Volker („unbekannt" mit seiner Adresse + gleicher Tel.)
  [76, 98],        // Jette Heinrich
  [82, 121],       // Lukas Ackerhans
  [111, 138],      // Domenik/Dominic Schwedtke (gleiche Mail)
  [139, 158],      // Dominik Dojmi (gleiche Mail)
  [188, 190],      // Fahed Zandan
  [206, 228],      // Lian Cacciatore
  [211, 220],      // Dietmar Hiddersen (gehörlos, Gieselwerder/Gottstreu)
  [110, 173, 202], // Maximilian Behmke / Fam. Benhke / Behmke (gleiche Tel.)
  [148, 166],      // Frau Perez, Lippoldsberg
];

/**
 * Adresse je Zeile: [strasse, plz, ort] und optional ein Memo-Zusatz für
 * Freitext, der in der Adressspalte stand. Jede Zeile mit Inhalt in Spalte H
 * MUSS hier stehen (sonst Abbruch), damit nichts ungeprüft übernommen wird.
 */
const ADRESSEN = {
  2: ['Tannenweg 5', '', 'Gierswalde'],
  4: ['Hans-A. Str.', '', ''],
  5: ['An der Beeke 3a', '', 'Adelebsen'],
  13: ['', '', 'Wiensen'],
  14: ['Kupferhammer 11', '', 'Uslar'],
  16: ['', '', 'Bodenfelde'],
  20: ['Burgstr. 12', '37139', 'Adelebsen'],
  22: null, 25: null, 26: null, 28: null, 38: null, 43: null, // eingestellt
  24: ['', '', 'Uslar'],
  27: ['', '', '', 'Adresse: gegenüber von der Großen Mauer'],
  30: ['Bromberger Str. 4', '', 'Uslar'],
  31: ['Bahnhofstr. 2a', '', ''],
  32: ['Auschnippe', '', ''],
  33: null,
  34: ['', '', 'Schoningen', 'Nachbarn von Falko Rohrig'],
  35: ['Schützenweg', '', ''],
  36: ['', '', 'Schönhagen', 'Mutter arbeitet bei der Stadt Uslar'],
  37: ['', '', 'Oedelsheim'],
  40: ['', '', 'Wahlsburg-Lippoldsberg'],
  41: ['Tannenweg 7', '', 'Lippoldsberg'],
  42: ['Galgenweg 15', '', 'Bollensen'],
  44: ['', '', 'Sohlingen'],
  45: ['', '', 'Bodenfelde'],
  46: ['', '', 'Oedelsheim'],
  47: ['', '', 'Adelebsen'],
  48: ['Burgstr. 8', '', 'Adelebsen'],
  49: ['', '', 'Bollensen'],
  50: ['', '', 'Uslar'],
  51: ['', '', 'Dinkelhausen'],
  53: ['Italstr. 1', '', 'Eschershausen'],
  54: ['Trift 5', '', 'Vernawahlshausen'],
  56: ['', '', 'Hardegsen'],
  59: ['', '', ''], // „???"
  60: ['', '', 'Gieselwerder'],
  61: ['', '', 'Uslar'],
  62: ['', '', 'Uslar'],
  63: ['', '', 'Dinkelhausen'],
  64: ['', '', 'Dinkelhausen'],
  65: ['', '', '', 'Adelebsen oder Wibbecke (Mutter, Fr. Frizorger möchte verteilen)'],
  66: ['Riethfeld 7', '', 'Heisebeck'],
  67: ['Saarstr. 12', '', 'Uslar'],
  68: ['Am Brückenberg 1', '', ''],
  69: ['Amselweg', '', '', 'Attis Sohn'],
  74: ['', '', 'Uslar'],
  75: ['', '', 'Hardegsen'],
  77: ['Am Rottland 10', '34399', 'Gieselwerder'],
  79: ['Stiftstr. 1', '', 'Uslar'],
  81: ['', '', '', 'Adresse lt. Liste: „Adrian"'],
  83: ['Kleines Feld', '', ''],
  84: ['Stettiner Str. 17', '', 'Bodenfelde', 'Bodenfelde (Blomeyer)'],
  85: ['', '', 'Uslar'],
  86: ['Sohnreystr. 55', '', 'Uslar'],
  87: ['Lange Str. 53', '', 'Uslar', 'Tel. Eltern: 015759229552'],
  88: ['', '', '', 'Kontakt über Hr. Wienecke, MTV Vernawahlshausen'],
  89: ['', '', '', 'Kontakt über Hr. Wienecke, MTV Vernawahlshausen'],
  90: ['Nelkenweg 16', '', 'Lippoldsberg'],
  91: ['', '', 'Hettensen'],
  92: ['', '', 'Uslar'],
  93: ['', '', 'Uslar'],
  95: ['Am Rothenberg 1', '', 'Uslar'],
  96: ['', '', 'Uslar'],
  99: ['', '', 'Adelebsen'],
  100: ['', '', 'Uslar', 'aus Einbeck hierher gezogen'],
  101: ['', '', 'Wiensen'],
  102: ['', '', '', 'Die Mutter hat angerufen'],
  103: ['', '', '', 'Die Mutter hat angerufen, Sohn will Geld verdienen'],
  104: ['', '', '', 'Der Vater hat sich gemeldet'],
  105: ['', '', '', 'Möchte in Lödingsen verteilen'],
  106: ['', '', '', 'Hallo Herr Kreike, (Herr Schefft hat ihn vorgeschlagen)'],
  107: ['', '', ''], // enthält nur die Mail-Adresse
  109: ['', '', 'Adelebsen'],
  111: ['', '', 'Adelebsen'],
  112: ['', '', '', 'Wohnort: Uslar/Sohlingen'],
  113: ['', '', 'Uslar'],
  114: ['', '', 'Schlarpe'],
  115: ['Hardegserstraße 8', '37170', 'Schlarpe'],
  116: ['Brückenstraße 38', '34399', 'Wesertal'], // aus Folgezeilen 117/118
  120: ['', '', '', 'Bollensen und umliegende Dörfer'],
  122: ['Baumeister-Schonlau-Straße 8a', '', 'Hardegsen'],
  128: ['', '', ''], // Folgezeile 126 wird als Memo übernommen
  131: ['Schwarzer Weg 7', '', ''],
  132: ['Lange Str. 29', '', 'Adelebsen'],
  133: ['Schwarzer Weg 5', '37181', 'Hardegsen', 'Kontakt: Susanne Hösel'],
  135: ['Stettiner Str. 11', '', ''],
  137: ['Ringstr. 4', '', ''],
  138: ['Burckhardstr. 12d', '', ''],
  139: ['Torstr. 19', '', ''],
  142: ['', '', 'Schönhagen'],
  145: ['', '', 'Lippoldsberg'],
  146: ['', '', 'Ellierode'],
  147: ['', '', 'Adelebsen'],
  148: ['', '', 'Lippoldsberg'],
  150: ['Amselweg 23', '37170', 'Uslar'],
  152: ['', '', ''], // „Geburtsdatum : 12.08.06" → siehe OVERRIDES
  157: ['', '', 'Wibbecke'],
  158: ['', '', ''], // enthält nur die Mail-Adresse
  164: ['Auf der Höhe 10', '37170', 'Uslar'],
  165: ['', '', ''], // „Sollingschule (Nadja)" steht bereits im Memo
  168: ['', '', 'Bollensen'],
  169: ['', '', 'Volpriehausen'],
  173: ['', '', 'Adelebsen'],
  174: ['', '', 'Eschershausen'],
  175: ['', '', 'Hardegsen'],
  176: ['', '', 'Hardegsen'],
  177: ['', '', 'Hardegsen', 'Hardegsen/Hettensen'],
  178: ['', '', 'Uslar', 'Adresse lt. Liste: „Uslar, Bella Clava"'],
  179: ['', '', 'Schoningen'],
  180: ['Bergstr. 8a', '', 'Adelebsen'],
  181: ['', '', '', 'wohnt beim Büdchen'],
  182: ['', '', ''], // „Frau Krist"
  184: ['Kupferhammer', '', 'Uslar'],
  186: ['Sohnreystr. 9', '37170', 'Uslar'],
  189: ['Bremhker Str. 9', '', ''],
  190: ['Schützenweg', '', ''],
  192: ['Pfingstanger 1', '', 'Kammerborn'],
  195: ['', '', 'Bodenfelde'],
  196: ['', '', 'Wiensen'],
  197: ['', '', 'Lippoldsberg'],
  198: ['', '', 'Lippoldsberg'],
  199: ['', '', 'Bodenfelde'],
  200: ['', '', '', 'Wohnort: Bodenfelde/Lippoldsberg'],
  201: ['Tulpenstr.', '', 'Uslar'],
  203: ['Sohlinger Stadtweg', '', ''],
  205: ['', '', 'Uslar'],
  206: ['', '', 'Adelebsen'],
  207: ['', '', 'Schoningen'],
  208: ['', '', 'Uslar'],
  209: ['', '', 'Uslar'],
  210: ['Poststr. 2', '37194', 'Bodenfelde', 'Wohnt ab Aug 25 in Uslar'],
  211: ['', '', 'Gieselwerder'],
  212: ['', '', 'Uslar'],
  216: ['Lange Str. 53', '', 'Uslar'], // stand in Spalte B
  222: ['', '', 'Uslar'],
  223: ['', '', 'Verliehausen'],
  224: ['', '', '', 'könnte in Gierswalde Vertretung übernehmen'],
  226: ['Kupferhammer 7a', '', ''],
  231: ['Ilse-Siedlung', '', ''],
  232: ['', '', 'Bodenfelde'],
  233: ['Schützenweg', '', 'Uslar'],
  234: ['Bachstr. 41', '', 'Schoningen'],
  235: ['', '', 'Erbsen'],
  236: ['Am Hasenbusch 7', '', 'Wibbecke'],
  237: ['Schulstr. 22', '', 'Lippoldsberg'],
  238: ['', '', 'Gewissenruh'],
};

/**
 * Feld-Korrekturen je Zeile. `telefon`/`email` ersetzen den geparsten Wert,
 * `memo` wird vorne angehängt, `orte` ersetzt die Orte aus Spalte B.
 * `telAlsMemo`: Inhalt der Tel.-Spalte ist eine Notiz, kein Telefon.
 */
const OVERRIDES = {
  15: { name: 'Laura-Marie Böttcher' },
  52: { telefon: '05572/9378-15 (Holger Förster)' },
  65: { orte: ['Adelebsen', 'Wibbecke'] },
  82: { telefon: '01516-7951804, 05506-9504866', datum: '2019-09-16' }, // in Liste „16.9.2024" zwischen 2019er Einträgen
  86: { telefon: '015901872838', alter: null }, // Telefon stand in der Alters-Spalte
  116: { telefon: '+49 163 1714550' },
  124: { telefon: '01522-8397080, 05573-7189891' },
  128: {
    telefon: '01573 3259012',
    alter: 13,
    memo: 'Guten Tag, ich wollte mal fragen ob es möglich wäre bei Ihnen mit 13 Jahren das Gelbe Blatt in Uslar/Allershausen Auszutragen würde es gerne als Nebenjob machen. (07.02.2022)',
  },
  133: { telefon: '01523 77 45 297 (Susanne Hösel)' },
  144: { telefon: '', email: 'wollertceliasophie@gmail.com' },
  145: {
    telefon: '01575-9787468 (Mutter), 0179-2546759 (Sohn)',
    alter: 13,
    memo: 'Mutter ruft f den Sohn an (sehr nett); keine Erfahrung bzgl Austragen',
  },
  150: { telefon: '0176 34445797', geburtsdatum: '2005-07-17' },
  151: { memo: 'Moritz Junge, 14 Jahre, Anruf durch Mutter', telefon: '0171 8376201', alter: 14, adresse: ['Adelebser Str. 4', '', 'Lödingsen'] },
  152: { geburtsdatum: '2006-08-12' },
  157: { orte: ['Adelebsen', 'Wibbecke'] },
  164: { geburtsdatum: '2009-05-31' },
  174: { datum: '2023-08-23' }, // in Liste „23.8.0202"
  180: { telefon: '0152-28912045' },
  185: { telefon: '0170-9693314, 05574-9454222' },
  186: {
    telefon: '0176/975 666 71',
    geburtsdatum: '2011-10-17',
    memo: 'Mutter: Heike Beskow, 0152/068 45 270, heikeBeskow@web.de',
  },
  193: { telefon: '01625701131', email: 'xd1312smiley420xd@gmail.com' },
  210: { telefon: '01708259875', alter: 14 },
  216: { orte: [], taetigkeiten: ['aushilfeProduktion'], geburtsdatum: '1961-04-13' }, // Spalte B enthielt die Adresse
  218: { telefon: '', email: 'samira.riedel2009@gmail.com', memo: null },
  225: { telefon: '01525 3025603 (Vater Steffen Degelau)', alter: 14 },
  234: { orte: ['Schoningen'] },
};

/**
 * Personen, die (unter abweichender Schreibweise) bereits als MA oder
 * Interessent in der App sind — bzw. deren Kind später eingestellt wurde.
 * Werden wie „eingestellt" übersprungen. Exakte Namenstreffer erkennt das
 * Skript selbst.
 */
const BEREITS_ERFASST = {
  'Werner, Erika (90258)': 'Werner Erika (90258)',
  'Juri Rühberg-Ilse': 'Rühberg Juri (90539)',
  'Carlotta Fischer-Stuwe': 'Stuwe Carlotta (90501)',
  'Mark-Alexander Ehrlich': 'Ehrlich Marc-Alexander (90538)',
  'Domenik Schwedtke': 'Schwedtke Dominic (90614)',
  'Frau Hösel für Walter Klingner (13)': 'Klingner Walter (90580)',
  'Mja Proczek': 'Proczek Maja (90632)',
  'Moni Volle': 'Volle Monika (90656)',
  'Huu Già Phuoc Nguyen': 'Huu Gia Phuoc Nguyen (90673)',
  'Corinna Dreher (Mutter von Finja)': 'Dreher Finja / Dreher Corinna (90562)',
  'Tommy Lowak': 'Lowak Tom (90518)',
  'Dönicke': 'Dönicke Aaron (90675)',
  'Fr.Knauf': 'Knauf Silke (90563)',
  'Herr Rach': 'Rach Lisa-Marie (90524, Tochter)',
  'Stadermann': 'Stadermann Mariano (90532, Sohn)',
  'Nico Kalluweit': 'Nico Kallweit (Interessent)',
  'Sohn Bergau': 'Sohn von Mirjam Bergau (Interessent)',
};

/** Zeilen, deren Tel.-Spalte eine Notiz statt einer Nummer enthält. */
const TEL_ALS_MEMO = new Set([151, 153, 157, 187, 188, 197, 220]);

/** Schreibweisen aus Spalte B vereinheitlichen. */
const ORT_ALIAS = {
  'lippo': 'Lippoldsberg',
  'uslar': 'Uslar',
  'adelebsenu.umgebung': 'Adelebsen',
};

// --- Helfer ---------------------------------------------------------------

const clean = (s) => String(s ?? '').replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/\n\s*\n/g, '\n').trim();

function excelDatumIso(serial) {
  const ms = Math.round((serial - 25569) * 86400000);
  return new Date(ms).toISOString().slice(0, 10);
}

function titleCase(name) {
  return name.split(' ').map((w) => {
    if (['und', 'von', 'für', 'al', 'el'].includes(w)) return w;
    return /^[a-zäöü]/.test(w) ? w[0].toUpperCase() + w.slice(1) : w;
  }).join(' ');
}

function normalisiereTelefon(roh) {
  return clean(roh)
    .replace(/^Tel:\s*/i, '')
    .replace(/\n/g, ', ')
    .split(/\s*,\s*|\s+oder\s+|\s{3,}/)
    .map((p) => {
      let t = p.replace(/^\((.*)\)$/, '$1').replace(/\.$/, '').trim();
      // Google Sheets hat bei reinen Ziffern die führende 0 entfernt.
      if (/^[1-9]\d{6,}$/.test(t)) t = '0' + t;
      return t;
    })
    .filter(Boolean)
    .join(', ');
}

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const findeEmails = (s) => [...new Set((String(s ?? '').match(EMAIL_RE) ?? []))];

function parseOrte(roh) {
  return clean(roh)
    .split(/[\/,;]|\bund\b|(?<=[a-z])u\./i)
    .map((p) => p.trim())
    .filter((p) => p && !/\d/.test(p) && !/^(OT|Umgebung)$/i.test(p))
    .map((p) => ORT_ALIAS[p.toLowerCase()] ?? (/^[a-zäöü]/.test(p) ? p[0].toUpperCase() + p.slice(1).toLowerCase() : p));
}

function parseAlter(cell) {
  if (!cell) return {};
  if (cell.t === 'n') {
    if (cell.v > 0 && cell.v < 100) return { alter: Math.round(cell.v) };
    if (cell.v > 10000 && cell.v < 60000) return { geburtsdatum: excelDatumIso(cell.v) };
    return {};
  }
  const m = String(cell.v).match(/(\d{1,2})/);
  return m ? { alter: parseInt(m[1], 10) } : {};
}

// --- Einlesen -------------------------------------------------------------

const wb = XLSX.readFile(xlsxPath);
const ws = wb.Sheets['Daten erfassen'];
const range = XLSX.utils.decode_range(ws['!ref']);
const zelle = (r, c) => ws[XLSX.utils.encode_cell({ r: r - 1, c: XLSX.utils.decode_col(c) })];
const text = (r, c) => {
  const z = zelle(r, c);
  if (!z) return '';
  return clean(z.t === 'n' ? String(z.v) : z.v);
};
const ja = (r, c) => text(r, c).toLowerCase() === 'ja';

const datensaetze = new Map(); // Excel-Zeile → Datensatz
const uebersprungen = [];
const fehler = [];

for (let r = 2; r <= range.e.r + 1; r++) {
  const belegt = 'ABCDEFGHIJKLMNOPQR'.split('').some((c) => text(r, c));
  if (!belegt || SKIP_ROWS.has(r)) continue;

  const kennung = text(r, 'Q').toLowerCase();
  if (kennung === 'eingestellt') {
    uebersprungen.push(`Zeile ${r}: ${text(r, 'A')} (eingestellt)`);
    continue;
  }

  const ov = OVERRIDES[r] ?? {};
  const memoTeile = [];
  if (ov.memo) memoTeile.push(ov.memo);

  // Name
  let name = ov.name ?? titleCase(clean(text(r, 'A')).replace(/\n/g, ' '));
  if (!name || name.toLowerCase() === 'unbekannt') name = 'unbekannt';

  // Orte + Tätigkeiten
  const orte = ov.orte ?? parseOrte(text(r, 'B'));
  const taetigkeiten = new Set();
  if (text(r, 'B') || ja(r, 'D')) taetigkeiten.add('austragen');
  if (ja(r, 'C')) taetigkeiten.add('zusammentragen');
  if (ja(r, 'E')) taetigkeiten.add('aushilfeProduktion');
  if (ov.taetigkeiten) { taetigkeiten.clear(); ov.taetigkeiten.forEach((t) => taetigkeiten.add(t)); }
  if (ja(r, 'D')) memoTeile.push('Interesse als Springer');

  // Datum
  let datum = ov.datum;
  if (datum === undefined) {
    const z = zelle(r, 'F');
    if (z?.t === 'n' && z.v >= 1) datum = excelDatumIso(z.v);
    // Reine Uhrzeiten (Zellwert < 1) sind Eingabefehler ohne Datum → verwerfen.
    else if (z && z.t !== 'n') memoTeile.push(`Datum lt. Liste: ${clean(z.w ?? z.v)}`);
  }

  // Adresse
  let adresse = { strasse: '', plz: '', ort: '' };
  const hRoh = text(r, 'H');
  const adr = ov.adresse ?? ADRESSEN[r];
  if (hRoh && adr === undefined) fehler.push(`Zeile ${r}: Adresse „${hRoh}" nicht in ADRESSEN zugeordnet`);
  if (adr) {
    adresse = { strasse: adr[0], plz: adr[1], ort: adr[2] };
    if (adr[3]) memoTeile.push(adr[3]);
  }

  // Alter / Geburtsdatum
  let { alter, geburtsdatum } = parseAlter(zelle(r, 'I'));
  if ('alter' in ov) alter = ov.alter ?? undefined;
  if (ov.geburtsdatum) { geburtsdatum = ov.geburtsdatum; alter = undefined; }

  // Telefon
  let telefon;
  const jRoh = text(r, 'J');
  if (TEL_ALS_MEMO.has(r)) {
    if (jRoh) memoTeile.push(jRoh.replace(/\n/g, '; '));
    telefon = '';
  } else {
    telefon = normalisiereTelefon(jRoh);
  }
  if (ov.telefon !== undefined) telefon = ov.telefon;

  // E-Mail (Spalte K; sonst Adresse/Tel./Memo durchsuchen)
  const kRoh = text(r, 'K');
  let email = ov.email ?? findeEmails(kRoh)[0] ?? '';
  const kRest = kRoh.replace(EMAIL_RE, '').replace(/<mailto:>|[<>,]/g, '').trim();
  if (kRest && kRest !== 'WA' && ov.email === undefined) {
    if (/^[\d\s\/-]+$/.test(kRest) && !telefon) telefon = normalisiereTelefon(kRest);
    else if (!/mobil\/WA/i.test(kRest)) memoTeile.push(kRest);
  }
  if (!email) email = findeEmails(`${hRoh} ${jRoh} ${text(r, 'R')}`)[0] ?? '';

  // Korrespondenz-Link (Hyperlink-Ziel bevorzugt, z. B. hinter „mail")
  const lz = zelle(r, 'L');
  let link = lz?.l?.Target ?? (/^https?:/.test(text(r, 'L')) ? text(r, 'L') : '');
  link = link.replace(/&amp;/g, '&');

  // Memo
  const rMemo = ov.memo === null ? '' : text(r, 'R');
  if (rMemo) memoTeile.push(rMemo);
  const erfahrung = text(r, 'O').toLowerCase();
  if (erfahrung === 'ja' || erfahrung === 'nein') memoTeile.push(`Erfahrung Austragen: ${erfahrung}`);

  datensaetze.set(r, {
    zeile: r,
    name,
    orte,
    taetigkeiten,
    datum,
    adresse,
    alter,
    geburtsdatum,
    telefon,
    email,
    links: link ? [link] : [],
    auto: ja(r, 'P'),
    deinteressiert: kennung.includes('kein interesse'),
    memo: memoTeile,
  });
}

// --- Dubletten zusammenführen ---------------------------------------------

for (const [basis, ...rest] of MERGE_GROUPS) {
  const b = datensaetze.get(basis);
  if (!b) { fehler.push(`Merge-Basis Zeile ${basis} fehlt`); continue; }
  b.zusammengefuehrt = rest;
  for (const r of rest) {
    const d = datensaetze.get(r);
    if (!d) { fehler.push(`Merge-Zeile ${r} fehlt`); continue; }
    for (const o of d.orte) if (!b.orte.some((x) => x.toLowerCase() === o.toLowerCase())) b.orte.push(o);
    for (const t of d.taetigkeiten) b.taetigkeiten.add(t);
    if (d.datum && (!b.datum || d.datum < b.datum)) b.datum = d.datum;
    for (const k of ['strasse', 'plz', 'ort']) if (!b.adresse[k] && d.adresse[k]) b.adresse[k] = d.adresse[k];
    if (b.alter == null && !b.geburtsdatum) { b.alter = d.alter; b.geburtsdatum = d.geburtsdatum; }
    // Gleiche Nummer in anderer Schreibweise nur einmal übernehmen.
    const telKey = (t) => t.replace(/\D/g, '').replace(/^49(?=1)/, '0');
    const tels = new Map();
    for (const t of [...b.telefon.split(', '), ...d.telefon.split(', ')].filter(Boolean)) {
      if (!tels.has(telKey(t))) tels.set(telKey(t), t);
    }
    b.telefon = [...tels.values()].join(', ');
    if (!b.email) b.email = d.email;
    for (const l of d.links) if (!b.links.includes(l)) b.links.push(l);
    b.auto ||= d.auto;
    for (const m of d.memo) if (!b.memo.includes(m)) b.memo.push(m);
    datensaetze.delete(r);
  }
}

// --- In Mitarbeiter-Dokumente umwandeln -----------------------------------

const importe = [...datensaetze.values()].map((d) => {
  const memo = [...d.memo];
  if (d.links.length > 1) memo.push(`Weitere Korrespondenz: ${d.links.slice(1).join(' , ')}`);
  const payload = {
    nummer: '',
    name: d.name,
    adresse: d.adresse,
    telefon: d.telefon,
    email: d.email || undefined,
    geburtsdatum: d.geburtsdatum ?? '',
    rollen: [],
    hatFestgehalt: false,
    istMinijob: false,
    sozialversicherungsBefreit: false,
    nochNichtAngemeldet: false,
    abgemeldet: false,
    isActive: true,
    istInteressent: true,
    interessentDeinteressiert: d.deinteressiert,
    interesseTaetigkeiten: [...d.taetigkeiten],
    autoVorhanden: d.auto,
    interessentOrte: d.orte.length ? d.orte : undefined,
    interessentKontaktDatum: d.datum || undefined,
    interessentKorrespondenzLink: d.links[0] || undefined,
    interessentMemo: memo.length ? memo.join('\n') : undefined,
    interessentAlterBeiErfassung: d.geburtsdatum ? undefined : d.alter,
    teilgebietFreigaben: [],
    abweichendeLieferadresseAktiv: false,
    abweichendeLieferadresse: { strasse: '', plz: '', ort: '', telefon: '', memo: '' },
  };
  return { zeile: d.zeile, zusammengefuehrt: d.zusammengefuehrt, payload };
});

if (fehler.length) {
  console.error('FEHLER:\n  ' + fehler.join('\n  '));
  process.exit(1);
}

// --- Abgleich mit bestehenden Mitarbeitern ---------------------------------

const app = initializeApp({
  apiKey: process.env.VITE_FIREBASE_API_KEY,
  authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.VITE_FIREBASE_APP_ID,
});
const db = getFirestore(app);
const snap = await getDocs(collection(db, 'mitarbeiter'));
const bestand = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

// Namensschlüssel: Wörter sortiert, damit „Wurm, Volker" == „Volker Wurm".
const nameKey = (n) => String(n ?? '').toLowerCase().replace(/[(),.]/g, ' ').split(/\s+/).filter(Boolean).sort().join(' ');
const bestandByKey = new Map();
for (const m of bestand) {
  const k = nameKey(m.name);
  if (!bestandByKey.has(k)) bestandByKey.set(k, []);
  bestandByKey.get(k).push(m);
}

// Bereits in der App (als Interessent oder MA) → nicht erneut anlegen.
const neu = [];
const schonVorhanden = [];
for (const imp of importe) {
  const treffer = imp.payload.name === 'unbekannt' ? [] : (bestandByKey.get(nameKey(imp.payload.name)) ?? []);
  if (treffer.length) {
    schonVorhanden.push(`${imp.payload.name} ↔ ${treffer.map((m) => `${m.name.trim()} (${m.istInteressent ? 'Interessent' : m.nummer})`).join('; ')}`);
  } else if (BEREITS_ERFASST[imp.payload.name]) {
    schonVorhanden.push(`${imp.payload.name} ↔ ${BEREITS_ERFASST[imp.payload.name]}`);
  } else {
    neu.push(imp);
  }
}

// --- Ausgabe ----------------------------------------------------------------

const TL = { austragen: 'Austr', zusammentragen: 'Zus', aushilfeProduktion: 'Prod' };
for (const { zeile, zusammengefuehrt, payload: p } of neu) {
  const adr = [p.adresse.strasse, [p.adresse.plz, p.adresse.ort].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  const alter = p.geburtsdatum ? `geb ${p.geburtsdatum}` : p.interessentAlterBeiErfassung ? `${p.interessentAlterBeiErfassung} J` : '';
  console.log(
    `Z${String(zeile).padStart(3)}${zusammengefuehrt ? '+' + zusammengefuehrt.join('+') : ''}`.padEnd(14),
    p.name.padEnd(32).slice(0, 32),
    (p.interessentKontaktDatum ?? '').padEnd(10),
    `[${(p.interessentOrte ?? []).join(', ')}]`,
    `{${p.interesseTaetigkeiten.map((t) => TL[t]).join(',')}}`,
    adr ? `ADR: ${adr}` : '',
    alter,
    p.telefon ? `TEL: ${p.telefon}` : '',
    p.email ? `MAIL: ${p.email}` : '',
    p.interessentKorrespondenzLink ? 'LINK' : '',
    p.autoVorhanden ? 'AUTO' : '',
    p.interessentDeinteressiert ? 'DEINTERESSIERT' : '',
  );
  if (p.interessentMemo) console.log('               memo: ' + p.interessentMemo.replace(/\n/g, ' ⏎ '));
}

console.log(`\nZeilen übersprungen (eingestellt): ${uebersprungen.length}`);
uebersprungen.forEach((s) => console.log('  ' + s));
console.log(`Datensätze gesamt: ${importe.length}`);
console.log(`Bereits in der App als MA/Interessent (werden übersprungen): ${schonVorhanden.length}`);
schonVorhanden.forEach((s) => console.log('  ' + s));
console.log(`Neu anzulegen: ${neu.length}`);

if (jsonOut) writeFileSync(jsonOut, JSON.stringify(neu.map((i) => i.payload), null, 2));

if (!apply) {
  console.log('\nDry-Run — nichts geschrieben. Mit --apply ausführen, um zu importieren.');
  process.exit(0);
}

const stripUndef = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
const ts = Date.now();
for (let i = 0; i < neu.length; i += 400) {
  const batch = writeBatch(db);
  for (const { payload } of neu.slice(i, i + 400)) {
    batch.set(doc(collection(db, 'mitarbeiter')), { ...stripUndef(payload), erstelltAm: ts, aktualisiertAm: ts });
  }
  await batch.commit();
}
console.log(`\n✔ ${neu.length} Interessenten angelegt.`);
process.exit(0);
