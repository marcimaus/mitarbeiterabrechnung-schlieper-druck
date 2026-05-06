// Excel-Export der Monatsabrechnung mit ExcelJS

import ExcelJS from 'exceljs';
import type { Abrechnungsperiode, Mitarbeiter } from '../types';
import type { MitarbeiterAbrechnung } from './abrechnungslogik';
import { formatierDatum } from './zeiterfassung';

export async function exportiereAbrechnung(
  periode: Abrechnungsperiode,
  ergebnisse: MitarbeiterAbrechnung[]
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
  const headers = ['Nr.', 'Name', 'Minijob', 'SV-frei', 'Austragen (€)', 'Zusammentragen (€)', 'Zeiterfassung (€)', 'Min-Boni (€)', 'Fixes Gehalt (€)', 'Fahrtkosten (€)', 'Brutto (€)', 'Auszahlung (€)'];
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
      er.fixesGehalt,
      er.fahrtkostenGesamt,
      bruttoExport,
      istSvBefreit ? bruttoExport - er.vorschussSumme : null,
    ]);
    // Zahlenformat Spalten 5..12 (numeric)
    for (let c = 5; c <= 12; c++) {
      r.getCell(c).numFmt = '#,##0.00 "€"';
      r.getCell(c).alignment = { horizontal: 'right' };
    }
    // Auszahlung leer bei nicht-SV-befreit: Hinweistext (Spalte 12)
    if (!istSvBefreit) {
      r.getCell(12).value = 'Lohnbüro';
      r.getCell(12).font = { italic: true, color: { argb: 'FF9CA3AF' } };
      r.getCell(12).numFmt = '@';
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
    ergebnisse.reduce((s, e) => s + e.fixesGehalt, 0),
    ergebnisse.reduce((s, e) => s + e.fahrtkostenGesamt, 0),
    ergebnisse.reduce((s, e) => s + e.bruttoLohnbuero, 0),
    ergebnisse
      .filter((e) => e.mitarbeiter.sozialversicherungsBefreit)
      .reduce((s, e) => s + (e.bruttoLohnbuero - e.vorschussSumme), 0),
  ]);
  sumRow.getCell(2).font = { bold: true };
  for (let c = 5; c <= 12; c++) {
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
  ];

  wsZe.getRow(1).eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1D4ED8' } };
  });

  for (const er of ergebnisse) {
    for (const az of er.arbeitszeiten) {
      const nettoMin = er.zeitStunden > 0
        ? (az.endTime ? (az.endTime - az.startTime) / 60_000 - az.gesamtPauseMinuten : 0)
        : 0;
      const nettoH = Math.max(0, nettoMin) / 60;
      const stundenlohn = er.zeitLohn > 0 && er.zeitStunden > 0
        ? er.zeitLohn / er.zeitStunden
        : 0;
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
        nettoH * stundenlohn,
      ]);
      r.getCell(8).numFmt = '0.00';
      r.getCell(9).numFmt = '#,##0.00 "€"';
      r.getCell(8).alignment = { horizontal: 'right' };
      r.getCell(9).alignment = { horizontal: 'right' };
    }
  }

  wsZe.views = [{ state: 'frozen', ySplit: 1 }];
  wsZe.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 9 } };

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
//     Verrechnung Lohnkonto, ohne Lohnkonto explizit zu erwähnen), Fahrtkosten
//   - Schluss: Liste an-/abzumeldender Mitarbeiter
//
export async function exportiereLohnuebermittlung(
  periode: Abrechnungsperiode,
  ergebnisse: MitarbeiterAbrechnung[],
  alleMitarbeiter: Mitarbeiter[]
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
    'Auszahlung (€)',
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
    { width: 16 },
  ];

  // Sortierung: nach Name
  const sortiert = [...ergebnisse].sort((a, b) => a.mitarbeiter.name.localeCompare(b.mitarbeiter.name, 'de'));

  let r = headerRow + 1;
  let sumVorschuss = 0;
  let sumBrutto = 0;
  let sumFaKo = 0;
  let sumAuszahlung = 0;
  for (const e of sortiert) {
    const auszahlung = e.bruttoLohnbuero - e.vorschussSumme;
    ws.getRow(r).values = [
      e.mitarbeiter.nummer,
      e.mitarbeiter.name,
      Number((e.vorschussSumme ?? 0).toFixed(2)),
      Number((e.bruttoLohnbuero ?? 0).toFixed(2)),
      Number((e.fahrtkostenGesamt ?? 0).toFixed(2)),
      Number(auszahlung.toFixed(2)),
    ];
    for (let c = 3; c <= 6; c++) {
      ws.getRow(r).getCell(c).numFmt = '#,##0.00 "€"';
      ws.getRow(r).getCell(c).alignment = { horizontal: 'right' };
    }
    sumVorschuss += e.vorschussSumme ?? 0;
    sumBrutto += e.bruttoLohnbuero ?? 0;
    sumFaKo += e.fahrtkostenGesamt ?? 0;
    sumAuszahlung += auszahlung;
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
  // An-/Abmeldungen
  // ====================================================
  // Mitarbeiter, die noch ANgemeldet werden müssen — und Beträge in dieser
  // Periode haben (nur dann ist die Anmeldung relevant).
  const anzumelden = ergebnisse
    .filter((e) => e.mitarbeiter.nochNichtAngemeldet)
    .map((e) => e.mitarbeiter)
    .sort((a, b) => a.name.localeCompare(b.name, 'de'));

  // Mitarbeiter, die in dieser Periode ABgemeldet wurden (oder mit
  // Abmelde-Datum in dieser Periode).
  const inPeriodeKws = new Set(periode.kalenderwochen);
  const istInPeriode = (datumIso?: string) => {
    if (!datumIso) return false;
    const d = new Date(datumIso);
    if (isNaN(d.getTime())) return false;
    if (d.getFullYear() !== periode.jahr) return false;
    // Monat: 0-indexed → +1
    return d.getMonth() + 1 === periode.monat;
  };
  const abzumelden = alleMitarbeiter
    .filter((m) => m.abgemeldet && istInPeriode(m.abmeldungUebermittlungDatum))
    .sort((a, b) => a.name.localeCompare(b.name, 'de'));
  // Fallback: wenn abmeldungUebermittlungDatum nicht gesetzt aber MA nicht
  // mehr aktiv und in dieser Periode noch Bewegung hatte → trotzdem listen.
  const ergebnisIds = new Set(ergebnisse.map((e) => e.mitarbeiter.id));
  for (const m of alleMitarbeiter) {
    if (m.abgemeldet && !abzumelden.includes(m) && ergebnisIds.has(m.id) && !m.abmeldungUebermittlungDatum) {
      abzumelden.push(m);
    }
  }
  void inPeriodeKws;

  let blockRow = sumRow + 3;
  if (anzumelden.length > 0) {
    ws.getCell(`A${blockRow}`).value = 'Anzumeldende Mitarbeiter';
    ws.getCell(`A${blockRow}`).font = { bold: true, size: 12 };
    ws.mergeCells(`A${blockRow}:F${blockRow}`);
    blockRow++;
    ws.getRow(blockRow).values = ['Mitarbeiter-Nr.', 'Name', 'Anmeldedatum (ggf.)'];
    ws.getRow(blockRow).font = { bold: true };
    ws.getRow(blockRow).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE8F5E9' },
    };
    blockRow++;
    for (const m of anzumelden) {
      ws.getRow(blockRow).values = [
        m.nummer,
        m.name,
        m.anmeldungUebermittlungDatum ? formatierDatum(new Date(m.anmeldungUebermittlungDatum).getTime()) : '',
      ];
      blockRow++;
    }
    blockRow += 2;
  }

  if (abzumelden.length > 0) {
    ws.getCell(`A${blockRow}`).value = 'Abzumeldende Mitarbeiter';
    ws.getCell(`A${blockRow}`).font = { bold: true, size: 12 };
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
    for (const m of abzumelden) {
      ws.getRow(blockRow).values = [
        m.nummer,
        m.name,
        m.abmeldungUebermittlungDatum
          ? formatierDatum(new Date(m.abmeldungUebermittlungDatum).getTime())
          : '— (Datum unbekannt)',
      ];
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
