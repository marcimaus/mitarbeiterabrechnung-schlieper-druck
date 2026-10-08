// Excel-Export: Blatt „Berechnung je MA" — detaillierte Aufschlüsselung der
// Lohnberechnung je Mitarbeiter, analog zur Abrechnungsvorschau
// (AbrechnungsAufschluesselung). Zweck: Die Berechnung soll sich auch ohne
// App vollständig nachvollziehen lassen — jede Position mit Grundlagen,
// Parametern und Rechenweg mit eingesetzten Zahlen.
//
// Die Beträge stammen ausschließlich aus dem Ergebnis von
// `berechneAbrechnung()` (bzw. dem gespeicherten Abschluss-Snapshot); die
// Rohdaten der Periode dienen nur dazu, den Rechenweg sichtbar zu machen.
//
// Spaltenlogik: Spalte D („Betrag") ergibt innerhalb eines Abschnitts die
// Summenzeile; Spalte C („Teilbetrag") enthält Anteile, die bereits in einem
// Betrag stecken (davon-Werte, Komponenten eines Einsatzes).

import type ExcelJS from 'exceljs';
import {
  austragenZelle,
  eur,
  stdMin,
  zeitLohnAufteilung,
  type AustraegerEinsatzErgebnis,
  type MitarbeiterAbrechnung,
  type PeriodeData,
} from './abrechnungslogik';
import {
  berechneAustraegerLohn,
  berechneGewichtAnzeigenblattKg,
  berechneGewichtBeilagenKg,
  ermittleStundenlohn,
  ermittleStundenlohnZusammen,
  stundenlohnHerkunft,
} from './berechnung';
import { berechneNettoMinuten } from './zeiterfassung';
import { zeitfensterText } from './vorarbeit';
import { istInSaisonpauseFuer } from './saison';
import type {
  Abrechnungsperiode,
  Arbeitszeit,
  Einsatz,
  Mitarbeiter,
  Parameter,
  Teilgebiet,
  TeilgebietSnapshot,
} from '../types';
import { ROLLEN_LABELS, TYP_LABELS } from '../types';

export interface BerechnungJeMaKontext {
  periode: Abrechnungsperiode;
  ergebnisse: MitarbeiterAbrechnung[];
  data: PeriodeData;
  /** Effektive Parameter der Periode (ggf. aus Snapshot). */
  params: Parameter;
  /** Effektive Teilgebiete der Periode (ggf. aus Snapshot). */
  teilgebiete: (Teilgebiet | TeilgebietSnapshot)[];
  alleMitarbeiter: Mitarbeiter[];
}

// ---- Formatierung ------------------------------------------------------

const zahl = (x: number, stellen = 0) =>
  x.toLocaleString('de-DE', { minimumFractionDigits: stellen, maximumFractionDigits: stellen });
/** Dezimalstunden mit 4 Stellen — damit Zeit × Satz exakt nachrechenbar ist. */
const h4 = (stunden: number) => `${zahl(stunden, 4)} h`;
const satzText = (x: number) => `${zahl(x, 2)} €/h`;
const uhrzeit = (ms: number) =>
  new Date(ms).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
const tagLang = (ms: number) =>
  new Date(ms).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' });
const isoDatum = (iso: string) => {
  const [y, m, d] = iso.split('-');
  return d && m && y ? `${d}.${m}.${y}` : iso;
};
const anzahl = (n: number, einzahl: string, mehrzahl: string) => `${n} ${n === 1 ? einzahl : mehrzahl}`;
const gleich = (a: number, b: number) => Math.abs(Math.round(a * 100) - Math.round(b * 100)) <= 1;

// ---- Zeilen-Schreiber --------------------------------------------------

type Stil =
  | 'ma' | 'abschnitt' | 'schluessel' | 'zeile' | 'unter' | 'detail'
  | 'grau' | 'summe' | 'gesamt' | 'hinweis';

interface Zeile {
  a?: string;
  b?: string;
  c?: number | null;
  d?: number | null;
  stil?: Stil;
  /** Gliederungsebene (Excel-Gruppierung): 1 = Zeile eines Abschnitts, 2 = Rechenweg-Detail. */
  ebene?: 0 | 1 | 2;
}

const EUR_FMT = '#,##0.00 "€"';
const BREITE_A = 40;
const BREITE_B = 92;
const FARBE = {
  maFill: 'FF1D4ED8',
  abschnittFill: 'FFDBEAFE',
  abschnittText: 'FF1E3A8A',
  gesamtFill: 'FFE0E7FF',
  grau: 'FF6B7280',
  hellgrau: 'FF9CA3AF',
  hinweis: 'FFB45309',
};

class Schreiber {
  private ws: ExcelJS.Worksheet;
  constructor(ws: ExcelJS.Worksheet) {
    this.ws = ws;
  }

  get letzteZeile(): number {
    return this.ws.rowCount;
  }

  zeile(z: Zeile): ExcelJS.Row {
    const stil = z.stil ?? 'zeile';
    const row = this.ws.addRow([z.a ?? '', z.b ?? '', z.c ?? null, z.d ?? null]);
    const nr = row.number;
    if (z.ebene) row.outlineLevel = z.ebene;

    for (const c of [3, 4]) {
      row.getCell(c).numFmt = EUR_FMT;
      row.getCell(c).alignment = { horizontal: 'right', vertical: 'top' };
    }
    row.getCell(1).alignment = { wrapText: true, vertical: 'top', indent: z.ebene === 2 ? 2 : stil === 'unter' ? 1 : 0 };
    row.getCell(2).alignment = { wrapText: true, vertical: 'top' };

    let breiteB = BREITE_B;
    switch (stil) {
      case 'ma':
        this.ws.mergeCells(`B${nr}:C${nr}`);
        for (let c = 1; c <= 4; c++) {
          row.getCell(c).font = { bold: true, size: 12, color: { argb: 'FFFFFFFF' } };
          row.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: FARBE.maFill } };
        }
        row.height = 20;
        break;
      case 'abschnitt':
        for (let c = 1; c <= 4; c++) {
          row.getCell(c).font = { bold: true, color: { argb: FARBE.abschnittText } };
          row.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: FARBE.abschnittFill } };
        }
        break;
      case 'schluessel':
        this.ws.mergeCells(`B${nr}:D${nr}`);
        breiteB = BREITE_B + 28;
        for (const c of [1, 2]) row.getCell(c).font = { italic: true, size: 9, color: { argb: FARBE.grau } };
        break;
      case 'unter':
        for (let c = 1; c <= 3; c++) row.getCell(c).font = { color: { argb: FARBE.grau } };
        break;
      case 'detail':
        for (let c = 1; c <= 3; c++) row.getCell(c).font = { size: 9, color: { argb: FARBE.grau } };
        break;
      case 'grau':
        for (let c = 1; c <= 4; c++) row.getCell(c).font = { color: { argb: FARBE.hellgrau } };
        break;
      case 'summe':
        for (let c = 1; c <= 4; c++) {
          row.getCell(c).font = { bold: true };
          row.getCell(c).border = { top: { style: 'thin', color: { argb: FARBE.hellgrau } } };
        }
        break;
      case 'gesamt':
        for (let c = 1; c <= 4; c++) {
          row.getCell(c).font = { bold: true, color: { argb: FARBE.abschnittText } };
          row.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: FARBE.gesamtFill } };
          row.getCell(c).border = { top: { style: 'medium', color: { argb: FARBE.maFill } } };
        }
        break;
      case 'hinweis':
        this.ws.mergeCells(`B${nr}:D${nr}`);
        breiteB = BREITE_B + 28;
        for (const c of [1, 2]) row.getCell(c).font = { color: { argb: FARBE.hinweis } };
        break;
      default:
        break;
    }

    // Zeilenhöhe grob schätzen — Excel passt umbrochene (v. a. verbundene)
    // Zellen nicht zuverlässig selbst an.
    const zeilenA = Math.ceil((z.a ?? '').length / (BREITE_A - 2)) || 1;
    const zeilenB = Math.ceil((z.b ?? '').length / (breiteB - 4)) || 1;
    const zeilen = Math.max(zeilenA, zeilenB);
    if (zeilen > 1) row.height = Math.min(300, 14 * zeilen + 2);
    return row;
  }

  leer(): void {
    this.ws.addRow([]);
  }
}

// ---- Hauptfunktion -------------------------------------------------------

export function fuegeBerechnungJeMaHinzu(wb: ExcelJS.Workbook, k: BerechnungJeMaKontext): void {
  const { periode, ergebnisse } = k;
  const ws = wb.addWorksheet('Berechnung je MA', {
    properties: { outlineProperties: { summaryBelow: false, summaryRight: false } },
  });
  ws.columns = [
    { width: BREITE_A },
    { width: BREITE_B },
    { width: 14 },
    { width: 14 },
  ];

  const istFixiert = periode.status !== 'abgeschlossen' && !!periode.monatswechselSnapshot;
  const stand = periode.status === 'abgeschlossen'
    ? `abgeschlossen${periode.gesperrtAm ? ` am ${new Date(periode.gesperrtAm).toLocaleDateString('de-DE')}` : ''} — Beträge aus dem gespeicherten Abschluss, Parameter/Teilgebiete aus dem Abschluss-Snapshot`
    : istFixiert
      ? `offen, Monatswechsel am ${new Date(periode.monatswechselSnapshot!.erstelltAm).toLocaleDateString('de-DE')} — Austragen/Zusammentragen auf diesem Stand fixiert, Parameter/Teilgebiete aus dem Monatswechsel-Snapshot`
      : 'offen — aktuelle Parameter und Teilgebiete';

  ws.getCell('A1').value = `Lohnberechnung je Mitarbeiter — ${periode.bezeichnung}`;
  ws.getCell('A1').font = { bold: true, size: 14 };
  ws.getCell('A2').value =
    `KW ${periode.kalenderwochen.join(', ')} · Zeiterfassung Kalendermonat ${String(periode.monat).padStart(2, '0')}/${periode.jahr} · Stand: ${stand}`;
  ws.getCell('A2').font = { size: 9, color: { argb: FARBE.grau } };
  ws.mergeCells('A2:D2');
  ws.getRow(2).alignment = { wrapText: true, vertical: 'top' };
  ws.getRow(2).height = 28;
  ws.getCell('A3').value =
    'Spalte „Betrag" ergibt je Abschnitt die Summenzeile. „Teilbetrag" sind darin enthaltene Anteile (davon-Werte, Bestandteile eines Einsatzes). ' +
    'Zeiten in Dezimalstunden (4 Stellen) — Zeit × Stundenlohn ergibt den Betrag. Die Gliederung (+/− am linken Rand) klappt Details ein und aus. Parameter: siehe Blatt „Parameter".';
  ws.getCell('A3').font = { italic: true, size: 9, color: { argb: FARBE.grau } };
  ws.mergeCells('A3:D3');
  ws.getRow(3).alignment = { wrapText: true, vertical: 'top' };
  ws.getRow(3).height = 28;
  const kopf = ws.getRow(4);
  kopf.values = ['Position', 'Rechenweg / Grundlage', 'Teilbetrag (€)', 'Betrag (€)'];
  for (let c = 1; c <= 4; c++) {
    kopf.getCell(c).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    kopf.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF374151' } };
    if (c >= 3) kopf.getCell(c).alignment = { horizontal: 'right' };
  }
  ws.views = [{ state: 'frozen', ySplit: 4 }];
  ws.pageSetup = {
    orientation: 'landscape',
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    printTitlesRow: '4:4',
  };

  const s = new Schreiber(ws);
  for (const er of ergebnisse) {
    s.leer();
    schreibeMitarbeiter(s, er, k);
    // Seitenumbruch nach jedem MA — jeder MA beginnt beim Drucken oben.
    ws.getRow(s.letzteZeile).addPageBreak();
  }
}

// ---- Block je Mitarbeiter -------------------------------------------------

function schreibeMitarbeiter(s: Schreiber, er: MitarbeiterAbrechnung, k: BerechnungJeMaKontext): void {
  const { periode, data, params } = k;
  const ma = er.mitarbeiter;
  const tgById = new Map(k.teilgebiete.map((t) => [t.id, t]));
  const ausgabeFuer = (kw: number, jahr: number) =>
    data.ausgaben.find((a) => a.kw === kw && a.jahr === jahr);
  const satzAustr = ermittleStundenlohn(ma, params);
  const satzZus = ermittleStundenlohnZusammen(ma, params);
  const geschw1 = params.zusammentragGeschwErste2StapelStkProH || 1700;
  const geschw2 = params.zusammentragGeschwWeitereStapelStkProH || 3400;
  const extGeschw = params.externeBeilageEinlegeGeschwStkProH || params.steckzeitStkProH;
  const istSvBefreit = !!ma.sozialversicherungsBefreit;

  // ---- Austragen: Zeilen mit Rechenweg ----
  const austragen = er.austraegerEinsaetze.map((e) => {
    const tg = tgById.get(e.teilgebietId);
    const ausgabe = ausgabeFuer(e.kw, e.jahr);
    const beilagenAusgabe = ausgabe ? data.beilagen.filter((b) => b.ausgabeId === ausgabe.id) : [];
    const beilagenTg = beilagenAusgabe.filter((b) => b.teilgebietIds.includes(e.teilgebietId));
    const einsatzDoc = ausgabe
      ? data.einsaetze.find((x) => x.ausgabeId === ausgabe.id && x.teilgebietId === e.teilgebietId)
      : undefined;
    const sv = data.sondervereinbarungen.find(
      (x) => x.mitarbeiterId === ma.id && x.teilgebietId === e.teilgebietId,
    );
    const d = e.detail;
    const springerIndividuell = e.typ === 'springer' && einsatzDoc?.springerZuschlagProzent != null;
    const springerProzent = e.typ !== 'springer'
      ? 0
      : d.grundlohn > 0
        ? (d.springerZuschlag / d.grundlohn) * 100
        : (einsatzDoc?.springerZuschlagProzent ?? params.springerZuschlagProzent);
    let kgAnzeigenblatt = 0;
    let kgBeilagen = 0;
    let nachgerechnet: number | undefined;
    if (tg && ausgabe) {
      kgAnzeigenblatt = berechneGewichtAnzeigenblattKg(tg as Teilgebiet, ausgabe);
      kgBeilagen = berechneGewichtBeilagenKg(tg as Teilgebiet, beilagenTg);
      nachgerechnet = berechneAustraegerLohn(
        ma, tg as Teilgebiet, ausgabe, beilagenAusgabe,
        { typ: e.typ, springerZuschlagProzent: e.typ === 'springer' ? einsatzDoc?.springerZuschlagProzent : undefined } as Einsatz,
        sv, params,
      ).gesamt;
    }
    return {
      e, tg, ausgabe, beilagenTg, sv, springerProzent, springerIndividuell, kgAnzeigenblatt, kgBeilagen, nachgerechnet,
      stundenlohn: d.zeitStunden > 0 ? d.grundlohn / d.zeitStunden : satzAustr,
    };
  });
  const summeAustragen = {
    zeit: austragen.reduce((x, z) => x + z.e.detail.zeitStunden, 0),
    grundlohn: austragen.reduce((x, z) => x + z.e.detail.grundlohn, 0),
    springer: austragen.reduce((x, z) => x + z.e.detail.springerZuschlag, 0),
    sonder: austragen.reduce((x, z) => x + z.e.detail.sonderbetrag, 0),
    kgAnzeigenblatt: austragen.reduce((x, z) => x + z.kgAnzeigenblatt, 0),
    kgBeilagen: austragen.reduce((x, z) => x + z.kgBeilagen, 0),
  };

  // Standard-Gebiets-Ausgaben, die ein anderer ausgetragen hat oder die
  // unbesetzt waren — nur zur Info (nicht vergütet).
  const vertretungen: Array<{ kw: number; jahr: number; teilgebietId: string; teilgebietName: string; text: string }> = [];
  if (!ma.hatFestgehalt) {
    const bezahlt = new Set(er.austraegerEinsaetze.map(austragenZelle));
    for (const tg of k.teilgebiete) {
      if (tg.standardAustraegerId !== ma.id || (tg as Teilgebiet).isActive === false) continue;
      for (const ausgabe of data.ausgaben) {
        const ex = data.einsaetze.find((x) => x.ausgabeId === ausgabe.id && x.teilgebietId === tg.id);
        if (!ex || ex.typ === 'standard' || ex.mitarbeiterId === ma.id) continue;
        if (istInSaisonpauseFuer(tg as Teilgebiet, ausgabe)) continue;
        if (bezahlt.has(austragenZelle({ jahr: ausgabe.jahr, kw: ausgabe.kw, teilgebietId: tg.id }))) continue;
        const vertreter = ex.mitarbeiterId ? k.alleMitarbeiter.find((m) => m.id === ex.mitarbeiterId)?.name ?? ex.mitarbeiterId : undefined;
        vertretungen.push({
          kw: ausgabe.kw,
          jahr: ausgabe.jahr,
          teilgebietId: tg.id,
          teilgebietName: tg.name,
          text: ex.typ === 'springer'
            ? `Standard-Gebiet, vertreten durch ${vertreter ?? 'Springer'} — nicht vergütet`
            : `Standard-Gebiet ${ex.typ === 'ungeklärt' ? 'unbesetzt' : 'Ausfall'} — nicht vergütet`,
        });
      }
    }
  }
  const austragenEntfallen = er.austraegerEinsaetzeEntfallen ?? [];

  // ---- Zusammentragen / Vorarbeit ----
  const ztZeilen = er.zusammentragenEinsaetze
    .filter((z) => !z.istVorarbeit)
    .sort((a, b) => a.kw - b.kw || (a.teilgebietName ?? '').localeCompare(b.teilgebietName ?? '', 'de', { numeric: true }));
  const summeZt = ztZeilen.reduce((x, z) => x + z.lohn, 0);
  const vorarbeitZt = er.zusammentragenEinsaetze.filter((z) => z.istVorarbeit).sort((a, b) => a.kw - b.kw);
  const summeVorarbeitZt = vorarbeitZt.reduce((x, z) => x + z.lohn, 0);
  const ztEntfallen = er.zusammentragenEinsaetzeEntfallen ?? [];
  const ausgabeById = new Map(data.ausgaben.map((a) => [a.id, a]));
  const ztNichtVerguetet = ma.hatFestgehalt ? [] : data.zusammentragenEinsaetze
    .filter((z) => z.mitarbeiterId === ma.id)
    .map((z) => {
      const ausgabe = ausgabeById.get(z.ausgabeId);
      const tgName = tgById.get(z.teilgebietId)?.name ?? z.teilgebietId;
      let grund: string | null = null;
      if (!ausgabe) grund = 'Ausgabe nicht in dieser Periode';
      else if (z.istVorarbeit && !ausgabe.vorarbeitFreigegeben) grund = `Vorarbeit in KW ${ausgabe.kw} nicht freigegeben`;
      else if (z.istVorarbeit && !(z.vorarbeitMinuten && z.vorarbeitMinuten > 0)) grund = 'Vorarbeit ohne Minuten erfasst';
      else if (!z.istVorarbeit && !tgById.has(z.teilgebietId)) grund = 'Teilgebiet nicht gefunden';
      return grund ? { z, kw: ausgabe?.kw, tgName, grund } : null;
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  // ---- Zeiterfassung ----
  const aufteilung = zeitLohnAufteilung(er);
  const zeitVorarbeitLohn = aufteilung?.vorarbeit ?? 0;
  const zeitUebrigeLohn = aufteilung ? aufteilung.uebrige : er.zeitLohn;
  const satzFuer = (az: Arbeitszeit) =>
    az.typ === 'vorarbeit' || az.typ === 'zusammentragen' ? satzZus : satzAustr;
  const bekannteIds = new Set([...er.arbeitszeiten, ...er.arbeitszeitenNichtAbgerechnet].map((a) => a.id));
  const zeitZeilen = [
    ...er.arbeitszeiten.map((az) => ({ az, abgerechnet: true, grund: '' })),
    ...er.arbeitszeitenNichtAbgerechnet.map((az) => ({ az, abgerechnet: false, grund: grundNichtAbgerechnet(az, ma, params) })),
    // In der Periode erfasst, aber nicht in die Berechnung eingegangen
    // (nicht berücksichtigt, nicht ausgestempelt, nach Abschluss erfasst).
    ...data.arbeitszeiten
      .filter((az) => az.mitarbeiterId === ma.id && !bekannteIds.has(az.id))
      .map((az) => ({
        az,
        abgerechnet: false,
        grund: az.nichtBeruecksichtigen
          ? `als „nicht berücksichtigen" markiert${az.nichtBeruecksichtigenGrund ? `: ${az.nichtBeruecksichtigenGrund}` : ''}`
          : az.status !== 'abgeschlossen'
            ? 'noch nicht ausgestempelt'
            : 'nicht in der Abrechnung enthalten (nach dem Abschluss erfasst)',
      })),
  ].sort((a, b) => a.az.startTime - b.az.startTime);

  // ---- Bonus Zeiterfassung ----
  const bonusBetrag = params.bonusZeiterfassungEur ?? 0;
  const hatRolleAustraeger = (ma.rollen ?? []).includes('austräger');
  const bonusZeilen = (() => {
    const zeilen: Array<{ kw: number; jahr: number; tgName: string; einsatz?: Einsatz; fehlt: string[]; ohneAustragen: boolean }> = [];
    const gesehen = new Set<string>();
    const pruefe = (doc: Einsatz | undefined) => {
      const fehlt: string[] = [];
      if (!doc || doc.mitarbeiterId !== ma.id) return ['keine Selbstmeldung (QR-Code)'];
      if (!doc.arbeitszeit) fehlt.push('Arbeitszeit fehlt');
      if (doc.restmenge === undefined || doc.restmenge === null) fehlt.push('Restmenge fehlt');
      if (!doc.meldungEingereichtAm) fehlt.push('Meldung nicht abgeschickt');
      return fehlt;
    };
    for (const e of er.austraegerEinsaetze) {
      const ausgabe = ausgabeFuer(e.kw, e.jahr);
      const doc = ausgabe
        ? data.einsaetze.find((x) => x.ausgabeId === ausgabe.id && x.teilgebietId === e.teilgebietId)
        : undefined;
      if (doc) gesehen.add(doc.id);
      zeilen.push({ kw: e.kw, jahr: e.jahr, tgName: e.teilgebietName, einsatz: doc?.mitarbeiterId === ma.id ? doc : undefined, fehlt: pruefe(doc), ohneAustragen: false });
    }
    for (const doc of data.einsaetze) {
      if (doc.mitarbeiterId !== ma.id || gesehen.has(doc.id)) continue;
      zeilen.push({ kw: doc.kw, jahr: doc.jahr, tgName: tgById.get(doc.teilgebietId)?.name ?? doc.teilgebietId, einsatz: doc, fehlt: pruefe(doc), ohneAustragen: true });
    }
    return zeilen.sort((a, b) => a.jahr - b.jahr || a.kw - b.kw || a.tgName.localeCompare(b.tgName, 'de', { numeric: true }));
  })();

  const fahrtKm = er.fahrten.reduce((x, f) => x + f.streckKm, 0);
  const maSv = data.sondervereinbarungen.filter((x) => x.mitarbeiterId === ma.id);

  // ======================================================================
  // Kopf
  // ======================================================================
  const merkmale = [
    ma.hatFestgehalt ? 'Festgehalt' : '',
    ma.istMinijob ? 'Minijob' : '',
    istSvBefreit ? 'SV-befreit' : '',
  ].filter(Boolean).join(' · ');
  s.zeile({ a: `${ma.nummer} · ${ma.name}`, b: merkmale ? `${merkmale} — Bruttolohn an Lohnbüro` : 'Bruttolohn an Lohnbüro', d: er.bruttoLohnbuero, stil: 'ma' });

  // ======================================================================
  // Berechnungsgrundlagen
  // ======================================================================
  s.zeile({ a: 'Berechnungsgrundlagen', stil: 'abschnitt' });
  s.zeile({ a: 'Rollen', b: (ma.rollen ?? []).map((r) => ROLLEN_LABELS[r] ?? r).join(', ') || '—', ebene: 1 });
  if (ma.hatFestgehalt) {
    s.zeile({ a: 'Festgehalt', b: 'Monatsbetrag laut Stammdaten — Austragen, Zusammentragen und Stempelzeiten werden nicht zusätzlich vergütet; Fahrtkosten, Min-Boni, Periodenzusatz und Sonderzahlung kommen hinzu', c: er.fixesGehalt, ebene: 1 });
  } else {
    s.zeile({ a: 'Stundenlohn Austragen / Sonstige', b: `${satzText(satzAustr)} — ${stundenlohnHerkunft(ma)}`, ebene: 1 });
    s.zeile({ a: 'Stundenlohn Zusammentragen / Vorarbeit', b: satzText(satzZus), ebene: 1 });
    s.zeile({
      a: 'Abrechnungsart',
      b: `Austragen nach ${params.austragenNachIstZeit ? 'Ist-Zeit (Stempeluhr)' : 'Soll-Zeit (Teilgebiet)'}; Zusammentragen nach ${params.zusammentragenNachIstZeit ? 'Ist-Zeit (Stempeluhr)' : 'Soll-Zeit (Stapel/Stückzahl)'}`,
      ebene: 1,
    });
  }
  s.zeile({
    a: 'Fahrtkostensatz',
    b: `${zahl(er.fahrtSatzEurProKm, 2)} €/km — ${ma.fahrkostenEurProKm != null ? 'individueller Satz des MA' : 'Satz aus den Parametern'}`,
    ebene: 1,
  });
  if (ma.ausgabenBonusMinuten) {
    s.zeile({ a: 'Min-Bonus (Tätigkeitsbonus)', b: `${ma.ausgabenBonusMinuten} min je Ausgabe${ma.ausgabenBonusKommentar ? ` — ${ma.ausgabenBonusKommentar}` : ''}`, ebene: 1 });
  }
  for (const sv of maSv) {
    s.zeile({
      a: 'Sondervereinbarung',
      b: `Teilgebiet ${tgById.get(sv.teilgebietId)?.name ?? sv.teilgebietId}: ${eur(sv.betragEur)} je Einsatz (KW)${sv.begruendung ? ` — ${sv.begruendung}` : ''}`,
      ebene: 1,
    });
  }

  // ======================================================================
  // Zusammenfassung
  // ======================================================================
  s.zeile({ a: 'Zusammenfassung', b: 'alle Lohnbestandteile — Details in den folgenden Abschnitten', stil: 'abschnitt' });
  let summePositionen = 0;
  const position = (a: string, b: string, d: number) => {
    summePositionen += d;
    s.zeile({ a, b, d, ebene: 1 });
  };
  const davon = (a: string, b: string, c: number) => s.zeile({ a: `– davon ${a}`, b, c, stil: 'unter', ebene: 1 });

  if (ma.hatFestgehalt) {
    position('Festgehalt', 'Monatsbetrag laut Stammdaten', er.fixesGehalt);
  } else {
    if (er.austraegerEinsaetze.length > 0 || ztZeilen.length === 0) {
      position('Austragen', `${er.austraegerEinsaetze.length} Einsätze — Abschnitt „Austragen"`, er.austraegerGesamt);
    }
    if (er.austraegerEinsaetze.length > 0) {
      davon('Grundlohn', `${h4(summeAustragen.zeit)} Soll-Zeit × Stundenlohn`, summeAustragen.grundlohn);
      if (summeAustragen.springer) davon('Springerzulage', anzahl(austragen.filter((z) => z.e.typ === 'springer').length, 'Springer-Einsatz', 'Springer-Einsätze'), summeAustragen.springer);
      if (er.gewichtsbonusAnzeigenblatt) davon('Gewichtszulage Anzeigenblatt', `${zahl(summeAustragen.kgAnzeigenblatt, 2)} kg × ${zahl(params.gewichtszulageAnzeigenblattEurKg, 2)} €/kg`, er.gewichtsbonusAnzeigenblatt);
      if (er.gewichtsbonusBeilagen) davon('Gewichtszulage Beilagen', `${zahl(summeAustragen.kgBeilagen, 2)} kg × ${zahl(params.gewichtszulageBeilagenEurKg, 2)} €/kg`, er.gewichtsbonusBeilagen);
      if (summeAustragen.sonder) davon('Sondervergütung', `${anzahl(austragen.filter((z) => z.e.detail.sonderbetrag !== 0).length, 'Einsatz', 'Einsätze')} mit Sondervereinbarung`, summeAustragen.sonder);
    }
    if (ztZeilen.length > 0) {
      position('Zusammentragen', `${ztZeilen.length} Teilgebiete · ${h4(ztZeilen.reduce((x, z) => x + (z.stunden ?? 0), 0))} × ${satzText(satzZus)} — Abschnitt „Zusammentragen"`, summeZt);
    }
    if (vorarbeitZt.length > 0 || zeitVorarbeitLohn > 0) {
      position('Vorarbeit', `Minutenerfassung ${eur(summeVorarbeitZt)} (Abschnitt „Vorarbeit") + Stempeluhr ${eur(zeitVorarbeitLohn)} (Abschnitt „Zeiterfassung")`, summeVorarbeitZt + zeitVorarbeitLohn);
    }
    if (zeitUebrigeLohn) {
      position('Zeitlohn (Stempeluhr, ohne Vorarbeit)', 'Ist-Zeit × Stundenlohn — Abschnitt „Zeiterfassung"', zeitUebrigeLohn);
    }
  }
  if (er.ausgabenBoniLohnGesamt) position('Min-Boni (Tätigkeitsbonus)', `${er.ausgabenBoniMinutenGesamt} min ÷ 60 × ${satzText(satzAustr)} — Abschnitt „Boni"`, er.ausgabenBoniLohnGesamt);
  if (er.bonusZeiterfassungEur) position('Bonus Zeiterfassung Austragen', `${er.bonusZeiterfassungAnzahl} × ${eur(bonusBetrag)} — Abschnitt „Boni"`, er.bonusZeiterfassungEur);
  if (er.bonus) position('Bonus / Periodenzusatz', er.bonusKommentar || 'ohne Kommentar', er.bonus);
  if (er.sonderzahlung) {
    const anmerkungen = [
      er.sonderzahlungAnmerkungLohnbuero && `Anmerkung Lohnbüro: ${er.sonderzahlungAnmerkungLohnbuero}`,
      er.sonderzahlungAnmerkungIntern && `Anmerkung intern: ${er.sonderzahlungAnmerkungIntern}`,
    ].filter(Boolean);
    position('Einmalige Sonderzahlung', anmerkungen.join(' · ') || 'ohne Anmerkung', er.sonderzahlung);
  }
  if (er.fahrtkostenGesamt) position('Fahrtkosten', `${zahl(fahrtKm, 1)} km × ${zahl(er.fahrtSatzEurProKm, 2)} €/km — Abschnitt „Fahrtkosten"`, er.fahrtkostenGesamt);
  if (er.externerWertAktiv) {
    const ersetzt = er.externerWertErsetzt ?? 0;
    const extern = er.externerWert ?? 0;
    position(
      'Ersetzung durch externen Abrechnungswert',
      `App-Berechnung Austragen + Zusammentragen + Vorarbeit-Zeitlohn (${eur(ersetzt)}) wird durch den Wert der externen Anwendung (${eur(extern)}) ersetzt: ${eur(extern)} − ${eur(ersetzt)}`,
      extern - ersetzt,
    );
  }
  s.zeile({ a: '= Brutto (errechnet)', b: 'Summe der Positionen', d: er.gesamt, stil: 'summe' });
  if (er.lohnkontoVerschiebungPeriode > 0) {
    s.zeile({ a: '− Lohnkonto: Verschiebung', b: 'Betrag wird in eine spätere Periode geschoben', d: -er.lohnkontoVerschiebungPeriode, ebene: 1 });
  }
  if (er.lohnkontoVerrechnungPeriode > 0) {
    s.zeile({ a: '+ Lohnkonto: Verrechnung', b: 'früher geschobener Betrag wird ausgezahlt', d: er.lohnkontoVerrechnungPeriode, ebene: 1 });
  }
  s.zeile({ a: '= Bruttolohn an Lohnbüro', b: 'Brutto (errechnet) − Verschiebung + Verrechnung', d: er.bruttoLohnbuero, stil: 'gesamt' });
  const sonderzahlung = er.sonderzahlung ?? 0;
  if (er.fahrtkostenGesamt || sonderzahlung) {
    s.zeile(sonderzahlung
      ? { a: 'Brutto (exkl. FaKo und Sonderzahlung)', b: 'Bruttolohn − Fahrtkosten − Sonderzahlung (wie in der Lohnübermittlung)', c: er.bruttoLohnbuero - er.fahrtkostenGesamt - sonderzahlung, stil: 'unter', ebene: 1 }
      : { a: 'Brutto (exkl. FaKo)', b: 'Bruttolohn − Fahrtkosten (wie in der Lohnübermittlung)', c: er.bruttoLohnbuero - er.fahrtkostenGesamt, stil: 'unter', ebene: 1 });
  }
  if (er.vorschussSumme) {
    s.zeile({ a: 'Vorschüsse', b: 'bereits ausgezahlt — werden bei der Auszahlung verrechnet', c: er.vorschussSumme, stil: 'unter', ebene: 1 });
  }
  s.zeile(istSvBefreit
    ? { a: 'Auszahlung', b: 'SV-befreit (keine Abzüge): Bruttolohn − Vorschüsse', c: er.bruttoLohnbuero - er.vorschussSumme, stil: 'unter', ebene: 1 }
    : { a: 'Auszahlung', b: 'ermittelt das Lohnbüro (nach Steuer-/SV-Abzügen)', stil: 'unter', ebene: 1 });

  // ---- Hinweise ----
  const hinweise: string[] = [];
  if (!gleich(summePositionen, er.gesamt)) {
    hinweise.push(`Summe der Positionen (${eur(summePositionen)}) weicht vom Brutto (${eur(er.gesamt)}) ab.`);
  }
  if (er.externerWertAktiv) {
    hinweise.push('Für diesen MA ist ein Wert der externen Anwendung hinterlegt; er ersetzt die App-Berechnung für Austragen, Zusammentragen und Vorarbeit. Die Abschnitte unten zeigen die App-Berechnung zur Information.');
  }
  const nachtraege = austragen.filter((z) => z.e.nachtrag).length + er.zusammentragenEinsaetze.filter((z) => z.nachtrag).length;
  if (nachtraege > 0 || austragenEntfallen.length > 0 || ztEntfallen.length > 0) {
    hinweise.push(`Nachtrag nach dem Monatswechsel: ${nachtraege} Zeile(n) neu gerechnet, ${austragenEntfallen.length + ztEntfallen.length} fixierte Zeile(n) entfallen — siehe Kennzeichnung in den Abschnitten.`);
  }
  const abweichend = austragen.filter((z) => z.nachgerechnet != null && !gleich(z.nachgerechnet, z.e.detail.gesamt));
  if (abweichend.length > 0) {
    hinweise.push(`${abweichend.length} Austragen-Einsatz/Einsätze ergeben mit den Stammdaten dieses Exports einen anderen Betrag als abgerechnet (siehe Hinweis beim Einsatz).`);
  }
  if (!ma.geburtsdatum?.trim() && ma.stundenlohnIndividuell === undefined && !ma.hatFestgehalt) {
    hinweise.push('Kein Geburtsdatum hinterlegt — es wird der Erwachsenen-Stundenlohn angesetzt.');
  }
  if (er.fahrten.length > 0 && !ma.fahrtkostenerstattung) {
    hinweise.push('Fahrten werden vergütet, obwohl beim MA „Fahrtkosten-Erstattung" nicht gesetzt ist.');
  }
  if (hinweise.length > 0) {
    s.zeile({ a: 'Hinweise', stil: 'abschnitt' });
    for (const h of hinweise) s.zeile({ a: '⚠', b: h, stil: 'hinweis', ebene: 1 });
  }

  // ======================================================================
  // Austragen
  // ======================================================================
  type AustragenTabZeile =
    | { art: 'einsatz'; kw: number; jahr: number; tgName: string; z: (typeof austragen)[number] }
    | { art: 'info'; kw: number; jahr: number; tgName: string; text: string };
  const vertretungsZellen = new Set(vertretungen.map(austragenZelle));
  const austragenTab: AustragenTabZeile[] = [
    ...austragen.map((z) => ({ art: 'einsatz' as const, kw: z.e.kw, jahr: z.e.jahr, tgName: z.e.teilgebietName, z })),
    ...vertretungen.map((v) => ({ art: 'info' as const, kw: v.kw, jahr: v.jahr, tgName: v.teilgebietName, text: v.text })),
    ...austragenEntfallen
      .filter((e) => !vertretungsZellen.has(austragenZelle(e)))
      .map((e: AustraegerEinsatzErgebnis) => ({
        art: 'info' as const, kw: e.kw, jahr: e.jahr, tgName: e.teilgebietName,
        text: `${e.typ === 'springer' ? 'Springer-Einsatz' : 'Einsatz'} entfällt durch Nachtrag nach dem Monatswechsel (fixiert waren ${eur(e.detail.gesamt)}) — nicht vergütet`,
      })),
  ].sort((a, b) => a.jahr - b.jahr || a.kw - b.kw || a.tgName.localeCompare(b.tgName, 'de', { numeric: true }));

  if (!ma.hatFestgehalt && austragenTab.length > 0) {
    s.zeile({ a: 'Austragen je Teilgebiet und KW', b: anzahl(er.austraegerEinsaetze.length, 'vergüteter Einsatz', 'vergütete Einsätze'), stil: 'abschnitt' });
    s.zeile({
      a: 'Berechnungsschlüssel',
      b: `Soll-Zeit = Wegstrecke ÷ ${zahl(params.laufgeschwindigkeitMProH)} m/h (Laufgeschwindigkeit) + Stückzahl ÷ ${zahl(params.steckzeitStkProH)} Stk/h (Steckgeschwindigkeit) ` +
        `+ Stückzahl × Anzahl externe Beilagen ÷ ${zahl(extGeschw)} Stk/h (Einlegen). Grundlohn = Soll-Zeit × Stundenlohn. ` +
        `Springerzulage = Grundlohn × Zuschlag-% (Standard ${zahl(params.springerZuschlagProzent)} %). ` +
        `Gewichtszulage Anzeigenblatt = Seiten ÷ 2 × Blattfläche (m²) × Grammatur (g/m²) × Stückzahl ÷ 1000 = kg × ${zahl(params.gewichtszulageAnzeigenblattEurKg, 2)} €/kg; ` +
        `Gewichtszulage Beilagen = Σ Beilagengewicht (g/Stk) × Stückzahl ÷ 1000 = kg × ${zahl(params.gewichtszulageBeilagenEurKg, 2)} €/kg. Sondervergütung laut Sondervereinbarung je Einsatz.`,
      stil: 'schluessel',
      ebene: 1,
    });
    if (params.austragenNachIstZeit) {
      s.zeile({ a: '⚠', b: 'Austragen wird nach Ist-Zeit abgerechnet — die Vergütung steht im Abschnitt „Zeiterfassung".', stil: 'hinweis', ebene: 1 });
    }
    for (const t of austragenTab) {
      if (t.art === 'info') {
        s.zeile({ a: `KW ${t.kw} · ${t.tgName}`, b: t.text, stil: 'grau', ebene: 1 });
        continue;
      }
      const z = t.z;
      const d = z.e.detail;
      const tg = z.tg;
      const kopfInfo = [
        z.e.typ === 'springer' ? 'Springer' : 'Standard',
        tg ? `${zahl(tg.stueckzahl)} Stk` : '',
        tg ? `${zahl(tg.wegstreckeM)} m` : '',
        d.anzahlExtBeilagen ? `${d.anzahlExtBeilagen} ext. Beilage(n)` : '',
        z.e.nachtrag ? 'Nachtrag nach Monatswechsel (mit dessen Stand neu gerechnet)' : '',
      ].filter(Boolean).join(' · ');
      s.zeile({ a: `KW ${z.e.kw} · ${z.e.teilgebietName}`, b: kopfInfo, d: d.gesamt, ebene: 1 });
      const det = (a: string, b: string, c?: number) => s.zeile({ a, b, c, stil: 'detail', ebene: 2 });
      if (tg) {
        const lauf = tg.wegstreckeM / params.laufgeschwindigkeitMProH;
        const steck = tg.stueckzahl / params.steckzeitStkProH;
        det('Laufzeit', `${zahl(tg.wegstreckeM)} m ÷ ${zahl(params.laufgeschwindigkeitMProH)} m/h = ${h4(lauf)}`);
        det('Steckzeit', `${zahl(tg.stueckzahl)} Stk ÷ ${zahl(params.steckzeitStkProH)} Stk/h = ${h4(steck)}`);
        if (d.anzahlExtBeilagen > 0) {
          det('Externe Beilagen einlegen', `${zahl(tg.stueckzahl)} Stk × ${d.anzahlExtBeilagen} ÷ ${zahl(extGeschw)} Stk/h = ${h4(d.zeitExtBeilagenStunden)}`);
        }
      } else {
        det('Teilgebiet', 'nicht mehr in den Stammdaten gefunden — Zeit aus der gespeicherten Berechnung');
      }
      det('Soll-Zeit', `Summe = ${h4(d.zeitStunden)} (${stdMin(d.zeitStunden)})`);
      det('Grundlohn', `${h4(d.zeitStunden)} × ${satzText(z.stundenlohn)}`, d.grundlohn);
      if (z.e.typ === 'springer') {
        det('Springerzulage', `${eur(d.grundlohn)} × ${zahl(z.springerProzent, z.springerProzent % 1 ? 1 : 0)} %${z.springerIndividuell ? ' (individuell im Einsatz festgelegt)' : ''}`, d.springerZuschlag);
      }
      if (z.ausgabe && tg) {
        const a = z.ausgabe;
        const flaeche = (a.seitenformatMm.breite * a.seitenformatMm.hoehe) / 1_000_000;
        det(
          'Gewichtszulage Anzeigenblatt',
          `${a.seitenzahl} Seiten ÷ 2 × ${zahl(flaeche, 4)} m² (${a.seitenformatMm.breite} × ${a.seitenformatMm.hoehe} mm) × ${zahl(a.grammaturGqm)} g/m² × ${zahl(tg.stueckzahl)} Stk ÷ 1000 = ${zahl(z.kgAnzeigenblatt, 2)} kg × ${zahl(params.gewichtszulageAnzeigenblattEurKg, 2)} €/kg`,
          d.gewichtsbonusAnzeigenblatt,
        );
      } else if (d.gewichtsbonusAnzeigenblatt) {
        det('Gewichtszulage Anzeigenblatt', 'aus der gespeicherten Berechnung', d.gewichtsbonusAnzeigenblatt);
      }
      det(
        'Gewichtszulage Beilagen',
        z.beilagenTg.length === 0
          ? 'keine Beilagen in diesem Teilgebiet'
          : `${z.beilagenTg.map((b) => `${b.arbeitstitel || b.kundenname || 'Beilage'} (${zahl(b.gewichtGStk, b.gewichtGStk % 1 ? 1 : 0)} g, ${b.kennzeichen})`).join(', ')}` +
            (tg ? ` → ${zahl(z.beilagenTg.reduce((x, b) => x + b.gewichtGStk, 0), 1)} g × ${zahl(tg.stueckzahl)} Stk ÷ 1000` : '') +
            ` = ${zahl(z.kgBeilagen, 2)} kg × ${zahl(params.gewichtszulageBeilagenEurKg, 2)} €/kg`,
        d.gewichtsbonusBeilagen,
      );
      if (d.sonderbetrag) {
        det('Sondervergütung', z.sv?.begruendung ? `Sondervereinbarung — ${z.sv.begruendung}` : 'Sondervereinbarung', d.sonderbetrag);
      }
      if (z.nachgerechnet != null && !gleich(z.nachgerechnet, d.gesamt)) {
        s.zeile({
          a: '⚠',
          b: `Mit den Stammdaten dieses Exports ergäbe sich ${eur(z.nachgerechnet)}. Abgerechnet ist der beim Monatswechsel fixierte bzw. im Abschluss gespeicherte Wert (z. B. nachträglich geänderte Stückzahl oder Beilagen).`,
          stil: 'hinweis',
          ebene: 2,
        });
      }
    }
    s.zeile({ a: 'Summe Austragen', b: `${h4(summeAustragen.zeit)} Soll-Zeit`, d: er.austraegerGesamt, stil: 'summe' });
  }

  // ======================================================================
  // Zusammentragen
  // ======================================================================
  const ztNvOhneVorarbeit = ztNichtVerguetet.filter((x) => !x.z.istVorarbeit);
  const ztEntfallenOhneVorarbeit = ztEntfallen.filter((z) => !z.istVorarbeit);
  if (!ma.hatFestgehalt && (ztZeilen.length > 0 || ztNvOhneVorarbeit.length > 0 || ztEntfallenOhneVorarbeit.length > 0)) {
    s.zeile({ a: 'Zusammentragen je KW und Teilgebiet', b: anzahl(ztZeilen.length, 'vergütetes Teilgebiet', 'vergütete Teilgebiete'), stil: 'abschnitt' });
    s.zeile({
      a: 'Berechnungsschlüssel',
      b: `Zeit = Stückzahl ÷ ${zahl(geschw1)} Stk/h (erste 2 Stapel) + Stückzahl × (weitere Stapel ab dem 3. + interne Beilagen) ÷ ${zahl(geschw2)} Stk/h; ` +
        `bei nur 1 Stapel ohne interne Beilage keine Zeit. Lohn = Zeit × ${satzText(satzZus)}. Externe Beilagen legt der Austräger ein (nur zur Info). ` +
        'Die Stapelzahl ist an der Ausgabe gepflegt.',
      stil: 'schluessel',
      ebene: 1,
    });
    if (params.zusammentragenNachIstZeit) {
      s.zeile({ a: '⚠', b: 'Zusammentragen wird nach Ist-Zeit abgerechnet — die Vergütung steht im Abschnitt „Zeiterfassung".', stil: 'hinweis', ebene: 1 });
    }
    for (const z of ztZeilen) {
      const st = z.stueckzahl ?? 0;
      const weitere = Math.max(0, z.stapelBearbeitet - 2);
      const intB = z.intBeilagenAnzahl ?? 0;
      const stunden = z.stunden ?? 0;
      const satz = stunden > 0 ? z.lohn / stunden : satzZus;
      const rechenweg = stunden === 0
        ? `${zahl(st)} Stk, ${z.stapelBearbeitet} Stapel, keine interne Beilage → nichts zusammenzutragen, 0 h`
        : `${zahl(st)} Stk ÷ ${zahl(geschw1)} Stk/h` +
          (weitere + intB > 0 ? ` + ${zahl(st)} Stk × (${weitere} weitere Stapel + ${intB} int. Beilage(n)) ÷ ${zahl(geschw2)} Stk/h` : '') +
          ` = ${h4(stunden)} × ${satzText(satz)}`;
      const info = [
        `${z.stapelBearbeitet} Stapel`,
        z.extBeilagenAnzahl ? `${z.extBeilagenAnzahl} ext. Beilage(n) (Info)` : '',
        z.nachtrag ? 'Nachtrag nach Monatswechsel' : '',
      ].filter(Boolean).join(' · ');
      s.zeile({ a: `KW ${z.kw} · ${z.teilgebietName ?? '—'}`, b: `${rechenweg} — ${info}`, d: z.lohn, stil: stunden === 0 ? 'grau' : 'zeile', ebene: 1 });
    }
    for (const z of ztEntfallenOhneVorarbeit) {
      s.zeile({ a: `KW ${z.kw} · ${z.teilgebietName ?? '—'}`, b: `entfällt durch Nachtrag nach dem Monatswechsel (fixiert waren ${eur(z.lohn)}) — nicht vergütet`, stil: 'grau', ebene: 1 });
    }
    for (const x of ztNvOhneVorarbeit) {
      s.zeile({ a: `${x.kw != null ? `KW ${x.kw} · ` : ''}${x.tgName}`, b: `nicht vergütet: ${x.grund}`, stil: 'grau', ebene: 1 });
    }
    s.zeile({ a: 'Summe Zusammentragen (ohne Vorarbeit)', b: h4(ztZeilen.reduce((x, z) => x + (z.stunden ?? 0), 0)), d: summeZt, stil: 'summe' });
  }

  // ======================================================================
  // Vorarbeit (beim Zusammentragen in Minuten erfasst)
  // ======================================================================
  const vaNichtVerguetet = ztNichtVerguetet.filter((x) => x.z.istVorarbeit);
  const vaEntfallen = ztEntfallen.filter((z) => z.istVorarbeit);
  if (!ma.hatFestgehalt && (vorarbeitZt.length > 0 || vaNichtVerguetet.length > 0 || vaEntfallen.length > 0)) {
    s.zeile({ a: 'Vorarbeit (Minutenerfassung)', b: anzahl(vorarbeitZt.length, 'Eintrag', 'Einträge'), stil: 'abschnitt' });
    s.zeile({
      a: 'Berechnungsschlüssel',
      b: `Lohn = Minuten ÷ 60 × ${satzText(satzZus)} (Zusammentragen-Satz). Vergütet nur, wenn die Ausgabe der KW für Vorarbeit freigegeben ist. Gestempelte Vorarbeit steht im Abschnitt „Zeiterfassung".`,
      stil: 'schluessel',
      ebene: 1,
    });
    for (const z of vorarbeitZt) {
      const min = (z.stunden ?? 0) * 60;
      s.zeile({
        a: `KW ${z.kw} · ${z.teilgebietName ?? '—'}`,
        b: `${zahl(min)} min ÷ 60 = ${h4(z.stunden ?? 0)} × ${satzText(satzZus)}${z.nachtrag ? ' — Nachtrag nach Monatswechsel' : ''}`,
        d: z.lohn,
        ebene: 1,
      });
    }
    for (const z of vaEntfallen) {
      s.zeile({ a: `KW ${z.kw} · Vorarbeit`, b: `entfällt durch Nachtrag nach dem Monatswechsel (fixiert waren ${eur(z.lohn)}) — nicht vergütet`, stil: 'grau', ebene: 1 });
    }
    for (const x of vaNichtVerguetet) {
      s.zeile({ a: `${x.kw != null ? `KW ${x.kw} · ` : ''}${x.tgName}`, b: `${x.z.vorarbeitMinuten ?? 0} min — nicht vergütet: ${x.grund}`, stil: 'grau', ebene: 1 });
    }
    s.zeile({ a: 'Summe Vorarbeit (Minutenerfassung)', d: summeVorarbeitZt, stil: 'summe' });
  }

  // ======================================================================
  // Zeiterfassung (Stempeluhr)
  // ======================================================================
  if (zeitZeilen.length > 0) {
    const minErfasst = zeitZeilen.reduce((x, z) => x + Math.max(0, z.az.vorarbeitKappung?.originalNettoMin ?? berechneNettoMinuten(z.az)), 0);
    const minVerguetet = zeitZeilen.filter((z) => z.abgerechnet).reduce((x, z) => x + Math.max(0, berechneNettoMinuten(z.az)), 0);
    s.zeile({ a: 'Zeiterfassung (Stempeluhr)', b: anzahl(zeitZeilen.length, 'Eintrag', 'Einträge'), stil: 'abschnitt' });
    s.zeile({
      a: 'Berechnungsschlüssel',
      b: 'Netto-Zeit = Ende − Beginn − Pausen. Vergütet werden „Sonstige" (immer), Vorarbeit (wenn die Ausgabe der KW freigegeben ist; bei einem Zeitfenster nur der Teil darin, der Rest gilt als Zusammentragen) ' +
        `sowie Austragen/Zusammentragen nur bei Ist-Zeit-Abrechnung. Satz: Vorarbeit/Zusammentragen ${satzText(satzZus)}, sonst ${satzText(satzAustr)}. ` +
        `Grundlage: alle Stempelzeiten im Kalendermonat ${String(periode.monat).padStart(2, '0')}/${periode.jahr}.`,
      stil: 'schluessel',
      ebene: 1,
    });
    for (const { az, abgerechnet, grund } of zeitZeilen) {
      const kp = az.vorarbeitKappung;
      const nettoMin = Math.max(0, berechneNettoMinuten(az));
      const typ = TYP_LABELS[az.typ] ?? az.typ;
      const quelle = az.quelle === 'selbstmeldung' ? ' (Selbstmeldung)' : '';
      const a = `${tagLang(az.startTime)} · ${typ}${quelle}`;
      let b: string;
      if (kp) {
        const erfasst = `erfasst ${uhrzeit(kp.originalStart)}–${uhrzeit(kp.originalEnd)} = netto ${h4(kp.originalNettoMin / 60)}`;
        b = abgerechnet
          ? `${erfasst}; Zeitfenster ${zeitfensterText(kp)}: vergütet ${uhrzeit(az.startTime)}–${az.endTime ? uhrzeit(az.endTime) : 'offen'}` +
            `${az.gesamtPauseMinuten ? `, Pause ${zahl(az.gesamtPauseMinuten, az.gesamtPauseMinuten % 1 ? 1 : 0)} min` : ''} = ${h4(nettoMin / 60)} × ${satzText(satzFuer(az))}; ` +
            `${h4((kp.originalNettoMin - kp.verguetetMin) / 60)} außerhalb gelten als Zusammentragen`
          : `${erfasst} — vollständig außerhalb Zeitfenster ${zeitfensterText(kp)}, gilt als Zusammentragen`;
      } else {
        const zeit = `${uhrzeit(az.startTime)}–${az.endTime ? uhrzeit(az.endTime) : 'offen'}${az.gesamtPauseMinuten ? `, Pause ${zahl(az.gesamtPauseMinuten, az.gesamtPauseMinuten % 1 ? 1 : 0)} min` : ''} → netto ${h4(nettoMin / 60)}`;
        b = abgerechnet ? `${zeit} × ${satzText(satzFuer(az))}` : `${zeit} — nicht vergütet: ${grund}`;
      }
      s.zeile({
        a,
        b,
        d: abgerechnet ? (nettoMin / 60) * satzFuer(az) : null,
        stil: abgerechnet ? 'zeile' : 'grau',
        ebene: 1,
      });
    }
    s.zeile({ a: 'Summe Zeiterfassung', b: `${h4(minVerguetet / 60)} vergütet von ${h4(minErfasst / 60)} erfasst`, d: er.zeitLohn, stil: 'summe' });
    if (aufteilung && aufteilung.vorarbeit > 0) {
      s.zeile({ a: '– davon Vorarbeit', b: 'Position „Vorarbeit" in der Zusammenfassung', c: aufteilung.vorarbeit, stil: 'unter', ebene: 1 });
      s.zeile({ a: '– davon übrige Zeit', b: 'Position „Zeitlohn" in der Zusammenfassung', c: aufteilung.uebrige, stil: 'unter', ebene: 1 });
    }
  }

  // ======================================================================
  // Boni
  // ======================================================================
  // Nur zeigen, wenn es einen Bonus gibt oder der MA überhaupt eine
  // Selbstmeldung abgegeben hat — sonst wäre es eine Liste lauter „keine
  // Selbstmeldung".
  const zeigeBonusZeit = bonusBetrag > 0 && !ma.hatFestgehalt
    && (er.bonusZeiterfassungEur > 0 || bonusZeilen.some((z) => z.einsatz));
  if (zeigeBonusZeit || er.ausgabenBoni.length > 0 || er.bonus) {
    s.zeile({ a: 'Boni', b: 'Bonus Zeiterfassung, Min-Boni, Periodenzusatz (Gewichtszulagen stehen beim Austragen)', stil: 'abschnitt' });
    if (zeigeBonusZeit) {
      s.zeile({
        a: 'Berechnungsschlüssel',
        b: `Bonus Zeiterfassung: ${eur(bonusBetrag)} je Einsatz, für den der MA per QR-Code Arbeitszeit und Restmenge gemeldet und die Meldung abgeschickt hat. ` +
          `Nur für MA mit Rolle „Austräger"${hatRolleAustraeger ? '' : ' — diese Rolle fehlt beim MA'}.`,
        stil: 'schluessel',
        ebene: 1,
      });
      for (const z of bonusZeilen) {
        const ok = z.fehlt.length === 0 && hatRolleAustraeger;
        const az = z.einsatz?.arbeitszeit;
        const meldung = z.fehlt.length === 0
          ? `Meldung vollständig${az ? ` (${isoDatum(az.datum)} ${az.von}–${az.bis}` : ' ('}${z.einsatz?.restmenge != null ? `, Restmenge ${z.einsatz.restmenge}` : ''})`
          : `kein Bonus: ${z.fehlt.join(', ')}`;
        s.zeile({
          a: `KW ${z.kw} · ${z.tgName}`,
          b: `${meldung}${z.ohneAustragen ? ' — Einsatz ohne Austragen-Vergütung' : ''}`,
          c: ok ? bonusBetrag : null,
          stil: ok ? 'unter' : 'grau',
          ebene: 2,
        });
      }
      s.zeile({ a: 'Bonus Zeiterfassung Austragen', b: `${er.bonusZeiterfassungAnzahl} × ${eur(bonusBetrag)}`, d: er.bonusZeiterfassungEur, ebene: 1 });
    }
    if (er.ausgabenBoni.length > 0) {
      for (const b of er.ausgabenBoni) {
        s.zeile({ a: `KW ${b.kw}`, b: `${b.minuten} min ÷ 60 × ${satzText(b.minuten > 0 ? (b.lohn / b.minuten) * 60 : satzAustr)}${b.kommentar ? ` — ${b.kommentar}` : ''}`, c: b.lohn, stil: 'unter', ebene: 2 });
      }
      s.zeile({ a: 'Min-Boni (Tätigkeitsbonus)', b: `${er.ausgabenBoni.length} Ausgaben × ${er.ausgabenBoni[0].minuten} min = ${er.ausgabenBoniMinutenGesamt} min`, d: er.ausgabenBoniLohnGesamt, ebene: 1 });
    }
    if (er.bonus) {
      s.zeile({ a: 'Bonus / variabler Periodenzusatz', b: er.bonusKommentar || 'ohne Kommentar', d: er.bonus, ebene: 1 });
    }
    s.zeile({ a: 'Summe Boni', d: (zeigeBonusZeit ? er.bonusZeiterfassungEur : 0) + er.ausgabenBoniLohnGesamt + er.bonus, stil: 'summe' });
  }

  // ======================================================================
  // Fahrtkosten
  // ======================================================================
  if (er.fahrten.length > 0) {
    s.zeile({ a: 'Fahrtkosten', b: anzahl(er.fahrten.length, 'Fahrt', 'Fahrten'), stil: 'abschnitt' });
    s.zeile({
      a: 'Berechnungsschlüssel',
      b: `Erstattung = km × ${zahl(er.fahrtSatzEurProKm, 2)} €/km (${ma.fahrkostenEurProKm != null ? 'individueller Satz des MA' : 'Satz aus den Parametern'}). Vergütet werden alle Fahrten, die dieser Abrechnungsperiode zugeordnet sind.`,
      stil: 'schluessel',
      ebene: 1,
    });
    for (const f of [...er.fahrten].sort((a, b) => a.datum.localeCompare(b.datum))) {
      const ziel = f.ziel?.trim() || (f.tourIds?.length ? `Touren: ${f.tourIds.join(', ')}` : '—');
      s.zeile({
        a: isoDatum(f.datum),
        b: `${ziel}${f.bemerkung ? ` (${f.bemerkung})` : ''} · ${zahl(f.streckKm, f.streckKm % 1 ? 1 : 0)} km × ${zahl(er.fahrtSatzEurProKm, 2)} €/km`,
        d: f.streckKm * er.fahrtSatzEurProKm,
        ebene: 1,
      });
    }
    s.zeile({ a: 'Summe Fahrtkosten', b: `${zahl(fahrtKm, 1)} km`, d: er.fahrtkostenGesamt, stil: 'summe' });
  }

  // ======================================================================
  // Lohnkonto & Vorschüsse
  // ======================================================================
  if (er.lohnkontoBuchungenPeriode.length > 0 || er.lohnkontoSaldoVorPeriode !== 0 || er.vorschuesse.length > 0) {
    s.zeile({ a: 'Lohnkonto & Vorschüsse', b: 'Wirkung auf den Bruttolohn siehe Zusammenfassung', stil: 'abschnitt' });
    if (er.lohnkontoBuchungenPeriode.length > 0 || er.lohnkontoSaldoVorPeriode !== 0) {
      s.zeile({ a: 'Saldo Lohnkonto vor der Periode', c: er.lohnkontoSaldoVorPeriode, ebene: 1 });
      for (const b of er.lohnkontoBuchungenPeriode) {
        s.zeile({
          a: b.art === 'verschiebung' ? '+ Verschiebung aufs Lohnkonto' : '− Verrechnung (Auszahlung)',
          b: b.kommentar ?? '',
          c: b.art === 'verschiebung' ? b.betragEur : -b.betragEur,
          stil: 'unter',
          ebene: 1,
        });
      }
      s.zeile({ a: 'Saldo Lohnkonto nach der Periode', b: 'Saldo vor + Verschiebungen − Verrechnungen', c: er.lohnkontoSaldoNachPeriode, ebene: 1 });
    }
    for (const v of er.vorschuesse) {
      s.zeile({ a: `Vorschuss ${new Date(v.erstelltAm).toLocaleDateString('de-DE')}`, b: v.bemerkung || '', c: v.betragEur, stil: 'unter', ebene: 1 });
    }
    if (er.vorschuesse.length > 0) {
      s.zeile({ a: 'Summe Vorschüsse', b: 'bereits ausgezahlt, bei der Auszahlung verrechnet', c: er.vorschussSumme, stil: 'summe' });
    }
  }
}

function grundNichtAbgerechnet(az: Arbeitszeit, ma: Mitarbeiter, params: Parameter): string {
  if (az.vorarbeitKappung?.verguetetMin === 0) return 'vollständig außerhalb des Zeitfensters — gilt als Zusammentragen';
  if (ma.hatFestgehalt) return 'Festgehalt — Zeit fließt nicht ein';
  if (az.typ === 'austragen' && !params.austragenNachIstZeit) return 'Austragen wird nach Soll-Zeit (Teilgebiet) vergütet';
  if (az.typ === 'zusammentragen' && !params.zusammentragenNachIstZeit) return 'Zusammentragen wird nach Soll-Zeit (Stapel/Stückzahl) vergütet';
  if (az.typ === 'vorarbeit') return 'Ausgabe der KW nicht für Vorarbeit freigegeben';
  return 'nicht abgerechnet';
}
