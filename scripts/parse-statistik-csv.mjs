// Einmaliges Hilfsskript: parst tmp_seiten.csv (CSV-Export des Seitenzahl-
// Blatts der Online-Datei) und schreibt scripts/statistik-seiten.json im
// Format { kwBezeichnungen, jahre: { [jahr]: { [kw]: wert } } }.
//
// Aufruf: node scripts/parse-statistik-csv.mjs <csv-datei>   (Default: tmp_seiten.csv)

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, isAbsolute } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const arg = process.argv[2] ?? 'scripts/statistik-seiten-raw.csv';
const csvPath = isAbsolute(arg) ? arg : join(root, arg);

/** Minimaler CSV-Parser (RFC4180: Anführungszeichen + doppelte "" als Escape). */
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQ = false;
      } else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\r') { /* skip */ }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function num(v) {
  if (v == null) return null;
  const t = String(v).trim().replace(',', '.');
  if (t === '' || t === '-') return null;
  const n = Number(t);
  return Number.isNaN(n) ? null : n;
}

const rows = parseCsv(readFileSync(csvPath, 'utf8'));
const header = rows[0];
// Spalten: 0=Bezeichnung, 1=KW, 2=Ges.Ø, 3=4a-Ø, 4=dummy, 5+=Jahre
const jahrSpalten = {};
header.forEach((c, j) => {
  const s = String(c).trim();
  if (/^(19|20)\d{2}$/.test(s)) jahrSpalten[j] = Number(s);
});

const kwBezeichnungen = {};
const jahre = {};
for (let i = 1; i < rows.length; i++) {
  const r = rows[i];
  const kw = num(r[1]);
  if (kw == null || !Number.isInteger(kw) || kw < 1 || kw > 53) continue; // Fußzeilen überspringen
  const bez = String(r[0] ?? '').trim();
  if (bez) kwBezeichnungen[kw] = bez;
  for (const [colStr, jahr] of Object.entries(jahrSpalten)) {
    const wert = num(r[Number(colStr)]);
    if (wert == null) continue;
    (jahre[jahr] ??= {})[kw] = wert;
  }
}

writeFileSync(join(__dirname, 'statistik-seiten.json'), JSON.stringify({ kwBezeichnungen, jahre }, null, 2));
const js = Object.keys(jahre).sort((a, b) => b - a);
console.log('Jahre:', js.join(', '));
console.log('Bezeichnungen:', Object.keys(kwBezeichnungen).length);
console.log('Stichprobe KW1:', JSON.stringify(Object.fromEntries(js.map((j) => [j, jahre[j][1]]).filter(([, v]) => v != null))));
console.log('Stichprobe 2024:', JSON.stringify(jahre['2024']));
