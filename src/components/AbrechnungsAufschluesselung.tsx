// Detaillierte, aufklappbare Aufschlüsselung einer Einzel-Abrechnung für die
// Abrechnungsvorschau. Zweck: Rückfragen von Mitarbeitern beantworten und
// Fehler in der Abrechnung finden — jede Position mit ihrem
// Berechnungsschlüssel und den zugrunde liegenden Einzeldaten (Teilgebiete je
// KW, Stempelzeiten je Tag, Fahrten, Boni, Zulagen, Lohnkonto).
//
// Die Beträge stammen ausschließlich aus dem Ergebnis von
// `berechneAbrechnung()`; die Rohdaten der Periode dienen nur dazu, den
// Rechenweg sichtbar zu machen und Auffälligkeiten zu melden.

import { Fragment, useState, type ReactNode } from 'react';
import {
  eur,
  stdMin,
  zeitLohnAufteilung,
  type AustraegerEinsatzErgebnis,
  type MitarbeiterAbrechnung,
  type PeriodeData,
} from '../lib/abrechnungslogik';
import {
  berechneAlter,
  berechneAustraegerLohn,
  berechneGewichtAnzeigenblattKg,
  berechneGewichtBeilagenKg,
  ermittleStundenlohn,
  ermittleStundenlohnZusammen,
  istMinderjährig,
} from '../lib/berechnung';
import { berechneNettoMinuten } from '../lib/zeiterfassung';
import type {
  Abrechnungsperiode,
  Arbeitszeit,
  Ausgabe,
  Beilage,
  Einsatz,
  Fahrt,
  Mitarbeiter,
  Parameter,
  Sondervereinbarung,
  Teilgebiet,
  TeilgebietSnapshot,
  Tour,
} from '../types';
import { ROLLEN_LABELS, TYP_LABELS } from '../types';

// ---- Öffentliche Typen -----------------------------------------------

/** Ausgabe eines Standard-Gebiets des MA, die ein anderer ausgetragen hat
 *  (Springer) oder die unbesetzt war — nur zur Info, nicht vergütet. */
export interface Vertretung {
  kw: number;
  jahr: number;
  teilgebietId: string;
  teilgebietName: string;
  typ: Einsatz['typ'];
  vertreterName?: string;
}

/** Alles, was neben dem Ergebnis für den Rechenweg gebraucht wird. */
export interface AufschluesselungKontext {
  periode: Abrechnungsperiode;
  data: PeriodeData;
  /** Effektive Parameter der Periode (ggf. aus Snapshot). */
  params: Parameter;
  /** Effektive Teilgebiete der Periode (ggf. Snapshot bzw. Simulation). */
  teilgebiete: (Teilgebiet | TeilgebietSnapshot)[];
  /** MA so, wie er in die Berechnung ging (ggf. ergänzte Rolle / abgeleitetes Geburtsdatum). */
  maBerechnung: Mitarbeiter;
  /** MA laut Stammdaten. */
  maStamm: Mitarbeiter;
  touren: Tour[];
  /** Eintrag des MA im gespeicherten Abschluss-Snapshot (nur abgeschlossene Perioden). */
  snapshotErgebnis: MitarbeiterAbrechnung | null;
  /** Fahrten des MA im Periodenmonat, die NICHT dieser Periode zugeordnet sind. */
  fahrtenAusserhalb: Fahrt[];
}

// ---- Formatierung ------------------------------------------------------

const zahl = (x: number, stellen = 0) =>
  x.toLocaleString('de-DE', { minimumFractionDigits: stellen, maximumFractionDigits: stellen });
const uhrzeit = (ms: number) =>
  new Date(ms).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
const tagLang = (d: Date) =>
  d.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' });
const isoDatum = (iso: string) => {
  const [y, m, d] = iso.split('-');
  return d && m && y ? `${d}.${m}.${y}` : iso;
};
const tagSchluessel = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const cent = (x: number) => Math.round(x * 100);
const gleich = (a: number, b: number) => Math.abs(cent(a) - cent(b)) <= 1;

// ---- Hilfsfunktionen ---------------------------------------------------

function lohnHerkunft(ma: Mitarbeiter, geburtsdatumAbgeleitet: boolean): string {
  if (ma.stundenlohnIndividuell !== undefined) return 'individueller Stundenlohn laut Stammdaten';
  if (!ma.geburtsdatum?.trim()) return 'kein Geburtsdatum hinterlegt → Erwachsenen-Satz';
  const alter = berechneAlter(ma.geburtsdatum);
  const quelle = geburtsdatumAbgeleitet ? ', Alter aus Interessenten-Angabe' : '';
  if (istMinderjährig(ma.geburtsdatum)) {
    return ma.abrechnungAlsErwachseneMiLoG
      ? `minderjährig (${alter} J.${quelle}), Abrechnung als Erwachsener (MiLoG)`
      : `minderjährig (${alter} J.${quelle})`;
  }
  return `erwachsen (${alter} J.${quelle})`;
}

type HinweisStufe = 'fehler' | 'warnung' | 'info';
interface Hinweis {
  stufe: HinweisStufe;
  text: ReactNode;
}

interface AustragenZeile {
  e: AustraegerEinsatzErgebnis;
  tg?: Teilgebiet | TeilgebietSnapshot;
  ausgabe?: Ausgabe;
  beilagenTg: Beilage[];
  sv?: Sondervereinbarung;
  laufzeit: number;
  steckzeit: number;
  kgAnzeigenblatt: number;
  kgBeilagen: number;
  stundenlohn: number;
  springerProzent: number;
  springerIndividuell: boolean;
  /** Gesamt nach dem Rechenweg mit den aktuell geladenen Daten. */
  nachgerechnet?: number;
}

interface BonusZeile {
  schluessel: string;
  kw: number;
  jahr: number;
  tgName: string;
  einsatz?: Einsatz;
  fehlt: string[];
  ohneAustragenVerguetung: boolean;
}

interface ZeitZeile {
  az: Arbeitszeit;
  nettoMin: number;
  abgerechnet: boolean;
  satz: number;
  grund?: string;
}

// ---- Bausteine -----------------------------------------------------------

function Abschnitt({
  titel,
  untertitel,
  betrag,
  betragHinweis,
  offen,
  onToggle,
  leer,
  children,
}: {
  titel: string;
  untertitel?: ReactNode;
  betrag?: ReactNode;
  betragHinweis?: string;
  offen: boolean;
  onToggle: () => void;
  leer?: boolean;
  children: ReactNode;
}) {
  return (
    <section className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={offen}
        className={`w-full flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-left hover:bg-gray-50 ${leer ? 'opacity-60' : ''}`}
      >
        <span className="text-gray-400 text-xs w-3">{offen ? '▼' : '▶'}</span>
        <span className="flex-1 min-w-0">
          <span className="text-sm font-medium text-gray-800">{titel}</span>
          {untertitel && <span className="ml-2 text-xs text-gray-500">{untertitel}</span>}
        </span>
        {betragHinweis && <span className="text-[11px] text-gray-400">{betragHinweis}</span>}
        {betrag !== undefined && (
          <span className="font-mono text-sm font-semibold text-gray-900">{betrag}</span>
        )}
      </button>
      {offen && <div className="border-t border-gray-200 px-4 py-3 text-xs">{children}</div>}
    </section>
  );
}

function Leer({ children }: { children: ReactNode }) {
  return <p className="text-gray-400 italic">{children}</p>;
}

function Schluessel({ children }: { children: ReactNode }) {
  return (
    <div className="mb-3 rounded-md bg-gray-50 border border-gray-200 px-3 py-2 text-gray-600">
      <span className="font-semibold text-gray-700">Berechnungsschlüssel: </span>
      {children}
    </div>
  );
}

const th = 'px-2 py-1.5 font-medium';
const td = 'px-2 py-1.5';

// ---- Hauptkomponente ----------------------------------------------------

const ALLE_ABSCHNITTE = [
  'hinweise', 'uebersicht', 'grundlagen', 'austragen', 'springer', 'sonder',
  'zusammentragen', 'vorarbeit', 'zeiten', 'boni', 'fahrten', 'festgehalt',
  'lohnkonto',
] as const;
type AbschnittId = typeof ALLE_ABSCHNITTE[number];

export default function AbrechnungsAufschluesselung({
  ergebnis: er,
  basisOhneZusatz,
  extraTgs,
  vertretungen,
  kontext,
}: {
  ergebnis: MitarbeiterAbrechnung;
  basisOhneZusatz: MitarbeiterAbrechnung | null;
  extraTgs: string[];
  vertretungen: Vertretung[];
  kontext: AufschluesselungKontext;
}) {
  const [offen, setOffen] = useState<Set<AbschnittId>>(() => new Set(['hinweise', 'uebersicht']));
  const [offeneRechenwege, setOffeneRechenwege] = useState<Set<string>>(() => new Set());
  const istOffen = (id: AbschnittId) => offen.has(id);
  const toggle = (id: AbschnittId) =>
    setOffen((prev) => {
      const neu = new Set(prev);
      if (neu.has(id)) neu.delete(id);
      else neu.add(id);
      return neu;
    });
  const toggleRechenweg = (key: string) =>
    setOffeneRechenwege((prev) => {
      const neu = new Set(prev);
      if (neu.has(key)) neu.delete(key);
      else neu.add(key);
      return neu;
    });

  const { periode, data, params, maBerechnung: ma, maStamm } = kontext;
  const hatSim = !!basisOhneZusatz;
  const delta = hatSim ? er.gesamt - (basisOhneZusatz?.gesamt ?? 0) : 0;
  const tgById = new Map(kontext.teilgebiete.map((t) => [t.id, t]));
  const ausgabeFuer = (kw: number, jahr: number) =>
    data.ausgaben.find((a) => a.kw === kw && a.jahr === jahr);
  const satzAustr = ermittleStundenlohn(ma, params);
  const satzZus = ermittleStundenlohnZusammen(ma, params);
  const geburtsdatumAbgeleitet = (ma.geburtsdatum ?? '') !== (maStamm.geburtsdatum ?? '');
  const istFixiert = periode.status !== 'abgeschlossen' && !!periode.monatswechselSnapshot;

  // ---- Austragen ----------------------------------------------------
  const austragenZeilen: AustragenZeile[] = er.austraegerEinsaetze.map((e) => {
    const tg = tgById.get(e.teilgebietId);
    const ausgabe = ausgabeFuer(e.kw, e.jahr);
    const beilagenAusgabe = ausgabe ? data.beilagen.filter((b) => b.ausgabeId === ausgabe.id) : [];
    const beilagenTg = beilagenAusgabe.filter((b) => b.teilgebietIds.includes(e.teilgebietId));
    const einsatzDoc = ausgabe
      ? data.einsaetze.find((x) => x.ausgabeId === ausgabe.id && x.teilgebietId === e.teilgebietId)
      : undefined;
    const sv = data.sondervereinbarungen.find(
      (s) => s.mitarbeiterId === ma.id && s.teilgebietId === e.teilgebietId
    );
    const d = e.detail;
    const springerIndividuell = e.typ === 'springer' && einsatzDoc?.springerZuschlagProzent != null;
    const springerProzent = e.typ !== 'springer'
      ? 0
      : d.grundlohn > 0
        ? (d.springerZuschlag / d.grundlohn) * 100
        : (einsatzDoc?.springerZuschlagProzent ?? params.springerZuschlagProzent);
    const zeile: AustragenZeile = {
      e,
      tg,
      ausgabe,
      beilagenTg,
      sv,
      laufzeit: tg ? tg.wegstreckeM / params.laufgeschwindigkeitMProH : 0,
      steckzeit: tg ? tg.stueckzahl / params.steckzeitStkProH : 0,
      kgAnzeigenblatt: 0,
      kgBeilagen: 0,
      stundenlohn: d.zeitStunden > 0 ? d.grundlohn / d.zeitStunden : satzAustr,
      springerProzent,
      springerIndividuell,
    };
    if (tg && ausgabe) {
      zeile.kgAnzeigenblatt = berechneGewichtAnzeigenblattKg(tg as Teilgebiet, ausgabe);
      zeile.kgBeilagen = berechneGewichtBeilagenKg(tg as Teilgebiet, beilagenTg);
      const einsatzFuerRechnung = {
        typ: e.typ,
        springerZuschlagProzent: e.typ === 'springer' ? einsatzDoc?.springerZuschlagProzent : undefined,
      } as Einsatz;
      zeile.nachgerechnet = berechneAustraegerLohn(
        ma, tg as Teilgebiet, ausgabe, beilagenAusgabe, einsatzFuerRechnung, sv, params
      ).gesamt;
    }
    return zeile;
  }).sort((a, b) =>
    a.e.jahr - b.e.jahr || a.e.kw - b.e.kw || a.e.teilgebietName.localeCompare(b.e.teilgebietName, 'de', { numeric: true })
  );
  const austragenKey = (e: AustraegerEinsatzErgebnis) => `${e.teilgebietId}|${e.jahr}|${e.kw}|${e.typ}`;
  type TabellenZeile =
    | { art: 'einsatz'; kw: number; jahr: number; tgName: string; z: AustragenZeile }
    | { art: 'vertretung'; kw: number; jahr: number; tgName: string; v: Vertretung };
  const austragenTabelle: TabellenZeile[] = [
    ...austragenZeilen.map((z) => ({ art: 'einsatz' as const, kw: z.e.kw, jahr: z.e.jahr, tgName: z.e.teilgebietName, z })),
    ...vertretungen.map((v) => ({ art: 'vertretung' as const, kw: v.kw, jahr: v.jahr, tgName: v.teilgebietName, v })),
  ].sort((a, b) => a.jahr - b.jahr || a.kw - b.kw || a.tgName.localeCompare(b.tgName, 'de', { numeric: true }));
  const summeAustragen = {
    zeit: austragenZeilen.reduce((s, z) => s + z.e.detail.zeitStunden, 0),
    grundlohn: austragenZeilen.reduce((s, z) => s + z.e.detail.grundlohn, 0),
    springer: austragenZeilen.reduce((s, z) => s + z.e.detail.springerZuschlag, 0),
    sonder: austragenZeilen.reduce((s, z) => s + z.e.detail.sonderbetrag, 0),
    kgAnzeigenblatt: austragenZeilen.reduce((s, z) => s + z.kgAnzeigenblatt, 0),
    kgBeilagen: austragenZeilen.reduce((s, z) => s + z.kgBeilagen, 0),
  };
  const springerZeilen = austragenZeilen.filter((z) => z.e.typ === 'springer');
  const sonderZeilen = austragenZeilen.filter((z) => z.e.detail.sonderbetrag !== 0);
  const abweichendeRechenwege = austragenZeilen.filter(
    (z) => z.nachgerechnet != null && !gleich(z.nachgerechnet, z.e.detail.gesamt)
  );
  const maSondervereinbarungen = data.sondervereinbarungen
    .filter((s) => s.mitarbeiterId === ma.id)
    .map((s) => ({
      sv: s,
      tgName: tgById.get(s.teilgebietId)?.name ?? s.teilgebietId,
      anzahl: sonderZeilen.filter((z) => z.e.teilgebietId === s.teilgebietId).length,
    }));

  // ---- Zusammentragen + Vorarbeit ----------------------------------
  const ztZeilen = er.zusammentragenEinsaetze
    .filter((z) => !z.istVorarbeit)
    .sort((a, b) => a.kw - b.kw || (a.teilgebietName ?? '').localeCompare(b.teilgebietName ?? '', 'de', { numeric: true }));
  const ztWochen = (() => {
    const map = new Map<number, typeof ztZeilen>();
    for (const z of ztZeilen) map.set(z.kw, [...(map.get(z.kw) ?? []), z]);
    return [...map.entries()].sort((a, b) => a[0] - b[0]);
  })();
  const summeZt = ztZeilen.reduce((s, z) => s + z.lohn, 0);
  const vorarbeitZt = er.zusammentragenEinsaetze
    .filter((z) => z.istVorarbeit)
    .sort((a, b) => a.kw - b.kw);
  const summeVorarbeitZt = vorarbeitZt.reduce((s, z) => s + z.lohn, 0);
  const geschw1 = params.zusammentragGeschwErste2StapelStkProH || 1700;
  const geschw2 = params.zusammentragGeschwWeitereStapelStkProH || 3400;

  const ausgabeById = new Map(data.ausgaben.map((a) => [a.id, a]));
  const maZtRoh = data.zusammentragenEinsaetze.filter((z) => z.mitarbeiterId === ma.id);
  const ztNichtVerguetet = maZtRoh
    .map((z) => {
      const ausgabe = ausgabeById.get(z.ausgabeId);
      const tgName = tgById.get(z.teilgebietId)?.name ?? z.teilgebietId;
      let grund: string | null = null;
      if (!ausgabe) grund = 'Ausgabe nicht in dieser Periode';
      else if (z.istVorarbeit && !ausgabe.vorarbeitFreigegeben) grund = `Vorarbeit in KW ${ausgabe.kw} nicht freigegeben`;
      else if (z.istVorarbeit && !(z.vorarbeitMinuten && z.vorarbeitMinuten > 0)) grund = 'Vorarbeit ohne Minuten erfasst';
      else if (!z.istVorarbeit && !tgById.has(z.teilgebietId)) grund = 'Teilgebiet nicht gefunden';
      return grund ? { z, kw: ausgabe?.kw, tgName, grund } : null;
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
  const ztOhneZeit = ztZeilen.filter((z) => (z.stunden ?? 0) === 0);
  const anzSelbsterfasst = maZtRoh.filter((z) => z.selbsterfasst).length;

  // ---- Zeiterfassung ------------------------------------------------
  const abgerechnetIds = new Set(er.arbeitszeiten.map((a) => a.id));
  const zeitZeilen: ZeitZeile[] = data.arbeitszeiten
    .filter((a) => a.mitarbeiterId === ma.id)
    .sort((a, b) => a.startTime - b.startTime)
    .map((az) => {
      const abgerechnet = abgerechnetIds.has(az.id);
      const satz = az.typ === 'vorarbeit' || az.typ === 'zusammentragen' ? satzZus : satzAustr;
      let grund: string | undefined;
      if (!abgerechnet) {
        if (az.nichtBeruecksichtigen) {
          grund = `als „nicht berücksichtigen" markiert${az.nichtBeruecksichtigenGrund ? `: ${az.nichtBeruecksichtigenGrund}` : ''}`;
        } else if (az.status !== 'abgeschlossen') grund = 'noch nicht ausgestempelt';
        else if (ma.hatFestgehalt) grund = 'Festgehalt — Zeit fließt nicht ein';
        else if (az.typ === 'austragen') grund = 'Austragen wird nach Soll-Zeit (Teilgebiet) vergütet';
        else if (az.typ === 'zusammentragen') grund = 'Zusammentragen wird nach Soll-Zeit (Stapel/Stückzahl) vergütet';
        else if (az.typ === 'vorarbeit') grund = 'Ausgabe nicht für Vorarbeit freigegeben';
        else grund = 'nicht abgerechnet';
      }
      return { az, nettoMin: berechneNettoMinuten(az), abgerechnet, satz, grund };
    });
  const zeitTage = (() => {
    const map = new Map<string, ZeitZeile[]>();
    for (const z of zeitZeilen) {
      const k = tagSchluessel(z.az.startTime);
      map.set(k, [...(map.get(k) ?? []), z]);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  })();
  const zeitMinGesamt = zeitZeilen.reduce((s, z) => s + z.nettoMin, 0);
  const zeitMinAbgerechnet = zeitZeilen.filter((z) => z.abgerechnet).reduce((s, z) => s + z.nettoMin, 0);
  const aufteilung = zeitLohnAufteilung(er);
  const zeitVorarbeitLohn = aufteilung?.vorarbeit ?? 0;
  const zeitUebrigeLohn = aufteilung ? aufteilung.uebrige : er.zeitLohn;
  const vorarbeitStempel = zeitZeilen.filter((z) => z.az.typ === 'vorarbeit');

  // ---- Boni ---------------------------------------------------------
  const bonusBetrag = params.bonusZeiterfassungEur ?? 0;
  const hatRolleAustraeger = (ma.rollen ?? []).includes('austräger');
  const bonusBasis = basisOhneZusatz ?? er;
  const bonusZeilen: BonusZeile[] = (() => {
    const zeilen: BonusZeile[] = [];
    const gesehen = new Set<string>();
    const pruefe = (doc: Einsatz | undefined) => {
      const fehlt: string[] = [];
      if (!doc || doc.mitarbeiterId !== ma.id) {
        fehlt.push('keine Selbstmeldung (QR-Code)');
        return fehlt;
      }
      if (!doc.arbeitszeit) fehlt.push('Arbeitszeit fehlt');
      if (doc.restmenge === undefined || doc.restmenge === null) fehlt.push('Restmenge fehlt');
      if (!doc.meldungEingereichtAm) fehlt.push('Meldung nicht abgeschickt');
      return fehlt;
    };
    for (const e of bonusBasis.austraegerEinsaetze) {
      const ausgabe = ausgabeFuer(e.kw, e.jahr);
      const doc = ausgabe
        ? data.einsaetze.find((x) => x.ausgabeId === ausgabe.id && x.teilgebietId === e.teilgebietId)
        : undefined;
      if (doc) gesehen.add(doc.id);
      zeilen.push({
        schluessel: `${e.teilgebietId}|${e.jahr}|${e.kw}`,
        kw: e.kw,
        jahr: e.jahr,
        tgName: e.teilgebietName,
        einsatz: doc?.mitarbeiterId === ma.id ? doc : undefined,
        fehlt: pruefe(doc),
        ohneAustragenVerguetung: false,
      });
    }
    for (const doc of data.einsaetze) {
      if (doc.mitarbeiterId !== ma.id || gesehen.has(doc.id)) continue;
      zeilen.push({
        schluessel: doc.id,
        kw: doc.kw,
        jahr: doc.jahr,
        tgName: tgById.get(doc.teilgebietId)?.name ?? doc.teilgebietId,
        einsatz: doc,
        fehlt: pruefe(doc),
        ohneAustragenVerguetung: true,
      });
    }
    return zeilen.sort((a, b) => a.jahr - b.jahr || a.kw - b.kw || a.tgName.localeCompare(b.tgName, 'de', { numeric: true }));
  })();
  const bonusOhneMeldung = bonusZeilen.filter((z) => z.fehlt.length > 0);
  const summeBoni = er.bonusZeiterfassungEur + er.ausgabenBoniLohnGesamt + er.bonus;
  const summeGewicht = er.gewichtsbonusAnzeigenblatt + er.gewichtsbonusBeilagen;

  // ---- Fahrten ------------------------------------------------------
  const tourName = (id: string) => kontext.touren.find((t) => t.id === id)?.name ?? id;
  const fahrtZiel = (f: Fahrt) =>
    f.ziel?.trim() || (f.tourIds ?? []).map(tourName).join(', ') || '—';
  const fahrtenSortiert = [...er.fahrten].sort((a, b) => a.datum.localeCompare(b.datum));
  const fahrtKmGesamt = er.fahrten.reduce((s, f) => s + f.streckKm, 0);

  // ---- Summenprüfung ------------------------------------------------
  const nachgerechnetesBrutto =
    er.austraegerGesamt +
    er.zusammentragenGesamt +
    er.zeitLohn +
    er.fixesGehalt +
    er.fahrtkostenGesamt +
    er.bonus +
    er.ausgabenBoniLohnGesamt +
    er.bonusZeiterfassungEur;

  // ---- Prüfhinweise -------------------------------------------------
  const hinweise: Hinweis[] = [];
  const snap = kontext.snapshotErgebnis;
  if (snap && !hatSim) {
    // Der gespeicherte Abschluss kann einen (übergangsweisen) externen
    // Abrechnungswert enthalten. Die Vorschau wertet ihn nicht aus — für den
    // Vergleich wird der Snapshot daher auf die reine App-Berechnung
    // zurückgerechnet.
    const snapKorrektur = snap.externerWertAktiv
      ? (snap.externerWertErsetzt ?? 0) - (snap.externerWert ?? 0)
      : 0;
    const snapBruttoLohnbuero = snap.bruttoLohnbuero + snapKorrektur;
    if (!gleich(snapBruttoLohnbuero, er.bruttoLohnbuero)) {
      hinweise.push({
        stufe: 'fehler',
        text: <>Neuberechnung weicht vom gespeicherten Periodenabschluss ab: dort ergab die App-Berechnung <b>{eur(snapBruttoLohnbuero)}</b> (Brutto Lohnbüro), die Neuberechnung ergibt <b>{eur(er.bruttoLohnbuero)}</b>. Ursache sind nachträglich geänderte Bewegungsdaten (Einsätze, Zeiten, Fahrten …).</>,
      });
    } else {
      hinweise.push({ stufe: 'info', text: <>Stimmt mit der App-Berechnung im gespeicherten Periodenabschluss überein ({eur(snapBruttoLohnbuero)} Brutto Lohnbüro).</> });
    }
  } else if (periode.status === 'abgeschlossen' && !hatSim && !maStamm.istInteressent) {
    hinweise.push({ stufe: 'warnung', text: 'Periode ist abgeschlossen, der MA ist aber nicht im gespeicherten Abschluss enthalten — er wurde in dieser Periode nicht abgerechnet.' });
  }
  if (hatSim) {
    hinweise.push({ stufe: 'info', text: `Simulation mit zusätzlichen Teilgebieten (${extraTgs.join(', ')}) — Austragen ohne Springer/Ausfälle gerechnet, alle übrigen Positionen wie tatsächlich.` });
  }
  if (maStamm.istInteressent) {
    hinweise.push({ stufe: 'info', text: 'Interessent — rein hypothetische Berechnung.' });
  } else if (!maStamm.isActive || maStamm.abgemeldet) {
    hinweise.push({ stufe: 'warnung', text: 'MA ist inaktiv/abgemeldet — die echte Abrechnung überspringt inaktive Mitarbeiter; die Vorschau rechnet ihn trotzdem.' });
  }
  if (!hatSim && !gleich(nachgerechnetesBrutto, er.gesamt)) {
    hinweise.push({ stufe: 'fehler', text: <>Summe der Einzelpositionen ({eur(nachgerechnetesBrutto)}) weicht vom Brutto ({eur(er.gesamt)}) ab.</> });
  }
  if (istFixiert) {
    hinweise.push({
      stufe: 'info',
      text: `Monatswechsel am ${new Date(periode.monatswechselSnapshot!.erstelltAm).toLocaleDateString('de-DE')} durchgeführt — Austragen und Zusammentragen sind auf dem damaligen Stand fixiert; spätere Änderungen an Einsätzen/Teilgebieten wirken nicht mehr.`,
    });
  }
  if (abweichendeRechenwege.length > 0) {
    hinweise.push({
      stufe: istFixiert ? 'info' : 'warnung',
      text: `${abweichendeRechenwege.length} Austragen-Einsatz/Einsätze ergeben mit den aktuellen Daten einen anderen Betrag als abgerechnet (siehe ⚠ im Rechenweg).`,
    });
  }
  const kwsOhneAusgabe = periode.kalenderwochen.filter(
    (kw) => !data.ausgaben.some((a) => a.kw === kw && a.jahr === periode.jahr)
  );
  if (kwsOhneAusgabe.length > 0) {
    hinweise.push({ stufe: 'warnung', text: `Für KW ${kwsOhneAusgabe.join(', ')} der Periode ist keine Ausgabe angelegt — dort wird nichts vergütet.` });
  }
  if (!ma.geburtsdatum?.trim() && ma.stundenlohnIndividuell === undefined && !ma.hatFestgehalt) {
    hinweise.push({ stufe: 'warnung', text: 'Kein Geburtsdatum hinterlegt — es wird der Erwachsenen-Stundenlohn angesetzt.' });
  }
  const offeneZeiten = zeitZeilen.filter((z) => z.az.status !== 'abgeschlossen' && !z.az.nichtBeruecksichtigen);
  if (offeneZeiten.length > 0) {
    hinweise.push({ stufe: 'warnung', text: `${offeneZeiten.length} Zeiterfassung(en) noch nicht ausgestempelt — nicht vergütet.` });
  }
  const ignorierteZeiten = zeitZeilen.filter((z) => z.az.nichtBeruecksichtigen);
  if (ignorierteZeiten.length > 0) {
    hinweise.push({ stufe: 'info', text: `${ignorierteZeiten.length} Zeiterfassung(en) als „nicht berücksichtigen" markiert.` });
  }
  const vorarbeitNichtFrei = vorarbeitStempel.filter((z) => !z.abgerechnet && z.az.status === 'abgeschlossen' && !z.az.nichtBeruecksichtigen);
  if (vorarbeitNichtFrei.length > 0 && !ma.hatFestgehalt) {
    hinweise.push({
      stufe: 'warnung',
      text: `${vorarbeitNichtFrei.length} gestempelte Vorarbeit (${stdMin(vorarbeitNichtFrei.reduce((s, z) => s + z.nettoMin, 0) / 60)}) nicht vergütet — Ausgabe nicht für Vorarbeit freigegeben.`,
    });
  }
  if (ztNichtVerguetet.length > 0) {
    hinweise.push({ stufe: 'warnung', text: `${ztNichtVerguetet.length} Zusammentragen-/Vorarbeit-Eintrag/Einträge nicht vergütet (siehe Abschnitt Zusammentragen bzw. Vorarbeit).` });
  }
  if (ztOhneZeit.length > 0) {
    hinweise.push({ stufe: 'info', text: `${ztOhneZeit.length} Zusammentragen-Einsatz/Einsätze ohne Vergütung, weil nur 1 Stapel und keine interne Beilage (nichts zusammenzutragen).` });
  }
  if (anzSelbsterfasst > 0) {
    hinweise.push({ stufe: 'info', text: `${anzSelbsterfasst} Zusammentragen-Eintrag/Einträge vom MA selbst erfasst.` });
  }
  if (bonusBetrag > 0 && hatRolleAustraeger && bonusOhneMeldung.length > 0) {
    hinweise.push({ stufe: 'info', text: `${bonusOhneMeldung.length} Austragen-Einsatz/Einsätze ohne vollständige Online-Meldung — dafür kein Bonus Zeiterfassung.` });
  }
  if (bonusBetrag > 0 && !hatRolleAustraeger && bonusZeilen.some((z) => z.fehlt.length === 0)) {
    hinweise.push({ stufe: 'warnung', text: 'Vollständige Online-Meldungen vorhanden, aber der MA hat keine Rolle „Austräger" — kein Bonus Zeiterfassung.' });
  }
  if (er.fahrten.length > 0 && !maStamm.fahrtkostenerstattung) {
    hinweise.push({ stufe: 'warnung', text: 'Fahrten werden vergütet, obwohl beim MA „Fahrtkosten-Erstattung" nicht gesetzt ist.' });
  }
  if (kontext.fahrtenAusserhalb.length > 0) {
    hinweise.push({
      stufe: 'warnung',
      text: `${kontext.fahrtenAusserhalb.length} Fahrt(en) im ${periode.bezeichnung.replace(/\s*\d{4}$/, '')} sind nicht dieser Periode zugeordnet (${kontext.fahrtenAusserhalb.reduce((s, f) => s + f.streckKm, 0)} km) — siehe Abschnitt Fahrtkosten.`,
    });
  }
  const svOhneWirkung = maSondervereinbarungen.filter((s) => s.anzahl === 0);
  if (svOhneWirkung.length > 0) {
    hinweise.push({ stufe: 'info', text: `Sondervereinbarung(en) ohne Wirkung in dieser Periode (kein Einsatz im Teilgebiet): ${svOhneWirkung.map((s) => s.tgName).join(', ')}.` });
  }
  if (er.lohnkontoBuchungenPeriode.length > 0) {
    hinweise.push({ stufe: 'info', text: `${er.lohnkontoBuchungenPeriode.length} Lohnkonto-Buchung(en) in dieser Periode — Brutto Lohnbüro weicht vom errechneten Brutto ab.` });
  }
  const hinweisFarbe: Record<HinweisStufe, string> = {
    fehler: 'bg-red-50 border-red-200 text-red-800',
    warnung: 'bg-amber-50 border-amber-200 text-amber-900',
    info: 'bg-blue-50 border-blue-100 text-blue-900',
  };
  const hinweisIcon: Record<HinweisStufe, string> = { fehler: '⛔', warnung: '⚠️', info: 'ℹ️' };
  const anzProbleme = hinweise.filter((h) => h.stufe !== 'info').length;

  // ---- Übersicht ----------------------------------------------------
  interface Position { label: string; schluessel?: ReactNode; wert: number; unter?: boolean }
  const positionen: Position[] = [];
  if (er.fixesGehalt > 0 || ma.hatFestgehalt) {
    positionen.push({ label: 'Festgehalt', schluessel: 'Monatsbetrag laut Stammdaten', wert: er.fixesGehalt });
  }
  // Austragen/Zusammentragen nur zeigen, wenn es Einsätze gibt — bei einem MA
  // ohne beides bleibt Austragen als Nullzeile stehen, damit klar ist, dass nichts anfiel.
  const zeigeAustragen = er.austraegerEinsaetze.length > 0 || ztZeilen.length === 0;
  if (!ma.hatFestgehalt) {
    if (zeigeAustragen) {
      positionen.push({ label: 'Austragen', schluessel: `${er.austraegerEinsaetze.length} Einsätze`, wert: er.austraegerGesamt });
    }
    if (er.austraegerEinsaetze.length > 0) {
      positionen.push({ label: 'Grundlohn', schluessel: `${stdMin(summeAustragen.zeit)} Soll-Zeit × Stundenlohn`, wert: summeAustragen.grundlohn, unter: true });
      if (summeAustragen.springer) positionen.push({ label: 'Springerzulage', schluessel: `${springerZeilen.length} Springer-Einsätze`, wert: summeAustragen.springer, unter: true });
      if (er.gewichtsbonusAnzeigenblatt) positionen.push({ label: 'Gewichtszulage Anzeigenblatt', schluessel: `${zahl(summeAustragen.kgAnzeigenblatt, 1)} kg × ${zahl(params.gewichtszulageAnzeigenblattEurKg, 2)} €/kg`, wert: er.gewichtsbonusAnzeigenblatt, unter: true });
      if (er.gewichtsbonusBeilagen) positionen.push({ label: 'Gewichtszulage Beilagen', schluessel: `${zahl(summeAustragen.kgBeilagen, 1)} kg × ${zahl(params.gewichtszulageBeilagenEurKg, 2)} €/kg`, wert: er.gewichtsbonusBeilagen, unter: true });
      if (summeAustragen.sonder) positionen.push({ label: 'Sondervergütung Teilgebiete', schluessel: `${sonderZeilen.length} Einsätze`, wert: summeAustragen.sonder, unter: true });
    }
    if (ztZeilen.length > 0) positionen.push({ label: 'Zusammentragen', schluessel: `${ztZeilen.length} Teilgebiete · ${stdMin(ztZeilen.reduce((s, z) => s + (z.stunden ?? 0), 0))} × ${zahl(satzZus, 2)} €/h`, wert: summeZt });
    if (vorarbeitZt.length > 0 || zeitVorarbeitLohn > 0) {
      positionen.push({ label: 'Vorarbeit', schluessel: `Minutenerfassung ${eur(summeVorarbeitZt)} + Stempeluhr ${eur(zeitVorarbeitLohn)}`, wert: summeVorarbeitZt + zeitVorarbeitLohn });
    }
    if (zeitUebrigeLohn) {
      positionen.push({ label: 'Zeitlohn (Stempeluhr, ohne Vorarbeit)', schluessel: 'Ist-Zeit × Stundenlohn', wert: zeitUebrigeLohn });
    }
  }
  if (er.ausgabenBoniLohnGesamt) positionen.push({ label: 'Min-Boni (Tätigkeitsbonus)', schluessel: `${er.ausgabenBoniMinutenGesamt} min × Stundenlohn`, wert: er.ausgabenBoniLohnGesamt });
  if (er.bonusZeiterfassungEur) positionen.push({ label: 'Bonus Zeiterfassung Austragen', schluessel: `${er.bonusZeiterfassungAnzahl} × ${eur(bonusBetrag)}`, wert: er.bonusZeiterfassungEur });
  if (er.bonus) positionen.push({ label: 'Bonus / Periodenzusatz', schluessel: er.bonusKommentar, wert: er.bonus });
  if (er.fahrtkostenGesamt) positionen.push({ label: 'Fahrtkosten', schluessel: `${zahl(fahrtKmGesamt, 1)} km × ${zahl(er.fahrtSatzEurProKm, 2)} €/km`, wert: er.fahrtkostenGesamt });

  const alleOffen = ALLE_ABSCHNITTE.every((id) => offen.has(id));

  return (
    <div className="space-y-3">
      {/* Kennzahlen-Banner */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <div className="text-xs text-gray-500">{maStamm.nummer} · {periode.bezeichnung} · Vorschau</div>
            <div className="text-lg font-semibold text-gray-900">{maStamm.name}</div>
          </div>
          <div className="flex gap-6 text-right">
            <div>
              <div className="text-xs text-gray-500">Brutto</div>
              <div className="text-lg font-semibold text-gray-800">{eur(er.gesamt)}</div>
            </div>
            <div>
              <div className="text-xs text-gray-500">Brutto Lohnbüro</div>
              <div className="text-2xl font-bold text-blue-700">{eur(er.bruttoLohnbuero)}</div>
              {hatSim && (
                <div className={`text-xs mt-0.5 ${delta > 0 ? 'text-green-700' : delta < 0 ? 'text-red-700' : 'text-gray-500'}`}>
                  {delta > 0 ? '+' : ''}{eur(delta)} durch Simulation
                </div>
              )}
            </div>
          </div>
        </div>
        {extraTgs.length > 0 && (
          <div className="mt-3 rounded-md bg-blue-50 border border-blue-200 px-3 py-2 text-xs text-blue-800">
            <strong>Simulation aktiv</strong> — zusätzliche Teilgebiete:&nbsp;{extraTgs.join(', ')}
            {hatSim && <span className="ml-2 text-blue-700/80">· ohne Simulation: {eur(basisOhneZusatz?.gesamt ?? 0)}</span>}
          </div>
        )}
      </div>

      <div className="flex justify-end gap-2 text-xs">
        <button
          type="button"
          onClick={() => setOffen(alleOffen ? new Set() : new Set(ALLE_ABSCHNITTE))}
          className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-gray-700 hover:bg-gray-50"
        >
          {alleOffen ? '▴ Alle zuklappen' : '▾ Alle aufklappen'}
        </button>
      </div>

      {/* Prüfhinweise */}
      <Abschnitt
        titel="Prüfhinweise"
        untertitel={anzProbleme > 0 ? `${anzProbleme} Auffälligkeit${anzProbleme === 1 ? '' : 'en'}` : 'keine Auffälligkeiten'}
        offen={istOffen('hinweise')}
        onToggle={() => toggle('hinweise')}
        leer={hinweise.length === 0}
      >
        {hinweise.length === 0 ? (
          <Leer>Keine Auffälligkeiten gefunden.</Leer>
        ) : (
          <ul className="space-y-1.5">
            {hinweise.map((h, i) => (
              <li key={i} className={`rounded-md border px-3 py-1.5 ${hinweisFarbe[h.stufe]}`}>
                <span className="mr-1.5">{hinweisIcon[h.stufe]}</span>{h.text}
              </li>
            ))}
          </ul>
        )}
      </Abschnitt>

      {/* Zusammenfassung */}
      <Abschnitt
        titel="Zusammenfassung"
        untertitel="alle Positionen mit Berechnungsschlüssel"
        betrag={eur(er.bruttoLohnbuero)}
        offen={istOffen('uebersicht')}
        onToggle={() => toggle('uebersicht')}
      >
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <tbody className="divide-y divide-gray-100">
              {positionen.map((p) => (
                <tr key={p.label}>
                  <td className={`${td} ${p.unter ? 'pl-6 text-gray-500' : 'font-medium text-gray-800'}`}>
                    {p.unter ? '– davon ' : ''}{p.label}
                  </td>
                  <td className={`${td} text-gray-500`}>{p.schluessel}</td>
                  <td className={`${td} text-right font-mono whitespace-nowrap ${p.unter ? 'text-gray-500' : 'font-semibold text-gray-900'}`}>
                    {eur(p.wert)}
                  </td>
                </tr>
              ))}
              <tr className="bg-gray-50 border-t-2 border-gray-300 font-semibold">
                <td className={`${td} text-gray-800`} colSpan={2}>Brutto (errechnet)</td>
                <td className={`${td} text-right font-mono text-gray-900`}>{eur(er.gesamt)}</td>
              </tr>
              {er.lohnkontoVerschiebungPeriode > 0 && (
                <tr>
                  <td className={`${td} text-gray-700`}>− Lohnkonto: Verschiebung</td>
                  <td className={`${td} text-gray-500`}>in spätere Periode geschoben</td>
                  <td className={`${td} text-right font-mono text-red-700`}>−{eur(er.lohnkontoVerschiebungPeriode)}</td>
                </tr>
              )}
              {er.lohnkontoVerrechnungPeriode > 0 && (
                <tr>
                  <td className={`${td} text-gray-700`}>+ Lohnkonto: Verrechnung</td>
                  <td className={`${td} text-gray-500`}>aus früheren Perioden ausgezahlt</td>
                  <td className={`${td} text-right font-mono text-green-700`}>+{eur(er.lohnkontoVerrechnungPeriode)}</td>
                </tr>
              )}
              <tr className="bg-blue-50 border-t-2 border-blue-200 font-semibold text-blue-900">
                <td className={`${td} py-2`} colSpan={2}>Brutto an Lohnbüro</td>
                <td className={`${td} py-2 text-right font-mono font-bold`}>{eur(er.bruttoLohnbuero)}</td>
              </tr>
              {er.vorschussSumme > 0 && (
                <tr className="text-gray-500">
                  <td className={td}>Info: Vorschüsse</td>
                  <td className={td}>bereits ausgezahlt, bei der Auszahlung verrechnet</td>
                  <td className={`${td} text-right font-mono`}>{eur(er.vorschussSumme)}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Abschnitt>

      {/* Berechnungsgrundlagen */}
      <Abschnitt
        titel="Berechnungsgrundlagen"
        untertitel="Stundenlöhne, Parameter, Periode"
        offen={istOffen('grundlagen')}
        onToggle={() => toggle('grundlagen')}
      >
        <dl className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1.5">
          {([
            ['Periode', `${periode.bezeichnung} · KW ${periode.kalenderwochen.join(', ')}`],
            ['Status', periode.status === 'abgeschlossen'
              ? `abgeschlossen${periode.gesperrtAm ? ` am ${new Date(periode.gesperrtAm).toLocaleDateString('de-DE')}` : ''} — Parameter/Teilgebiete aus Abschluss-Snapshot`
              : istFixiert ? 'offen, Monatswechsel durchgeführt — Parameter/Teilgebiete aus Monatswechsel-Snapshot' : 'offen — aktuelle Parameter/Teilgebiete'],
            ['Zeiterfassung', `Kalendermonat ${String(periode.monat).padStart(2, '0')}/${periode.jahr}`],
            ['Rollen', (maStamm.rollen ?? []).map((r) => ROLLEN_LABELS[r] ?? r).join(', ') || '—'],
            ['Stundenlohn Austragen / Sonstige', `${zahl(satzAustr, 2)} €/h — ${lohnHerkunft(ma, geburtsdatumAbgeleitet)}`],
            ['Stundenlohn Zusammentragen / Vorarbeit', `${zahl(satzZus, 2)} €/h`],
            ['Austragen abgerechnet nach', params.austragenNachIstZeit ? 'Ist-Zeit (Stempeluhr)' : 'Soll-Zeit (Teilgebiet)'],
            ['Zusammentragen abgerechnet nach', params.zusammentragenNachIstZeit ? 'Ist-Zeit (Stempeluhr)' : 'Soll-Zeit (Stapel/Stückzahl)'],
            ['Laufgeschwindigkeit', `${zahl(params.laufgeschwindigkeitMProH)} m/h`],
            ['Steckgeschwindigkeit', `${zahl(params.steckzeitStkProH)} Stk/h`],
            ['Einlegen externe Beilagen', `${zahl(params.externeBeilageEinlegeGeschwStkProH || params.steckzeitStkProH)} Stk/h je Beilage`],
            ['Zusammentragen erste 2 Stapel', `${zahl(geschw1)} Stk/h`],
            ['Zusammentragen je weiterer Stapel / int. Beilage', `${zahl(geschw2)} Stk/h`],
            ['Gewichtszulage Anzeigenblatt', `${zahl(params.gewichtszulageAnzeigenblattEurKg, 2)} €/kg`],
            ['Gewichtszulage Beilagen', `${zahl(params.gewichtszulageBeilagenEurKg, 2)} €/kg`],
            ['Springerzulage (Standard)', `${zahl(params.springerZuschlagProzent)} % auf den Grundlohn`],
            ['Bonus Zeiterfassung Austragen', bonusBetrag > 0 ? `${eur(bonusBetrag)} je vollständig online gemeldetem Einsatz` : 'nicht aktiv'],
            ['Min-Bonus (Stammdaten)', ma.ausgabenBonusMinuten ? `${ma.ausgabenBonusMinuten} min je Ausgabe${ma.ausgabenBonusKommentar ? ` — ${ma.ausgabenBonusKommentar}` : ''}` : '—'],
            ['Fahrtkosten', `${zahl(er.fahrtSatzEurProKm, 2)} €/km — ${ma.fahrkostenEurProKm != null ? 'individueller Satz' : 'Parameter'}${maStamm.fahrtkostenerstattung ? '' : ' (Erstattung beim MA nicht aktiviert)'}`],
          ] as const).map(([k, v]) => (
            <div key={k} className="flex flex-col sm:flex-row sm:gap-2 border-b border-gray-100 pb-1">
              <dt className="text-gray-500 sm:w-56 shrink-0">{k}</dt>
              <dd className="text-gray-800">{v}</dd>
            </div>
          ))}
        </dl>
      </Abschnitt>

      {/* Austragen */}
      {!ma.hatFestgehalt && (
        <Abschnitt
          titel="Austragen je Teilgebiet und KW"
          untertitel={`${er.austraegerEinsaetze.length} Einsätze${springerZeilen.length ? ` · ${springerZeilen.length} als Springer` : ''}${vertretungen.length ? ` · ${vertretungen.length} vertreten` : ''}`}
          betrag={eur(er.austraegerGesamt)}
          offen={istOffen('austragen')}
          onToggle={() => toggle('austragen')}
          leer={austragenTabelle.length === 0}
        >
          <Schluessel>
            Soll-Zeit = Wegstrecke ÷ Laufgeschwindigkeit + Stückzahl ÷ Steckgeschwindigkeit
            (+ Stückzahl × ext. Beilagen ÷ Einlegegeschwindigkeit). Grundlohn = Soll-Zeit ×
            Stundenlohn; dazu Springerzulage, Gewichtszulagen und Sondervergütung.
            Zeile anklicken für den Rechenweg.
          </Schluessel>
          {params.austragenNachIstZeit && (
            <p className="mb-2 text-amber-700">Austragen wird nach Ist-Zeit abgerechnet — die Vergütung steht im Abschnitt Zeiterfassung.</p>
          )}
          {austragenTabelle.length === 0 ? (
            <Leer>Keine Austragen-Einsätze in dieser Periode.</Leer>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 text-gray-600">
                  <tr>
                    <th className={`${th} text-left`}>KW</th>
                    <th className={`${th} text-left`}>Teilgebiet</th>
                    <th className={`${th} text-left`}>Art</th>
                    <th className={`${th} text-right`}>Stück</th>
                    <th className={`${th} text-right`}>Weg</th>
                    <th className={`${th} text-right`} title="Anzahl externer Beilagen">ext. B.</th>
                    <th className={`${th} text-right`}>Soll-Zeit</th>
                    <th className={`${th} text-right`}>Grundlohn</th>
                    <th className={`${th} text-right`}>Springer</th>
                    <th className={`${th} text-right`}>Gewicht</th>
                    <th className={`${th} text-right`}>Sonder</th>
                    <th className={`${th} text-right`}>Gesamt</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {austragenTabelle.map((zeile) => {
                    if (zeile.art === 'vertretung') {
                      const v = zeile.v;
                      return (
                        <tr key={`v-${v.teilgebietId}-${v.jahr}-${v.kw}`} className="bg-gray-50/60 text-gray-400">
                          <td className={`${td} font-mono`}>{v.kw}</td>
                          <td className={`${td} line-through`}>{v.teilgebietName}</td>
                          <td className={td} colSpan={9}>
                            {v.typ === 'springer'
                              ? <span className="text-amber-700">vertreten durch {v.vertreterName ?? 'Springer'} — nicht vergütet</span>
                              : <span className="text-red-600">{v.typ === 'ungeklärt' ? 'unbesetzt' : 'Ausfall'} — nicht vergütet</span>}
                          </td>
                          <td className={`${td} text-right font-mono`}>—</td>
                        </tr>
                      );
                    }
                    const z = zeile.z;
                    const d = z.e.detail;
                    const key = austragenKey(z.e);
                    const rwOffen = offeneRechenwege.has(key);
                    const abweichend = z.nachgerechnet != null && !gleich(z.nachgerechnet, d.gesamt);
                    return (
                      <Fragment key={key}>
                        <tr
                          onClick={() => toggleRechenweg(key)}
                          className={`cursor-pointer ${rwOffen ? 'bg-blue-50/50' : 'hover:bg-gray-50'}`}
                        >
                          <td className={`${td} font-mono`}>
                            <span className="text-gray-400 mr-1">{rwOffen ? '▾' : '▸'}</span>{z.e.kw}
                          </td>
                          <td className={td}>
                            {z.e.teilgebietName}
                            {abweichend && <span className="ml-1 text-amber-600" title="Rechenweg mit aktuellen Daten weicht ab">⚠</span>}
                          </td>
                          <td className={td}>
                            {z.e.typ === 'springer'
                              ? <span className="inline-block rounded bg-amber-100 text-amber-800 px-1.5 py-0.5">Springer</span>
                              : <span className="text-gray-500">Standard</span>}
                          </td>
                          <td className={`${td} text-right font-mono`}>{z.tg ? zahl(z.tg.stueckzahl) : '—'}</td>
                          <td className={`${td} text-right font-mono`}>{z.tg ? `${zahl(z.tg.wegstreckeM)} m` : '—'}</td>
                          <td className={`${td} text-right font-mono`}>{d.anzahlExtBeilagen || '—'}</td>
                          <td className={`${td} text-right font-mono`}>{stdMin(d.zeitStunden)}</td>
                          <td className={`${td} text-right font-mono`}>{eur(d.grundlohn)}</td>
                          <td className={`${td} text-right font-mono`}>{d.springerZuschlag ? eur(d.springerZuschlag) : '—'}</td>
                          <td className={`${td} text-right font-mono`}>{eur(d.gewichtsbonusAnzeigenblatt + d.gewichtsbonusBeilagen)}</td>
                          <td className={`${td} text-right font-mono`}>{d.sonderbetrag ? eur(d.sonderbetrag) : '—'}</td>
                          <td className={`${td} text-right font-mono font-semibold`}>{eur(d.gesamt)}</td>
                        </tr>
                        {rwOffen && (
                          <tr className="bg-blue-50/30">
                            <td />
                            <td colSpan={11} className="px-2 pb-3 pt-1">
                              <RechenwegAustragen z={z} params={params} />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                  <tr className="bg-blue-50 border-t-2 border-blue-200 font-semibold text-blue-900">
                    <td className={td} colSpan={6}>Summe Austragen</td>
                    <td className={`${td} text-right font-mono`}>{stdMin(summeAustragen.zeit)}</td>
                    <td className={`${td} text-right font-mono`}>{eur(summeAustragen.grundlohn)}</td>
                    <td className={`${td} text-right font-mono`}>{summeAustragen.springer ? eur(summeAustragen.springer) : '—'}</td>
                    <td className={`${td} text-right font-mono`}>{eur(summeGewicht)}</td>
                    <td className={`${td} text-right font-mono`}>{summeAustragen.sonder ? eur(summeAustragen.sonder) : '—'}</td>
                    <td className={`${td} text-right font-mono`}>{eur(er.austraegerGesamt)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </Abschnitt>
      )}

      {/* Springerzulage */}
      {!ma.hatFestgehalt && (
        <Abschnitt
          titel="Springerzulage"
          untertitel={`${springerZeilen.length} Springer-Einsätze`}
          betrag={summeAustragen.springer ? eur(summeAustragen.springer) : '—'}
          betragHinweis="in Austragen enthalten"
          offen={istOffen('springer')}
          onToggle={() => toggle('springer')}
          leer={springerZeilen.length === 0}
        >
          <Schluessel>
            Springerzulage = Grundlohn × Zuschlag-% (Standard {zahl(params.springerZuschlagProzent)} %, je Einsatz
            in der Planung individuell änderbar). Die Zulage gilt nur auf den Grundlohn, nicht auf Gewichtszulagen.
          </Schluessel>
          {springerZeilen.length === 0 ? (
            <Leer>Keine Springer-Einsätze in dieser Periode.</Leer>
          ) : (
            <table className="w-full text-xs">
              <thead className="bg-gray-50 text-gray-600">
                <tr>
                  <th className={`${th} text-left`}>KW</th>
                  <th className={`${th} text-left`}>Teilgebiet</th>
                  <th className={`${th} text-right`}>Grundlohn</th>
                  <th className={`${th} text-right`}>Zuschlag</th>
                  <th className={`${th} text-right`}>Springerzulage</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {springerZeilen.map((z) => (
                  <tr key={austragenKey(z.e)}>
                    <td className={`${td} font-mono`}>{z.e.kw}</td>
                    <td className={td}>{z.e.teilgebietName}</td>
                    <td className={`${td} text-right font-mono`}>{eur(z.e.detail.grundlohn)}</td>
                    <td className={`${td} text-right font-mono`}>
                      {zahl(z.springerProzent, z.springerProzent % 1 ? 1 : 0)} %
                      {z.springerIndividuell && <span className="ml-1 text-[10px] text-amber-700">individuell</span>}
                    </td>
                    <td className={`${td} text-right font-mono font-semibold`}>{eur(z.e.detail.springerZuschlag)}</td>
                  </tr>
                ))}
                <tr className="bg-blue-50 border-t-2 border-blue-200 font-semibold text-blue-900">
                  <td className={td} colSpan={4}>Summe Springerzulage</td>
                  <td className={`${td} text-right font-mono`}>{eur(summeAustragen.springer)}</td>
                </tr>
              </tbody>
            </table>
          )}
        </Abschnitt>
      )}

      {/* Sondervergütung je Teilgebiet */}
      {!ma.hatFestgehalt && (
        <Abschnitt
          titel="Sondervergütung je Teilgebiet"
          untertitel={maSondervereinbarungen.length ? `${maSondervereinbarungen.length} Sondervereinbarung(en)` : 'keine Sondervereinbarung'}
          betrag={summeAustragen.sonder ? eur(summeAustragen.sonder) : '—'}
          betragHinweis="in Austragen enthalten"
          offen={istOffen('sonder')}
          onToggle={() => toggle('sonder')}
          leer={maSondervereinbarungen.length === 0}
        >
          <Schluessel>
            Fester Betrag je Einsatz (= je KW) im Teilgebiet laut Sondervereinbarung des MA —
            gilt für Standard- und Springer-Einsätze.
          </Schluessel>
          {maSondervereinbarungen.length === 0 ? (
            <Leer>Für diesen MA ist keine Sondervereinbarung hinterlegt.</Leer>
          ) : (
            <>
              <table className="w-full text-xs mb-3">
                <thead className="bg-gray-50 text-gray-600">
                  <tr>
                    <th className={`${th} text-left`}>Teilgebiet</th>
                    <th className={`${th} text-left`}>Begründung</th>
                    <th className={`${th} text-right`}>je KW</th>
                    <th className={`${th} text-right`}>KWs</th>
                    <th className={`${th} text-right`}>Summe</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {maSondervereinbarungen.map(({ sv, tgName, anzahl }) => (
                    <tr key={sv.id} className={anzahl === 0 ? 'text-gray-400' : ''}>
                      <td className={td}>{tgName}</td>
                      <td className={td}>{sv.begruendung || '—'}</td>
                      <td className={`${td} text-right font-mono`}>{eur(sv.betragEur)}</td>
                      <td className={`${td} text-right font-mono`}>{anzahl}</td>
                      <td className={`${td} text-right font-mono font-semibold`}>{anzahl ? eur(sv.betragEur * anzahl) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {sonderZeilen.length > 0 && (
                <table className="w-full text-xs">
                  <thead className="bg-gray-50 text-gray-600">
                    <tr>
                      <th className={`${th} text-left`}>KW</th>
                      <th className={`${th} text-left`}>Teilgebiet</th>
                      <th className={`${th} text-left`}>Art</th>
                      <th className={`${th} text-right`}>Sondervergütung</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {sonderZeilen.map((z) => (
                      <tr key={austragenKey(z.e)}>
                        <td className={`${td} font-mono`}>{z.e.kw}</td>
                        <td className={td}>{z.e.teilgebietName}</td>
                        <td className={td}>{z.e.typ === 'springer' ? 'Springer' : 'Standard'}</td>
                        <td className={`${td} text-right font-mono font-semibold`}>{eur(z.e.detail.sonderbetrag)}</td>
                      </tr>
                    ))}
                    <tr className="bg-blue-50 border-t-2 border-blue-200 font-semibold text-blue-900">
                      <td className={td} colSpan={3}>Summe Sondervergütung</td>
                      <td className={`${td} text-right font-mono`}>{eur(summeAustragen.sonder)}</td>
                    </tr>
                  </tbody>
                </table>
              )}
            </>
          )}
        </Abschnitt>
      )}

      {/* Zusammentragen */}
      {!ma.hatFestgehalt && (
        <Abschnitt
          titel="Zusammentragen je KW"
          untertitel={`${ztZeilen.length} Teilgebiete in ${ztWochen.length} ${ztWochen.length === 1 ? 'Woche' : 'Wochen'}`}
          betrag={eur(summeZt)}
          offen={istOffen('zusammentragen')}
          onToggle={() => toggle('zusammentragen')}
          leer={ztZeilen.length === 0 && ztNichtVerguetet.every((x) => x.z.istVorarbeit)}
        >
          <Schluessel>
            Zeit = Stückzahl ÷ {zahl(geschw1)} Stk/h (erste 2 Stapel) + Stückzahl × (weitere Stapel + interne
            Beilagen) ÷ {zahl(geschw2)} Stk/h; bei nur 1 Stapel ohne interne Beilage keine Zeit.
            Lohn = Zeit × {zahl(satzZus, 2)} €/h. Externe Beilagen legt der Austräger ein (nur Info).
          </Schluessel>
          {params.zusammentragenNachIstZeit && (
            <p className="mb-2 text-amber-700">Zusammentragen wird nach Ist-Zeit abgerechnet — die Vergütung steht im Abschnitt Zeiterfassung.</p>
          )}
          {ztZeilen.length === 0 ? (
            <Leer>Keine vergüteten Zusammentragen-Einsätze in dieser Periode.</Leer>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 text-gray-600">
                  <tr>
                    <th className={`${th} text-left`}>Teilgebiet</th>
                    <th className={`${th} text-right`}>Stück</th>
                    <th className={`${th} text-right`}>Stapel</th>
                    <th className={`${th} text-right`}>int. B.</th>
                    <th className={`${th} text-right`}>ext. B.</th>
                    <th className={`${th} text-left`}>Rechenweg</th>
                    <th className={`${th} text-right`}>Zeit</th>
                    <th className={`${th} text-right`}>Lohn</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {ztWochen.map(([kw, liste]) => (
                    <Fragment key={kw}>
                      <tr className="bg-gray-100/70">
                        <td className={`${td} font-semibold text-gray-700`} colSpan={6}>
                          KW {kw} · {liste.length} Teilgebiet{liste.length === 1 ? '' : 'e'}
                          {ausgabeFuer(kw, periode.jahr) && (
                            <span className="ml-2 font-normal text-gray-500">
                              ({ausgabeFuer(kw, periode.jahr)!.seitenzahl} Seiten, {ausgabeFuer(kw, periode.jahr)!.stapelAnzahl || 0} Stapel)
                            </span>
                          )}
                        </td>
                        <td className={`${td} text-right font-mono font-semibold text-gray-700`}>{stdMin(liste.reduce((s, z) => s + (z.stunden ?? 0), 0))}</td>
                        <td className={`${td} text-right font-mono font-semibold text-gray-700`}>{eur(liste.reduce((s, z) => s + z.lohn, 0))}</td>
                      </tr>
                      {liste.map((z, i) => {
                        const st = z.stueckzahl ?? 0;
                        const weitere = Math.max(0, z.stapelBearbeitet - 2);
                        const intB = z.intBeilagenAnzahl ?? 0;
                        const stunden = z.stunden ?? 0;
                        return (
                          <tr key={`${kw}-${z.teilgebietId}-${i}`} className={stunden === 0 ? 'text-gray-400' : ''}>
                            <td className={`${td} pl-5`}>{z.teilgebietName ?? '—'}</td>
                            <td className={`${td} text-right font-mono`}>{zahl(st)}</td>
                            <td className={`${td} text-right font-mono`}>{z.stapelBearbeitet}</td>
                            <td className={`${td} text-right font-mono`}>{intB}</td>
                            <td className={`${td} text-right font-mono`}>{z.extBeilagenAnzahl ?? 0}</td>
                            <td className={`${td} text-gray-500 whitespace-nowrap`}>
                              {stunden === 0
                                ? '1 Stapel, keine int. Beilage → 0'
                                : `${zahl(st)} ÷ ${zahl(geschw1)}${weitere + intB > 0 ? ` + ${zahl(st)} × ${weitere + intB} ÷ ${zahl(geschw2)}` : ''} → × ${zahl(stunden > 0 ? z.lohn / stunden : satzZus, 2)} €/h`}
                            </td>
                            <td className={`${td} text-right font-mono`}>{stdMin(stunden)}</td>
                            <td className={`${td} text-right font-mono font-semibold`}>{eur(z.lohn)}</td>
                          </tr>
                        );
                      })}
                    </Fragment>
                  ))}
                  <tr className="bg-blue-50 border-t-2 border-blue-200 font-semibold text-blue-900">
                    <td className={td} colSpan={6}>Summe Zusammentragen (ohne Vorarbeit)</td>
                    <td className={`${td} text-right font-mono`}>{stdMin(ztZeilen.reduce((s, z) => s + (z.stunden ?? 0), 0))}</td>
                    <td className={`${td} text-right font-mono`}>{eur(summeZt)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
          {ztNichtVerguetet.some((x) => !x.z.istVorarbeit) && (
            <div className="mt-3">
              <div className="font-semibold text-amber-800 mb-1">Nicht vergütet</div>
              <ul className="list-disc list-inside text-amber-800">
                {ztNichtVerguetet.filter((x) => !x.z.istVorarbeit).map((x) => (
                  <li key={x.z.id}>{x.kw != null ? `KW ${x.kw} · ` : ''}{x.tgName}: {x.grund}</li>
                ))}
              </ul>
            </div>
          )}
        </Abschnitt>
      )}

      {/* Vorarbeit */}
      {!ma.hatFestgehalt && (
        <Abschnitt
          titel="Vorarbeit"
          untertitel={`${vorarbeitZt.length} Minuten-Einträge · ${vorarbeitStempel.length} Stempelzeiten`}
          betrag={eur(summeVorarbeitZt + zeitVorarbeitLohn)}
          offen={istOffen('vorarbeit')}
          onToggle={() => toggle('vorarbeit')}
          leer={vorarbeitZt.length === 0 && vorarbeitStempel.length === 0 && !ztNichtVerguetet.some((x) => x.z.istVorarbeit)}
        >
          <Schluessel>
            Vorarbeit wird nur vergütet, wenn die Ausgabe der KW für Vorarbeit freigegeben ist.
            Lohn = Minuten ÷ 60 × {zahl(satzZus, 2)} €/h (Zusammentragen-Satz). Minuten-Einträge beim
            Zusammentragen zählen zur Position Zusammentragen, gestempelte Vorarbeit zum Zeitlohn.
          </Schluessel>
          <h5 className="font-semibold text-gray-700 mb-1">Beim Zusammentragen erfasste Vorarbeit</h5>
          {vorarbeitZt.length === 0 && !ztNichtVerguetet.some((x) => x.z.istVorarbeit) ? (
            <Leer>keine</Leer>
          ) : (
            <table className="w-full text-xs mb-3">
              <thead className="bg-gray-50 text-gray-600">
                <tr>
                  <th className={`${th} text-left`}>KW</th>
                  <th className={`${th} text-left`}>Teilgebiet</th>
                  <th className={`${th} text-right`}>Minuten</th>
                  <th className={`${th} text-left`}>Status</th>
                  <th className={`${th} text-right`}>Lohn</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {vorarbeitZt.map((z, i) => (
                  <tr key={`va-${i}`}>
                    <td className={`${td} font-mono`}>{z.kw}</td>
                    <td className={td}>{z.teilgebietName ?? '—'}</td>
                    <td className={`${td} text-right font-mono`}>{zahl((z.stunden ?? 0) * 60)}</td>
                    <td className={`${td} text-green-700`}>freigegeben</td>
                    <td className={`${td} text-right font-mono font-semibold`}>{eur(z.lohn)}</td>
                  </tr>
                ))}
                {ztNichtVerguetet.filter((x) => x.z.istVorarbeit).map((x) => (
                  <tr key={x.z.id} className="text-gray-400">
                    <td className={`${td} font-mono`}>{x.kw ?? '—'}</td>
                    <td className={td}>{x.tgName}</td>
                    <td className={`${td} text-right font-mono`}>{x.z.vorarbeitMinuten ?? 0}</td>
                    <td className={`${td} text-amber-700`}>{x.grund}</td>
                    <td className={`${td} text-right font-mono`}>—</td>
                  </tr>
                ))}
                <tr className="bg-gray-50 font-semibold">
                  <td className={td} colSpan={4}>Summe (in Zusammentragen enthalten)</td>
                  <td className={`${td} text-right font-mono`}>{eur(summeVorarbeitZt)}</td>
                </tr>
              </tbody>
            </table>
          )}
          <h5 className="font-semibold text-gray-700 mb-1 mt-2">Gestempelte Vorarbeit</h5>
          {vorarbeitStempel.length === 0 ? (
            <Leer>keine</Leer>
          ) : (
            <ZeitTabelle zeilen={vorarbeitStempel} summeLohn={zeitVorarbeitLohn} summeLabel="Summe (im Zeitlohn enthalten)" />
          )}
        </Abschnitt>
      )}

      {/* Anwesenheit & Zeiterfassung */}
      <Abschnitt
        titel="Anwesenheit & Zeiterfassung"
        untertitel={`${zeitTage.length} Tag${zeitTage.length === 1 ? '' : 'e'} · ${stdMin(zeitMinGesamt / 60)} erfasst · ${stdMin(zeitMinAbgerechnet / 60)} abgerechnet`}
        betrag={eur(er.zeitLohn)}
        offen={istOffen('zeiten')}
        onToggle={() => toggle('zeiten')}
        leer={zeitZeilen.length === 0}
      >
        <Schluessel>
          Netto-Zeit = Ende − Beginn − Pausen. Vergütet werden „Sonstige" (immer), Vorarbeit (bei
          Freigabe) sowie Austragen/Zusammentragen nur bei Ist-Zeit-Abrechnung. Satz: Vorarbeit und
          Zusammentragen {zahl(satzZus, 2)} €/h, sonst {zahl(satzAustr, 2)} €/h. Grundlage sind alle
          Stempelzeiten im Kalendermonat {String(periode.monat).padStart(2, '0')}/{periode.jahr}.
        </Schluessel>
        {zeitZeilen.length === 0 ? (
          <Leer>Keine Zeiterfassung in diesem Monat.</Leer>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 text-gray-600">
                  <tr>
                    <th className={`${th} text-left`}>Tag</th>
                    <th className={`${th} text-left`}>Tätigkeit</th>
                    <th className={`${th} text-left`}>Von – Bis</th>
                    <th className={`${th} text-right`}>Pause</th>
                    <th className={`${th} text-right`}>Netto</th>
                    <th className={`${th} text-left`}>Abrechnung</th>
                    <th className={`${th} text-right`}>Lohn</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {zeitTage.map(([tag, liste]) => (
                    <Fragment key={tag}>
                      {liste.map((z, i) => (
                        <ZeitZeileTr key={z.az.id} z={z} tagAnzeigen={i === 0} anzTagesZeilen={liste.length} />
                      ))}
                    </Fragment>
                  ))}
                  <tr className="bg-blue-50 border-t-2 border-blue-200 font-semibold text-blue-900">
                    <td className={td} colSpan={4}>Summe ({zeitTage.length} Tage)</td>
                    <td className={`${td} text-right font-mono`}>{stdMin(zeitMinGesamt / 60)}</td>
                    <td className={td}>davon abgerechnet {stdMin(zeitMinAbgerechnet / 60)}</td>
                    <td className={`${td} text-right font-mono`}>{eur(er.zeitLohn)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            {aufteilung && aufteilung.vorarbeit > 0 && (
              <p className="mt-2 text-gray-500">
                Zeitlohn aufgeteilt: Vorarbeit {eur(aufteilung.vorarbeit)} · übrige Zeit {eur(aufteilung.uebrige)}
              </p>
            )}
          </>
        )}
      </Abschnitt>

      {/* Boni */}
      <Abschnitt
        titel="Boni"
        untertitel="Zeiterfassungs-Bonus, Min-Boni, Periodenzusatz, Gewichtszulagen"
        betrag={eur(summeBoni)}
        betragHinweis={summeGewicht ? `+ ${eur(summeGewicht)} Gewichtszulagen in Austragen` : undefined}
        offen={istOffen('boni')}
        onToggle={() => toggle('boni')}
        leer={summeBoni === 0 && summeGewicht === 0 && bonusZeilen.length === 0}
      >
        <div className="space-y-4">
          <div>
            <h5 className="font-semibold text-gray-700 mb-1">
              Bonus Zeiterfassung Austragen — {er.bonusZeiterfassungAnzahl} × {eur(bonusBetrag)} = {eur(er.bonusZeiterfassungEur)}
            </h5>
            <p className="text-gray-500 mb-1.5">
              Je Einsatz, für den der MA per QR-Code Arbeitszeit und Restmenge gemeldet und die Meldung abgeschickt hat.
              Nur für MA mit Rolle „Austräger"{hatRolleAustraeger ? '' : ' — diese Rolle fehlt beim MA'}.
            </p>
            {bonusBetrag <= 0 ? (
              <Leer>Bonus ist in den Parametern nicht aktiv.</Leer>
            ) : bonusZeilen.length === 0 ? (
              <Leer>Keine Austragen-Einsätze.</Leer>
            ) : (
              <table className="w-full text-xs">
                <thead className="bg-gray-50 text-gray-600">
                  <tr>
                    <th className={`${th} text-left`}>KW</th>
                    <th className={`${th} text-left`}>Teilgebiet</th>
                    <th className={`${th} text-left`}>Meldung</th>
                    <th className={`${th} text-right`}>Bonus</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {bonusZeilen.map((z) => {
                    const ok = z.fehlt.length === 0 && hatRolleAustraeger;
                    const az = z.einsatz?.arbeitszeit;
                    return (
                      <tr key={z.schluessel} className={ok ? '' : 'text-gray-400'}>
                        <td className={`${td} font-mono`}>{z.kw}</td>
                        <td className={td}>
                          {z.tgName}
                          {z.ohneAustragenVerguetung && <span className="ml-1 text-[10px] text-gray-400">(ohne Austragen-Vergütung)</span>}
                        </td>
                        <td className={td}>
                          {z.fehlt.length === 0 ? (
                            <span className="text-green-700">
                              ✓ {az ? `${isoDatum(az.datum)} ${az.von}–${az.bis}` : ''}
                              {z.einsatz?.restmenge != null && ` · Restmenge ${z.einsatz.restmenge}`}
                            </span>
                          ) : (
                            <span className="text-amber-700">✗ {z.fehlt.join(', ')}</span>
                          )}
                        </td>
                        <td className={`${td} text-right font-mono ${ok ? 'font-semibold' : ''}`}>{ok ? eur(bonusBetrag) : '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          <div>
            <h5 className="font-semibold text-gray-700 mb-1">
              Min-Boni (Tätigkeitsbonus) — {er.ausgabenBoniMinutenGesamt} min = {eur(er.ausgabenBoniLohnGesamt)}
            </h5>
            {er.ausgabenBoni.length === 0 ? (
              <Leer>Kein Tätigkeitsbonus in den Stammdaten hinterlegt.</Leer>
            ) : (
              <>
                <p className="text-gray-500 mb-1.5">
                  {er.ausgabenBoni[0].minuten} min je Ausgabe ÷ 60 × {zahl(satzAustr, 2)} €/h
                  {er.ausgabenBoni[0].kommentar && ` — ${er.ausgabenBoni[0].kommentar}`}
                </p>
                <table className="w-full text-xs">
                  <tbody className="divide-y divide-gray-100">
                    {er.ausgabenBoni.map((b) => (
                      <tr key={b.id}>
                        <td className={`${td} font-mono`}>KW {b.kw}</td>
                        <td className={`${td} text-right font-mono`}>{b.minuten} min</td>
                        <td className={`${td} text-right font-mono font-semibold`}>{eur(b.lohn)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </div>

          <div>
            <h5 className="font-semibold text-gray-700 mb-1">Bonus / variabler Periodenzusatz — {eur(er.bonus)}</h5>
            {er.bonus ? (
              <p className="text-gray-700">{er.bonusKommentar || <span className="text-gray-400">ohne Kommentar</span>}</p>
            ) : (
              <Leer>Kein Periodenzusatz erfasst.</Leer>
            )}
          </div>

          {!ma.hatFestgehalt && (
            <div>
              <h5 className="font-semibold text-gray-700 mb-1">
                Gewichtszulagen — {eur(summeGewicht)} <span className="font-normal text-gray-400">(in Austragen enthalten)</span>
              </h5>
              <p className="text-gray-500 mb-1.5">
                Anzeigenblatt: Seiten ÷ 2 × Blattfläche × Grammatur × Stückzahl = kg × {zahl(params.gewichtszulageAnzeigenblattEurKg, 2)} €/kg ·
                Beilagen: Σ g/Stk × Stückzahl = kg × {zahl(params.gewichtszulageBeilagenEurKg, 2)} €/kg
              </p>
              {austragenZeilen.length === 0 ? (
                <Leer>Keine Austragen-Einsätze.</Leer>
              ) : (
                <table className="w-full text-xs">
                  <thead className="bg-gray-50 text-gray-600">
                    <tr>
                      <th className={`${th} text-left`}>KW</th>
                      <th className={`${th} text-left`}>Teilgebiet</th>
                      <th className={`${th} text-right`}>kg Anzeigenbl.</th>
                      <th className={`${th} text-right`}>Zulage</th>
                      <th className={`${th} text-right`}>kg Beilagen</th>
                      <th className={`${th} text-right`}>Zulage</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {austragenZeilen.map((z) => (
                      <tr key={austragenKey(z.e)}>
                        <td className={`${td} font-mono`}>{z.e.kw}</td>
                        <td className={td}>{z.e.teilgebietName}</td>
                        <td className={`${td} text-right font-mono`}>{zahl(z.kgAnzeigenblatt, 1)}</td>
                        <td className={`${td} text-right font-mono`}>{eur(z.e.detail.gewichtsbonusAnzeigenblatt)}</td>
                        <td className={`${td} text-right font-mono`}>{zahl(z.kgBeilagen, 1)}</td>
                        <td className={`${td} text-right font-mono`}>{eur(z.e.detail.gewichtsbonusBeilagen)}</td>
                      </tr>
                    ))}
                    <tr className="bg-gray-50 font-semibold">
                      <td className={td} colSpan={2}>Summe</td>
                      <td className={`${td} text-right font-mono`}>{zahl(summeAustragen.kgAnzeigenblatt, 1)}</td>
                      <td className={`${td} text-right font-mono`}>{eur(er.gewichtsbonusAnzeigenblatt)}</td>
                      <td className={`${td} text-right font-mono`}>{zahl(summeAustragen.kgBeilagen, 1)}</td>
                      <td className={`${td} text-right font-mono`}>{eur(er.gewichtsbonusBeilagen)}</td>
                    </tr>
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>
      </Abschnitt>

      {/* Fahrtkosten */}
      <Abschnitt
        titel="Fahrtkosten"
        untertitel={`${er.fahrten.length} Fahrt${er.fahrten.length === 1 ? '' : 'en'} · ${zahl(fahrtKmGesamt, 1)} km`}
        betrag={eur(er.fahrtkostenGesamt)}
        offen={istOffen('fahrten')}
        onToggle={() => toggle('fahrten')}
        leer={er.fahrten.length === 0 && kontext.fahrtenAusserhalb.length === 0}
      >
        <Schluessel>
          Erstattung = km × {zahl(er.fahrtSatzEurProKm, 2)} €/km
          ({ma.fahrkostenEurProKm != null ? 'individueller Satz des MA' : 'Satz aus den Parametern'}).
          Vergütet werden alle Fahrten, die dieser Abrechnungsperiode zugeordnet sind.
        </Schluessel>
        {er.fahrten.length === 0 ? (
          <Leer>Keine Fahrten dieser Periode zugeordnet.</Leer>
        ) : (
          <table className="w-full text-xs">
            <thead className="bg-gray-50 text-gray-600">
              <tr>
                <th className={`${th} text-left`}>Datum</th>
                <th className={`${th} text-left`}>Ziel / Touren</th>
                <th className={`${th} text-right`}>km</th>
                <th className={`${th} text-right`}>Betrag</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {fahrtenSortiert.map((f) => (
                <tr key={f.id}>
                  <td className={`${td} font-mono whitespace-nowrap`}>{isoDatum(f.datum)}</td>
                  <td className={td}>
                    {fahrtZiel(f)}
                    {f.bemerkung && <span className="ml-1 text-gray-400">({f.bemerkung})</span>}
                  </td>
                  <td className={`${td} text-right font-mono`}>{zahl(f.streckKm, f.streckKm % 1 ? 1 : 0)}</td>
                  <td className={`${td} text-right font-mono font-semibold`}>{eur(f.streckKm * er.fahrtSatzEurProKm)}</td>
                </tr>
              ))}
              <tr className="bg-blue-50 border-t-2 border-blue-200 font-semibold text-blue-900">
                <td className={td} colSpan={2}>Summe</td>
                <td className={`${td} text-right font-mono`}>{zahl(fahrtKmGesamt, 1)}</td>
                <td className={`${td} text-right font-mono`}>{eur(er.fahrtkostenGesamt)}</td>
              </tr>
            </tbody>
          </table>
        )}
        {kontext.fahrtenAusserhalb.length > 0 && (
          <div className="mt-3">
            <div className="font-semibold text-amber-800 mb-1">
              Fahrten im selben Monat, die NICHT dieser Periode zugeordnet sind (nicht vergütet)
            </div>
            <ul className="list-disc list-inside text-amber-800">
              {[...kontext.fahrtenAusserhalb].sort((a, b) => a.datum.localeCompare(b.datum)).map((f) => (
                <li key={f.id}>
                  {isoDatum(f.datum)} · {fahrtZiel(f)} · {zahl(f.streckKm, f.streckKm % 1 ? 1 : 0)} km
                  {' — '}{f.abrechnungsperiodeId ? 'andere Periode zugeordnet' : 'keiner Periode zugeordnet'}
                </li>
              ))}
            </ul>
          </div>
        )}
      </Abschnitt>

      {/* Festgehalt */}
      {ma.hatFestgehalt && (
        <Abschnitt
          titel="Festgehalt"
          betrag={eur(er.fixesGehalt)}
          offen={istOffen('festgehalt')}
          onToggle={() => toggle('festgehalt')}
        >
          <p className="text-gray-700">
            Monatlicher Festbetrag laut Stammdaten. Austragen, Zusammentragen und Stempelzeiten
            werden bei Festgehalt nicht zusätzlich vergütet; Fahrtkosten, Min-Boni und
            Periodenzusatz kommen hinzu.
          </p>
        </Abschnitt>
      )}

      {/* Lohnkonto & Vorschüsse */}
      <Abschnitt
        titel="Lohnkonto & Vorschüsse"
        untertitel={`Saldo ${eur(er.lohnkontoSaldoVorPeriode)} → ${eur(er.lohnkontoSaldoNachPeriode)}${er.vorschuesse.length ? ` · ${er.vorschuesse.length} Vorschuss/Vorschüsse` : ''}`}
        betrag={eur(er.bruttoLohnbuero)}
        betragHinweis="Brutto Lohnbüro"
        offen={istOffen('lohnkonto')}
        onToggle={() => toggle('lohnkonto')}
        leer={er.lohnkontoBuchungenPeriode.length === 0 && er.lohnkontoSaldoVorPeriode === 0 && er.vorschuesse.length === 0}
      >
        <Schluessel>
          Brutto Lohnbüro = errechnetes Brutto − Verschiebungen (Betrag wird in spätere Perioden
          geschoben) + Verrechnungen (früher geschobener Betrag wird ausgezahlt).
        </Schluessel>
        <table className="w-full text-xs mb-3">
          <tbody className="divide-y divide-gray-100">
            <tr><td className={td}>Saldo Lohnkonto vor der Periode</td><td className={`${td} text-right font-mono`}>{eur(er.lohnkontoSaldoVorPeriode)}</td></tr>
            {er.lohnkontoBuchungenPeriode.map((b) => (
              <tr key={b.id}>
                <td className={td}>
                  {b.art === 'verschiebung' ? '+ Verschiebung aufs Lohnkonto' : '− Verrechnung (Auszahlung)'}
                  {b.kommentar && <span className="ml-1 text-gray-400">— {b.kommentar}</span>}
                </td>
                <td className={`${td} text-right font-mono`}>{b.art === 'verschiebung' ? '+' : '−'}{eur(b.betragEur)}</td>
              </tr>
            ))}
            <tr className="font-semibold"><td className={td}>Saldo Lohnkonto nach der Periode</td><td className={`${td} text-right font-mono`}>{eur(er.lohnkontoSaldoNachPeriode)}</td></tr>
          </tbody>
        </table>
        <h5 className="font-semibold text-gray-700 mb-1">Vorschüsse (Abschlagszahlungen)</h5>
        {er.vorschuesse.length === 0 ? (
          <Leer>keine</Leer>
        ) : (
          <table className="w-full text-xs">
            <tbody className="divide-y divide-gray-100">
              {er.vorschuesse.map((v) => (
                <tr key={v.id}>
                  <td className={td}>{new Date(v.erstelltAm).toLocaleDateString('de-DE')}</td>
                  <td className={td}>{v.bemerkung || '—'}</td>
                  <td className={`${td} text-right font-mono`}>{eur(v.betragEur)}</td>
                </tr>
              ))}
              <tr className="font-semibold bg-gray-50">
                <td className={td} colSpan={2}>Summe Vorschüsse</td>
                <td className={`${td} text-right font-mono`}>{eur(er.vorschussSumme)}</td>
              </tr>
            </tbody>
          </table>
        )}
      </Abschnitt>

      <p className="text-xs text-gray-400 text-center italic pt-2">
        Nur Vorschau — es wird nichts gespeichert.
      </p>
    </div>
  );
}

// ---- Rechenweg Austragen ----------------------------------------------

function RechenwegAustragen({ z, params }: { z: AustragenZeile; params: Parameter }) {
  const d = z.e.detail;
  const extGeschw = params.externeBeilageEinlegeGeschwStkProH || params.steckzeitStkProH;
  const zeilen: Array<[string, ReactNode, string]> = [];
  if (z.tg) {
    zeilen.push(['Laufzeit', `${zahl(z.tg.wegstreckeM)} m ÷ ${zahl(params.laufgeschwindigkeitMProH)} m/h`, stdMin(z.laufzeit)]);
    zeilen.push(['Steckzeit', `${zahl(z.tg.stueckzahl)} Stk ÷ ${zahl(params.steckzeitStkProH)} Stk/h`, stdMin(z.steckzeit)]);
    if (d.anzahlExtBeilagen > 0) {
      zeilen.push(['Ext. Beilagen einlegen', `${zahl(z.tg.stueckzahl)} Stk × ${d.anzahlExtBeilagen} ÷ ${zahl(extGeschw)} Stk/h`, stdMin(d.zeitExtBeilagenStunden)]);
    }
  } else {
    zeilen.push(['Teilgebiet', 'nicht mehr in den Stammdaten gefunden', '']);
  }
  zeilen.push(['Soll-Zeit', '', stdMin(d.zeitStunden)]);
  zeilen.push(['Grundlohn', `${stdMin(d.zeitStunden)} × ${zahl(z.stundenlohn, 2)} €/h`, eur(d.grundlohn)]);
  if (z.e.typ === 'springer') {
    zeilen.push([
      'Springerzulage',
      `${eur(d.grundlohn)} × ${zahl(z.springerProzent, z.springerProzent % 1 ? 1 : 0)} %${z.springerIndividuell ? ' (individuell)' : ''}`,
      eur(d.springerZuschlag),
    ]);
  }
  if (z.ausgabe) {
    const a = z.ausgabe;
    zeilen.push([
      'Gewicht Anzeigenblatt',
      `${a.seitenzahl} Seiten, ${a.seitenformatMm.breite}×${a.seitenformatMm.hoehe} mm, ${a.grammaturGqm} g/m² → ${zahl(z.kgAnzeigenblatt, 1)} kg × ${zahl(params.gewichtszulageAnzeigenblattEurKg, 2)} €/kg`,
      eur(d.gewichtsbonusAnzeigenblatt),
    ]);
  }
  zeilen.push([
    'Gewicht Beilagen',
    z.beilagenTg.length === 0
      ? 'keine Beilagen'
      : `${z.beilagenTg.map((b) => `${b.arbeitstitel || b.kundenname || 'Beilage'} (${zahl(b.gewichtGStk, b.gewichtGStk % 1 ? 1 : 0)} g, ${b.kennzeichen})`).join(', ')} → ${zahl(z.kgBeilagen, 1)} kg × ${zahl(params.gewichtszulageBeilagenEurKg, 2)} €/kg`,
    eur(d.gewichtsbonusBeilagen),
  ]);
  if (d.sonderbetrag) {
    zeilen.push(['Sondervergütung', z.sv?.begruendung ? `Sondervereinbarung — ${z.sv.begruendung}` : 'Sondervereinbarung', eur(d.sonderbetrag)]);
  }
  const abweichend = z.nachgerechnet != null && !gleich(z.nachgerechnet, d.gesamt);
  return (
    <div className="rounded-md border border-blue-100 bg-white px-3 py-2">
      <table className="w-full text-[11px]">
        <tbody>
          {zeilen.map(([label, formel, wert]) => (
            <tr key={label}>
              <td className="py-0.5 pr-3 text-gray-500 whitespace-nowrap align-top">{label}</td>
              <td className="py-0.5 pr-3 text-gray-700">{formel}</td>
              <td className="py-0.5 text-right font-mono text-gray-800 whitespace-nowrap align-top">{wert}</td>
            </tr>
          ))}
          <tr className="border-t border-gray-200 font-semibold">
            <td className="py-1 pr-3 text-gray-700">Gesamt</td>
            <td />
            <td className="py-1 text-right font-mono text-gray-900">{eur(d.gesamt)}</td>
          </tr>
        </tbody>
      </table>
      {abweichend && (
        <p className="mt-1 text-amber-700">
          ⚠ Mit den aktuellen Daten ergäbe sich {eur(z.nachgerechnet!)} — der abgerechnete Wert stammt aus einem
          früheren Stand (z. B. Monatswechsel-Fixierung oder nachträglich geänderte Stückzahl/Beilagen).
        </p>
      )}
    </div>
  );
}

// ---- Zeiterfassungs-Zeilen ---------------------------------------------

function ZeitZeileTr({ z, tagAnzeigen, anzTagesZeilen }: { z: ZeitZeile; tagAnzeigen: boolean; anzTagesZeilen: number }) {
  const az = z.az;
  return (
    <tr className={z.abgerechnet ? '' : 'text-gray-400'}>
      {tagAnzeigen && (
        <td className={`${td} whitespace-nowrap align-top text-gray-700`} rowSpan={anzTagesZeilen}>
          {tagLang(new Date(az.startTime))}
        </td>
      )}
      <td className={td}>
        {TYP_LABELS[az.typ] ?? az.typ}
        {az.quelle === 'selbstmeldung' && <span className="ml-1 text-[10px] text-gray-400">(Selbstmeldung)</span>}
      </td>
      <td className={`${td} font-mono whitespace-nowrap`}>
        {uhrzeit(az.startTime)} – {az.endTime ? uhrzeit(az.endTime) : 'offen'}
      </td>
      <td className={`${td} text-right font-mono`}>{az.gesamtPauseMinuten ? `${Math.round(az.gesamtPauseMinuten)} min` : '—'}</td>
      <td className={`${td} text-right font-mono`}>{stdMin(z.nettoMin / 60)}</td>
      <td className={td}>
        {z.abgerechnet
          ? <span className="text-green-700">✓ × {zahl(z.satz, 2)} €/h</span>
          : <span className="text-amber-700">✗ {z.grund}</span>}
      </td>
      <td className={`${td} text-right font-mono ${z.abgerechnet ? 'font-semibold' : ''}`}>
        {z.abgerechnet ? eur((z.nettoMin / 60) * z.satz) : '—'}
      </td>
    </tr>
  );
}

function ZeitTabelle({ zeilen, summeLohn, summeLabel }: { zeilen: ZeitZeile[]; summeLohn: number; summeLabel: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="bg-gray-50 text-gray-600">
          <tr>
            <th className={`${th} text-left`}>Tag</th>
            <th className={`${th} text-left`}>Tätigkeit</th>
            <th className={`${th} text-left`}>Von – Bis</th>
            <th className={`${th} text-right`}>Pause</th>
            <th className={`${th} text-right`}>Netto</th>
            <th className={`${th} text-left`}>Abrechnung</th>
            <th className={`${th} text-right`}>Lohn</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {zeilen.map((z) => <ZeitZeileTr key={z.az.id} z={z} tagAnzeigen anzTagesZeilen={1} />)}
          <tr className="bg-gray-50 font-semibold">
            <td className={td} colSpan={4}>{summeLabel}</td>
            <td className={`${td} text-right font-mono`}>{stdMin(zeilen.reduce((s, z) => s + z.nettoMin, 0) / 60)}</td>
            <td />
            <td className={`${td} text-right font-mono`}>{eur(summeLohn)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
