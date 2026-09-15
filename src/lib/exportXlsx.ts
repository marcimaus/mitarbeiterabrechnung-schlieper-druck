// Excel-Export der Monatsabrechnung mit ExcelJS

import ExcelJS from 'exceljs';
import type {
  Abrechnungsperiode,
  Mitarbeiter,
  MitarbeiterMemo,
  Teilgebiet,
  Parameter,
  VariablerPeriodenZusatz,
  StueckzahlAnpassung,
} from '../types';
import { MEMO_KATEGORIE_LABELS, ROLLEN_LABELS } from '../types';
import type { MitarbeiterAbrechnung, PeriodeData } from './abrechnungslogik';
import { formatierDatum, berechneNettoMinuten } from './zeiterfassung';

// Einheitliche Kopfzeilen-Formatierung für die Archiv-Blätter.
const HEADER_BLAU = 'FF1D4ED8';
function styleHeaderRow(
  ws: ExcelJS.Worksheet,
  rowNr: number,
  anzahlSpalten: number,
  farbe = HEADER_BLAU,
): void {
  const row = ws.getRow(rowNr);
  for (let c = 1; c <= anzahlSpalten; c++) {
    const cell = row.getCell(c);
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: farbe } };
  }
}

const EUR_FMT = '#,##0.00 "€"';

/**
 * Zusätzlicher Kontext für den Archiv-Export: alle Bewegungs- und Stammdaten
 * einer Periode, damit der Export ohne erneutes Öffnen der Periode beantwortbar
 * bleibt. Alle Felder optional — fehlt eines, wird das jeweilige Blatt
 * übersprungen (Abwärtskompatibilität).
 */
export interface AbrechnungExportKontext {
  periodeData?: PeriodeData;
  alleMitarbeiter?: Mitarbeiter[];
  teilgebiete?: Teilgebiet[];
  parameter?: Parameter;
  variablePeriodenZusaetze?: VariablerPeriodenZusatz[];
  stueckzahlAnpassungen?: StueckzahlAnpassung[];
}

export async function exportiereAbrechnung(
  periode: Abrechnungsperiode,
  ergebnisse: MitarbeiterAbrechnung[],
  kontext: AbrechnungExportKontext = {},
): Promise<void> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Schlieper-Druck Mitarbeiterabrechnung';
  wb.created = new Date();

  // ====================================================
  // Blatt 1: Übersicht
  // ====================================================
  const wsUe = wb.addWorksheet('Übersicht');

  wsUe.columns = [
    { header: 'Nr.', key: 'nr', width: 8 },
    { header: 'Name', key: 'name', width: 28 },
    { header: 'Minijob', key: 'minijob', width: 10 },
    { header: 'SV-frei', key: 'svfrei', width: 10 },
    { header: 'Austragen (€)', key: 'austragen', width: 16 },
    { header: 'Zusammentragen (€)', key: 'zusammentragen', width: 20 },
    { header: 'Zeiterfassung (€)', key: 'zeiterfassung', width: 18 },
    { header: 'Min-Boni (€)', key: 'minboni', width: 14 },
    { header: 'Bonus Zeit (€)', key: 'bonuszeit', width: 16 },
    { header: 'Fixes Gehalt (€)', key: 'fix', width: 16 },
    { header: 'Fahrtkosten (€)', key: 'fahrtkosten', width: 16 },
    { header: 'Brutto (€)', key: 'gesamt', width: 14 },
    { header: 'Auszahlung (€)', key: 'auszahlung', width: 16 },
  ];

  // Titel
  wsUe.spliceRows(1, 0, []);
  wsUe.getCell('A1').value = `Abrechnung ${periode.bezeichnung}`;
  wsUe.getCell('A1').font = { bold: true, size: 14 };
  wsUe.getCell('A2').value = `Erstellt: ${new Date().toLocaleDateString('de-DE')}`;
  wsUe.getCell('A2').font = { color: { argb: 'FF888888' }, size: 10 };
  wsUe.spliceRows(3, 0, []);

  // Header-Zeile (Row 4)
  const headers = ['Nr.', 'Name', 'Minijob', 'SV-frei', 'Austragen (€)', 'Zusammentragen (€)', 'Zeiterfassung (€)', 'Min-Boni (€)', 'Bonus Zeit (€)', 'Fixes Gehalt (€)', 'Fahrtkosten (€)', 'Brutto (€)', 'Auszahlung (€)'];
  const headerRow = wsUe.getRow(4);
  headers.forEach((h, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = h;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1D4ED8' } };
    cell.alignment = { horizontal: i > 3 ? 'right' : 'left' };
  });

  ergebnisse.forEach((er, idx) => {
    const istSvBefreit = !!er.mitarbeiter.sozialversicherungsBefreit;
    // WICHTIG: Es wird IMMER die an das Lohnbüro übermittelte Brutto-Summe
    // (bruttoLohnbuero) exportiert — Lohnkonto-Verschiebungen tauchen im
    // Export bewusst NICHT auf.
    const bruttoExport = er.bruttoLohnbuero;
    const r = wsUe.addRow([
      er.mitarbeiter.nummer,
      er.mitarbeiter.name,
      er.mitarbeiter.istMinijob ? 'Ja' : '',
      istSvBefreit ? 'Ja' : '',
      er.austraegerGesamt,
      er.zusammentragenGesamt,
      er.zeitLohn,
      er.ausgabenBoniLohnGesamt,
      er.bonusZeiterfassungEur ?? 0,
      er.fixesGehalt,
      er.fahrtkostenGesamt,
      bruttoExport,
      istSvBefreit ? bruttoExport - er.vorschussSumme : null,
    ]);
    // Zahlenformat Spalten 5..13 (numeric)
    for (let c = 5; c <= 13; c++) {
      r.getCell(c).numFmt = '#,##0.00 "€"';
      r.getCell(c).alignment = { horizontal: 'right' };
    }
    // Auszahlung leer bei nicht-SV-befreit: Hinweistext (Spalte 13)
    if (!istSvBefreit) {
      r.getCell(13).value = 'Lohnbüro';
      r.getCell(13).font = { italic: true, color: { argb: 'FF9CA3AF' } };
      r.getCell(13).numFmt = '@';
    }
    if (er.mitarbeiter.istMinijob) {
      r.getCell(3).font = { bold: true, color: { argb: 'FFB45309' } };
    }
    if (idx % 2 === 1) {
      r.eachCell((cell) => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
      });
    }
  });

  // Summenzeile
  const sumRow = wsUe.addRow([
    '',
    'GESAMT',
    '',
    '',
    ergebnisse.reduce((s, e) => s + e.austraegerGesamt, 0),
    ergebnisse.reduce((s, e) => s + e.zusammentragenGesamt, 0),
    ergebnisse.reduce((s, e) => s + e.zeitLohn, 0),
    ergebnisse.reduce((s, e) => s + e.ausgabenBoniLohnGesamt, 0),
    ergebnisse.reduce((s, e) => s + (e.bonusZeiterfassungEur ?? 0), 0),
    ergebnisse.reduce((s, e) => s + e.fixesGehalt, 0),
    ergebnisse.reduce((s, e) => s + e.fahrtkostenGesamt, 0),
    ergebnisse.reduce((s, e) => s + e.bruttoLohnbuero, 0),
    ergebnisse
      .filter((e) => e.mitarbeiter.sozialversicherungsBefreit)
      .reduce((s, e) => s + (e.bruttoLohnbuero - e.vorschussSumme), 0),
  ]);
  sumRow.getCell(2).font = { bold: true };
  for (let c = 5; c <= 13; c++) {
    sumRow.getCell(c).numFmt = '#,##0.00 "€"';
    sumRow.getCell(c).font = { bold: true };
    sumRow.getCell(c).alignment = { horizontal: 'right' };
  }
  sumRow.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDBEAFE' } };
    cell.border = { top: { style: 'medium', color: { argb: 'FF1D4ED8' } } };
  });

  wsUe.views = [{ state: 'frozen', ySplit: 4 }];

  // ====================================================
  // Blatt 2: Austräger-Details
  // ====================================================
  const wsAu = wb.addWorksheet('Austräger-Details');
  wsAu.columns = [
    { header: 'Name', key: 'name', width: 25 },
    { header: 'Nr.', key: 'nr', width: 8 },
    { header: 'KW', key: 'kw', width: 6 },
    { header: 'Jahr', key: 'jahr', width: 8 },
    { header: 'Teilgebiet', key: 'tg', width: 18 },
    { header: 'Typ', key: 'typ', width: 12 },
    { header: 'Zeit (h)', key: 'zeit', width: 10 },
    { header: 'Grundlohn (€)', key: 'grundlohn', width: 14 },
    { header: 'Springer-Zuschlag (€)', key: 'springer', width: 20 },
    { header: 'Gewichtsbonus (€)', key: 'gewicht', width: 18 },
    { header: 'Sonderbetrag (€)', key: 'sonder', width: 18 },
    { header: 'Gesamt (€)', key: 'gesamt', width: 14 },
  ];

  // Header formatieren
  wsAu.getRow(1).eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1D4ED8' } };
  });

  for (const er of ergebnisse) {
    for (const e of er.austraegerEinsaetze) {
      const r = wsAu.addRow([
        er.mitarbeiter.name,
        er.mitarbeiter.nummer,
        e.kw,
        e.jahr,
        e.teilgebietName,
        e.typ === 'springer' ? 'Springer' : 'Standard',
        e.detail.zeitStunden,
        e.detail.grundlohn,
        e.detail.springerZuschlag,
        e.detail.gewichtsbonus,
        e.detail.sonderbetrag,
        e.detail.gesamt,
      ]);
      for (let c = 7; c <= 12; c++) {
        r.getCell(c).numFmt = c === 7 ? '0.00' : '#,##0.00 "€"';
        r.getCell(c).alignment = { horizontal: 'right' };
      }
    }
  }

  wsAu.views = [{ state: 'frozen', ySplit: 1 }];
  wsAu.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 12 } };

  // ====================================================
  // Blatt 3: Zeiterfassung
  // ====================================================
  const wsZe = wb.addWorksheet('Zeiterfassung');
  wsZe.columns = [
    { header: 'Name', key: 'name', width: 25 },
    { header: 'Nr.', key: 'nr', width: 8 },
    { header: 'Datum', key: 'datum', width: 14 },
    { header: 'Typ', key: 'typ', width: 18 },
    { header: 'Von', key: 'von', width: 10 },
    { header: 'Bis', key: 'bis', width: 10 },
    { header: 'Pause (min)', key: 'pause', width: 12 },
    { header: 'Netto (h)', key: 'netto', width: 10 },
    { header: 'Lohn (€)', key: 'lohn', width: 12 },
    { header: 'Abgerechnet', key: 'abger', width: 13 },
    { header: 'Hinweis', key: 'hinweis', width: 30 },
  ];

  styleHeaderRow(wsZe, 1, 11);

  for (const er of ergebnisse) {
    const stundenlohn = er.zeitLohn > 0 && er.zeitStunden > 0
      ? er.zeitLohn / er.zeitStunden
      : 0;
    // Beide Listen: gelohnte UND nicht-abgerechnete Zeiten — „alle Zeiten".
    const zeilen = [
      ...er.arbeitszeiten.map((az) => ({ az, abgerechnet: true })),
      ...er.arbeitszeitenNichtAbgerechnet.map((az) => ({ az, abgerechnet: false })),
    ];
    for (const { az, abgerechnet } of zeilen) {
      const nettoH = Math.max(0, berechneNettoMinuten(az)) / 60;
      const hinweis = az.nichtBeruecksichtigen
        ? `nicht berücksichtigt${az.nichtBeruecksichtigenGrund ? ': ' + az.nichtBeruecksichtigenGrund : ''}`
        : '';
      const r = wsZe.addRow([
        er.mitarbeiter.name,
        er.mitarbeiter.nummer,
        formatierDatum(az.startTime),
        az.typ,
        new Date(az.startTime).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }),
        az.endTime
          ? new Date(az.endTime).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
          : '—',
        Math.round(az.gesamtPauseMinuten),
        nettoH,
        abgerechnet ? nettoH * stundenlohn : 0,
        abgerechnet ? 'Ja' : 'Nein',
        hinweis,
      ]);
      r.getCell(8).numFmt = '0.00';
      r.getCell(9).numFmt = EUR_FMT;
      r.getCell(8).alignment = { horizontal: 'right' };
      r.getCell(9).alignment = { horizontal: 'right' };
      if (!abgerechnet) {
        r.getCell(10).font = { color: { argb: 'FFB45309' } };
      }
    }
  }

  wsZe.views = [{ state: 'frozen', ySplit: 1 }];
  wsZe.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 11 } };

  // ====================================================
  // Blatt 4: Zusammentragen
  // ====================================================
  const wsZt = wb.addWorksheet('Zusammentragen');
  wsZt.columns = [
    { header: 'Name', key: 'name', width: 25 },
    { header: 'Nr.', key: 'nr', width: 8 },
    { header: 'KW', key: 'kw', width: 6 },
    { header: 'Teilgebiet', key: 'tg', width: 18 },
    { header: 'Stückzahl', key: 'stk', width: 11 },
    { header: 'Stapel', key: 'stapel', width: 9 },
    { header: 'Vorarbeit', key: 'vor', width: 10 },
    { header: 'Int. Beilagen', key: 'intb', width: 12 },
    { header: 'Ext. Beilagen', key: 'extb', width: 12 },
    { header: 'Zeit (h)', key: 'zeit', width: 10 },
    { header: 'Lohn (€)', key: 'lohn', width: 12 },
  ];
  styleHeaderRow(wsZt, 1, 11);
  for (const er of ergebnisse) {
    for (const z of er.zusammentragenEinsaetze) {
      const r = wsZt.addRow([
        er.mitarbeiter.name,
        er.mitarbeiter.nummer,
        z.kw,
        z.teilgebietName ?? '—',
        z.stueckzahl ?? null,
        z.stapelBearbeitet,
        z.istVorarbeit ? 'Ja' : '',
        z.intBeilagenAnzahl ?? null,
        z.extBeilagenAnzahl ?? null,
        z.stunden ?? null,
        z.lohn,
      ]);
      r.getCell(10).numFmt = '0.00';
      r.getCell(11).numFmt = EUR_FMT;
      for (let c = 5; c <= 11; c++) r.getCell(c).alignment = { horizontal: 'right' };
    }
  }
  wsZt.views = [{ state: 'frozen', ySplit: 1 }];
  wsZt.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 11 } };

  // ====================================================
  // Blatt 5: Fahrten (Fahrtkosten der abgerechneten MA)
  // ====================================================
  const wsFa = wb.addWorksheet('Fahrten');
  wsFa.columns = [
    { header: 'Datum', key: 'datum', width: 14 },
    { header: 'Name', key: 'name', width: 25 },
    { header: 'Nr.', key: 'nr', width: 8 },
    { header: 'Strecke (km)', key: 'km', width: 13 },
    { header: 'Satz (€/km)', key: 'satz', width: 12 },
    { header: 'Betrag (€)', key: 'betrag', width: 13 },
    { header: 'Ziel / Touren', key: 'ziel', width: 30 },
    { header: 'Bemerkung', key: 'bem', width: 30 },
  ];
  styleHeaderRow(wsFa, 1, 8);
  let fahrtSumKm = 0;
  let fahrtSumBetrag = 0;
  const fahrtZeilen = ergebnisse
    .flatMap((er) => er.fahrten.map((f) => ({ er, f })))
    .sort((a, b) => a.f.datum.localeCompare(b.f.datum));
  for (const { er, f } of fahrtZeilen) {
    const satz = er.fahrtSatzEurProKm;
    const betrag = f.streckKm * satz;
    fahrtSumKm += f.streckKm;
    fahrtSumBetrag += betrag;
    const r = wsFa.addRow([
      formatierDatum(new Date(f.datum + 'T00:00:00').getTime()),
      er.mitarbeiter.name,
      er.mitarbeiter.nummer,
      f.streckKm,
      satz,
      betrag,
      f.ziel || (f.tourIds && f.tourIds.length ? `Touren: ${f.tourIds.join(', ')}` : '—'),
      f.bemerkung ?? '',
    ]);
    r.getCell(4).numFmt = '#,##0.0';
    r.getCell(5).numFmt = EUR_FMT;
    r.getCell(6).numFmt = EUR_FMT;
    for (let c = 4; c <= 6; c++) r.getCell(c).alignment = { horizontal: 'right' };
  }
  if (fahrtZeilen.length > 0) {
    const sr = wsFa.addRow(['', '', 'Σ Gesamt', fahrtSumKm, '', fahrtSumBetrag, '', '']);
    sr.getCell(3).font = { bold: true };
    sr.getCell(4).numFmt = '#,##0.0';
    sr.getCell(6).numFmt = EUR_FMT;
    for (const c of [4, 6]) {
      sr.getCell(c).font = { bold: true };
      sr.getCell(c).alignment = { horizontal: 'right' };
    }
  }
  wsFa.views = [{ state: 'frozen', ySplit: 1 }];
  wsFa.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 8 } };

  // ====================================================
  // Blatt 6: Vorschüsse, Boni & Lohnkonto
  // ====================================================
  const wsVo = wb.addWorksheet('Vorschüsse & Boni');
  wsVo.columns = [
    { header: 'Name', key: 'name', width: 25 },
    { header: 'Nr.', key: 'nr', width: 8 },
    { header: 'Art', key: 'art', width: 26 },
    { header: 'Betrag (€)', key: 'betrag', width: 13 },
    { header: 'Kommentar', key: 'kommentar', width: 40 },
  ];
  styleHeaderRow(wsVo, 1, 5);
  for (const er of ergebnisse) {
    const ma = er.mitarbeiter;
    const zeile = (art: string, betrag: number, kommentar?: string) => {
      const r = wsVo.addRow([ma.name, ma.nummer, art, betrag, kommentar ?? '']);
      r.getCell(4).numFmt = EUR_FMT;
      r.getCell(4).alignment = { horizontal: 'right' };
    };
    for (const v of er.vorschuesse) zeile('Vorschuss', -v.betragEur, v.bemerkung);
    if (er.bonus) zeile('Periodenzusatz / Bonus', er.bonus, er.bonusKommentar);
    for (const b of er.ausgabenBoni) {
      zeile(`Tätigkeitsbonus (KW ${b.kw}, ${b.minuten} Min)`, b.lohn, b.kommentar);
    }
    for (const lk of er.lohnkontoBuchungenPeriode) {
      const art = lk.art === 'verschiebung' ? 'Lohnkonto-Verschiebung' : 'Lohnkonto-Verrechnung';
      const betrag = lk.art === 'verschiebung' ? -lk.betragEur : lk.betragEur;
      zeile(art, betrag, lk.kommentar);
    }
  }
  wsVo.views = [{ state: 'frozen', ySplit: 1 }];
  wsVo.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 5 } };

  // ====================================================
  // Kontext-basierte Archiv-Blätter (Stammdaten der Periode)
  // ====================================================
  const { periodeData, alleMitarbeiter, teilgebiete, parameter, stueckzahlAnpassungen } = kontext;

  const tgName = (id: string): string =>
    teilgebiete?.find((t) => t.id === id)?.name ?? id;
  const maName = (id: string | null | undefined): string => {
    if (!id) return '—';
    const m = alleMitarbeiter?.find((x) => x.id === id);
    return m ? `${m.name} (${m.nummer})` : id;
  };

  // ---- Blatt 7: Mitarbeiter-Stammdaten (der abgerechneten MA) ----
  {
    const wsSt = wb.addWorksheet('Mitarbeiter-Stammdaten');
    wsSt.columns = [
      { header: 'Nr.', key: 'nr', width: 8 },
      { header: 'Name', key: 'name', width: 26 },
      { header: 'Geburtsdatum', key: 'geb', width: 13 },
      { header: 'Straße', key: 'str', width: 24 },
      { header: 'PLZ', key: 'plz', width: 8 },
      { header: 'Ort', key: 'ort', width: 16 },
      { header: 'Telefon', key: 'tel', width: 15 },
      { header: 'Mobil', key: 'mob', width: 15 },
      { header: 'E-Mail', key: 'email', width: 26 },
      { header: 'Rollen', key: 'rollen', width: 24 },
      { header: 'Stundenlohn ind. (€)', key: 'slohn', width: 16 },
      { header: 'Festgehalt', key: 'fest', width: 11 },
      { header: 'Festgehalt (€)', key: 'feste', width: 14 },
      { header: 'Wochenstd.', key: 'wstd', width: 11 },
      { header: 'Monatsstd.', key: 'mstd', width: 11 },
      { header: 'Minijob', key: 'mini', width: 9 },
      { header: 'SV-frei', key: 'sv', width: 9 },
      { header: 'Lohngrenze ind. (€)', key: 'lgrenze', width: 16 },
      { header: 'Fahrtkosten €/km', key: 'fkm', width: 15 },
      { header: 'Bonus-Min/Ausgabe', key: 'bmin', width: 16 },
      { header: 'Anmeldestatus', key: 'anm', width: 26 },
      { header: 'Abgemeldet', key: 'abg', width: 11 },
    ];
    styleHeaderRow(wsSt, 1, 22);
    const sortiertMa = [...ergebnisse].sort((a, b) =>
      a.mitarbeiter.nummer.localeCompare(b.mitarbeiter.nummer, 'de', { numeric: true }),
    );
    for (const er of sortiertMa) {
      const m = er.mitarbeiter;
      const r = wsSt.addRow([
        m.nummer,
        m.name,
        m.geburtsdatum ?? '',
        m.adresse?.strasse ?? '',
        m.adresse?.plz ?? '',
        m.adresse?.ort ?? '',
        m.telefon ?? '',
        m.mobilnummer ?? '',
        m.email ?? '',
        (m.rollen ?? []).map((rr) => ROLLEN_LABELS[rr] ?? rr).join(', '),
        m.stundenlohnIndividuell ?? null,
        m.hatFestgehalt ? 'Ja' : '',
        m.hatFestgehalt ? (m.festgehaltEur ?? null) : null,
        m.wochenstundenFestgehalt ?? null,
        m.monatsstundenFestgehalt ?? null,
        m.istMinijob ? 'Ja' : '',
        m.sozialversicherungsBefreit ? 'Ja' : '',
        m.lohngrenzeIndividuellEur ?? null,
        m.fahrkostenEurProKm ?? null,
        m.ausgabenBonusMinuten ?? null,
        m.anmeldungStatus ?? (m.nochNichtAngemeldet ? 'noch nicht angemeldet' : ''),
        m.abgemeldet ? 'Ja' : '',
      ]);
      for (const c of [11, 13, 18, 19]) r.getCell(c).numFmt = EUR_FMT;
      for (const c of [11, 13, 14, 15, 18, 19, 20]) r.getCell(c).alignment = { horizontal: 'right' };
    }
    wsSt.views = [{ state: 'frozen', ySplit: 1, xSplit: 2 }];
    wsSt.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 22 } };
  }

  // ---- Blatt 8: Teilgebiete (Strecken & Stückzahlen) ----
  // Verwendete Werte: bevorzugt der beim Monatswechsel fixierte Snapshot,
  // sonst der aktuelle Stammdaten-Stand. Die Quelle wird je Zeile vermerkt.
  if (teilgebiete && teilgebiete.length > 0) {
    const tgSnaps = periode.monatswechselSnapshot?.teilgebietSnapshots;
    const snapMap = new Map((tgSnaps ?? []).map((s) => [s.id, s]));
    const wsTg = wb.addWorksheet('Teilgebiete');
    wsTg.columns = [
      { header: 'Name', key: 'name', width: 16 },
      { header: 'PLZ', key: 'plz', width: 8 },
      { header: 'Tour', key: 'tour', width: 10 },
      { header: 'Standardausträger', key: 'sa', width: 26 },
      { header: 'Stückzahl (verw.)', key: 'stk', width: 15 },
      { header: 'Wegstrecke (m, verw.)', key: 'weg', width: 18 },
      { header: 'Anz. Straßen', key: 'anzstr', width: 12 },
      { header: 'Σ Straßen-Stk.', key: 'sumstr', width: 14 },
      { header: 'Sonderauslagen', key: 'sonder', width: 13 },
      { header: 'Auslagestelle', key: 'ausl', width: 12 },
      { header: 'Aktiv', key: 'aktiv', width: 8 },
      { header: 'Quelle Werte', key: 'quelle', width: 16 },
    ];
    styleHeaderRow(wsTg, 1, 12);
    const sortiertTg = [...teilgebiete].sort((a, b) =>
      a.name.localeCompare(b.name, 'de', { numeric: true }),
    );
    for (const tg of sortiertTg) {
      const snap = snapMap.get(tg.id);
      const stk = snap?.stueckzahl ?? tg.stueckzahl;
      const weg = snap?.wegstreckeM ?? tg.wegstreckeM;
      const saId = snap?.standardAustraegerId ?? tg.standardAustraegerId;
      const sumStr = (tg.strassen ?? []).reduce((s, x) => s + (x.stueckzahl || 0), 0);
      const sumSonder = (tg.sonderauslagen ?? []).reduce((s, x) => s + (x.stueckzahl || 0), 0);
      const r = wsTg.addRow([
        tg.name,
        tg.plz,
        tg.tourId ?? '',
        maName(saId),
        stk,
        weg,
        (tg.strassen ?? []).length,
        sumStr,
        sumSonder,
        tg.istAuslagestelle ? 'Ja' : '',
        tg.isActive ? 'Ja' : '',
        snap ? 'Monatswechsel-Snapshot' : 'aktuell',
      ]);
      for (const c of [5, 6, 7, 8, 9]) r.getCell(c).alignment = { horizontal: 'right' };
    }
    wsTg.views = [{ state: 'frozen', ySplit: 1 }];
    wsTg.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 12 } };

    // ---- Blatt 9: Straßen-Detail (Stückzahlen je Straße) ----
    const wsStr = wb.addWorksheet('Straßen-Detail');
    wsStr.columns = [
      { header: 'Teilgebiet', key: 'tg', width: 16 },
      { header: 'Straße', key: 'str', width: 32 },
      { header: 'Stückzahl', key: 'stk', width: 11 },
      { header: 'Plus-Code', key: 'pc', width: 18 },
    ];
    styleHeaderRow(wsStr, 1, 4);
    for (const tg of sortiertTg) {
      for (const s of tg.strassen ?? []) {
        const r = wsStr.addRow([tg.name, s.strassenname, s.stueckzahl, s.plusCode ?? '']);
        r.getCell(3).alignment = { horizontal: 'right' };
      }
      for (const so of tg.sonderauslagen ?? []) {
        const r = wsStr.addRow([tg.name, `[Sonderauslage] ${so.bezeichnung}`, so.stueckzahl, so.adresse ?? '']);
        r.getCell(3).alignment = { horizontal: 'right' };
      }
    }
    wsStr.views = [{ state: 'frozen', ySplit: 1 }];
    wsStr.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 4 } };

    // Vorgemerkte Stückzahl-Anpassungen (noch nicht übernommen) — als Hinweis.
    if (stueckzahlAnpassungen && stueckzahlAnpassungen.length > 0) {
      wsTg.addRow([]);
      const hr = wsTg.addRow(['Vorgemerkte Stückzahl-Anpassungen (noch nicht übernommen)']);
      hr.getCell(1).font = { bold: true, color: { argb: 'FFB45309' } };
      const hr2 = wsTg.addRow(['Teilgebiet', 'neue Stückzahl', 'Bemerkung']);
      hr2.eachCell((c) => (c.font = { bold: true }));
      for (const a of stueckzahlAnpassungen) {
        wsTg.addRow([tgName(a.teilgebietId), a.neueStueckzahl, a.bemerkung ?? '']);
      }
    }
  }

  // ---- Blatt 10: Ausgaben + Blatt 11: Beilagenaufträge ----
  if (periodeData) {
    const ausgabenSort = [...periodeData.ausgaben].sort((a, b) => a.kw - b.kw);
    const beilagenProAusgabe = new Map<string, number>();
    for (const b of periodeData.beilagen) {
      beilagenProAusgabe.set(b.ausgabeId, (beilagenProAusgabe.get(b.ausgabeId) ?? 0) + 1);
    }

    const wsAg = wb.addWorksheet('Ausgaben');
    wsAg.columns = [
      { header: 'KW', key: 'kw', width: 6 },
      { header: 'Jahr', key: 'jahr', width: 8 },
      { header: 'Status', key: 'status', width: 14 },
      { header: 'Seitenzahl', key: 'seiten', width: 11 },
      { header: 'Anz. Stapel', key: 'stapel', width: 11 },
      { header: 'Grammatur (g/m²)', key: 'gramm', width: 15 },
      { header: 'Format (mm)', key: 'format', width: 14 },
      { header: 'Vorarbeit freig.', key: 'vorarbeit', width: 14 },
      { header: 'Anz. Beilagen', key: 'anzb', width: 13 },
    ];
    styleHeaderRow(wsAg, 1, 9);
    for (const a of ausgabenSort) {
      const r = wsAg.addRow([
        a.kw,
        a.jahr,
        a.status,
        a.seitenzahl,
        a.stapelAnzahl,
        a.grammaturGqm,
        a.seitenformatMm ? `${a.seitenformatMm.breite}×${a.seitenformatMm.hoehe}` : '',
        a.vorarbeitFreigegeben ? 'Ja' : '',
        beilagenProAusgabe.get(a.id) ?? 0,
      ]);
      for (const c of [1, 2, 4, 5, 6, 9]) r.getCell(c).alignment = { horizontal: 'right' };
    }
    wsAg.views = [{ state: 'frozen', ySplit: 1 }];
    wsAg.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 9 } };

    // Beilagenaufträge
    const kwVonAusgabe = new Map(periodeData.ausgaben.map((a) => [a.id, a.kw]));
    const wsBe = wb.addWorksheet('Beilagenaufträge');
    wsBe.columns = [
      { header: 'KW', key: 'kw', width: 6 },
      { header: 'Arbeitstitel', key: 'titel', width: 26 },
      { header: 'Kunde', key: 'kunde', width: 24 },
      { header: 'int/ext', key: 'kz', width: 8 },
      { header: 'Format', key: 'format', width: 10 },
      { header: 'Gewicht (g/Stk)', key: 'gewicht', width: 14 },
      { header: 'Anz. Teilgebiete', key: 'anztg', width: 14 },
      { header: 'Gesamtauflage', key: 'auflage', width: 14 },
      { header: 'Teilgebiete', key: 'tgs', width: 50 },
    ];
    styleHeaderRow(wsBe, 1, 9);
    const beilagenSort = [...periodeData.beilagen].sort((a, b) => {
      const ka = kwVonAusgabe.get(a.ausgabeId) ?? 0;
      const kb = kwVonAusgabe.get(b.ausgabeId) ?? 0;
      return ka !== kb ? ka - kb : a.kundenname.localeCompare(b.kundenname, 'de');
    });
    for (const b of beilagenSort) {
      const tgIds = b.teilgebietIds ?? [];
      const auflage = tgIds.reduce((s, id) => {
        const tg = teilgebiete?.find((t) => t.id === id);
        return s + (tg?.stueckzahl ?? 0);
      }, 0);
      const r = wsBe.addRow([
        kwVonAusgabe.get(b.ausgabeId) ?? '',
        b.arbeitstitel,
        b.kundenname,
        b.kennzeichen,
        b.format,
        b.gewichtGStk,
        tgIds.length,
        teilgebiete ? auflage : null,
        tgIds.map((id) => tgName(id)).join(', '),
      ]);
      for (const c of [1, 6, 7, 8]) r.getCell(c).alignment = { horizontal: 'right' };
      r.getCell(9).alignment = { wrapText: true, vertical: 'top' };
    }
    wsBe.views = [{ state: 'frozen', ySplit: 1 }];
    wsBe.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 9 } };
  }

  // ---- Blatt 12: Verwendete Parameter ----
  if (parameter) {
    // Bevorzugt der zum Monatswechsel fixierte Parameter-Snapshot, sonst der
    // bei Periodenanlage gespeicherte, sonst der aktuelle Stand.
    const snap = periode.monatswechselSnapshot?.paramSnapshot ?? periode.paramSnapshot;
    const quelle = periode.monatswechselSnapshot?.paramSnapshot
      ? 'Monatswechsel-Snapshot'
      : periode.paramSnapshot
        ? 'Snapshot bei Periodenanlage'
        : 'aktueller Stand';
    const wert = <K extends keyof Parameter>(k: K): Parameter[K] =>
      (snap && k in snap ? (snap as Parameter)[k] : parameter[k]);

    const wsPa = wb.addWorksheet('Parameter');
    wsPa.getCell('A1').value = 'Verwendete Abrechnungs-Parameter';
    wsPa.getCell('A1').font = { bold: true, size: 14 };
    wsPa.getCell('A2').value = `Quelle: ${quelle}`;
    wsPa.getCell('A2').font = { italic: true, size: 10, color: { argb: 'FF888888' } };
    const headerRowPa = 4;
    wsPa.getRow(headerRowPa).values = ['Parameter', 'Wert', 'Einheit'];
    styleHeaderRow(wsPa, headerRowPa, 3);
    wsPa.columns = [{ width: 52 }, { width: 16 }, { width: 14 }];

    const rows: [string, string | number, string][] = [
      ['Laufgeschwindigkeit', wert('laufgeschwindigkeitMProH'), 'm/h'],
      ['Steckzeit', wert('steckzeitStkProH'), 'Stk/h'],
      ['Stundenlohn Erwachsene (Austragen)', wert('stundenlohnErwachseneAustr'), '€/h'],
      ['Stundenlohn Minderjährige (Austragen)', wert('stundenlohnMinderjAustr'), '€/h'],
      ['Mindeststundenlohn (Warnschwelle)', wert('mindeststundenlohn'), '€/h'],
      ['Zusammentragen: erste 2 Stapel', wert('zusammentragGeschwErste2StapelStkProH'), 'Stk/h'],
      ['Zusammentragen: weitere Stapel', wert('zusammentragGeschwWeitereStapelStkProH'), 'Stk/h'],
      ['Externe Beilage einlegen', wert('externeBeilageEinlegeGeschwStkProH'), 'Stk/h'],
      ['Stundenlohn Erwachsene (Zusammentragen)', wert('stundenlohnErwachseneZusammen'), '€/h'],
      ['Stundenlohn Minderjährige (Zusammentragen)', wert('stundenlohnMinderjZusammen'), '€/h'],
      ['Springer-Zuschlag', wert('springerZuschlagProzent'), '%'],
      ['Gewichtszulage Anzeigenblatt', wert('gewichtszulageAnzeigenblattEurKg'), '€/kg'],
      ['Gewichtszulage Beilagen', wert('gewichtszulageBeilagenEurKg'), '€/kg'],
      ['Standard-Grammatur', wert('standardGrammurGqm'), 'g/m²'],
      ['Standard-Format Breite', wert('standardSeitenformatBreiteMm'), 'mm'],
      ['Standard-Format Höhe', wert('standardSeitenformatHoeheMm'), 'mm'],
      ['Fahrtkosten', wert('fahrkostenEurProKm'), '€/km'],
      ['Minijob-Grenze', wert('minijobGrenzeEurProMonat'), '€/Monat'],
      ['Bonus Zeiterfassung Austragen', wert('bonusZeiterfassungEur') ?? 0, '€/Einsatz'],
      ['Abrechnung Austragen nach Ist-Zeit', wert('austragenNachIstZeit') ? 'Ja' : 'Nein', ''],
      ['Abrechnung Zusammentragen nach Ist-Zeit', wert('zusammentragenNachIstZeit') ? 'Ja' : 'Nein', ''],
    ];
    let pr = headerRowPa + 1;
    for (const [label, value, einheit] of rows) {
      wsPa.getRow(pr).values = [label, value, einheit];
      wsPa.getRow(pr).getCell(2).alignment = { horizontal: 'right' };
      pr++;
    }
    wsPa.views = [{ state: 'frozen', ySplit: headerRowPa }];
  }

  // ====================================================
  // Download auslösen
  // ====================================================
  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Abrechnung_${periode.bezeichnung.replace(/\s/g, '_')}_${new Date().toISOString().slice(0, 10)}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}

// ============================================================
// Lohnübermittlung — schlanker Export für das Lohnbüro
// ============================================================
//
// Inhalt (laut Vorgabe):
//   - Periode (Header)
//   - je MA: Name, Nummer, Vorschuss, Bruttolohn (= bruttoLohnbuero, also nach
//     Verrechnung Lohnkonto, ohne Lohnkonto explizit zu erwähnen), Fahrtkosten,
//     Auszahlung (nur bei SV-befreiten MAs; sonst ermittelt das Lohnbüro
//     den Zahlbetrag nach Abzügen)
//   - Schluss: Liste abzumeldender Mitarbeiter
//
export async function exportiereLohnuebermittlung(
  periode: Abrechnungsperiode,
  ergebnisse: MitarbeiterAbrechnung[],
  alleMitarbeiter: Mitarbeiter[],
  memos: MitarbeiterMemo[] = [],
): Promise<void> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Schlieper-Druck Mitarbeiterabrechnung';
  wb.created = new Date();

  const ws = wb.addWorksheet('Lohnübermittlung');

  // Header-Block
  ws.getCell('A1').value = `Lohnübermittlung — ${periode.bezeichnung}`;
  ws.getCell('A1').font = { bold: true, size: 14 };
  ws.mergeCells('A1:F1');
  ws.getCell('A2').value = `Erstellt: ${new Date().toLocaleDateString('de-DE')}`;
  ws.getCell('A2').font = { italic: true, size: 9, color: { argb: 'FF888888' } };
  ws.mergeCells('A2:F2');

  // Spaltenüberschriften — ab Zeile 4
  const headerRow = 4;
  ws.getRow(headerRow).values = [
    'Mitarbeiter-Nr.',
    'Name',
    'Vorschuss (€)',
    'Bruttolohn (€)',
    'Fahrtkosten (€)',
    'Auszahlung (€) — nur SV-befreit',
  ];
  ws.getRow(headerRow).font = { bold: true };
  ws.getRow(headerRow).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFE8EEF7' },
  };
  ws.columns = [
    { width: 14 },
    { width: 32 },
    { width: 14 },
    { width: 16 },
    { width: 16 },
    { width: 30 },
  ];

  // Reihenfolge wie in der Ansicht „Abrechnung": `ergebnisse` ist bereits von
  // `berechneAbrechnung` sortiert (Festgehalt → Stunden → Saldo → Brutto desc).
  // Diese Reihenfolge wird 1:1 übernommen.
  const sortiert = ergebnisse;

  let r = headerRow + 1;
  let sumVorschuss = 0;
  let sumBrutto = 0;
  let sumFaKo = 0;
  let sumAuszahlung = 0;
  for (const e of sortiert) {
    // Auszahlung nur bei SV-befreiten MAs (Brutto = Netto, keine Abzüge).
    // Bei allen anderen ermittelt das Lohnbüro den Zahlbetrag → Zelle leer.
    const istSvBefreit = !!e.mitarbeiter.sozialversicherungsBefreit;
    const auszahlung = istSvBefreit ? e.bruttoLohnbuero - e.vorschussSumme : null;
    ws.getRow(r).values = [
      e.mitarbeiter.nummer,
      e.mitarbeiter.name,
      Number((e.vorschussSumme ?? 0).toFixed(2)),
      Number((e.bruttoLohnbuero ?? 0).toFixed(2)),
      Number((e.fahrtkostenGesamt ?? 0).toFixed(2)),
      auszahlung === null ? null : Number(auszahlung.toFixed(2)),
    ];
    for (let c = 3; c <= 6; c++) {
      ws.getRow(r).getCell(c).numFmt = '#,##0.00 "€"';
      ws.getRow(r).getCell(c).alignment = { horizontal: 'right' };
    }
    sumVorschuss += e.vorschussSumme ?? 0;
    sumBrutto += e.bruttoLohnbuero ?? 0;
    sumFaKo += e.fahrtkostenGesamt ?? 0;
    sumAuszahlung += auszahlung ?? 0;
    r++;
  }

  // Summenzeile
  const sumRow = r;
  ws.getRow(sumRow).values = [
    '',
    'Σ Gesamt',
    Number(sumVorschuss.toFixed(2)),
    Number(sumBrutto.toFixed(2)),
    Number(sumFaKo.toFixed(2)),
    Number(sumAuszahlung.toFixed(2)),
  ];
  ws.getRow(sumRow).font = { bold: true };
  ws.getRow(sumRow).border = {
    top: { style: 'thin' },
    bottom: { style: 'double' },
  };
  for (let c = 3; c <= 6; c++) {
    ws.getRow(sumRow).getCell(c).numFmt = '#,##0.00 "€"';
    ws.getRow(sumRow).getCell(c).alignment = { horizontal: 'right' };
  }

  ws.views = [{ state: 'frozen', ySplit: headerRow }];

  // ====================================================
  // Abmeldungen
  // ====================================================
  // (Eine Liste „Anzumeldende Mitarbeiter" wird bewusst NICHT mehr
  // ausgegeben.)
  //
  // Implizite Trigger (ersetzteMitarbeiterId an einem anderen MA, oder
  // `letzteAbrechnungsperiodeId === periode.id` ohne Snapshot) werden
  // NICHT automatisch in den Export aufgenommen — reine UI-Vorschläge.
  //
  // „Abzumeldende Mitarbeiter" — STRENG eingeschränkt auf den fixierten
  // Abmeldungs-Snapshot einer **abgeschlossenen** Periode. Damit ist
  // ausgeschlossen, dass alte `abgemeldet=true`-Datenleichen (z. B. aus
  // einem früheren, später wieder geöffneten Abschluss) erneut in den
  // Export einfließen. Vor dem Abschluss erscheint die Sektion gar nicht.
  type AbmeldeEintrag = { ma: Mitarbeiter; datumIso: string };
  const periodeIstAbgeschlossen = periode.status === 'abgeschlossen';
  let abzumelden: AbmeldeEintrag[] = [];
  if (periodeIstAbgeschlossen && periode.abmeldungenSnapshot?.eintraege?.length) {
    for (const eintrag of periode.abmeldungenSnapshot.eintraege) {
      const ma = alleMitarbeiter.find((m) => m.id === eintrag.mitarbeiterId);
      if (!ma) continue;
      if (ma.vorlaeufigNichtAbmelden) continue;
      abzumelden.push({ ma, datumIso: eintrag.abmeldedatum });
    }
  }
  abzumelden.sort((a, b) => a.ma.name.localeCompare(b.ma.name, 'de'));

  // „Vorläufig nicht abmelden" — Bedarfs-Springer, die das Lohnbüro
  // NICHT automatisch abmelden soll. Werden in jeder Übermittlung als
  // Erinnerungsblock aufgeführt — unabhängig davon, ob sie in dieser
  // Periode eine Auszahlung haben. Nur aktive, noch nicht abgemeldete
  // MAs werden gelistet (sonst inkonsistent zum Aktiv-Status).
  const nichtAbmeldenHinweis = alleMitarbeiter
    .filter((m) => m.vorlaeufigNichtAbmelden && m.isActive && !m.abgemeldet)
    .sort((a, b) => a.name.localeCompare(b.name, 'de'));

  let blockRow = sumRow + 3;
  if (abzumelden.length > 0) {
    ws.getCell(`A${blockRow}`).value = 'Abzumeldende Mitarbeiter';
    ws.getCell(`A${blockRow}`).font = { bold: true, size: 12 };
    ws.mergeCells(`A${blockRow}:F${blockRow}`);
    blockRow++;
    ws.getCell(`A${blockRow}`).value =
      'Aus dem fixierten Abmeldungs-Snapshot der Periode (beim Periodenabschluss bestätigt).';
    ws.getCell(`A${blockRow}`).font = { italic: true, size: 10, color: { argb: 'FF777777' } };
    ws.mergeCells(`A${blockRow}:F${blockRow}`);
    blockRow++;
    ws.getRow(blockRow).values = ['Mitarbeiter-Nr.', 'Name', 'Datum der Abmeldung'];
    ws.getRow(blockRow).font = { bold: true };
    ws.getRow(blockRow).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFFFE9E0' },
    };
    blockRow++;
    for (const { ma, datumIso } of abzumelden) {
      ws.getRow(blockRow).values = [
        ma.nummer,
        ma.name,
        formatierDatum(new Date(datumIso).getTime()),
      ];
      blockRow++;
    }
    blockRow += 2;
  }

  if (nichtAbmeldenHinweis.length > 0) {
    ws.getCell(`A${blockRow}`).value = 'Vorläufig NICHT abmelden — bitte angemeldet lassen';
    ws.getCell(`A${blockRow}`).font = { bold: true, size: 12 };
    ws.mergeCells(`A${blockRow}:F${blockRow}`);
    blockRow++;
    ws.getCell(`A${blockRow}`).value =
      'Diese Mitarbeiter sollen beim Lohnbüro angemeldet bleiben (Bedarfs-Springer). Auch wenn mehrere Monate ohne Auszahlung folgen, bitte nicht automatisch abmelden.';
    ws.getCell(`A${blockRow}`).font = { italic: true, size: 10, color: { argb: 'FF7A4F00' } };
    ws.mergeCells(`A${blockRow}:F${blockRow}`);
    ws.getRow(blockRow).alignment = { wrapText: true, vertical: 'middle' };
    ws.getRow(blockRow).height = 30;
    blockRow++;
    ws.getRow(blockRow).values = ['Mitarbeiter-Nr.', 'Name', 'Hinweis'];
    ws.getRow(blockRow).font = { bold: true };
    ws.getRow(blockRow).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFFFF4CC' },
    };
    blockRow++;
    for (const m of nichtAbmeldenHinweis) {
      ws.getRow(blockRow).values = [
        m.nummer,
        m.name,
        'vorläufig nicht abmelden',
      ];
      blockRow++;
    }
  }

  // ====================================================
  // Memos zur Lohnübermittlung (Abrechnungsvorbereitung)
  // ====================================================
  // Werden NACH allen anderen Blöcken als separate Sektion angefügt.
  // Admin-only-Memos (nurAdmin=true) sind enthalten — das Lohnbüro
  // bekommt alle Memos, die zur Periode gehören.
  const periodenMemos = memos
    .filter((memo) => memo.abrechnungsperiodeId === periode.id)
    .sort((a, b) => {
      const ma = alleMitarbeiter.find((m) => m.id === a.mitarbeiterId);
      const mb = alleMitarbeiter.find((m) => m.id === b.mitarbeiterId);
      const na = ma?.name ?? '';
      const nb = mb?.name ?? '';
      return na.localeCompare(nb, 'de');
    });
  if (periodenMemos.length > 0) {
    blockRow += 2;
    ws.getCell(`A${blockRow}`).value = `Memos zur Lohnübermittlung (${periodenMemos.length})`;
    ws.getCell(`A${blockRow}`).font = { bold: true, size: 12 };
    ws.mergeCells(`A${blockRow}:F${blockRow}`);
    blockRow++;
    ws.getCell(`A${blockRow}`).value =
      'Hinweise / Mitteilungen zu einzelnen Mitarbeitern — z. B. IBAN-/Adress-Änderungen, Krankmeldungen, Auswertungsanfragen.';
    ws.getCell(`A${blockRow}`).font = { italic: true, size: 10, color: { argb: 'FF6B7280' } };
    ws.mergeCells(`A${blockRow}:F${blockRow}`);
    ws.getRow(blockRow).alignment = { wrapText: true, vertical: 'middle' };
    ws.getRow(blockRow).height = 24;
    blockRow++;
    ws.getRow(blockRow).values = ['Mitarbeiter-Nr.', 'Name', 'Kategorie', 'Memo'];
    ws.getRow(blockRow).font = { bold: true };
    ws.getRow(blockRow).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFDBEAFE' },
    };
    // Memo-Spalte breiter, damit längere Texte lesbar bleiben.
    ws.getColumn(4).width = 70;
    blockRow++;
    for (const memo of periodenMemos) {
      const ma = alleMitarbeiter.find((m) => m.id === memo.mitarbeiterId);
      ws.getRow(blockRow).values = [
        ma?.nummer ?? '',
        ma?.name ?? '— gelöscht —',
        MEMO_KATEGORIE_LABELS[memo.kategorie] ?? memo.kategorie,
        memo.text,
      ];
      ws.getRow(blockRow).alignment = { wrapText: true, vertical: 'top' };
      // Höhe grob proportional zur Textlänge — ExcelJS macht keine
      // Auto-Höhe für wrappedText, daher pragmatisch geschätzt.
      const zeilen = Math.max(1, Math.ceil(memo.text.length / 80));
      ws.getRow(blockRow).height = Math.min(120, 16 * zeilen);
      blockRow++;
    }
  }

  // Download
  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Lohnuebermittlung_${periode.bezeichnung.replace(/\s/g, '_')}_${new Date().toISOString().slice(0, 10)}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}
