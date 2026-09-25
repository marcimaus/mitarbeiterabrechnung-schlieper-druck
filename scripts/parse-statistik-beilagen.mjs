// Parst scripts/statistik-beilagen-raw.md (Pipe-Tabelle, Export des Beilagen-
// Blatts gid=2052436127) → scripts/statistik-beilagen.json
// Format: { kwBezeichnungen: {}, jahre: { [jahr]: { [kw]: wert } } }
//
// Validiert die je-Jahr-Summe gegen die "Summe"-Zeile der Quelle (Hinweis bei
// Abweichung — z. B. 2025 enthält in der Quelle einen offensichtlichen
// Summenformel-Fehler 46646,8; die Einzelzellen sind davon nicht betroffen).
//
// Aufruf: node scripts/parse-statistik-beilagen.mjs

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

function num(v) {
  if (v == null) return null;
  const t = String(v).trim().replace(',', '.');
  if (t === '' || t === '-') return null;
  const n = Number(t);
  return Number.isNaN(n) ? null : n;
}

/** Pipe-Zeile → Zell-Array (ohne führende/abschließende Leerzelle). */
function cells(line) {
  const parts = line.split('|');
  // erste/letzte Teile (vor erstem / nach letztem '|') verwerfen
  return parts.slice(1, -1).map((c) => c.trim());
}

const raw = readFileSync(join(__dirname, 'statistik-beilagen-raw.md'), 'utf8');
const lines = raw.split(/\r?\n/).filter((l) => l.trim().startsWith('|'));

// Kopfzeile: Spaltenindex → Jahr (Spalte 0 = KW, 1 = dummy, ab 2 = Jahre)
const header = cells(lines[0]);
const jahrSpalten = {};
header.forEach((c, j) => {
  if (/^(19|20)\d{2}$/.test(c)) jahrSpalten[j] = Number(c);
});

const jahre = {};
const summeZeile = {};
let erwartetKw = 0;

for (let i = 1; i < lines.length; i++) {
  const c = cells(lines[i]);
  const label = c[0];

  if (label.toLowerCase() === 'summe') {
    for (const [colStr, jahr] of Object.entries(jahrSpalten)) {
      const v = num(c[Number(colStr)]);
      if (v != null) summeZeile[jahr] = v;
    }
    continue;
  }

  // KW bestimmen — bei Rendering-Glitch (z. B. "," statt 12) laufende Nummer nutzen
  let kw = num(label);
  if (kw == null || !Number.isInteger(kw) || kw < 1 || kw > 53) {
    kw = erwartetKw + 1;
  }
  if (kw < 1 || kw > 53) continue;
  erwartetKw = kw;

  for (const [colStr, jahr] of Object.entries(jahrSpalten)) {
    const v = num(c[Number(colStr)]);
    if (v == null) continue;
    (jahre[jahr] ??= {})[kw] = v;
  }
}

writeFileSync(
  join(__dirname, 'statistik-beilagen.json'),
  JSON.stringify({ kwBezeichnungen: {}, jahre }, null, 2),
);

// Validierung: berechnete Summe vs. Quelle
console.log('Jahr | berechn. Summe | Quelle-Summe | Δ');
for (const jahr of Object.keys(jahre).sort((a, b) => b - a)) {
  const berechnet = Object.values(jahre[jahr]).reduce((a, b) => a + b, 0);
  const quelle = summeZeile[jahr];
  const delta = quelle == null ? '—' : (berechnet - quelle).toFixed(1);
  const n = Object.keys(jahre[jahr]).length;
  console.log(
    `${jahr} | ${berechnet.toFixed(1).padStart(8)} (${n} KW) | ${String(quelle ?? '—').padStart(9)} | ${delta}`,
  );
}
