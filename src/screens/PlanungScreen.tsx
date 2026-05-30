// ============================================================
// Drucksaal- und Austrägerplanung
// ============================================================
//
// Eine breite, horizontal scrollbare Matrix für ein ganzes Jahr:
// - Drucksaal: 5 Tätigkeitszeilen × n KWs
// - Fahrer: 1 Zeile je aktive Tour × n KWs
// - Zusammenträger: 1 Zeile je aktiver Zusammenträger × n KWs (Status + Kommentar)
// - Austräger-Ausfälle: 1 Zeile je betroffenem TG × n KWs (Ausfall + Springer)
//
// Alle vier Sektionen teilen sich die KW-Spaltenbreite und das sticky
// linke Label, damit beim Scrollen horizontal nichts verrutscht.
//
// Speicherung pro Zelle direkt nach onChange (Firestore-Upsert), kein
// "Speichern"-Knopf. Bei Drucksaal/Fahrer ein Dropdown, das nichts
// blockiert. Bei Ausfällen ein Modal mit den Detail-Feldern.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../context/AppContext';
import AdminPinGate from '../components/AdminPinGate';
import Modal from '../components/Modal';
import {
  alleKWsImJahr,
  getCurrentKW,
  donnerstagDerKW,
} from '../lib/kalender';
import {
  setzeEinsatz,
  loescheEinsatz,
  aktualisiereMitarbeiter,
  aktualisiereTour,
  einsaetzeJahrListener,
  getOrCreateAusgabe,
} from '../lib/db';
import {
  drucksaalPlanungListener,
  setzeDrucksaalPlanung,
  fahrerPlanungListener,
  setzeFahrerPlanung,
  zusammentragerPlanungListener,
  setzeZusammentragerPlanung,
  urlaubsListener,
  loescheUrlaub,
  freigebenUrlaub,
  setzeUrlaubsGruppe,
  loescheUrlaubsGruppe,
  freigebenUrlaubsGruppe,
  austraegerwechselPlanListener,
  setzeAustraegerwechselPlan,
  loescheAustraegerwechselPlan,
} from '../lib/planung';
import { getISOWeek, getISOYear } from '../lib/kalender';
import { ferienInKw, feiertageInKw } from '../lib/ferien';

/**
 * Werktagsverteilung pro ISO-Woche für einen Datumsbereich.
 * Liefert je Woche, in die mind. ein Werktag (Mo-Fr) fällt, die Anzahl
 * der enthaltenen Werktage. Wochenenden werden ignoriert.
 *
 * Wird verwendet, um pro Chip den Urlaubsstatus abzuleiten:
 *   5 Werktage  → ganze Woche
 *   2-4         → mehrtägig
 *   1           → einzeltag (z. B. Urlaub beginnt Freitag oder endet Montag)
 */
function urlaubWochenAusBereich(
  datumVon: string,
  datumBis: string,
  zusatzWerktage: string[] = [],
): Array<{ jahr: number; kw: number; status: UrlaubStatus; werktageInKw: string[] }> {
  // Sammle alle Werktage (Mo–Fr) aus dem [von..bis]-Bereich plus
  // explizite Zusatz-Werktage (z. B. Mo + Mi + Fr in einer KW).
  const alleTage = new Set<string>();
  if (datumVon && datumBis) {
    const von = new Date(datumVon);
    const bis = new Date(datumBis);
    if (!isNaN(+von) && !isNaN(+bis) && bis >= von) {
      const cursor = new Date(von);
      while (cursor <= bis) {
        const dow = cursor.getDay();
        if (dow >= 1 && dow <= 5) {
          alleTage.add(isoFromDate(cursor));
        }
        cursor.setDate(cursor.getDate() + 1);
      }
    }
  }
  for (const iso of zusatzWerktage) {
    if (!iso) continue;
    const d = new Date(iso);
    if (isNaN(+d)) continue;
    const dow = d.getDay();
    if (dow < 1 || dow > 5) continue; // nur Werktage
    alleTage.add(iso);
  }
  if (alleTage.size === 0) return [];

  // Gruppiere nach ISO-Woche.
  const buckets = new Map<string, { jahr: number; kw: number; tage: string[] }>();
  for (const iso of alleTage) {
    const d = new Date(iso);
    const j = getISOYear(d);
    const k = getISOWeek(d);
    const key = `${j}-${k}`;
    const b = buckets.get(key) ?? { jahr: j, kw: k, tage: [] };
    b.tage.push(iso);
    buckets.set(key, b);
  }

  const out: Array<{ jahr: number; kw: number; status: UrlaubStatus; werktageInKw: string[] }> = [];
  for (const b of buckets.values()) {
    b.tage.sort();
    const c = b.tage.length;
    const status: UrlaubStatus =
      c >= 5 ? 'ganze-woche' : c >= 2 ? 'mehrtaegig' : 'einzeltag';
    out.push({ jahr: b.jahr, kw: b.kw, status, werktageInKw: b.tage });
  }
  out.sort((a, b) => a.jahr - b.jahr || a.kw - b.kw);
  return out;
}

/**
 * Kürzt einen TG-Namen für die schmalen Chip-Zellen so, dass die
 * abschließende Nummer (falls vorhanden) immer sichtbar bleibt.
 * Beispiele:
 *   „Bodenfelde1" → „Bodenf1"
 *   „Adelebsen5"  → „Adel5"
 *   „Uslar"       → „Uslar"   (keine Nummer → unverändert)
 *
 * Der Alpha-Anteil wird auf max. 6 Zeichen gekürzt, damit selbst mit
 * 2-stelliger Nummer das Ergebnis ≤ 8 Zeichen bleibt.
 */
function kuerzeTgName(name: string, alphaMax = 4): string {
  if (!name) return '';
  const m = name.match(/^(.*?)(\d+)\s*$/);
  if (!m) return name;
  const alpha = m[1].trim();
  const num = m[2];
  if (alpha.length <= alphaMax) return alpha + num;
  return alpha.slice(0, alphaMax) + num;
}

/** True, wenn (jahr, kw) STRIKT vor heutiger ISO-KW liegt. */
function istVergangeneKw(jahr: number, kw: number): boolean {
  const heute = getCurrentKW();
  if (jahr < heute.jahr) return true;
  if (jahr > heute.jahr) return false;
  return kw < heute.kw;
}

function isoFromDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Anzahl Werktage (Mo–Fr) zwischen `von` und `bis` inklusiv. */
function zaehleWerktage(datumVon: string, datumBis: string): number {
  if (!datumVon || !datumBis) return 0;
  const v = new Date(datumVon);
  const b = new Date(datumBis);
  if (isNaN(+v) || isNaN(+b) || b < v) return 0;
  let n = 0;
  const c = new Date(v);
  while (c <= b) {
    const dow = c.getDay();
    if (dow >= 1 && dow <= 5) n++;
    c.setDate(c.getDate() + 1);
  }
  return n;
}

/**
 * Berechnet aus `datumVon` + Anzahl Werktage das resultierende `datumBis`.
 * Startet beim `datumVon`; wenn dieses ein Wochenend-Tag ist, wird auf den
 * folgenden Montag verschoben. Liefert ISO-Date oder leeren String, wenn
 * die Eingabe ungültig ist.
 */
function bisAusWerktage(datumVon: string, anzahl: number): string {
  if (!datumVon || anzahl < 1) return '';
  const start = new Date(datumVon);
  if (isNaN(+start)) return '';
  // Wenn datumVon ein Samstag (6) oder Sonntag (0): auf nächsten Montag legen.
  const dow0 = start.getDay();
  if (dow0 === 0) start.setDate(start.getDate() + 1);
  if (dow0 === 6) start.setDate(start.getDate() + 2);
  let werktageGezaehlt = 0;
  const cursor = new Date(start);
  // Werktage-Count bis Anzahl erreicht. Letzter Werktag = Bis-Datum.
  while (werktageGezaehlt < anzahl) {
    const dow = cursor.getDay();
    if (dow >= 1 && dow <= 5) werktageGezaehlt++;
    if (werktageGezaehlt < anzahl) cursor.setDate(cursor.getDate() + 1);
  }
  return isoFromDate(cursor);
}
import {
  DRUCKSAAL_TAETIGKEIT_LABELS,
  ZUSAMMENTRAGER_STATUS_LABELS,
  URLAUB_STATUS_LABELS,
  type DrucksaalPlanung,
  type DrucksaalTaetigkeit,
  type FahrerPlanung,
  type ZusammentragerPlanung,
  type ZusammentragerStatus,
  type Einsatz,
  type Parameter,
  type UrlaubsEintrag,
  type UrlaubStatus,
  type StandardAustraegerWechselPlan,
  type Mitarbeiter,
  type Teilgebiet,
  type Ausgabe,
} from '../types';
import { ausgabenListener, ladeBeilagen } from '../lib/db';
import { berechneZusammentragZeit, formatierStunden } from '../lib/berechnung';
import type { Beilage } from '../types';

const TAETIGKEITEN: DrucksaalTaetigkeit[] = [
  'drucken',
  'falzen1',
  'falzen2',
  'schneiden',
  'verpacken',
];

// Spaltenbreite muss in allen Tabellen identisch sein.
const KW_COL_PX = 96;
const LABEL_COL_PX = 220;
// Höhe der KW-Kopfzeile in Pixeln (zweizeilig: KW-Nummer + Datum + py-2).
// Die Sektionen-Header docken direkt darunter an und bleiben so beim
// vertikalen Scrollen sichtbar.
const KW_HEADER_HEIGHT_PX = 50;
const SECTION_STICKY_TOP_PX = KW_HEADER_HEIGHT_PX;

export default function PlanungScreen() {
  return (
    <AdminPinGate allowedRoles={['admin', 'abrechnung']}>
      <PlanungContent />
    </AdminPinGate>
  );
}

function PlanungContent() {
  const { mitarbeiter, touren, teilgebiete, userRole, adminName, parameter, abrechnungsperioden } = useApp();
  const istAdmin = userRole === 'admin';
  // Wechselpläne (Standardausträger-Wechsel) dürfen sowohl Admin als
  // auch Abrechnung anlegen/bearbeiten/löschen. Die *Übernahme* beim
  // Monatswechsel (TG.standardAustraegerId setzen) bleibt admin-only —
  // das passiert separat im AbrechnungScreen-Übernahme-Dialog.
  const darfWechselplanPflegen = userRole === 'admin' || userRole === 'abrechnung';
  const currentKW = getCurrentKW();
  const [jahr, setJahr] = useState<number>(currentKW.jahr);
  const kws = useMemo(() => alleKWsImJahr(jahr), [jahr]);

  // ---- Listener: vier Planungs-Collections + Ausgaben ----
  const [drucksaal, setDrucksaal] = useState<DrucksaalPlanung[]>([]);
  const [fahrer, setFahrer] = useState<FahrerPlanung[]>([]);
  const [zusammen, setZusammen] = useState<ZusammentragerPlanung[]>([]);
  // Live-Liste aller Einsätze des Jahres. Die „Ausfälle"-Sektion zeigt
  // davon nur Einsätze mit typ ∈ {'springer','ausfall','ungeklärt'} —
  // typ='standard' bedeutet, das TG wird vom Standardausträger versorgt
  // und ist kein Ausfall. Schreiben/Löschen erfolgt direkt über
  // setzeEinsatz/loescheEinsatz aus db.ts (= Single Source of Truth mit
  // dem Einsätze-Screen).
  const [einsaetze, setEinsaetze] = useState<Einsatz[]>([]);
  // Alle Einsätze des Jahres, die einen Ausfall/Springer repräsentieren —
  // unabhängig von der TG-Klassifizierung. Wird von der Wechsel-Sektion
  // als Lookup-Basis benutzt (z. B. ob in einer KW bereits ein Springer
  // für ein TG mit Wechselplan gesetzt ist).
  const alleAusfallEinsaetze = useMemo(
    () => einsaetze.filter(
      (e) => e.typ === 'springer' || e.typ === 'ausfall' || e.typ === 'ungeklärt',
    ),
    [einsaetze],
  );

  // KWs des Jahres, die zu einer abgeschlossenen Abrechnungsperiode
  // gehören. Für diese KWs sind in der Ausfälle-Sektion keine
  // Änderungen mehr erlaubt — analog zum Einsätze-Screen.
  const gesperrteKws = useMemo(() => {
    const s = new Set<number>();
    for (const p of abrechnungsperioden) {
      if (p.jahr !== jahr) continue;
      if (p.status !== 'abgeschlossen') continue;
      for (const k of p.kalenderwochen) s.add(k);
    }
    return s;
  }, [abrechnungsperioden, jahr]);
  const [urlaube, setUrlaube] = useState<UrlaubsEintrag[]>([]);
  const [ausgaben, setAusgaben] = useState<Ausgabe[]>([]);
  const [wechselplan, setWechselplan] = useState<StandardAustraegerWechselPlan[]>([]);

  // Vereinheitlichte Liste der Wechsel-Sektion: enthält ALLE Zeilen,
  // die in „🔁 Standard-Wechsel" angezeigt werden — sowohl persistierte
  // Wechselpläne als auch „virtuelle" Pläne für dauerhaft unbesetzte
  // Teilgebiete. Virtuelle Pläne haben `id` mit Präfix `virtual-` und
  // keine `letzteAusgabe*`-Felder. So wird nur EIN Render-Pfad
  // (`WechselCell`) gepflegt und getestet.
  const effektivePlaene = useMemo<StandardAustraegerWechselPlan[]>(() => {
    const echtTgIds = new Set(wechselplan.map((w) => w.teilgebietId));
    const virtuelle: StandardAustraegerWechselPlan[] = teilgebiete
      .filter(
        (t) =>
          t.isActive &&
          !t.istAuslagestelle &&
          !t.standardAustraegerId &&
          !echtTgIds.has(t.id),
      )
      .map((t) => ({
        id: `virtual-${t.id}`,
        teilgebietId: t.id,
        erstelltAm: 0,
        aktualisiertAm: 0,
      } as StandardAustraegerWechselPlan));
    return [...wechselplan, ...virtuelle];
  }, [wechselplan, teilgebiete]);

  // TG-IDs, die der Wechsel-Sektion zugeordnet sind. Ihre Einsätze
  // tauchen NUR in der Wechsel-Sektion auf, nicht zusätzlich in der
  // Ausfälle-Sektion — sonst hätte man jeden Springer doppelt.
  const wechselTgIds = useMemo(
    () => new Set(effektivePlaene.map((p) => p.teilgebietId)),
    [effektivePlaene],
  );

  // Untermenge für die Ausfälle-Sektion: alle Ausfall-/Springer-Einsätze
  // OHNE die, die in der Wechsel-Sektion bereits sichtbar sind.
  const ausfaelle = useMemo(
    () => alleAusfallEinsaetze.filter((e) => !wechselTgIds.has(e.teilgebietId)),
    [alleAusfallEinsaetze, wechselTgIds],
  );

  useEffect(() => {
    const u1 = drucksaalPlanungListener(jahr, setDrucksaal);
    const u2 = fahrerPlanungListener(jahr, setFahrer);
    const u3 = zusammentragerPlanungListener(jahr, setZusammen);
    const u4 = einsaetzeJahrListener(jahr, setEinsaetze);
    const u5 = ausgabenListener(setAusgaben);
    const u6 = urlaubsListener(jahr, setUrlaube);
    // Wechselplan ist jahresübergreifend — kein Filter.
    const u7 = austraegerwechselPlanListener(setWechselplan);
    return () => { u1(); u2(); u3(); u4(); u5(); u6(); u7(); };
  }, [jahr]);

  // Beilagen einmal global laden — wird für die Soll-Zeit-Berechnung
  // pro KW gebraucht. Refetch nur, wenn sich die Ausgaben-Liste ändert
  // (= jemand legt neue Ausgaben oder Beilagen an).
  const [alleBeilagen, setAlleBeilagen] = useState<Beilage[]>([]);
  useEffect(() => {
    let abgebrochen = false;
    ladeBeilagen().then((list) => {
      if (!abgebrochen) setAlleBeilagen(list);
    });
    return () => { abgebrochen = true; };
  }, [ausgaben.length]);

  // ---- Indizes für O(1)-Lookup in den Zellen ----
  const drucksaalIdx = useMemo(() => {
    const m = new Map<string, DrucksaalPlanung>();
    for (const d of drucksaal) m.set(`${d.kw}-${d.taetigkeit}`, d);
    return m;
  }, [drucksaal]);

  const fahrerIdx = useMemo(() => {
    const m = new Map<string, FahrerPlanung>();
    for (const f of fahrer) m.set(`${f.kw}-${f.tourId}`, f);
    return m;
  }, [fahrer]);

  const zusammenIdx = useMemo(() => {
    const m = new Map<string, ZusammentragerPlanung>();
    for (const z of zusammen) m.set(`${z.kw}-${z.mitarbeiterId}`, z);
    return m;
  }, [zusammen]);

  // Lookup über ALLE Ausfall-/Springer-Einsätze (auch Wechsel-TGs).
  // Wird sowohl von der Wechsel-Sektion (Lücken-Lookup) als auch dem
  // Modal als Vorlage genutzt.
  const ausfallIdx = useMemo(() => {
    const m = new Map<string, Einsatz>();
    for (const a of alleAusfallEinsaetze) m.set(`${a.kw}-${a.teilgebietId}`, a);
    return m;
  }, [alleAusfallEinsaetze]);

  const urlaubIdx = useMemo(() => {
    const m = new Map<string, UrlaubsEintrag>();
    for (const u of urlaube) m.set(`${u.kw}-${u.mitarbeiterId}`, u);
    return m;
  }, [urlaube]);

  /**
   * Soll-Zeit Zusammentragen pro KW (in Stunden). Summiert über alle
   * aktiven, nicht-Auslagestellen-TGs unter Berücksichtigung der
   * internen Beilagen der jeweiligen Ausgabe.
   * Pro KW: erforderliche Personalressource für das Zusammentragen.
   */
  const sollZusammenProKw = useMemo(() => {
    const m = new Map<number, number>();
    if (!parameter) return m;
    // Index Beilagen je Ausgabe (für Lookup pro TG).
    const beilagenByAusgabe = new Map<string, Beilage[]>();
    for (const b of alleBeilagen) {
      const arr = beilagenByAusgabe.get(b.ausgabeId) ?? [];
      arr.push(b);
      beilagenByAusgabe.set(b.ausgabeId, arr);
    }
    for (const a of ausgaben) {
      if (a.jahr !== jahr) continue;
      const ausgabeBeilagen = beilagenByAusgabe.get(a.id) ?? [];
      let summe = 0;
      for (const tg of teilgebiete) {
        if (!tg.isActive || tg.istAuslagestelle) continue;
        const intBeilagenTg = ausgabeBeilagen.filter(
          (b) => b.kennzeichen === 'int' && b.teilgebietIds.includes(tg.id),
        ).length;
        summe += berechneZusammentragZeit(
          tg.stueckzahl,
          a.stapelAnzahl,
          intBeilagenTg,
          parameter,
        );
      }
      m.set(a.kw, summe);
    }
    return m;
  }, [parameter, ausgaben, alleBeilagen, teilgebiete, jahr]);

  // Mapping KW → zugehörige Abrechnungsperiode (für visuelle Gruppierung
  // im KW-Header: alternierender Hintergrund pro Periode + dicker
  // Trennstrich zwischen Perioden).
  const periodeNachKw = useMemo(() => {
    const m = new Map<number, { id: string; bezeichnung: string; monat: number; abgeschlossen: boolean }>();
    for (const p of abrechnungsperioden) {
      if (p.jahr !== jahr) continue;
      for (const k of p.kalenderwochen) {
        m.set(k, {
          id: p.id,
          bezeichnung: p.bezeichnung,
          monat: p.monat,
          abgeschlossen: p.status === 'abgeschlossen',
        });
      }
    }
    return m;
  }, [abrechnungsperioden, jahr]);

  const ausgabeNachKw = useMemo(() => {
    const m = new Map<number, Ausgabe>();
    for (const a of ausgaben) if (a.jahr === jahr) m.set(a.kw, a);
    return m;
  }, [ausgaben, jahr]);

  // ---- Stammdaten-Subsets ----
  const drucksaalMa = useMemo(
    () => mitarbeiter
      .filter((m) => m.isActive && !m.istInteressent && m.istDrucksaal)
      .sort((a, b) => a.name.localeCompare(b.name, 'de')),
    [mitarbeiter],
  );
  const fahrerMa = useMemo(
    () => mitarbeiter
      .filter((m) => m.isActive && !m.istInteressent && m.fahrtkostenerstattung)
      .sort((a, b) => a.name.localeCompare(b.name, 'de')),
    [mitarbeiter],
  );
  const zusammentraegerMa = useMemo(
    () => mitarbeiter
      .filter((m) => m.isActive && !m.istInteressent && m.rollen.includes('zusammenträger'))
      .sort((a, b) => {
        // Manuelle Reihenfolge: MAs mit `sortierungZusammen` zuerst (numerisch),
        // alle anderen alphabetisch dahinter.
        const aHas = a.sortierungZusammen !== undefined;
        const bHas = b.sortierungZusammen !== undefined;
        if (aHas && bHas) return a.sortierungZusammen! - b.sortierungZusammen!;
        if (aHas) return -1;
        if (bHas) return 1;
        return a.name.localeCompare(b.name, 'de');
      }),
    [mitarbeiter],
  );

  // Zwei Untergruppen — Sortierreihenfolge bleibt erhalten innerhalb jeder
  // Gruppe; das Verschieben zwischen den Gruppen ist eine separate Aktion.
  const zusammenFest = useMemo(
    () => zusammentraegerMa.filter((m) => !m.zusammenAufAbruf),
    [zusammentraegerMa],
  );
  const zusammenAbruf = useMemo(
    () => zusammentraegerMa.filter((m) => m.zusammenAufAbruf === true),
    [zusammentraegerMa],
  );

  async function toggleZusammenAbruf(maId: string, neu: boolean) {
    await aktualisiereMitarbeiter(maId, { zusammenAufAbruf: neu });
  }

  // Hinweis: Die frühere Bulk-Aktion `markiereUnbesetzteAusgabenAlsLuecke`
  // (📌 „alle KWs als unbesetzt markieren" bei dauerhaft unbesetzten TGs)
  // wurde entfernt. Begründung: ein TG ohne Standardausträger ist per se
  // unbesetzt — zusätzliche `typ='ungeklärt'`-Einsätze waren redundant und
  // bliesen die Collection auf. Springer werden weiterhin pro KW über das
  // AusfallModal erfasst.

  // Die Bulk-Übernahme `uebernehmeAlleAusfaelleInKw` wurde entfernt:
  // Da PlanungScreen jetzt direkt in `einsaetze` schreibt, sind alle
  // Einträge automatisch in der Abrechnung — eine manuelle Übernahme
  // gibt es nicht mehr.

  // ---- Reihenfolge-Verschiebung (Pfeil-Buttons) ----
  // Speichert die komplette Liste 0..n-1, damit die Ordnung deterministisch
  // bleibt — auch wenn vorher keine Werte gesetzt waren.
  async function verschiebeZusammen(maId: string, richtung: -1 | 1) {
    const idx = zusammentraegerMa.findIndex((m) => m.id === maId);
    if (idx < 0) return;
    const ziel = idx + richtung;
    if (ziel < 0 || ziel >= zusammentraegerMa.length) return;
    const neu = [...zusammentraegerMa];
    [neu[idx], neu[ziel]] = [neu[ziel], neu[idx]];
    // Renummerieren — schreibt nur die MAs, deren Index sich geändert hat
    // ODER die noch keinen Wert hatten.
    await Promise.all(
      neu.map((m, i) =>
        m.sortierungZusammen === i
          ? Promise.resolve()
          : aktualisiereMitarbeiter(m.id, { sortierungZusammen: i }),
      ),
    );
  }
  const austraegerMa = useMemo(
    () => mitarbeiter
      .filter((m) => m.isActive && !m.istInteressent && m.rollen.includes('austräger'))
      .sort((a, b) => a.name.localeCompare(b.name, 'de')),
    [mitarbeiter],
  );

  // Eligible für die Urlaubs-Sektion: aktive MAs mit Rolle „sonstige".
  // Bewusst getrennt vom UI-sichtbaren `urlaubMa`, damit das Admin-Menü
  // „+ MA hinzufügen" auch die ausgeblendeten anbieten kann.
  const urlaubMaEligible = useMemo(
    () => mitarbeiter
      .filter((m) => m.isActive && !m.istInteressent && m.rollen.includes('sonstige')),
    [mitarbeiter],
  );

  const urlaubMa = useMemo(
    () => urlaubMaEligible
      .filter((m) => !m.urlaubsplanungAusgeblendet)
      .sort((a, b) => {
        const aHas = a.sortierungUrlaub !== undefined;
        const bHas = b.sortierungUrlaub !== undefined;
        if (aHas && bHas) return a.sortierungUrlaub! - b.sortierungUrlaub!;
        if (aHas) return -1;
        if (bHas) return 1;
        return a.name.localeCompare(b.name, 'de');
      }),
    [urlaubMaEligible],
  );

  const urlaubMaAusgeblendet = useMemo(
    () => urlaubMaEligible
      .filter((m) => m.urlaubsplanungAusgeblendet === true)
      .sort((a, b) => a.name.localeCompare(b.name, 'de')),
    [urlaubMaEligible],
  );

  async function urlaubMaAusblenden(maId: string) {
    await aktualisiereMitarbeiter(maId, { urlaubsplanungAusgeblendet: true });
  }
  async function urlaubMaEinblenden(maId: string) {
    await aktualisiereMitarbeiter(maId, { urlaubsplanungAusgeblendet: false });
  }

  async function verschiebeUrlaub(maId: string, richtung: -1 | 1) {
    const idx = urlaubMa.findIndex((m) => m.id === maId);
    if (idx < 0) return;
    const ziel = idx + richtung;
    if (ziel < 0 || ziel >= urlaubMa.length) return;
    const neu = [...urlaubMa];
    [neu[idx], neu[ziel]] = [neu[ziel], neu[idx]];
    await Promise.all(
      neu.map((m, i) =>
        m.sortierungUrlaub === i
          ? Promise.resolve()
          : aktualisiereMitarbeiter(m.id, { sortierungUrlaub: i }),
      ),
    );
  }

  // Touren — getrennt in sichtbare und ausgeblendete, damit der Admin
  // ausgeblendete Touren via Dropdown wieder einblenden kann.
  const aktiveTouren = useMemo(
    () => [...touren]
      .filter((t) => !t.fahrerplanungAusgeblendet)
      .sort((a, b) => a.name.localeCompare(b.name, 'de')),
    [touren],
  );
  const tourenAusgeblendet = useMemo(
    () => [...touren]
      .filter((t) => t.fahrerplanungAusgeblendet === true)
      .sort((a, b) => a.name.localeCompare(b.name, 'de')),
    [touren],
  );
  async function tourAusblenden(tourId: string) {
    await aktualisiereTour(tourId, { fahrerplanungAusgeblendet: true });
  }
  async function tourEinblenden(tourId: string) {
    await aktualisiereTour(tourId, { fahrerplanungAusgeblendet: false });
  }

  const teilgebietById = useMemo(() => {
    const m = new Map<string, Teilgebiet>();
    for (const t of teilgebiete) m.set(t.id, t);
    return m;
  }, [teilgebiete]);

  const mitarbeiterById = useMemo(() => {
    const m = new Map<string, Mitarbeiter>();
    for (const mi of mitarbeiter) m.set(mi.id, mi);
    return m;
  }, [mitarbeiter]);

  // ---- Ausfälle pro KW gruppieren — eine Zelle kann mehrere TGs enthalten.
  // Wir indexieren zusätzlich nach (KW, TG), damit eine Zelle gezielt
  // einen Slot je TG rendern kann (auch leere Slots, wenn dieses TG in
  // dieser KW NICHT ausfällt). Dadurch landet ein TG in jeder KW-Spalte
  // auf derselben Höhe — mehrwöchige Ausfälle bilden eine durchgehende
  // Linie statt versetzt zu rutschen.
  // Index pro KW über ALLE Ausfall-/Springer-Einsätze — wird vom
  // AusfallModal genutzt, damit auch TGs aus der Wechsel-Sektion bei
  // der TG-Auswahl korrekt ausgeschlossen werden (kein Doppel-Eintrag).
  const ausfaelleByKw = useMemo(() => {
    const m = new Map<number, Einsatz[]>();
    for (const a of alleAusfallEinsaetze) {
      const arr = m.get(a.kw) ?? [];
      arr.push(a);
      m.set(a.kw, arr);
    }
    return m;
  }, [alleAusfallEinsaetze]);

  /**
   * Greedy-Packung der Ausfall-Gruppen in horizontale Slot-Zeilen.
   *
   * Eine Gruppe = Einsätze mit identischem Tripel
   * `(teilgebietId, ausfallBisJahr ?? null, ausfallBisKw ?? null)`. Pro
   * Gruppe wird ein `[kwVon, kwBis]`-Bereich gebildet (über die
   * tatsächlich vorhandenen Einsätze). Gruppen werden nach `kwVon`
   * sortiert und in den niedrigsten freien Slot gepackt, in dem kein
   * früherer Eintrag im KW-Bereich überlappt.
   *
   * Ergebnis: `slotCount` und `slotKwMap` (Lookup pro `slot-kw` → Einsatz)
   * für direktes O(1)-Rendering.
   */
  const ausfaellePackung = useMemo(() => {
    type Gruppe = {
      key: string;
      teilgebietName: string;
      kwVon: number;
      kwBis: number;
      einsaetze: Einsatz[];
    };
    const gruppenMap = new Map<string, Gruppe>();
    for (const e of ausfaelle) {
      const key = `${e.teilgebietId}|${e.ausfallBisJahr ?? ''}|${e.ausfallBisKw ?? ''}`;
      const g = gruppenMap.get(key) ?? {
        key,
        teilgebietName: teilgebietById.get(e.teilgebietId)?.name ?? '',
        kwVon: e.kw,
        kwBis: e.kw,
        einsaetze: [],
      };
      g.einsaetze.push(e);
      g.kwVon = Math.min(g.kwVon, e.kw);
      g.kwBis = Math.max(g.kwBis, e.kw);
      gruppenMap.set(key, g);
    }
    const gruppen = Array.from(gruppenMap.values()).sort((a, b) => {
      if (a.kwVon !== b.kwVon) return a.kwVon - b.kwVon;
      if (a.kwBis !== b.kwBis) return a.kwBis - b.kwBis;
      return a.teilgebietName.localeCompare(b.teilgebietName, 'de', { numeric: true });
    });

    // slotEnde[i] = letzte belegte KW in Slot i.
    const slotEnde: number[] = [];
    const slotKwMap = new Map<string, Einsatz>();
    for (const g of gruppen) {
      let slot = slotEnde.findIndex((ende) => ende < g.kwVon);
      if (slot === -1) {
        slot = slotEnde.length;
        slotEnde.push(g.kwBis);
      } else {
        slotEnde[slot] = g.kwBis;
      }
      for (const e of g.einsaetze) {
        slotKwMap.set(`${slot}-${e.kw}`, e);
      }
    }
    return { slotCount: slotEnde.length, slotKwMap };
  }, [ausfaelle, teilgebietById]);

  // ---- Ausfall-Modal-State ----
  // teilgebietId === null = Neu-Anlage (User muss TG im Modal wählen).
  const [ausfallModal, setAusfallModal] = useState<{ kw: number; teilgebietId: string | null } | null>(null);

  // ---- Urlaubs-Modal-State ----
  const [urlaubModal, setUrlaubModal] = useState<{ kw: number; mitarbeiterId: string } | null>(null);

  // ---- Wechselplan-Modal-State ----
  const [wechselModal, setWechselModal] = useState<{ teilgebietId: string } | null>(null);

  // ---- Klappzustand der Sektionen ----
  // Drucksaal/Fahrer/Zusammenträger sind standardmäßig eingeklappt — diese
  // werden seltener bearbeitet als Urlaub und Ausfälle.
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    drucksaal: false,
    fahrer: false,
    urlaub: false,
    zusammen: false,
    ausfaelle: true,
    wechsel: true,
  });
  const toggleSection = (key: string) =>
    setOpenSections((s) => ({ ...s, [key]: !s[key] }));

  // ---- Auto-Scroll auf aktuelle KW beim Öffnen / Jahreswechsel ----
  // Wird nur einmal pro Jahr ausgeführt — sobald der User selbst horizontal
  // scrollt, soll die Ansicht nicht zurückspringen. `didScrollRef` dient als
  // Idempotenz-Schutz; bei Jahreswechsel wird er zurückgesetzt.
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const didScrollRef = useRef<number | null>(null);
  useEffect(() => {
    if (didScrollRef.current === jahr) return;
    if (currentKW.jahr !== jahr) {
      didScrollRef.current = jahr;
      return;
    }
    const el = scrollRef.current;
    if (!el) return;
    const idx = kws.indexOf(currentKW.kw);
    if (idx < 0) return;
    // Label-Spalte ist sticky → KW-Spalten beginnen bei x = LABEL_COL_PX.
    // Wir wollen die aktuelle KW direkt rechts neben der Label-Spalte sehen.
    el.scrollLeft = idx * KW_COL_PX;
    didScrollRef.current = jahr;
  }, [jahr, kws, currentKW.jahr, currentKW.kw]);

  // ---- Render ----
  return (
    <div className="p-3 md:p-5 max-w-[1800px] mx-auto">
      {/* Kopfzeile */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-gray-900">
            Drucksaal- und Austrägerplanung
          </h1>
          <p className="text-xs text-gray-500">
            Personalplanung pro Kalenderwoche. Übernahme in die Abrechnung erfolgt manuell je Ausfall.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              // Falls aktuelles Jahr nicht angezeigt → wechseln; die
              // useEffect-Auto-Scroll-Logik springt dann auf die KW.
              // Im selben Jahr: direkt scrollen, ohne State-Update.
              if (jahr !== currentKW.jahr) {
                didScrollRef.current = null;
                setJahr(currentKW.jahr);
              } else {
                const el = scrollRef.current;
                if (el) {
                  const idx = kws.indexOf(currentKW.kw);
                  if (idx >= 0) el.scrollLeft = idx * KW_COL_PX;
                }
              }
            }}
            className="text-xs border border-blue-300 bg-blue-50 hover:bg-blue-100 text-blue-800 rounded-lg px-2.5 py-1 font-medium"
            title={`Zur aktuellen Kalenderwoche (KW ${currentKW.kw}/${currentKW.jahr}) springen`}
          >
            📅 Aktuelle KW
          </button>
          <label className="text-sm text-gray-600">Jahr:</label>
          <select
            value={jahr}
            onChange={(e) => setJahr(Number(e.target.value))}
            className="border border-gray-300 rounded-lg px-2 py-1 text-sm"
          >
            {[currentKW.jahr - 1, currentKW.jahr, currentKW.jahr + 1].map((j) => (
              <option key={j} value={j}>{j}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Legende */}
      <div className="flex flex-wrap gap-2 mb-3 text-xs">
        <span className="px-2 py-0.5 rounded bg-red-100 text-red-700 border border-red-200">
          🔴 unbesetzt
        </span>
        <span className="px-2 py-0.5 rounded bg-green-100 text-green-700 border border-green-200">
          🟢 Springer vorhanden
        </span>
        <span className="px-2 py-0.5 rounded bg-gray-200 text-gray-600 border border-gray-300">
          🔒 in Abrechnung übernommen
        </span>
        <span className="ml-2 pl-2 border-l border-gray-300 text-gray-500">Urlaub:</span>
        <span className="px-2 py-0.5 rounded bg-red-200 text-red-900 border border-red-300">🌴 ganze Woche</span>
        <span className="px-2 py-0.5 rounded bg-yellow-200 text-yellow-900 border border-yellow-300">☀ Tag</span>
        <span className="px-2 py-0.5 rounded bg-orange-200 text-orange-900 border border-orange-300">🏖 mehrtägig</span>
        <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-300">⏳ nicht freigegeben</span>
      </div>

      {/* Gemeinsamer Scroll-Container — sowohl horizontal als auch vertikal,
          damit `position: sticky` für die KW-Kopfzeile (top:0) und die
          Label-Spalte (left:0) im selben Scroll-Kontext greift. */}
      <div
        ref={scrollRef}
        className="bg-white border border-gray-200 rounded-lg shadow-sm overflow-auto"
        style={{ maxHeight: 'calc(100vh - 180px)' }}
      >
        <div style={{ minWidth: LABEL_COL_PX + kws.length * KW_COL_PX }}>
          <KwHeader
            kws={kws}
            jahr={jahr}
            aktuelleKw={currentKW.jahr === jahr ? currentKW.kw : null}
            ausgabeNachKw={ausgabeNachKw}
            periodeNachKw={periodeNachKw}
          />

          {/* Zeile: Ferien (Niedersachsen) + Feiertage (DE + NDS) je KW. */}
          <TaetigkeitRow
            label={
              <span className="flex items-baseline gap-1.5">
                <span className="font-semibold text-gray-700">🏫 Ferien / Feiertage</span>
              </span>
            }
            sublabel="Niedersachsen"
            kws={kws}
            renderCell={(kw) => <FerienFeiertagZelle jahr={jahr} kw={kw} />}
          />

          {/* ---- Drucksaal ---- */}
          <SectionHeader
            title="🖨 Drucksaal"
            isOpen={openSections.drucksaal}
            onToggle={() => toggleSection('drucksaal')}
          />
          {openSections.drucksaal && TAETIGKEITEN.map((t) => (
            <TaetigkeitRow
              key={t}
              label={DRUCKSAAL_TAETIGKEIT_LABELS[t]}
              kws={kws}
              renderCell={(kw) => {
                const entry = drucksaalIdx.get(`${kw}-${t}`);
                return (
                  <MaCommentCell
                    mitarbeiterId={entry?.mitarbeiterId ?? null}
                    kommentar={entry?.kommentar}
                    options={drucksaalMa}
                    showKuerzel
                    onChangeMa={(maId) => setzeDrucksaalPlanung(jahr, kw, t, maId, entry?.kommentar)}
                    onChangeKommentar={(text) => setzeDrucksaalPlanung(jahr, kw, t, entry?.mitarbeiterId ?? null, text)}
                  />
                );
              }}
            />
          ))}

          {/* ---- Fahrer ---- */}
          <SectionHeader
            title="🚚 Fahrer"
            isOpen={openSections.fahrer}
            onToggle={() => toggleSection('fahrer')}
            extra={
              istAdmin && tourenAusgeblendet.length > 0 ? (
                <select
                  value=""
                  onChange={(e) => {
                    const id = e.target.value;
                    if (!id) return;
                    tourEinblenden(id);
                    e.target.value = '';
                  }}
                  className="text-xs border border-gray-300 rounded px-2 py-1"
                  title="Versteckte Touren wieder einblenden"
                >
                  <option value="">+ Tour hinzufügen ({tourenAusgeblendet.length})…</option>
                  {tourenAusgeblendet.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
              ) : undefined
            }
          />
          {openSections.fahrer && aktiveTouren.length === 0 && (
            <div className="px-3 py-2 text-xs text-gray-400 italic">
              {touren.length === 0
                ? 'Keine Touren angelegt.'
                : 'Alle Touren sind ausgeblendet. Über „+ Tour hinzufügen" oben wieder einblenden.'}
            </div>
          )}
          {openSections.fahrer && aktiveTouren.map((tour) => (
            <TaetigkeitRow
              key={tour.id}
              label={tour.name}
              labelColor={tour.farbe}
              kws={kws}
              labelExtra={
                istAdmin ? (
                  <button
                    type="button"
                    onClick={() => tourAusblenden(tour.id)}
                    className="text-[11px] text-gray-300 hover:text-red-500 leading-none px-1"
                    title="Tour aus dieser Sektion ausblenden (bestehende Einträge bleiben erhalten)"
                  >✕</button>
                ) : undefined
              }
              renderCell={(kw) => {
                const entry = fahrerIdx.get(`${kw}-${tour.id}`);
                return (
                  <MaCommentCell
                    mitarbeiterId={entry?.mitarbeiterId ?? null}
                    kommentar={entry?.kommentar}
                    options={fahrerMa}
                    showKuerzel
                    onChangeMa={(maId) => setzeFahrerPlanung(jahr, kw, tour.id, maId, entry?.kommentar)}
                    onChangeKommentar={(text) => setzeFahrerPlanung(jahr, kw, tour.id, entry?.mitarbeiterId ?? null, text)}
                  />
                );
              }}
            />
          ))}

          {/* ---- Urlaub ---- */}
          <SectionHeader
            title="🏖 Urlaub"
            isOpen={openSections.urlaub}
            onToggle={() => toggleSection('urlaub')}
            extra={
              istAdmin && urlaubMaAusgeblendet.length > 0 ? (
                <select
                  value=""
                  onChange={(e) => {
                    const id = e.target.value;
                    if (!id) return;
                    urlaubMaEinblenden(id);
                    e.target.value = '';
                  }}
                  className="text-xs border border-gray-300 rounded px-2 py-1"
                  title="Versteckte MA wieder einblenden"
                >
                  <option value="">+ MA hinzufügen ({urlaubMaAusgeblendet.length})…</option>
                  {urlaubMaAusgeblendet.map((m) => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                </select>
              ) : undefined
            }
          />
          {/* Summary-Row: pro KW die Anzahl Urlaubseinträge (Chips).
              Immer sichtbar — dient als „Übersicht auf einen Blick"
              auch wenn die Sektion eingeklappt ist. KWs ohne Eintrag
              zeigen nichts an. */}
          <TaetigkeitRow
            label={
              <span className="text-[11px] text-gray-500 italic">
                Anzahl Urlaubseinträge je KW
              </span>
            }
            kws={kws}
            renderCell={(kw) => {
              const count = urlaube.filter((u) => u.kw === kw).length;
              if (count === 0) {
                return <div className="text-[10px] text-gray-200 text-center py-1">·</div>;
              }
              return (
                <div className="w-full text-center text-xs font-bold py-1 rounded bg-orange-100 text-orange-800">
                  🏖 {count}
                </div>
              );
            }}
          />
          {openSections.urlaub && urlaubMa.length === 0 && (
            <div className="px-3 py-2 text-xs text-gray-400 italic">
              {urlaubMaEligible.length === 0
                ? 'Keine aktiven MA mit Rolle „Sonstige" gefunden.'
                : 'Alle MA dieser Sektion sind ausgeblendet. Über „+ MA hinzufügen" oben wieder einblenden.'}
            </div>
          )}
          {openSections.urlaub && urlaubMa.map((ma, idx) => (
            <TaetigkeitRow
              key={ma.id}
              label={
                <span className="flex items-baseline gap-1.5">
                  <span className="truncate">{ma.name}</span>
                  <span className="text-[10px] font-mono text-gray-400 shrink-0">{ma.nummer}</span>
                </span>
              }
              kws={kws}
              labelExtra={
                istAdmin ? (
                  // Sortier-Pfeile und Ausblende-Button nur für Admin.
                  // Abrechnung soll die festgelegte Reihenfolge sehen,
                  // aber nicht verändern können.
                  <div className="flex items-center gap-1">
                    <div className="flex flex-col -my-1">
                      <button
                        type="button"
                        onClick={() => verschiebeUrlaub(ma.id, -1)}
                        disabled={idx === 0}
                        className="text-[10px] text-gray-400 hover:text-blue-600 disabled:text-gray-200 leading-none px-1"
                        title="nach oben"
                      >▲</button>
                      <button
                        type="button"
                        onClick={() => verschiebeUrlaub(ma.id, 1)}
                        disabled={idx === urlaubMa.length - 1}
                        className="text-[10px] text-gray-400 hover:text-blue-600 disabled:text-gray-200 leading-none px-1"
                        title="nach unten"
                      >▼</button>
                    </div>
                    <button
                      type="button"
                      onClick={() => urlaubMaAusblenden(ma.id)}
                      className="text-[11px] text-gray-300 hover:text-red-500 leading-none px-1"
                      title="MA aus dieser Sektion ausblenden (bestehende Einträge bleiben erhalten)"
                    >✕</button>
                  </div>
                ) : undefined
              }
              renderCell={(kw) => {
                const entry = urlaubIdx.get(`${kw}-${ma.id}`);
                return (
                  <UrlaubCell
                    entry={entry}
                    istAdmin={istAdmin}
                    // Status wird seit der Anzahl-Werktage-Logik IMMER
                    // automatisch aus Datumsbereich/Werktagen abgeleitet.
                    // Klick öffnet stets das Modal — kein Klick-Cycle,
                    // damit ein versehentliches Doppel-/Mehrfachklicken
                    // den Eintrag nicht löscht.
                    onClickCycle={() => setUrlaubModal({ kw, mitarbeiterId: ma.id })}
                    onOpenModal={() => setUrlaubModal({ kw, mitarbeiterId: ma.id })}
                  />
                );
              }}
            />
          ))}

          {/* ---- Zusammenträger ----
              Untergliedert in „fest eingeplant" (oben, leicht blau) und
              „auf Abruf" (unten, leicht grau). Eine Summary-Zeile oben
              zeigt pro KW die Anzahl fest eingeplanter MAs ohne Abmeldung
              (Status leer oder „kommt"). */}
          <SectionHeader
            title="📦 Zusammenträger"
            isOpen={openSections.zusammen}
            onToggle={() => toggleSection('zusammen')}
          />
          {openSections.zusammen && zusammentraegerMa.length === 0 && (
            <div className="px-3 py-2 text-xs text-gray-400 italic">
              Keine aktiven Zusammenträger.
            </div>
          )}
          {openSections.zusammen && zusammentraegerMa.length > 0 && (
            <>
              {/* Summary-Row: zählt
                  · fest Eingeplante mit Status ∈ {leer, kommt}
                  · PLUS „auf Abruf"-MAs, die explizit „kommt" zugesagt haben.
                  „auf Abruf" ohne Status zählen nicht — sie müssen aktiv
                  zusagen. */}
              <TaetigkeitRow
                label={
                  <span className="flex items-baseline gap-1.5">
                    <span className="font-bold text-gray-800">Σ Zusammenträger</span>
                  </span>
                }
                sublabel="fest + zugesagte / Soll-Zeit-Bedarf"
                kws={kws}
                renderCell={(kw) => {
                  const fest = zusammenFest.reduce((acc, ma) => {
                    const status = zusammenIdx.get(`${kw}-${ma.id}`)?.status;
                    if (status === undefined || status === 'kommt') return acc + 1;
                    return acc;
                  }, 0);
                  const abruf = zusammenAbruf.reduce((acc, ma) => {
                    const status = zusammenIdx.get(`${kw}-${ma.id}`)?.status;
                    if (status === 'kommt') return acc + 1;
                    return acc;
                  }, 0);
                  const count = fest + abruf;
                  const ok = fest >= zusammenFest.length;
                  // Soll-Zeit der Ausgabe (= KW). 0/undefined wenn noch keine
                  // Ausgabe angelegt ist oder kein TG zusammenzutragen ist.
                  const sollH = sollZusammenProKw.get(kw) ?? 0;
                  const proPerson = count > 0 && sollH > 0 ? sollH / count : 0;
                  return (
                    <div
                      className={`w-full text-center text-xs font-bold rounded py-1 leading-tight ${
                        count === 0
                          ? 'text-gray-300'
                          : ok
                          ? 'bg-green-100 text-green-800'
                          : 'bg-blue-50 text-blue-800'
                      }`}
                      title={
                        `fest eingeplant ohne Abmeldung: ${fest}\n` +
                        `auf Abruf, zugesagt: ${abruf}\n` +
                        (sollH > 0
                          ? `Soll-Zeit gesamt: ${formatierStunden(sollH)}\n` +
                            (count > 0
                              ? `pro verfügbarer Person: ${formatierStunden(proPerson)}`
                              : 'keine verfügbare Person')
                          : 'Soll-Zeit: —')
                      }
                    >
                      <div className="text-sm">
                        {count}
                        {abruf > 0 && (
                          <span className="text-[10px] font-normal opacity-70 ml-1">
                            (+{abruf})
                          </span>
                        )}
                      </div>
                      {sollH > 0 && (
                        <div className="text-[10px] font-normal opacity-80">
                          {formatierStunden(sollH)}
                          {proPerson > 0 && (
                            <span className="ml-1 opacity-70">/ {formatierStunden(proPerson)}/MA</span>
                          )}
                        </div>
                      )}
                    </div>
                  );
                }}
              />

              {/* Gruppe 1: fest eingeplant */}
              <ZusammenGruppenKopf
                title="fest eingeplant"
                farbe="bg-blue-50/60 text-blue-900"
                count={zusammenFest.length}
              />
              {zusammenFest.map((ma, idx) => (
                <ZusammenZeile
                  key={ma.id}
                  ma={ma}
                  kws={kws}
                  zusammenIdx={zusammenIdx}
                  jahr={jahr}
                  hintergrund="bg-blue-50/30"
                  labelHintergrund="bg-blue-50"
                  istAdmin={istAdmin}
                  istErsterInGruppe={idx === 0}
                  istLetzterInGruppe={idx === zusammenFest.length - 1}
                  istAufAbruf={false}
                  onVerschieben={(dir) => verschiebeZusammen(ma.id, dir)}
                  onToggleAbruf={() => toggleZusammenAbruf(ma.id, true)}
                />
              ))}

              {/* Gruppe 2: auf Abruf */}
              <ZusammenGruppenKopf
                title="auf Abruf"
                farbe="bg-gray-100 text-gray-700"
                count={zusammenAbruf.length}
              />
              {zusammenAbruf.length === 0 ? (
                <div className="px-3 py-1.5 text-[11px] text-gray-400 italic bg-gray-50">
                  Keine MA auf Abruf.
                </div>
              ) : (
                zusammenAbruf.map((ma, idx) => (
                  <ZusammenZeile
                    key={ma.id}
                    ma={ma}
                    kws={kws}
                    zusammenIdx={zusammenIdx}
                    jahr={jahr}
                    hintergrund="bg-gray-50"
                    labelHintergrund="bg-gray-100"
                    istAdmin={istAdmin}
                    istErsterInGruppe={idx === 0}
                    istLetzterInGruppe={idx === zusammenAbruf.length - 1}
                    istAufAbruf={true}
                    onVerschieben={(dir) => verschiebeZusammen(ma.id, dir)}
                    onToggleAbruf={() => toggleZusammenAbruf(ma.id, false)}
                  />
                ))
              )}
            </>
          )}

          {/* ---- Austräger-Ausfälle ----
              Single-Row mit Multi-TG-Chips pro KW. Klick auf "+" öffnet
              das Modal mit TG-Auswahl; Klick auf einen Chip öffnet das
              Modal für genau dieses TG. */}
          <SectionHeader
            title="⚠ Austräger-Ausfälle / Springer"
            isOpen={openSections.ausfaelle}
            onToggle={() => toggleSection('ausfaelle')}
          />
          {openSections.ausfaelle && (
            <>
              {/* Slot-Zeilen: Greedy gepackt. Eine Zeile = ein
                  „Packstreifen", in dem Gruppen ohne Überlappung
                  nebeneinander liegen. Mehrwöchige Gruppen erstrecken
                  sich automatisch horizontal in einer Linie. */}
              {Array.from({ length: ausfaellePackung.slotCount }, (_, slotIdx) => (
                <TaetigkeitRow
                  key={`ausfall-slot-${slotIdx}`}
                  label={
                    slotIdx === 0 ? (
                      <span className="font-semibold text-gray-800">Ausfälle</span>
                    ) : (
                      <span className="text-[10px] text-gray-300">·</span>
                    )
                  }
                  sublabel={slotIdx === 0 ? `${ausfaelle.length} Eintr.` : undefined}
                  kws={kws}
                  renderCell={(kw) => {
                    const e = ausfaellePackung.slotKwMap.get(`${slotIdx}-${kw}`);
                    if (!e) {
                      return <div className="w-full text-[10px] text-gray-200 text-center py-1">·</div>;
                    }
                    return (
                      <AusfallChip
                        eintrag={e}
                        teilgebietById={teilgebietById}
                        mitarbeiterById={mitarbeiterById}
                        onClick={() => setAusfallModal({ kw, teilgebietId: e.teilgebietId })}
                      />
                    );
                  }}
                />
              ))}
              {/* Eigene Add-Zeile: pro KW eine „+"-Schaltfläche. */}
              <TaetigkeitRow
                label={<span className="text-[11px] text-gray-500 italic">+ Ausfall erfassen</span>}
                kws={kws}
                renderCell={(kw) => {
                  const istGesperrt = gesperrteKws.has(kw);
                  if (istGesperrt) {
                    return (
                      <div
                        className="w-full text-[10px] text-gray-200 text-center py-1"
                        title="Abgeschlossene Periode — keine Änderungen mehr möglich"
                      >
                        🔒
                      </div>
                    );
                  }
                  return (
                    <button
                      type="button"
                      onClick={() => setAusfallModal({ kw, teilgebietId: null })}
                      className="w-full text-[11px] py-0.5 rounded border border-dashed border-gray-200 text-gray-300 hover:border-amber-400 hover:text-amber-600 hover:bg-amber-50 leading-tight"
                      title="Ausfall in dieser KW erfassen"
                    >
                      +
                    </button>
                  );
                }}
              />
            </>
          )}

          {/* ---- Geplante Standard-Austräger-Wechsel ----
              Pro Teilgebiet eine Zeile. Die KW-Zellen zeigen anhand der
              `letzteAusgabe`- und `abAusgabe`-Werte automatisch, wer das
              TG zu welcher Zeit verteilt — und ob es zwischenzeitlich
              unbesetzt ist. */}
          <SectionHeader
            title="🔁 Teilgebiet dauerhaft unbesetzt / Standard-Wechsel"
            isOpen={openSections.wechsel}
            onToggle={() => toggleSection('wechsel')}
          />
          {/* Eigene „Action-Zeile": Dropdown liegt in der sticky linken
              Label-Spalte und bleibt damit beim Scrollen sichtbar. Auch
              im eingeklappten Zustand sichtbar, damit ein TG schnell
              hinzugefügt werden kann ohne die Sektion zu öffnen.
              Sichtbar für Admin und Abrechnung gleichermaßen. */}
          <TaetigkeitRow
            label={
              <select
                value=""
                onChange={(e) => {
                  const id = e.target.value;
                  if (!id) return;
                  setWechselModal({ teilgebietId: id });
                  e.target.value = '';
                }}
                className="w-full text-xs border border-blue-300 bg-blue-50 hover:bg-blue-100 rounded px-1.5 py-1 font-medium text-blue-900"
                title="Teilgebiet für Wechsel-Planung wählen"
              >
                <option value="">+ Teilgebiet wählen…</option>
                {teilgebiete
                  .filter(
                    (t) =>
                      t.isActive &&
                      !t.istAuslagestelle &&
                      // TGs, die ohnehin schon in der Wechsel-Liste
                      // erscheinen (echter Plan oder virtueller Eintrag
                      // wegen Unbesetzt-Status), dürfen nicht zusätzlich
                      // im Dropdown auftauchen — sonst überschreibt die
                      // Auswahl die bestehende Zeile.
                      !effektivePlaene.some((p) => p.teilgebietId === t.id),
                  )
                  .sort((a, b) => a.name.localeCompare(b.name, 'de', { numeric: true }))
                  .map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
              </select>
            }
            kws={kws}
            renderCell={() => (
              <div className="text-[10px] text-gray-200 text-center py-1">·</div>
            )}
          />
          {openSections.wechsel && effektivePlaene.length === 0 && (
            <div className="px-3 py-2 text-xs text-gray-400 italic">
              Keine Wechsel geplant und keine dauerhaft unbesetzten Teilgebiete.
            </div>
          )}
          {/* Wechselpläne (persistiert) UND virtuelle Pläne für
              dauerhaft unbesetzte TGs — ein gemeinsamer Render-Pfad,
              damit Sonderfälle des „unbesetzt"-Typs nicht mehr separat
              gepflegt werden müssen. */}
          {openSections.wechsel &&
            [...effektivePlaene]
              .sort((a, b) => {
                const ta = teilgebietById.get(a.teilgebietId)?.name ?? '';
                const tb = teilgebietById.get(b.teilgebietId)?.name ?? '';
                return ta.localeCompare(tb, 'de', { numeric: true });
              })
              .map((plan) => {
                const tg = teilgebietById.get(plan.teilgebietId);
                if (!tg) return null;
                const istVirtuell = plan.id.startsWith('virtual-');
                return (
                  <TaetigkeitRow
                    key={plan.id}
                    label={
                      istVirtuell ? (
                        <span className="flex items-baseline gap-1.5">
                          <span className="truncate">{tg.name}</span>
                          <span className="text-[10px] text-red-600 shrink-0">unbesetzt</span>
                        </span>
                      ) : (
                        tg.name
                      )
                    }
                    sublabel={
                      plan.neuerAustraegerId
                        ? `→ ${mitarbeiterById.get(plan.neuerAustraegerId)?.name ?? '?'}`
                        : istVirtuell
                        ? 'kein Standardausträger'
                        : 'kein Nachfolger'
                    }
                    kws={kws}
                    labelExtra={
                      darfWechselplanPflegen ? (
                        <span className="flex items-center gap-0.5">
                          <button
                            type="button"
                            onClick={() => setWechselModal({ teilgebietId: plan.teilgebietId })}
                            className="text-[11px] text-gray-300 hover:text-blue-600 leading-none px-1"
                            title="Wechselplan bearbeiten"
                          >✎</button>
                          {!istVirtuell && (
                            <button
                              type="button"
                              onClick={async () => {
                                // G: Confirm-Dialog vor dem Löschen — schützt
                                // vor versehentlichem Klick. Bestehende
                                // manuelle Springer-Einsätze bleiben in
                                // jedem Fall erhalten; ungeklärte Lücken
                                // sowie automatisch vom Wechselplan
                                // erzeugte Springer (L) werden mit gelöscht.
                                const luecken = einsaetze.filter(
                                  (e) =>
                                    e.teilgebietId === plan.teilgebietId &&
                                    e.typ === 'ungeklärt' &&
                                    !e.mitarbeiterId,
                                );
                                const autoSpringer = einsaetze.filter(
                                  (e) =>
                                    e.teilgebietId === plan.teilgebietId &&
                                    e.autoVomWechselplan === true,
                                );
                                const hinweisTeile: string[] = [];
                                if (luecken.length > 0) {
                                  hinweisTeile.push(
                                    `${luecken.length} unbearbeitete Lücken-Einsätze`,
                                  );
                                }
                                if (autoSpringer.length > 0) {
                                  hinweisTeile.push(
                                    `${autoSpringer.length} automatisch angelegte Springer-Einsätze`,
                                  );
                                }
                                const hinweis = hinweisTeile.length > 0
                                  ? `\n\nFolgendes wird mit gelöscht: ${hinweisTeile.join(', ')}. Manuell gepflegte Springer bleiben erhalten.`
                                  : '';
                                if (
                                  !confirm(
                                    `Wechselplan für dieses Teilgebiet wirklich löschen?${hinweis}`,
                                  )
                                ) {
                                  return;
                                }
                                await loescheAustraegerwechselPlan(plan.teilgebietId);
                                for (const e of luecken) {
                                  await loescheEinsatz(e.id);
                                }
                                for (const e of autoSpringer) {
                                  await loescheEinsatz(e.id);
                                }
                              }}
                              className="text-[11px] text-gray-300 hover:text-red-500 leading-none px-1"
                              title="Wechselplan löschen"
                            >✕</button>
                          )}
                        </span>
                      ) : undefined
                    }
                    renderCell={(kw) => (
                      <WechselCell
                        plan={plan}
                        jahr={jahr}
                        kw={kw}
                        einsatz={ausfallIdx.get(`${kw}-${plan.teilgebietId}`)}
                        mitarbeiterById={mitarbeiterById}
                        onClickPlan={() => setWechselModal({ teilgebietId: plan.teilgebietId })}
                        onClickAusfall={() => setAusfallModal({ kw, teilgebietId: plan.teilgebietId })}
                      />
                    )}
                  />
                );
              })}
          {/* Doppelpfad „dauerhaft unbesetzte TGs" entfernt — siehe
              effektivePlaene oben. */}
        </div>
      </div>

      {/* ---- Wechselplan-Modal ---- */}
      {wechselModal && (
        <WechselModal
          teilgebietId={wechselModal.teilgebietId}
          tg={teilgebietById.get(wechselModal.teilgebietId)!}
          existing={wechselplan.find((w) => w.teilgebietId === wechselModal.teilgebietId)}
          einsaetzeImJahr={einsaetze}
          parameter={parameter}
          austraegerMa={austraegerMa}
          mitarbeiterById={mitarbeiterById}
          maxKwImJahr={kws[kws.length - 1]}
          jahr={jahr}
          abrechnungsperioden={abrechnungsperioden}
          onClose={() => setWechselModal(null)}
        />
      )}

      {/* ---- Urlaubs-Detail-Modal ---- */}
      {urlaubModal && (
        <UrlaubModal
          jahr={jahr}
          kw={urlaubModal.kw}
          mitarbeiterId={urlaubModal.mitarbeiterId}
          ma={mitarbeiterById.get(urlaubModal.mitarbeiterId)!}
          existing={urlaubIdx.get(`${urlaubModal.kw}-${urlaubModal.mitarbeiterId}`)}
          istAdmin={istAdmin}
          adminName={adminName || 'Unbekannt'}
          onClose={() => setUrlaubModal(null)}
        />
      )}

      {/* ---- Ausfall-Detail-Modal ---- */}
      {ausfallModal && (
        <AusfallModal
          jahr={jahr}
          kw={ausfallModal.kw}
          teilgebietId={ausfallModal.teilgebietId}
          teilgebiete={teilgebiete}
          teilgebietById={teilgebietById}
          existing={
            ausfallModal.teilgebietId
              ? ausfallIdx.get(`${ausfallModal.kw}-${ausfallModal.teilgebietId}`)
              : undefined
          }
          ausfaelleInKw={ausfaelleByKw.get(ausfallModal.kw) ?? []}
          einsaetzeImJahr={alleAusfallEinsaetze}
          austraegerMa={austraegerMa}
          mitarbeiterById={mitarbeiterById}
          maxKwImJahr={kws[kws.length - 1]}
          parameter={parameter}
          istGesperrt={gesperrteKws.has(ausfallModal.kw)}
          /* Wenn die KW zu einem TG der Wechsel-Sektion gehört, blenden
             wir das Modal als „Springer-Übernahme" an — die Texte
             sprechen dann nicht von Ausfall, sondern von Springer-Vertretung. */
          istWechselKontext={ausfallModal.teilgebietId ? wechselTgIds.has(ausfallModal.teilgebietId) : false}
          onClose={() => setAusfallModal(null)}
        />
      )}
    </div>
  );
}

// ============================================================
// Sub-Komponenten
// ============================================================

function KwHeader({
  kws,
  jahr,
  aktuelleKw,
  ausgabeNachKw,
  periodeNachKw,
}: {
  kws: number[];
  jahr: number;
  aktuelleKw: number | null;
  ausgabeNachKw: Map<number, Ausgabe>;
  periodeNachKw: Map<number, { id: string; bezeichnung: string; monat: number; abgeschlossen: boolean }>;
}) {
  // Alternierende Periode-Hintergründe — durch zwei Töne sortiert nach
  // dem Auftreten der Perioden im Jahr. Erkennen welche KW die letzte
  // ihrer Periode ist (für dicken rechten Rand als Trennstrich).
  const periodIndexById = useMemo(() => {
    const m = new Map<string, number>();
    const seen = new Set<string>();
    let idx = 0;
    for (const kw of kws) {
      const p = periodeNachKw.get(kw);
      if (!p) continue;
      if (seen.has(p.id)) continue;
      seen.add(p.id);
      m.set(p.id, idx++);
    }
    return m;
  }, [kws, periodeNachKw]);

  const istLetzteKwDerPeriode = (kw: number): boolean => {
    const p = periodeNachKw.get(kw);
    if (!p) return false;
    const next = periodeNachKw.get(kw + 1);
    return !next || next.id !== p.id;
  };

  return (
    <div className="flex sticky top-0 z-20 bg-white border-b-2 border-gray-300">
      <div
        className="sticky left-0 z-30 bg-white border-r-2 border-gray-300 px-3 py-2 text-xs font-semibold text-gray-500"
        style={{ width: LABEL_COL_PX, minWidth: LABEL_COL_PX }}
      >
        KW / {jahr}
      </div>
      {kws.map((kw) => {
        const hatAusgabe = ausgabeNachKw.has(kw);
        const isHeute = kw === aktuelleKw;
        const d = donnerstagDerKW(kw, jahr);
        const periode = periodeNachKw.get(kw);
        const istLetzte = istLetzteKwDerPeriode(kw);
        const prev = periodeNachKw.get(kw - 1);
        const istErsteDerPeriode = periode && (!prev || prev.id !== periode.id);

        // Hintergrund: aktuelle KW > Sperre > alternierend pro Periode.
        let bgCls = '';
        if (isHeute) {
          bgCls = 'bg-blue-50 font-bold text-blue-700';
        } else if (periode) {
          const idx = periodIndexById.get(periode.id) ?? 0;
          // Abgeschlossene Periode → dezenter grauer Hintergrund.
          if (periode.abgeschlossen) {
            bgCls = 'bg-gray-100 text-gray-500';
          } else {
            bgCls = idx % 2 === 0 ? 'bg-indigo-50/60' : 'bg-amber-50/60';
          }
        }

        // Trennstrich rechts: dick bei letzter KW einer Periode, sonst dünn.
        const borderCls = istLetzte
          ? 'border-r-2 border-r-gray-400'
          : 'border-r border-gray-200';

        return (
          <div
            key={kw}
            className={`px-1 py-2 text-center text-xs ${bgCls} ${borderCls}`}
            style={{ width: KW_COL_PX, minWidth: KW_COL_PX }}
            title={
              `KW ${kw} — Do ${d.toLocaleDateString('de-DE')}` +
              (periode ? `\nPeriode: ${periode.bezeichnung}${periode.abgeschlossen ? ' (abgeschlossen)' : ''}` : '')
            }
          >
            {istErsteDerPeriode && (
              <div className="text-[9px] uppercase tracking-wide text-gray-500 font-semibold truncate">
                {periode!.bezeichnung.split(' ')[0] /* Monatsname */}
              </div>
            )}
            <div className="font-semibold">KW {kw}</div>
            <div className={`text-[10px] ${hatAusgabe ? 'text-green-700' : 'text-gray-400'}`}>
              {d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function SectionHeader({
  title,
  extra,
  isOpen,
  onToggle,
}: {
  title: string;
  extra?: React.ReactNode;
  isOpen?: boolean;
  onToggle?: () => void;
}) {
  const klappbar = onToggle !== undefined;
  // Zwei-Ebenen-Sticky:
  //   Außen — voller Balken (Breite 100% des Tabellen-Containers), sticky TOP
  //           direkt unter der KW-Kopfzeile. Liefert die graue Hintergrund-
  //           leiste und das vertikale Sticky-Verhalten.
  //   Innen — Title + Klapp-Button + Extra-Slot, sticky LEFT 0. Bleibt beim
  //           horizontalen Scrollen am linken Bildschirmrand sichtbar.
  return (
    <div
      className="bg-gradient-to-r from-gray-100 to-gray-50 border-y border-gray-300 sticky z-10"
      style={{ top: SECTION_STICKY_TOP_PX, width: '100%' }}
    >
      <div
        className="inline-flex items-center px-3 py-1.5 sticky"
        style={{ left: 0 }}
      >
        {klappbar ? (
          <button
            type="button"
            onClick={onToggle}
            className="flex items-center gap-1.5 text-sm font-bold text-gray-700 hover:text-blue-700"
            title={isOpen ? 'Sektion einklappen' : 'Sektion ausklappen'}
          >
            <span className="inline-block w-4 text-center text-xs">
              {isOpen ? '▼' : '▶'}
            </span>
            {title}
          </button>
        ) : (
          <h3 className="text-sm font-bold text-gray-700">{title}</h3>
        )}
        {extra && <div className="ml-3">{extra}</div>}
      </div>
    </div>
  );
}

function TaetigkeitRow({
  label,
  sublabel,
  labelColor,
  labelExtra,
  kws,
  renderCell,
}: {
  label: React.ReactNode;
  sublabel?: string;
  labelColor?: string;
  labelExtra?: React.ReactNode;
  kws: number[];
  renderCell: (kw: number) => React.ReactNode;
}) {
  return (
    <div className="flex border-b border-gray-100 hover:bg-gray-50/30">
      <div
        className="sticky left-0 z-10 bg-white border-r-2 border-gray-300 px-3 py-1.5 flex items-center gap-2"
        style={{ width: LABEL_COL_PX, minWidth: LABEL_COL_PX }}
      >
        {labelColor && (
          <span
            className="inline-block w-3 h-3 rounded-full shrink-0"
            style={{ backgroundColor: labelColor }}
          />
        )}
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-gray-800 truncate">{label}</div>
          {sublabel && (
            <div className="text-[10px] text-gray-500 truncate" title={sublabel}>{sublabel}</div>
          )}
        </div>
        {labelExtra && <div className="shrink-0">{labelExtra}</div>}
      </div>
      {kws.map((kw) => (
        <div
          key={kw}
          className="border-r border-gray-100 p-0.5"
          style={{ width: KW_COL_PX, minWidth: KW_COL_PX }}
        >
          {renderCell(kw)}
        </div>
      ))}
    </div>
  );
}

/**
 * Drucksaal-/Fahrer-Zelle: MA-Dropdown + Rechtsklick-Popup für Kommentar.
 * Wenn ein Kommentar existiert, zeigt sich ein kleiner 💬-Indikator und
 * der Tooltip enthält den Text. Der MA bleibt frei wählbar — auch bei
 * gesetztem Kommentar.
 */
function MaCommentCell({
  mitarbeiterId,
  kommentar,
  options,
  showKuerzel,
  onChangeMa,
  onChangeKommentar,
}: {
  mitarbeiterId: string | null;
  kommentar: string | undefined;
  options: Mitarbeiter[];
  showKuerzel?: boolean;
  onChangeMa: (id: string | null) => void;
  onChangeKommentar: (text: string) => void;
}) {
  const [showPopup, setShowPopup] = useState(false);
  const hatKommentar = !!kommentar?.trim();

  return (
    <div
      className="relative"
      onContextMenu={(e) => { e.preventDefault(); setShowPopup((v) => !v); }}
      title={hatKommentar ? `💬 ${kommentar}\n\n(Rechtsklick für Kommentar)` : 'Rechtsklick für Kommentar'}
    >
      <MaSelect
        value={mitarbeiterId}
        options={options}
        onChange={onChangeMa}
        showKuerzel={showKuerzel}
      />
      {hatKommentar && (
        <span className="absolute -top-1 -right-1 text-[10px] pointer-events-none" title={kommentar}>
          💬
        </span>
      )}
      {showPopup && (
        <div className="absolute top-full left-0 z-30 mt-1 w-48 bg-white border border-gray-300 rounded shadow-lg p-2">
          <textarea
            defaultValue={kommentar ?? ''}
            onBlur={(e) => { onChangeKommentar(e.target.value); setShowPopup(false); }}
            placeholder="Kommentar zur Zelle…"
            className="w-full text-xs border border-gray-200 rounded px-1 py-0.5"
            rows={2}
            autoFocus
          />
          <div className="flex justify-between mt-1">
            <button
              type="button"
              // onMouseDown feuert VOR onBlur des Textfelds und
              // preventDefault verhindert den Fokuswechsel — sonst würde
              // das Blur-Save den gerade eingegebenen Text persistieren,
              // bevor der Löschen-Click überhaupt ausgeführt wird.
              onMouseDown={(e) => {
                e.preventDefault();
                onChangeKommentar('');
                setShowPopup(false);
              }}
              className="text-[10px] text-red-500 hover:text-red-700"
            >
              Löschen
            </button>
            <button
              type="button"
              onClick={() => setShowPopup(false)}
              className="text-[10px] text-gray-500 hover:text-gray-700"
            >
              Schließen
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function MaSelect({
  value,
  options,
  onChange,
  disabled,
  showKuerzel,
}: {
  value: string | null;
  options: Mitarbeiter[];
  onChange: (id: string | null) => void;
  disabled?: boolean;
  /**
   * Wenn true, wird statt des MA-Namens das `kuerzel` als Label der
   * Optionen verwendet — sofern gesetzt. Fallback bleibt der Name.
   * Wird in der Drucksaal-Sektion gesetzt, damit die schmalen
   * Chip-Zellen kompakt bleiben.
   */
  showKuerzel?: boolean;
}) {
  const label = (m: Mitarbeiter) =>
    showKuerzel && m.kuerzel ? m.kuerzel : m.name;
  return (
    <select
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value || null)}
      disabled={disabled}
      className={`w-full text-xs px-1 py-1 rounded border ${
        value ? 'bg-blue-50 border-blue-200 text-blue-900' : 'bg-white border-gray-200 text-gray-400'
      } ${disabled ? 'opacity-60 cursor-not-allowed' : ''} ${showKuerzel ? 'font-mono tracking-wide text-center' : ''}`}
    >
      <option value="">—</option>
      {options.map((m) => (
        <option key={m.id} value={m.id}>{label(m)}</option>
      ))}
    </select>
  );
}

// ============================================================
// Zusammenträger: Gruppen-Kopf + Zeile
// ============================================================

function ZusammenGruppenKopf({
  title,
  farbe,
  count,
}: {
  title: string;
  farbe: string;
  count: number;
}) {
  return (
    <div
      className={`flex items-center px-3 py-1 text-[11px] font-semibold uppercase tracking-wide border-b border-gray-200 ${farbe} sticky`}
      style={{ left: 0 }}
    >
      <span>{title}</span>
      <span className="ml-2 opacity-70">({count})</span>
    </div>
  );
}

function ZusammenZeile({
  ma,
  kws,
  zusammenIdx,
  jahr,
  hintergrund,
  labelHintergrund,
  istAdmin,
  istErsterInGruppe,
  istLetzterInGruppe,
  istAufAbruf,
  onVerschieben,
  onToggleAbruf,
}: {
  ma: Mitarbeiter;
  kws: number[];
  zusammenIdx: Map<string, ZusammentragerPlanung>;
  jahr: number;
  /** Tönung der KW-Zellen (darf transparent sein). */
  hintergrund: string;
  /**
   * Tönung der sticky Label-Spalte — MUSS opak sein, sonst scheinen
   * beim horizontalen Scrollen die Chips hindurch.
   */
  labelHintergrund: string;
  istAdmin: boolean;
  istErsterInGruppe: boolean;
  istLetzterInGruppe: boolean;
  istAufAbruf: boolean;
  onVerschieben: (richtung: -1 | 1) => void;
  onToggleAbruf: () => void;
}) {
  return (
    <div className={`flex border-b border-gray-100 ${hintergrund}`}>
      <div
        className={`sticky left-0 z-10 border-r-2 border-gray-300 px-3 py-1.5 flex items-center gap-2 ${labelHintergrund}`}
        style={{ width: LABEL_COL_PX, minWidth: LABEL_COL_PX }}
      >
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-gray-800 truncate">
            <span className="flex items-baseline gap-1.5">
              <span className="truncate">{ma.name}</span>
              <span className="text-[10px] font-mono text-gray-400 shrink-0">{ma.nummer}</span>
            </span>
          </div>
        </div>
        {istAdmin && (
          <div className="shrink-0 flex items-center gap-1">
            <div className="flex flex-col -my-1">
              <button
                type="button"
                onClick={() => onVerschieben(-1)}
                disabled={istErsterInGruppe}
                className="text-[10px] text-gray-400 hover:text-blue-600 disabled:text-gray-200 leading-none px-1"
                title="nach oben (innerhalb Gruppe)"
              >▲</button>
              <button
                type="button"
                onClick={() => onVerschieben(1)}
                disabled={istLetzterInGruppe}
                className="text-[10px] text-gray-400 hover:text-blue-600 disabled:text-gray-200 leading-none px-1"
                title="nach unten (innerhalb Gruppe)"
              >▼</button>
            </div>
            <button
              type="button"
              onClick={onToggleAbruf}
              className="text-[11px] text-gray-400 hover:text-blue-600 leading-none px-1"
              title={istAufAbruf ? 'In „fest eingeplant" verschieben' : 'In „auf Abruf" verschieben'}
            >
              {istAufAbruf ? '↑' : '↓'}
            </button>
          </div>
        )}
      </div>
      {kws.map((kw) => {
        const entry = zusammenIdx.get(`${kw}-${ma.id}`);
        return (
          <div
            key={kw}
            className="border-r border-gray-100 p-0.5"
            style={{ width: KW_COL_PX, minWidth: KW_COL_PX }}
          >
            <ZusammenCell
              entry={entry}
              onChange={(status, kommentar, externerLink) =>
                setzeZusammentragerPlanung(jahr, kw, ma.id, status, kommentar, externerLink)
              }
            />
          </div>
        );
      })}
    </div>
  );
}

function ZusammenCell({
  entry,
  onChange,
}: {
  entry: ZusammentragerPlanung | undefined;
  onChange: (
    status: ZusammentragerStatus | null,
    kommentar?: string,
    externerLink?: string,
  ) => void;
}) {
  const [showPopover, setShowPopover] = useState(false);
  // Lokaler Bearbeitungsstand für Kommentar + Link. Wird beim Öffnen
  // aus `entry` initialisiert; gespeichert wird erst beim Klick auf
  // „Speichern" oder beim Verlassen (Blur außerhalb des Popovers).
  const [kommentarDraft, setKommentarDraft] = useState(entry?.kommentar ?? '');
  const [linkDraft, setLinkDraft] = useState(entry?.externerLink ?? '');
  const status = entry?.status;

  // Klick-Cycle: leer → kommt → kommt-ggf → kommt-nicht → unabgemeldet nicht erschienen → leer
  const next: Record<string, ZusammentragerStatus | null> = {
    '': 'kommt',
    'kommt': 'kommt-ggf',
    'kommt-ggf': 'kommt-nicht',
    'kommt-nicht': 'unabgemeldet-nicht-erschienen',
    'unabgemeldet-nicht-erschienen': null,
  };

  const bg = !status
    ? 'bg-white border-gray-200 text-gray-400'
    : status === 'kommt'
    ? 'bg-green-100 border-green-300 text-green-800'
    : status === 'kommt-ggf'
    ? 'bg-yellow-100 border-yellow-300 text-yellow-800'
    : status === 'kommt-nicht'
    ? 'bg-red-100 border-red-300 text-red-800'
    : 'bg-red-600 border-red-800 text-white';

  const symbol = !status
    ? '—'
    : status === 'kommt'
    ? '✓'
    : status === 'kommt-ggf'
    ? '?'
    : status === 'kommt-nicht'
    ? '✕'
    : '!';

  const hatLink = !!entry?.externerLink?.trim();
  const hatKommentar = !!entry?.kommentar?.trim();

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => onChange(next[status ?? ''], entry?.kommentar, entry?.externerLink)}
        onContextMenu={(e) => {
          e.preventDefault();
          if (!showPopover) {
            // Beim Öffnen die Draft-States aus dem letzten gespeicherten
            // Stand frisch laden — sonst hängt evtl. ein alter Wert.
            setKommentarDraft(entry?.kommentar ?? '');
            setLinkDraft(entry?.externerLink ?? '');
          }
          setShowPopover((v) => !v);
        }}
        title={`${status ? ZUSAMMENTRAGER_STATUS_LABELS[status] : 'leer'} · Rechtsklick für Kommentar / Link${entry?.kommentar ? `\n💬 ${entry.kommentar}` : ''}${entry?.externerLink ? `\n🔗 ${entry.externerLink}` : ''}`}
        className={`w-full text-xs font-bold py-1 rounded border ${bg}`}
      >
        {symbol}
        {hatKommentar && <span className="ml-1 text-[10px]">💬</span>}
        {hatLink && <span className="ml-0.5 text-[10px]">🔗</span>}
      </button>
      {showPopover && (
        <div className="absolute top-full left-0 z-30 mt-1 w-56 bg-white border border-gray-300 rounded shadow-lg p-2 space-y-1.5">
          <div>
            <label className="block text-[10px] font-medium text-gray-500 mb-0.5">Kommentar</label>
            <textarea
              value={kommentarDraft}
              onChange={(e) => setKommentarDraft(e.target.value)}
              placeholder="Kommentar…"
              className="w-full text-xs border border-gray-200 rounded px-1 py-0.5"
              rows={2}
              autoFocus
            />
          </div>
          <div>
            <label className="block text-[10px] font-medium text-gray-500 mb-0.5">Externer Link</label>
            <div className="flex items-center gap-1">
              <input
                type="url"
                value={linkDraft}
                onChange={(e) => setLinkDraft(e.target.value)}
                placeholder="https://…"
                className="flex-1 text-xs border border-gray-200 rounded px-1 py-0.5"
              />
              {linkDraft.trim() && (
                <a
                  href={linkDraft.trim()}
                  target="_blank"
                  rel="noreferrer"
                  className="shrink-0 text-[10px] border border-blue-200 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded px-1.5 py-0.5"
                  title="Link in neuem Tab öffnen"
                >
                  🔗
                </a>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1.5 pt-1">
            <button
              type="button"
              onClick={() => {
                onChange(status ?? null, kommentarDraft, linkDraft);
                setShowPopover(false);
              }}
              className="text-[10px] bg-blue-600 hover:bg-blue-700 text-white rounded px-2 py-0.5"
            >
              Speichern
            </button>
            <button
              type="button"
              onClick={() => setShowPopover(false)}
              className="text-[10px] text-gray-500 hover:text-gray-700"
            >
              Abbrechen
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// Urlaubs-Zelle + Modal
// ============================================================

function UrlaubCell({
  entry,
  istAdmin,
  onClickCycle,
  onOpenModal,
}: {
  entry: UrlaubsEintrag | undefined;
  istAdmin: boolean;
  onClickCycle: () => void;
  onOpenModal: () => void;
}) {
  if (!entry) {
    return (
      <button
        type="button"
        onClick={onClickCycle}
        onContextMenu={(e) => { e.preventDefault(); onOpenModal(); }}
        className="w-full text-xs py-1 rounded border border-dashed border-gray-200 text-gray-300 hover:border-amber-400 hover:text-amber-600 hover:bg-amber-50"
        title="Klick: Status setzen — Rechtsklick: Details"
      >
        —
      </button>
    );
  }

  const offen = !entry.freigegeben;
  const bg = entry.status === 'ganze-woche'
    ? 'bg-red-200 border-red-400 text-red-900'
    : entry.status === 'einzeltag'
    ? 'bg-yellow-200 border-yellow-400 text-yellow-900'
    : 'bg-orange-200 border-orange-400 text-orange-900';

  const symbol = entry.status === 'ganze-woche' ? '🌴' : entry.status === 'einzeltag' ? '☀' : '🏖';

  // Konkrete Werktage dieser KW (Fallback aus von/bis, falls Altdaten ohne
  // werktageInKw-Feld). Daraus wird die Chip-Anzeige und der Tooltip gebaut.
  const werktageIso = useMemo(() => {
    if (entry.werktageInKw && entry.werktageInKw.length > 0) {
      return [...entry.werktageInKw].sort();
    }
    // Fallback für Altdaten: aus datumVon/Bis die Werktage in dieser KW
    // herausfiltern. Wir suchen einfach alle Datums-Werte, die im KW-
    // Range des Eintrags liegen.
    if (!entry.datumVon || !entry.datumBis) return [];
    const v = new Date(entry.datumVon);
    const b = new Date(entry.datumBis);
    if (isNaN(+v) || isNaN(+b) || b < v) return [];
    const out: string[] = [];
    const c = new Date(v);
    while (c <= b) {
      const dow = c.getDay();
      if (dow >= 1 && dow <= 5 && getISOYear(c) === entry.jahr && getISOWeek(c) === entry.kw) {
        out.push(isoFromDate(c));
      }
      c.setDate(c.getDate() + 1);
    }
    return out;
  }, [entry]);

  const WOCHENTAG_KURZ = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
  const wochentagKuerzel = werktageIso.map((iso) => WOCHENTAG_KURZ[new Date(iso).getDay()]);

  // Chip-Beschriftung: rechts vom Emoji.
  //   ganze-woche: „5" (5 Werktage)
  //   einzeltag:   „Mi"  (einziger Wochentag)
  //   mehrtaegig:  bei ≤3 Tagen Wochentage „Mo·Mi·Fr", sonst „3" Anzahl.
  let chipLabel = '';
  if (entry.status === 'ganze-woche') {
    chipLabel = String(werktageIso.length || 5);
  } else if (entry.status === 'einzeltag') {
    chipLabel = wochentagKuerzel[0] ?? '1';
  } else {
    // mehrtaegig
    chipLabel =
      werktageIso.length <= 3 && werktageIso.length > 0
        ? wochentagKuerzel.join('·')
        : String(werktageIso.length || '');
  }

  // Tooltip — alle Werktage mit vollem Datum, plus Meta-Infos.
  const tooltipTage = werktageIso
    .map((iso) =>
      new Date(iso).toLocaleDateString('de-DE', {
        weekday: 'short',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      }),
    )
    .join(', ');
  const titleParts = [
    `${URLAUB_STATUS_LABELS[entry.status]} (${werktageIso.length} Werktag${werktageIso.length === 1 ? '' : 'e'})`,
    tooltipTage,
    entry.datumVon && entry.datumBis && entry.datumVon !== werktageIso[0]
      ? `Zeitraum: ${entry.datumVon} – ${entry.datumBis}`
      : '',
    entry.kommentar ? `💬 ${entry.kommentar}` : '',
    offen
      ? `⏳ Noch nicht freigegeben (erfasst von ${entry.erstellerName})`
      : `✓ Freigegeben${entry.freigegebenVon ? ` von ${entry.freigegebenVon}` : ''}`,
  ].filter(Boolean);

  return (
    <button
      type="button"
      onClick={onClickCycle}
      onContextMenu={(e) => { e.preventDefault(); onOpenModal(); }}
      className={`w-full text-xs font-medium py-1 px-1 rounded border ${bg} ${offen ? 'ring-2 ring-amber-400 ring-inset' : ''} relative leading-tight`}
      title={titleParts.join('\n')}
    >
      <span>{symbol}</span>
      {chipLabel && <span className="ml-0.5 font-semibold">{chipLabel}</span>}
      {offen && <span className="absolute -top-1 -right-1 text-[10px]" title="nicht freigegeben">⏳</span>}
      {entry.kommentar && <span className="ml-0.5 text-[10px]">💬</span>}
      {!istAdmin && entry.freigegeben && <span className="ml-0.5 text-[10px]" title="Nur Admin kann ändern">🔒</span>}
    </button>
  );
}

function UrlaubModal({
  jahr,
  kw,
  mitarbeiterId,
  ma,
  existing,
  istAdmin,
  adminName,
  onClose,
}: {
  jahr: number;
  kw: number;
  mitarbeiterId: string;
  ma: Mitarbeiter;
  existing: UrlaubsEintrag | undefined;
  istAdmin: boolean;
  adminName: string;
  onClose: () => void;
}) {
  // Berechtigung: Abrechnung darf einen bestehenden Eintrag ändern,
  // solange er noch nicht freigegeben ist. Sobald ein Admin freigegeben
  // hat, sperrt sich das Hauptformular für Abrechnung — der Kommentar
  // bleibt jedoch in jedem Fall editierbar.
  const readOnlyMain = !!existing && !istAdmin && existing.freigegeben;

  // Bei Neu-Anlage: Montag der KW als Default für „Datum von".
  // Bestehende Einträge behalten ihren gespeicherten Wert.
  const montagIso = useMemo(() => {
    const d = donnerstagDerKW(kw, jahr);
    const m = new Date(d.getTime() - 3 * 86400000);
    const yyyy = m.getUTCFullYear();
    const mm = String(m.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(m.getUTCDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }, [jahr, kw]);
  const [datumVon, setDatumVon] = useState(existing?.datumVon ?? (existing ? '' : montagIso));
  const [datumBis, setDatumBis] = useState(existing?.datumBis ?? '');
  const [kommentar, setKommentar] = useState(existing?.kommentar ?? '');
  const [externerLink, setExternerLink] = useState(existing?.externerLink ?? '');
  // Zusatz-Werktage (z. B. Mo + Mi + Fr in derselben KW) — Liste von ISO-Daten.
  // Werden aus dem `werktageInKw`-Feld des bestehenden Eintrags ableitet,
  // sofern dort Tage stehen, die NICHT im von/bis-Bereich liegen.
  const initialZusatz: string[] = useMemo(() => {
    if (!existing?.werktageInKw || existing.werktageInKw.length === 0) return [];
    if (!existing.datumVon || !existing.datumBis) return [...existing.werktageInKw];
    const im = new Set<string>();
    const v = new Date(existing.datumVon);
    const b = new Date(existing.datumBis);
    if (!isNaN(+v) && !isNaN(+b) && b >= v) {
      const c = new Date(v);
      while (c <= b) { im.add(isoFromDate(c)); c.setDate(c.getDate() + 1); }
    }
    return existing.werktageInKw.filter((d) => !im.has(d));
  }, [existing]);
  const [zusatzWerktage, setZusatzWerktage] = useState<string[]>(initialZusatz);
  const [neuerZusatzTag, setNeuerZusatzTag] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function speichern() {
    setSaving(true);
    setError(null);
    try {
      // Gruppen-Pfad: aus (datumVon, datumBis) PLUS Zusatz-Werktagen
      // werden alle betroffenen Werktage pro KW aggregiert. Status je
      // KW = 5/2-4/1 Werktage → ganze-woche / mehrtägig / einzeltag.
      const wochen = urlaubWochenAusBereich(datumVon, datumBis, zusatzWerktage);
      if (wochen.length === 0) {
        setError('Bitte mindestens einen Werktag (Mo–Fr) angeben — entweder als Bereich oder als Einzeltag.');
        setSaving(false);
        return;
      }
      // Effektive von/bis-Daten für die Gruppen-Verklammerung: min/max
      // über ALLE Werktage. So bleibt eine Gruppe identifizierbar auch
      // wenn der User nachträglich Zusatztage hinzufügt.
      const alleTage = wochen.flatMap((w) => w.werktageInKw).sort();
      const effDatumVon = datumVon || alleTage[0] || '';
      const effDatumBis = datumBis || alleTage[alleTage.length - 1] || '';
      await setzeUrlaubsGruppe(mitarbeiterId, wochen, {
        datumVon: effDatumVon,
        datumBis: effDatumBis,
        kommentar: kommentar.trim() || undefined,
        externerLink: externerLink.trim() || undefined,
        erstellerName: adminName,
        erstellerRolle: istAdmin ? 'admin' : 'abrechnung',
        altDatumVon: existing?.datumVon,
        altDatumBis: existing?.datumBis,
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Speichern fehlgeschlagen.');
    } finally {
      setSaving(false);
    }
  }

  async function loeschen() {
    if (!existing) return;
    const istGruppe = !!existing.datumVon && !!existing.datumBis;
    const frage = istGruppe
      ? `Urlaub vom ${existing.datumVon} bis ${existing.datumBis} (Gruppe) wirklich löschen?`
      : `Urlaubseintrag in KW ${kw} wirklich löschen?`;
    if (!confirm(frage)) return;
    setSaving(true);
    try {
      if (istGruppe && existing.datumVon && existing.datumBis) {
        await loescheUrlaubsGruppe(mitarbeiterId, existing.datumVon, existing.datumBis);
      } else {
        await loescheUrlaub(jahr, kw, mitarbeiterId);
      }
      onClose();
    } finally {
      setSaving(false);
    }
  }

  async function freigeben() {
    if (!existing || !istAdmin) return;
    setSaving(true);
    try {
      if (existing.datumVon && existing.datumBis) {
        // Komplette Gruppe freigeben.
        await freigebenUrlaubsGruppe(
          mitarbeiterId,
          existing.datumVon,
          existing.datumBis,
          adminName,
        );
      } else {
        await freigebenUrlaub(jahr, kw, mitarbeiterId, adminName);
      }
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal isOpen={true} onClose={onClose} title={`Urlaub — ${ma?.name ?? '?'} · KW ${kw}/${jahr}`} size="md">
      {/* Banner: Berechtigung / Freigabe-Status */}
      {readOnlyMain && (
        <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          🔒 Bestehende Urlaubseinträge dürfen nur durch Admin geändert werden.
          Du (Abrechnung) kannst lediglich den Kommentar ergänzen.
        </div>
      )}
      {existing && !existing.freigegeben && (
        <div className="mb-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          ⏳ <strong>Noch nicht freigegeben.</strong> Erfasst von {existing.erstellerName}{' '}
          ({existing.erstellerRolle}) am{' '}
          {new Date(existing.erstelltAm).toLocaleDateString('de-DE')}.
          {istAdmin && (
            <button
              type="button"
              onClick={freigeben}
              disabled={saving}
              className="ml-3 bg-green-600 hover:bg-green-700 disabled:bg-gray-300 text-white text-xs font-medium px-2 py-1 rounded"
            >
              ✓ Jetzt freigeben
            </button>
          )}
        </div>
      )}
      {existing && existing.freigegeben && (
        <div className="mb-3 rounded-lg border border-green-200 bg-green-50 p-2 text-xs text-green-800">
          ✓ Freigegeben{existing.freigegebenVon ? ` von ${existing.freigegebenVon}` : ''}
          {existing.freigegebenAm
            ? ` am ${new Date(existing.freigegebenAm).toLocaleDateString('de-DE')}`
            : ''}
        </div>
      )}

      <div className="space-y-3">
        {/* Status-Vorschau — wird immer automatisch aus dem aktuellen
            (datumVon, datumBis) + Zusatz-Werktagen berechnet. Manuelle
            Status-Auswahl gibt es nicht mehr. */}
        {(() => {
          const wochen = urlaubWochenAusBereich(datumVon, datumBis, zusatzWerktage);
          return (
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-2 text-xs text-blue-900">
              <div className="font-medium mb-1">Status je Kalenderwoche (automatisch, Mo–Fr):</div>
              {wochen.length === 0 ? (
                <div className="text-red-700">Noch kein Werktag erfasst.</div>
              ) : (
                <ul className="space-y-0.5">
                  {wochen.map((w) => (
                    <li key={`${w.jahr}-${w.kw}`}>
                      KW {w.kw}/{w.jahr}: <strong>{URLAUB_STATUS_LABELS[w.status]}</strong>
                      <span className="ml-2 opacity-70">({w.werktageInKw.length} Tag{w.werktageInKw.length === 1 ? '' : 'e'})</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })()}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Datum von</label>
            <input
              type="date"
              value={datumVon}
              onChange={(e) => setDatumVon(e.target.value)}
              disabled={readOnlyMain}
              className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Datum bis</label>
            <input
              type="date"
              value={datumBis}
              onChange={(e) => setDatumBis(e.target.value)}
              disabled={readOnlyMain}
              className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
            />
          </div>
        </div>

        {/* Alternative zur „Bis-Datum"-Eingabe: Anzahl Werktage.
            Aus Datum von + Anzahl wird Bis berechnet (Mo–Fr gezählt). */}
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-600">… oder Anzahl Werktage:</label>
          <input
            type="number"
            min={1}
            value={zaehleWerktage(datumVon, datumBis) || ''}
            onChange={(e) => {
              const n = parseInt(e.target.value, 10);
              if (!datumVon || isNaN(n) || n < 1) return;
              setDatumBis(bisAusWerktage(datumVon, n));
            }}
            disabled={readOnlyMain || !datumVon}
            className="w-24 border border-gray-300 rounded px-2 py-1 text-sm"
            placeholder="z. B. 5"
          />
          <span className="text-[11px] text-gray-500">
            ab Von ausgehend; Wochenenden zählen nicht.
          </span>
        </div>

        {/* Zusätzliche einzelne Werktage in derselben Woche
            (z. B. Mo + Mi + Fr). Werden zusätzlich zum oben definierten
            Bereich gezählt. Status wird automatisch auf „mehrtägig"
            angehoben, sobald > 1 Werktag pro KW erfasst ist. */}
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">
            weitere Urlaubstage in dieser oder einer anderen Woche
          </label>
          {zusatzWerktage.length > 0 && (
            <ul className="mb-1 space-y-0.5">
              {zusatzWerktage.map((d) => (
                <li
                  key={d}
                  className="flex items-center justify-between text-xs bg-amber-50 border border-amber-200 rounded px-2 py-0.5"
                >
                  <span>
                    {new Date(d).toLocaleDateString('de-DE', {
                      weekday: 'short',
                      day: '2-digit',
                      month: '2-digit',
                      year: 'numeric',
                    })}
                  </span>
                  {!readOnlyMain && (
                    <button
                      type="button"
                      onClick={() => setZusatzWerktage((arr) => arr.filter((x) => x !== d))}
                      className="text-amber-700 hover:text-red-700 ml-2"
                      title="Tag entfernen"
                    >
                      ✕
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {!readOnlyMain && (
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={neuerZusatzTag}
                onChange={(e) => setNeuerZusatzTag(e.target.value)}
                className="border border-gray-300 rounded px-2 py-1 text-sm"
              />
              <button
                type="button"
                onClick={() => {
                  if (!neuerZusatzTag) return;
                  const d = new Date(neuerZusatzTag);
                  const dow = d.getDay();
                  if (dow < 1 || dow > 5) {
                    setError('Nur Werktage (Mo–Fr) sind als Urlaubstag erlaubt.');
                    return;
                  }
                  if (zusatzWerktage.includes(neuerZusatzTag)) {
                    setNeuerZusatzTag('');
                    return;
                  }
                  setZusatzWerktage((arr) => [...arr, neuerZusatzTag].sort());
                  setNeuerZusatzTag('');
                  setError(null);
                }}
                className="text-xs bg-amber-600 hover:bg-amber-700 text-white px-2 py-1 rounded"
              >
                + hinzufügen
              </button>
            </div>
          )}
          <p className="text-[11px] text-gray-500 mt-0.5">
            Einzelne Werktage zusätzlich zum Datumsbereich oben. Sind in
            einer Woche mehrere einzelne Tage erfasst, wird der Status
            automatisch „mehrtägig".
          </p>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Kommentar</label>
          <textarea
            value={kommentar}
            onChange={(e) => setKommentar(e.target.value)}
            placeholder="optional — z. B. Genehmigung lt. Mail vom …"
            className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
            rows={2}
          />
          {readOnlyMain && (
            <p className="text-[11px] text-gray-500 mt-0.5">
              Du darfst den Kommentar ändern — andere Felder bleiben geschützt.
            </p>
          )}
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Externer Link</label>
          <div className="flex items-center gap-2">
            <input
              type="url"
              value={externerLink}
              onChange={(e) => setExternerLink(e.target.value)}
              disabled={readOnlyMain}
              placeholder="https://… (z. B. Mail-Thread)"
              className="flex-1 border border-gray-300 rounded px-2 py-1.5 text-sm"
            />
            {externerLink.trim() && (
              <a
                href={externerLink.trim()}
                target="_blank"
                rel="noreferrer"
                className="shrink-0 text-xs border border-blue-200 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded px-2 py-1.5"
                title="Link in neuem Tab öffnen"
              >
                🔗 öffnen
              </a>
            )}
          </div>
        </div>

        {error && <p className="text-red-600 text-sm">{error}</p>}

        <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-gray-100">
          <button
            type="button"
            onClick={speichern}
            disabled={saving}
            className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white font-medium px-3 py-1.5 rounded text-sm"
          >
            {saving ? 'Speichert…' : (existing ? 'Speichern' : 'Anlegen')}
          </button>
          {existing && istAdmin && (
            <button
              type="button"
              onClick={loeschen}
              disabled={saving}
              className="text-red-600 hover:text-red-700 text-sm px-2"
            >
              Löschen
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="ml-auto text-gray-500 hover:text-gray-700 text-sm px-2"
          >
            Schließen
          </button>
        </div>
      </div>
    </Modal>
  );
}

/**
 * Stack der Ausfall-Chips für eine KW-Zelle. Zeigt pro Eintrag einen kleinen
 * Chip (Farbe je nach Status) plus einen "+"-Button am Ende, der einen neuen
 * Ausfall mit TG-Auswahl im Modal anlegt.
 */
/**
 * Einzelner Chip für die gepackte Slot-Layout-Variante der
 * Ausfälle-Sektion. Wird pro (Slot, KW) gerendert, sobald an dieser
 * Position ein konkreter Einsatz liegt. Mehrwöchige Gruppen erzeugen
 * mehrere benachbarte Chips in derselben Slot-Zeile.
 */
function AusfallChip({
  eintrag,
  teilgebietById,
  mitarbeiterById,
  onClick,
}: {
  eintrag: Einsatz;
  teilgebietById: Map<string, Teilgebiet>;
  mitarbeiterById: Map<string, Mitarbeiter>;
  onClick: () => void;
}) {
  const tg = teilgebietById.get(eintrag.teilgebietId);
  const aktuellerStandard = tg?.standardAustraegerId ?? null;
  const hatSpringer = eintrag.typ === 'springer' && !!eintrag.mitarbeiterId;
  const standardChanged =
    eintrag.standardAustraegerSnapshot &&
    aktuellerStandard &&
    eintrag.standardAustraegerSnapshot !== aktuellerStandard;

  const bg = hatSpringer
    ? 'bg-green-100 border-green-300 text-green-800'
    : 'bg-red-100 border-red-300 text-red-800';
  const icon = hatSpringer ? '🟢' : '🔴';

  const tgName = tg?.name ?? '?';
  const tgKurz = kuerzeTgName(tgName);
  const springerName = eintrag.mitarbeiterId
    ? mitarbeiterById.get(eintrag.mitarbeiterId)?.name?.split(' ')[0] ?? '?'
    : null;

  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-[11px] font-medium py-0.5 px-1 rounded border ${bg} relative leading-tight`}
      title={
        `Teilgebiet: ${tgName}\n` +
        `Ausfall in KW ${eintrag.kw}${eintrag.ausfallBisKw ? ` bis KW ${eintrag.ausfallBisKw}` : ''}\n` +
        `Standard: ${eintrag.standardAustraegerSnapshot ? mitarbeiterById.get(eintrag.standardAustraegerSnapshot)?.name ?? '?' : '—'}\n` +
        (springerName ? `Springer: ${mitarbeiterById.get(eintrag.mitarbeiterId!)?.name ?? '?'}\n` : '') +
        (eintrag.kommentar ? `Kommentar: ${eintrag.kommentar}` : '')
      }
    >
      <div className="truncate">
        {icon} {tgKurz}
        {springerName && <span className="opacity-70"> · {springerName}</span>}
      </div>
      {standardChanged && (
        <span className="absolute -top-1 -right-1 text-[10px]" title="Standardausträger hat sich geändert!">⚡</span>
      )}
    </button>
  );
}

// ============================================================
// Ausfall-Modal
// ============================================================

function AusfallModal({
  jahr,
  kw,
  teilgebietId,
  teilgebiete,
  teilgebietById,
  existing,
  ausfaelleInKw,
  einsaetzeImJahr,
  austraegerMa,
  mitarbeiterById,
  maxKwImJahr,
  parameter,
  istGesperrt,
  istWechselKontext,
  onClose,
}: {
  jahr: number;
  kw: number;
  /** null = Neu-Anlage, TG wird im Modal gewählt. */
  teilgebietId: string | null;
  teilgebiete: Teilgebiet[];
  teilgebietById: Map<string, Teilgebiet>;
  /** Vorhandener Einsatz für (kw, tg) — wird beim Öffnen geladen. */
  existing: Einsatz | undefined;
  /** Schon erfasste Ausfälle in dieser KW — werden in der TG-Auswahl ausgeblendet. */
  ausfaelleInKw: Einsatz[];
  /** Alle Einsätze des Jahres — Quelle für Gruppen-Geschwister. */
  einsaetzeImJahr: Einsatz[];
  austraegerMa: Mitarbeiter[];
  mitarbeiterById: Map<string, Mitarbeiter>;
  maxKwImJahr: number;
  parameter: Parameter | null;
  /** KW gehört zu einer abgeschlossenen Periode → Modal ist read-only. */
  istGesperrt: boolean;
  /**
   * Modal wurde aus der Wechsel-/Dauerausfall-Sektion geöffnet
   * (Lücken-KW oder dauerhaft unbesetztes TG). Beeinflusst nur die
   * Texte/Labels — Logik bleibt identisch.
   */
  istWechselKontext?: boolean;
  onClose: () => void;
}) {
  const isNeu = !existing && teilgebietId == null;

  // TG-Auswahl bei Neu-Anlage; bei bestehendem Eintrag fix.
  const [selectedTgId, setSelectedTgId] = useState<string | null>(teilgebietId);
  const tg = selectedTgId ? teilgebietById.get(selectedTgId) ?? null : null;

  // Standardausträger-Snapshot: Beim Neu-Anlegen aus dem aktuellen TG-Standard
  // übernommen; beim Bearbeiten aus dem bestehenden Einsatz behalten, damit
  // die ⚡-Warnung historisch korrekt bleibt.
  const standardSnapshot =
    existing?.standardAustraegerSnapshot ?? tg?.standardAustraegerId ?? null;

  // Bisheriger Springer = mitarbeiterId, wenn der Einsatz vom typ='springer' ist.
  const initialSpringerId =
    existing?.typ === 'springer' ? existing.mitarbeiterId ?? null : null;

  const [springerId, setSpringerId] = useState<string | null>(initialSpringerId);
  const [kommentar, setKommentar] = useState(existing?.kommentar ?? '');
  const [externerLink, setExternerLink] = useState(existing?.externerLink ?? '');
  // bisKw wird nur explizit als „mehrwöchig" markiert, wenn der bestehende
  // Eintrag eine über die aktuelle KW hinausreichende `ausfallBisKw` trägt.
  const initialBisKw =
    existing?.ausfallBisKw != null && existing.ausfallBisKw > kw
      ? existing.ausfallBisKw
      : null;
  const [bisKw, setBisKw] = useState<number | null>(initialBisKw);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const standardChanged =
    standardSnapshot &&
    tg?.standardAustraegerId &&
    standardSnapshot !== tg.standardAustraegerId;

  // TG-Optionen für Neu-Anlage: aktive TGs ohne Auslagestelle, ohne
  // bereits in dieser KW erfasste Ausfälle.
  const tgOptionen = useMemo(() => {
    const belegt = new Set(ausfaelleInKw.map((a) => a.teilgebietId));
    return teilgebiete
      .filter((t) => t.isActive && !t.istAuslagestelle && !belegt.has(t.id))
      .sort((a, b) => a.name.localeCompare(b.name, 'de', { numeric: true }));
  }, [teilgebiete, ausfaelleInKw]);

  /**
   * Ermittelt alle Geschwister-Einsätze einer Gruppe:
   * gleiche `teilgebietId` + gleiche `(ausfallBisJahr, ausfallBisKw)`.
   * Single-Cell-Ausfälle (ohne ausfallBisKw oder ausfallBisKw==kw) bilden
   * eine Gruppe der Größe 1.
   */
  function findeGruppe(): Einsatz[] {
    if (!existing) return [];
    // Vermerk-Einsätze (K) und Auto-Springer aus Wechselplan (L) sind
    // pro KW unabhängige Marker — sie bilden keine „Ausfall-Gruppe".
    // Würden wir hier siblings einsammeln, würde das Bearbeiten einer
    // einzelnen Marker-KW andere Marker desselben TGs mit löschen.
    if (existing.autoVomWechselplan === true) {
      return [existing];
    }
    return einsaetzeImJahr.filter(
      (e) =>
        e.teilgebietId === existing.teilgebietId &&
        (e.ausfallBisJahr ?? null) === (existing.ausfallBisJahr ?? null) &&
        (e.ausfallBisKw ?? null) === (existing.ausfallBisKw ?? null) &&
        // Auto-Springer-Einsätze (L) niemals als Geschwister
        // einsammeln — sie werden vom WechselModal separat verwaltet.
        e.autoVomWechselplan !== true,
    );
  }

  async function speichern() {
    if (!selectedTgId) {
      setError('Bitte zuerst ein Teilgebiet auswählen.');
      return;
    }
    if (bisKw != null && bisKw <= kw) {
      setError('„Ausfall bis KW" muss > Start-KW sein.');
      return;
    }
    if (!parameter) {
      setError('Parameter noch nicht geladen — bitte einen Moment warten und erneut speichern.');
      return;
    }
    // Warnung, wenn betroffene KWs in der Vergangenheit liegen — die
    // Änderung wirkt sich auf bereits bestehende Abrechnungen aus.
    const vonKw = kw;
    const bisKwFinal = bisKw == null ? kw : Math.min(bisKw, maxKwImJahr);
    const vergangeneKws: number[] = [];
    for (let k = vonKw; k <= bisKwFinal; k++) {
      if (istVergangeneKw(jahr, k)) vergangeneKws.push(k);
    }
    // Auch alte Geschwister-KWs prüfen, falls sich der Bereich verschoben hat.
    for (const e of findeGruppe()) {
      if (e.kw < vonKw || e.kw > bisKwFinal) {
        if (istVergangeneKw(e.jahr, e.kw)) vergangeneKws.push(e.kw);
      }
    }
    if (vergangeneKws.length > 0) {
      const liste = Array.from(new Set(vergangeneKws)).sort((a, b) => a - b).join(', ');
      if (
        !confirm(
          `⚠ Vergangene Kalenderwoche(n) betroffen: ${liste}/${jahr}.\n\n` +
            `Das Speichern wirkt sich direkt auf die Abrechnung dieser KWs aus.\n\n` +
            `Trotzdem speichern?`,
        )
      ) {
        return;
      }
    }
    setSaving(true);
    setError(null);
    try {
      // Neuer KW-Bereich für die Gruppe.
      const von = kw;
      const bis = bisKw == null ? kw : Math.min(bisKw, maxKwImJahr);

      // Alte Geschwister einsammeln, bevor wir schreiben.
      const altGeschwister = findeGruppe();

      // Verwaiste Geschwister (außerhalb des neuen Bereichs) löschen.
      const neueKwSet = new Set<number>();
      for (let k = von; k <= bis; k++) neueKwSet.add(k);
      await Promise.all(
        altGeschwister
          .filter((e) => !neueKwSet.has(e.kw))
          .map((e) => loescheEinsatz(e.id)),
      );

      // Pro Ziel-KW: Ausgabe sicherstellen + Einsatz upserten.
      const typ: 'springer' | 'ungeklärt' = springerId ? 'springer' : 'ungeklärt';
      const ausfallBisJahr = bisKw == null ? undefined : jahr;
      const ausfallBisKw = bisKw == null ? undefined : bis;

      for (let k = von; k <= bis; k++) {
        const ausgabeId = await getOrCreateAusgabe(jahr, k, parameter);
        await setzeEinsatz({
          ausgabeId,
          jahr,
          kw: k,
          teilgebietId: selectedTgId,
          mitarbeiterId: springerId ?? null,
          typ,
          kommentar: kommentar.trim() || undefined,
          externerLink: externerLink.trim() || undefined,
          ausfallBisJahr,
          ausfallBisKw,
          standardAustraegerSnapshot: standardSnapshot,
        });
      }

      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Speichern fehlgeschlagen.');
    } finally {
      setSaving(false);
    }
  }

  async function loeschen() {
    if (!existing) return;
    const gruppe = findeGruppe();
    const vergangene = gruppe.filter((e) => istVergangeneKw(e.jahr, e.kw));
    const vergangenHinweis =
      vergangene.length > 0
        ? `\n\n⚠ Davon liegen ${vergangene.length} Eintrag/Einträge in vergangenen Kalenderwochen — die Abrechnung dieser Wochen wird unmittelbar angepasst.`
        : '';
    const frage =
      gruppe.length > 1
        ? `Ausfall-Gruppe (${gruppe.length} Wochen) wirklich löschen? Die Einträge werden in der Abrechnung gelöscht.${vergangenHinweis}`
        : `Ausfall in KW ${kw} wirklich löschen? Der Eintrag wird in der Abrechnung gelöscht.${vergangenHinweis}`;
    if (!confirm(frage)) return;
    setSaving(true);
    setError(null);
    try {
      await Promise.all(gruppe.map((e) => loescheEinsatz(e.id)));
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Löschen fehlgeschlagen.');
    } finally {
      setSaving(false);
    }
  }

  const standardName = standardSnapshot
    ? mitarbeiterById.get(standardSnapshot)?.name ?? '?'
    : '—';
  const aktuellerStandardName = tg?.standardAustraegerId
    ? mitarbeiterById.get(tg.standardAustraegerId)?.name ?? '?'
    : '—';

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      title={`Ausfall — ${tg ? tg.name : '(Teilgebiet wählen)'} · KW ${kw}/${jahr}`}
      size="md"
    >
      {istGesperrt && (
        <div className="mb-3 rounded-lg border border-gray-300 bg-gray-100 p-3 text-sm text-gray-700">
          🔒 Diese KW gehört zu einer <strong>abgeschlossenen Abrechnungsperiode</strong> — keine Änderungen mehr möglich.
        </div>
      )}
      <div className="space-y-3">
        {/* Teilgebiet — Auswahl bei Neu, sonst nur Anzeige */}
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Teilgebiet</label>
          {isNeu ? (
            <select
              value={selectedTgId ?? ''}
              onChange={(e) => setSelectedTgId(e.target.value || null)}
              disabled={istGesperrt}
              className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
              autoFocus
            >
              <option value="">— bitte wählen —</option>
              {tgOptionen.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}{t.plz ? ` (${t.plz})` : ''}
                </option>
              ))}
            </select>
          ) : tg ? (
            <div className="text-sm font-medium">
              {tg.name} {tg.plz && <span className="text-gray-400 font-mono">({tg.plz})</span>}
            </div>
          ) : (
            <div className="text-sm text-red-600">Teilgebiet nicht mehr vorhanden</div>
          )}
        </div>

        {/* Standardausträger zum Planungszeitpunkt */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Standard zum Planungszeitpunkt</label>
            <div className="text-sm">{standardName}</div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Aktueller Standard</label>
            <div className={`text-sm ${standardChanged ? 'text-amber-700 font-semibold' : ''}`}>
              {aktuellerStandardName}
              {standardChanged && <span className="ml-1">⚡</span>}
            </div>
          </div>
        </div>

        {standardChanged && (
          <div className="rounded-lg bg-amber-50 border border-amber-200 text-amber-900 text-xs p-2">
            ⚡ <strong>Standardausträger hat sich geändert</strong> seit der Ausfall geplant wurde.
            Prüfen, ob der ursprüngliche Plan noch passt.
          </div>
        )}

        {/* Springer — nur MAs mit Freigabe für das gewählte TG.
            Der bisher gespeicherte Springer wird zur Sicherheit immer
            angezeigt, auch wenn ihm die Freigabe inzwischen entzogen
            wurde — sonst würde er „unsichtbar" gespeichert bleiben. */}
        {(() => {
          const freigegebeneMa = selectedTgId
            ? austraegerMa.filter(
                (m) => m.teilgebietFreigaben?.includes(selectedTgId) ?? false,
              )
            : [];
          // Sicherheits-Fallback: aktuell gespeicherten Springer einblenden,
          // falls er nicht (mehr) in der Freigabe-Liste steht.
          const zeigeListe = [...freigegebeneMa];
          if (springerId && !zeigeListe.some((m) => m.id === springerId)) {
            const ma = austraegerMa.find((m) => m.id === springerId);
            if (ma) zeigeListe.push(ma);
          }
          return (
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Springer / Ersatz
              </label>
              <select
                value={springerId ?? ''}
                onChange={(e) => setSpringerId(e.target.value || null)}
                disabled={!selectedTgId || istGesperrt}
                className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
              >
                <option value="">— noch nicht gefunden —</option>
                {zeigeListe.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                    {m.id === springerId &&
                    !m.teilgebietFreigaben?.includes(selectedTgId ?? '')
                      ? ' (⚠ keine TG-Freigabe)'
                      : ''}
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-gray-500 mt-0.5">
                {selectedTgId
                  ? freigegebeneMa.length === 0
                    ? '⚠ Kein Austräger hat eine Freigabe für dieses Teilgebiet.'
                    : `${freigegebeneMa.length} Austräger mit Freigabe für dieses TG.`
                  : 'Erst Teilgebiet wählen, dann Springer.'}
              </p>
            </div>
          );
        })()}

        {/* Kommentar */}
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Kommentar</label>
          <textarea
            value={kommentar}
            onChange={(e) => setKommentar(e.target.value)}
            disabled={istGesperrt}
            placeholder="z. B. Urlaub, Krankheit, Telefonat mit…"
            className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
            rows={2}
          />
        </div>

        {/* Externer Link */}
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Externer Link</label>
          <div className="flex items-center gap-2">
            <input
              type="url"
              value={externerLink}
              onChange={(e) => setExternerLink(e.target.value)}
              disabled={istGesperrt}
              placeholder="https://… (z. B. Mail-Thread)"
              className="flex-1 border border-gray-300 rounded px-2 py-1.5 text-sm"
            />
            {externerLink.trim() && (
              <a
                href={externerLink.trim()}
                target="_blank"
                rel="noreferrer"
                className="shrink-0 text-xs border border-blue-200 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded px-2 py-1.5"
                title="Link in neuem Tab öffnen"
              >
                🔗 öffnen
              </a>
            )}
          </div>
        </div>

        {/* Ausfall / Springer-Übernahme bis KW.
            Label wird kontextabhängig angepasst: Wechsel-Sektion =
            der Springer übernimmt einen Bereich; Ausfall-Sektion =
            der Ausfall erstreckt sich über mehrere KWs. */}
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">
            {istWechselKontext
              ? 'Springer übernimmt bis KW (optional — Folgewochen werden automatisch angelegt)'
              : 'Ausfall bis KW (optional — Folgewochen werden automatisch angelegt)'}
          </label>
          <select
            value={bisKw ?? ''}
            onChange={(e) => setBisKw(e.target.value ? Number(e.target.value) : null)}
            disabled={istGesperrt}
            className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
          >
            <option value="">— nur diese KW —</option>
            {Array.from({ length: maxKwImJahr - kw + 1 }, (_, i) => kw + i)
              .filter((k) => k !== kw)
              .map((k) => (
                <option key={k} value={k}>bis KW {k}</option>
              ))}
          </select>
        </div>

        {/* Hinweis: die frühere „übernimmt dauerhaft"-Checkbox wurde
            entfernt. Dauerhafte Übernahmen laufen ausschließlich über
            den Wechselplan (✎-Icon am Zeilenkopf der Wechsel-Sektion).
            Dort wird `neuerAustraegerId` + `abAusgabe` gesetzt; die
            Folge-KWs der laufenden Periode bekommen automatisch
            Springer-Einsätze (L-Logik). */}

        {error && <p className="text-red-600 text-sm">{error}</p>}

        {/* Aktionen — direkt in die Abrechnung wirkend.
            Speichern legt/aktualisiert den Einsatz (und ggf. die Ausgabe);
            Löschen entfernt die komplette Gruppe sofort aus der Abrechnung. */}
        <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-gray-100">
          {!istGesperrt && (
            <button
              type="button"
              onClick={speichern}
              disabled={saving}
              className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white font-medium px-3 py-1.5 rounded text-sm"
            >
              {saving ? 'Speichert…' : existing ? 'Speichern' : 'Anlegen'}
            </button>
          )}
          {existing && !istGesperrt && (
            <button
              type="button"
              onClick={loeschen}
              disabled={saving}
              className="text-red-600 hover:text-red-700 text-sm px-2"
            >
              Löschen
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="ml-auto text-gray-500 hover:text-gray-700 text-sm px-2"
          >
            Schließen
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ============================================================
// Wechselplan-Zelle + Modal
// ============================================================

/** Vergleicht zwei (jahr, kw)-Tupel — liefert -1/0/1. */
function cmpJahrKw(aJ: number, aK: number, bJ: number, bK: number): number {
  if (aJ !== bJ) return aJ - bJ;
  return aK - bK;
}

// `UnbesetztOhnePlanCell` wurde entfernt — alle Fälle werden jetzt
// durch `WechselCell` abgedeckt (mit `plan.letzteAusgabe* == null`
// für dauerhaft unbesetzte TGs).

function WechselCell({
  plan,
  jahr,
  kw,
  einsatz,
  mitarbeiterById,
  onClickPlan,
  onClickAusfall,
}: {
  plan: StandardAustraegerWechselPlan;
  jahr: number;
  kw: number;
  /** Konkreter Einsatz für (kw, tg) — typischerweise Lücken- oder Springer-Einsatz. */
  einsatz: Einsatz | undefined;
  mitarbeiterById: Map<string, Mitarbeiter>;
  /** Klick auf „letzte" / „neue" Markierungen → Wechselplan-Modal. */
  onClickPlan: () => void;
  /** Klick auf Lücken-/Springer-Chips → Ausfall-Modal für diese KW. */
  onClickAusfall: () => void;
}) {
  // 4 Zustände pro Zelle:
  //   < letzteAusgabe         → leer (alter Austräger weiter aktiv)
  //   = letzteAusgabe         → ⏳ letzte mit altem (gelb) → Plan-Modal
  //   letzte+1 … ab-1 (oder ab leer) → 🔴 unbesetzt / 🟢 Springer
  //                                     → Ausfall-Modal (Springer setzen)
  //   >= abAusgabe            → 🟢 neuer Austräger (grün) → Plan-Modal
  //
  // Sonderfall: kein `letzteAusgabe` gesetzt (TG ist seit Beginn
  // unbesetzt → virtueller Plan ODER persistierter Plan ohne
  // letzteAusgabe). Dann gibt es keine „⏳ letzte"-KW; jede KW gilt
  // als „nach letzte" und folgt der Lücken-/abAusgabe-Logik darunter.
  const hatLetzte =
    plan.letzteAusgabeJahr !== undefined && plan.letzteAusgabeKw !== undefined;
  const cmpLetzte = hatLetzte
    ? cmpJahrKw(jahr, kw, plan.letzteAusgabeJahr!, plan.letzteAusgabeKw!)
    : 1;
  if (cmpLetzte < 0) {
    // KW liegt VOR der letzten Ausgabe des bisherigen Austrägers —
    // normalerweise verteilt er noch selbst. Liegt aber für diese KW
    // ein abweichender Einsatz vor (Springer-Vertretung oder einmaliger
    // Ausfall), muss dieser in der Personalplanung sichtbar + per Klick
    // bearbeitbar sein. Leere Zellen werden klickbar gemacht, damit man
    // direkt einen Ausfall erfassen kann.
    if (einsatz && einsatz.typ === 'springer' && einsatz.mitarbeiterId) {
      const springerMa = mitarbeiterById.get(einsatz.mitarbeiterId);
      const kurz = springerMa?.kuerzel || springerMa?.name?.split(' ')[0] || '?';
      return (
        <button
          type="button"
          onClick={onClickAusfall}
          className="w-full text-[11px] font-medium py-1 rounded border bg-green-100 border-green-300 text-green-800 leading-tight"
          title={`Springer: ${springerMa?.name ?? '?'} (vor geplantem Wechsel) — Klick öffnet die Ausfall-Maske`}
        >
          🟢 {kurz}
        </button>
      );
    }
    if (einsatz && (einsatz.typ === 'ungeklärt' || einsatz.typ === 'ausfall')) {
      return (
        <button
          type="button"
          onClick={onClickAusfall}
          className="w-full text-[11px] font-medium py-1 rounded border bg-red-100 border-red-300 text-red-800 leading-tight"
          title="Einmalig unbesetzt (vor geplantem Wechsel) — Klick öffnet die Ausfall-Maske"
        >
          🔴 unbesetzt
        </button>
      );
    }
    // Keine Abweichung — bisheriger Austräger im Einsatz. Trotzdem
    // klickbar, damit ein Ausfall pro KW direkt aus der Zelle heraus
    // eingetragen werden kann.
    return (
      <button
        type="button"
        onClick={onClickAusfall}
        className="w-full text-[10px] text-gray-200 hover:text-gray-400 hover:bg-gray-50 py-1 leading-none rounded"
        title="Bisheriger Austräger im Einsatz — Klick öffnet die Ausfall-Maske"
      >
        ·
      </button>
    );
  }
  if (cmpLetzte === 0) {
    return (
      <button
        type="button"
        onClick={onClickPlan}
        className="w-full text-[11px] font-medium py-1 rounded border bg-yellow-100 border-yellow-300 text-yellow-900 leading-tight"
        title="Letzte Ausgabe des bisherigen Austrägers — Klick öffnet den Wechselplan"
      >
        ⏳ letzte
      </button>
    );
  }
  const hatAb = plan.abAusgabeJahr !== undefined && plan.abAusgabeKw !== undefined;
  const cmpAb = hatAb
    ? cmpJahrKw(jahr, kw, plan.abAusgabeJahr!, plan.abAusgabeKw!)
    : 1; // ohne abAusgabe gilt: dauerhaft unbesetzt
  if (!hatAb || cmpAb < 0) {
    // Lücken-KW. Springer kann hier pro KW gesetzt werden (analog zur
    // Ausfälle-Sektion). Wenn bereits ein Springer-Einsatz existiert,
    // zeige ihn grün; sonst rot „unbesetzt".
    const hatSpringer = einsatz?.typ === 'springer' && !!einsatz.mitarbeiterId;
    if (hatSpringer) {
      const ma = mitarbeiterById.get(einsatz!.mitarbeiterId!);
      const kurz = ma?.kuerzel || ma?.name?.split(' ')[0] || '?';
      return (
        <button
          type="button"
          onClick={onClickAusfall}
          className="w-full text-[11px] font-medium py-1 rounded border bg-green-100 border-green-300 text-green-800 leading-tight"
          title={`Springer: ${ma?.name ?? '?'} — Klick öffnet die Ausfall-Maske`}
        >
          🟢 {kurz}
        </button>
      );
    }
    return (
      <button
        type="button"
        onClick={onClickAusfall}
        className="w-full text-[11px] font-medium py-1 rounded border bg-red-100 border-red-300 text-red-800 leading-tight"
        title="Teilgebiet unbesetzt — Klick öffnet die Ausfall-Maske, um einen Springer zu setzen"
      >
        🔴 unbesetzt
      </button>
    );
  }
  // KW >= abAusgabe — normalerweise verteilt der neue Austräger. Liegt
  // für diese KW jedoch ein abweichender Einsatz vor (z. B. der neue
  // Austräger fällt einmalig aus → ungeklärt; oder ein Springer
  // vertritt ihn → typ='springer' mit anderer mitarbeiterId), wird der
  // Einsatz angezeigt — sonst wäre die Ausnahme in der
  // Personalplanung unsichtbar.
  const ma = plan.neuerAustraegerId ? mitarbeiterById.get(plan.neuerAustraegerId) : undefined;
  const kurzname = ma?.kuerzel || ma?.name?.split(' ')[0] || '?';

  if (einsatz && einsatz.typ === 'springer' && einsatz.mitarbeiterId && einsatz.mitarbeiterId !== plan.neuerAustraegerId) {
    const springerMa = mitarbeiterById.get(einsatz.mitarbeiterId);
    const kurz = springerMa?.kuerzel || springerMa?.name?.split(' ')[0] || '?';
    return (
      <button
        type="button"
        onClick={onClickAusfall}
        className="w-full text-[11px] font-medium py-1 rounded border bg-green-100 border-green-300 text-green-800 leading-tight"
        title={`Springer: ${springerMa?.name ?? '?'} — vertritt ${ma?.name ?? '?'} in dieser KW`}
      >
        🟢 {kurz}
      </button>
    );
  }
  if (einsatz && (einsatz.typ === 'ungeklärt' || (einsatz.typ === 'springer' && !einsatz.mitarbeiterId))) {
    return (
      <button
        type="button"
        onClick={onClickAusfall}
        className="w-full text-[11px] font-medium py-1 rounded border bg-red-100 border-red-300 text-red-800 leading-tight"
        title={`Einmalig unbesetzt (${ma?.name ?? 'neuer Austräger'} fällt aus) — Klick öffnet die Ausfall-Maske`}
      >
        🔴 unbesetzt
      </button>
    );
  }
  // Erste Ausgabe des neuen Standardausträgers bei einem Wechsel von
  // „unbesetzt → neu": Es gibt keinen bisherigen Austräger und damit
  // keinen gelben „⏳ letzte"-Chip. Damit der geplante Wechsel trotzdem
  // erkennbar ist (sonst wäre alles grün), wird die erste KW ab
  // „abAusgabe" hervorgehoben — gestrichelter amber-Rahmen + 🔁.
  // Klick öffnet den Wechselplan (analog zum gelben Chip beim besetzten
  // TG). Greift nur, wenn ein neuer Austräger geplant ist.
  if (!hatLetzte && cmpAb === 0 && plan.neuerAustraegerId) {
    return (
      <button
        type="button"
        onClick={onClickPlan}
        className="w-full text-[11px] font-medium py-1 rounded border-2 border-dashed border-amber-500 bg-amber-100 text-amber-900 leading-tight"
        title={`Wechsel: ${ma?.name ?? '?'} übernimmt ab dieser Ausgabe als neuer Standardausträger — wird beim Monatswechsel vorgeschlagen. Klick öffnet den Wechselplan.`}
      >
        🔁 {kurzname}
      </button>
    );
  }
  // KW liegt ab der Übernahme durch den neuen Austräger und es gibt
  // keinen abweichenden Einsatz. Klick öffnet das AusfallModal, damit der
  // User für diese eine KW einen Ausfall / Springer eintragen kann, ohne
  // den Wechselplan zu verändern. Der Wechselplan selbst wird über das
  // ⏳-Chip in der „letzten Ausgabe" oder über das ✕ am Zeilenkopf
  // bearbeitet/gelöscht.
  return (
    <button
      type="button"
      onClick={onClickAusfall}
      className="w-full text-[11px] font-medium py-1 rounded border bg-green-100 border-green-300 text-green-800 leading-tight"
      title={`Neuer Standardausträger: ${ma?.name ?? '?'} — Klick erfasst einen Ausfall/Springer für genau diese KW`}
    >
      🟢 {kurzname}
    </button>
  );
}

function WechselModal({
  teilgebietId,
  tg,
  existing,
  einsaetzeImJahr,
  parameter,
  austraegerMa,
  mitarbeiterById,
  maxKwImJahr,
  jahr,
  abrechnungsperioden,
  onClose,
}: {
  teilgebietId: string;
  tg: Teilgebiet;
  existing: StandardAustraegerWechselPlan | undefined;
  /** Live-Einsätze des sichtbaren Jahres — für Lücken-Sync. */
  einsaetzeImJahr: Einsatz[];
  parameter: Parameter | null;
  austraegerMa: Mitarbeiter[];
  mitarbeiterById: Map<string, Mitarbeiter>;
  maxKwImJahr: number;
  jahr: number;
  /** Für L: Bestimmen des Periodenendes (= max KW der Monatsperiode), in
   *  der `letzteAusgabe` liegt — bis dorthin wird der neue Austräger als
   *  Springer vorausgefüllt. */
  abrechnungsperioden: import('../types').Abrechnungsperiode[];
  onClose: () => void;
}) {
  // Bei einem TG ohne Standardausträger gibt es keine letzte Ausgabe
  // — die Felder starten leer und sind später kein Pflichtfeld. Bei
  // bestehenden Plänen mit gesetztem letzte-Wert: diesen übernehmen.
  const istUnbesetztTg = !tg.standardAustraegerId;
  const [letzteJahr, setLetzteJahr] = useState<number | null>(
    existing?.letzteAusgabeJahr ?? (istUnbesetztTg ? null : jahr),
  );
  const [letzteKw, setLetzteKw] = useState<number | null>(
    existing?.letzteAusgabeKw ?? (istUnbesetztTg ? null : 1),
  );
  const [neuerMa, setNeuerMa] = useState<string | null>(existing?.neuerAustraegerId ?? null);
  const [abJahr, setAbJahr] = useState<number | null>(existing?.abAusgabeJahr ?? null);
  const [abKw, setAbKw] = useState<number | null>(existing?.abAusgabeKw ?? null);
  const [kommentar, setKommentar] = useState(existing?.kommentar ?? '');
  const [externerLink, setExternerLink] = useState(existing?.externerLink ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const freigegeben = useMemo(
    () => austraegerMa.filter((m) => m.teilgebietFreigaben?.includes(teilgebietId) ?? false),
    [austraegerMa, teilgebietId],
  );
  const optionen = useMemo(() => {
    const list = [...freigegeben];
    if (neuerMa && !list.some((m) => m.id === neuerMa)) {
      const m = austraegerMa.find((x) => x.id === neuerMa);
      if (m) list.push(m);
    }
    return list;
  }, [freigegeben, neuerMa, austraegerMa]);

  // H: Vorjahr entfällt — Vergangenheit ist nicht mehr planbar.
  const jahrOptions = useMemo(() => [jahr, jahr + 1, jahr + 2], [jahr]);

  // Verfügbare KWs in Abhängigkeit vom gewählten Jahr — verbergen alles,
  // was vor der aktuellen KW liegt. Für „ab Ausgabe" gilt zusätzlich
  // „nach der letzten Ausgabe" (separat im Filter unten gehandhabt).
  const currentKw = useMemo(() => {
    const now = new Date();
    const start = Date.UTC(now.getUTCFullYear(), 0, 1);
    const dayOfYear = Math.floor((now.getTime() - start) / (24 * 60 * 60 * 1000)) + 1;
    return Math.max(1, Math.ceil(dayOfYear / 7));
  }, []);
  const currentJahr = new Date().getFullYear();
  function verfuegbareKws(forJahr: number): number[] {
    const all = Array.from({ length: maxKwImJahr }, (_, i) => i + 1);
    if (forJahr < currentJahr) return [];
    if (forJahr > currentJahr) return all;
    return all.filter((k) => k > currentKw);
  }
  const letzteKwOptionen = useMemo(
    () => (letzteJahr != null ? verfuegbareKws(letzteJahr) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [letzteJahr, maxKwImJahr, currentJahr, currentKw],
  );
  const abKwOptionen = useMemo(() => {
    const list = abJahr != null ? verfuegbareKws(abJahr) : [];
    return list.filter((k) => {
      if (abJahr == null) return true;
      // muss strikt NACH letzte Ausgabe liegen — wenn keine letzteAusgabe
      // gesetzt ist (unbesetzt-TG), entfällt diese Bedingung.
      if (letzteJahr == null || letzteKw == null) return true;
      return cmpJahrKw(abJahr, k, letzteJahr, letzteKw) > 0;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abJahr, letzteJahr, letzteKw, maxKwImJahr, currentJahr, currentKw]);

  // O: Sicherstellen, dass State und Dropdown-Optionen synchron sind.
  // Der Browser zeigt bei <select value=X> automatisch die erste Option
  // an, wenn X nicht in den Optionen vorkommt — feuert dabei aber KEIN
  // onChange. Folge: State bleibt auf einem Wert, der nicht zur Anzeige
  // passt (z. B. Init-Default 1, Anzeige KW22). Beim Speichern entsteht
  // dadurch eine falsche „Vergangenheits-Warnung". Daher: wenn der
  // aktuelle Wert nicht in den Optionen ist, automatisch auf die erste
  // gültige Option setzen — analog die Anzeige.
  useEffect(() => {
    if (
      letzteJahr != null &&
      letzteKwOptionen.length > 0 &&
      (letzteKw == null || !letzteKwOptionen.includes(letzteKw))
    ) {
      setLetzteKw(letzteKwOptionen[0]);
    }
  }, [letzteJahr, letzteKwOptionen, letzteKw]);
  useEffect(() => {
    if (
      abJahr != null &&
      abKwOptionen.length > 0 &&
      (abKw == null || !abKwOptionen.includes(abKw))
    ) {
      setAbKw(abKwOptionen[0]);
    }
  }, [abJahr, abKwOptionen, abKw]);

  async function speichern() {
    setError(null);
    // letzteAusgabe ist nur Pflicht, wenn TG aktuell einen Standardausträger
    // hat (echter Austrägerwechsel). Bei unbesetzten TGs darf das Feld
    // leer bleiben — der Plan beschreibt dann nur den neuen Austräger.
    if (!istUnbesetztTg && (!letzteJahr || !letzteKw)) {
      setError('Bitte „letzte Ausgabe (Jahr + KW)" angeben.');
      return;
    }
    if (neuerMa && (abJahr == null || abKw == null)) {
      setError('Wenn ein neuer Austräger gesetzt ist, bitte auch „ab Ausgabe" angeben.');
      return;
    }
    if (abJahr != null && abKw != null && letzteJahr != null && letzteKw != null) {
      if (cmpJahrKw(abJahr, abKw, letzteJahr, letzteKw) <= 0) {
        setError('„ab Ausgabe" muss NACH „letzte Ausgabe" liegen.');
        return;
      }
    }

    // Warnung bei Wirkung auf vergangene KWs:
    //  - letzteAusgabe oder abAusgabe in der Vergangenheit
    //  - Lücken-Einsätze (im aktuell sichtbaren Jahr) in vergangenen KWs,
    //    die entweder neu angelegt oder gelöscht werden.
    const vergangeneTreffer: string[] = [];
    if (letzteJahr != null && letzteKw != null && istVergangeneKw(letzteJahr, letzteKw)) {
      vergangeneTreffer.push(`letzte Ausgabe KW ${letzteKw}/${letzteJahr}`);
    }
    if (abJahr != null && abKw != null && istVergangeneKw(abJahr, abKw)) {
      vergangeneTreffer.push(`ab Ausgabe KW ${abKw}/${abJahr}`);
    }
    if (vergangeneTreffer.length > 0) {
      if (
        !confirm(
          `⚠ Vergangenheits-Wirkung:\n${vergangeneTreffer.map((s) => `• ${s}`).join('\n')}\n\n` +
            `Bereits laufende Abrechnungen können betroffen sein.\n\n` +
            `Trotzdem speichern?`,
        )
      ) {
        return;
      }
    }

    setSaving(true);
    try {
      await setzeAustraegerwechselPlan({
        teilgebietId,
        letzteAusgabeJahr: letzteJahr ?? undefined,
        letzteAusgabeKw: letzteKw ?? undefined,
        neuerAustraegerId: neuerMa ?? undefined,
        abAusgabeJahr: abJahr ?? undefined,
        abAusgabeKw: abKw ?? undefined,
        kommentar: kommentar.trim() || undefined,
        externerLink: externerLink.trim() || undefined,
      });

      // Lücken-Einsätze im aktuell sichtbaren Jahr synchronisieren:
      // Bereich strikt zwischen `letzteAusgabe` und `abAusgabe` (falls
      // gesetzt; sonst bis Jahresende). Im KW-Bereich werden für TG
      // ungeklärte Lücken-Einsätze angelegt; KWs außerhalb des Bereichs,
      // die noch unbearbeitet sind (typ='ungeklärt' + kein MA), werden
      // gelöscht. Bereits geklärte Springer (typ='springer' + MA) bleiben
      // unangetastet, egal wo.
      if (parameter) {
        const luecke = new Set<number>();
        for (const k of (
          () => {
            const list: number[] = [];
            // Ohne letzteAusgabe (TG seit Beginn unbesetzt) gilt der
            // Lücken-Bereich ab KW 1 des sichtbaren Jahres. Sonst:
            // letzte im aktuellen Jahr → ab letzteKw+1, im Vorjahr → ab KW 1,
            // im Folgejahr → Lücke leer (Bereich beginnt nach Jahresende).
            const startKw =
              letzteJahr == null || letzteKw == null
                ? 1
                : letzteJahr < jahr
                ? 1
                : letzteJahr === jahr
                ? letzteKw + 1
                : maxKwImJahr + 1;
            // Wenn ab im aktuellen Jahr: bis abKw-1; sonst (ab im Folgejahr
            // oder nicht gesetzt) bis Jahresende.
            const endKw =
              abJahr == null || abKw == null
                ? maxKwImJahr
                : abJahr > jahr
                ? maxKwImJahr
                : abJahr === jahr
                ? abKw - 1
                : 0;
            for (let k = startKw; k <= endKw; k++) list.push(k);
            return list;
          }
        )()) {
          luecke.add(k);
        }

        // 1) Verwaiste, unbearbeitete Lücken-Einsätze außerhalb des neuen
        //    Bereichs löschen — Springer-Einsätze bleiben in jedem Fall.
        const tgEinsaetze = einsaetzeImJahr.filter((e) => e.teilgebietId === teilgebietId);
        for (const e of tgEinsaetze) {
          if (luecke.has(e.kw)) continue;
          if (e.typ === 'ungeklärt' && !e.mitarbeiterId) {
            await loescheEinsatz(e.id);
          }
        }

        // 2) Lücken-Einsätze für neue KWs anlegen — nur wenn dort noch
        //    nichts existiert. Geklärte Springer in der Lücke werden
        //    nicht überschrieben.
        const vorhanden = new Set(tgEinsaetze.map((e) => e.kw));
        for (const k of luecke) {
          if (vorhanden.has(k)) continue;
          const ausgabeId = await getOrCreateAusgabe(jahr, k, parameter);
          await setzeEinsatz({
            ausgabeId,
            jahr,
            kw: k,
            teilgebietId,
            mitarbeiterId: null,
            typ: 'ungeklärt',
            standardAustraegerSnapshot: tg.standardAustraegerId ?? null,
          });
        }

        // L: Auto-Springer-Einsätze für den neuen Austräger im Zeitraum
        // [abAusgabe..Periodenende] der Periode, in der `letzteAusgabe`
        // liegt. Hintergrund: bis zum Monatswechsel ist der neue MA
        // formal noch nicht Standardausträger — die KWs würden sonst in
        // der Abrechnung „leer" hängen. Mit einem Springer-Einsatz wird
        // er korrekt eingeplant und vergütet.
        if (neuerMa && abJahr === jahr && abKw != null && abKw <= maxKwImJahr) {
          // Auto-Springer-Bereich: ab abAusgabe bis Ende der Periode, in
          // der abAusgabe liegt. Falls letzteAusgabe gesetzt ist, muss
          // sie in derselben Periode liegen (sonst wäre es ein
          // Mehrperioden-Wechsel, da übernimmt Monatswechsel früher).
          // Bei TG-ohne-letzteAusgabe (unbesetzt-Fall) gilt diese
          // Bedingung trivial.
          const periodeMitAb = abrechnungsperioden.find(
            (p) => p.jahr === abJahr && p.kalenderwochen.includes(abKw!),
          );
          const okLetzte =
            letzteJahr == null || letzteKw == null
              ? true
              : periodeMitAb != null &&
                periodeMitAb.jahr === letzteJahr &&
                periodeMitAb.kalenderwochen.includes(letzteKw);
          if (periodeMitAb && okLetzte) {
            const periodEndKw = Math.max(...periodeMitAb.kalenderwochen);
            const aktuelleAuto = tgEinsaetze.filter((e) => e.autoVomWechselplan === true);

            // 1) Veraltete Auto-Einsätze aufräumen: außerhalb des neuen
            //    Bereichs ODER auf einen anderen MA.
            for (const e of aktuelleAuto) {
              const imBereich = e.kw >= abKw && e.kw <= periodEndKw;
              if (!imBereich || e.mitarbeiterId !== neuerMa) {
                await loescheEinsatz(e.id);
              }
            }

            // 2) Für jede KW im Bereich [abKw..periodEndKw] einen
            //    Auto-Springer schreiben — sofern nicht bereits ein
            //    manueller Einsatz existiert (typ='springer' mit
            //    abweichendem MA → bleibt; ungeklärt-Lücken werden
            //    überschrieben, weil sie aus der Lücken-Sync oben gar
            //    nicht für KW >= abKw entstehen).
            const aktuelleAutoIds = new Set(aktuelleAuto.map((e) => e.id));
            for (let k = abKw; k <= periodEndKw; k++) {
              const vorhandenerEinsatz = tgEinsaetze.find((e) => e.kw === k);
              // Manuell gepflegten, nicht-auto Einsatz nicht überschreiben.
              if (
                vorhandenerEinsatz &&
                !aktuelleAutoIds.has(vorhandenerEinsatz.id)
              ) {
                continue;
              }
              const ausgabeId = await getOrCreateAusgabe(jahr, k, parameter);
              await setzeEinsatz({
                ausgabeId,
                jahr,
                kw: k,
                teilgebietId,
                mitarbeiterId: neuerMa,
                typ: 'springer',
                standardAustraegerSnapshot: tg.standardAustraegerId ?? null,
                autoVomWechselplan: true,
              });
            }
          } else {
            // abAusgabe nicht in derselben Periode wie letzteAusgabe →
            // alte Auto-Einsätze aufräumen (z. B. wenn User das ab-Datum
            // verschoben hat).
            for (const e of tgEinsaetze.filter((e) => e.autoVomWechselplan === true)) {
              await loescheEinsatz(e.id);
            }
          }
        } else {
          // Kein neuer MA / kein abAusgabe → bestehende Auto-Einsätze
          // aufräumen.
          for (const e of tgEinsaetze.filter((e) => e.autoVomWechselplan === true)) {
            await loescheEinsatz(e.id);
          }
        }
      }

      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Speichern fehlgeschlagen.');
    } finally {
      setSaving(false);
    }
  }

  async function loeschen() {
    // Welche unbearbeiteten Lücken-Einsätze dieses TG werden mit gelöscht?
    const luecken = einsaetzeImJahr.filter(
      (e) => e.teilgebietId === teilgebietId && e.typ === 'ungeklärt' && !e.mitarbeiterId,
    );
    const vergangeneLuecken = luecken.filter((e) => istVergangeneKw(e.jahr, e.kw));
    const vergangenHinweis =
      vergangeneLuecken.length > 0
        ? `\n\n⚠ ${vergangeneLuecken.length} Lücken-Eintrag/Einträge liegt/liegen in vergangenen KWs — die Abrechnung dieser Wochen wird unmittelbar angepasst.`
        : '';
    if (
      !confirm(
        `Wechselplan für dieses Teilgebiet löschen?\n\n` +
          `Noch unbearbeitete Lücken-Einsätze werden ebenfalls entfernt; bereits gesetzte Springer bleiben in der Abrechnung erhalten.` +
          vergangenHinweis,
      )
    )
      return;
    setSaving(true);
    try {
      await loescheAustraegerwechselPlan(teilgebietId);
      // Unbearbeitete Lücken-Einsätze dieses TG mit aufräumen — Springer
      // (typ='springer' + MA) und manuell geklärte Ausfälle bleiben.
      for (const e of luecken) {
        await loescheEinsatz(e.id);
      }
      // L: Auto-Springer-Einsätze, die durch den Wechselplan entstanden
      // sind, ebenfalls entfernen — sie haben sonst keine Grundlage mehr.
      const autoEinsaetze = einsaetzeImJahr.filter(
        (e) => e.teilgebietId === teilgebietId && e.autoVomWechselplan === true,
      );
      for (const e of autoEinsaetze) {
        await loescheEinsatz(e.id);
      }
      onClose();
    } finally {
      setSaving(false);
    }
  }

  const aktuellerStandardName = tg.standardAustraegerId
    ? mitarbeiterById.get(tg.standardAustraegerId)?.name ?? '?'
    : '—';

  return (
    <Modal isOpen={true} onClose={onClose} title={`Standard-Wechsel — ${tg.name}`} size="md">
      <div className="space-y-3">
        <div className="text-xs text-gray-600">
          Aktueller Standardausträger: <strong>{aktuellerStandardName}</strong>
        </div>

        {istUnbesetztTg ? (
          <div className="rounded border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600">
            Teilgebiet ist aktuell <strong>unbesetzt</strong> — keine letzte
            Ausgabe eines bisherigen Austrägers anzugeben. Wechsel kann
            direkt mit „neuer Austräger" + „ab Ausgabe" geplant werden.
          </div>
        ) : (
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Letzte Ausgabe des bisherigen Austrägers *
            </label>
            <div className="flex gap-2">
              <select
                value={letzteJahr ?? ''}
                onChange={(e) => setLetzteJahr(e.target.value ? Number(e.target.value) : null)}
                className="border border-gray-300 rounded px-2 py-1.5 text-sm"
              >
                {jahrOptions.map((j) => (
                  <option key={j} value={j}>{j}</option>
                ))}
              </select>
              <select
                value={letzteKw ?? ''}
                onChange={(e) => setLetzteKw(e.target.value ? Number(e.target.value) : null)}
                className="border border-gray-300 rounded px-2 py-1.5 text-sm flex-1"
              >
                {letzteKwOptionen.length === 0 && (
                  <option value={letzteKw ?? ''}>— keine Zukunfts-KW in {letzteJahr} —</option>
                )}
                {letzteKwOptionen.map((k) => (
                  <option key={k} value={k}>KW {k}</option>
                ))}
              </select>
            </div>
          </div>
        )}

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">
            Neuer Standardausträger
          </label>
          <select
            value={neuerMa ?? ''}
            onChange={(e) => setNeuerMa(e.target.value || null)}
            className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
          >
            <option value="">— noch unbekannt —</option>
            {optionen.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
                {!m.teilgebietFreigaben?.includes(teilgebietId) ? ' (⚠ keine TG-Freigabe)' : ''}
              </option>
            ))}
          </select>
          <p className="text-[11px] text-gray-500 mt-0.5">
            {freigegeben.length === 0
              ? '⚠ Kein Austräger hat eine Freigabe für dieses TG.'
              : `${freigegeben.length} Austräger mit Freigabe für dieses TG.`}
          </p>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">
            Ab Ausgabe — ab dieser KW übernimmt der neue Austräger
          </label>
          <div className="flex gap-2">
            <select
              value={abJahr ?? ''}
              onChange={(e) => setAbJahr(e.target.value ? Number(e.target.value) : null)}
              className="border border-gray-300 rounded px-2 py-1.5 text-sm"
            >
              <option value="">—</option>
              {jahrOptions.map((j) => (
                <option key={j} value={j}>{j}</option>
              ))}
            </select>
            <select
              value={abKw ?? ''}
              onChange={(e) => setAbKw(e.target.value ? Number(e.target.value) : null)}
              className="border border-gray-300 rounded px-2 py-1.5 text-sm flex-1"
            >
              <option value="">—</option>
              {abKwOptionen.map((k) => (
                <option key={k} value={k}>KW {k}</option>
              ))}
            </select>
          </div>
          <p className="text-[11px] text-gray-500 mt-0.5">
            Bleibt leer → das TG gilt nach der „letzten Ausgabe" als dauerhaft unbesetzt.
          </p>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Kommentar</label>
          <textarea
            value={kommentar}
            onChange={(e) => setKommentar(e.target.value)}
            placeholder="optional — z. B. Übergabe-Notizen"
            className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
            rows={2}
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Externer Link</label>
          <div className="flex items-center gap-2">
            <input
              type="url"
              value={externerLink}
              onChange={(e) => setExternerLink(e.target.value)}
              placeholder="https://… (z. B. Mail-Thread)"
              className="flex-1 border border-gray-300 rounded px-2 py-1.5 text-sm"
            />
            {externerLink.trim() && (
              <a
                href={externerLink.trim()}
                target="_blank"
                rel="noreferrer"
                className="shrink-0 text-xs border border-blue-200 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded px-2 py-1.5"
                title="Link in neuem Tab öffnen"
              >
                🔗 öffnen
              </a>
            )}
          </div>
        </div>

        {error && <p className="text-red-600 text-sm whitespace-pre-line">{error}</p>}

        <div className="flex items-center gap-2 pt-2 border-t border-gray-100">
          <button
            type="button"
            onClick={speichern}
            disabled={saving}
            className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white font-medium px-3 py-1.5 rounded text-sm"
          >
            {saving ? 'Speichert…' : existing ? 'Speichern' : 'Anlegen'}
          </button>
          {existing && (
            <button
              type="button"
              onClick={loeschen}
              disabled={saving}
              className="text-red-600 hover:text-red-700 text-sm px-2"
            >
              Löschen
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="ml-auto text-gray-500 hover:text-gray-700 text-sm px-2"
          >
            Schließen
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ============================================================
// Ferien- / Feiertag-Zelle
// ============================================================

function FerienFeiertagZelle({ jahr, kw }: { jahr: number; kw: number }) {
  const ferien = ferienInKw(jahr, kw);
  const feiertage = feiertageInKw(jahr, kw);
  if (ferien.length === 0 && feiertage.length === 0) {
    return <div className="text-[10px] text-gray-200 text-center py-1">·</div>;
  }
  const tip = [
    ...ferien.map(
      (f) =>
        `Ferien: ${f.name}\n  ${new Date(f.von).toLocaleDateString('de-DE')} – ${new Date(f.bis).toLocaleDateString('de-DE')}`,
    ),
    ...feiertage.map(
      (f) =>
        `${f.scope === 'nds' ? 'NDS' : 'DE'}-Feiertag: ${f.name}\n  ${new Date(f.datum).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' })}`,
    ),
  ].join('\n\n');
  return (
    <div className="w-full py-0.5 px-1 leading-tight text-center" title={tip}>
      {ferien.length > 0 && (
        <div className="text-[10px] font-semibold text-purple-700 truncate">
          🏫 {ferien.map((f) => kuerzeFerienname(f.name)).join(', ')}
        </div>
      )}
      {feiertage.map((f) => (
        <div
          key={f.datum}
          className={`text-[10px] font-semibold truncate ${
            f.scope === 'nds' ? 'text-amber-700' : 'text-red-700'
          }`}
        >
          {f.scope === 'nds' ? '⛪' : '🔴'} {kuerzeFeiertagname(f.name)}
          <span className="ml-1 opacity-70 font-normal">
            {new Date(f.datum).toLocaleDateString('de-DE', { weekday: 'short' })}
          </span>
        </div>
      ))}
    </div>
  );
}

function kuerzeFerienname(name: string): string {
  return (
    {
      Winterferien: 'Winter',
      Osterferien: 'Ostern',
      Pfingstferien: 'Pfingsten',
      Sommerferien: 'Sommer',
      Herbstferien: 'Herbst',
      Weihnachtsferien: 'Weihn.',
    } as Record<string, string>
  )[name] ?? name;
}

function kuerzeFeiertagname(name: string): string {
  return (
    {
      'Neujahr': 'Neujahr',
      'Karfreitag': 'Karfr.',
      'Ostermontag': 'Ostermo.',
      'Tag der Arbeit': '1. Mai',
      'Christi Himmelfahrt': 'Chr. Himmelf.',
      'Pfingstmontag': 'Pfingstmo.',
      'Tag der Deutschen Einheit': '3. Okt.',
      'Reformationstag': 'Reform.',
      '1. Weihnachtstag': '1. Weihn.',
      '2. Weihnachtstag': '2. Weihn.',
    } as Record<string, string>
  )[name] ?? name;
}
