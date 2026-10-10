// ============================================================
// Änderungsprotokoll der Mitarbeiter-Stammdaten
// ============================================================
//
// Jede Änderung an einem Mitarbeiter wird feldweise (alt → neu) in die
// Collection `auditlog` geschrieben (Bereich `mitarbeiter-stammdaten`) —
// mit Zeitstempel und angemeldetem Benutzer. So ist nachvollziehbar, wann
// wer was bei welchem Mitarbeiter geändert hat.
//
// Alle Schreibstellen für Mitarbeiter laufen über
// `erstelleMitarbeiterMitProtokoll` / `aktualisiereMitarbeiterMitProtokoll`.
// Reine Sortier-Felder der Planungsmaske werden bewusst nicht protokolliert.
// Änderungen an der Admin-Notiz werden als `nurAdmin` markiert und nur
// Admins angezeigt.

import { aktualisiereMitarbeiter, erstelleMitarbeiter, schreibeAuditLog } from './db';
import {
  INTERESSE_TAETIGKEIT_LABELS,
  ROLLEN_LABELS,
  type Abrechnungsperiode,
  type AnmeldeHistorieEintrag,
  type AusgabenBonusAusnahme,
  type InteresseTaetigkeit,
  type Mitarbeiter,
  type Rolle,
  type Teilgebiet,
  type TeilgebietLieferadresse,
} from '../types';

/** Stammdaten, mit denen IDs im Protokoll in lesbare Namen aufgelöst werden. */
export interface MaProtokollKontext {
  mitarbeiter: Mitarbeiter[];
  teilgebiete: Teilgebiet[];
  abrechnungsperioden: Abrechnungsperiode[];
}

export interface MitarbeiterAenderung {
  feld: string;
  alt: string;
  neu: string;
  beschreibung: string;
  nurAdmin?: boolean;
}

/** Felder, die nicht protokolliert werden (technisch / reine Sortierung). */
const IGNORIERT = new Set<string>([
  'id',
  'erstelltAm',
  'aktualisiertAm',
  'sortierungZusammen',
  'sortierungUrlaub',
  // Wird nicht mehr gepflegt — Quelle sind die Sondervereinbarungen.
  'teilgebietBoni',
]);

/** Felder, die nur Admins im Protokoll sehen. */
const NUR_ADMIN = new Set<string>(['adminNotiz']);

const FELD_LABEL: Record<string, string> = {
  nummer: 'Mitarbeiternummer',
  name: 'Name',
  adresse: 'Adresse',
  telefon: 'Telefon',
  mobilnummer: 'Mobilnummer',
  email: 'E-Mail',
  nutztWhatsApp: 'WhatsApp',
  nutztTelegram: 'Telegram',
  elternName: 'Erziehungsberechtigte — Name',
  elternTelefon: 'Erziehungsberechtigte — Telefon',
  elternMobil: 'Erziehungsberechtigte — Mobil',
  elternEmail: 'Erziehungsberechtigte — E-Mail',
  elternNutztWhatsApp: 'Erziehungsberechtigte — WhatsApp',
  elternNutztTelegram: 'Erziehungsberechtigte — Telegram',
  geburtsdatum: 'Geburtsdatum',
  rollen: 'Rollen',
  nfcUid: 'NFC-UID',
  pinHash: 'PIN',
  stundenlohnIndividuell: 'Individueller Stundenlohn',
  abrechnungAlsErwachseneMiLoG: 'Abrechnung als Erwachsener (MiLoG)',
  fixesGehalt: 'Fixes Gehalt',
  fahrtkostenerstattung: 'Fahrtkostenerstattung',
  istAbholer: 'Abholer',
  onlineErfassungAktiv: 'Online-Erfassung aktiv',
  istDrucksaal: 'Drucksaal',
  zusammenAufAbruf: 'Zusammentragen auf Abruf',
  urlaubsplanungAusgeblendet: 'In Urlaubsplanung ausgeblendet',
  kuerzel: 'Kürzel',
  fahrkostenEurProKm: 'Kilometersatz (individuell)',
  hatFestgehalt: 'Festgehalt',
  festgehaltEur: 'Festgehalt (€/Monat)',
  wochenstundenFestgehalt: 'Wochenstunden',
  monatsstundenFestgehalt: 'Monatsstunden',
  istGeschaeftsfuehrer: 'Geschäftsführer',
  googleDriveLink: 'Google-Drive-Link',
  istMinijob: 'Minijob',
  sozialversicherungsNummer: 'SV-Nummer',
  steuerId: 'Steuer-ID',
  verdienstbescheinigungAnmerkung: 'Verdienstbescheinigung — Anmerkung',
  verdienstbescheinigungInternesMemo: 'Verdienstbescheinigung — internes Memo',
  arbeitsamtKontakt: 'Arbeitsamt-Ansprechpartner',
  arbeitsamtKundennummer: 'Arbeitsamt — Kundennummer',
  arbeitsamtKundennummerDrucken: 'Arbeitsamt — Kundennummer drucken',
  arbeitsamtZeichen: 'Arbeitsamt — Ihr Zeichen',
  arbeitsamtZeichenDrucken: 'Arbeitsamt — Ihr Zeichen drucken',
  verdienstbescheinigungAdresskopfMode: 'Verdienstbescheinigung — Adresskopf',
  verdienstbescheinigungAdresskopfEigene: 'Verdienstbescheinigung — eigene Adresse',
  lohngrenzeIndividuellEur: 'Individuelle Lohngrenze',
  lohngrenzeIndividuellKommentar: 'Individuelle Lohngrenze — Kommentar',
  lohngrenzeIndividuellLink: 'Individuelle Lohngrenze — Link',
  ausgabenBonusMinuten: 'Tätigkeitsbonus (Min./Ausgabe)',
  ausgabenBonusKommentar: 'Tätigkeitsbonus — Kommentar',
  ausgabenBonusAusnahmen: 'Tätigkeitsbonus entfällt',
  ausgabenBonusOhneZeitGewaehrt: 'Tätigkeitsbonus ohne Arbeitszeit gewährt',
  anmeldeHistorie: 'Frühere An-/Abmeldungen',
  sozialversicherungsBefreit: 'SV-befreit',
  isActive: 'Aktiv',
  nochNichtAngemeldet: 'Noch nicht angemeldet',
  erlaubnisElternEingeholt: 'Erlaubnis der Eltern eingeholt',
  lohnbueroBestaetigungLink: 'Lohnbüro-Bestätigungslink',
  startAbrechnungsperiodeId: 'Erste Abrechnungsperiode',
  startDatum: 'Startdatum',
  ersetztMitarbeiterId: 'Ersetzt Mitarbeiter',
  anmeldungStatus: 'Anmeldestatus',
  anmeldungUnvollstaendigMemo: 'Anmeldung — fehlende Infos',
  anmeldungUebermittlungDatum: 'Anmeldung übermittelt am',
  anmeldungMemo: 'Anmeldung — Memo',
  abgemeldet: 'Abgemeldet',
  vorlaeufigNichtAbmelden: 'Vorläufig nicht abmelden',
  abmeldungUebermittlungDatum: 'Abmeldung übermittelt am',
  letzteAbrechnungsperiodeId: 'Letzte Abrechnungsperiode',
  teilgebietFreigaben: 'Teilgebiet-Freigaben',
  abweichendeLieferadresseAktiv: 'Abweichende Lieferadresse aktiv',
  abweichendeLieferadresse: 'Abweichende Lieferadresse',
  lieferadressenJeTeilgebiet: 'Lieferadresse je Teilgebiet',
  istInteressent: 'Interessent',
  interesseWeitereTaetigkeit: 'Interesse an weiterer Tätigkeit',
  interessentDeinteressiert: 'Deinteressiert',
  interesseTaetigkeiten: 'Interesse für Tätigkeiten',
  autoVorhanden: 'Auto vorhanden',
  interessentOrte: 'Interesse für Orte',
  interessentKontaktDatum: 'Erstkontakt am',
  interessentKorrespondenzLink: 'Korrespondenz-Link',
  interessentMemo: 'Interessent — Memo',
  interessentAlterBeiErfassung: 'Alter bei Erfassung',
  istLegacy: 'Legacy-Mitarbeiter',
  adminNotiz: 'Admin-Notiz',
};

const UNTERFELD_LABEL: Record<string, string> = {
  name: 'Name',
  strasse: 'Straße',
  plz: 'PLZ',
  ort: 'Ort',
  telefon: 'Telefon',
  email: 'E-Mail',
  memo: 'Memo',
};

const EURO_FELDER = new Set<string>([
  'stundenlohnIndividuell',
  'fixesGehalt',
  'festgehaltEur',
  'fahrkostenEurProKm',
  'lohngrenzeIndividuellEur',
]);

const ANMELDESTATUS_LABEL: Record<NonNullable<Mitarbeiter['anmeldungStatus']>, string> = {
  'fragebogen-beim-ma': 'Fragebogen beim MA',
  'fragebogen-zurueck-unvollstaendig': 'Fragebogen zurück, unvollständig',
  vollstaendig: 'vollständig',
};

const ADRESSKOPF_LABEL: Record<NonNullable<Mitarbeiter['verdienstbescheinigungAdresskopfMode']>, string> = {
  arbeitsamt: 'Arbeitsamt-Ansprechpartner',
  eigene: 'eigene Adresse',
  keine: 'kein Adresskopf',
};

// ---- Formatierung ----------------------------------------------------------

function istObjekt(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function fmtDatum(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : iso;
}

function fmtSkalar(key: string, v: unknown, ktx: MaProtokollKontext): string {
  if (v === undefined || v === null) return '';
  if (typeof v === 'boolean') return v ? 'ja' : 'nein';
  if (typeof v === 'number') {
    const zahl = v.toLocaleString('de-DE', { maximumFractionDigits: 2 });
    return EURO_FELDER.has(key) ? `${zahl} €` : zahl;
  }
  const s = String(v).trim();
  if (!s) return '';
  switch (key) {
    case 'startAbrechnungsperiodeId':
    case 'letzteAbrechnungsperiodeId':
      return ktx.abrechnungsperioden.find((p) => p.id === s)?.bezeichnung ?? s;
    case 'ersetztMitarbeiterId':
      return ktx.mitarbeiter.find((m) => m.id === s)?.name ?? s;
    case 'anmeldungStatus':
      return ANMELDESTATUS_LABEL[s as keyof typeof ANMELDESTATUS_LABEL] ?? s;
    case 'verdienstbescheinigungAdresskopfMode':
      return ADRESSKOPF_LABEL[s as keyof typeof ADRESSKOPF_LABEL] ?? s;
  }
  return fmtDatum(s);
}

function fmtListe(key: string, v: unknown): string {
  const liste = Array.isArray(v) ? v.map(String) : [];
  const labels = liste.map((x) =>
    key === 'rollen'
      ? ROLLEN_LABELS[x as Rolle] ?? x
      : key === 'interesseTaetigkeiten'
        ? INTERESSE_TAETIGKEIT_LABELS[x as InteresseTaetigkeit] ?? x
        : x,
  );
  return labels.sort((a, b) => a.localeCompare(b, 'de')).join(', ');
}

function fmtLieferadresse(l: TeilgebietLieferadresse): string {
  return [
    l.strasse,
    [l.plz, l.ort].filter(Boolean).join(' '),
    l.telefon ? `Tel. ${l.telefon}` : '',
    l.memo ?? '',
  ]
    .map((x) => (x ?? '').trim())
    .filter(Boolean)
    .join(', ');
}

function eintrag(feld: string, alt: string, neu: string, nurAdmin?: boolean): MitarbeiterAenderung {
  return {
    feld,
    alt,
    neu,
    beschreibung: `${feld}: ${alt || '—'} → ${neu || '—'}`,
    ...(nurAdmin ? { nurAdmin: true } : {}),
  };
}

// ---- Diff ------------------------------------------------------------------

/**
 * Vergleicht zwei Stände eines Mitarbeiters und liefert je geändertem Feld
 * einen Eintrag (Werte bereits lesbar formatiert). Leere Werte (undefined,
 * '', false, []) gelten als gleich, damit Formular-Defaults keine
 * Scheinänderungen erzeugen.
 */
export function mitarbeiterAenderungen(
  alt: Partial<Mitarbeiter>,
  neu: Partial<Mitarbeiter>,
  ktx: MaProtokollKontext,
): MitarbeiterAenderung[] {
  const out: MitarbeiterAenderung[] = [];
  const a = alt as Record<string, unknown>;
  const n = neu as Record<string, unknown>;
  const keys = [...new Set([...Object.keys(a), ...Object.keys(n)])].filter((k) => !IGNORIERT.has(k));

  for (const key of keys) {
    const va = a[key];
    const vn = n[key];
    const label = FELD_LABEL[key] ?? key;
    const nurAdmin = NUR_ADMIN.has(key);

    // PIN: nur ob gesetzt/geändert/entfernt — nie den Hash.
    if (key === 'pinHash') {
      if ((va || '') === (vn || '')) continue;
      out.push({
        feld: label,
        alt: va ? 'gesetzt' : '',
        neu: vn ? (va ? 'neu vergeben' : 'gesetzt') : '',
        beschreibung: !vn ? 'PIN entfernt' : va ? 'PIN geändert' : 'PIN gesetzt',
      });
      continue;
    }

    // Teilgebiet-Freigaben: je hinzugefügtem/entferntem Teilgebiet ein Eintrag.
    if (key === 'teilgebietFreigaben') {
      const altSet = new Set((va as string[] | undefined) ?? []);
      const neuSet = new Set((vn as string[] | undefined) ?? []);
      const tgName = (id: string) => ktx.teilgebiete.find((t) => t.id === id)?.name ?? id;
      for (const id of neuSet) {
        if (!altSet.has(id)) {
          out.push({
            feld: 'Teilgebiet-Freigabe hinzugefügt',
            alt: '',
            neu: tgName(id),
            beschreibung: `Teilgebiet-Freigabe hinzugefügt: ${tgName(id)}`,
          });
        }
      }
      for (const id of altSet) {
        if (!neuSet.has(id)) {
          out.push({
            feld: 'Teilgebiet-Freigabe entfernt',
            alt: tgName(id),
            neu: '',
            beschreibung: `Teilgebiet-Freigabe entfernt: ${tgName(id)}`,
          });
        }
      }
      continue;
    }

    // Lieferadressen je Teilgebiet: je Teilgebiet vergleichen.
    if (key === 'lieferadressenJeTeilgebiet') {
      const altMap = new Map(((va as TeilgebietLieferadresse[] | undefined) ?? []).map((l) => [l.teilgebietId, fmtLieferadresse(l)]));
      const neuMap = new Map(((vn as TeilgebietLieferadresse[] | undefined) ?? []).map((l) => [l.teilgebietId, fmtLieferadresse(l)]));
      for (const tgId of new Set([...altMap.keys(), ...neuMap.keys()])) {
        const sa = altMap.get(tgId) ?? '';
        const sn = neuMap.get(tgId) ?? '';
        if (sa === sn) continue;
        const tg = ktx.teilgebiete.find((t) => t.id === tgId)?.name ?? tgId;
        out.push(eintrag(`${label} ${tg}`, sa, sn));
      }
      continue;
    }

    // Tätigkeitsbonus-Ausnahmen bzw. „ohne Arbeitszeit gewährt": je
    // hinzugefügter/entfernter Ausgabe ein Eintrag.
    if (key === 'ausgabenBonusAusnahmen' || key === 'ausgabenBonusOhneZeitGewaehrt') {
      const fmt = (x: AusgabenBonusAusnahme) => `KW ${x.kw}/${x.jahr}${x.grund ? ` (${x.grund})` : ''}`;
      const altMap = new Map(((va as AusgabenBonusAusnahme[] | undefined) ?? []).map((x) => [`${x.jahr}-${x.kw}`, fmt(x)]));
      const neuMap = new Map(((vn as AusgabenBonusAusnahme[] | undefined) ?? []).map((x) => [`${x.jahr}-${x.kw}`, fmt(x)]));
      for (const k of new Set([...altMap.keys(), ...neuMap.keys()])) {
        const sa = altMap.get(k) ?? '';
        const sn = neuMap.get(k) ?? '';
        if (sa !== sn) out.push(eintrag(label, sa, sn));
      }
      continue;
    }

    // Anmelde-Historie: nur neue Einträge (Anmeldeprozess neu gestartet).
    if (key === 'anmeldeHistorie') {
      const altZeiten = new Set(((va as AnmeldeHistorieEintrag[] | undefined) ?? []).map((h) => h.archiviertAm));
      for (const h of (vn as AnmeldeHistorieEintrag[] | undefined) ?? []) {
        if (altZeiten.has(h.archiviertAm)) continue;
        const teile = [
          h.anmeldungStatus ? `Erfassung: ${ANMELDESTATUS_LABEL[h.anmeldungStatus] ?? h.anmeldungStatus}` : '',
          h.startAbrechnungsperiodeId ? `erste Periode: ${fmtSkalar('startAbrechnungsperiodeId', h.startAbrechnungsperiodeId, ktx)}` : '',
          h.startDatum ? `Start: ${fmtDatum(h.startDatum)}` : '',
          h.abmeldungUebermittlungDatum ? `Abmeldung zum ${fmtDatum(h.abmeldungUebermittlungDatum)}` : '',
          h.letzteAbrechnungsperiodeId ? `letzte Periode: ${fmtSkalar('letzteAbrechnungsperiodeId', h.letzteAbrechnungsperiodeId, ktx)}` : '',
        ].filter(Boolean);
        out.push({
          feld: 'Anmeldeprozess neu gestartet — bisherige Daten historisiert',
          alt: '',
          neu: teile.join(', '),
          beschreibung: `Anmeldeprozess neu gestartet — bisherige An-/Abmeldedaten historisiert${teile.length ? ` (${teile.join(', ')})` : ''}`,
        });
      }
      continue;
    }

    if (Array.isArray(va) || Array.isArray(vn)) {
      const sa = fmtListe(key, va);
      const sn = fmtListe(key, vn);
      if (sa !== sn) out.push(eintrag(label, sa, sn, nurAdmin));
      continue;
    }

    // Verschachtelte Objekte (Adresse, Arbeitsamt-Kontakt …) je Unterfeld.
    if (istObjekt(va) || istObjekt(vn)) {
      const oa = istObjekt(va) ? va : {};
      const on = istObjekt(vn) ? vn : {};
      for (const sub of new Set([...Object.keys(oa), ...Object.keys(on)])) {
        const sa = fmtSkalar(sub, oa[sub], ktx);
        const sn = fmtSkalar(sub, on[sub], ktx);
        if (sa !== sn) out.push(eintrag(`${label} — ${UNTERFELD_LABEL[sub] ?? sub}`, sa, sn, nurAdmin));
      }
      continue;
    }

    // Booleans: fehlend = nein.
    if (typeof va === 'boolean' || typeof vn === 'boolean') {
      if (!!va === !!vn) continue;
      out.push(eintrag(label, va ? 'ja' : 'nein', vn ? 'ja' : 'nein', nurAdmin));
      continue;
    }

    const sa = fmtSkalar(key, va, ktx);
    const sn = fmtSkalar(key, vn, ktx);
    if (sa !== sn) out.push(eintrag(label, sa, sn, nurAdmin));
  }
  return out;
}

// ---- Schreiben -------------------------------------------------------------

interface ProtokollOptionen {
  adminName: string;
  ktx: MaProtokollKontext;
  /** Text, der jeder Beschreibung vorangestellt wird (z. B. „Periodenabschluss: "). */
  praefix?: string;
  /** true = halb-automatisch von der App ausgeführt (z. B. Periodenabschluss). */
  automatisch?: boolean;
}

async function schreibeEintraege(
  ma: { id: string; name: string },
  aenderungen: MitarbeiterAenderung[],
  opts: Omit<ProtokollOptionen, 'ktx'>,
): Promise<void> {
  for (const a of aenderungen) {
    await schreibeAuditLog({
      adminName: opts.adminName || 'Unbekannt',
      bereich: 'mitarbeiter-stammdaten',
      aktion: 'geaendert',
      teilgebietId: '',
      teilgebietName: '',
      mitarbeiterId: ma.id,
      mitarbeiterName: ma.name,
      feld: a.feld,
      altWert: a.alt,
      neuWert: a.neu,
      beschreibung: (opts.praefix ?? '') + a.beschreibung,
      automatisch: opts.automatisch || undefined,
      nurAdmin: a.nurAdmin || undefined,
    });
  }
}

/**
 * Mitarbeiter aktualisieren und jede Feldänderung protokollieren.
 * `undefined` in `data` löscht das Feld (wie `aktualisiereMitarbeiter`).
 */
export async function aktualisiereMitarbeiterMitProtokoll(
  alt: Mitarbeiter,
  data: Partial<Mitarbeiter>,
  opts: ProtokollOptionen,
): Promise<void> {
  await aktualisiereMitarbeiter(alt.id, data);
  const neu = { ...alt, ...data };
  const aenderungen = mitarbeiterAenderungen(alt, neu, opts.ktx);
  await schreibeEintraege({ id: alt.id, name: neu.name || alt.name }, aenderungen, opts);
}

/**
 * Neuanlage eines Mitarbeiters protokollieren (ein Eintrag „angelegt",
 * eine bereits erfasste Admin-Notiz gesondert als Admin-only-Eintrag).
 */
export async function protokolliereNeuanlage(
  ma: Pick<Mitarbeiter, 'id' | 'name'> &
    Partial<Pick<Mitarbeiter, 'nummer' | 'rollen' | 'istInteressent' | 'istLegacy' | 'adminNotiz'>>,
  opts: Pick<ProtokollOptionen, 'adminName' | 'praefix'>,
): Promise<void> {
  const art = ma.istInteressent ? 'Interessent' : ma.istLegacy ? 'Legacy-Mitarbeiter' : 'Mitarbeiter';
  await schreibeAuditLog({
    adminName: opts.adminName || 'Unbekannt',
    bereich: 'mitarbeiter-stammdaten',
    aktion: 'erstellt',
    teilgebietId: '',
    teilgebietName: '',
    mitarbeiterId: ma.id,
    mitarbeiterName: ma.name,
    beschreibung:
      (opts.praefix ?? '') +
      `${art} angelegt: ${ma.name}` +
      (ma.nummer ? ` (Nr. ${ma.nummer})` : '') +
      (ma.rollen?.length ? `, Rollen: ${fmtListe('rollen', ma.rollen)}` : ''),
  });
  if (ma.adminNotiz?.trim()) {
    await schreibeEintraege(ma, [eintrag(FELD_LABEL.adminNotiz, '', ma.adminNotiz.trim(), true)], opts);
  }
}

/** Mitarbeiter anlegen und die Neuanlage protokollieren. */
export async function erstelleMitarbeiterMitProtokoll(
  data: Omit<Mitarbeiter, 'id' | 'erstelltAm' | 'aktualisiertAm'>,
  opts: Pick<ProtokollOptionen, 'adminName' | 'praefix'>,
): Promise<string> {
  const id = await erstelleMitarbeiter(data);
  await protokolliereNeuanlage({ ...data, id }, opts);
  return id;
}
