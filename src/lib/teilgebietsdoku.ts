// ============================================================
// Teilgebietsdoku — Änderungsprotokoll + Excel-Sicherung
// ============================================================
//
// Die Teilgebiets-Dokumentation (Mengen, Wegstrecke, Straßenlisten, Links)
// wird vollständig in der App geführt. Damit der Stand nachvollziehbar und
// außerhalb der App gesichert bleibt, gilt zweierlei:
//
//  1. Jede Änderung an einem Teilgebiet wird feldweise im Änderungsprotokoll
//     (Collection `auditlog`, Bereich `teilgebiet-stammdaten`) festgehalten:
//     wann, was (alt → neu), von wem — und ob sie manuell eingegeben oder
//     halb-automatisch von der App umgesetzt wurde (Monatswechsel).
//  2. Nach jeder Änderung wird die komplette Doku als Excel-Datei gesichert:
//     ein Blatt je Teilgebiet (Grunddaten, Straßenliste, Sonderauslagen,
//     Protokoll), eine Übersicht aller Teilgebiete mit Mengen und ein
//     Gesamtprotokoll. Ziel ist der in der App hinterlegte Ordner
//     (lokal synchronisiertes Google Drive, siehe `zielordner.ts`).

import ExcelJS from 'exceljs';
import {
  ladeAuditLog,
  ladeMitarbeiter,
  ladeTeilgebiete,
  ladeTouren,
  schreibeAuditLog,
} from './db';
import { buchbareTeilgebiete } from './beilagenVorlagen';
import { browserDownload, schreibeInZielordner, zielordnerName } from './zielordner';
import type { AuditLog, Mitarbeiter, Strasse, Teilgebiet, Tour } from '../types';

/** Google-Drive-Ordner der Teilgebietsdoku (in der App überschreibbar). */
export const TEILGEBIETSDOKU_DRIVE_ORDNER_DEFAULT =
  'https://drive.google.com/drive/u/0/folders/1FeKn7c13oTx_0Y4n3OoS7MU496F9PH6f';

/** Teilgebiet ohne die von der DB vergebenen Felder (= Formular-Payload). */
export type TeilgebietDaten = Omit<Teilgebiet, 'id' | 'erstelltAm' | 'aktualisiertAm'>;

export interface TeilgebietAenderung {
  /** Geänderte Eigenschaft, z. B. „Stückzahl" oder „Straße … — Stückzahl". */
  feld: string;
  /** Wert vorher (formatiert); '' = vorher nicht vorhanden. */
  alt: string;
  /** Wert nachher (formatiert); '' = entfernt. */
  neu: string;
  /** Menschenlesbare Zusammenfassung für das Protokoll. */
  beschreibung: string;
}

// ---- Formatierung ----------------------------------------------------------

const fmtStk = (n: number) => `${(n ?? 0).toLocaleString('de-DE')} Stk`;
const fmtMeter = (n: number) => `${(n ?? 0).toLocaleString('de-DE')} m`;
const fmtJaNein = (b: boolean | undefined) => (b ? 'ja' : 'nein');
const fmtText = (s: string | undefined | null) => (s ?? '').toString().trim();

export function formatiereZeitstempel(ts: number): string {
  return new Date(ts).toLocaleString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Dateinamen-Präfix `YYYY-MM-TT-HHMM` (Zeitpunkt der Sicherung). */
export function dateiZeitstempel(d = new Date()): string {
  const p = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

export function teilgebietsdokuDateiname(d = new Date()): string {
  return `${dateiZeitstempel(d)}_Teilgebietsdoku.xlsx`;
}

// ---- Änderungen ermitteln --------------------------------------------------

interface DiffKontext {
  touren: Tour[];
  mitarbeiter: Mitarbeiter[];
}

function tourName(id: string | null | undefined, touren: Tour[]): string {
  if (!id) return '— (keine Tour)';
  return touren.find((t) => t.id === id)?.name ?? `? (${id})`;
}

function austraegerName(id: string | null | undefined, mitarbeiter: Mitarbeiter[]): string {
  if (!id) return '— (unbesetzt)';
  const m = mitarbeiter.find((x) => x.id === id);
  return m ? `${m.name} (${m.nummer})` : `? (${id})`;
}

function aenderung(feld: string, alt: string, neu: string): TeilgebietAenderung {
  return { feld, alt, neu, beschreibung: `${feld}: ${alt || '—'} → ${neu || '—'}` };
}

function vergleiche(liste: TeilgebietAenderung[], feld: string, alt: string, neu: string): void {
  if (alt !== neu) liste.push(aenderung(feld, alt, neu));
}

function strasseKurz(s: Strasse): string {
  const pc = fmtText(s.plusCode);
  return `${s.strassenname} (${fmtStk(s.stueckzahl)}${pc ? `, Plus-Code ${pc}` : ''})`;
}

/**
 * Feldweiser Vergleich zweier Teilgebiets-Stände. Erfasst genau die
 * dokumentationsrelevanten Eigenschaften: Stückzahl, Wegstrecke,
 * Straßenliste (inkl. Menge je Straße), Sonderauslagen, Nicht-Beliefern,
 * externe Links sowie Zuordnung (Tour, Standardausträger) und Status.
 */
export function diffTeilgebiet(
  alt: Teilgebiet,
  neu: TeilgebietDaten,
  ktx: DiffKontext,
): TeilgebietAenderung[] {
  const out: TeilgebietAenderung[] = [];

  vergleiche(out, 'Name', alt.name, neu.name);
  vergleiche(out, 'PLZ', fmtText(alt.plz), fmtText(neu.plz));
  vergleiche(out, 'Stückzahl', fmtStk(alt.stueckzahl), fmtStk(neu.stueckzahl));
  vergleiche(
    out,
    'Herkunft der Stückzahl',
    alt.stueckzahlManuell ? 'manuell gesetzt' : 'Summe der Straßenliste',
    neu.stueckzahlManuell ? 'manuell gesetzt' : 'Summe der Straßenliste',
  );
  vergleiche(out, 'Wegstrecke', fmtMeter(alt.wegstreckeM), fmtMeter(neu.wegstreckeM));
  vergleiche(out, 'Tour', tourName(alt.tourId, ktx.touren), tourName(neu.tourId, ktx.touren));
  vergleiche(
    out,
    'Standardausträger',
    austraegerName(alt.standardAustraegerId, ktx.mitarbeiter),
    austraegerName(neu.standardAustraegerId, ktx.mitarbeiter),
  );
  vergleiche(out, 'Aktiv', fmtJaNein(alt.isActive), fmtJaNein(neu.isActive));
  vergleiche(
    out,
    'Nicht im Verteilplan',
    fmtJaNein(alt.nichtImVerteilplan),
    fmtJaNein(neu.nichtImVerteilplan),
  );
  vergleiche(out, 'Auslagestelle', fmtJaNein(alt.istAuslagestelle), fmtJaNein(neu.istAuslagestelle));
  vergleiche(
    out,
    'Auslagestelle — Adresse',
    fmtText(alt.auslagestelleAdresse),
    fmtText(neu.auslagestelleAdresse),
  );
  vergleiche(
    out,
    'Auslagestelle — Kontakt',
    fmtText(alt.auslagestelleKontaktName),
    fmtText(neu.auslagestelleKontaktName),
  );
  vergleiche(
    out,
    'Auslagestelle — Telefon',
    fmtText(alt.auslagestelleKontaktTelefon),
    fmtText(neu.auslagestelleKontaktTelefon),
  );
  vergleiche(
    out,
    'Auslagestelle — E-Mail',
    fmtText(alt.auslagestelleKontaktEmail),
    fmtText(neu.auslagestelleKontaktEmail),
  );
  vergleiche(
    out,
    'Auslagestelle — Memo',
    fmtText(alt.auslagestelleMemo),
    fmtText(neu.auslagestelleMemo),
  );
  // Externer Link (Kartenansicht). Leer = Standard-Link der Tour gilt.
  vergleiche(
    out,
    'Externer Link (Kartenansicht)',
    fmtText(alt.kartenLink) || '— (Standard der Tour)',
    fmtText(neu.kartenLink) || '— (Standard der Tour)',
  );

  // ---- Straßenliste (inkl. Menge je Straße) ----
  const altStrassen = alt.strassen ?? [];
  const neuStrassen = neu.strassen ?? [];
  const altMap = new Map(altStrassen.map((s) => [s.id, s]));
  const neuIds = new Set(neuStrassen.map((s) => s.id));
  for (const s of neuStrassen) {
    const vorher = altMap.get(s.id);
    if (!vorher) {
      out.push({
        feld: 'Straßenliste — Straße hinzugefügt',
        alt: '',
        neu: strasseKurz(s),
        beschreibung: `Straße hinzugefügt: ${strasseKurz(s)}`,
      });
      continue;
    }
    const bezeichnung = vorher.strassenname || s.strassenname;
    vergleiche(out, `Straße „${bezeichnung}" — Name`, vorher.strassenname, s.strassenname);
    vergleiche(
      out,
      `Straße „${bezeichnung}" — Stückzahl`,
      fmtStk(vorher.stueckzahl),
      fmtStk(s.stueckzahl),
    );
    vergleiche(
      out,
      `Straße „${bezeichnung}" — Plus-Code`,
      fmtText(vorher.plusCode),
      fmtText(s.plusCode),
    );
  }
  for (const s of altStrassen) {
    if (neuIds.has(s.id)) continue;
    out.push({
      feld: 'Straßenliste — Straße entfernt',
      alt: strasseKurz(s),
      neu: '',
      beschreibung: `Straße entfernt: ${strasseKurz(s)}`,
    });
  }
  const summeAlt = altStrassen.reduce((s, r) => s + (r.stueckzahl || 0), 0);
  const summeNeu = neuStrassen.reduce((s, r) => s + (r.stueckzahl || 0), 0);
  vergleiche(out, 'Summe der Straßenliste', fmtStk(summeAlt), fmtStk(summeNeu));

  // ---- Sonderauslagen ----
  const altSa = alt.sonderauslagen ?? [];
  const neuSa = neu.sonderauslagen ?? [];
  const altSaMap = new Map(altSa.map((s) => [s.id, s]));
  const neuSaIds = new Set(neuSa.map((s) => s.id));
  const saKurz = (s: { bezeichnung: string; adresse?: string; stueckzahl: number }) =>
    `${s.bezeichnung}${fmtText(s.adresse) ? `, ${fmtText(s.adresse)}` : ''} (${fmtStk(s.stueckzahl)})`;
  for (const s of neuSa) {
    const vorher = altSaMap.get(s.id);
    if (!vorher) {
      out.push({
        feld: 'Sonderauslage hinzugefügt',
        alt: '',
        neu: saKurz(s),
        beschreibung: `Sonderauslage hinzugefügt: ${saKurz(s)}`,
      });
    } else if (
      vorher.bezeichnung !== s.bezeichnung ||
      fmtText(vorher.adresse) !== fmtText(s.adresse) ||
      vorher.stueckzahl !== s.stueckzahl
    ) {
      out.push(aenderung(`Sonderauslage „${vorher.bezeichnung}"`, saKurz(vorher), saKurz(s)));
    }
  }
  for (const s of altSa) {
    if (neuSaIds.has(s.id)) continue;
    out.push({
      feld: 'Sonderauslage entfernt',
      alt: saKurz(s),
      neu: '',
      beschreibung: `Sonderauslage entfernt: ${saKurz(s)}`,
    });
  }

  // ---- Nicht beliefern ----
  const altNb = alt.nichtBeliefen ?? [];
  const neuNb = neu.nichtBeliefen ?? [];
  const altNbMap = new Map(altNb.map((s) => [s.id, s]));
  const neuNbIds = new Set(neuNb.map((s) => s.id));
  const nbKurz = (n: { adresse: string; bemerkung?: string }) =>
    `${n.adresse}${fmtText(n.bemerkung) ? ` — ${fmtText(n.bemerkung)}` : ''}`;
  for (const n of neuNb) {
    const vorher = altNbMap.get(n.id);
    if (!vorher) {
      out.push({
        feld: 'Nicht beliefern — Eintrag hinzugefügt',
        alt: '',
        neu: nbKurz(n),
        beschreibung: `Nicht beliefern, neuer Eintrag: ${nbKurz(n)}`,
      });
    } else if (vorher.adresse !== n.adresse || fmtText(vorher.bemerkung) !== fmtText(n.bemerkung)) {
      out.push(aenderung('Nicht beliefern — Eintrag geändert', nbKurz(vorher), nbKurz(n)));
    }
  }
  for (const n of altNb) {
    if (neuNbIds.has(n.id)) continue;
    out.push({
      feld: 'Nicht beliefern — Eintrag entfernt',
      alt: nbKurz(n),
      neu: '',
      beschreibung: `Nicht beliefern, Eintrag entfernt: ${nbKurz(n)}`,
    });
  }

  return out;
}

/** Kurzbeschreibung eines neu angelegten Teilgebiets fürs Protokoll. */
export function beschreibeNeuesTeilgebiet(daten: TeilgebietDaten, ktx: DiffKontext): string {
  return (
    `Teilgebiet angelegt: ${daten.name}` +
    (daten.plz ? `, PLZ ${daten.plz}` : '') +
    `, ${fmtStk(daten.stueckzahl)}, Wegstrecke ${fmtMeter(daten.wegstreckeM)}` +
    `, Tour ${tourName(daten.tourId, ktx.touren)}` +
    `, Standardausträger ${austraegerName(daten.standardAustraegerId, ktx.mitarbeiter)}` +
    `, ${(daten.strassen ?? []).length} Straße(n)`
  );
}

/**
 * Änderungen ins Protokoll schreiben — ein Eintrag je geändertem Feld, damit
 * die Excel-Doku die Spalten „vorher/nachher" füllen kann.
 */
export async function protokolliereTeilgebietAenderungen(args: {
  teilgebietId: string;
  teilgebietName: string;
  adminName: string;
  aenderungen: TeilgebietAenderung[];
  /** true = halb-automatisch von der App umgesetzt (z. B. Monatswechsel). */
  automatisch?: boolean;
  /** Text, der jeder Beschreibung vorangestellt wird (z. B. Periodenhinweis). */
  praefix?: string;
}): Promise<void> {
  const { teilgebietId, teilgebietName, adminName, aenderungen, automatisch, praefix } = args;
  for (const a of aenderungen) {
    await schreibeAuditLog({
      adminName: adminName || 'Unbekannt',
      bereich: 'teilgebiet-stammdaten',
      aktion: 'geaendert',
      teilgebietId,
      teilgebietName,
      mitarbeiterId: null,
      mitarbeiterName: null,
      feld: a.feld,
      altWert: a.alt,
      neuWert: a.neu,
      automatisch: automatisch || undefined,
      beschreibung: (praefix ?? '') + a.beschreibung,
    });
  }
}

// ---- Excel-Doku ------------------------------------------------------------

const HEADER_BLAU = 'FF1D4ED8';
const HEADER_HELL = 'FFDBEAFE';
const GRAU = 'FF9CA3AF';

function kopfzeile(ws: ExcelJS.Worksheet, zeile: number, werte: string[]): void {
  const row = ws.getRow(zeile);
  row.values = werte;
  for (let c = 1; c <= werte.length; c++) {
    const cell = row.getCell(c);
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_BLAU } };
  }
}

function abschnitt(ws: ExcelJS.Worksheet, zeile: number, titel: string): void {
  const cell = ws.getCell(`A${zeile}`);
  cell.value = titel;
  cell.font = { bold: true, size: 12, color: { argb: 'FF1E3A8A' } };
}

function tabellenKopf(ws: ExcelJS.Worksheet, zeile: number, werte: string[]): void {
  const row = ws.getRow(zeile);
  row.values = werte;
  row.font = { bold: true };
  for (let c = 1; c <= werte.length; c++) {
    row.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_HELL } };
  }
}

function hinweisZeile(ws: ExcelJS.Worksheet, zeile: number, text: string): void {
  ws.getCell(`A${zeile}`).value = text;
  ws.getCell(`A${zeile}`).font = { italic: true, color: { argb: GRAU } };
}

/** Excel-konformer, eindeutiger Blattname (max. 31 Zeichen, ohne Sonderzeichen). */
function blattName(name: string, vergeben: Set<string>): string {
  const basis =
    (name || 'Teilgebiet').replace(/[\\/?*[\]:]/g, '-').trim().slice(0, 31) || 'Teilgebiet';
  let kandidat = basis;
  let i = 2;
  while (vergeben.has(kandidat.toLowerCase())) {
    const suffix = `~${i}`;
    kandidat = basis.slice(0, 31 - suffix.length) + suffix;
    i++;
  }
  vergeben.add(kandidat.toLowerCase());
  return kandidat;
}

const BEREICH_LABEL: Record<AuditLog['bereich'], string> = {
  'austraeger-ausfall': 'Austräger-Ausfall / Springer',
  'dauerhafter-wechsel': 'Dauerhafter Wechsel',
  'teilgebiets-anpassung': 'Teilgebietsanpassung (Stückzahl)',
  'teilgebiet-stammdaten': 'Teilgebietsdaten',
};

const quelle = (e: AuditLog) => (e.automatisch ? 'App (Monatswechsel)' : 'manuell');

/** Auswertungsblatt direkt nach der Übersicht. */
const BLATT_MENGEN_STRECKEN = 'Mengen & Strecken';

// ---- Auswertung: Mengen- und Streckenänderungen ----------------------------
//
// Für das gleichnamige Blatt werden aus dem Protokoll genau die Einträge
// herausgezogen, die die Stückzahl oder die Wegstrecke eines Teilgebiets
// verändert haben — egal ob manuell gepflegt oder beim Monatswechsel
// umgesetzt. Vorgemerkte und wieder verworfene Anpassungen zählen nicht,
// da sie den Wert am Teilgebiet nicht verändern.

type MengenArt = 'menge' | 'strecke';

interface MengenAenderung {
  eintrag: AuditLog;
  art: MengenArt;
  vorher: number;
  nachher: number;
}

/** Zahl aus einem protokollierten Wert lesen („1.234 Stk", „3.400 m"). */
function parseZahl(wert: string | undefined | null): number | null {
  if (!wert) return null;
  const treffer = wert.match(/-?\d[\d.]*(?:,\d+)?/);
  if (!treffer) return null;
  const n = Number(treffer[0].replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function mengenUndStreckenAenderungen(auditLog: AuditLog[]): MengenAenderung[] {
  const out: MengenAenderung[] = [];
  for (const e of auditLog) {
    if (e.aktion !== 'geaendert') continue;
    let art: MengenArt | null = null;
    let vorher: number | null = null;
    let nachher: number | null = null;
    if (e.feld === 'Stückzahl') {
      art = 'menge';
      vorher = parseZahl(e.altWert);
      nachher = parseZahl(e.neuWert);
    } else if (e.feld === 'Wegstrecke') {
      art = 'strecke';
      vorher = parseZahl(e.altWert);
      nachher = parseZahl(e.neuWert);
    } else if (!e.feld && e.bereich === 'teilgebiets-anpassung') {
      // Altbestand aus der Zeit vor den Feld-Spalten: die beim Monatswechsel
      // umgesetzten Mengenanpassungen stehen dort nur in der Beschreibung
      // („… — 340 → 360 Stk (Periode …)").
      const m = e.beschreibung.match(/(\d[\d.]*)\s*→\s*(\d[\d.]*)\s*Stk/);
      if (m) {
        art = 'menge';
        vorher = parseZahl(m[1]);
        nachher = parseZahl(m[2]);
      }
    }
    if (!art || vorher == null || nachher == null || vorher === nachher) continue;
    out.push({ eintrag: e, art, vorher, nachher });
  }
  return out.sort((a, b) => b.eintrag.zeitstempel - a.eintrag.zeitstempel);
}

export interface TeilgebietsdokuKontext {
  teilgebiete: Teilgebiet[];
  touren: Tour[];
  mitarbeiter: Mitarbeiter[];
  /** Komplettes Änderungsprotokoll (wird je Teilgebiet gefiltert). */
  auditLog: AuditLog[];
  /** Wer die Sicherung ausgelöst hat (Hinweis auf dem Übersichtsblatt). */
  adminName?: string;
  /** Anlass der Sicherung, z. B. „Änderung an Teilgebiet Uslar1". */
  anlass?: string;
}

/** Baut die komplette Teilgebietsdoku als Excel-Arbeitsmappe. */
export async function baueTeilgebietsdoku(ktx: TeilgebietsdokuKontext): Promise<Blob> {
  const { teilgebiete, touren, mitarbeiter, auditLog } = ktx;
  const jetzt = Date.now();
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Schlieper-Druck Mitarbeiterabrechnung';
  wb.created = new Date(jetzt);

  const sortiert = [...teilgebiete].sort((a, b) =>
    a.name.localeCompare(b.name, 'de', { numeric: true }),
  );
  const protokollJeTg = new Map<string, AuditLog[]>();
  for (const e of auditLog) {
    const liste = protokollJeTg.get(e.teilgebietId);
    if (liste) liste.push(e);
    else protokollJeTg.set(e.teilgebietId, [e]);
  }
  for (const liste of protokollJeTg.values()) {
    liste.sort((a, b) => b.zeitstempel - a.zeitstempel);
  }

  // ---- Blatt „Übersicht" ----
  const wsUe = wb.addWorksheet('Übersicht');
  wsUe.getCell('A1').value = 'Teilgebietsdoku — Übersicht';
  wsUe.getCell('A1').font = { bold: true, size: 14 };
  wsUe.getCell('A2').value =
    `Stand: ${formatiereZeitstempel(jetzt)}` +
    (ktx.adminName ? ` · gesichert von ${ktx.adminName}` : '') +
    (ktx.anlass ? ` · Anlass: ${ktx.anlass}` : '');
  wsUe.getCell('A2').font = { size: 10, color: { argb: 'FF6B7280' } };
  wsUe.getCell('A3').value =
    'Führende Quelle ist die App (Teilgebiete). Diese Datei sichert den jeweils aktuellen Stand.';
  wsUe.getCell('A3').font = { size: 10, italic: true, color: { argb: 'FF6B7280' } };

  const ueSpalten: { header: string; width: number }[] = [
    { header: 'Teilgebiet', width: 22 },
    { header: 'PLZ', width: 8 },
    { header: 'Tour', width: 12 },
    { header: 'Standardausträger', width: 26 },
    { header: 'Stückzahl', width: 12 },
    { header: 'Herkunft Stückzahl', width: 20 },
    { header: 'Wegstrecke (m)', width: 15 },
    { header: 'Straßen', width: 9 },
    { header: 'Summe Straßenliste', width: 18 },
    { header: 'Sonderauslagen (Stk)', width: 19 },
    { header: 'Nicht beliefern', width: 14 },
    { header: 'Auslagestelle', width: 13 },
    { header: 'Aktiv', width: 8 },
    { header: 'Im Verteilplan', width: 14 },
    { header: 'Externer Link (Karte)', width: 40 },
    { header: 'Änderungen', width: 12 },
    { header: 'Letzte Änderung', width: 18 },
  ];
  ueSpalten.forEach((s, i) => {
    wsUe.getColumn(i + 1).width = s.width;
  });
  kopfzeile(
    wsUe,
    5,
    ueSpalten.map((s) => s.header),
  );

  const blattNamen = new Set<string>([
    'übersicht',
    'änderungsprotokoll',
    BLATT_MENGEN_STRECKEN.toLowerCase(),
  ]);
  const blattJeTg = new Map<string, string>();
  for (const tg of sortiert) blattJeTg.set(tg.id, blattName(tg.name, blattNamen));

  let zeile = 6;
  for (const tg of sortiert) {
    const strassen = tg.strassen ?? [];
    const eintraege = protokollJeTg.get(tg.id) ?? [];
    const tourLink = fmtText(touren.find((t) => t.id === tg.tourId)?.kartenLink);
    const row = wsUe.getRow(zeile);
    row.values = [
      tg.name,
      tg.plz ?? '',
      tourName(tg.tourId, touren),
      tg.istAuslagestelle
        ? '— (Auslagestelle)'
        : austraegerName(tg.standardAustraegerId, mitarbeiter),
      tg.stueckzahl ?? 0,
      tg.stueckzahlManuell ? 'manuell' : 'Summe Straßenliste',
      tg.wegstreckeM ?? 0,
      strassen.length,
      strassen.reduce((s, r) => s + (r.stueckzahl || 0), 0),
      (tg.sonderauslagen ?? []).reduce((s, r) => s + (r.stueckzahl || 0), 0),
      (tg.nichtBeliefen ?? []).length,
      tg.istAuslagestelle ? 'ja' : 'nein',
      tg.isActive ? 'ja' : 'nein',
      tg.nichtImVerteilplan ? 'nein' : 'ja',
      fmtText(tg.kartenLink) || tourLink,
      eintraege.length,
      eintraege.length > 0 ? formatiereZeitstempel(eintraege[0].zeitstempel) : '',
    ];
    // Hinweis auf das Detailblatt. Bewusst als Text und nicht als
    // Excel-Hyperlink: interne Verknüpfungen schreibt ExcelJS als externe
    // Verknüpfung, was Excel beim Öffnen als Reparaturfall melden kann.
    const blatt = blattJeTg.get(tg.id);
    if (blatt && blatt !== tg.name) {
      row.getCell(1).note = `Detailblatt: "${blatt}"`;
    }
    row.getCell(1).font = { bold: true };
    [5, 7, 8, 9, 10, 11, 16].forEach((c) => {
      row.getCell(c).numFmt = '#,##0';
      row.getCell(c).alignment = { horizontal: 'right' };
    });
    if (!tg.isActive) row.font = { color: { argb: GRAU } };
    zeile++;
  }

  if (sortiert.length > 0) {
    const summe = wsUe.getRow(zeile);
    summe.getCell(1).value = `Summe (${sortiert.length} Teilgebiete)`;
    summe.getCell(5).value = sortiert.reduce((s, t) => s + (t.stueckzahl || 0), 0);
    summe.getCell(7).value = sortiert.reduce((s, t) => s + (t.wegstreckeM || 0), 0);
    summe.getCell(8).value = sortiert.reduce((s, t) => s + (t.strassen ?? []).length, 0);
    summe.getCell(9).value = sortiert.reduce(
      (s, t) => s + (t.strassen ?? []).reduce((x, r) => x + (r.stueckzahl || 0), 0),
      0,
    );
    summe.getCell(10).value = sortiert.reduce(
      (s, t) => s + (t.sonderauslagen ?? []).reduce((x, r) => x + (r.stueckzahl || 0), 0),
      0,
    );
    summe.font = { bold: true };
    [5, 7, 8, 9, 10].forEach((c) => {
      summe.getCell(c).numFmt = '#,##0';
      summe.getCell(c).alignment = { horizontal: 'right' };
    });
    wsUe.autoFilter = {
      from: { row: 5, column: 1 },
      to: { row: zeile - 1, column: ueSpalten.length },
    };
  }
  wsUe.views = [{ state: 'frozen', ySplit: 5 }];

  // ---- Blatt „Mengen & Strecken" (Auswertung direkt nach der Übersicht) ----
  // Zeigt nur Änderungen der Stückzahl und der Wegstrecke, neueste zuerst.
  // Die Verteilplan-Summe wird vom heutigen Stand rückwärts fortgeschrieben:
  // die jüngste Änderung endet auf der aktuellen Gesamtmenge, jede ältere
  // Zeile auf dem Stand vor der jeweils jüngeren Änderung.
  const wsMS = wb.addWorksheet(BLATT_MENGEN_STRECKEN);
  const imVerteilplan = new Set(buchbareTeilgebiete(teilgebiete, touren).map((t) => t.id));
  const gesamtmengeAktuell = teilgebiete
    .filter((t) => imVerteilplan.has(t.id))
    .reduce((s, t) => s + (t.stueckzahl || 0), 0);
  const aenderungen = mengenUndStreckenAenderungen(auditLog);

  wsMS.getCell('A1').value = 'Mengen- und Streckenänderungen';
  wsMS.getCell('A1').font = { bold: true, size: 14 };
  wsMS.getCell('A2').value = `Stand: ${formatiereZeitstempel(jetzt)} · neueste Änderung zuerst`;
  wsMS.getCell('A2').font = { size: 10, color: { argb: 'FF6B7280' } };
  wsMS.getCell('A3').value =
    `Aktuelle Gesamtmenge im Verteilplan: ${gesamtmengeAktuell.toLocaleString('de-DE')} Stk ` +
    `aus ${imVerteilplan.size} buchbaren Teilgebieten (aktiv und im Verteilplan).`;
  wsMS.getCell('A3').font = { bold: true, size: 11 };
  wsMS.getCell('A4').value =
    'Die Verteilplan-Summen sind vom heutigen Stand zurückgerechnet. Teilgebiete, die zwischenzeitlich ' +
    'angelegt, stillgelegt oder aus dem Verteilplan genommen wurden, können ältere Summen verschieben. ' +
    'Streckenänderungen verändern die Menge nicht — dort steht die Summe zum Zeitpunkt der Änderung.';
  wsMS.getCell('A4').font = { size: 10, italic: true, color: { argb: 'FF6B7280' } };

  const msSpalten: { header: string; width: number }[] = [
    { header: 'Zeitpunkt', width: 18 },
    { header: 'Teilgebiet', width: 22 },
    { header: 'Tour', width: 14 },
    { header: 'Art der Änderung', width: 18 },
    { header: 'Wert vorher', width: 13 },
    { header: 'Wert nachher', width: 13 },
    { header: 'Differenz', width: 12 },
    { header: 'Gesamtmenge Verteilplan vorher (Stk)', width: 22 },
    { header: 'Gesamtmenge Verteilplan nachher (Stk)', width: 22 },
    { header: 'Im Verteilplan', width: 14 },
    { header: 'Benutzer', width: 18 },
    { header: 'Quelle', width: 20 },
  ];
  msSpalten.forEach((s, i) => {
    wsMS.getColumn(i + 1).width = s.width;
  });
  kopfzeile(
    wsMS,
    6,
    msSpalten.map((s) => s.header),
  );
  wsMS.getRow(6).alignment = { wrapText: true, vertical: 'bottom' };

  const tgNachId = new Map(teilgebiete.map((t) => [t.id, t]));
  let laufendeSumme = gesamtmengeAktuell;
  let summeMengeVerteilplan = 0;
  let summeStrecke = 0;
  let msZeile = 7;
  for (const a of aenderungen) {
    const e = a.eintrag;
    const tg = tgNachId.get(e.teilgebietId);
    const zaehltMit = a.art === 'menge' && imVerteilplan.has(e.teilgebietId);
    const summeNachher = laufendeSumme;
    const summeVorher = zaehltMit ? laufendeSumme - (a.nachher - a.vorher) : laufendeSumme;
    laufendeSumme = summeVorher;
    if (zaehltMit) summeMengeVerteilplan += a.nachher - a.vorher;
    if (a.art === 'strecke') summeStrecke += a.nachher - a.vorher;

    const row = wsMS.getRow(msZeile);
    row.values = [
      formatiereZeitstempel(e.zeitstempel),
      e.teilgebietName,
      tg ? tourName(tg.tourId, touren) : '— (nicht mehr vorhanden)',
      a.art === 'menge' ? 'Menge (Stk)' : 'Wegstrecke (m)',
      a.vorher,
      a.nachher,
      a.nachher - a.vorher,
      summeVorher,
      summeNachher,
      tg ? (zaehltMit || imVerteilplan.has(tg.id) ? 'ja' : 'nein') : '— (gelöscht)',
      e.adminName,
      quelle(e),
    ];
    [5, 6, 8, 9].forEach((c) => {
      row.getCell(c).numFmt = '#,##0';
    });
    row.getCell(7).numFmt = '+#,##0;-#,##0;0';
    if (a.nachher < a.vorher) row.getCell(7).font = { color: { argb: 'FFB91C1C' } };
    else if (a.nachher > a.vorher) row.getCell(7).font = { color: { argb: 'FF15803D' } };
    msZeile++;
  }

  if (aenderungen.length === 0) {
    hinweisZeile(wsMS, msZeile, '— bislang keine Mengen- oder Streckenänderungen protokolliert —');
    msZeile++;
  } else {
    const summenZeile = wsMS.getRow(msZeile + 1);
    summenZeile.getCell(1).value = `Summe über ${aenderungen.length} Änderungen`;
    summenZeile.getCell(4).value = 'Menge (Verteilplan) / Wegstrecke';
    summenZeile.getCell(7).value = summeMengeVerteilplan;
    summenZeile.getCell(7).numFmt = '+#,##0;-#,##0;0';
    summenZeile.getCell(8).value = laufendeSumme;
    summenZeile.getCell(9).value = gesamtmengeAktuell;
    [8, 9].forEach((c) => {
      summenZeile.getCell(c).numFmt = '#,##0';
    });
    summenZeile.getCell(10).value = `Wegstrecke gesamt: ${summeStrecke >= 0 ? '+' : ''}${summeStrecke.toLocaleString('de-DE')} m`;
    summenZeile.font = { bold: true };
    wsMS.autoFilter = {
      from: { row: 6, column: 1 },
      to: { row: msZeile - 1, column: msSpalten.length },
    };
  }
  wsMS.views = [{ state: 'frozen', ySplit: 6 }];

  // ---- Ein Blatt je Teilgebiet ----
  for (const tg of sortiert) {
    const ws = wb.addWorksheet(blattJeTg.get(tg.id) ?? blattName(tg.name, blattNamen));
    [30, 34, 30, 26, 46, 22, 20, 70].forEach((w, i) => {
      ws.getColumn(i + 1).width = w;
    });

    ws.getCell('A1').value = `Teilgebiet ${tg.name}`;
    ws.getCell('A1').font = { bold: true, size: 14 };
    ws.getCell('A2').value = `Stand: ${formatiereZeitstempel(jetzt)}`;
    ws.getCell('A2').font = { size: 10, color: { argb: 'FF6B7280' } };

    const strassen = tg.strassen ?? [];
    const summeStrassen = strassen.reduce((s, x) => s + (x.stueckzahl || 0), 0);
    const tourLink = fmtText(touren.find((t) => t.id === tg.tourId)?.kartenLink);

    let r = 4;
    abschnitt(ws, r, 'Grunddaten');
    r++;
    const grunddaten: [string, string | number][] = [
      ['PLZ', tg.plz ?? ''],
      ['Tour', tourName(tg.tourId, touren)],
      [
        'Standardausträger',
        tg.istAuslagestelle
          ? '— (Auslagestelle)'
          : austraegerName(tg.standardAustraegerId, mitarbeiter),
      ],
      ['Stückzahl', tg.stueckzahl ?? 0],
      ['Herkunft der Stückzahl', tg.stueckzahlManuell ? 'manuell gesetzt' : 'Summe der Straßenliste'],
      ['Summe der Straßenliste', summeStrassen],
      ['Wegstrecke (m)', tg.wegstreckeM ?? 0],
      ['Aktiv', tg.isActive ? 'ja' : 'nein'],
      ['Im Verteilplan buchbar', tg.nichtImVerteilplan ? 'nein' : 'ja'],
      ['Auslagestelle', tg.istAuslagestelle ? 'ja' : 'nein'],
      ['Auslagestelle — Adresse', fmtText(tg.auslagestelleAdresse)],
      ['Auslagestelle — Kontakt', fmtText(tg.auslagestelleKontaktName)],
      ['Auslagestelle — Telefon', fmtText(tg.auslagestelleKontaktTelefon)],
      ['Auslagestelle — E-Mail', fmtText(tg.auslagestelleKontaktEmail)],
      ['Auslagestelle — Memo', fmtText(tg.auslagestelleMemo)],
      [
        'Externer Link (Kartenansicht)',
        fmtText(tg.kartenLink) || (tourLink ? `${tourLink} (Standard der Tour)` : ''),
      ],
      ['Angelegt am', tg.erstelltAm ? formatiereZeitstempel(tg.erstelltAm) : ''],
      ['Zuletzt geändert am', tg.aktualisiertAm ? formatiereZeitstempel(tg.aktualisiertAm) : ''],
    ];
    for (const [label, wert] of grunddaten) {
      ws.getCell(`A${r}`).value = label;
      ws.getCell(`A${r}`).font = { bold: true };
      ws.getCell(`B${r}`).value = wert;
      if (typeof wert === 'number') {
        ws.getCell(`B${r}`).numFmt = '#,##0';
        ws.getCell(`B${r}`).alignment = { horizontal: 'left' };
      }
      r++;
    }

    // ---- Straßenliste (Mengen je Straße) ----
    r++;
    abschnitt(ws, r, `Straßenliste (${strassen.length} Straßen, ${fmtStk(summeStrassen)})`);
    r++;
    tabellenKopf(ws, r, ['Nr.', 'Straße', 'Stückzahl', 'Plus-Code']);
    r++;
    strassen.forEach((s, i) => {
      const row = ws.getRow(r);
      row.values = [i + 1, s.strassenname, s.stueckzahl ?? 0, fmtText(s.plusCode)];
      row.getCell(3).numFmt = '#,##0';
      r++;
    });
    if (strassen.length === 0) {
      hinweisZeile(ws, r, '— keine Straßen erfasst —');
      r++;
    } else {
      const row = ws.getRow(r);
      row.values = ['', 'Summe', summeStrassen, ''];
      row.font = { bold: true };
      row.getCell(3).numFmt = '#,##0';
      r++;
    }

    // ---- Sonderauslagen ----
    const sonder = tg.sonderauslagen ?? [];
    r++;
    abschnitt(ws, r, `Sonderauslagen (${sonder.length})`);
    r++;
    tabellenKopf(ws, r, ['Bezeichnung', 'Adresse', 'Stückzahl']);
    r++;
    for (const s of sonder) {
      const row = ws.getRow(r);
      row.values = [s.bezeichnung, fmtText(s.adresse), s.stueckzahl ?? 0];
      row.getCell(3).numFmt = '#,##0';
      r++;
    }
    if (sonder.length === 0) {
      hinweisZeile(ws, r, '— keine —');
      r++;
    }

    // ---- Nicht beliefern ----
    const nichtBeliefen = tg.nichtBeliefen ?? [];
    r++;
    abschnitt(ws, r, `Nicht beliefern (${nichtBeliefen.length})`);
    r++;
    tabellenKopf(ws, r, ['Adresse', 'Bemerkung']);
    r++;
    for (const n of nichtBeliefen) {
      ws.getRow(r).values = [n.adresse, fmtText(n.bemerkung)];
      r++;
    }
    if (nichtBeliefen.length === 0) {
      hinweisZeile(ws, r, '— keine —');
      r++;
    }

    // ---- Änderungsprotokoll dieses Teilgebiets ----
    const eintraege = protokollJeTg.get(tg.id) ?? [];
    r++;
    abschnitt(ws, r, `Änderungsprotokoll (${eintraege.length} Einträge, neueste zuerst)`);
    r++;
    tabellenKopf(ws, r, [
      'Zeitpunkt',
      'Bereich',
      'Feld',
      'vorher',
      'nachher',
      'Benutzer',
      'Quelle',
      'Beschreibung',
    ]);
    r++;
    for (const e of eintraege) {
      const row = ws.getRow(r);
      row.values = [
        formatiereZeitstempel(e.zeitstempel),
        BEREICH_LABEL[e.bereich] ?? e.bereich,
        e.feld ?? '',
        e.altWert ?? '',
        e.neuWert ?? '',
        e.adminName,
        quelle(e),
        e.beschreibung,
      ];
      row.alignment = { vertical: 'top', wrapText: true };
      r++;
    }
    if (eintraege.length === 0) {
      hinweisZeile(ws, r, '— keine Änderungen protokolliert —');
      r++;
    }
  }

  // ---- Blatt „Änderungsprotokoll" (alle Teilgebiete) ----
  const wsLog = wb.addWorksheet('Änderungsprotokoll');
  wsLog.getCell('A1').value = 'Änderungsprotokoll — alle Teilgebiete';
  wsLog.getCell('A1').font = { bold: true, size: 14 };
  wsLog.getCell('A2').value = `Stand: ${formatiereZeitstempel(jetzt)} · neueste Einträge zuerst`;
  wsLog.getCell('A2').font = { size: 10, color: { argb: 'FF6B7280' } };
  const logSpalten: { header: string; width: number }[] = [
    { header: 'Zeitpunkt', width: 18 },
    { header: 'Teilgebiet', width: 20 },
    { header: 'Bereich', width: 28 },
    { header: 'Aktion', width: 12 },
    { header: 'Feld', width: 30 },
    { header: 'vorher', width: 26 },
    { header: 'nachher', width: 26 },
    { header: 'Benutzer', width: 18 },
    { header: 'Quelle', width: 20 },
    { header: 'Beschreibung', width: 70 },
  ];
  logSpalten.forEach((s, i) => {
    wsLog.getColumn(i + 1).width = s.width;
  });
  kopfzeile(
    wsLog,
    4,
    logSpalten.map((s) => s.header),
  );
  const alleEintraege = [...auditLog].sort((a, b) => b.zeitstempel - a.zeitstempel);
  let lr = 5;
  for (const e of alleEintraege) {
    const row = wsLog.getRow(lr);
    row.values = [
      formatiereZeitstempel(e.zeitstempel),
      e.teilgebietName,
      BEREICH_LABEL[e.bereich] ?? e.bereich,
      e.aktion,
      e.feld ?? '',
      e.altWert ?? '',
      e.neuWert ?? '',
      e.adminName,
      quelle(e),
      e.beschreibung,
    ];
    row.alignment = { vertical: 'top', wrapText: true };
    lr++;
  }
  wsLog.views = [{ state: 'frozen', ySplit: 4 }];
  if (alleEintraege.length > 0) {
    wsLog.autoFilter = {
      from: { row: 4, column: 1 },
      to: { row: lr - 1, column: logSpalten.length },
    };
  }

  const buffer = await wb.xlsx.writeBuffer();
  return new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

export interface SicherungErgebnis {
  dateiname: string;
  /** 'ordner' = direkt im konfigurierten Zielordner abgelegt. */
  ziel: 'ordner' | 'download';
  ordnerName: string | null;
}

/**
 * Komplette Teilgebietsdoku erzeugen und sichern: bevorzugt direkt in den
 * konfigurierten Zielordner (lokal synchronisiertes Google Drive), sonst als
 * normaler Browser-Download.
 */
export async function sichereTeilgebietsdoku(
  ktx: TeilgebietsdokuKontext,
): Promise<SicherungErgebnis> {
  const blob = await baueTeilgebietsdoku(ktx);
  const dateiname = teilgebietsdokuDateiname();
  const ordner = await zielordnerName();
  if (await schreibeInZielordner(dateiname, blob)) {
    return { dateiname, ziel: 'ordner', ordnerName: ordner };
  }
  browserDownload(dateiname, blob);
  return { dateiname, ziel: 'download', ordnerName: ordner };
}

/**
 * Kompletten Stand frisch aus der Datenbank laden und sichern. Wird nach
 * jeder Änderung an einem Teilgebiet aufgerufen — bewusst mit DB-Lesung,
 * damit auch die unmittelbar zuvor geschriebenen Protokoll-Einträge in der
 * Datei stehen und der Aufrufer keinen zusammengesetzten Stand übergeben muss.
 */
export async function sichereTeilgebietsdokuAktuell(opts: {
  adminName?: string;
  anlass?: string;
}): Promise<SicherungErgebnis> {
  const [teilgebiete, touren, mitarbeiter, auditLog] = await Promise.all([
    ladeTeilgebiete(),
    ladeTouren(),
    ladeMitarbeiter(),
    ladeAuditLog(),
  ]);
  return sichereTeilgebietsdoku({ teilgebiete, touren, mitarbeiter, auditLog, ...opts });
}
