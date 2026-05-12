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
 * Vereinheitlicht Straßenangaben so weit, dass „Hauptstr.", „Hauptstrasse"
 * und „hauptstraße" denselben Suchtext liefern. Lower-case, „str." → „strasse",
 * Umlaute aufgelöst, Mehrfach-Whitespace und Bindestriche entfernt.
 */
export function normalisiereStrasse(s: string | undefined): string {
  if (!s) return '';
  return s
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/\bstrasse\b/g, 'strasse')
    .replace(/\bstraße\b/g, 'strasse')
    .replace(/\bstr\.?\b/g, 'strasse')
    .replace(/[-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ---- TG-Vorschlag ---------------------------------------------------------

export interface TgVorschlag {
  tg: Teilgebiet;
  score: number;
  grund: string;
}

/**
 * Sucht aktive Teilgebiete, die zu einer Adresse passen. Score:
 *   +10  PLZ am TG = Eingabe-PLZ
 *    +5  irgend ein TG.strassen[].strassenname enthält die Eingabe-Straße
 *    +1  fallback, wenn nur PLZ matcht und keine Straße eingegeben wurde
 * Ergebnis ab score >= 1, absteigend sortiert. Inaktive TGs werden
 * ausgeschlossen.
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
    let score = 0;
    const gruende: string[] = [];

    const plzMatch = hatPlz && tg.plz === plzTrim;
    if (plzMatch) {
      score += 10;
      gruende.push('PLZ');
    }

    if (hatStrasse) {
      const treffer = (tg.strassen ?? []).some((s) =>
        normalisiereStrasse(s.strassenname).includes(strNorm)
      );
      if (treffer) {
        score += 5;
        gruende.push('Straße');
      }
    } else if (plzMatch) {
      // Nur PLZ eingegeben → ausreichend für eine schwache Empfehlung.
      score += 1;
    }

    if (score >= 1) {
      out.push({ tg, score, grund: gruende.join(' + ') || 'PLZ' });
    }
  }
  out.sort((a, b) => b.score - a.score || a.tg.name.localeCompare(b.tg.name, 'de', { numeric: true }));
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
