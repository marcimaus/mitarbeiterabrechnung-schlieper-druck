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
  ReklamationGrundKey,
  ReklamationZeitraum,
  AnruferMerkmalKey,
} from '../types';
import { getISOWeek, getISOYear, donnerstagDerKW } from './kalender';

/** Ein beidseitig begrenztes (Jahr, KW)-Fenster. */
export interface KwFenster {
  von: { jahr: number; kw: number };
  bis: { jahr: number; kw: number };
}

/** true, wenn (aJahr,aKw) <= (bJahr,bKw). */
function kwLeq(aJahr: number, aKw: number, bJahr: number, bKw: number): boolean {
  return aJahr < bJahr || (aJahr === bJahr && aKw <= bKw);
}

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
 *   - PLZ angegeben → TG.plz muss exakt matchen.
 *   - Ort angegeben → der Ort muss unscharf im TG-Namen vorkommen
 *     (Konvention: TGs heißen typischerweise nach dem Ort, z. B.
 *     „Volpriehausen1", „Uslar2"). Damit lassen sich Dörfer innerhalb
 *     einer PLZ-Region auseinanderhalten (37170 → Volpriehausen,
 *     Bollensen, Allershausen …).
 *   - Wenn weder Straße noch PLZ noch Ort eingegeben sind → keine
 *     Vorschläge.
 *
 * Score (für Sortierung):
 *   +10  PLZ am TG = Eingabe-PLZ
 *    +5  Straßen-Match
 *    +3  Ort matcht TG-Namen
 */
export function findePassendeTeilgebiete(
  strasse: string,
  plz: string,
  ort: string,
  teilgebiete: Teilgebiet[]
): TgVorschlag[] {
  const strNorm = normalisiereStrasse(strasse);
  const plzTrim = plz.trim();
  const ortNorm = normalisiereOrt(ort);
  const hatStrasse = strNorm.length > 0;
  const hatPlz = plzTrim.length > 0;
  const hatOrt = ortNorm.length >= 3; // <3 Zeichen → zu unspezifisch
  if (!hatStrasse && !hatPlz && !hatOrt) return [];

  const out: TgVorschlag[] = [];
  for (const tg of teilgebiete) {
    if (!tg.isActive) continue;

    const plzMatch = hatPlz && tg.plz === plzTrim;
    const strasseMatch =
      hatStrasse &&
      (tg.strassen ?? []).some((s) => strasseUnscharfPasst(strNorm, s.strassenname));
    // Ort-Match: TG-Name enthält den eingegebenen Ort (oder umgekehrt) —
    // unscharf, lower-case, Umlaute aufgelöst. Substring genügt; damit
    // matchen „Volpri" → „Volpriehausen1/2".
    const tgNameNorm = normalisiereOrt(tg.name);
    const ortMatch =
      hatOrt &&
      tgNameNorm.length >= 3 &&
      (tgNameNorm.includes(ortNorm) || ortNorm.includes(tgNameNorm));

    // Pflicht-Filter: alle angegebenen Kriterien müssen MATCHEN, sonst raus.
    if (hatStrasse && !strasseMatch) continue;
    if (hatPlz && !plzMatch) continue;
    if (hatOrt && !ortMatch) continue;

    const gruende: string[] = [];
    let score = 0;
    if (plzMatch) { score += 10; gruende.push('PLZ'); }
    if (strasseMatch) { score += 5; gruende.push('Straße'); }
    if (ortMatch) { score += 3; gruende.push('Ort'); }

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
 * Sammelt alle Mitarbeiter, die im **begrenzten** Fenster `fenster`
 * (von..bis, jeweils Jahr+KW) einem der gewählten Teilgebiete zugeordnet
 * waren — als aktueller Standardausträger (nur wenn „heute" im Fenster
 * liegt), als historischer Standard (aus den Periodensnapshots) oder als
 * Springer (aus den Einsätzen). MAs werden über die mitarbeiterId
 * dedupliziert und mit dem Set ihrer aufgetretenen Rollen versehen.
 *
 * Wichtig: Das Fenster ist IMMER beidseitig begrenzt — kein offenes Ende
 * in die Vergangenheit. So werden nur die im Zeitraum tatsächlich
 * Austragenden vorgeschlagen.
 */
export function findePassendeMitarbeiter(
  fenster: KwFenster,
  teilgebietIds: string[],
  ctx: MaVorschlagContext
): MaVorschlag[] {
  if (teilgebietIds.length === 0) return [];
  const tgSet = new Set(teilgebietIds);
  const heute = new Date();
  const heuteJahr = getISOYear(heute);
  const heuteKw = getISOWeek(heute);
  const { von, bis } = fenster;

  const istImZeitfenster = (jahr: number, kw: number): boolean =>
    kwLeq(von.jahr, von.kw, jahr, kw) && kwLeq(jahr, kw, bis.jahr, bis.kw);

  // „heute" im Fenster? (steuert, ob der aktuelle Standardausträger zählt)
  const heuteImFenster = istImZeitfenster(heuteJahr, heuteKw);

  // mitarbeiterId → Set<Rolle>
  const treffer = new Map<string, Set<'standard' | 'springer'>>();
  const add = (maId: string, rolle: 'standard' | 'springer') => {
    if (!maId) return;
    const set = treffer.get(maId) ?? new Set();
    set.add(rolle);
    treffer.set(maId, set);
  };

  // (a) aktueller Standardausträger der gewählten TGs — nur wenn „heute"
  //     ins Fenster fällt (sonst war dieser Standard im Zeitraum nicht
  //     zwingend zuständig; historische Standards kommen über (b)).
  if (heuteImFenster) {
    for (const tg of ctx.teilgebiete) {
      if (!tgSet.has(tg.id)) continue;
      if (tg.standardAustraegerId) add(tg.standardAustraegerId, 'standard');
    }
  }

  // (b) Historische Standardausträger aus Snapshots der Perioden, deren
  //     Monat sich mit dem Fenster überlappt (auf Tagesebene über den
  //     Donnerstag der jeweiligen KW bestimmt).
  const fensterStart = donnerstagDerKW(von.kw, von.jahr);
  const fensterEnde = donnerstagDerKW(bis.kw, bis.jahr);
  for (const p of ctx.abrechnungsperioden) {
    const periodEnde = new Date(p.jahr, p.monat, 0); // letzter Tag des Monats
    const periodStart = new Date(p.jahr, p.monat - 1, 1);
    if (periodEnde.getTime() < fensterStart.getTime()) continue;
    if (periodStart.getTime() > fensterEnde.getTime()) continue;

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

  // (c) Springer-Einsätze: typ === 'springer', TG passt, KW im Fenster
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

// ---- Zeitfenster aus Zeiträumen -------------------------------------------

/**
 * Berechnet das Vereinigungs-Zeitfenster (Jahr+KW) über alle erfassten
 * Zeiträume — Basis für die Austräger-/Springer-Vorauswahl.
 *
 *  - `kw`        : [von .. bis] (bis fehlt → einzelne Ausgabe = von)
 *  - `geschaetzt`: [heute − anzahl·Einheit .. heute]
 *  - `datum`     : [datum .. heute]
 *
 * Keine Zeiträume → [heute .. heute]. Das Ende wird stets auf „heute"
 * gedeckelt (zukünftige KW ergeben keine Austräger-Historie).
 */
export function zeitfensterFuerVorschlag(
  zeitraeume: ReklamationZeitraum[] | undefined,
  heuteArg?: Date
): KwFenster {
  const heute = heuteArg ?? new Date();
  const heuteJahr = getISOYear(heute);
  const heuteKw = getISOWeek(heute);
  const heutePunkt = { jahr: heuteJahr, kw: heuteKw };

  if (!zeitraeume || zeitraeume.length === 0) {
    return { von: { ...heutePunkt }, bis: { ...heutePunkt } };
  }

  // Sammle Start- und Endpunkte; Vereinigung = frühester Start .. spätestes Ende.
  const starts: Array<{ jahr: number; kw: number }> = [];
  const enden: Array<{ jahr: number; kw: number }> = [];

  for (const z of zeitraeume) {
    if (z.typ === 'kw') {
      if (z.vonJahr != null && z.vonKw != null) {
        starts.push({ jahr: z.vonJahr, kw: z.vonKw });
        if (z.bisJahr != null && z.bisKw != null) {
          enden.push({ jahr: z.bisJahr, kw: z.bisKw });
        } else {
          enden.push({ jahr: z.vonJahr, kw: z.vonKw });
        }
      }
    } else if (z.typ === 'geschaetzt') {
      const anzahl = z.anzahl && z.anzahl > 0 ? z.anzahl : 1;
      const tage = z.einheit === 'monate' ? anzahl * 30 : anzahl * 7;
      const start = new Date(heute.getTime() - tage * 24 * 60 * 60 * 1000);
      starts.push({ jahr: getISOYear(start), kw: getISOWeek(start) });
      enden.push({ ...heutePunkt });
    } else if (z.typ === 'datum' && z.datum) {
      const d = new Date(z.datum);
      if (!isNaN(d.getTime())) {
        starts.push({ jahr: getISOYear(d), kw: getISOWeek(d) });
        enden.push({ ...heutePunkt });
      }
    }
  }

  if (starts.length === 0) {
    return { von: { ...heutePunkt }, bis: { ...heutePunkt } };
  }

  // Frühester Start
  let von = starts[0];
  for (const s of starts) if (kwLeq(s.jahr, s.kw, von.jahr, von.kw)) von = s;
  // Spätestes Ende, aber max. „heute"
  let bis = enden[0];
  for (const e of enden) if (kwLeq(bis.jahr, bis.kw, e.jahr, e.kw)) bis = e;
  if (kwLeq(heutePunkt.jahr, heutePunkt.kw, bis.jahr, bis.kw)) bis = { ...heutePunkt };

  return { von: { ...von }, bis: { ...bis } };
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

export interface ReklamationFormState {
  anruferName: string;
  telefon: string;
  email: string;
  strasse: string;
  hausnummer: string;
  plz: string;
  ort: string;
  anmerkung: string;
  teilgebietIds: string[];
  mitarbeiterIds: string[];
  mitgeteilt: boolean;
  mailLink: string;
  archiviert: boolean;
  gruende: ReklamationGrundKey[];
  gruendeFreitext: string[];
  anruferMerkmale: Partial<Record<AnruferMerkmalKey, 'ja' | 'nein'>>;
  zeitraeume: ReklamationZeitraum[];
}

/**
 * Liest eine `Reklamation` aus Firestore und liefert die Form-Felder.
 * Alte Datensätze werden transparent migriert:
 *  - `teilgebietId`/`mitarbeiterId` (Singular) → Plural-Arrays
 *  - `nichtBeliefert`/`zuSpaetBeliefert` → `gruende`
 *  - `briefkastenVorhanden`/`aufkleberKeineWerbung`/`schonMalMitgeteilt`
 *    → `anruferMerkmale` (Tri-State)
 *  - `seitWann` → ein `zeitraeume`-Eintrag (typ='datum')
 */
export function reklamationFormState(initial: Reklamation | null): ReklamationFormState {
  if (!initial) {
    return {
      anruferName: '',
      telefon: '',
      email: '',
      strasse: '',
      hausnummer: '',
      plz: '',
      ort: '',
      anmerkung: '',
      teilgebietIds: [],
      mitarbeiterIds: [],
      mitgeteilt: false,
      mailLink: '',
      archiviert: false,
      gruende: [],
      gruendeFreitext: [],
      anruferMerkmale: {},
      zeitraeume: [],
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
    anmerkung: initial.anmerkung ?? '',
    teilgebietIds: initial.teilgebietIds ?? (initial.teilgebietId ? [initial.teilgebietId] : []),
    mitarbeiterIds: initial.mitarbeiterIds ?? (initial.mitarbeiterId ? [initial.mitarbeiterId] : []),
    mitgeteilt: initial.mitgeteilt,
    mailLink: initial.mailLink ?? '',
    archiviert: initial.archiviert ?? false,
    gruende: reklamationGruende(initial),
    gruendeFreitext: initial.gruendeFreitext ?? [],
    anruferMerkmale: migriereMerkmale(initial),
    zeitraeume: reklamationZeitraeume(initial),
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

/**
 * Reklamationsgründe migrations-tolerant: neue `gruende` ODER abgeleitet
 * aus den deprecateten Booleans `nichtBeliefert`/`zuSpaetBeliefert`.
 */
export function reklamationGruende(r: Reklamation): ReklamationGrundKey[] {
  if (r.gruende && r.gruende.length > 0) return r.gruende;
  const out: ReklamationGrundKey[] = [];
  if (r.nichtBeliefert) out.push('nichtBeliefert');
  if (r.zuSpaetBeliefert) out.push('zuSpaetBeliefert');
  return out;
}

/** Liefert den Tri-State-Wert eines Anrufer-Merkmals (oder undefined = nicht gefragt). */
export function reklamationMerkmal(
  r: Reklamation,
  key: AnruferMerkmalKey
): 'ja' | 'nein' | undefined {
  return migriereMerkmale(r)[key];
}

/** Zeiträume migrations-tolerant: neue `zeitraeume` ODER aus `seitWann`. */
export function reklamationZeitraeume(r: Reklamation): ReklamationZeitraum[] {
  if (r.zeitraeume && r.zeitraeume.length > 0) return r.zeitraeume;
  if (r.seitWann) return [{ typ: 'datum', datum: r.seitWann }];
  return [];
}

/** Baut die Merkmals-Map aus neuem Feld ODER den deprecateten Booleans. */
function migriereMerkmale(
  r: Reklamation
): Partial<Record<AnruferMerkmalKey, 'ja' | 'nein'>> {
  if (r.anruferMerkmale && Object.keys(r.anruferMerkmale).length > 0) {
    return r.anruferMerkmale;
  }
  const out: Partial<Record<AnruferMerkmalKey, 'ja' | 'nein'>> = {};
  if (typeof r.briefkastenVorhanden === 'boolean') {
    out.hatBriefkasten = r.briefkastenVorhanden ? 'ja' : 'nein';
  }
  if (r.aufkleberKeineWerbung) out.aufkleberKeineWerbung = 'ja';
  if (r.schonMalMitgeteilt) out.schonMalMitgeteilt = 'ja';
  return out;
}
