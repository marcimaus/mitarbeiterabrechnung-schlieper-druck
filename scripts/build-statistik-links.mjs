// Baut aus scripts/links-raw/JJJJ.json ({ KW: Drive-URL }) die kombinierte
// Datei scripts/statistik-links.json ({ "JJJJ-KW": url }).
//
// Aufruf: node scripts/build-statistik-links.mjs

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rawDir = join(__dirname, 'links-raw');

const ID_RE = /\/folders\/[A-Za-z0-9_-]{20,}/;
const out = {};
let total = 0;
const probleme = [];

for (const datei of readdirSync(rawDir).filter((f) => /^\d{4}\.json$/.test(f)).sort()) {
  const jahr = datei.slice(0, 4);
  const map = JSON.parse(readFileSync(join(rawDir, datei), 'utf8'));
  let n = 0;
  for (const [kwStr, url] of Object.entries(map)) {
    const kw = Number(kwStr);
    if (!Number.isInteger(kw) || kw < 1 || kw > 53) { probleme.push(`${jahr}: ungültige KW ${kwStr}`); continue; }
    if (typeof url !== 'string' || !ID_RE.test(url)) { probleme.push(`${jahr}-${kw}: verdächtige URL ${url}`); continue; }
    out[`${jahr}-${kw}`] = url.trim();
    n++; total++;
  }
  console.log(`${jahr}: ${n} Links`);
}

writeFileSync(join(__dirname, 'statistik-links.json'), JSON.stringify(out, null, 2));
console.log(`Gesamt: ${total} Links → statistik-links.json`);
if (probleme.length) {
  console.log('\nProbleme:');
  probleme.forEach((p) => console.log('  ⚠ ' + p));
}
