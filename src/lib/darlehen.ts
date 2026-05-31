// Logik für Mitarbeiterdarlehen — deterministische Tilgungs-Pläne,
// Status-Berechnung „Stand heute" und Aggregation über mehrere Darlehen
// eines Mitarbeiters (Soll/Ist je Abrechnungsperiode).
//
// Bewusst frei von React/Firestore — reine Logik, jederzeit testbar.

import type { MitarbeiterDarlehen, LohnbueroAbrechnung } from '../types';

// ---- Tilgungsplan eines Darlehens -----------------------------------------

/**
 * Eine Zeile des Tilgungsplans für einen Abrechnungsmonat.
 *  - `geplanteTilgung`: vereinbarte Monatsrate; die LETZTE Zeile ist ggf.
 *    auf die verbleibende Restschuld reduziert.
 *  - `restSchuldDanach`: Restschuld nach Verrechnung dieser Tilgung, ≥ 0.
 */
export interface TilgungsplanZeile {
  jahr: number;
  monat: number; // 1..12
  geplanteTilgung: number;
  restSchuldDanach: number;
}

/**
 * Erzeugt den deterministischen Tilgungsplan aus den Stammdaten.
 * Regeln:
 *  - Beginn = (`startJahr`, `startMonat`).
 *  - Pro Monat wird die vereinbarte Rate getilgt.
 *  - Die letzte Rate wird automatisch reduziert, wenn die Restschuld
 *    kleiner als die Standardrate ist.
 *  - Restschuld wird nie negativ.
 *  - Bei ungültigen Stammdaten (Rate ≤ 0, Auszahlung ≤ 0) gibt es einen
 *    leeren Plan.
 */
export function berechneTilgungsplan(d: MitarbeiterDarlehen): TilgungsplanZeile[] {
  const zeilen: TilgungsplanZeile[] = [];
  const rate = d.monatsRateEur;
  if (!Number.isFinite(rate) || rate <= 0) return zeilen;
  if (!Number.isFinite(d.auszahlungsbetragEur) || d.auszahlungsbetragEur <= 0) return zeilen;

  let rest = round2(d.auszahlungsbetragEur);
  let jahr = d.startJahr;
  let monat = d.startMonat;
  // Sicherheits-Cap: maximal 240 Raten (20 Jahre) — schützt vor
  // Endlosschleifen bei kaputten Daten.
  for (let i = 0; i < 240 && rest > 0; i++) {
    const tilgung = Math.min(rest, rate);
    rest = round2(rest - tilgung);
    zeilen.push({ jahr, monat, geplanteTilgung: round2(tilgung), restSchuldDanach: rest });
    // Nächster Monat
    monat++;
    if (monat > 12) { monat = 1; jahr++; }
  }
  return zeilen;
}

// ---- Status „Stand heute" für ein Darlehen --------------------------------

export interface DarlehenStatus {
  /** Bereits laut Plan getilgter Betrag (bis einschließlich heutiger Monat). */
  getilgtPlan: number;
  /** Verbleibender Restbetrag laut Plan. */
  restPlan: number;
  /** „aktiv" solange Restschuld > 0, sonst „getilgt". */
  status: 'aktiv' | 'getilgt';
  /** Anzahl bereits planmäßig fälliger Raten (bis einschließlich aktuell). */
  rateNr: number;
  /** Gesamtzahl der Raten im Plan. */
  rateGesamt: number;
}

/**
 * „Stand heute" — wieviel ist laut Plan bis zum aktuellen Monat (inkl.)
 * bereits getilgt, was steht noch offen?
 */
export function darlehenStatus(d: MitarbeiterDarlehen, heute: Date = new Date()): DarlehenStatus {
  const plan = berechneTilgungsplan(d);
  const heuteJahr = heute.getFullYear();
  const heuteMonat = heute.getMonth() + 1;
  let getilgt = 0;
  let rest = round2(d.auszahlungsbetragEur);
  let rateNr = 0;
  for (const z of plan) {
    if (jmVorOderGleich(z.jahr, z.monat, heuteJahr, heuteMonat)) {
      getilgt = round2(getilgt + z.geplanteTilgung);
      rest = z.restSchuldDanach;
      rateNr++;
    } else {
      break;
    }
  }
  // Falls Plan noch gar nicht begonnen hat: rest = Auszahlungsbetrag, getilgt = 0
  if (plan.length === 0) {
    rest = 0;
  }
  return {
    getilgtPlan: getilgt,
    restPlan: rest,
    status: rest > 0.005 ? 'aktiv' : 'getilgt',
    rateNr,
    rateGesamt: plan.length,
  };
}

// ---- Pro-MA-Aggregation: Soll/Ist je Periode ------------------------------

export interface MaDarlehenPeriode {
  jahr: number;
  monat: number; // 1..12
  /** Summe der geplanten Tilgungen aller Darlehen dieses MA in dieser Periode. */
  summeGeplant: number;
  /** Summe der tatsächlichen Tilgungen aus Lohnbüro-PDFs (Lohnart 9993).
   *  null = keine PDF für diese Periode/diesen MA gefunden. */
  summeIst: number | null;
  /** Geplant − Ist, null wenn Ist fehlt. Positiv = weniger getilgt als geplant. */
  differenz: number | null;
  /** Summe aller offenen Restbeträge NACH dieser Periode. */
  restSumme: number;
  /** Summe alles bisher (planmäßig) Getilgten BIS einschließlich dieser Periode. */
  getilgtSumme: number;
  /** Anzahl in dieser Periode aktiver Darlehen (also Plan-Tilgung > 0). */
  anzahlAktiv: number;
}

/**
 * Aggregiert die Tilgungspläne aller Darlehen eines Mitarbeiters je
 * Abrechnungsperiode und stellt die tatsächlichen Tilgungen aus den
 * Lohnbüro-PDFs gegenüber.
 *
 * Die Liste reicht vom frühesten Start-Monat bis zum spätesten Monat
 * eines Tilgungsplans. Für jede Periode wird sowohl der Plan-Betrag als
 * auch der Ist-Betrag (Summe `darlehensRueckzahlung` aller LB-Records
 * für den MA in dieser Periode) berechnet.
 */
export function aggregiereMaDarlehen(
  darlehen: MitarbeiterDarlehen[],
  lohnbueroAbrechnungen: LohnbueroAbrechnung[],
  mitarbeiterId: string,
): MaDarlehenPeriode[] {
  const eigene = darlehen.filter((d) => d.mitarbeiterId === mitarbeiterId);
  if (eigene.length === 0) return [];

  // Pro Darlehen: Plan + initialer Restbetrag = Auszahlung
  const plaene = eigene.map((d) => ({
    auszahlung: round2(d.auszahlungsbetragEur),
    zeilen: berechneTilgungsplan(d),
  }));

  // Spannweite der Perioden ermitteln (frühester Start, spätester Monat).
  const allYM = plaene.flatMap((p) => p.zeilen.map((z) => z.jahr * 12 + (z.monat - 1)));
  if (allYM.length === 0) return [];
  const minYM = Math.min(...allYM);
  const maxYM = Math.max(...allYM);

  // Plan-Zeilen pro Periode indexieren.
  // perDarlehen[i] = Map<ym, geplanteTilgung>
  const perDarlehen = plaene.map((p) => {
    const m = new Map<number, number>();
    for (const z of p.zeilen) m.set(z.jahr * 12 + (z.monat - 1), z.geplanteTilgung);
    return m;
  });

  // Ist-Summen pro Periode aus LB-PDFs aggregieren.
  const istProYm = new Map<number, number>();
  const hatPdfYm = new Set<number>();
  for (const lb of lohnbueroAbrechnungen) {
    if (lb.mitarbeiterId !== mitarbeiterId) continue;
    const ym = lb.jahr * 12 + (lb.monat - 1);
    hatPdfYm.add(ym);
    if (lb.darlehensRueckzahlung != null) {
      istProYm.set(ym, round2((istProYm.get(ym) ?? 0) + lb.darlehensRueckzahlung));
    }
  }

  const out: MaDarlehenPeriode[] = [];
  // Pro Darlehen Restschuld mitführen.
  const rest = plaene.map((p) => p.auszahlung);
  for (let ym = minYM; ym <= maxYM; ym++) {
    const jahr = Math.floor(ym / 12);
    const monat = (ym % 12) + 1;
    let summeGeplant = 0;
    let anzahlAktiv = 0;
    for (let i = 0; i < plaene.length; i++) {
      const tilg = perDarlehen[i].get(ym) ?? 0;
      if (tilg > 0) {
        summeGeplant = round2(summeGeplant + tilg);
        anzahlAktiv++;
        rest[i] = round2(rest[i] - tilg);
      }
    }
    const restSumme = round2(rest.reduce((s, r) => s + Math.max(0, r), 0));
    const getilgtSumme = round2(
      plaene.reduce((s, p) => s + p.auszahlung, 0) - restSumme,
    );
    // Ist nur ausweisen, wenn für diese Periode überhaupt ein LB-Record
    // existiert (sonst „—" / null). Fehlt der Wert dort, gilt 0 als Ist.
    const summeIst = hatPdfYm.has(ym) ? (istProYm.get(ym) ?? 0) : null;
    const differenz = summeIst != null ? round2(summeGeplant - summeIst) : null;
    out.push({
      jahr, monat,
      summeGeplant: round2(summeGeplant),
      summeIst,
      differenz,
      restSumme,
      getilgtSumme,
      anzahlAktiv,
    });
  }
  return out;
}

// ---- Abweichungs-Klassifikation (UI-Farben) -------------------------------

export type AbweichungsKlasse = 'gruen' | 'gelb' | 'rot' | 'neutral';

/**
 * Klassifiziert die Differenz Plan − Ist für die farbliche Markierung.
 *  - neutral: kein Ist vorhanden (LB-PDF fehlt für diese Periode)
 *  - grün:    |Δ| ≤ 0,01 €  (planmäßig)
 *  - gelb:    |Δ| ≤ 10 €    (geringe Abweichung, z. B. Rundungs-Rate)
 *  - rot:     |Δ| > 10 € ODER Plan > 0 aber Ist = 0
 */
export function klassifiziereAbweichung(
  geplant: number,
  ist: number | null,
): AbweichungsKlasse {
  if (ist == null) return 'neutral';
  const diff = Math.abs(geplant - ist);
  if (geplant > 0 && ist === 0) return 'rot';
  if (diff <= 0.01) return 'gruen';
  if (diff <= 10) return 'gelb';
  return 'rot';
}

// ---- Helpers --------------------------------------------------------------

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function jmVorOderGleich(jahr: number, monat: number, refJahr: number, refMonat: number): boolean {
  if (jahr < refJahr) return true;
  if (jahr > refJahr) return false;
  return monat <= refMonat;
}
