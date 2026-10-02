// Berechnungslogik der Ausgaben-/Beilagen-Statistik.
//
// Reine Funktionen (kein Firestore) — leicht testbar. Die UI lädt die
// `StatistikJahr`-Dokumente über `lib/db.ts` und reicht sie hier hinein.

import type { StatistikJahr, Ausgabe, Beilage, Teilgebiet } from '../types';

/** Anzeigbarer Wert einer Zelle, oder null wenn leer. */
export function zellWert(jahr: StatistikJahr | undefined, kw: number): number | null {
  const z = jahr?.zellen?.[kw];
  if (!z || z.wert == null || Number.isNaN(z.wert)) return null;
  return z.wert;
}

/** Mittelwert einer Zahlenliste, oder null bei leerer Liste. */
function mittel(werte: number[]): number | null {
  if (werte.length === 0) return null;
  return werte.reduce((a, b) => a + b, 0) / werte.length;
}

/**
 * Gesamt-Durchschnitt einer KW über alle Jahre (alle vorhandenen Werte).
 * `jahre` muss bereits auf einen Typ gefiltert sein.
 */
export function gesamtDurchschnittJeKW(jahre: StatistikJahr[], kw: number): number | null {
  const werte: number[] = [];
  for (const j of jahre) {
    const w = zellWert(j, kw);
    if (w != null) werte.push(w);
  }
  return mittel(werte);
}

/**
 * Durchschnitt der jüngsten 4 Jahre (echt vor `bezugsjahr`) über die KW und
 * ihre Nachbarn (±1 KW). `jahre` muss bereits auf einen Typ gefiltert sein.
 */
export function durchschnitt4JahreUmKW(
  jahre: StatistikJahr[],
  kw: number,
  bezugsjahr: number,
): number | null {
  const juengste4 = jahre
    .filter((j) => j.jahr < bezugsjahr)
    .sort((a, b) => b.jahr - a.jahr)
    .slice(0, 4);
  const werte: number[] = [];
  for (const j of juengste4) {
    for (const k of [kw - 1, kw, kw + 1]) {
      if (k < 1 || k > 53) continue;
      const w = zellWert(j, k);
      if (w != null) werte.push(w);
    }
  }
  return mittel(werte);
}

export interface JahresKennzahlen {
  summe: number;
  durchschnitt: number | null;
  min: number | null;
  max: number | null;
  anzahl: number;
}

/** Summe / Ø / Min / Max über alle gesetzten Zellen eines Jahres. */
export function jahresKennzahlen(jahr: StatistikJahr | undefined): JahresKennzahlen {
  const werte: number[] = [];
  if (jahr?.zellen) {
    for (const kw of Object.keys(jahr.zellen)) {
      const w = zellWert(jahr, Number(kw));
      if (w != null) werte.push(w);
    }
  }
  const summe = werte.reduce((a, b) => a + b, 0);
  return {
    summe,
    durchschnitt: mittel(werte),
    min: werte.length ? Math.min(...werte) : null,
    max: werte.length ? Math.max(...werte) : null,
    anzahl: werte.length,
  };
}

// ---- App-Vorschläge (ab 2026) ------------------------------

/** Vorschlag Seitenzahl = erfasste Seitenzahl der Ausgabe (0 = noch leer). */
export function appVorschlagSeiten(ausgabe: Ausgabe | undefined): number | null {
  if (!ausgabe || !ausgabe.seitenzahl) return null;
  return ausgabe.seitenzahl;
}

/**
 * Vorschlag Beilagensumme = Summe der verteilten Exemplare über alle Beilagen
 * (je Beilage: Σ Stückzahl ihrer Teilgebiete), in Tausend.
 */
export function appVorschlagBeilagen(
  beilagen: Beilage[],
  teilgebiete: Teilgebiet[],
): number | null {
  if (beilagen.length === 0) return null;
  const stueckProTg = new Map(teilgebiete.map((t) => [t.id, t.stueckzahl ?? 0]));
  let exemplare = 0;
  for (const b of beilagen) {
    for (const tgId of b.teilgebietIds) {
      exemplare += stueckProTg.get(tgId) ?? 0;
    }
  }
  if (exemplare === 0) return null;
  return exemplare / 1000;
}
