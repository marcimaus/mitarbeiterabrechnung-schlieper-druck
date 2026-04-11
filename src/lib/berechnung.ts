// Lohnberechnungslogik für Schlieper-Druck

import type { Teilgebiet, Ausgabe, Beilage, Einsatz, Mitarbeiter, Parameter, Sondervereinbarung } from '../types';

// ---- Alter berechnen ---------------------------------------

export function berechneAlter(geburtsdatum: string): number {
  const heute = new Date();
  const geb = new Date(geburtsdatum);
  let alter = heute.getFullYear() - geb.getFullYear();
  const monatDiff = heute.getMonth() - geb.getMonth();
  if (monatDiff < 0 || (monatDiff === 0 && heute.getDate() < geb.getDate())) {
    alter--;
  }
  return alter;
}

export function istMinderjährig(geburtsdatum: string): boolean {
  return berechneAlter(geburtsdatum) < 18;
}

// ---- Stapel aus Seitenzahl berechnen -----------------------

export function berechneStapel(seitenzahl: number): number[] {
  // Beispiele:
  // 8  → [8]
  // 10 → [8, 2]
  // 14 → [8, 4, 2]
  // 16 → [8, 8]
  const stapel: number[] = [];
  let rest = seitenzahl;
  for (const groesse of [8, 4, 2]) {
    while (rest >= groesse) {
      stapel.push(groesse);
      rest -= groesse;
    }
  }
  return stapel;
}

// ---- Austräger-Zeitwert je Teilgebiet ----------------------

export function berechneAustraegezeit(
  tg: Teilgebiet,
  params: Parameter,
  anzahlExtBeilagen = 0
): number {
  const laufzeit = tg.wegstreckeM / params.laufgeschwindigkeitMProH;
  const steckzeit = tg.stueckzahl / params.steckzeitStkProH;
  // Externe Beilagen: jede externe Beilage kostet zusätzliche Steckzeit
  // (vereinfacht: gleiche Steckrate wie Hauptblatt)
  const beilagenzeit = anzahlExtBeilagen > 0
    ? (tg.stueckzahl * anzahlExtBeilagen) / params.steckzeitStkProH
    : 0;
  return laufzeit + steckzeit + beilagenzeit;
}

// ---- Gewicht je Ausgabe/Teilgebiet -------------------------

export function berechneGewichtAnzeigenblattKg(
  tg: Teilgebiet,
  ausgabe: Ausgabe
): number {
  const blaetter = ausgabe.seitenzahl / 2;
  const flaechemQm =
    (ausgabe.seitenformatMm.breite * ausgabe.seitenformatMm.hoehe) / 1_000_000;
  return (blaetter * flaechemQm * ausgabe.grammaturGqm * tg.stueckzahl) / 1000;
}

export function berechneGewichtBeilagenKg(
  tg: Teilgebiet,
  beilagen: Beilage[]
): number {
  const relevanteBeilagen = beilagen.filter((b) =>
    b.teilgebietIds.includes(tg.id)
  );
  return relevanteBeilagen.reduce(
    (sum, b) => sum + (b.gewichtGStk * tg.stueckzahl) / 1000,
    0
  );
}

// ---- Gewichtsbonus -----------------------------------------

export function berechneGewichtsbonus(
  tg: Teilgebiet,
  ausgabe: Ausgabe,
  beilagen: Beilage[],
  params: Parameter
): number {
  const gwAnzeigenblatt = berechneGewichtAnzeigenblattKg(tg, ausgabe);
  const gwBeilagen = berechneGewichtBeilagenKg(tg, beilagen);
  return (
    gwAnzeigenblatt * params.gewichtszulageAnzeigenblattEurKg +
    gwBeilagen * params.gewichtszulageBeilagenEurKg
  );
}

// ---- Stundenlohn ermitteln ---------------------------------

export function ermittleStundenlohn(
  mitarbeiter: Mitarbeiter,
  params: Parameter
): number {
  if (mitarbeiter.stundenlohnIndividuell !== undefined) {
    return mitarbeiter.stundenlohnIndividuell;
  }
  return istMinderjährig(mitarbeiter.geburtsdatum)
    ? params.stundenlohnMinderjAustr
    : params.stundenlohnErwachseneAustr;
}

// ---- Austräger-Lohn je Einsatz ----------------------------

export interface AustraegerLohnDetail {
  zeitStunden: number;
  grundlohn: number;
  springerZuschlag: number;
  gewichtsbonus: number;
  sonderbetrag: number;
  gesamt: number;
}

export function berechneAustraegerLohn(
  mitarbeiter: Mitarbeiter,
  teilgebiet: Teilgebiet,
  ausgabe: Ausgabe,
  beilagen: Beilage[],
  einsatz: Einsatz,
  sondervereinbarung: Sondervereinbarung | undefined,
  params: Parameter
): AustraegerLohnDetail {
  const stundenlohn = ermittleStundenlohn(mitarbeiter, params);

  const extBeilagen = beilagen.filter(
    (b) => b.kennzeichen === 'ext' && b.teilgebietIds.includes(teilgebiet.id)
  ).length;
  const zeitStunden = berechneAustraegezeit(teilgebiet, params, extBeilagen);

  const springerProzent =
    einsatz.typ === 'springer'
      ? (einsatz.springerZuschlagProzent ?? params.springerZuschlagProzent)
      : 0;
  const springerFaktor = 1 + springerProzent / 100;

  const grundlohn = zeitStunden * stundenlohn;
  const springerZuschlag = grundlohn * (springerProzent / 100);
  const gewichtsbonus = berechneGewichtsbonus(
    teilgebiet,
    ausgabe,
    beilagen,
    params
  );
  const sonderbetrag = sondervereinbarung?.betragEur ?? 0;

  const gesamt =
    grundlohn * springerFaktor + gewichtsbonus + sonderbetrag;

  return {
    zeitStunden,
    grundlohn,
    springerZuschlag,
    gewichtsbonus,
    sonderbetrag,
    gesamt,
  };
}

// ---- Zeiterfassung (tatsächliche Zeiten) -------------------

export function berechneNettoArbeitszeit(
  startTime: number,
  endTime: number,
  gesamtPauseMinuten: number
): number {
  const bruttoMinuten = (endTime - startTime) / 60_000;
  return Math.max(0, bruttoMinuten - gesamtPauseMinuten);
}

// ---- Formatierung ------------------------------------------

export function formatierEuro(betrag: number): string {
  return betrag.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
}

export function formatierStunden(stunden: number): string {
  const h = Math.floor(stunden);
  const m = Math.round((stunden - h) * 60);
  return `${h}:${m.toString().padStart(2, '0')} h`;
}
