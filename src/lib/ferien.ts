// ============================================================
// Schulferien (Niedersachsen) + gesetzliche Feiertage (DE + NDS)
// ============================================================
//
// Bundesweite Feiertage werden via Gauß'scher Osterformel berechnet,
// die niedersächsischen Schulferien sind als Konstanten je Jahr
// hinterlegt (Quelle: Kultusministerium Niedersachsen).
// Reformationstag ist in Niedersachsen seit 2018 gesetzlicher Feiertag.

import { getISOWeek, getISOYear } from './kalender';

// ---------- Schulferien ---------------------------------------

export interface Ferienzeitraum {
  name: string;
  /** ISO-Datum Beginn (inkl.) */
  von: string;
  /** ISO-Datum Ende (inkl.) */
  bis: string;
}

// Niedersachsen — Stand 2026 (offizielle KM-Daten 2025 bis 2028).
// Wenn ein Zeitraum knapp wirkt (z. B. zwei Tage Winterferien), ist
// das so korrekt.
const FERIEN_NDS: Record<number, Ferienzeitraum[]> = {
  2025: [
    { name: 'Winterferien',     von: '2025-01-30', bis: '2025-01-31' },
    { name: 'Osterferien',      von: '2025-03-31', bis: '2025-04-11' },
    { name: 'Pfingstferien',    von: '2025-05-30', bis: '2025-05-30' },
    { name: 'Sommerferien',     von: '2025-07-24', bis: '2025-09-03' },
    { name: 'Herbstferien',     von: '2025-10-13', bis: '2025-10-25' },
    { name: 'Weihnachtsferien', von: '2025-12-22', bis: '2026-01-05' },
  ],
  2026: [
    { name: 'Winterferien',     von: '2026-02-02', bis: '2026-02-03' },
    { name: 'Osterferien',      von: '2026-03-23', bis: '2026-04-08' },
    { name: 'Sommerferien',     von: '2026-07-16', bis: '2026-08-26' },
    { name: 'Herbstferien',     von: '2026-10-12', bis: '2026-10-23' },
    { name: 'Weihnachtsferien', von: '2026-12-21', bis: '2027-01-02' },
  ],
  2027: [
    { name: 'Winterferien',     von: '2027-01-28', bis: '2027-01-29' },
    { name: 'Osterferien',      von: '2027-03-22', bis: '2027-04-07' },
    { name: 'Sommerferien',     von: '2027-07-22', bis: '2027-09-01' },
    { name: 'Herbstferien',     von: '2027-10-18', bis: '2027-10-29' },
    { name: 'Weihnachtsferien', von: '2027-12-23', bis: '2028-01-08' },
  ],
  2028: [
    { name: 'Winterferien',     von: '2028-02-03', bis: '2028-02-04' },
    { name: 'Osterferien',      von: '2028-04-10', bis: '2028-04-22' },
    { name: 'Sommerferien',     von: '2028-07-20', bis: '2028-08-30' },
    { name: 'Herbstferien',     von: '2028-10-23', bis: '2028-11-03' },
    { name: 'Weihnachtsferien', von: '2028-12-22', bis: '2029-01-05' },
  ],
};

/**
 * Liefert alle Ferien-Zeiträume, die mindestens einen Tag in der
 * angegebenen ISO-Kalenderwoche enthalten. Zeiträume, die über
 * Jahresgrenzen gehen (Weihnachtsferien), werden in beiden ISO-Jahren
 * berücksichtigt.
 */
export function ferienInKw(jahr: number, kw: number): Ferienzeitraum[] {
  const treffer: Ferienzeitraum[] = [];
  // Suche in mehreren Jahres-Buckets, weil Weihnachtsferien Vorjahr→Folgejahr.
  for (const j of [jahr - 1, jahr, jahr + 1]) {
    const list = FERIEN_NDS[j] ?? [];
    for (const f of list) {
      const von = new Date(f.von);
      const bis = new Date(f.bis);
      // Iteriere durch alle Tage; sobald ein Tag in (jahr, kw) liegt → Treffer.
      const c = new Date(von);
      let trifft = false;
      while (c <= bis) {
        if (getISOYear(c) === jahr && getISOWeek(c) === kw) {
          trifft = true;
          break;
        }
        c.setDate(c.getDate() + 1);
      }
      if (trifft && !treffer.some((t) => t.von === f.von && t.bis === f.bis)) {
        treffer.push(f);
      }
    }
  }
  return treffer;
}

// ---------- Feiertage -----------------------------------------

export interface Feiertag {
  name: string;
  /** ISO-Datum */
  datum: string;
  /** 'de' = bundesweit, 'nds' = nur in Niedersachsen. */
  scope: 'de' | 'nds';
}

/**
 * Gauß'sche Osterformel. Liefert das Osterdatum (Sonntag) für ein
 * gegebenes Jahr.
 */
function ostern(jahr: number): Date {
  const a = jahr % 19;
  const b = Math.floor(jahr / 100);
  const c = jahr % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31); // 3=März, 4=April
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(jahr, month - 1, day);
}

function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function addDays(d: Date, days: number): Date {
  const c = new Date(d);
  c.setDate(c.getDate() + days);
  return c;
}

/**
 * Alle gesetzlichen Feiertage eines Jahres (bundesweit + Niedersachsen).
 * Cache pro Jahr für Performance.
 */
const feiertageCache = new Map<number, Feiertag[]>();
function feiertageProJahr(jahr: number): Feiertag[] {
  const c = feiertageCache.get(jahr);
  if (c) return c;
  const o = ostern(jahr);
  const list: Feiertag[] = [
    { name: 'Neujahr',                 datum: `${jahr}-01-01`,           scope: 'de' },
    { name: 'Karfreitag',              datum: isoDate(addDays(o, -2)),   scope: 'de' },
    { name: 'Ostermontag',             datum: isoDate(addDays(o, 1)),    scope: 'de' },
    { name: 'Tag der Arbeit',          datum: `${jahr}-05-01`,           scope: 'de' },
    { name: 'Christi Himmelfahrt',     datum: isoDate(addDays(o, 39)),   scope: 'de' },
    { name: 'Pfingstmontag',           datum: isoDate(addDays(o, 50)),   scope: 'de' },
    { name: 'Tag der Deutschen Einheit', datum: `${jahr}-10-03`,         scope: 'de' },
    { name: 'Reformationstag',         datum: `${jahr}-10-31`,           scope: 'nds' },
    { name: '1. Weihnachtstag',        datum: `${jahr}-12-25`,           scope: 'de' },
    { name: '2. Weihnachtstag',        datum: `${jahr}-12-26`,           scope: 'de' },
  ];
  feiertageCache.set(jahr, list);
  return list;
}

/**
 * Liefert alle Feiertage, die in (jahr, kw) liegen. Beachtet ISO-KW —
 * z. B. der 1. Januar fällt manchmal in die KW 52/53 des Vorjahres.
 */
export function feiertageInKw(jahr: number, kw: number): Feiertag[] {
  const treffer: Feiertag[] = [];
  // Vor- und Folgejahr abdecken (KW über Jahresgrenze).
  for (const j of [jahr - 1, jahr, jahr + 1]) {
    for (const f of feiertageProJahr(j)) {
      const d = new Date(f.datum);
      if (getISOYear(d) === jahr && getISOWeek(d) === kw) treffer.push(f);
    }
  }
  return treffer;
}
