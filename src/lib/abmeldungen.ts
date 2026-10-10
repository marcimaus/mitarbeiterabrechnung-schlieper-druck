// Abmeldungen ans Lohnbüro je Abrechnungsperiode — eine Quelle für die
// Liste „🚪 Abmeldungen ans Lohnbüro" im Reiter Abrechnung, den
// Periodenabschluss und die Lohnübermittlung.

import type { Abrechnungsperiode, Mitarbeiter } from '../types';

/** Letzter Tag des Periodenmonats als ISO-Datum (YYYY-MM-DD). */
export function periodenEndeIso(periode: Abrechnungsperiode): string {
  const last = new Date(periode.jahr, periode.monat, 0); // monat ist 1..12, day=0 → letzter Tag von periode.monat
  const yyyy = last.getFullYear();
  const mm = (last.getMonth() + 1).toString().padStart(2, '0');
  const dd = last.getDate().toString().padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Offene Abmelde-Liste einer Periode (vor dem Abschluss): ersetzte MAs (deren
 * ID an einem anderen MA als `ersetztMitarbeiterId` steht) plus MAs, die
 * über „+ abmelden" / „+ MA hinzufügen" dieser Periode zugeordnet wurden
 * (`letzteAbrechnungsperiodeId === periode.id`). Reine Vorschläge (aktive MA
 * ohne Betrag) gehören NICHT dazu.
 */
export function offeneAbmeldungen(
  periode: Abrechnungsperiode,
  mitarbeiter: Mitarbeiter[],
): Mitarbeiter[] {
  const ersetzteIds = new Set<string>();
  for (const m of mitarbeiter) {
    if (m.ersetztMitarbeiterId) ersetzteIds.add(m.ersetztMitarbeiterId);
  }
  return mitarbeiter
    .filter(
      (m) =>
        !m.abgemeldet &&
        !m.istInteressent &&
        !m.vorlaeufigNichtAbmelden &&
        (ersetzteIds.has(m.id) || m.letzteAbrechnungsperiodeId === periode.id),
    )
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Zur Abmeldung vorgesehene MA über alle noch nicht abgeschlossenen
 * Perioden: MA-ID → früheste Periode, in deren Abmelde-Liste der MA steht.
 */
export function abmeldungVorgesehenJeMa(
  perioden: Abrechnungsperiode[],
  mitarbeiter: Mitarbeiter[],
): Map<string, Abrechnungsperiode> {
  const out = new Map<string, Abrechnungsperiode>();
  const offen = perioden
    .filter((p) => p.status !== 'abgeschlossen')
    .sort((a, b) => a.jahr - b.jahr || a.monat - b.monat);
  for (const p of offen) {
    for (const m of offeneAbmeldungen(p, mitarbeiter)) {
      if (!out.has(m.id)) out.set(m.id, p);
    }
  }
  return out;
}

/**
 * Liegt die Periode nach der Abmeldung des MA? Maßgeblich ist die letzte
 * Abrechnungsperiode des MA, ersatzweise das Abmeldedatum (Periode beginnt
 * danach). Ohne beides gilt ein abgemeldeter MA in jeder Periode als
 * abgemeldet.
 */
export function istPeriodeNachAbmeldung(
  ma: Pick<Mitarbeiter, 'abgemeldet' | 'letzteAbrechnungsperiodeId' | 'abmeldungUebermittlungDatum'>,
  periode: Pick<Abrechnungsperiode, 'jahr' | 'monat'>,
  perioden: Abrechnungsperiode[],
): boolean {
  if (!ma.abgemeldet) return false;
  const letzte = ma.letzteAbrechnungsperiodeId
    ? perioden.find((p) => p.id === ma.letzteAbrechnungsperiodeId)
    : undefined;
  if (letzte) return periode.jahr * 12 + periode.monat > letzte.jahr * 12 + letzte.monat;
  if (ma.abmeldungUebermittlungDatum) {
    const beginn = `${periode.jahr}-${periode.monat.toString().padStart(2, '0')}-01`;
    return beginn > ma.abmeldungUebermittlungDatum;
  }
  return true;
}

export interface AbmeldeEintrag {
  mitarbeiterId: string;
  name: string;
  nummer: string;
  /** ISO-Datum der Abmeldung. */
  abmeldedatum: string;
}

/**
 * Genau die Einträge, die im Feld „Abmeldungen ans Lohnbüro" stehen: nach
 * dem Abschluss der fixierte Snapshot (bleibt auch nach Wieder-Öffnen
 * maßgeblich), sonst die offene Liste mit dem dort angezeigten Datum.
 */
export function abmeldungenDerPeriode(
  periode: Abrechnungsperiode,
  mitarbeiter: Mitarbeiter[],
): AbmeldeEintrag[] {
  if (periode.abmeldungenSnapshot) {
    return periode.abmeldungenSnapshot.eintraege.map((e) => ({
      mitarbeiterId: e.mitarbeiterId,
      name: e.name,
      nummer: e.nummer,
      abmeldedatum: e.abmeldedatum,
    }));
  }
  const ende = periodenEndeIso(periode);
  return offeneAbmeldungen(periode, mitarbeiter).map((m) => ({
    mitarbeiterId: m.id,
    name: m.name,
    nummer: m.nummer,
    abmeldedatum: m.abmeldungUebermittlungDatum ?? ende,
  }));
}
