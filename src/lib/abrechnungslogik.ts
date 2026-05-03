// Kern-Abrechnungslogik für eine Abrechnungsperiode

import {
  collection,
  query,
  where,
  getDocs,
  orderBy,
} from 'firebase/firestore';
import { db } from './firebase';
import type {
  Mitarbeiter,
  Teilgebiet,
  TeilgebietSnapshot,
  Ausgabe,
  Beilage,
  Einsatz,
  Abrechnungsperiode,
  Parameter,
  Sondervereinbarung,
  Fahrt,
  Vorschuss,
  VariablerPeriodenZusatz,
  LohnkontoBuchung,
} from '../types';
import {
  berechneAustraegerLohn,
  ermittleStundenlohn,
  ermittleStundenlohnZusammen,
  berechneZusammentragZeit,
  type AustraegerLohnDetail,
} from './berechnung';
import { berechneNettoMinuten } from './zeiterfassung';
import { getISOWeek, getISOYear } from './kalender';
import type { Arbeitszeit, ZusammentragenEinsatz } from '../types';

// ---- Ergebnistypen -----------------------------------------

export interface AustraegerEinsatzErgebnis {
  kw: number;
  jahr: number;
  teilgebietId: string;
  teilgebietName: string;
  typ: 'standard' | 'springer';
  detail: AustraegerLohnDetail;
}

export interface AusgabenBonusErgebnis {
  id: string;
  ausgabeId: string;
  kw: number;
  jahr: number;
  minuten: number;
  kommentar?: string;
  /** Vergüteter Lohn = (minuten / 60) * stundenlohn */
  lohn: number;
}

export interface ZusammentragenErgebnis {
  ausgabeId: string;
  kw: number;
  teilgebietId?: string;
  teilgebietName?: string;
  /** Stückzahl des Teilgebiets (= Anzahl Exemplare). */
  stueckzahl?: number;
  stapelBearbeitet: number;
  istVorarbeit: boolean;
  lohn: number;
  stunden?: number;
  /** Anzahl interner Beilagen, die bei diesem Einsatz mit zusammengetragen wurden. */
  intBeilagenAnzahl?: number;
  /** Anzahl externer Beilagen des Teilgebiets (nur zur Info — nicht Teil des Zusammentrag-Lohns). */
  extBeilagenAnzahl?: number;
}

export interface MitarbeiterAbrechnung {
  mitarbeiter: Mitarbeiter;
  // Austräger
  austraegerEinsaetze: AustraegerEinsatzErgebnis[];
  austraegerGesamt: number;
  // Gewichtsvergütung (in austraegerGesamt bereits enthalten — hier aufgeschlüsselt)
  gewichtsbonusAnzeigenblatt: number;
  gewichtsbonusBeilagen: number;
  // Zusammentragen
  zusammentragenEinsaetze: ZusammentragenErgebnis[];
  zusammentragenGesamt: number;
  // Zeiterfassung (tatsächliche Zeiten, nur die gelohnten)
  arbeitszeiten: Arbeitszeit[];
  zeitStunden: number;
  zeitLohn: number;
  // Zeiten, die NICHT in den Lohn einfließen (zur Info-Anzeige)
  arbeitszeitenNichtAbgerechnet: Arbeitszeit[];
  // Fixes Gehalt
  fixesGehalt: number;
  // Fahrtkosten (neue Fahrt-Erfassung)
  fahrten: Fahrt[];
  fahrtSatzEurProKm: number;
  fahrtkostenGesamt: number;
  // Vorschüsse (Abschlagszahlungen)
  vorschuesse: Vorschuss[];
  vorschussSumme: number;
  // Variabler Periodenzusatz / Bonus
  bonus: number;
  bonusKommentar?: string;
  bonusId?: string;
  // Minuten-Boni je Ausgabe (Tätigkeitsbonus, z. B. „Betreuung Zusammenträger")
  ausgabenBoni: AusgabenBonusErgebnis[];
  ausgabenBoniMinutenGesamt: number;
  ausgabenBoniLohnGesamt: number;
  // Lohnkonto: Buchungen DIESER Periode (für Anzeige + Wirkung auf Brutto-Lohnbüro)
  lohnkontoBuchungenPeriode: LohnkontoBuchung[];
  /** Summe aller "Verschiebungen" dieser Periode (>= 0) — wird vom Brutto abgezogen. */
  lohnkontoVerschiebungPeriode: number;
  /** Summe aller "Verrechnungen" dieser Periode (>= 0) — wird zum Brutto addiert. */
  lohnkontoVerrechnungPeriode: number;
  /** Saldo VOR dieser Periode (alle Buchungen vorheriger Perioden). */
  lohnkontoSaldoVorPeriode: number;
  /** Saldo NACH dieser Periode = vor + Verschiebung − Verrechnung. */
  lohnkontoSaldoNachPeriode: number;
  // Gesamt (brutto, intern berechnet — VOR Lohnkonto-Verschiebung)
  gesamt: number;
  /**
   * Brutto, der an das Lohnbüro übermittelt wird:
   * = gesamt − lohnkontoVerschiebungPeriode + lohnkontoVerrechnungPeriode
   * Dies ist auch die Basis für die Auszahlung der SV-befreiten MA.
   */
  bruttoLohnbuero: number;
}

// ---- Daten für eine Periode laden --------------------------

export interface PeriodeData {
  ausgaben: Ausgabe[];
  beilagen: Beilage[];
  einsaetze: Einsatz[];
  arbeitszeiten: Arbeitszeit[];
  zusammentragenEinsaetze: ZusammentragenEinsatz[];
  fahrten: Fahrt[];
  vorschuesse: Vorschuss[];
  sondervereinbarungen: Sondervereinbarung[];
}

export async function ladePeriodeData(
  periode: Abrechnungsperiode
): Promise<PeriodeData> {
  const kwSet = new Set(periode.kalenderwochen);

  // Alle Ausgaben dieser Periode
  const ausgabenSnap = await getDocs(
    query(
      collection(db, 'ausgaben'),
      where('jahr', '==', periode.jahr),
      where('kw', 'in', [...kwSet].length > 0 ? [...kwSet] : [-1])
    )
  );
  const ausgaben = ausgabenSnap.docs.map(
    (d) => ({ id: d.id, ...d.data() } as Ausgabe)
  );
  const ausgabeIds = ausgaben.map((a) => a.id);

  // Alle Einsätze dieser Ausgaben
  let einsaetze: Einsatz[] = [];
  if (ausgabeIds.length > 0) {
    for (let i = 0; i < ausgabeIds.length; i += 30) {
      const chunk = ausgabeIds.slice(i, i + 30);
      const snap = await getDocs(
        query(collection(db, 'einsaetze'), where('ausgabeId', 'in', chunk))
      );
      einsaetze.push(...snap.docs.map((d) => ({ id: d.id, ...d.data() } as Einsatz)));
    }
  }

  // Beilagen dieser Ausgaben
  let beilagen: Beilage[] = [];
  if (ausgabeIds.length > 0) {
    for (let i = 0; i < ausgabeIds.length; i += 30) {
      const chunk = ausgabeIds.slice(i, i + 30);
      const snap = await getDocs(
        query(collection(db, 'beilagen'), where('ausgabeId', 'in', chunk))
      );
      beilagen.push(...snap.docs.map((d) => ({ id: d.id, ...d.data() } as Beilage)));
    }
  }

  // Arbeitszeiten des Perioden-Monats
  const von = new Date(periode.jahr, periode.monat - 1, 1).getTime();
  const bis = new Date(periode.jahr, periode.monat, 1).getTime();
  const azSnap = await getDocs(
    query(
      collection(db, 'arbeitszeiten'),
      where('startTime', '>=', von),
      where('startTime', '<', bis),
      orderBy('startTime', 'asc')
    )
  );
  const arbeitszeiten = azSnap.docs.map(
    (d) => ({ id: d.id, ...d.data() } as Arbeitszeit)
  );

  // Zusammentragen-Einsätze dieser Ausgaben
  let zusammentragenEinsaetze: ZusammentragenEinsatz[] = [];
  if (ausgabeIds.length > 0) {
    for (let i = 0; i < ausgabeIds.length; i += 30) {
      const chunk = ausgabeIds.slice(i, i + 30);
      const snap = await getDocs(
        query(collection(db, 'zusammentragezeiten'), where('ausgabeId', 'in', chunk))
      );
      zusammentragenEinsaetze.push(
        ...snap.docs.map((d) => ({ id: d.id, ...d.data() } as ZusammentragenEinsatz))
      );
    }
  }

  // Fahrten dieser Abrechnungsperiode
  const fahrtenSnap = await getDocs(
    query(collection(db, 'fahrten'), where('abrechnungsperiodeId', '==', periode.id))
  );
  const fahrten = fahrtenSnap.docs.map(
    (d) => ({ id: d.id, ...d.data() } as Fahrt)
  );

  // Vorschüsse dieser Abrechnungsperiode
  const vorschussnap = await getDocs(
    query(collection(db, 'vorschuesse'), where('abrechnungsperiodeId', '==', periode.id))
  );
  const vorschuesse = vorschussnap.docs.map(
    (d) => ({ id: d.id, ...d.data() } as Vorschuss)
  );

  // Sondervereinbarungen (alle, gefiltert in der Berechnung)
  const svSnap = await getDocs(collection(db, 'sondervereinbarungen'));
  const sondervereinbarungen = svSnap.docs.map(
    (d) => ({ id: d.id, ...d.data() } as Sondervereinbarung)
  );

  return { ausgaben, beilagen, einsaetze, arbeitszeiten, zusammentragenEinsaetze, fahrten, vorschuesse, sondervereinbarungen };
}

// ---- Abrechnung berechnen ----------------------------------

export function berechneAbrechnung(
  mitarbeiterListe: Mitarbeiter[],
  teilgebiete: Teilgebiet[] | TeilgebietSnapshot[],
  data: PeriodeData,
  params: Parameter,
  periode?: Abrechnungsperiode,
  variablePeriodenZusaetze: VariablerPeriodenZusatz[] = [],
  alleAbrechnungsperioden: Abrechnungsperiode[] = [],
  alleLohnkontoBuchungen: LohnkontoBuchung[] = []
): MitarbeiterAbrechnung[] {
  // Snapshots nur für ABGESCHLOSSENE Perioden anwenden — solange eine Periode
  // offen ist, sollen Parameter- und Teilgebiet-Änderungen weiterhin in die
  // Berechnung einfließen.
  const istAbgeschlossen = periode?.status === 'abgeschlossen';

  const effParams: Parameter = istAbgeschlossen && periode?.paramSnapshot
    ? { ...params, ...periode.paramSnapshot }
    : params;

  const effTeilgebiete: (Teilgebiet | TeilgebietSnapshot)[] =
    istAbgeschlossen && periode?.periodeSnapshot?.teilgebietSnapshots?.length
      ? periode.periodeSnapshot.teilgebietSnapshots
      : teilgebiete;

  const ergebnisse: MitarbeiterAbrechnung[] = [];

  const periodeId = periode?.id;

  // IDs aller Perioden, die zeitlich VOR der aktuellen Periode liegen.
  // Wird für die Saldo-Berechnung des Lohnkontos benötigt.
  const periodeIdsVorAktueller = new Set<string>();
  if (periode) {
    for (const p of alleAbrechnungsperioden) {
      if (p.id === periode.id) continue;
      const isFrueher =
        p.jahr < periode.jahr ||
        (p.jahr === periode.jahr && p.monat < periode.monat);
      if (isFrueher) periodeIdsVorAktueller.add(p.id);
    }
  }

  function berechneLohnkontoFuer(maId: string) {
    const buchungenMa = alleLohnkontoBuchungen.filter((b) => b.mitarbeiterId === maId);
    const periode_ = periodeId
      ? buchungenMa.filter((b) => b.abrechnungsperiodeId === periodeId)
      : [];
    const verschiebungPeriode = periode_
      .filter((b) => b.art === 'verschiebung')
      .reduce((s, b) => s + b.betragEur, 0);
    const verrechnungPeriode = periode_
      .filter((b) => b.art === 'verrechnung')
      .reduce((s, b) => s + b.betragEur, 0);
    const saldoVor = buchungenMa
      .filter((b) => periodeIdsVorAktueller.has(b.abrechnungsperiodeId))
      .reduce(
        (s, b) => s + (b.art === 'verschiebung' ? b.betragEur : -b.betragEur),
        0
      );
    const saldoNach = saldoVor + verschiebungPeriode - verrechnungPeriode;
    return {
      lohnkontoBuchungenPeriode: periode_,
      lohnkontoVerschiebungPeriode: verschiebungPeriode,
      lohnkontoVerrechnungPeriode: verrechnungPeriode,
      lohnkontoSaldoVorPeriode: saldoVor,
      lohnkontoSaldoNachPeriode: saldoNach,
    };
  }

  for (const ma of mitarbeiterListe) {
    if (!ma.isActive) continue;

    // --- Fahrtkosten (werden IMMER berechnet, unabhängig vom Modell) ---
    const maFahrten = data.fahrten.filter((f) => f.mitarbeiterId === ma.id);
    const fahrtSatz = ma.fahrkostenEurProKm ?? effParams.fahrkostenEurProKm ?? 0.30;
    const fahrtkostenGesamt = maFahrten.reduce(
      (s, f) => s + f.streckKm * fahrtSatz, 0
    );

    // --- Vorschüsse ---
    const maVorschuesse = data.vorschuesse.filter((v) => v.mitarbeiterId === ma.id);
    const vorschussSumme = maVorschuesse.reduce((s, v) => s + v.betragEur, 0);

    // --- Variabler Periodenzusatz / Bonus ---
    const zusatz = periodeId
      ? variablePeriodenZusaetze.find(
          (z) => z.mitarbeiterId === ma.id && z.abrechnungsperiodeId === periodeId
        )
      : undefined;
    const bonus = zusatz?.betragEur ?? 0;
    const bonusKommentar = zusatz?.kommentar;
    const bonusId = zusatz?.id;

    const stundenlohn = ermittleStundenlohn(ma, effParams);

    // --- Ausgaben-Boni (pauschaler Tätigkeitsbonus aus Mitarbeiter-Stammdaten) ---
    // `ausgabenBonusMinuten` am MA gilt PRO Ausgabe der Periode. Wir erzeugen
    // pro Ausgabe einen Detail-Eintrag und summieren über alle.
    const bonusMinutenProAusgabe = ma.ausgabenBonusMinuten ?? 0;
    const ausgabenBoniDetails: AusgabenBonusErgebnis[] = [];
    if (bonusMinutenProAusgabe > 0) {
      const sortedAusgaben = [...data.ausgaben].sort((a, b) =>
        a.jahr !== b.jahr ? a.jahr - b.jahr : a.kw - b.kw
      );
      for (const ausgabe of sortedAusgaben) {
        ausgabenBoniDetails.push({
          id: `${ma.id}-${ausgabe.id}`,
          ausgabeId: ausgabe.id,
          kw: ausgabe.kw,
          jahr: ausgabe.jahr,
          minuten: bonusMinutenProAusgabe,
          kommentar: ma.ausgabenBonusKommentar,
          lohn: (bonusMinutenProAusgabe / 60) * stundenlohn,
        });
      }
    }
    const ausgabenBoniMinutenGesamt = ausgabenBoniDetails.reduce((s, e) => s + e.minuten, 0);
    const ausgabenBoniLohnGesamt = ausgabenBoniDetails.reduce((s, e) => s + e.lohn, 0);

    // =======================================================
    // FESTGEHALT-MITARBEITER — absoluter Override
    // =======================================================
    if (ma.hatFestgehalt) {
      const fixesGehalt = ma.festgehaltEur ?? ma.fixesGehalt ?? 0;
      const gesamt = fixesGehalt + bonus + fahrtkostenGesamt + ausgabenBoniLohnGesamt;
      const lk = berechneLohnkontoFuer(ma.id);
      const bruttoLohnbuero =
        gesamt - lk.lohnkontoVerschiebungPeriode + lk.lohnkontoVerrechnungPeriode;
      if (
        fixesGehalt > 0 ||
        bonus !== 0 ||
        fahrtkostenGesamt > 0 ||
        maVorschuesse.length > 0 ||
        lk.lohnkontoBuchungenPeriode.length > 0 ||
        lk.lohnkontoSaldoVorPeriode !== 0 ||
        ausgabenBoniDetails.length > 0
      ) {
        // Auch bei Festgehalt: alle Arbeitszeiten informativ anzeigen
        const festArbeitszeiten = data.arbeitszeiten.filter(
          (a) => a.mitarbeiterId === ma.id && a.status === 'abgeschlossen'
        );
        ergebnisse.push({
          mitarbeiter: ma,
          austraegerEinsaetze: [],
          austraegerGesamt: 0,
          gewichtsbonusAnzeigenblatt: 0,
          gewichtsbonusBeilagen: 0,
          zusammentragenEinsaetze: [],
          zusammentragenGesamt: 0,
          arbeitszeiten: [],
          zeitStunden: 0,
          zeitLohn: 0,
          arbeitszeitenNichtAbgerechnet: festArbeitszeiten,
          fixesGehalt,
          fahrten: maFahrten,
          fahrtSatzEurProKm: fahrtSatz,
          fahrtkostenGesamt,
          vorschuesse: maVorschuesse,
          vorschussSumme,
          bonus,
          bonusKommentar,
          bonusId,
          ausgabenBoni: ausgabenBoniDetails,
          ausgabenBoniMinutenGesamt,
          ausgabenBoniLohnGesamt,
          ...lk,
          gesamt,
          bruttoLohnbuero,
        });
      }
      continue;
    }

    // =======================================================
    // VARIABLE ABRECHNUNG (ohne Festgehalt)
    // Alle Berechnungen hängen NICHT von den Rollen ab!
    // =======================================================

    // --- Austragen: rechnerisch (Teilgebiete + Parameter) ---
    const austraegerEinsaetze: AustraegerEinsatzErgebnis[] = [];

    if (!effParams.austragenNachIstZeit) {
      // Explizite Springer-Einsätze
      const springerEinsaetze = data.einsaetze.filter(
        (e) => e.mitarbeiterId === ma.id && e.typ === 'springer'
      );

      for (const einsatz of springerEinsaetze) {
        const ausgabe = data.ausgaben.find((a) => a.id === einsatz.ausgabeId);
        const tg = effTeilgebiete.find((t) => t.id === einsatz.teilgebietId);
        if (!ausgabe || !tg) continue;

        const beilagenFuerAusgabe = data.beilagen.filter(
          (b) => b.ausgabeId === ausgabe.id
        );
        const sv = data.sondervereinbarungen.find(
          (s) => s.mitarbeiterId === ma.id && s.teilgebietId === tg.id
        );

        const detail = berechneAustraegerLohn(
          ma, tg as Teilgebiet, ausgabe, beilagenFuerAusgabe, einsatz, sv, effParams
        );
        austraegerEinsaetze.push({
          kw: einsatz.kw,
          jahr: einsatz.jahr,
          teilgebietId: tg.id,
          teilgebietName: tg.name,
          typ: 'springer',
          detail,
        });
      }

      // Standard-Austräger: Teilgebiete wo dieser MA Standardausträger ist
      const meineGebiete = effTeilgebiete.filter(
        (tg) => (tg as Teilgebiet).standardAustraegerId === ma.id &&
                (tg as Teilgebiet).isActive !== false
      );

      for (const tg of meineGebiete) {
        for (const ausgabe of data.ausgaben) {
          const expliziterEinsatz = data.einsaetze.find(
            (e) => e.ausgabeId === ausgabe.id && e.teilgebietId === tg.id
          );

          if (expliziterEinsatz) {
            if (
              expliziterEinsatz.typ === 'ausfall' ||
              expliziterEinsatz.typ === 'ungeklärt' ||
              expliziterEinsatz.typ === 'springer'
            ) {
              continue;
            }
          }

          const fakeEinsatz: Einsatz = {
            id: '',
            ausgabeId: ausgabe.id,
            kw: ausgabe.kw,
            jahr: ausgabe.jahr,
            teilgebietId: tg.id,
            mitarbeiterId: ma.id,
            typ: 'standard',
            erstelltAm: 0,
            aktualisiertAm: 0,
          };

          const beilagenFuerAusgabe = data.beilagen.filter(
            (b) => b.ausgabeId === ausgabe.id
          );
          const sv = data.sondervereinbarungen.find(
            (s) => s.mitarbeiterId === ma.id && s.teilgebietId === tg.id
          );

          const detail = berechneAustraegerLohn(
            ma, tg as Teilgebiet, ausgabe, beilagenFuerAusgabe, fakeEinsatz, sv, effParams
          );
          austraegerEinsaetze.push({
            kw: ausgabe.kw,
            jahr: ausgabe.jahr,
            teilgebietId: tg.id,
            teilgebietName: tg.name,
            typ: 'standard',
            detail,
          });
        }
      }
    }

    const austraegerGesamt = austraegerEinsaetze.reduce(
      (s, e) => s + e.detail.gesamt, 0
    );
    const gewichtsbonusAnzeigenblatt = austraegerEinsaetze.reduce(
      (s, e) => s + (e.detail.gewichtsbonusAnzeigenblatt ?? 0), 0
    );
    const gewichtsbonusBeilagen = austraegerEinsaetze.reduce(
      (s, e) => s + (e.detail.gewichtsbonusBeilagen ?? 0), 0
    );

    // --- Zusammentragen: rechnerisch (Stapel × 0.25h × Stundenlohn) ---
    const zusammentragenEinsaetze: ZusammentragenErgebnis[] = [];

    if (!effParams.zusammentragenNachIstZeit) {
      const maZusammen = data.zusammentragenEinsaetze.filter(
        (z) => z.mitarbeiterId === ma.id
      );

      for (const z of maZusammen) {
        const ausgabe = data.ausgaben.find((a) => a.id === z.ausgabeId);
        if (!ausgabe) continue;

        if (z.istVorarbeit && !ausgabe.vorarbeitFreigegeben) {
          continue;
        }

        if (z.istVorarbeit && z.vorarbeitMinuten != null && z.vorarbeitMinuten > 0) {
          const tgV = effTeilgebiete.find((t) => t.id === z.teilgebietId) as
            | Teilgebiet
            | undefined;
          const stunden = z.vorarbeitMinuten / 60;
          const lohn = stunden * ermittleStundenlohnZusammen(ma, effParams);
          zusammentragenEinsaetze.push({
            ausgabeId: z.ausgabeId,
            kw: ausgabe.kw,
            teilgebietId: z.teilgebietId,
            teilgebietName: tgV?.name,
            stueckzahl: tgV?.stueckzahl,
            stapelBearbeitet: z.stapelBearbeitet,
            istVorarbeit: true,
            lohn,
            stunden,
          });
        } else if (!z.istVorarbeit) {
          const tg = effTeilgebiete.find((t) => t.id === z.teilgebietId) as
            | Teilgebiet
            | undefined;
          if (!tg) continue;

          // Interne Beilagen dieser Ausgabe, die dieses Teilgebiet betreffen
          const intBeilagen = data.beilagen.filter(
            (b) =>
              b.ausgabeId === z.ausgabeId &&
              b.kennzeichen === 'int' &&
              b.teilgebietIds.includes(z.teilgebietId)
          ).length;
          // Externe Beilagen (nur zur Anzeige, nicht Teil des Zusammentragen-Lohns)
          const extBeilagen = data.beilagen.filter(
            (b) =>
              b.ausgabeId === z.ausgabeId &&
              b.kennzeichen === 'ext' &&
              b.teilgebietIds.includes(z.teilgebietId)
          ).length;

          // Anzahl Stapel aus der Ausgabe (manuell gepflegtes Feld, NICHT neu berechnen)
          const stapelAnzeige = ausgabe.stapelAnzahl || 0;
          const stunden = berechneZusammentragZeit(
            tg.stueckzahl,
            stapelAnzeige,
            intBeilagen,
            effParams
          );
          const lohnZt = ermittleStundenlohnZusammen(ma, effParams);
          const lohn = stunden * lohnZt;

          zusammentragenEinsaetze.push({
            ausgabeId: z.ausgabeId,
            kw: ausgabe.kw,
            teilgebietId: z.teilgebietId,
            teilgebietName: tg.name,
            stueckzahl: tg.stueckzahl,
            stapelBearbeitet: stapelAnzeige,
            istVorarbeit: false,
            lohn,
            stunden,
            intBeilagenAnzahl: intBeilagen,
            extBeilagenAnzahl: extBeilagen,
          });
        }
      }
    }
    const zusammentragenGesamt = zusammentragenEinsaetze.reduce(
      (s, z) => s + z.lohn, 0
    );

    // --- Zeiterfassung: Ist-Zeiten nach Typ filtern ---
    // austragen   → nur wenn austragenNachIstZeit === true
    // zusammentragen → nur wenn zusammentragenNachIstZeit === true
    // vorarbeit   → nur wenn Ausgabe dieser Zeit vorarbeitFreigegeben === true
    //               (Zuordnung: Datum der Arbeitszeit fällt in KW einer freigegebenen Ausgabe)
    // sonstige    → IMMER
    const maArbeitszeitenAll = data.arbeitszeiten.filter(
      (a) => a.mitarbeiterId === ma.id && a.status === 'abgeschlossen'
    );

    // Vorarbeit wird nur dann abgerechnet, wenn die konkrete zugeordnete Ausgabe
    // das Kennzeichen "Vorarbeit erlaubt" gesetzt hat.
    const ausgabenFreigegebenMap = new Map<string, boolean>(
      data.ausgaben.map((a) => [a.id, !!a.vorarbeitFreigegeben])
    );

    const maArbeitszeiten = maArbeitszeitenAll.filter((a) => {
      switch (a.typ) {
        case 'austragen':
          return effParams.austragenNachIstZeit === true;
        case 'zusammentragen':
          return effParams.zusammentragenNachIstZeit === true;
        case 'vorarbeit':
          return a.ausgabeId ? ausgabenFreigegebenMap.get(a.ausgabeId) === true : false;
        case 'sonstige':
          return true;
        default:
          return false;
      }
    });
    const maArbeitszeitenNichtAbgerechnet = maArbeitszeitenAll.filter(
      (a) => !maArbeitszeiten.includes(a)
    );

    const zeitMinuten = maArbeitszeiten.reduce(
      (s, a) => s + berechneNettoMinuten(a), 0
    );
    const zeitStunden = zeitMinuten / 60;
    const zeitLohn = zeitStunden * stundenlohn;

    // --- Gesamt ---
    const gesamt =
      austraegerGesamt +
      zusammentragenGesamt +
      zeitLohn +
      fahrtkostenGesamt +
      bonus +
      ausgabenBoniLohnGesamt;

    const lk = berechneLohnkontoFuer(ma.id);
    const bruttoLohnbuero =
      gesamt - lk.lohnkontoVerschiebungPeriode + lk.lohnkontoVerrechnungPeriode;

    if (
      gesamt !== 0 ||
      austraegerEinsaetze.length > 0 ||
      zusammentragenEinsaetze.length > 0 ||
      maArbeitszeiten.length > 0 ||
      maArbeitszeitenNichtAbgerechnet.length > 0 ||
      maVorschuesse.length > 0 ||
      bonus !== 0 ||
      lk.lohnkontoBuchungenPeriode.length > 0 ||
      lk.lohnkontoSaldoVorPeriode !== 0 ||
      ausgabenBoniDetails.length > 0
    ) {
      ergebnisse.push({
        mitarbeiter: ma,
        austraegerEinsaetze,
        austraegerGesamt,
        gewichtsbonusAnzeigenblatt,
        gewichtsbonusBeilagen,
        zusammentragenEinsaetze,
        zusammentragenGesamt,
        arbeitszeiten: maArbeitszeiten,
        zeitStunden,
        zeitLohn,
        arbeitszeitenNichtAbgerechnet: maArbeitszeitenNichtAbgerechnet,
        fixesGehalt: 0,
        fahrten: maFahrten,
        fahrtSatzEurProKm: fahrtSatz,
        fahrtkostenGesamt,
        vorschuesse: maVorschuesse,
        vorschussSumme,
        bonus,
        bonusKommentar,
        bonusId,
        ausgabenBoni: ausgabenBoniDetails,
        ausgabenBoniMinutenGesamt,
        ausgabenBoniLohnGesamt,
        ...lk,
        gesamt,
        bruttoLohnbuero,
      });
    }
  }

  return ergebnisse.sort((a, b) =>
    a.mitarbeiter.name.localeCompare(b.mitarbeiter.name)
  );
}

// ---- Helper: Periodenstatus für einen Zeitraum prüfen --------
//
// Liefert die ERSTE abgeschlossene Periode, die einen beliebigen Tag im
// Zeitraum [startMs, endMs] berührt, sonst null. Wird verwendet, um den
// Mitarbeiter zu warnen, wenn er Arbeitszeiten in einem bereits gesperrten
// Monat erfasst — die Speicherung bleibt erlaubt, fließt aber nicht mehr in
// die schon gerechnete Abrechnung ein.

export function findAbgeschlossenePeriodeFuerZeitraum(
  perioden: Abrechnungsperiode[],
  startMs: number,
  endMs: number
): Abrechnungsperiode | null {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return null;
  if (endMs < startMs) return null;
  const abgeschlossene = perioden.filter((p) => p.status === 'abgeschlossen');
  if (abgeschlossene.length === 0) return null;

  const ONE_DAY = 24 * 60 * 60 * 1000;
  // Schritt für Schritt jeden Kalendertag prüfen — KWs können beim
  // Jahreswechsel über mehrere Tage hinweg unterschiedlich ausfallen.
  for (let t = startMs; t <= endMs; t += ONE_DAY) {
    const d = new Date(t);
    const jahr = getISOYear(d);
    const kw = getISOWeek(d);
    const found = abgeschlossene.find(
      (p) => p.jahr === jahr && p.kalenderwochen.includes(kw)
    );
    if (found) return found;
  }
  // Falls die Schleife den End-Zeitpunkt nicht traf:
  const dEnd = new Date(endMs);
  return (
    abgeschlossene.find(
      (p) =>
        p.jahr === getISOYear(dEnd) && p.kalenderwochen.includes(getISOWeek(dEnd))
    ) ?? null
  );
}

// ---- Formatierung ------------------------------------------

export function eur(betrag: number): string {
  return betrag.toLocaleString('de-DE', {
    style: 'currency',
    currency: 'EUR',
  });
}

export function stdMin(stunden: number): string {
  const h = Math.floor(stunden);
  const m = Math.round((stunden - h) * 60);
  return `${h}:${m.toString().padStart(2, '0')} h`;
}
