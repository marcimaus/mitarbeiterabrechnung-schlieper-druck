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
        !m.vorlaeufigNichtAbmelden &&
        (ersetzteIds.has(m.id) || m.letzteAbrechnungsperiodeId === periode.id),
    )
    .sort((a, b) => a.name.localeCompare(b.name));
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
