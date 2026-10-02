// Abrechnungsvorschau Aus-& Zusammentragen
// Einzel-MA-Vorschau für eine Abrechnungsperiode, optional erweitert um
// zusätzliche Teilgebiete (Was-wäre-wenn). Nützlich z. B. um einem
// Interessenten zu zeigen, was er verdienen würde, wenn er ein bestimmtes
// Gebiet übernähme. Dritter Bereich „Teilgebiet auswerten": Gebiets-
// beschreibung + Verdienstmöglichkeiten für Interessenten (A4/PDF).

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useApp } from '../context/AppContext';
import AdminPinGate from '../components/AdminPinGate';
import TeilgebietAuswertung from '../components/TeilgebietAuswertung';
import AbrechnungsAufschluesselung, {
  type AufschluesselungKontext,
  type Vertretung,
} from '../components/AbrechnungsAufschluesselung';
import {
  ladePeriodeData,
  berechneAbrechnung,
  effektiveParameter,
  effektiveTeilgebiete,
  eur,
  stdMin,
  type MitarbeiterAbrechnung,
} from '../lib/abrechnungslogik';
import { ladeFahrten } from '../lib/db';
import {
  berechneAustraegerLohn,
  ermittleStundenlohn,
} from '../lib/berechnung';
import type {
  Mitarbeiter,
  Teilgebiet,
  Ausgabe,
  Beilage,
  Einsatz,
  Fahrt,
  Rolle,
  InteresseTaetigkeit,
} from '../types';
import { ROLLEN_LABELS, INTERESSE_TAETIGKEIT_LABELS } from '../types';
import { istInSaisonpauseFuer } from '../lib/saison';

const ALLE_INTERESSE_TAETIGKEITEN = Object.keys(INTERESSE_TAETIGKEIT_LABELS) as InteresseTaetigkeit[];

// ---- Typen für den manuellen Modus -----------------------

interface ManuellesErgebnis {
  alter: number;
  istMinderjaehrig: boolean;
  stundenlohn: number;
  anzAusgaben: number;
  /** Pro EINE Ausgabe: */
  zeitStundenJeAusgabe: number;
  grundlohnJeAusgabe: number;
  gewichtKgJeAusgabeAnzeigenblatt: number;
  gewichtKgJeAusgabeBeilagen: number;
  gewichtsbonusAnzeigenblattJeAusgabe: number;
  gewichtsbonusBeilagenJeAusgabe: number;
  gesamtJeAusgabe: number;
  /** Über alle Ausgaben: */
  grundlohnGesamt: number;
  gewichtsbonusAnzeigenblattGesamt: number;
  gewichtsbonusBeilagenGesamt: number;
  bonusZeiterfassungGesamt: number;
  gesamt: number;
}

export default function AbrechnungsvorschauScreen() {
  return (
    <AdminPinGate allowedRoles={['admin', 'abrechnung']}>
      <AbrechnungsvorschauInhalt />
    </AdminPinGate>
  );
}

function AbrechnungsvorschauInhalt() {
  const { mitarbeiter, teilgebiete, touren, abrechnungsperioden, parameter, variablePeriodenZusaetze, lohnkontoBuchungen } = useApp();

  const [modus, setModus] = useState<'ma' | 'manuell' | 'tg'>('ma');
  const [maId, setMaId] = useState('');
  const [periodeId, setPeriodeId] = useState('');
  const [extraTgIds, setExtraTgIds] = useState<string[]>([]);
  // Teilgebiets-Auswahl nur nach „Ja" auf die Simulations-Frage einblenden.
  const [simulationGewuenscht, setSimulationGewuenscht] = useState(false);
  const [loading, setLoading] = useState(false);
  const [fehler, setFehler] = useState('');
  const [ergebnis, setErgebnis] = useState<MitarbeiterAbrechnung | null>(null);
  const [periodeOhneZusatz, setPeriodeOhneZusatz] = useState<MitarbeiterAbrechnung | null>(null);
  const [vertretungen, setVertretungen] = useState<Vertretung[]>([]);
  const [kontext, setKontext] = useState<AufschluesselungKontext | null>(null);
  const [tgFilter, setTgFilter] = useState('');

  // ---- Manueller Modus -----------------------------------
  const [manAlter, setManAlter] = useState('25');
  const [manWegstreckeM, setManWegstreckeM] = useState('1500');
  const [manStueckzahl, setManStueckzahl] = useState('250');
  const [manAnzAusgaben, setManAnzAusgaben] = useState('4');
  const [manSeitenzahl, setManSeitenzahl] = useState('16');
  const [manAnzBeilagen, setManAnzBeilagen] = useState('0');
  const [manBeilageGramm, setManBeilageGramm] = useState('20');
  const [manOnline, setManOnline] = useState(true);
  const [manErgebnis, setManErgebnis] = useState<ManuellesErgebnis | null>(null);

  // MA-Kandidaten: Austräger, Zusammenträger oder Interessenten — auch
  // inaktive bewusst zulassen, damit Vorschauen für deinteressierte MAs
  // oder ausgeschiedene Austräger möglich bleiben.
  const maKandidaten = useMemo(() => {
    return [...mitarbeiter]
      .filter((m) => {
        if (m.istInteressent) return true;
        if (m.rollen?.includes('austräger')) return true;
        if (m.rollen?.includes('zusammenträger')) return true;
        return false;
      })
      .sort((a, b) => a.name.localeCompare(b.name, 'de'));
  }, [mitarbeiter]);

  // Such-/Filtermaske für die MA-Auswahl — analog zum MitarbeiterScreen.
  const [filterText, setFilterText] = useState('');
  const [filterOrtPlz, setFilterOrtPlz] = useState('');
  const [filterRolle, setFilterRolle] = useState<Rolle | ''>('');
  const [filterMinijob, setFilterMinijob] = useState<'' | 'ja' | 'nein'>('');
  const [filterSvFrei, setFilterSvFrei] = useState<'' | 'ja' | 'nein'>('');
  const [filterAnmeldung, setFilterAnmeldung] = useState<'' | 'offen' | 'angemeldet' | 'abgemeldet'>('');
  const [filterFahrtkosten, setFilterFahrtkosten] = useState<'' | 'ja' | 'nein'>('');
  const [filterInteressent, setFilterInteressent] = useState<'' | 'nur' | 'ohne'>('');
  const [filterInteresseTaetigkeit, setFilterInteresseTaetigkeit] = useState<InteresseTaetigkeit | ''>('');
  const [nurAktive, setNurAktive] = useState(true);
  // Nach Auswahl eines MA werden Filter + Liste eingeklappt.
  const [listeEingeklappt, setListeEingeklappt] = useState(false);

  function waehleMa(id: string) {
    setMaId(id);
    setListeEingeklappt(true);
  }

  const gefilterteMa = useMemo(() => {
    return maKandidaten.filter((m) => {
      if (filterInteressent === 'ohne' && m.istInteressent) return false;
      if (filterInteressent === 'nur' && !m.istInteressent) return false;
      if (filterInteresseTaetigkeit) {
        if (!m.istInteressent) return false;
        if (!(m.interesseTaetigkeiten ?? []).includes(filterInteresseTaetigkeit)) return false;
      }
      if (nurAktive) {
        if (m.istInteressent) {
          if (m.interessentDeinteressiert) return false;
        } else if (!m.isActive) return false;
      }
      if (filterText
        && !m.name.toLowerCase().includes(filterText.toLowerCase())
        && !m.nummer.includes(filterText)) return false;
      if (filterOrtPlz.trim()) {
        const q = filterOrtPlz.trim().toLowerCase();
        const plz = (m.adresse?.plz ?? '').toLowerCase();
        const ort = (m.adresse?.ort ?? '').toLowerCase();
        if (!plz.includes(q) && !ort.includes(q)) return false;
      }
      // Wie im MitarbeiterScreen: bei „nur Interessenten" greifen die
      // übrigen Filter nicht.
      if (filterInteressent !== 'nur') {
        if (filterRolle && !(m.rollen ?? []).includes(filterRolle)) return false;
        if (filterMinijob === 'ja' && !m.istMinijob) return false;
        if (filterMinijob === 'nein' && m.istMinijob) return false;
        if (filterSvFrei === 'ja' && !m.sozialversicherungsBefreit) return false;
        if (filterSvFrei === 'nein' && m.sozialversicherungsBefreit) return false;
        if (filterAnmeldung === 'offen' && !m.nochNichtAngemeldet) return false;
        if (filterAnmeldung === 'angemeldet' && (m.nochNichtAngemeldet || m.abgemeldet)) return false;
        if (filterAnmeldung === 'abgemeldet' && !m.abgemeldet) return false;
        if (filterFahrtkosten === 'ja' && !m.fahrtkostenerstattung) return false;
        if (filterFahrtkosten === 'nein' && m.fahrtkostenerstattung) return false;
      }
      return true;
    });
  }, [
    maKandidaten, filterInteressent, filterInteresseTaetigkeit, nurAktive, filterText,
    filterOrtPlz, filterRolle, filterMinijob, filterSvFrei, filterAnmeldung, filterFahrtkosten,
  ]);

  const anzInaktiveKandidaten = maKandidaten.filter((m) =>
    m.istInteressent ? m.interessentDeinteressiert : !m.isActive
  ).length;

  // Sortierte Perioden (neueste zuerst).
  const perioden = useMemo(
    () => [...abrechnungsperioden].sort((a, b) => b.jahr !== a.jahr ? b.jahr - a.jahr : b.monat - a.monat),
    [abrechnungsperioden]
  );

  // TG-Auswahl: aktive TGs ohne Auslagestelle, sortiert; Filter über Eingabe.
  const aktiveTgs = useMemo(() => {
    return [...teilgebiete]
      .filter((t) => t.isActive && !t.istAuslagestelle)
      .sort((a, b) => a.name.localeCompare(b.name, 'de', { numeric: true }));
  }, [teilgebiete]);

  const gefilterteTgs = useMemo(() => {
    if (!tgFilter.trim()) return aktiveTgs;
    const q = tgFilter.trim().toLowerCase();
    return aktiveTgs.filter((t) =>
      t.name.toLowerCase().includes(q) || (t.plz ?? '').includes(q)
    );
  }, [aktiveTgs, tgFilter]);

  function toggleTg(id: string) {
    setExtraTgIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  }

  async function handleBerechnen() {
    setFehler('');
    setErgebnis(null);
    setPeriodeOhneZusatz(null);
    setKontext(null);
    if (!maId) { setFehler('Bitte einen Mitarbeiter wählen.'); return; }
    if (!periodeId) { setFehler('Bitte eine Abrechnungsperiode wählen.'); return; }
    if (!parameter) { setFehler('Parameter nicht geladen.'); return; }
    const ma = mitarbeiter.find((m) => m.id === maId);
    const periode = abrechnungsperioden.find((p) => p.id === periodeId);
    if (!ma || !periode) { setFehler('Mitarbeiter oder Periode nicht gefunden.'); return; }
    setLoading(true);
    try {
      const [data, fahrtenMa] = await Promise.all([
        ladePeriodeData(periode),
        // Nur für den Prüfhinweis „Fahrt im Monat, aber nicht dieser Periode
        // zugeordnet" — ein Fehler hier darf die Vorschau nicht verhindern.
        ladeFahrten({ mitarbeiterId: ma.id }).catch((): Fahrt[] => []),
      ]);
      const monatPraefix = `${periode.jahr}-${String(periode.monat).padStart(2, '0')}`;
      const fahrtenAusserhalb = fahrtenMa.filter(
        (f) => f.datum.startsWith(monatPraefix) && f.abrechnungsperiodeId !== periode.id
      );
      const snapshotErgebnis =
        periode.status === 'abgeschlossen'
          ? ((periode.abrechnungSnapshot?.ergebnisse ?? []) as MitarbeiterAbrechnung[]).find(
              (e) => e.mitarbeiter?.id === ma.id
            ) ?? null
          : null;

      // Für Interessenten oder MAs ohne Austräger-Rolle: temporär eine
      // 'austräger'-Rolle ergänzen, damit Boni/Stundenlöhne korrekt greifen.
      // Wenn der MA kein Geburtsdatum, aber das Interessenten-Alter erfasst
      // ist, ein synthetisches Geburtsdatum aus (Alter bei Erfassung +
      // verstrichene Zeit) ableiten — damit minderjährige korrekt mit dem
      // Minderjährigen-Stundenlohn berechnet werden.
      const synthGeburtsdatum = (() => {
        if (ma.geburtsdatum && ma.geburtsdatum.trim()) return ma.geburtsdatum;
        const alterBeiErf = ma.interessentAlterBeiErfassung;
        const kontakt = ma.interessentKontaktDatum;
        if (alterBeiErf == null || alterBeiErf <= 0 || !kontakt) return ma.geburtsdatum;
        const erf = new Date(kontakt);
        const heute = new Date();
        let zusatz = heute.getFullYear() - erf.getFullYear();
        const md = heute.getMonth() - erf.getMonth();
        if (md < 0 || (md === 0 && heute.getDate() < erf.getDate())) zusatz--;
        const aktuell = alterBeiErf + zusatz;
        const geb = new Date(heute);
        geb.setFullYear(heute.getFullYear() - aktuell);
        return geb.toISOString().slice(0, 10);
      })();

      const maFuerSim: Mitarbeiter = {
        ...ma,
        isActive: true,
        abgemeldet: false,
        istInteressent: false,
        interessentDeinteressiert: false,
        geburtsdatum: synthGeburtsdatum,
        rollen: (() => {
          const r = new Set([...(ma.rollen ?? [])]);
          if (extraTgIds.length > 0) r.add('austräger');
          if (r.size === 0) r.add('austräger');
          return [...r] as typeof ma.rollen;
        })(),
      };

      // Variante A: ohne zusätzliche TGs — Basis-Vorschau.
      const ergebnisseBasis = berechneAbrechnung(
        [maFuerSim],
        teilgebiete,
        data,
        parameter,
        periode,
        variablePeriodenZusaetze,
        abrechnungsperioden,
        lohnkontoBuchungen
      );
      const basis = ergebnisseBasis.find((e) => e.mitarbeiter.id === ma.id) ?? null;
      setPeriodeOhneZusatz(basis);

      const effTgs = effektiveTeilgebiete(teilgebiete, periode) as Teilgebiet[];
      const kontextBasis: AufschluesselungKontext = {
        periode,
        data,
        params: effektiveParameter(parameter, periode),
        teilgebiete: effTgs,
        maBerechnung: maFuerSim,
        maStamm: ma,
        touren,
        snapshotErgebnis,
        fahrtenAusserhalb,
      };

      if (extraTgIds.length > 0) {
        // Variante B — reine Simulation: Springer, Ausfälle und ungeklärte
        // Einsätze werden ignoriert. Der MA trägt alle Ausgaben seiner
        // Standard-Gebiete plus der zusätzlichen Gebiete selbst aus; eigene
        // Springer-Einsätze in fremden Gebieten zählen nicht mit.
        // Die Periode wird ohne Snapshots übergeben, sonst würden die
        // fixierten Austragen-Werte / Snapshot-TGs die Simulation überdecken.
        // Stammdaten + Parameter der Periode bleiben über effTgs/Snapshot erhalten.
        const tgsFuerSim: Teilgebiet[] = effTgs.map((t) =>
          extraTgIds.includes(t.id) ? { ...t, standardAustraegerId: ma.id } : t
        );
        const periodeFuerSim = {
          ...periode,
          status: 'offen',
          periodeSnapshot: undefined,
          monatswechselSnapshot: undefined,
          paramSnapshot: undefined,
        } as typeof periode;
        const paramsFuerSim = {
          ...parameter,
          ...(periode.status === 'abgeschlossen'
            ? periode.paramSnapshot
            : periode.monatswechselSnapshot?.paramSnapshot),
        };
        const sim = berechneAbrechnung(
          [maFuerSim],
          tgsFuerSim,
          { ...data, einsaetze: [] },
          paramsFuerSim,
          periodeFuerSim
        ).find((e) => e.mitarbeiter.id === ma.id);
        // Nur Austragen wird simuliert — alle übrigen Positionen aus der Basis.
        const simAustragen = sim?.austraegerGesamt ?? 0;
        const basisAustragen = basis?.austraegerGesamt ?? 0;
        const deltaAustragen = simAustragen - basisAustragen;
        const simErgebnis: MitarbeiterAbrechnung | null = basis
          ? {
              ...basis,
              austraegerEinsaetze: sim?.austraegerEinsaetze ?? [],
              austraegerGesamt: simAustragen,
              gewichtsbonusAnzeigenblatt: sim?.gewichtsbonusAnzeigenblatt ?? 0,
              gewichtsbonusBeilagen: sim?.gewichtsbonusBeilagen ?? 0,
              gesamt: basis.gesamt + deltaAustragen,
              bruttoLohnbuero: basis.bruttoLohnbuero + deltaAustragen,
            }
          : sim ?? null;
        setVertretungen([]);
        setKontext({ ...kontextBasis, teilgebiete: tgsFuerSim });
        setErgebnis(simErgebnis);
      } else {
        // Variante A — Vorab-Ermittlung: Standard-Gebiets-Ausgaben, die ein
        // Springer übernommen hat oder die unbesetzt waren, zur Info
        // mitliefern (nicht vergütet).
        const bezahlt = new Set(
          (basis?.austraegerEinsaetze ?? []).map((e) => `${e.teilgebietId}|${e.jahr}|${e.kw}`)
        );
        const liste: Vertretung[] = [];
        for (const tg of effTgs) {
          if (tg.standardAustraegerId !== ma.id || tg.isActive === false) continue;
          for (const ausgabe of data.ausgaben) {
            const ex = data.einsaetze.find(
              (e) => e.ausgabeId === ausgabe.id && e.teilgebietId === tg.id
            );
            if (!ex || ex.typ === 'standard' || ex.mitarbeiterId === ma.id) continue;
            if (istInSaisonpauseFuer(tg, ausgabe)) continue;
            if (bezahlt.has(`${tg.id}|${ausgabe.jahr}|${ausgabe.kw}`)) continue;
            liste.push({
              kw: ausgabe.kw,
              jahr: ausgabe.jahr,
              teilgebietId: tg.id,
              teilgebietName: tg.name,
              typ: ex.typ,
              vertreterName: ex.mitarbeiterId
                ? mitarbeiter.find((m) => m.id === ex.mitarbeiterId)?.name ?? ex.mitarbeiterId
                : undefined,
            });
          }
        }
        setVertretungen(liste);
        setKontext(kontextBasis);
        setErgebnis(basis);
      }
    } catch (e: any) {
      console.error(e);
      setFehler('Fehler bei der Berechnung: ' + (e.message ?? e));
    } finally {
      setLoading(false);
    }
  }

  // Bei Änderung der Eingaben: alte Ergebnisse verwerfen (Klarheit).
  useEffect(() => {
    setErgebnis(null);
    setPeriodeOhneZusatz(null);
    setVertretungen([]);
    setKontext(null);
  }, [maId, periodeId, extraTgIds.join(',')]);

  useEffect(() => {
    setManErgebnis(null);
  }, [manAlter, manWegstreckeM, manStueckzahl, manAnzAusgaben, manSeitenzahl, manAnzBeilagen, manBeilageGramm, manOnline]);

  function handleBerechnenManuell() {
    setFehler('');
    setManErgebnis(null);
    if (!parameter) { setFehler('Parameter nicht geladen.'); return; }
    const alter = parseInt(manAlter, 10);
    const wegstreckeM = parseInt(manWegstreckeM, 10);
    const stueckzahl = parseInt(manStueckzahl, 10);
    const anzAusgaben = parseInt(manAnzAusgaben, 10);
    const seitenzahl = parseInt(manSeitenzahl, 10);
    const anzBeilagen = parseInt(manAnzBeilagen, 10);
    const beilageGramm = parseFloat(manBeilageGramm.replace(',', '.'));
    if (!Number.isFinite(alter) || alter < 10 || alter > 99) { setFehler('Alter ungültig.'); return; }
    if (!Number.isFinite(wegstreckeM) || wegstreckeM < 0) { setFehler('Wegstrecke ungültig.'); return; }
    if (!Number.isFinite(stueckzahl) || stueckzahl <= 0) { setFehler('Stückzahl ungültig.'); return; }
    if (!Number.isFinite(anzAusgaben) || anzAusgaben <= 0) { setFehler('Anzahl Ausgaben ungültig.'); return; }
    if (!Number.isFinite(seitenzahl) || seitenzahl < 2) { setFehler('Seitenzahl ungültig.'); return; }

    // Synthetisches Geburtsdatum aus Alter
    const heute = new Date();
    const geb = new Date(heute);
    geb.setFullYear(heute.getFullYear() - alter);
    const geburtsdatum = geb.toISOString().slice(0, 10);

    const fakeMa: Mitarbeiter = {
      id: 'sim',
      nummer: '99999',
      name: 'Manuelle Vorschau',
      adresse: { strasse: '', plz: '', ort: '' },
      telefon: '',
      geburtsdatum,
      rollen: ['austräger'],
      hatFestgehalt: false,
      isActive: true,
      erstelltAm: 0,
      aktualisiertAm: 0,
    };
    const fakeTg: Teilgebiet = {
      id: 'sim-tg',
      name: 'Manuelle Vorschau',
      plz: '',
      ort: '',
      stueckzahl,
      wegstreckeM,
      strassen: [],
      stueckzahlManuell: true,
      tourId: null,
      standardAustraegerId: fakeMa.id,
      sonderauslagen: [],
      nichtBeliefen: [],
      isActive: true,
      erstelltAm: 0,
      aktualisiertAm: 0,
    } as Teilgebiet;
    const fakeAusgabe: Ausgabe = {
      id: 'sim-ausgabe',
      kw: 1,
      jahr: heute.getFullYear(),
      seitenzahl,
      stapelAnzahl: 0,
      grammaturGqm: parameter.standardGrammurGqm,
      seitenformatMm: {
        breite: parameter.standardSeitenformatBreiteMm,
        hoehe: parameter.standardSeitenformatHoeheMm,
      },
      status: 'geplant',
      erstelltAm: 0,
      aktualisiertAm: 0,
    };
    // Beilagen (alle „extern" → relevant für Einlegezeit + Gewichtsbonus Beilagen)
    const fakeBeilagen: Beilage[] = [];
    if (Number.isFinite(anzBeilagen) && anzBeilagen > 0 && Number.isFinite(beilageGramm)) {
      for (let i = 0; i < anzBeilagen; i++) {
        fakeBeilagen.push({
          id: `sim-beil-${i}`,
          ausgabeId: fakeAusgabe.id,
          arbeitstitel: `Beilage ${i + 1}`,
          kundenname: '',
          gewichtGStk: beilageGramm,
          format: 'a4' as any,
          kennzeichen: 'ext' as any,
          teilgebietIds: [fakeTg.id],
          erstelltAm: 0,
        });
      }
    }
    const fakeEinsatz: Einsatz = {
      id: 'sim-einsatz',
      ausgabeId: fakeAusgabe.id,
      kw: fakeAusgabe.kw,
      jahr: fakeAusgabe.jahr,
      teilgebietId: fakeTg.id,
      mitarbeiterId: fakeMa.id,
      typ: 'standard',
      erstelltAm: 0,
      aktualisiertAm: 0,
    };

    // Berechnung je Ausgabe (alle Ausgaben gleich angenommen)
    const detail = berechneAustraegerLohn(
      fakeMa,
      fakeTg,
      fakeAusgabe,
      fakeBeilagen,
      fakeEinsatz,
      undefined,
      parameter
    );
    const stundenlohn = ermittleStundenlohn(fakeMa, parameter);
    const grundlohnGesamt = detail.grundlohn * anzAusgaben;
    const gewichtABges = detail.gewichtsbonusAnzeigenblatt * anzAusgaben;
    const gewichtBeilGes = detail.gewichtsbonusBeilagen * anzAusgaben;
    const bonusZeiterf = manOnline
      ? (parameter.bonusZeiterfassungEur ?? 0) * anzAusgaben
      : 0;
    const gesamtJeAusgabe = detail.gesamt;
    const gesamt = grundlohnGesamt + gewichtABges + gewichtBeilGes + bonusZeiterf;
    // gewichtKg pro Ausgabe
    const gewichtABkg = ((fakeAusgabe.seitenzahl / 2) *
      ((fakeAusgabe.seitenformatMm.breite * fakeAusgabe.seitenformatMm.hoehe) / 1_000_000) *
      fakeAusgabe.grammaturGqm * stueckzahl) / 1000;
    const gewichtBeilKg = (anzBeilagen * beilageGramm * stueckzahl) / 1000;

    setManErgebnis({
      alter,
      istMinderjaehrig: alter < 18,
      stundenlohn,
      anzAusgaben,
      zeitStundenJeAusgabe: detail.zeitStunden,
      grundlohnJeAusgabe: detail.grundlohn,
      gewichtKgJeAusgabeAnzeigenblatt: gewichtABkg,
      gewichtKgJeAusgabeBeilagen: gewichtBeilKg,
      gewichtsbonusAnzeigenblattJeAusgabe: detail.gewichtsbonusAnzeigenblatt,
      gewichtsbonusBeilagenJeAusgabe: detail.gewichtsbonusBeilagen,
      gesamtJeAusgabe,
      grundlohnGesamt,
      gewichtsbonusAnzeigenblattGesamt: gewichtABges,
      gewichtsbonusBeilagenGesamt: gewichtBeilGes,
      bonusZeiterfassungGesamt: bonusZeiterf,
      gesamt,
    });
  }

  const ma = mitarbeiter.find((m) => m.id === maId);

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-1">
        Abrechnungsvorschau Aus-&amp; Zusammentragen
      </h1>
      <p className="text-sm text-gray-500 mb-6">
        Einzel-Vorschau für eine Abrechnungsperiode mit allen Lohnbestandteilen
        und ihren Berechnungsschlüsseln — zum Beantworten von Rückfragen und
        zum Finden von Fehlern. Optional: zusätzliche Teilgebiete simulieren —
        z. B. „Was würde der MA verdienen, wenn er Gebiet X übernähme?".
      </p>

      {/* Modus-Toggle */}
      <div className="mb-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setModus('ma')}
          className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${
            modus === 'ma' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-700 border-gray-300 hover:border-blue-400'
          }`}
        >
          👤 Mitarbeiter / Interessent
        </button>
        <button
          type="button"
          onClick={() => setModus('manuell')}
          className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${
            modus === 'manuell' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-700 border-gray-300 hover:border-blue-400'
          }`}
        >
          ✏️ Manuelle Eingabe (z. B. neuer Bewerber)
        </button>
        <button
          type="button"
          onClick={() => setModus('tg')}
          className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${
            modus === 'tg' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-700 border-gray-300 hover:border-blue-400'
          }`}
        >
          📍 Teilgebiet auswerten
        </button>
      </div>

      {/* Eingabe-Block — Modus „Mitarbeiter" */}
      {modus === 'ma' && (
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 mb-6">
        <div className="max-w-sm">
          <label className="block text-sm font-medium text-gray-700 mb-1">Abrechnungsperiode *</label>
          <select
            value={periodeId}
            onChange={(e) => setPeriodeId(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">— wählen —</option>
            {perioden.map((p) => (
              <option key={p.id} value={p.id}>
                {p.bezeichnung}{p.status === 'abgeschlossen' ? ' ✓' : ''}
              </option>
            ))}
          </select>
        </div>

        <div className="mt-5">
          <span className="block text-sm font-medium text-gray-700 mb-2">Mitarbeiter / Interessent *</span>
          {listeEingeklappt && ma ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3">
              <div className="text-sm text-blue-900">
                Ausgewählt: <span className="font-semibold">{ma.name}</span>{' '}
                {ma.nummer && <span className="font-mono text-blue-700">({ma.nummer})</span>}
                {ma.istInteressent && <span className="ml-2 text-xs text-amber-700">💡 Interessent</span>}
              </div>
              <button
                type="button"
                onClick={() => setListeEingeklappt(false)}
                className="rounded-lg border border-blue-300 bg-white px-3 py-1.5 text-sm font-medium text-blue-700 hover:bg-blue-100"
              >
                ▾ Anderen Mitarbeiter wählen
              </button>
            </div>
          ) : (
            <MaAuswahl
              liste={gefilterteMa}
              gesamt={maKandidaten.length}
              maId={maId}
              onWaehle={waehleMa}
              onEinklappen={ma ? () => setListeEingeklappt(true) : undefined}
              filter={
                <div className="flex flex-wrap gap-3 mb-3">
                  <input
                    type="text"
                    placeholder="Name oder Nummer suchen..."
                    value={filterText}
                    onChange={(e) => setFilterText(e.target.value)}
                    className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-52"
                  />
                  <input
                    type="text"
                    placeholder="Ort oder PLZ..."
                    value={filterOrtPlz}
                    onChange={(e) => setFilterOrtPlz(e.target.value)}
                    className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-36"
                    title="Filter auf Wohnort oder Postleitzahl"
                  />
                  {filterInteressent !== 'nur' && (
                    <>
                      <select
                        value={filterRolle}
                        onChange={(e) => setFilterRolle(e.target.value as Rolle | '')}
                        className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        <option value="">Alle Rollen</option>
                        {(['austräger', 'zusammenträger'] as Rolle[]).map((r) => (
                          <option key={r} value={r}>{ROLLEN_LABELS[r]}</option>
                        ))}
                      </select>
                      <select
                        value={filterMinijob}
                        onChange={(e) => setFilterMinijob(e.target.value as '' | 'ja' | 'nein')}
                        className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        title="Filter Minijob"
                      >
                        <option value="">Minijob: alle</option>
                        <option value="ja">nur Minijob</option>
                        <option value="nein">nur kein Minijob</option>
                      </select>
                      <select
                        value={filterSvFrei}
                        onChange={(e) => setFilterSvFrei(e.target.value as '' | 'ja' | 'nein')}
                        className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        title="Filter Befreiung von Sozialversicherung"
                      >
                        <option value="">SV-Befreiung: alle</option>
                        <option value="ja">nur SV-befreit</option>
                        <option value="nein">nur nicht SV-befreit</option>
                      </select>
                      <select
                        value={filterAnmeldung}
                        onChange={(e) => setFilterAnmeldung(e.target.value as '' | 'offen' | 'angemeldet' | 'abgemeldet')}
                        className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        title="Filter Anmeldung"
                      >
                        <option value="">Anmeldung: alle</option>
                        <option value="offen">⏳ noch nicht angemeldet</option>
                        <option value="angemeldet">✓ angemeldet</option>
                        <option value="abgemeldet">🚪 abgemeldet</option>
                      </select>
                      <select
                        value={filterFahrtkosten}
                        onChange={(e) => setFilterFahrtkosten(e.target.value as '' | 'ja' | 'nein')}
                        className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        title="Filter Fahrtkosten-Erstattung"
                      >
                        <option value="">Fahrtkosten: alle</option>
                        <option value="ja">🚗 nur erlaubt</option>
                        <option value="nein">nur nicht erlaubt</option>
                      </select>
                    </>
                  )}
                  <select
                    value={filterInteressent}
                    onChange={(e) => {
                      const v = e.target.value as '' | 'nur' | 'ohne';
                      setFilterInteressent(v);
                      if (v === 'ohne') setFilterInteresseTaetigkeit('');
                    }}
                    className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    title="Filter Interessenten"
                  >
                    <option value="">alle (inkl. Interessenten)</option>
                    <option value="ohne">ohne Interessenten</option>
                    <option value="nur">💡 nur Interessenten</option>
                  </select>
                  {filterInteressent !== 'ohne' && (
                    <select
                      value={filterInteresseTaetigkeit}
                      onChange={(e) => setFilterInteresseTaetigkeit(e.target.value as InteresseTaetigkeit | '')}
                      className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      title="Interessenten nach Tätigkeit filtern, für die sie sich interessieren"
                    >
                      <option value="">Interesse: alle Tätigkeiten</option>
                      {ALLE_INTERESSE_TAETIGKEITEN.map((t) => (
                        <option key={t} value={t}>{INTERESSE_TAETIGKEIT_LABELS[t]}</option>
                      ))}
                    </select>
                  )}
                  <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={nurAktive}
                      onChange={(e) => setNurAktive(e.target.checked)}
                      className="rounded"
                    />
                    Nur aktive
                    {nurAktive && anzInaktiveKandidaten > 0 && (
                      <span className="text-xs text-gray-400">
                        ({anzInaktiveKandidaten} inaktive ausgeblendet)
                      </span>
                    )}
                  </label>
                </div>
              }
            />
          )}
        </div>

        <div className="mt-5">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mb-2">
            <span className="block text-sm font-medium text-gray-700">
              Zusätzliche Teilgebiete (optional — Was-wäre-wenn-Simulation)
            </span>
            <div className="flex flex-wrap items-center gap-2 text-sm text-gray-700">
              <span>Verdienst bei Übernahme weiterer Teilgebiete simulieren?</span>
              <div className="inline-flex rounded-lg border border-gray-300 overflow-hidden" role="radiogroup">
                {([true, false] as const).map((wert) => (
                  <button
                    key={String(wert)}
                    type="button"
                    role="radio"
                    aria-checked={simulationGewuenscht === wert}
                    onClick={() => {
                      setSimulationGewuenscht(wert);
                      if (!wert) {
                        setExtraTgIds([]);
                        setTgFilter('');
                      }
                    }}
                    className={`px-3 py-1 text-xs font-medium ${
                      simulationGewuenscht === wert
                        ? 'bg-blue-600 text-white'
                        : 'bg-white text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    {wert ? 'Ja' : 'Nein'}
                  </button>
                ))}
              </div>
            </div>
            {simulationGewuenscht && (
              <input
                type="text"
                placeholder="Filtern..."
                value={tgFilter}
                onChange={(e) => setTgFilter(e.target.value)}
                className="border border-gray-300 rounded px-2 py-1 text-xs w-40 ml-auto"
              />
            )}
          </div>
          {simulationGewuenscht && (<>
          {extraTgIds.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {extraTgIds.map((id) => {
                const tg = teilgebiete.find((t) => t.id === id);
                if (!tg) return null;
                return (
                  <span key={id} className="inline-flex items-center gap-1 bg-blue-100 text-blue-800 text-xs px-2 py-0.5 rounded-full">
                    {tg.name}
                    <button
                      type="button"
                      onClick={() => toggleTg(id)}
                      className="text-blue-600 hover:text-blue-900"
                      title="Entfernen"
                    >
                      ✕
                    </button>
                  </span>
                );
              })}
              <button
                type="button"
                onClick={() => setExtraTgIds([])}
                className="text-xs text-gray-500 hover:text-gray-700 underline"
              >
                alle entfernen
              </button>
            </div>
          )}
          <div className="max-h-48 overflow-y-auto border border-gray-200 rounded-lg p-2 bg-gray-50">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-1 text-xs">
              {gefilterteTgs.map((t) => {
                const selected = extraTgIds.includes(t.id);
                const istStandardDesMa =
                  maId && t.standardAustraegerId === maId;
                return (
                  <label
                    key={t.id}
                    className={`flex items-center gap-1.5 px-2 py-1 rounded cursor-pointer ${
                      selected ? 'bg-blue-100 text-blue-900' : 'hover:bg-white'
                    } ${istStandardDesMa ? 'opacity-60' : ''}`}
                    title={istStandardDesMa ? 'Dieser MA ist bereits Standardausträger — Auswahl hat keinen Zusatzeffekt' : undefined}
                  >
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={() => toggleTg(t.id)}
                      className="rounded"
                    />
                    <span className="truncate">
                      {t.name}{t.plz ? ` (${t.plz})` : ''}
                      {istStandardDesMa && <span className="ml-1 text-[10px] text-gray-500">★ schon Standard</span>}
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
          </>)}
        </div>

        <div className="flex items-center gap-3 mt-4">
          <button
            type="button"
            onClick={handleBerechnen}
            disabled={loading || !maId || !periodeId}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? 'Berechne…' : '🧮 Berechnen'}
          </button>
          {fehler && <p className="text-red-600 text-sm">{fehler}</p>}
        </div>
      </div>
      )}

      {/* Eingabe-Block — Modus „Manuell" */}
      {modus === 'manuell' && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 mb-6">
          <p className="text-xs text-gray-500 mb-3">
            Manuelle Vorschau: alle Parameter werden direkt eingegeben — kein
            Bezug zu Mitarbeiter-/TG-Stammdaten oder echten Ausgaben. Hilfreich
            für Interessenten, die nach einem ungefähren Verdienst fragen.
          </p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Alter (Jahre) *</label>
              <input
                type="number" min={10} max={99}
                value={manAlter}
                onChange={(e) => setManAlter(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Wegstrecke TG (m) *</label>
              <input
                type="number" min={0}
                value={manWegstreckeM}
                onChange={(e) => setManWegstreckeM(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Stückzahl TG *</label>
              <input
                type="number" min={1}
                value={manStueckzahl}
                onChange={(e) => setManStueckzahl(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Anzahl Ausgaben *</label>
              <input
                type="number" min={1}
                value={manAnzAusgaben}
                onChange={(e) => setManAnzAusgaben(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Ø Seitenzahl je Ausgabe</label>
              <input
                type="number" min={2} step={2}
                value={manSeitenzahl}
                onChange={(e) => setManSeitenzahl(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Ø Beilagen je Ausgabe</label>
              <input
                type="number" min={0}
                value={manAnzBeilagen}
                onChange={(e) => setManAnzBeilagen(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Ø Gewicht Beilage (g/Stk)</label>
              <input
                type="number" min={0} step="0.1"
                value={manBeilageGramm}
                onChange={(e) => setManBeilageGramm(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              />
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={manOnline}
                  onChange={(e) => setManOnline(e.target.checked)}
                  className="rounded"
                />
                <span>📦 alle Daten online erfasst → Bonus Zeit</span>
              </label>
            </div>
          </div>
          <div className="flex items-center gap-3 mt-4">
            <button
              type="button"
              onClick={handleBerechnenManuell}
              className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700"
            >
              🧮 Berechnen
            </button>
            {fehler && <p className="text-red-600 text-sm">{fehler}</p>}
          </div>
        </div>
      )}

      {/* Modus „Teilgebiet auswerten" */}
      {modus === 'tg' && <TeilgebietAuswertung />}

      {/* Ergebnis — MA-Modus */}
      {modus === 'ma' && ergebnis && kontext && (
        <AbrechnungsAufschluesselung
          ergebnis={ergebnis}
          basisOhneZusatz={extraTgIds.length > 0 ? periodeOhneZusatz : null}
          extraTgs={extraTgIds.map((id) => teilgebiete.find((t) => t.id === id)?.name ?? id)}
          vertretungen={vertretungen}
          kontext={kontext}
        />
      )}

      {/* Ergebnis — manueller Modus */}
      {modus === 'manuell' && manErgebnis && (
        <ManuellesErgebnisAnzeige ergebnis={manErgebnis} bonusEur={parameter?.bonusZeiterfassungEur ?? 0} />
      )}
    </div>
  );
}

/** Filter + Trefferliste für die MA-Auswahl (Karten mobil, Tabelle Desktop). */
function MaAuswahl({
  liste,
  gesamt,
  maId,
  onWaehle,
  onEinklappen,
  filter,
}: {
  liste: Mitarbeiter[];
  gesamt: number;
  maId: string;
  onWaehle: (id: string) => void;
  onEinklappen?: () => void;
  filter: ReactNode;
}) {
  const rollenText = (m: Mitarbeiter) =>
    (m.rollen ?? [])
      .filter((r) => r === 'austräger' || r === 'zusammenträger')
      .map((r) => ROLLEN_LABELS[r])
      .join(', ');
  const inaktiv = (m: Mitarbeiter) => (m.istInteressent ? m.interessentDeinteressiert : !m.isActive);

  return (
    <div>
      {filter}
      <div className="flex items-center justify-between text-xs text-gray-500 mb-2">
        <span>
          {liste.length} Treffer
          {liste.length !== gesamt && ` (von ${gesamt})`}
        </span>
        {onEinklappen && (
          <button type="button" onClick={onEinklappen} className="text-blue-600 hover:underline">
            ▴ Liste ausblenden
          </button>
        )}
      </div>
      {liste.length === 0 ? (
        <div className="bg-gray-50 rounded-lg border border-gray-200 p-6 text-center text-gray-400 text-sm">
          Keine Mitarbeiter gefunden
        </div>
      ) : (
        <div className="max-h-80 overflow-y-auto rounded-lg border border-gray-200">
          {/* Mobile: Karten */}
          <div className="md:hidden divide-y divide-gray-100">
            {liste.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => onWaehle(m.id)}
                className={`w-full text-left px-4 py-3 ${maId === m.id ? 'bg-blue-50' : 'bg-white active:bg-blue-50'}`}
              >
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-gray-900 truncate">{m.name}</span>
                  {m.istInteressent && <span className="text-xs text-amber-700">💡 Interessent</span>}
                  {inaktiv(m) && <span className="text-xs text-gray-400">inaktiv</span>}
                </div>
                <div className="text-xs text-gray-400 font-mono">{m.nummer}</div>
                <div className="text-xs text-gray-500 mt-0.5">{rollenText(m)}</div>
              </button>
            ))}
          </div>
          {/* Desktop: Tabelle */}
          <table className="hidden md:table w-full text-sm">
            <thead className="sticky top-0 bg-gray-50 border-b border-gray-200 text-gray-600 text-xs">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Name</th>
                <th className="px-3 py-2 text-left font-medium">Nummer</th>
                <th className="px-3 py-2 text-left font-medium">Rollen</th>
                <th className="px-3 py-2 text-left font-medium">Ort</th>
                <th className="px-3 py-2 text-left font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {liste.map((m) => (
                <tr
                  key={m.id}
                  onClick={() => onWaehle(m.id)}
                  className={`cursor-pointer ${maId === m.id ? 'bg-blue-50' : 'hover:bg-gray-50'}`}
                >
                  <td className="px-3 py-2 font-medium text-gray-900">
                    {m.name}
                    {inaktiv(m) && <span className="ml-2 text-xs text-gray-400">inaktiv</span>}
                  </td>
                  <td className="px-3 py-2 font-mono text-gray-500">{m.nummer}</td>
                  <td className="px-3 py-2 text-xs text-gray-600">
                    {m.istInteressent ? <span className="text-amber-700">💡 Interessent</span> : rollenText(m)}
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-600">
                    {m.adresse?.plz && <span className="font-mono">{m.adresse.plz}</span>}{' '}
                    {m.adresse?.ort}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {m.nochNichtAngemeldet && <span title="Noch nicht beim Lohnbüro angemeldet" className="text-amber-600 mr-1">⏳</span>}
                    {m.abgemeldet && <span title="Abgemeldet" className="text-red-500 mr-1">🚪</span>}
                    {m.istMinijob && <span title="Minijob" className="text-blue-600 mr-1">M</span>}
                    {m.sozialversicherungsBefreit && <span title="SV-befreit" className="text-purple-600 mr-1">SV</span>}
                    {m.fahrtkostenerstattung && <span title="Fahrtkosten-Erstattung" className="text-gray-600 mr-1">🚗</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ManuellesErgebnisAnzeige({
  ergebnis,
  bonusEur,
}: { ergebnis: ManuellesErgebnis; bonusEur: number }) {
  const e = ergebnis;
  return (
    <div className="space-y-5">
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <div className="text-xs text-gray-500">Manuelle Vorschau</div>
            <div className="text-sm text-gray-800">
              Alter {e.alter} J. {e.istMinderjaehrig ? '(minderjährig)' : '(erwachsen)'} ·
              Stundenlohn {eur(e.stundenlohn)}/h · {e.anzAusgaben} Ausgabe
              {e.anzAusgaben === 1 ? '' : 'n'}
            </div>
          </div>
          <div className="text-right">
            <div className="text-xs text-gray-500">Brutto-Vorschau</div>
            <div className="text-2xl font-bold text-blue-700">{eur(e.gesamt)}</div>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="px-4 py-2.5 border-b border-gray-200 bg-gray-50">
          <span className="text-sm font-medium text-gray-700">
            Aufschlüsselung — je Ausgabe und gesamt
          </span>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-600">
            <tr>
              <th className="px-4 py-2 text-left font-medium">Position</th>
              <th className="px-4 py-2 text-right font-medium">je Ausgabe</th>
              <th className="px-4 py-2 text-right font-medium">× {e.anzAusgaben}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            <tr>
              <td className="px-4 py-2 text-gray-700">
                Zeit
                <span className="ml-2 text-xs text-gray-400">({stdMin(e.zeitStundenJeAusgabe)})</span>
              </td>
              <td className="px-4 py-2 text-right text-gray-400">—</td>
              <td className="px-4 py-2 text-right text-gray-400">—</td>
            </tr>
            <tr>
              <td className="px-4 py-2 text-gray-800">Grundlohn (Zeit × Stundenlohn)</td>
              <td className="px-4 py-2 text-right font-mono">{eur(e.grundlohnJeAusgabe)}</td>
              <td className="px-4 py-2 text-right font-mono font-semibold">{eur(e.grundlohnGesamt)}</td>
            </tr>
            <tr>
              <td className="px-4 py-2 text-gray-800">
                Gewichtsbonus Anzeigenblatt
                <span className="ml-2 text-xs text-gray-400">
                  ({e.gewichtKgJeAusgabeAnzeigenblatt.toFixed(1)} kg/Ausgabe)
                </span>
              </td>
              <td className="px-4 py-2 text-right font-mono">{eur(e.gewichtsbonusAnzeigenblattJeAusgabe)}</td>
              <td className="px-4 py-2 text-right font-mono font-semibold">{eur(e.gewichtsbonusAnzeigenblattGesamt)}</td>
            </tr>
            {e.gewichtsbonusBeilagenJeAusgabe > 0 && (
              <tr>
                <td className="px-4 py-2 text-gray-800">
                  Gewichtsbonus Beilagen
                  <span className="ml-2 text-xs text-gray-400">
                    ({e.gewichtKgJeAusgabeBeilagen.toFixed(1)} kg/Ausgabe)
                  </span>
                </td>
                <td className="px-4 py-2 text-right font-mono">{eur(e.gewichtsbonusBeilagenJeAusgabe)}</td>
                <td className="px-4 py-2 text-right font-mono font-semibold">{eur(e.gewichtsbonusBeilagenGesamt)}</td>
              </tr>
            )}
            <tr>
              <td className="px-4 py-2 text-gray-800">
                Bonus Zeiterfassung Austragen
                {bonusEur > 0 && (
                  <span className="ml-2 text-xs text-gray-400">
                    ({eur(bonusEur)} je Einsatz)
                  </span>
                )}
              </td>
              <td className="px-4 py-2 text-right font-mono">{e.bonusZeiterfassungGesamt > 0 ? eur(e.bonusZeiterfassungGesamt / e.anzAusgaben) : '—'}</td>
              <td className="px-4 py-2 text-right font-mono font-semibold">{e.bonusZeiterfassungGesamt > 0 ? eur(e.bonusZeiterfassungGesamt) : '—'}</td>
            </tr>
            <tr className="bg-blue-50 border-t-2 border-blue-200">
              <td className="px-4 py-3 text-sm font-semibold text-blue-900">Brutto gesamt</td>
              <td className="px-4 py-3 text-right font-mono text-blue-900">{eur(e.gesamtJeAusgabe)}</td>
              <td className="px-4 py-3 text-right font-mono font-bold text-blue-900">{eur(e.gesamt)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <p className="text-xs text-gray-400 text-center italic">
        Manuelle Berechnung — nutzt aktuelle Parameter (Lauf-/Steckgeschwindigkeit,
        Stundenlöhne, Bonus Zeiterfassung). Keine Speicherung.
      </p>
    </div>
  );
}
