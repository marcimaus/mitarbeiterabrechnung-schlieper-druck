/**
 * Parst eine CSV-Datei (aus base64-Download der Drive API) und schreibt
 * die Arbeitszeiten als JSON.
 *
 * Aufruf: node scripts/parse-csv-arbeitszeiten.mjs <base64-Datei> <Output-JSON>
 */
import { readFileSync, writeFileSync } from 'node:fs';

const [, , inputPath, outputPath] = process.argv;
if (!inputPath || !outputPath) {
  console.error('Aufruf: node parse-csv-arbeitszeiten.mjs <base64-Datei> <Output-JSON>');
  process.exit(1);
}

const raw = readFileSync(inputPath, 'utf8');
const json = JSON.parse(raw);
const csv = Buffer.from(json.content, 'base64').toString('utf8');

// Einfacher CSV-Parser mit Quote-Handling (für unsere Tabelle ausreichend)
function parseCSV(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuote = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuote) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') { inQuote = false; }
      else { cell += c; }
    } else {
      if (c === '"') inQuote = true;
      else if (c === ',') { row.push(cell); cell = ''; }
      else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
      else if (c === '\r') { /* skip */ }
      else { cell += c; }
    }
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

const rows = parseCSV(csv);
console.log(`CSV-Zeilen: ${rows.length}`);

const entries = [];
for (const row of rows) {
  if (row.length < 4) continue;
  const datumRaw = row[0];           // "Mo., 13.01.2020" (mit eingebettetem \n im Header — wir prüfen Pattern)
  const von = row[1];
  const bis = row[2];
  const pauseStr = row[3];

  const datumMatch = datumRaw.match(/(\d{2})\.(\d{2})\.(\d{4})/);
  const vonMatch = (von ?? '').match(/^(\d{2}):(\d{2})$/);
  const bisMatch = (bis ?? '').match(/^(\d{2}):(\d{2})$/);
  if (!datumMatch || !vonMatch || !bisMatch) continue;

  const datum = `${datumMatch[3]}-${datumMatch[2]}-${datumMatch[1]}`;
  let pauseMin = 0;
  const pauseMatch = (pauseStr ?? '').match(/^(\d{1,2}):(\d{2})$/);
  if (pauseMatch) pauseMin = parseInt(pauseMatch[1]) * 60 + parseInt(pauseMatch[2]);

  entries.push({ datum, von: `${vonMatch[1]}:${vonMatch[2]}`, bis: `${bisMatch[1]}:${bisMatch[2]}`, pauseMin });
}

entries.sort((a, b) => a.datum.localeCompare(b.datum) || a.von.localeCompare(b.von));
console.log(`Einträge: ${entries.length}`);
if (entries.length) console.log(`Zeitraum: ${entries[0].datum} bis ${entries[entries.length - 1].datum}`);

writeFileSync(outputPath, JSON.stringify(entries, null, 2), 'utf8');
console.log(`Geschrieben: ${outputPath}`);
