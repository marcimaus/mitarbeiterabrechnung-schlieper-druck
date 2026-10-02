/**
 * Import Steuer-ID + Sozialversicherungs-Nummer aus der Lohnbüro-PDF
 * "Mai_2026 oP.pdf" in die Mitarbeiter-Collection.
 *
 * Aufruf:
 *   node scripts/import-steuerid-svnummer.mjs            # Dry-Run
 *   node scripts/import-steuerid-svnummer.mjs --apply    # tatsächlich schreiben
 *   node scripts/import-steuerid-svnummer.mjs --apply --overwrite
 *     # ↑ überschreibt auch bereits gesetzte Werte (Lohnbüro = Wahrheitsquelle)
 *
 * Regeln (ohne --overwrite):
 *   - Werte werden nur gesetzt, wenn das Feld in der App leer ist.
 *   - Wenn Wert bereits gesetzt ist und vom PDF abweicht → Warnung.
 */

import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, writeBatch, doc } from 'firebase/firestore';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { config as dotenvConfig } from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..');
dotenvConfig({ path: join(projectRoot, '.env') });

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const overwrite = args.includes('--overwrite');

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

// Aus PDF "Mai_2026 oP.pdf" extrahiert. nr = Pers.-Nr. wie in App.
// svNummer leer = im PDF nicht gedruckt (zur Bestätigung anstehend).
const DATEN = [
  { nr: '1',    name: 'Petro Alieksieiev',          sv: '50100107A057', stId: '97010054263' },
  { nr: '2',    name: 'Saada Al Hammadeh',          sv: '48010107H542', stId: '21130564983' },
  { nr: '3',    name: 'Hasso Sarhan Hussein',       sv: '',             stId: '14480693758' },
  { nr: '12',   name: 'Nejmeh Ramadan',             sv: '10050969R556', stId: '54249731604' },
  { nr: '26',   name: 'Mirko Becker',               sv: '10220883B030', stId: '63724689109' },
  { nr: '33',   name: 'Jonas Carnabucci',           sv: '',             stId: '87521690233' },
  { nr: '34',   name: 'Gilbert Cristea',            sv: '10300364G094', stId: '63867549017' },
  { nr: '38',   name: 'Claas Kreike',               sv: '50121109K048', stId: '48990321672' },
  { nr: '39',   name: 'Emely Kettler',              sv: '50201109K506', stId: '78110356928' },
  { nr: '41',   name: 'Karess Monzer',              sv: '10170809M583', stId: '31076921857' },
  { nr: '42',   name: 'Lian Cacciatore',            sv: '',             stId: '87012632546' },
  { nr: '60',   name: 'Jacqueline Freyer',          sv: '49240265E509', stId: '95358742062' },
  { nr: '61',   name: 'Tjerk Fraedrich',            sv: '50270711F032', stId: '58936230476' },
  { nr: '71',   name: 'Leo Grabowsky',              sv: '10261108G024', stId: '76503112981' },
  { nr: '72',   name: 'Jan Grundmann',              sv: '10130373G031', stId: '75138204957' },
  { nr: '73',   name: 'Fritz Gobrecht',             sv: '10040860G024', stId: '83786520193' },
  { nr: '88',   name: 'Elfriede Zufuß',             sv: '53120262H569', stId: '96156073844' },
  { nr: '100',  name: 'Christina Johanning',        sv: '10300875J509', stId: '41859068375' },
  { nr: '113',  name: 'Uwe Kreike',                 sv: '10300968K012', stId: '43238756198' },
  { nr: '114',  name: 'Tobias Kopp',                sv: '10150576K044', stId: '48135879029' },
  { nr: '115',  name: 'Sebastian Kirchner',         sv: '12300683K009', stId: '80427361152' },
  { nr: '127',  name: 'Holger Leßner',              sv: '50090364L004', stId: '48287630150' },
  { nr: '129',  name: 'Kerstin Lohmann',            sv: '50170162H506', stId: '43238750191' },
  { nr: '131',  name: 'Amila Mousa',                sv: '10081012M547', stId: '58493732060' },
  { nr: '168',  name: 'Margit Piszczek',            sv: '50100349M543', stId: '86194657201' },
  { nr: '169',  name: 'Huu Gia Phuoc Nguyen',       sv: '50260409N007', stId: '69583140321' },
  { nr: '171',  name: 'Hassan Noureddine',          sv: '10211010N028', stId: '47278693506' },
  { nr: '183',  name: 'Ute Sauermann',              sv: '50301158H547', stId: '89297514030' },
  { nr: '185',  name: 'Gabriele Rothenberg',        sv: '50050663P509', stId: '96245683179' },
  { nr: '206',  name: 'Andrea Scherbarth',          sv: '50121059W543', stId: '63724691050' },
  { nr: '207',  name: 'Marc Schlieper',             sv: '10300775S028', stId: '61742057980' },
  { nr: '218',  name: 'Siemone Schönitz',           sv: '50281067S519', stId: '86267591408' },
  { nr: '219',  name: 'Sonea Shirin Schmidt',       sv: '10261011S603', stId: '58130492461' },
  { nr: '220',  name: 'Lea Sophie Schönitz',        sv: '10120103J513', stId: '70529847631' },
  { nr: '236',  name: 'Beatrix Werner',             sv: '12240564K551', stId: '90214739850' },
  { nr: '264',  name: 'Jannis Schulze',             sv: '10011108S060', stId: '81646723590' },
  { nr: '265',  name: 'Jonas Finley Schneider',     sv: '50030611S041', stId: '48075193362' },
  { nr: '266',  name: 'Nadja Stolze',               sv: '10010386H513', stId: '47925510633' },
  { nr: '267',  name: 'Jessica Swars',              sv: '43080282S520', stId: '95248317561' },
  { nr: '1002', name: 'Neal Anacker',               sv: '81010606A017', stId: '40397862583' },
  { nr: '1106', name: 'Melanie Breidenbach',        sv: '10170473J507', stId: '54136487906' },
  { nr: '1109', name: 'Johanna Bönig',              sv: '50010105B527', stId: '86267534196' },
  { nr: '1310', name: 'Aaron Dönicke',              sv: '10010210D027', stId: '89231456022' },
  { nr: '1311', name: 'Inja Marie Dittrich',        sv: '10031010D580', stId: '78965924106' },
  { nr: '1312', name: 'Damon Degelau',              sv: '10300311D019', stId: '78410536277' },
  { nr: '1400', name: 'Franziska Engelke',          sv: '12020489E501', stId: '60432528171' },
  { nr: '1405', name: 'Luca Ewert',                 sv: '50010102E004', stId: '88245063974' },
  { nr: '1407', name: 'Manfred Eickmeier',          sv: '12160148E012', stId: '65258710948' },
  { nr: '1408', name: 'Jan Ehrlich',                sv: '50180108E023', stId: '75240381896' },
  { nr: '1409', name: 'Tom Exner',                  sv: '50240110E027', stId: '48131590274' },
  { nr: '1508', name: 'Monika Filthuth',            sv: '50221053P506', stId: '46135680298' },
  { nr: '1601', name: 'Jörg Gottlewski',            sv: '80030260G005', stId: '71318695408' },
  { nr: '1602', name: 'Amy Jolie Gobrecht',         sv: '50061211S553', stId: '87943065252' },
  { nr: '1704', name: 'Mario Henne',                sv: '10030768H082', stId: '54702635188' },
  { nr: '1706', name: 'Adelheid Hawranke',          sv: '50111263O501', stId: '89297640154' },
  { nr: '1709', name: 'Lara Henne',                 sv: '52041273H512', stId: '48703628950' },
  { nr: '1710', name: 'Horst Herrfurth',            sv: '13011263H116', stId: '63239740152' },
  { nr: '1717', name: 'Dana Alicia Hildebrand-Mascher', sv: '50190707H549', stId: '57308960127' },
  { nr: '1718', name: 'Alina Justine Hillebrecht',  sv: '50181208S539', stId: '86521431072' },
  { nr: '1722', name: 'Manuela-Maria Haase',        sv: '12071010H544', stId: '58011376420' },
  { nr: '1723', name: 'Rama Hneady',                sv: '50070197H549', stId: '70864952884' },
  { nr: '1724', name: 'Dietmar Hiddersen',          sv: '12220463H007', stId: '50928311767' },
  { nr: '1725', name: 'Jennifer Herrmann-Papsdorf', sv: '53260384H526', stId: '84539471061' },
  { nr: '1726', name: 'Ahmed El Hariri',            sv: '68130409E007', stId: '31174295602' },
  { nr: '1901', name: 'Nijar Jasharova',            sv: '52230170M527', stId: '58642439172' },
  { nr: '1904', name: 'Judith Jakobi',              sv: '10070180B501', stId: '57147039629' },
  { nr: '1907', name: 'Moritz Junge',               sv: '50210308J003', stId: '46283015999' },
  { nr: '2004', name: 'Silvia Käppel',              sv: '50210860K505', stId: '48017356821' },
  { nr: '2005', name: 'Maurice Kämmerer',           sv: '10260110K050', stId: '73749285603' },
  { nr: '2012', name: 'Linus Kreike',               sv: '10200608K081', stId: '76452098105' },
  { nr: '2015', name: 'Philipp Kokars',             sv: '50291185K007', stId: '78134865295' },
  { nr: '2016', name: 'Paul Knorr',                 sv: '50110206K021', stId: '83697480152' },
  { nr: '2103', name: 'Jasmin Lange',               sv: '12201205L541', stId: '60318952492' },
  { nr: '2105', name: 'Josephine Lohmann',          sv: '50140707L515', stId: '57318241062' },
  { nr: '2106', name: 'Amy Lorberg',                sv: '10230608L523', stId: '87169432851' },
  { nr: '2112', name: 'Malila Latifi',              sv: '52100907L506', stId: '46721593889' },
  { nr: '2201', name: 'Gabi Nolte',                 sv: '50020971N504', stId: '74935486023' },
  { nr: '2203', name: 'Monique Mousa',              sv: '43200575P509', stId: '82327941503' },
  { nr: '2205', name: 'Friedrich Paulmann',         sv: '50290361P021', stId: '63728196453' },
  { nr: '2207', name: 'Charlotte Mooslehner',       sv: '10100708M538', stId: '97582063423' },
  { nr: '2208', name: 'Olga Maier',                 sv: '52070882A522', stId: '80354175920' },
  { nr: '2209', name: 'Petra Mitrovic',             sv: '10090910M542', stId: '14593207169' },
  { nr: '2608', name: 'Lia Rothensee',              sv: '50071107R505', stId: '59240331688' },
  { nr: '2613', name: 'Robin Rode',                 sv: '50171108R030', stId: '50739866425' },
  { nr: '2614', name: 'Kira Johann Perez',          sv: '52240909J500', stId: '97865345127' },
  { nr: '2804', name: 'Marvin Sommer',              sv: '10120210S099', stId: '48231095276' },
  { nr: '3207', name: 'Silvia Groß',                sv: '50210880R517', stId: '65139408256' },
  { nr: '3210', name: 'Pierre Brinke',              sv: '43110697B013', stId: '71362582947' },
  { nr: '3211', name: 'Ute Schönitz',               sv: '50180548R509', stId: '89297510342' },
  { nr: '3213', name: 'Dominik Stolze',             sv: '50030292S045', stId: '77308654128' },
];

function normSt(s) {
  if (!s) return null;
  const t = String(s).replace(/\s+/g, '');
  return /^\d{11}$/.test(t) ? t : null;
}

function normSv(s) {
  if (!s) return null;
  const t = String(s).replace(/\s+/g, '').toUpperCase();
  // 12 Zeichen: 2 Ziffern Bereichsnr + 6 Ziffern Geb.-Datum + 1 Buchstabe + 3 Ziffern
  return /^\d{8}[A-Z]\d{3}$/.test(t) ? t : null;
}

// Namen-Tokens normalisieren: Kleinbuchstaben, Umlaute auflösen, Stopwords raus.
const STOPWORDS = new Set(['geb', 'gen', 'verh', 'von', 'de', 'der', 'van', 'el', 'al']);
function tokens(name) {
  if (!name) return [];
  return name
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/[.,\-]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

function findeMA(maList, pdfName) {
  const pdfTok = new Set(tokens(pdfName));
  if (pdfTok.size === 0) return null;
  // 1. exakter Token-Set-Match (Reihenfolge egal)
  const exakt = maList.filter((m) => {
    const t = new Set(tokens(m.name));
    if (t.size !== pdfTok.size) return false;
    for (const x of pdfTok) if (!t.has(x)) return false;
    return true;
  });
  if (exakt.length === 1) return { ma: exakt[0], grund: 'exakt' };
  if (exakt.length > 1) return { ma: null, grund: 'mehrdeutig-exakt', kandidaten: exakt };

  // 2. Subset-Match: alle PDF-Tokens ⊆ MA-Tokens
  const sub = maList.filter((m) => {
    const t = new Set(tokens(m.name));
    for (const x of pdfTok) if (!t.has(x)) return false;
    return true;
  });
  if (sub.length === 1) return { ma: sub[0], grund: 'subset' };
  if (sub.length > 1) return { ma: null, grund: 'mehrdeutig-subset', kandidaten: sub };

  // 3. Reverse-Subset: alle MA-Tokens ⊆ PDF-Tokens
  const rsub = maList.filter((m) => {
    const t = tokens(m.name);
    if (t.length === 0) return false;
    for (const x of t) if (!pdfTok.has(x)) return false;
    return true;
  });
  if (rsub.length === 1) return { ma: rsub[0], grund: 'reverse-subset' };
  if (rsub.length > 1) return { ma: null, grund: 'mehrdeutig-reverse', kandidaten: rsub };

  return null;
}

async function main() {
  console.log(`PDF-Datensätze:       ${DATEN.length}`);
  console.log(`Modus:                ${apply ? 'APPLY' : 'Dry-Run'}${overwrite ? ' + OVERWRITE' : ''}`);

  console.log('\nLade Mitarbeiter aus Firestore…');
  const snap = await getDocs(collection(db, 'mitarbeiter'));
  const maList = [];
  for (const d of snap.docs) {
    const data = d.data();
    if (data.name) maList.push({ id: d.id, ...data });
  }
  console.log(`Mitarbeiter geladen:  ${maList.length}`);

  let setSt = 0, setSv = 0;
  let skipBereitsGesetzt = 0;
  let abweichungSt = 0, abweichungSv = 0;
  let formatFehler = 0;
  const updates = [];
  const fehlend = [];
  const mehrdeutig = [];
  const konflikte = [];

  for (const row of DATEN) {
    const match = findeMA(maList, row.name);
    if (!match || !match.ma) {
      if (match && match.kandidaten) {
        mehrdeutig.push(`${row.nr} ${row.name} → ${match.grund}: ${match.kandidaten.map((k) => k.name).join(' | ')}`);
      } else {
        fehlend.push(`${row.nr} ${row.name}`);
      }
      continue;
    }
    const ma = match.ma;
    const stId = normSt(row.stId);
    const svNr = normSv(row.sv);
    if (row.stId && !stId) { formatFehler++; console.warn(`  Format-Fehler Steuer-ID Nr ${row.nr}: "${row.stId}"`); }
    if (row.sv && !svNr) { formatFehler++; console.warn(`  Format-Fehler SV-Nr Nr ${row.nr}: "${row.sv}"`); }

    const change = {};
    // Steuer-ID
    if (stId) {
      const aktuell = (ma.steuerId || '').replace(/\s+/g, '');
      if (!aktuell) {
        change.steuerId = stId;
        setSt++;
      } else if (aktuell !== stId) {
        abweichungSt++;
        konflikte.push(`Nr ${row.nr} ${ma.name}: Steuer-ID App="${aktuell}" PDF="${stId}"`);
        if (overwrite) change.steuerId = stId;
      } else {
        skipBereitsGesetzt++;
      }
    }
    // SV-Nummer
    if (svNr) {
      const aktuell = (ma.sozialversicherungsNummer || '').replace(/\s+/g, '').toUpperCase();
      if (!aktuell) {
        change.sozialversicherungsNummer = svNr;
        setSv++;
      } else if (aktuell !== svNr) {
        abweichungSv++;
        konflikte.push(`Nr ${row.nr} ${ma.name}: SV-Nr App="${aktuell}" PDF="${svNr}"`);
        if (overwrite) change.sozialversicherungsNummer = svNr;
      } else {
        skipBereitsGesetzt++;
      }
    }
    if (Object.keys(change).length > 0) {
      updates.push({ id: ma.id, nr: row.nr, name: ma.name, pdfName: row.name, grund: match.grund, change });
    }
  }

  console.log('\n--- Ergebnis ---');
  console.log(`Steuer-ID neu gesetzt:        ${setSt}`);
  console.log(`SV-Nummer neu gesetzt:        ${setSv}`);
  console.log(`Werte bereits identisch:      ${skipBereitsGesetzt}`);
  console.log(`Konflikt Steuer-ID (≠ App):   ${abweichungSt}`);
  console.log(`Konflikt SV-Nr (≠ App):       ${abweichungSv}`);
  console.log(`Format-Fehler:                ${formatFehler}`);
  console.log(`Nicht in App gefunden:        ${fehlend.length}`);
  console.log(`Mehrdeutig:                   ${mehrdeutig.length}`);
  console.log(`Update-Datensätze:            ${updates.length}`);

  if (konflikte.length) {
    console.log('\n--- Konflikte (App ≠ PDF) ---');
    konflikte.forEach((k) => console.log('  ' + k));
    if (!overwrite) console.log('  → Werden NICHT überschrieben. Mit --overwrite erzwingen.');
  }
  if (mehrdeutig.length) {
    console.log('\n--- Mehrdeutige Treffer (übersprungen) ---');
    mehrdeutig.forEach((m) => console.log('  ' + m));
  }
  if (fehlend.length) {
    console.log('\n--- Nicht in App gefunden ---');
    fehlend.forEach((f) => console.log('  ' + f));
  }

  console.log('\n--- Updates (alle) ---');
  updates.forEach((u) => {
    console.log(`  ${u.nr} [${u.grund}] ${u.pdfName} → ${u.name}: ${JSON.stringify(u.change)}`);
  });

  if (!apply) {
    console.log('\nDry-Run — es wurde nichts geschrieben. Zum Schreiben: --apply');
    process.exit(0);
  }

  console.log('\nSchreibe Änderungen…');
  const now = Date.now();
  let batch = writeBatch(db);
  let n = 0;
  let total = 0;
  for (const u of updates) {
    const ref = doc(collection(db, 'mitarbeiter'), u.id);
    batch.set(ref, { ...u.change, aktualisiertAm: now }, { merge: true });
    n++;
    total++;
    if (n >= 400) {
      await batch.commit();
      console.log(`  Batch committed (${total} bisher)`);
      batch = writeBatch(db);
      n = 0;
    }
  }
  if (n > 0) await batch.commit();

  console.log(`\nFertig — ${total} Mitarbeiter aktualisiert.`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
