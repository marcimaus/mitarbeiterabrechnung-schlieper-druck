// Excel-Export der Monatsabrechnung mit ExcelJS

import ExcelJS from 'exceljs';
import type { Abrechnungsperiode } from '../types';
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
    { header: 'Austragen (€)', key: 'austragen', width: 16 },
    { header: 'Zusammentragen (€)', key: 'zusammentragen', width: 20 },
    { header: 'Zeiterfassung (€)', key: 'zeiterfassung', width: 18 },
    { header: 'Fixes Gehalt (€)', key: 'fix', width: 16 },
    { header: 'Fahrtkosten (€)', key: 'fahrtkosten', width: 16 },
    { header: 'Gesamt (€)', key: 'gesamt', width: 14 },
  ];

  // Titel
  wsUe.spliceRows(1, 0, []);
  wsUe.getCell('A1').value = `Abrechnung ${periode.bezeichnung}`;
  wsUe.getCell('A1').font = { bold: true, size: 14 };
  wsUe.getCell('A2').value = `Erstellt: ${new Date().toLocaleDateString('de-DE')}`;
  wsUe.getCell('A2').font = { color: { argb: 'FF888888' }, size: 10 };
  wsUe.spliceRows(3, 0, []);

  // Header-Zeile (Row 4)
  const headerRow = wsUe.getRow(4);
  ['Nr.', 'Name', 'Austragen (€)', 'Zusammentragen (€)', 'Zeiterfassung (€)', 'Fixes Gehalt (€)', 'Fahrtkosten (€)', 'Gesamt (€)'].forEach((h, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = h;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1D4ED8' } };
    cell.alignment = { horizontal: i > 1 ? 'right' : 'left' };
  });

  ergebnisse.forEach((er, idx) => {
    const r = wsUe.addRow([
      er.mitarbeiter.nummer,
      er.mitarbeiter.name,
      er.austraegerGesamt,
      er.zusammentragenGesamt,
      er.zeitLohn,
      er.fixesGehalt,
      er.fahrtkostenGesamt,
      er.gesamt,
    ]);
    // Zahlenformat
    for (let c = 3; c <= 8; c++) {
      r.getCell(c).numFmt = '#,##0.00 "€"';
      r.getCell(c).alignment = { horizontal: 'right' };
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
    ergebnisse.reduce((s, e) => s + e.austraegerGesamt, 0),
    ergebnisse.reduce((s, e) => s + e.zusammentragenGesamt, 0),
    ergebnisse.reduce((s, e) => s + e.zeitLohn, 0),
    ergebnisse.reduce((s, e) => s + e.fixesGehalt, 0),
    ergebnisse.reduce((s, e) => s + e.fahrtkostenGesamt, 0),
    ergebnisse.reduce((s, e) => s + e.gesamt, 0),
  ]);
  sumRow.getCell(2).font = { bold: true };
  for (let c = 3; c <= 8; c++) {
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
