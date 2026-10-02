// ============================================================
// Schulferien (Niedersachsen) + gesetzliche Feiertage (DE + NDS)
// ============================================================
//
// Zwei Datenquellen, klar getrennt:
//
//  1. VORLAGE (dieses Modul): die Ferienordnung Niedersachsen für die
//     Schuljahre 2023/24 bis 2029/30 als Konstanten, die Feiertage via
//     Gauß'scher Osterformel berechnet. Greift, solange für ein Jahr
//     nichts Gepflegtes vorliegt — die App funktioniert also auch ohne
//     Import sofort.
//
//  2. GEPFLEGTE DATEN (Firestore, Collection `ferienkalender`): werden
//     über `setzeFerienkalender()` in diesen Store geschoben, sobald der
//     Listener Daten liefert. Liegt für ein Jahr + Art mindestens ein
//     Datensatz vor, gilt AUSSCHLIESSLICH dieser. Damit bleibt ein
//     bewusst gelöschter Eintrag gelöscht und taucht nicht aus der
//     Vorlage wieder auf.
//
// Pflege/Import laufen über `src/lib/ferienkalender.ts` und die
// Ferienkalender-Verwaltung in der Personalplanung.
//
// Reformationstag ist in Niedersachsen seit 2018 gesetzlicher Feiertag.

import { getISOWeek, getISOYear } from './kalender';
import type { FerienkalenderEintrag } from '../types';

// ---------- Schulferien ---------------------------------------

export interface Ferienzeitraum {
  name: string;
  /** ISO-Datum Beginn (inkl.) */
  von: string;
  /** ISO-Datum Ende (inkl.) */
  bis: string;
}

// Niedersachsen — Ferienordnung für die Schuljahre 2023/24 bis 2029/30
// (Nds. Kultusministerium / KMK). Gebucht auf das Jahr des BEGINNS:
// Weihnachtsferien 2026 → 23.12.2026–09.01.2027 stehen unter 2026.
//
// Einzelne Ferientage (z. B. „Tag nach Himmelfahrt") sind Teil der
// offiziellen Ferienordnung — ein Zeitraum mit nur einem Tag ist also
// korrekt und kein Fehler.
const FERIEN_NDS: Record<number, Ferienzeitraum[]> = {
  2024: [
    { name: 'Halbjahresferien',        von: '2024-02-01', bis: '2024-02-02' },
    { name: 'Osterferien',             von: '2024-03-18', bis: '2024-03-28' },
    { name: 'Tag nach Himmelfahrt',    von: '2024-05-10', bis: '2024-05-10' },
    { name: 'Pfingstferien',           von: '2024-05-21', bis: '2024-05-21' },
    { name: 'Sommerferien',            von: '2024-06-24', bis: '2024-08-03' },
    { name: 'Herbstferien',            von: '2024-10-04', bis: '2024-10-19' },
    { name: 'Tag nach dem Reformationstag', von: '2024-11-01', bis: '2024-11-01' },
    { name: 'Weihnachtsferien',        von: '2024-12-23', bis: '2025-01-04' },
  ],
  2025: [
    { name: 'Halbjahresferien',        von: '2025-02-03', bis: '2025-02-04' },
    { name: 'Osterferien',             von: '2025-04-07', bis: '2025-04-19' },
    { name: 'Kirchentag',              von: '2025-04-30', bis: '2025-04-30' },
    { name: 'Tag nach dem 1. Mai',     von: '2025-05-02', bis: '2025-05-02' },
    { name: 'Tag nach Himmelfahrt',    von: '2025-05-30', bis: '2025-05-30' },
    { name: 'Pfingstferien',           von: '2025-06-10', bis: '2025-06-10' },
    { name: 'Sommerferien',            von: '2025-07-03', bis: '2025-08-13' },
    { name: 'Herbstferien',            von: '2025-10-13', bis: '2025-10-25' },
    { name: 'Weihnachtsferien',        von: '2025-12-22', bis: '2026-01-05' },
  ],
  2026: [
    { name: 'Halbjahresferien',        von: '2026-02-02', bis: '2026-02-03' },
    { name: 'Osterferien',             von: '2026-03-23', bis: '2026-04-07' },
    { name: 'Tag nach Himmelfahrt',    von: '2026-05-15', bis: '2026-05-15' },
    { name: 'Pfingstferien',           von: '2026-05-26', bis: '2026-05-26' },
    { name: 'Sommerferien',            von: '2026-07-02', bis: '2026-08-12' },
    { name: 'Herbstferien',            von: '2026-10-12', bis: '2026-10-24' },
    { name: 'Weihnachtsferien',        von: '2026-12-23', bis: '2027-01-09' },
  ],
  2027: [
    { name: 'Halbjahresferien',        von: '2027-02-01', bis: '2027-02-02' },
    { name: 'Osterferien',             von: '2027-03-22', bis: '2027-04-03' },
    { name: 'Tag nach Himmelfahrt',    von: '2027-05-07', bis: '2027-05-07' },
    { name: 'Pfingstferien',           von: '2027-05-18', bis: '2027-05-18' },
    { name: 'Sommerferien',            von: '2027-07-08', bis: '2027-08-18' },
    { name: 'Herbstferien',            von: '2027-10-16', bis: '2027-10-30' },
    { name: 'Weihnachtsferien',        von: '2027-12-23', bis: '2028-01-08' },
  ],
  2028: [
    { name: 'Halbjahresferien',        von: '2028-01-31', bis: '2028-02-01' },
    { name: 'Osterferien',             von: '2028-04-10', bis: '2028-04-22' },
    { name: 'Tag nach Himmelfahrt',    von: '2028-05-26', bis: '2028-05-26' },
    { name: 'Pfingstferien',           von: '2028-06-06', bis: '2028-06-06' },
    { name: 'Sommerferien',            von: '2028-07-20', bis: '2028-08-30' },
    { name: 'Tag vor dem 3. Oktober',  von: '2028-10-02', bis: '2028-10-02' },
    { name: 'Herbstferien',            von: '2028-10-23', bis: '2028-11-04' },
    { name: 'Weihnachtsferien',        von: '2028-12-27', bis: '2029-01-06' },
  ],
  2029: [
    { name: 'Halbjahresferien',        von: '2029-02-01', bis: '2029-02-02' },
    { name: 'Osterferien',             von: '2029-03-19', bis: '2029-04-03' },
    { name: 'Tag vor dem 1. Mai',      von: '2029-04-30', bis: '2029-04-30' },
    { name: 'Tag nach Himmelfahrt',    von: '2029-05-11', bis: '2029-05-11' },
    { name: 'Pfingstferien',           von: '2029-05-22', bis: '2029-05-22' },
    { name: 'Sommerferien',            von: '2029-07-19', bis: '2029-08-29' },
    { name: 'Tage nach dem 3. Oktober', von: '2029-10-04', bis: '2029-10-05' },
    { name: 'Herbstferien',            von: '2029-10-22', bis: '2029-11-02' },
    { name: 'Weihnachtsferien',        von: '2029-12-21', bis: '2030-01-05' },
  ],
  // 2030 endet mit den Sommerferien — die Ferienordnung reicht nur bis
  // zum Schuljahr 2029/30. Herbst-/Weihnachtsferien 2030 kommen über
  // den Import, sobald das KM sie veröffentlicht hat.
  2030: [
    { name: 'Halbjahresferien',        von: '2030-01-31', bis: '2030-02-01' },
    { name: 'Osterferien',             von: '2030-04-08', bis: '2030-04-23' },
    { name: 'Tag nach Himmelfahrt',    von: '2030-05-31', bis: '2030-05-31' },
    { name: 'Pfingstferien',           von: '2030-06-11', bis: '2030-06-11' },
    { name: 'Sommerferien',            von: '2030-07-11', bis: '2030-08-21' },
  ],
};

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
 * Alle gesetzlichen Feiertage eines Jahres (bundesweit + Niedersachsen)
 * als Vorlage. Cache pro Jahr für Performance.
 */
const feiertageCache = new Map<number, Feiertag[]>();
function feiertageVorlage(jahr: number): Feiertag[] {
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

// ---------- Store für gepflegte Daten -------------------------
//
// Modul-globaler Store statt React-Context: `ferienInKw` /
// `feiertageInKw` werden tief in der Tabelle je Zelle aufgerufen und
// sollen synchron bleiben. Die Personalplanung hält den Store über den
// Firestore-Listener aktuell und rendert bei Änderungen neu.

let gepflegteFerien = new Map<number, Ferienzeitraum[]>();
let gepflegteFeiertage = new Map<number, Feiertag[]>();

/**
 * Übernimmt die in Firestore gepflegten Ferien/Feiertage. Ersetzt den
 * bisherigen Inhalt vollständig (der Listener liefert immer den
 * kompletten Stand).
 */
export function setzeFerienkalender(eintraege: FerienkalenderEintrag[]): void {
  const ferien = new Map<number, Ferienzeitraum[]>();
  const feiertage = new Map<number, Feiertag[]>();
  for (const e of eintraege) {
    if (e.art === 'ferien') {
      const list = ferien.get(e.jahr) ?? [];
      list.push({ name: e.name, von: e.von, bis: e.bis });
      ferien.set(e.jahr, list);
    } else {
      const list = feiertage.get(e.jahr) ?? [];
      list.push({ name: e.name, datum: e.von, scope: e.scope ?? 'de' });
      feiertage.set(e.jahr, list);
    }
  }
  for (const list of ferien.values()) list.sort((a, b) => a.von.localeCompare(b.von));
  for (const list of feiertage.values()) list.sort((a, b) => a.datum.localeCompare(b.datum));
  gepflegteFerien = ferien;
  gepflegteFeiertage = feiertage;
}

/** true, wenn für das Jahr Ferien in Firestore gepflegt sind (Vorlage greift dann nicht mehr). */
export function hatGepflegteFerien(jahr: number): boolean {
  return gepflegteFerien.has(jahr);
}

/** true, wenn für das Jahr Feiertage in Firestore gepflegt sind. */
export function hatGepflegteFeiertage(jahr: number): boolean {
  return gepflegteFeiertage.has(jahr);
}

/** Die eingebaute Ferien-Vorlage des Jahres (ungeachtet gepflegter Daten). */
export function ferienVorlageDesJahres(jahr: number): Ferienzeitraum[] {
  return FERIEN_NDS[jahr] ?? [];
}

/** Die berechnete Feiertags-Vorlage des Jahres (ungeachtet gepflegter Daten). */
export function feiertageVorlageDesJahres(jahr: number): Feiertag[] {
  return feiertageVorlage(jahr);
}

/** Jahre, für die die App eine Ferien-Vorlage mitbringt. */
export function jahreMitFerienVorlage(): number[] {
  return Object.keys(FERIEN_NDS)
    .map(Number)
    .sort((a, b) => a - b);
}

function ferienBucket(jahr: number): Ferienzeitraum[] {
  return gepflegteFerien.get(jahr) ?? FERIEN_NDS[jahr] ?? [];
}

function feiertagBucket(jahr: number): Feiertag[] {
  return gepflegteFeiertage.get(jahr) ?? feiertageVorlage(jahr);
}

// ---------- Abfragen ------------------------------------------

/**
 * Liefert alle Ferienzeiträume, die für das gegebene Jahr gelten —
 * gepflegte Daten bevorzugt, sonst die eingebaute Vorlage.
 */
export function ferienDesjahres(jahr: number): Ferienzeitraum[] {
  return ferienBucket(jahr);
}

/**
 * Liefert die sortierten einzigartigen KW-Nummern im gegebenen ISO-Jahr,
 * die mit dem Ferienzeitraum überlappen. KWs, die in ein anderes ISO-Jahr
 * fallen (z. B. KW 53 am Jahresende → ISO-Jahr Folgejahr), werden
 * ignoriert — es zählt nur das übergebene `jahr`.
 */
export function kwsImFerienzeitraum(zeitraum: Ferienzeitraum, jahr: number): number[] {
  const kws = new Set<number>();
  const von = new Date(zeitraum.von);
  const bis = new Date(zeitraum.bis);
  const c = new Date(von);
  while (c <= bis) {
    if (getISOYear(c) === jahr) kws.add(getISOWeek(c));
    c.setDate(c.getDate() + 1);
  }
  return Array.from(kws).sort((a, b) => a - b);
}

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
    for (const f of ferienBucket(j)) {
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

/**
 * Liefert alle Feiertage, die in (jahr, kw) liegen. Beachtet ISO-KW —
 * z. B. der 1. Januar fällt manchmal in die KW 52/53 des Vorjahres.
 */
export function feiertageInKw(jahr: number, kw: number): Feiertag[] {
  const treffer: Feiertag[] = [];
  // Vor- und Folgejahr abdecken (KW über Jahresgrenze).
  for (const j of [jahr - 1, jahr, jahr + 1]) {
    for (const f of feiertagBucket(j)) {
      const d = new Date(f.datum);
      if (getISOYear(d) === jahr && getISOWeek(d) === kw) treffer.push(f);
    }
  }
  return treffer;
}
