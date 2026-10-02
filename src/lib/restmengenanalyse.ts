// Restmengen-/Fehlmengen-Analyse je Teilgebiet über mehrere Abrechnungs-
// perioden. Aus allen eingereichten Austräger-Meldungen (Einsätze mit
// gepflegter Rest-/Fehlmenge) wird pro Teilgebiet der Durchschnitt je Meldung
// (= je Ausgabe/Woche) ermittelt. Genutzt von HomeScreen (Top-Liste) und
// AbrechnungScreen (Hinweis beim Abschluss).

import type { Abrechnungsperiode, Einsatz, Teilgebiet } from '../types';

export interface TgRestmengeStat {
  teilgebietId: string;
  name: string;
  plz?: string;
  /** Anzahl Meldungen (Einsätze mit gepflegter Rest-/Fehlmenge) im Zeitraum. */
  anzahlMeldungen: number;
  summeRest: number;
  summeFehl: number;
  /** Ø Restmenge je Meldung (summeRest / anzahlMeldungen). */
  durchschnittRest: number;
  /** Ø Fehlmenge je Meldung. */
  durchschnittFehl: number;
}

/** Die n jüngsten Perioden (nach Jahr/Monat absteigend sortiert). */
export function juengstePerioden(
  perioden: Abrechnungsperiode[],
  n: number,
): Abrechnungsperiode[] {
  return [...perioden]
    .sort((a, b) => (b.jahr - a.jahr) || (b.monat - a.monat))
    .slice(0, n);
}

/** True, wenn der Einsatz (über kw/jahr) zu einer der Perioden gehört. */
function gehoertZuPerioden(e: Einsatz, perioden: Abrechnungsperiode[]): boolean {
  return perioden.some(
    (p) => p.jahr === e.jahr && p.kalenderwochen.includes(e.kw),
  );
}

/** Einsatz trägt eine eingereichte Rest-/Fehlmengen-Meldung? */
function hatMeldung(e: Einsatz): boolean {
  return (
    e.meldungEingereichtAm != null ||
    e.restmenge != null ||
    e.fehlmenge != null
  );
}

/**
 * Aggregiert Rest-/Fehlmengen je Teilgebiet über die gegebenen Perioden und
 * liefert die Liste absteigend nach Ø-Restmenge je Meldung. Teilgebiete ohne
 * Meldungen erscheinen nicht.
 */
export function analysiereRestmengen(
  einsaetze: Einsatz[],
  perioden: Abrechnungsperiode[],
  teilgebiete: Teilgebiet[],
): TgRestmengeStat[] {
  const tgMap = new Map(teilgebiete.map((t) => [t.id, t]));
  const agg = new Map<string, { rest: number; fehl: number; count: number }>();

  for (const e of einsaetze) {
    if (!gehoertZuPerioden(e, perioden)) continue;
    if (!hatMeldung(e)) continue;
    const cur = agg.get(e.teilgebietId) ?? { rest: 0, fehl: 0, count: 0 };
    cur.rest += e.restmenge ?? 0;
    cur.fehl += e.fehlmenge ?? 0;
    cur.count += 1;
    agg.set(e.teilgebietId, cur);
  }

  const result: TgRestmengeStat[] = [];
  for (const [tgId, v] of agg) {
    const tg = tgMap.get(tgId);
    result.push({
      teilgebietId: tgId,
      name: tg?.name ?? '— gelöscht —',
      plz: tg?.plz,
      anzahlMeldungen: v.count,
      summeRest: v.rest,
      summeFehl: v.fehl,
      durchschnittRest: v.count > 0 ? v.rest / v.count : 0,
      durchschnittFehl: v.count > 0 ? v.fehl / v.count : 0,
    });
  }

  result.sort(
    (a, b) =>
      b.durchschnittRest - a.durchschnittRest ||
      b.durchschnittFehl - a.durchschnittFehl ||
      b.summeRest - a.summeRest,
  );
  return result;
}
