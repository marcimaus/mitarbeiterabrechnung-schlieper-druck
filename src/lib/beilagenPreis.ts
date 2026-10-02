// Preisermittlung für Beilagenaufträge (Verkaufspreise gegenüber Kunden).
//
// Preisliste (netto, je angefangene 1.000 Stück, Beilage bis zur Freigrenze
// von 20 g/Stück):
//   Beilage Standardformat A4, bis 20g        45,00 €
//   Beilage kleiner A4, bis A5, bis 20g       54,00 €
//   Beilage kleiner A5, bis 20g               60,00 €
//   Beilage nicht einlegbar bis 20g           65,00 €   ← Kennzeichen „Extern"
//   Jedes weitere angefangene 1g               1,50 €
//
// „Nicht einlegbar" sind Beilagen, die nicht im Werk eingelegt werden können.
// Sie werden separat an die Austräger geliefert und beim Austragen zusammen
// mit dem Anzeigenblatt zugestellt — in der App ist das das Kennzeichen
// „Einlegen: Extern". Dieser Preis ersetzt den Formatpreis.

import type { BeilagenFormat, BeilagenKennzeichen, Parameter } from '../types';

export interface BeilagenPreisParameter {
  beilagenPreisA4EurProTausend: number;
  beilagenPreisA5EurProTausend: number;
  beilagenPreisKleinerA5EurProTausend: number;
  beilagenPreisNichtEinlegbarEurProTausend: number;
  beilagenZuschlagJeGrammEurProTausend: number;
  beilagenFreigrenzeG: number;
  umsatzsteuerProzent: number;
}

export const BEILAGEN_PREIS_DEFAULTS: BeilagenPreisParameter = {
  beilagenPreisA4EurProTausend: 45,
  beilagenPreisA5EurProTausend: 54,
  beilagenPreisKleinerA5EurProTausend: 60,
  beilagenPreisNichtEinlegbarEurProTausend: 65,
  beilagenZuschlagJeGrammEurProTausend: 1.5,
  beilagenFreigrenzeG: 20,
  umsatzsteuerProzent: 19,
};


export function preisParameter(parameter: Partial<Parameter> | null | undefined): BeilagenPreisParameter {
  const p = parameter ?? {};
  return {
    beilagenPreisA4EurProTausend:
      p.beilagenPreisA4EurProTausend ?? BEILAGEN_PREIS_DEFAULTS.beilagenPreisA4EurProTausend,
    beilagenPreisA5EurProTausend:
      p.beilagenPreisA5EurProTausend ?? BEILAGEN_PREIS_DEFAULTS.beilagenPreisA5EurProTausend,
    beilagenPreisKleinerA5EurProTausend:
      p.beilagenPreisKleinerA5EurProTausend ?? BEILAGEN_PREIS_DEFAULTS.beilagenPreisKleinerA5EurProTausend,
    beilagenPreisNichtEinlegbarEurProTausend:
      p.beilagenPreisNichtEinlegbarEurProTausend ?? BEILAGEN_PREIS_DEFAULTS.beilagenPreisNichtEinlegbarEurProTausend,
    beilagenZuschlagJeGrammEurProTausend:
      p.beilagenZuschlagJeGrammEurProTausend ?? BEILAGEN_PREIS_DEFAULTS.beilagenZuschlagJeGrammEurProTausend,
    beilagenFreigrenzeG: p.beilagenFreigrenzeG ?? BEILAGEN_PREIS_DEFAULTS.beilagenFreigrenzeG,
    umsatzsteuerProzent: p.umsatzsteuerProzent ?? BEILAGEN_PREIS_DEFAULTS.umsatzsteuerProzent,
  };
}

export interface BeilagenPreisErgebnis {
  /** Wurde der „nicht einlegbar"-Preis verwendet (Kennzeichen extern)? */
  nichtEinlegbar: boolean;
  /** Bezeichnung der angewandten Preisposition. */
  basisLabel: string;
  /** Grundpreis je 1.000 Stück (netto). */
  basisEurProTausend: number;
  /** Angefangene Gramm über der Freigrenze. */
  zusatzGramm: number;
  /** Gewichtszuschlag je 1.000 Stück (netto). */
  zuschlagEurProTausend: number;
  /** Summe je 1.000 Stück (netto). */
  proTausendEur: number;
  stueckzahl: number;
  nettoEur: number;
  ustEur: number;
  bruttoEur: number;
  ustProzent: number;
  freigrenzeG: number;
  /** Format fehlt → kein Grundpreis ermittelbar. */
  unvollstaendig: boolean;
}

const rund2 = (n: number) => Math.round(n * 100) / 100;

export function berechneBeilagenPreis(
  eingabe: {
    format: BeilagenFormat | '';
    kennzeichen: BeilagenKennzeichen;
    gewichtGStk: number;
    stueckzahl: number;
  },
  parameter: Partial<Parameter> | null | undefined,
): BeilagenPreisErgebnis {
  const p = preisParameter(parameter);
  const nichtEinlegbar = eingabe.kennzeichen === 'ext';

  let basisEurProTausend = 0;
  let basisLabel = '';
  let unvollstaendig = false;
  if (nichtEinlegbar) {
    basisEurProTausend = p.beilagenPreisNichtEinlegbarEurProTausend;
    basisLabel = `Beilage nicht einlegbar bis ${p.beilagenFreigrenzeG}g`;
  } else if (eingabe.format === 'A4') {
    basisEurProTausend = p.beilagenPreisA4EurProTausend;
    basisLabel = `Beilage Standardformat A4, bis ${p.beilagenFreigrenzeG}g`;
  } else if (eingabe.format === 'A5') {
    basisEurProTausend = p.beilagenPreisA5EurProTausend;
    basisLabel = `Beilage kleiner A4, bis A5, bis ${p.beilagenFreigrenzeG}g`;
  } else if (eingabe.format === 'kleinerA5') {
    basisEurProTausend = p.beilagenPreisKleinerA5EurProTausend;
    basisLabel = `Beilage kleiner A5, bis ${p.beilagenFreigrenzeG}g`;
  } else {
    basisLabel = 'Format noch offen';
    unvollstaendig = true;
  }

  // Jedes angefangene Gramm über der Freigrenze kostet extra.
  const zusatzGramm = Math.max(0, Math.ceil((eingabe.gewichtGStk || 0) - p.beilagenFreigrenzeG));
  const zuschlagEurProTausend = rund2(zusatzGramm * p.beilagenZuschlagJeGrammEurProTausend);
  const proTausendEur = rund2(basisEurProTausend + zuschlagEurProTausend);
  const nettoEur = rund2((proTausendEur * (eingabe.stueckzahl || 0)) / 1000);
  const ustEur = rund2((nettoEur * p.umsatzsteuerProzent) / 100);

  return {
    nichtEinlegbar,
    basisLabel,
    basisEurProTausend,
    zusatzGramm,
    zuschlagEurProTausend,
    proTausendEur,
    stueckzahl: eingabe.stueckzahl || 0,
    nettoEur,
    ustEur,
    bruttoEur: rund2(nettoEur + ustEur),
    ustProzent: p.umsatzsteuerProzent,
    freigrenzeG: p.beilagenFreigrenzeG,
    unvollstaendig,
  };
}

export const eur = (n: number) =>
  n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
