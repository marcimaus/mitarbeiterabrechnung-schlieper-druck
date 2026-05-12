// Helper für die Reklamations-Erfassung:
//  * Match-Logik: Adresse → Teilgebiete (über die Straßenliste am TG)
//  * Match-Logik: seit-wann + TGs → Mitarbeiter (Standardausträger + Springer)
//  * Migration: Singular- in Plural-Felder beim Laden alter Reklamationen
//
// Bewusst frei von React/Firestore — reine Logik, jederzeit testbar.

import type {
  Reklamation,
  Teilgebiet,
  Mitarbeiter,
  Abrechnungsperiode,
  Einsatz,
} from '../types';
import { getISOWeek, getISOYear } from './kalender';

// ---- Normalisierung -------------------------------------------------------

/**
 * Vereinheitlicht Straßenangaben für eine unscharfe Suche:
 *  - lower-case, Umlaute aufgelöst (ß→ss, ä→ae, …)
 *  - Trenner (-,. ; ,) → Space
 *  - Hausnummern (12, 12a, 12-15) entfernen
 *  - alle Schreibvarianten von „straße" (straße/strasse/str./str) auf den
 *    Stamm reduzieren — d. h. das Suffix wird komplett entfernt. Damit
 *    bilden „Lindenstraße", „Lindenstr." und „Lindenstrasse" alle den
 *    gleichen Stamm „linden".
 *  - mehrfache Spaces zusammenziehen + trimmen
 */
export function normalisiereStrasse(s: string | undefined): string {
  if (!s) return '';
  return s
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    // Trenner zu Space
    .replace(/[-.,;]/g, ' ')
    // Hausnummern wegwerfen — die kommen aus dem getrennten
    // Hausnummer-Feld; falls sie versehentlich im Straße-Feld stehen,
    // sollen sie den Match nicht stören.
    .replace(/\d+[a-z]?/g, ' ')
    // Alle Varianten von "straße/strasse" auf das kompakte Suffix "str"
    .replace(/strasse/g, 'str')
    // "str" am Wortende vollständig entfernen → Stamm extrahieren.
    // (?=\s|$) sorgt dafür, dass z. B. „bahnstrang" nicht angefasst wird.
    .replace(/str(?=\s|$)/g, '')
    // Whitespace cleanup
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Vergleicht zwei normalisierte Straßennamen unscharf:
 *  - beide Seiten müssen mind. 3 Zeichen normalisiert haben (vermeidet
 *    falsche Treffer bei Stammen mit 1–2 Buchstaben),
 *  - Match ist bidirektional: `a` enthält `b` ODER `b` enthält `a`.
 */
export function strasseUnscharfPasst(eingabeNorm: string, tgNamen: string): boolean {
  const tgNorm = normalisiereStrasse(tgNamen);
  if (!eingabeNorm || !tgNorm) return false;
  if (eingabeNorm.length < 3 || tgNorm.length < 3) {
    return eingabeNorm === tgNorm;
  }
  return tgNorm.includes(eingabeNorm) || eingabeNorm.includes(tgNorm);
}

// ---- TG-Vorschlag ---------------------------------------------------------

export interface TgVorschlag {
  tg: Teilgebiet;
  score: number;
  grund: string;
}

/**
 * Sucht aktive Teilgebiete, die zur Adresse passen. Je genauer die
 * Eingaben, desto strenger der Filter:
 *
 *   - Straße angegeben → TG MUSS eine matchende Straße haben.
 *     PLZ-Match (falls eingegeben) wirkt nur als Sortier-Bonus.
 *   - Nur PLZ (keine Straße) → TG.plz muss matchen.
 *   - Weder Straße noch PLZ → keine Vorschläge.
 *
 * Score (für Sortierung):
 *   +10  PLZ am TG = Eingabe-PLZ
 *    +5  Straßen-Match
 *
 * `ort` wird derzeit nicht für den Score genutzt — am TG ist kein Ort
 * gespeichert; wir behalten ihn nur als Anzeige-Daten.
 */
export function findePassendeTeilgebiete(
  strasse: string,
  plz: string,
  _ort: string,
  teilgebiete: Teilgebiet[]
): TgVorschlag[] {
  const strNorm = normalisiereStrasse(strasse);
  const plzTrim = plz.trim();
  const hatStrasse = strNorm.length > 0;
  const hatPlz = plzTrim.length > 0;
  if (!hatStrasse && !hatPlz) return [];

  const out: TgVorschlag[] = [];
  for (const tg of teilgebiete) {
    if (!tg.isActive) continue;

    const plzMatch = hatPlz && tg.plz === plzTrim;
    const strasseMatch =
      hatStrasse &&
      (tg.strassen ?? []).some((s) => strasseUnscharfPasst(strNorm, s.strassenname));

    // Pflicht-Filter: je nach Eingabe-Lage muss MINDESTENS das angegebene
    // Kriterium matchen — sonst kein Vorschlag.
    if (hatStrasse) {
      // Straße ist die spezifischere Angabe: ohne Straßen-Match raus.
      if (!strasseMatch) continue;
      // Wenn der Nutzer ZUSÄTZLICH eine PLZ angegeben hat, soll sie auch
      // passen. So fallen TGs raus, in denen die gleichnamige Straße zwar
      // existiert, das TG aber in einer anderen PLZ liegt.
      if (hatPlz && !plzMatch) continue;
    } else {
      // Keine Straße, nur PLZ → TG.plz muss matchen.
      if (!plzMatch) continue;
    }

    const gruende: string[] = [];
    let score = 0;
    if (plzMatch) { score += 10; gruende.push('PLZ'); }
    if (strasseMatch) { score += 5; gruende.push('Straße'); }

    out.push({ tg, score, grund: gruende.join(' + ') });
  }
  out.sort(
    (a, b) =>
      b.score - a.score ||
      a.tg.name.localeCompare(b.tg.name, 'de', { numeric: true })
  );
  return out;
}

// ---- Mitarbeiter-Vorschlag ------------------------------------------------

export interface MaVorschlag {
  ma: Mitarbeiter;
  rollen: Array<'standard' | 'springer'>;
}

interface MaVorschlagContext {
  teilgebiete: Teilgebiet[];
  abrechnungsperioden: Abrechnungsperiode[];
  mitarbeiter: Mitarbeiter[];
  /** Einsätze aller relevanten Ausgaben — der Aufrufer beschränkt das Set. */
  einsaetze: Einsatz[];
}

/**
 * Sammelt alle Mitarbeiter, die im Zeitraum `[seitWann, heute]` einem der
 * gewählten Teilgebiete zugeordnet waren — als aktueller Standardausträger,
 * als historischer Standard (aus den Periodensnapshots) oder als Springer
 * (aus den Einsätzen). MAs werden über die mitarbeiterId dedupliziert und
 * mit dem Set ihrer aufgetretenen Rollen versehen.
 *
 * `seitWannIso` leer → es zählt nur der aktuelle Standardausträger pro TG.
 */
export function findePassendeMitarbeiter(
  seitWannIso: string,
  teilgebietIds: string[],
  ctx: MaVorschlagContext
): MaVorschlag[] {
  if (teilgebietIds.length === 0) return [];
  const tgSet = new Set(teilgebietIds);
  const heute = new Date();
  const heuteJahr = getISOYear(heute);
  const heuteKw = getISOWeek(heute);
  const seitWannDate = seitWannIso ? new Date(seitWannIso) : null;
  const seitWannJahr = seitWannDate ? getISOYear(seitWannDate) : null;
  const seitWannKw = seitWannDate ? getISOWeek(seitWannDate) : null;

  // mitarbeiterId → Set<Rolle>
  const treffer = new Map<string, Set<'standard' | 'springer'>>();
  const add = (maId: string, rolle: 'standard' | 'springer') => {
    if (!maId) return;
    const set = treffer.get(maId) ?? new Set();
    set.add(rolle);
    treffer.set(maId, set);
  };

  // (a) aktueller Standardausträger der gewählten TGs
  for (const tg of ctx.teilgebiete) {
    if (!tgSet.has(tg.id)) continue;
    if (tg.standardAustraegerId) add(tg.standardAustraegerId, 'standard');
  }

  // (b) Historische Standardausträger aus Snapshots der Perioden, deren
  //     Monat sich mit dem Zeitfenster überlappt. Bei leerem seitWann
  //     überspringen.
  if (seitWannJahr !== null && seitWannKw !== null) {
    for (const p of ctx.abrechnungsperioden) {
      // Periode auf Monatsebene vergleichen — wir wollen alle Perioden,
      // deren Ende ≥ seitWann und Anfang ≤ heute liegt.
      const periodEnde = new Date(p.jahr, p.monat, 0); // letzter Tag des Monats
      const periodStart = new Date(p.jahr, p.monat - 1, 1);
      if (seitWannDate && periodEnde.getTime() < seitWannDate.getTime()) continue;
      if (periodStart.getTime() > heute.getTime()) continue;

      // Snapshot bevorzugen — periodeSnapshot (Abschluss), sonst monatswechselSnapshot
      const teilgebietSnaps =
        p.periodeSnapshot?.teilgebietSnapshots
        ?? p.monatswechselSnapshot?.teilgebietSnapshots
        ?? [];
      for (const tgSnap of teilgebietSnaps) {
        if (!tgSet.has(tgSnap.id)) continue;
        if (tgSnap.standardAustraegerId) add(tgSnap.standardAustraegerId, 'standard');
      }
    }
  }

  // (c) Springer-Einsätze: typ === 'springer', TG passt, KW im Zeitfenster
  const istImZeitfenster = (jahr: number, kw: number): boolean => {
    if (jahr > heuteJahr) return false;
    if (jahr === heuteJahr && kw > heuteKw) return false;
    if (seitWannJahr === null || seitWannKw === null) return true;
    if (jahr < seitWannJahr) return false;
    if (jahr === seitWannJahr && kw < seitWannKw) return false;
    return true;
  };
  for (const e of ctx.einsaetze) {
    if (e.typ !== 'springer') continue;
    if (!e.mitarbeiterId) continue;
    if (!tgSet.has(e.teilgebietId)) continue;
    if (!istImZeitfenster(e.jahr, e.kw)) continue;
    add(e.mitarbeiterId, 'springer');
  }

  // → MaVorschlag-Liste, sortiert nach Name
  const out: MaVorschlag[] = [];
  for (const [maId, rollenSet] of treffer) {
    const ma = ctx.mitarbeiter.find((m) => m.id === maId);
    if (!ma) continue;
    out.push({ ma, rollen: Array.from(rollenSet).sort() });
  }
  out.sort((a, b) => a.ma.name.localeCompare(b.ma.name, 'de'));
  return out;
}

// ---- Ort → PLZ-Lookup -----------------------------------------------------

/** Normalisiert einen Ortsnamen: trim, lowercase, Umlaute aufgelöst. */
function normalisiereOrt(s: string | undefined): string {
  if (!s) return '';
  return s
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .trim();
}

/**
 * Baut eine Map (normalisierter Ort) → Set<PLZ> aus den Mitarbeiter-Adressen.
 * Wird im Reklamations-Form genutzt, um die PLZ aus dem Ort vorzuschlagen
 * (die Mitarbeiter wohnen typischerweise im Geschäftsgebiet, das ist der
 * praktischste Datenpool ohne externe PLZ-DB).
 */
export function erstelleOrtZuPlzMap(
  mitarbeiter: Mitarbeiter[]
): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const m of mitarbeiter) {
    const ort = normalisiereOrt(m.adresse?.ort);
    const plz = m.adresse?.plz?.trim();
    if (!ort || !plz || !/^\d{5}$/.test(plz)) continue;
    const set = map.get(ort) ?? new Set<string>();
    set.add(plz);
    map.set(ort, set);
  }
  return map;
}

/**
 * Findet die eindeutige PLZ für einen Ortsnamen. Liefert `null`, wenn der
 * Ort nicht bekannt ist oder mehrere PLZ darauf passen (dann darf nicht
 * automatisch befüllt werden — der Nutzer entscheidet selbst).
 */
export function findePlzFuerOrt(
  ort: string,
  map: Map<string, Set<string>>
): string | null {
  const key = normalisiereOrt(ort);
  if (!key) return null;
  const set = map.get(key);
  if (!set || set.size !== 1) return null;
  return Array.from(set)[0];
}

/**
 * Liefert die einzigartigen Orte, die im Verteilbereich vorkommen. Quelle:
 * Mitarbeiter-Adressen (deren PLZ sich auch in irgendeinem aktiven TG
 * wiederfindet) plus bereits erfasste Reklamationen. Damit erscheinen im
 * Ort-Eingabefeld nur Orte, die für den Verteilplan relevant sind, statt
 * eine offene Eingabe.
 */
export function erstelleOrteVorschlag(
  mitarbeiter: Mitarbeiter[],
  teilgebiete: Teilgebiet[],
  reklamationen: Reklamation[] = []
): string[] {
  const aktiveTgPlz = new Set(
    teilgebiete.filter((t) => t.isActive).map((t) => t.plz?.trim()).filter(Boolean)
  );
  const orte = new Set<string>();
  for (const m of mitarbeiter) {
    const o = m.adresse?.ort?.trim();
    const p = m.adresse?.plz?.trim();
    if (!o) continue;
    // Nur Orte einer PLZ, die auch im aktiven Verteilplan vorkommt.
    if (p && aktiveTgPlz.has(p)) orte.add(o);
  }
  // Plus alle in bestehenden Reklamationen erfassten Orte — damit auch
  // historisch erfasste Orte weiter angeboten werden, selbst wenn dort
  // (noch) kein MA wohnt.
  for (const r of reklamationen) {
    if (r.ort && r.ort.trim()) orte.add(r.ort.trim());
  }
  return Array.from(orte).sort((a, b) => a.localeCompare(b, 'de'));
}

// ---- Google-Maps-Link ----------------------------------------------------

/**
 * Liefert eine Google-Maps-Suche-URL für die übergebene Adresse, sobald
 * mindestens Straße ODER PLZ vorhanden ist. `null`, wenn die Eingabe zu
 * dünn ist.
 */
export function buildGoogleMapsUrl(
  strasse: string,
  hausnummer: string,
  plz: string,
  ort: string
): string | null {
  const teile = [
    [strasse, hausnummer].filter((s) => s && s.trim()).join(' ').trim(),
    [plz, ort].filter((s) => s && s.trim()).join(' ').trim(),
    'Deutschland',
  ].filter((s) => s.length > 0);
  // Mindestens eine Adress-Komponente (Straße oder PLZ) muss vorhanden sein
  // — sonst ist die URL nicht aussagekräftig.
  if (!strasse.trim() && !plz.trim()) return null;
  const q = encodeURIComponent(teile.join(', '));
  return `https://www.google.com/maps/search/?api=1&query=${q}`;
}

// ---- Form-State-Migration -------------------------------------------------

/**
 * Liest eine `Reklamation` aus Firestore und liefert die Form-Felder mit
 * Plural-Werten — alte Datensätze (mit `teilgebietId`/`mitarbeiterId`)
 * werden transparent migriert. Der Aufrufer spread'ed das Ergebnis in
 * sein lokales State-Default.
 */
export function reklamationFormState(initial: Reklamation | null): {
  anruferName: string;
  telefon: string;
  email: string;
  strasse: string;
  hausnummer: string;
  plz: string;
  ort: string;
  briefkastenVorhanden: boolean;
  aufkleberKeineWerbung: boolean;
  anmerkung: string;
  teilgebietIds: string[];
  mitarbeiterIds: string[];
  mitgeteilt: boolean;
  seitWann: string;
  schonMalMitgeteilt: boolean;
  mailLink: string;
} {
  if (!initial) {
    return {
      anruferName: '',
      telefon: '',
      email: '',
      strasse: '',
      hausnummer: '',
      plz: '',
      ort: '',
      briefkastenVorhanden: true,
      aufkleberKeineWerbung: false,
      anmerkung: '',
      teilgebietIds: [],
      mitarbeiterIds: [],
      mitgeteilt: false,
      seitWann: '',
      schonMalMitgeteilt: false,
      mailLink: '',
    };
  }
  return {
    anruferName: initial.anruferName,
    telefon: initial.telefon ?? '',
    email: initial.email ?? '',
    strasse: initial.strasse ?? '',
    hausnummer: initial.hausnummer ?? '',
    plz: initial.plz ?? '',
    ort: initial.ort ?? '',
    briefkastenVorhanden: initial.briefkastenVorhanden,
    aufkleberKeineWerbung: initial.aufkleberKeineWerbung,
    anmerkung: initial.anmerkung ?? '',
    teilgebietIds: initial.teilgebietIds ?? (initial.teilgebietId ? [initial.teilgebietId] : []),
    mitarbeiterIds: initial.mitarbeiterIds ?? (initial.mitarbeiterId ? [initial.mitarbeiterId] : []),
    mitgeteilt: initial.mitgeteilt,
    seitWann: initial.seitWann ?? '',
    schonMalMitgeteilt: initial.schonMalMitgeteilt,
    mailLink: initial.mailLink ?? '',
  };
}

/** Liefert alle TG-IDs einer Reklamation (Plural + Legacy-Singular). */
export function reklamationTgIds(r: Reklamation): string[] {
  return r.teilgebietIds ?? (r.teilgebietId ? [r.teilgebietId] : []);
}

/** Liefert alle MA-IDs einer Reklamation (Plural + Legacy-Singular). */
export function reklamationMaIds(r: Reklamation): string[] {
  return r.mitarbeiterIds ?? (r.mitarbeiterId ? [r.mitarbeiterId] : []);
}
