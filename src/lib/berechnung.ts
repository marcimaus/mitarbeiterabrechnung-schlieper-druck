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
  // Externe Beilagen: jede externe Beilage kostet zusätzliche Einlegezeit.
  // Verwendet die eigene Geschwindigkeit externeBeilageEinlegeGeschwStkProH (Standard 442 Stk/h).
  const extGeschw = params.externeBeilageEinlegeGeschwStkProH || params.steckzeitStkProH;
  const beilagenzeit = anzahlExtBeilagen > 0
    ? (tg.stueckzahl * anzahlExtBeilagen) / extGeschw
    : 0;
  return laufzeit + steckzeit + beilagenzeit;
}

// ---- Zusammentragen-Zeitwert je Teilgebiet -----------------
/**
 * Soll-Zeit für das Zusammentragen eines Teilgebiets (Stunden).
 * - Bei 1 Stapel und keiner internen Beilage: 0 h (nichts einzulegen).
 * - Ab 2 Stapeln: Basis = Stückzahl / Geschw1 (konstant, unabhängig 1/2 Stapel).
 * - Je weiterem Stapel (ab 3.) oder je interner Beilage: + Stückzahl / Geschw2.
 */
export function berechneZusammentragZeit(
  stueckzahl: number,
  stapelAnzahl: number,
  anzahlIntBeilagen: number,
  params: Parameter
): number {
  const hatArbeit = stapelAnzahl >= 2 || anzahlIntBeilagen > 0;
  if (!hatArbeit) return 0;
  const geschw1 = params.zusammentragGeschwErste2StapelStkProH || 1700;
  const geschw2 = params.zusammentragGeschwWeitereStapelStkProH || 3400;
  const anzWeitere = Math.max(0, stapelAnzahl - 2);
  const zeitBasis = stueckzahl / geschw1;
  const zeitZusatz = (stueckzahl * (anzWeitere + anzahlIntBeilagen)) / geschw2;
  return zeitBasis + zeitZusatz;
}

// ---- Gewicht je Ausgabe/Teilgebiet -------------------------

/**
 * Gewicht eines einzelnen Exemplars des Anzeigenblattes (ohne Beilagen) in Gramm.
 * Berechnung: Fläche (m²) × Grammatur (g/m²) × Anzahl Blätter (= Seitenzahl / 2).
 */
export function berechneGewichtProExemplarG(ausgabe: Ausgabe): number {
  const blaetter = ausgabe.seitenzahl / 2;
  const flaechemQm =
    (ausgabe.seitenformatMm.breite * ausgabe.seitenformatMm.hoehe) / 1_000_000;
  return blaetter * flaechemQm * ausgabe.grammaturGqm;
}

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

/**
 * Soll der MA trotz Minderjährigkeit nach Erwachsenen-MiLoG abgerechnet werden?
 * Nur dann true, wenn das Kennzeichen gesetzt ist UND der MA tatsächlich
 * minderjährig ist (sonst irrelevant).
 */
function alsErwachsenerAbrechnen(mitarbeiter: Mitarbeiter): boolean {
  return (
    mitarbeiter.abrechnungAlsErwachseneMiLoG === true &&
    istMinderjährig(mitarbeiter.geburtsdatum)
  );
}

export function ermittleStundenlohn(
  mitarbeiter: Mitarbeiter,
  params: Parameter
): number {
  if (mitarbeiter.stundenlohnIndividuell !== undefined) {
    return mitarbeiter.stundenlohnIndividuell;
  }
  if (alsErwachsenerAbrechnen(mitarbeiter)) {
    return params.stundenlohnErwachseneAustr;
  }
  return istMinderjährig(mitarbeiter.geburtsdatum)
    ? params.stundenlohnMinderjAustr
    : params.stundenlohnErwachseneAustr;
}

export function ermittleStundenlohnZusammen(
  mitarbeiter: Mitarbeiter,
  params: Parameter
): number {
  if (mitarbeiter.stundenlohnIndividuell !== undefined) {
    return mitarbeiter.stundenlohnIndividuell;
  }
  if (alsErwachsenerAbrechnen(mitarbeiter)) {
    return params.stundenlohnErwachseneZusammen;
  }
  return istMinderjährig(mitarbeiter.geburtsdatum)
    ? params.stundenlohnMinderjZusammen
    : params.stundenlohnErwachseneZusammen;
}

// ---- Austräger-Lohn je Einsatz ----------------------------

export interface AustraegerLohnDetail {
  zeitStunden: number;
  zeitExtBeilagenStunden: number;   // Anteil der Zeit, der aus dem Einlegen externer Beilagen resultiert
  anzahlExtBeilagen: number;        // Anzahl externer Beilagen in diesem Teilgebiet
  grundlohn: number;
  springerZuschlag: number;
  gewichtsbonus: number;
  gewichtsbonusAnzeigenblatt: number;
  gewichtsbonusBeilagen: number;
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
  // Anteil der Austräger-Zeit, der auf das Einlegen externer Beilagen entfällt:
  const extGeschwZeit = params.externeBeilageEinlegeGeschwStkProH || params.steckzeitStkProH;
  const zeitExtBeilagenStunden =
    extBeilagen > 0 ? (teilgebiet.stueckzahl * extBeilagen) / extGeschwZeit : 0;

  const springerProzent =
    einsatz.typ === 'springer'
      ? (einsatz.springerZuschlagProzent ?? params.springerZuschlagProzent)
      : 0;
  const springerFaktor = 1 + springerProzent / 100;

  const grundlohn = zeitStunden * stundenlohn;
  const springerZuschlag = grundlohn * (springerProzent / 100);
  const gwAnzeigenblatt = berechneGewichtAnzeigenblattKg(teilgebiet, ausgabe);
  const gwBeilagen = berechneGewichtBeilagenKg(teilgebiet, beilagen);
  const gewichtsbonusAnzeigenblatt =
    gwAnzeigenblatt * params.gewichtszulageAnzeigenblattEurKg;
  const gewichtsbonusBeilagen =
    gwBeilagen * params.gewichtszulageBeilagenEurKg;
  const gewichtsbonus = gewichtsbonusAnzeigenblatt + gewichtsbonusBeilagen;
  const sonderbetrag = sondervereinbarung?.betragEur ?? 0;

  const gesamt =
    grundlohn * springerFaktor + gewichtsbonus + sonderbetrag;

  return {
    zeitStunden,
    zeitExtBeilagenStunden,
    anzahlExtBeilagen: extBeilagen,
    grundlohn,
    springerZuschlag,
    gewichtsbonus,
    gewichtsbonusAnzeigenblatt,
    gewichtsbonusBeilagen,
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
