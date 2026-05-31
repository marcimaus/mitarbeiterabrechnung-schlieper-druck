// Parser: liest eine .pdf -> pdftotext -layout -> JSON-Manifest.
//
// Usage: node parse-lohnbuero-pdf.mjs <input.pdf> <fileId> <fileName> <jahr> <monat> [--korrektur] [--out=lohnbuero-index.json]
// Hängt an `lohnbuero-index.json` an (oder Initialisiert es). Datei
// danach mit `index-lohnbuero-pdfs.mjs` nach Firestore schreiben.

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { basename } from 'node:path';

const args = process.argv.slice(2);
if (args.length < 5) {
  console.error('Usage: node parse-lohnbuero-pdf.mjs <input.pdf> <fileId> <fileName> <jahr> <monat> [--korrektur] [--out=lohnbuero-index.json]');
  process.exit(1);
}
const [inputPdf, fileId, fileName, jahrStr, monatStr, ...rest] = args;
const jahr = parseInt(jahrStr, 10);
const monat = parseInt(monatStr, 10);
const istKorrektur = rest.includes('--korrektur');
const outFile = (rest.find((a) => a.startsWith('--out=')) ?? '--out=lohnbuero-index.json').slice(6);
const fileUrl = `https://drive.google.com/file/d/${fileId}/view`;

// ---- pdftotext aufrufen -------------------------------------

const tmpTxt = `${inputPdf}.layout.txt`;
execSync(`pdftotext -layout -enc UTF-8 "${inputPdf}" "${tmpTxt}"`);
const fullText = readFileSync(tmpTxt, 'utf8');
unlinkSync(tmpTxt);

const pages = fullText.split('\f');
console.log(`PDF "${basename(inputPdf)}": ${pages.length} Seiten (raw, inkl. evtl. Anhang).`);

// ---- Parser-Helpers -----------------------------------------

function deNumber(s) {
  if (!s) return null;
  // "1.119,44" -> 1119.44, "109,84" -> 109.84
  const cleaned = s.replace(/\./g, '').replace(',', '.');
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

function ddmmyyToIso(s) {
  if (!s || !/^\d{6}$/.test(s)) return undefined;
  const dd = s.slice(0, 2), mm = s.slice(2, 4), yy = parseInt(s.slice(4, 6), 10);
  const year = yy < 50 ? 2000 + yy : 1900 + yy; // < 50 ⇒ 20xx, sonst 19xx
  return `${year}-${mm}-${dd}`;
}

// Aus einer Zeile die rechtmöglichste Geldzahl extrahieren — bei
// Bedarf nur Treffer ab einer Mindest-Spalte (für Spalten-genaue
// Extraktion aus Mehrspalten-Layouts).
function letztesGeldInZeile(line, minCol = 0) {
  if (!line) return null;
  const matches = [...line.matchAll(/(\d{1,3}(?:\.\d{3})*,\d{2})/g)];
  if (matches.length === 0) return null;
  // Filter auf Mindest-Spalte
  const eligible = matches.filter((m) => m.index >= minCol);
  const pick = eligible.length > 0 ? eligible[eligible.length - 1] : matches[matches.length - 1];
  return deNumber(pick[1]);
}

// Geld-Werte einer Zeile mit Spaltenposition (für Schlüssel-/Label-Suche).
function geldWerteMitPos(line) {
  return [...line.matchAll(/(\d{1,3}(?:\.\d{3})*,\d{2})/g)].map((m) => ({
    val: deNumber(m[1]),
    idx: m.index ?? 0,
  }));
}

// Wert für eine Lohnart-Schlüssel-Nummer (z. B. "9074", "9001", "9993").
// Layout im PDF:
//   Linke Spalte (Steuern)         Mittlere Spalte (Lohnart-Block)
//   Lohnsteuer    1.000,00         9074 Fahrtkosten             Betrag
//                                  9994 Priv. Kfz-Nutzung       6,72-
//                                                              112,00-
// Der Wert kann auf der gleichen Zeile als Schlüssel rechts daneben stehen
// (Inline-Layout) ODER mehrere Zeilen darunter in der rechten Spalte (wenn
// der Schlüssel mit „Betrag"-Header alleine steht). Heuristik:
//   1. Geld auf der gleichen Zeile rechts vom Schlüssel → das ist der Wert.
//   2. Sonst die nächsten 6 nicht-leeren Zeilen scannen. Abbruch sobald
//      - eine NEUE Lohnart-Nummer in (nahe) gleicher Spalte steht, oder
//      - eine Block-Ende-Marker-Zeile beginnt (Bank, Konto, Pfändung Rest,
//        Darlehen Rest).
//   3. Der erste Geldwert in der rechten Spalte (idx >= keyCol-5) ist der Wert.
// Wichtig: Whitespace VOR der 4-stelligen Nummer ist Pflicht, damit z. B.
// „3.50400" nicht als Lohnart „0400" missinterpretiert wird.
function wertNachSchluessel(lines, key, prevSearch = false, nextSearch = true) {
  const re = new RegExp(`(?:^|\\s)${key}(?:\\s|$)`);
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const m = re.exec(l);
    if (!m) continue;
    const keyCol = m.index + (m[0].startsWith(' ') ? 1 : 0);
    const sameLine = geldWerteMitPos(l).filter((x) => x.idx > keyCol);
    if (sameLine.length > 0) return sameLine[0].val;
    // VORHER-Suche (z. B. für 029/041): pdftotext gibt den Wert der
    // Betrag-Spalte manchmal EINE Zeile VOR der Bezeichnung aus. Akzeptiere
    // nur eine FREISTEHENDE Geldzeile (kein anderer Text, genau 1 Wert in
    // der rechten Spalte) und brich ab bei vorheriger Lohnart-Zeile.
    if (prevSearch) {
      for (let pj = 1; pj <= 2; pj++) {
        const prev = lines[i - pj];
        if (prev == null) break;
        const trimmed = prev.trim();
        if (!trimmed) continue;
        const otherPrev = prev.match(/(?:^|\s)(\d{3,4})(?:\s|$)/);
        if (otherPrev && otherPrev[1] !== key) {
          // pdftotext places the Betrag of the current Lohnart on the PRECEDING
          // Lohnart's line when their y-coordinates are close in the PDF. Accept
          // if exactly ONE money value sits in the right column on that line.
          const allMoney = geldWerteMitPos(prev);
          const inCol = allMoney.filter((x) => x.idx >= keyCol - 5);
          if (allMoney.length === 1 && inCol.length === 1) return inCol[0].val;
          break;
        }
        const allMoney = geldWerteMitPos(prev);
        const inCol = allMoney.filter((x) => x.idx >= keyCol - 5);
        // The preceding line can be a standalone money value OR carry the
        // Lohnart-tax-code (e.g. "FFJ 69,90") when pdftotext renders the
        // code-column before the label. Accept if exactly one money in col.
        if (allMoney.length === 1 && inCol.length === 1) return inCol[0].val;
        break;
      }
    }
    if (!nextSearch) return undefined;
    let seen = 0;
    for (let j = 1; j <= 8 && seen < 6; j++) {
      const cand = lines[i + j];
      if (cand == null) break;
      const trimmed = cand.trim();
      if (!trimmed) continue;
      seen++;
      if (/^Bank\b|^Konto\b|^Pfändung Rest|^Darlehen Rest/.test(trimmed)) break;
      const other = cand.match(/(?:^|\s)(\d{3,4})(?:\s|$)/);
      if (other && other[1] !== key) {
        const oki = (other.index ?? 0) + (other[0].startsWith(' ') ? 1 : 0);
        if (Math.abs(oki - keyCol) <= 5) break;
      }
      const ms = geldWerteMitPos(cand).filter((x) => x.idx >= keyCol - 5);
      if (ms.length > 0) return ms[0].val;
    }
    return undefined;
  }
  return undefined;
}

// Wert anhand eines Bezeichnungs-Labels (z. B. "Darlehen Rest"): das Label
// steht in der linken Spalte; der Wert (falls vorhanden) auf derselben Zeile
// rechts daneben. Ist die Zeile leer rechts → kein Wert.
// Summe aller Fahrtkosten-Lohnarten. Das Steuerbüro verwendet je nach
// Software-Version / MA-Vertragstyp verschiedene Schlüssel für „Fahrtkosten":
//   9074 „Fahrtkosten"
//   029  „Fahrgeld ST+SV frei"
//   041  „Fahrgeld ST+SV frei"
// Wenn mehrere davon auf einer Seite stehen, addieren wir. `undefined`, wenn
// keiner der Schlüssel auf der Seite einen Wert hat.
function fahrtkostenSumme(lines) {
  // 9074: Inline-Layout (Wert auf Schlüsselzeile rechts). Keine NACHHER-
  //       Suche, sonst werden Werte anderer Lohnarten fälschlich übernommen.
  // 029/041: Lohnart-Tabellen-Layout; Wert steht oft 1 Zeile VOR der
  //          Bezeichnung in der Betrag-Spalte → prevSearch=true.
  const teile = [
    wertNachSchluessel(lines, '9074', /*prev*/ false, /*next*/ false),
    wertNachSchluessel(lines, '029',  /*prev*/ true,  /*next*/ false),
    wertNachSchluessel(lines, '041',  /*prev*/ true,  /*next*/ false),
  ].filter((v) => v != null);
  if (teile.length === 0) return undefined;
  return teile.reduce((s, v) => s + v, 0);
}

function wertNachLabel(lines, label) {
  for (const l of lines) {
    const li = l.indexOf(label);
    if (li < 0) continue;
    const rechts = geldWerteMitPos(l).filter((g) => g.idx > li);
    if (rechts.length) return rechts[rechts.length - 1].val;
    return undefined;
  }
  return undefined;
}

// ---- Pro Seite parsen ---------------------------------------

const abrechnungen = [];
const anmeldungen = [];

// pageIndex zählt durch alle PDF-Seiten (1-basiert, für Deep-Links).
// Daneben halten wir den Lohnbüro-eigenen „Personal-Nr."-Eintrag aus dem
// Seiten-Header — der ist nicht streng monoton und passt nicht als
// Deep-Link, ist aber als Audit-Info nützlich.
let physicalPage = 0;
for (const raw of pages) {
  physicalPage++;
  // Erkenne Seitentyp anhand des Dokument-Titels, NICHT anhand des
  // Header-Prefixes (M4A/M6P bzw. MJA/MLQ) — beide Prefixe können sowohl
  // auf Abrechnungs- als auch auf Meldungsseiten auftreten.
  const istAnmeldungsSeite = /Meldebescheinigung zur Sozialversicherung/.test(raw);
  const istAbrechnungsSeite = !istAnmeldungsSeite
    && /Abrechnung der Brutto\/Netto-Bezüge/.test(raw);
  if (!istAbrechnungsSeite && !istAnmeldungsSeite) continue;
  const headerMatch = raw.match(/(?:VKZ:\s*)?(?:M4A\/M6P|MJA\/MLQ)\s+\d+\/\d+\/(\d+)/);
  const lohnbueroSeitenRef = headerMatch ? parseInt(headerMatch[1], 10) : 0;
  // Für UI/Deep-Link: die echte PDF-Seitennummer (#page=N im Drive-Viewer).
  const seite = physicalPage;
  const lines = raw.split('\n').map((l) => l.replace(/\r$/, ''));

  // Name: erste Zeile nach der Adresse von Schlieper-Druck, die in der
  // linken Spalte (Indent < 30 Zeichen) einen aus 2+ Wörtern bestehenden
  // Namen mit Großbuchstaben trägt.
  let name = '';
  const idxSchlieper = lines.findIndex((l) => /Schlieper-Druck\s*GmbH/.test(l));
  if (idxSchlieper >= 0) {
    for (let k = idxSchlieper + 1; k < Math.min(idxSchlieper + 25, lines.length); k++) {
      const l = lines[k];
      if (!l) continue;
      // Linke Spalte: vorne 1-15 Leerzeichen, dann 2-4 Wörter mit Großbuchstaben
      // Erlaube optional rechts angehängten Text (z. B. Spaltenlabel
      // „Geschlecht") nach dem Namen; verlangt aber, dass die Zeile in
      // der linken Spalte mit dem Namen beginnt.
      const m = l.match(/^\s{0,15}([A-ZÄÖÜ][\wÄÖÜäöüß-]+(?:\s+(?:[A-ZÄÖÜ][\wÄÖÜäöüß-]+|al|von|de|der|van|el))+)(?:\s{2,}|\s*$)/);
      if (!m) continue;
      const cand = m[1].trim();
      // Ausschluss-Liste: nur den ERFASSTEN Namen prüfen, nicht die
      // ganze Zeile (die auf Meldebescheinigungs-Seiten rechts daneben
      // Feldlabels wie „Geburtsland" enthalten kann).
      if (/^(Personal|Pers\.-Nr|Abt|Brutto|Lohnart|Steuer|Verdienst|Meldebescheinigung|Schlieper|Datum|Seite|Versicherungs|Geburts|Geschlecht|Stornierung|Bezeichnung|Grund|Hauptbetrieb|WICHTIGES|IMPORTANT|Eintritt|Folgende|Spoudaio|Krankenkasse|Einzugsstelle|Form|Hinweise|Bank|Konto|Betrieb|Bundesknappsch|Anmeldung|Abmeldung|Versicherungsnummer)\b/i.test(cand)) continue;
      // Wahrscheinlichkeit erhöhen: mindestens 2 Wörter, jedes ≥ 2 Buchstaben.
      const parts = cand.split(/\s+/);
      if (parts.length < 2 || parts.some((p) => p.length < 2)) continue;
      name = cand;
      break;
    }
  }

  // Personal-Nr (Lohnbüro): bei Abrechnungs-Seiten ist es die 5-stellige
  // Zahl direkt vor dem Geburtsdatum; bei Anmeldungs-Seiten steht sie
  // in einer „*Pers.-Nr. NNNNN*"-Zeile.
  let personalNrLohnbuero = String(lohnbueroSeitenRef).padStart(5, '0');
  if (istAnmeldungsSeite) {
    const m = lines.find((l) => /\*Pers\.?-Nr\.?\s*(\d{4,6})\*/.test(l));
    if (m) {
      const mm = m.match(/\*Pers\.?-Nr\.?\s*(\d{4,6})\*/);
      if (mm) personalNrLohnbuero = mm[1].padStart(5, '0');
    }
  }

  // Eintritt / Austritt: zwei Datumsfelder (DDMMYY) unter „Eintritt Austritt"
  let eintritt, austritt;
  const idxEintritt = lines.findIndex((l) => /Eintritt\s+Austritt/.test(l));
  if (idxEintritt >= 0) {
    for (let k = idxEintritt + 1; k < Math.min(idxEintritt + 5, lines.length); k++) {
      const l = lines[k];
      const m = l.match(/(\d{6})(?:\s+(\d{6}))?/);
      if (m) {
        eintritt = ddmmyyToIso(m[1]);
        if (m[2]) austritt = ddmmyyToIso(m[2]);
        break;
      }
    }
  }

  // Werte: Labels stehen rechts, Wert auf folgender Zeile in derselben
  // rechten Spalte. Wir nehmen daher die Spaltenposition des Labels und
  // verlangen, dass die extrahierte Zahl mindestens an der gleichen
  // Position startet (±20 Zeichen Toleranz). Suche nur die nächsten
  // 2 nicht-leeren Zeilen, damit Werte aus weiter unten liegenden
  // Labels nicht versehentlich übernommen werden.
  function valueAfterLabel(re) {
    for (let k = 0; k < lines.length; k++) {
      const l = lines[k];
      const labelMatch = l.match(re);
      if (!labelMatch) continue;
      const labelCol = (labelMatch.index ?? 0) - 20;     // 20 Zeichen Toleranz nach links
      // Innerhalb der nächsten 4 Zeilen die erste mit einem Geldwert in
      // der rechten Spalte finden, aber bei einem neuen Label abbrechen.
      // Scanne bis zu 5 nicht-leere Folgezeilen. Pro Zeile:
      //  • Wenn rechts (≥ labelCol) ein Geldwert steht → das ist der
      //    Wert für dieses Label.
      //  • Wenn rechts (≥ labelCol) ein NEUES Label steht (z. B.
      //    „Netto-Verdienst") und KEIN Geldwert → der aktuelle Wert
      //    fehlt (= 0), break.
      // Damit fischen wir keine Werte aus Folgelabels ab.
      // Label muss in der RECHTEN Spalte (≥ labelCol) stehen — nur dann
      // ist es das Folgelabel; gleiche Wortgruppe in der linken Spalte
      // (z. B. „Gesamt-Brutto" als Wiederholung im Verdienstbescheinigungs-
      // Block) darf das Scannen nicht stoppen.
      const NEUES_LABEL_RE = /(?:Gesamt-Brutto|Steuerrechtliche Abzüge|SV-rechtliche Abzüge|Netto-Verdienst|Auszahlungsbetrag|Betrag)\s*$/;
      let nonEmpty = 0;
      for (let j = 1; j <= 5; j++) {
        const cand = lines[k + j];
        if (cand == null) break;
        if (cand.trim() === '') continue;
        nonEmpty++;
        const v = letztesGeldInZeile(cand, labelCol);
        if (v != null) return v;
        // Kein Geld in der rechten Spalte: enthält die Zeile am Ende
        // (rechte Spalte, ≥ labelCol) ein neues Label? Dann ist der
        // gesuchte Wert leer.
        const labelHit = cand.match(NEUES_LABEL_RE);
        if (labelHit && (labelHit.index ?? 0) >= labelCol) return 0;
        if (nonEmpty >= 3) break;
      }
      return 0;
    }
    return 0;
  }

  if (istAnmeldungsSeite) {
    // Anmeldungs-Modus: Grund der Abgabe → Schlüsselzahl bestimmt Typ.
    // 10/13 = Anmeldung-Varianten; 30/31/32/33/34/36 = Abmeldung-Varianten.
    const grundLine = lines.find((l) => /Grund der Abgabe/.test(l));
    let grundDerAbgabe;
    let grundCode = null;
    if (grundLine) {
      const m = grundLine.match(/Grund der Abgabe\s+(\d+)\s+(.+?)\s*$/);
      if (m) {
        grundCode = parseInt(m[1], 10);
        grundDerAbgabe = `${m[1]} ${m[2].trim()}`;
      } else {
        const m2 = grundLine.match(/Grund der Abgabe[:\s]+(.+)$/);
        if (m2) grundDerAbgabe = m2[1].trim();
      }
    }
    // Schlüsselzahlen:
    //   10..19 = Anmeldungen
    //   30..39 = Abmeldungen
    //   50     = Jahresmeldung (überspringen — wird hier nicht indiziert)
    //   49     = Unterbrechungsmeldung (überspringen)
    //   Andere = überspringen
    if (grundCode != null && (grundCode === 50 || grundCode === 49 || (grundCode >= 40 && grundCode < 50) || grundCode >= 60)) {
      continue;
    }
    const typ = grundCode != null
      ? (grundCode >= 30 ? 'abmeldung' : 'anmeldung')
      : (/Abmeldung/.test(grundDerAbgabe ?? '') ? 'abmeldung' : 'anmeldung');

    // Eintritt/Austritt für Anmeldungen: Felder „Beschäftigt vom/bis"
    // bzw. „Eintritt/Austritt" — Format auf Anmeldungsseite ist
    // typischerweise DD.MM.YYYY.
    function parseDeDate(s) {
      const m = s.match(/(\d{2})\.(\d{2})\.(\d{4})/);
      return m ? `${m[3]}-${m[2]}-${m[1]}` : undefined;
    }
    const vonLine = lines.find((l) => /Beginn der Beschäftigung|Beschäftigt vom/i.test(l));
    const bisLine = lines.find((l) => /Ende der Beschäftigung|Beschäftigt bis/i.test(l));
    const beschaeftigungVon = vonLine ? parseDeDate(vonLine) : eintritt;
    const beschaeftigungBis = bisLine ? parseDeDate(bisLine) : austritt;

    anmeldungen.push({
      fileId, fileName, fileUrl, seite, jahr, monat,
      nameRoh: name,
      personalNrLohnbuero,
      typ,
      grundDerAbgabe,
      beschaeftigungVon,
      beschaeftigungBis,
    });
  } else {
    // Abrechnung
    abrechnungen.push({
      fileId, fileName, fileUrl, seite, jahr, monat,
      istKorrektur,
      nameRoh: name,
      personalNrLohnbuero,
      gesamtBrutto: valueAfterLabel(/Gesamt-Brutto/),
      svAbzuege: valueAfterLabel(/SV-rechtliche Abzüge/),
      nettoVerdienst: valueAfterLabel(/Netto-Verdienst/),
      auszahlungsbetrag: valueAfterLabel(/Auszahlungsbetrag/),
      // Weitere Werte per Lohnart-Schlüssel des Steuerbüros:
      fahrtkosten: fahrtkostenSumme(lines),
      vorschuss: wertNachSchluessel(lines, '9001'),
      darlehensRueckzahlung: wertNachSchluessel(lines, '9993'),
      darlehenRest: wertNachLabel(lines, 'Darlehen Rest'),
      eintritt,
      austritt,
    });
  }
}

console.log(`Geparst: ${abrechnungen.length} Abrechnungen, ${anmeldungen.length} Anmeldungen.`);
const ohneName = abrechnungen.filter((a) => !a.nameRoh).length;
if (ohneName > 0) console.warn(`  ⚠ ${ohneName} Abrechnungen ohne Name — Heuristik prüfen.`);

// ---- An lohnbuero-index.json anhängen -----------------------

let existing = { abrechnungen: [], anmeldungen: [] };
if (existsSync(outFile)) {
  existing = JSON.parse(readFileSync(outFile, 'utf8'));
}
// De-Dupe: gleiche (fileId, seite, typ) entfernen, neue gewinnen
const keyA = (a) => `${a.fileId}_${a.seite}`;
const keyN = (a) => `${a.fileId}_${a.seite}_${a.typ}`;
const merged = {
  abrechnungen: [
    ...existing.abrechnungen.filter((e) => !abrechnungen.some((n) => keyA(n) === keyA(e))),
    ...abrechnungen,
  ],
  anmeldungen: [
    ...existing.anmeldungen.filter((e) => !anmeldungen.some((n) => keyN(n) === keyN(e))),
    ...anmeldungen,
  ],
};
writeFileSync(outFile, JSON.stringify(merged, null, 2));
console.log(`→ ${outFile} (jetzt: ${merged.abrechnungen.length} Abrechnungen, ${merged.anmeldungen.length} Anmeldungen)`);
