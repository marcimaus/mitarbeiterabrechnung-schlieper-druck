// Mitarbeiter-Auswahl in Personalplanung und Einsätzen — eine Quelle für den
// Anmeldestatus beim Lohnbüro in Auswahlfeldern:
//   · Namenszusatz „(abgemeldet)", „(Abmeldung vorgesehen)",
//     „(noch nicht angemeldet)"
//   · Reihenfolge: alle übrigen oben, abgemeldete ganz unten
//   · Warnung (Rückfrage) bei Auswahl eines abgemeldeten MA
//   · Hinweistexte für die Anzeige unter dem Auswahlfeld

import type { Abrechnungsperiode, Mitarbeiter } from '../types';
import { tgLieferadresseFuer } from '../utils';
import { abmeldungVorgesehenJeMa } from './abmeldungen';

export type AnmeldeStatus =
  | 'angemeldet'
  | 'noch-nicht-angemeldet'
  | 'abmeldung-vorgesehen'
  | 'abgemeldet';

/** Zusatz hinter dem Namen in Auswahlfeldern (leer = kein Zusatz). */
export const ANMELDESTATUS_ZUSATZ: Record<AnmeldeStatus, string> = {
  angemeldet: '',
  'noch-nicht-angemeldet': 'noch nicht angemeldet',
  'abmeldung-vorgesehen': 'Abmeldung vorgesehen',
  abgemeldet: 'abgemeldet',
};

export const ANMELDESTATUS_ICON: Record<AnmeldeStatus, string> = {
  angemeldet: '',
  'noch-nicht-angemeldet': '⏳',
  'abmeldung-vorgesehen': '📤',
  abgemeldet: '🚪',
};

export interface MaAuswahlKontext {
  /** MA-ID → Periode, zu deren Ende die Abmeldung vorgesehen ist. */
  abmeldungVorgesehen: Map<string, Abrechnungsperiode>;
}

export function erstelleMaAuswahlKontext(
  perioden: Abrechnungsperiode[],
  mitarbeiter: Mitarbeiter[],
): MaAuswahlKontext {
  return { abmeldungVorgesehen: abmeldungVorgesehenJeMa(perioden, mitarbeiter) };
}

/**
 * Darf der MA in Auswahlfeldern der Personalplanung / Einsätze angeboten
 * werden? Aktive MA plus abgemeldete (beim Periodenabschluss deaktivierte) —
 * letztere nur am Listenende und mit Warnung. Interessenten und
 * Legacy-Datensätze nie.
 */
export function istInPlanungAuswaehlbar(
  m: Pick<Mitarbeiter, 'isActive' | 'abgemeldet' | 'istInteressent' | 'istLegacy'>,
): boolean {
  if (m.istInteressent || m.istLegacy) return false;
  return m.isActive === true || m.abgemeldet === true;
}

export function anmeldeStatus(m: Mitarbeiter, ktx: MaAuswahlKontext): AnmeldeStatus {
  if (m.abgemeldet) return 'abgemeldet';
  if (ktx.abmeldungVorgesehen.has(m.id)) return 'abmeldung-vorgesehen';
  if (m.nochNichtAngemeldet) return 'noch-nicht-angemeldet';
  return 'angemeldet';
}

/** Name (bzw. Kürzel) mit Status-Zusatz und optionalen weiteren Zusätzen. */
export function maAuswahlLabel(
  m: Mitarbeiter,
  ktx: MaAuswahlKontext,
  opts: { kuerzel?: boolean; zusaetze?: string[] } = {},
): string {
  const name = opts.kuerzel && m.kuerzel ? m.kuerzel : m.name;
  const zusaetze = [ANMELDESTATUS_ZUSATZ[anmeldeStatus(m, ktx)], ...(opts.zusaetze ?? [])].filter(Boolean);
  return zusaetze.length > 0 ? `${name} (${zusaetze.join(', ')})` : name;
}

/**
 * Zusatz für Springer-/Austräger-Auswahlfelder: Ein Abholer mit eigener
 * Lieferadresse für dieses Teilgebiet wird dort beliefert und holt NICHT ab.
 */
export function abholerLieferadrZusatz(
  m: Mitarbeiter,
  teilgebietId: string | null | undefined,
): string[] {
  return teilgebietId && m.istAbholer && tgLieferadresseFuer(m, teilgebietId)
    ? ['abw. Lieferadr.']
    : [];
}

/**
 * Teilt eine Auswahlliste: oben alle nicht abgemeldeten (Reihenfolge der
 * Eingabe bleibt erhalten), unten die abgemeldeten.
 */
export function teileMaAuswahl<T extends Pick<Mitarbeiter, 'abgemeldet'>>(
  liste: T[],
): { oben: T[]; abgemeldet: T[] } {
  return {
    oben: liste.filter((m) => !m.abgemeldet),
    abgemeldet: liste.filter((m) => m.abgemeldet),
  };
}

function fmtDatum(iso: string | undefined): string {
  const m = iso ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso) : null;
  return m ? `${m[3]}.${m[2]}.${m[1]}` : '';
}

/**
 * Rückfrage bei Auswahl eines abgemeldeten MA. true = Auswahl übernehmen.
 * Für alle anderen MA ohne Rückfrage true.
 */
export function bestaetigeMaAuswahl(m: Mitarbeiter | undefined | null): boolean {
  if (!m?.abgemeldet) return true;
  const seit = fmtDatum(m.abmeldungUebermittlungDatum);
  return confirm(
    `⚠ ${m.name} ist beim Lohnbüro abgemeldet${seit ? ` (Abmeldung zum ${seit})` : ''}.\n\n` +
      'Für einen Einsatz muss der Mitarbeiter wieder angemeldet werden ' +
      '(Mitarbeiter → Reiter „Anmeldung / Abmeldung": Kennzeichen „abgemeldet" entfernen ' +
      'und den Anmeldeprozess starten). Fällt in einer Periode nach der Abmeldung ein ' +
      'Betrag an, warnt die Abrechnung.\n\n' +
      'Trotzdem auswählen?',
  );
}

export interface MaAuswahlHinweis {
  stufe: 'warnung' | 'hinweis';
  text: string;
}

/** Warn-/Hinweistext zum Anmeldestatus des ausgewählten MA (null = keiner). */
export function anmeldeHinweis(m: Mitarbeiter, ktx: MaAuswahlKontext): MaAuswahlHinweis | null {
  switch (anmeldeStatus(m, ktx)) {
    case 'abgemeldet': {
      const seit = fmtDatum(m.abmeldungUebermittlungDatum);
      return {
        stufe: 'warnung',
        text:
          `${m.name} ist beim Lohnbüro abgemeldet${seit ? ` (zum ${seit})` : ''} — vor dem Einsatz ` +
          'wieder anmelden (Mitarbeiter → Anmeldung / Abmeldung).',
      };
    }
    case 'abmeldung-vorgesehen': {
      const p = ktx.abmeldungVorgesehen.get(m.id);
      return {
        stufe: 'hinweis',
        text:
          `${m.name} ist zur Abmeldung beim Lohnbüro vorgesehen` +
          `${p ? ` (Abrechnung ${p.bezeichnung} → „Abmeldungen ans Lohnbüro")` : ''}. ` +
          'Liegt der Einsatz danach, die Abmeldung ggf. zurücknehmen.',
      };
    }
    case 'noch-nicht-angemeldet':
      return {
        stufe: 'hinweis',
        text: `${m.name} ist noch nicht beim Lohnbüro angemeldet — Anmeldung vor dem Periodenabschluss erledigen.`,
      };
    default:
      return null;
  }
}
