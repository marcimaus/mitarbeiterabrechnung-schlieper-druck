// Abrechnungsvorschau Aus-& Zusammentragen
// Einzel-MA-Vorschau für eine Abrechnungsperiode, optional erweitert um
// zusätzliche Teilgebiete (Was-wäre-wenn). Nützlich z. B. um einem
// Interessenten zu zeigen, was er verdienen würde, wenn er ein bestimmtes
// Gebiet übernähme.

import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../context/AppContext';
import AdminPinGate from '../components/AdminPinGate';
import {
  ladePeriodeData,
  berechneAbrechnung,
  effektiveTeilgebiete,
  eur,
  stdMin,
  type MitarbeiterAbrechnung,
} from '../lib/abrechnungslogik';
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
} from '../types';

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

/** Ausgabe eines Standard-Gebiets des MA, die ein anderer ausgetragen hat
 *  (Springer) oder die unbesetzt war — nur zur Info, nicht vergütet. */
interface Vertretung {
  kw: number;
  jahr: number;
  teilgebietId: string;
  teilgebietName: string;
  typ: Einsatz['typ'];
  vertreterName?: string;
}

export default function AbrechnungsvorschauScreen() {
  return (
    <AdminPinGate allowedRoles={['admin', 'abrechnung']}>
      <AbrechnungsvorschauInhalt />
    </AdminPinGate>
  );
}

function AbrechnungsvorschauInhalt() {
  const { mitarbeiter, teilgebiete, abrechnungsperioden, parameter, variablePeriodenZusaetze, lohnkontoBuchungen } = useApp();

  const [modus, setModus] = useState<'ma' | 'manuell'>('ma');
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
    if (!maId) { setFehler('Bitte einen Mitarbeiter wählen.'); return; }
    if (!periodeId) { setFehler('Bitte eine Abrechnungsperiode wählen.'); return; }
    if (!parameter) { setFehler('Parameter nicht geladen.'); return; }
    const ma = mitarbeiter.find((m) => m.id === maId);
    const periode = abrechnungsperioden.find((p) => p.id === periodeId);
    if (!ma || !periode) { setFehler('Mitarbeiter oder Periode nicht gefunden.'); return; }
    setLoading(true);
    try {
      const data = await ladePeriodeData(periode);

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
  const periode = abrechnungsperioden.find((p) => p.id === periodeId);

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-1">
        Abrechnungsvorschau Aus-&amp; Zusammentragen
      </h1>
      <p className="text-sm text-gray-500 mb-6">
        Einzel-Vorschau für eine Abrechnungsperiode mit allen Lohnbestandteilen
        (Austragen, Zusammentragen, Vorarbeit, Zeitlöhne, Min-Boni, Bonus
        Zeiterfassung, Gewichtsboni). Optional: zusätzliche Teilgebiete
        simulieren — z. B. „Was würde der MA verdienen, wenn er Gebiet X
        übernähme?".
      </p>

      {/* Modus-Toggle */}
      <div className="mb-4 flex gap-2">
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
      </div>

      {/* Eingabe-Block — Modus „Mitarbeiter" */}
      {modus === 'ma' && (
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Mitarbeiter / Interessent *</label>
            <select
              value={maId}
              onChange={(e) => setMaId(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">— wählen —</option>
              {maKandidaten.map((m) => {
                const tags: string[] = [];
                if (m.istInteressent) tags.push('💡 Interessent');
                if (m.rollen?.includes('austräger')) tags.push('Austräger');
                if (m.rollen?.includes('zusammenträger')) tags.push('Zusammenträger');
                if (!m.isActive) tags.push('inaktiv');
                return (
                  <option key={m.id} value={m.id}>
                    {m.name} {m.nummer && `(${m.nummer})`} {tags.length > 0 ? `— ${tags.join(', ')}` : ''}
                  </option>
                );
              })}
            </select>
          </div>
          <div>
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

      {/* Ergebnis — MA-Modus */}
      {modus === 'ma' && ergebnis && ma && periode && (
        <VorschauErgebnis
          ergebnis={ergebnis}
          basisOhneZusatz={extraTgIds.length > 0 ? periodeOhneZusatz : null}
          extraTgs={extraTgIds.map((id) => teilgebiete.find((t) => t.id === id)?.name ?? id)}
          vertretungen={vertretungen}
        />
      )}

      {/* Ergebnis — manueller Modus */}
      {modus === 'manuell' && manErgebnis && (
        <ManuellesErgebnisAnzeige ergebnis={manErgebnis} bonusEur={parameter?.bonusZeiterfassungEur ?? 0} />
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

function VorschauErgebnis({
  ergebnis,
  basisOhneZusatz,
  extraTgs,
  vertretungen,
}: {
  ergebnis: MitarbeiterAbrechnung;
  basisOhneZusatz: MitarbeiterAbrechnung | null;
  extraTgs: string[];
  vertretungen: Vertretung[];
}) {
  const er = ergebnis;
  const hatSim = !!basisOhneZusatz;
  const delta = hatSim ? er.gesamt - (basisOhneZusatz?.gesamt ?? 0) : 0;

  // Einsatz-Zeilen (vergütet) + Vertretungs-Zeilen (Info), KW absteigend.
  type Zeile =
    | { art: 'einsatz'; kw: number; jahr: number; tgName: string; e: MitarbeiterAbrechnung['austraegerEinsaetze'][number] }
    | { art: 'vertretung'; kw: number; jahr: number; tgName: string; v: Vertretung };
  const zeilen: Zeile[] = [
    ...er.austraegerEinsaetze.map((e) => ({ art: 'einsatz' as const, kw: e.kw, jahr: e.jahr, tgName: e.teilgebietName, e })),
    ...vertretungen.map((v) => ({ art: 'vertretung' as const, kw: v.kw, jahr: v.jahr, tgName: v.teilgebietName, v })),
  ].sort((a, b) =>
    b.jahr - a.jahr || b.kw - a.kw || a.tgName.localeCompare(b.tgName, 'de', { numeric: true })
  );
  const anzSpringer = er.austraegerEinsaetze.filter((e) => e.typ === 'springer').length;
  const springerZuschlagSumme = er.austraegerEinsaetze.reduce((s, e) => s + (e.detail.springerZuschlag ?? 0), 0);

  // Zusammentragen je Kalenderwoche (KW absteigend) — damit der MA vorab
  // sieht, was er in welcher Woche für das Zusammentragen bekommt.
  const zusammentragenWochen = (() => {
    const map = new Map<number, {
      kw: number;
      anzTeilgebiete: number;
      stunden: number;
      lohnZusammentragen: number;
      lohnVorarbeit: number;
    }>();
    for (const z of er.zusammentragenEinsaetze) {
      const w = map.get(z.kw) ?? { kw: z.kw, anzTeilgebiete: 0, stunden: 0, lohnZusammentragen: 0, lohnVorarbeit: 0 };
      w.stunden += z.stunden ?? 0;
      if (z.istVorarbeit) {
        w.lohnVorarbeit += z.lohn;
      } else {
        w.lohnZusammentragen += z.lohn;
        w.anzTeilgebiete++;
      }
      map.set(z.kw, w);
    }
    return [...map.values()].sort((a, b) => b.kw - a.kw);
  })();
  const hatVorarbeit = er.zusammentragenEinsaetze.some((z) => z.istVorarbeit);

  const positionen: Array<{ label: string; wert: number; hint?: string }> = [
    { label: 'Austragen', wert: er.austraegerGesamt, hint: `${er.austraegerEinsaetze.length} Einsätze` },
    { label: '— davon Gewichtsbonus Anzeigenblatt', wert: er.gewichtsbonusAnzeigenblatt },
    { label: '— davon Gewichtsbonus Beilagen', wert: er.gewichtsbonusBeilagen },
    { label: 'Zusammentragen', wert: er.zusammentragenGesamt, hint: `${er.zusammentragenEinsaetze.length} Einsätze` },
    { label: 'Zeitlohn (Vorarbeit / Stempel)', wert: er.zeitLohn, hint: `${er.zeitStunden.toFixed(1)} h` },
    { label: 'Min-Boni (Tätigkeitsbonus)', wert: er.ausgabenBoniLohnGesamt, hint: er.ausgabenBoniMinutenGesamt ? `${er.ausgabenBoniMinutenGesamt} min` : undefined },
    { label: 'Bonus Zeiterfassung Austragen', wert: er.bonusZeiterfassungEur, hint: er.bonusZeiterfassungAnzahl ? `${er.bonusZeiterfassungAnzahl} Einsätze` : undefined },
    { label: 'Fixes Gehalt', wert: er.fixesGehalt },
    { label: 'Fahrtkosten', wert: er.fahrtkostenGesamt },
    { label: 'Bonus / Periodenzusatz', wert: er.bonus, hint: er.bonusKommentar },
  ];

  return (
    <div className="space-y-5">
      {/* Kennzahlen-Banner */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <div className="text-xs text-gray-500">{er.mitarbeiter.nummer} · Vorschau</div>
            <div className="text-lg font-semibold text-gray-900">{er.mitarbeiter.name}</div>
          </div>
          <div className="text-right">
            <div className="text-xs text-gray-500">Brutto-Vorschau</div>
            <div className="text-2xl font-bold text-blue-700">{eur(er.gesamt)}</div>
            {hatSim && (
              <div className={`text-xs mt-0.5 ${delta > 0 ? 'text-green-700' : delta < 0 ? 'text-red-700' : 'text-gray-500'}`}>
                {delta > 0 ? '+' : ''}{eur(delta)} durch Simulation
              </div>
            )}
          </div>
        </div>
        {extraTgs.length > 0 && (
          <div className="mt-3 rounded-md bg-blue-50 border border-blue-200 px-3 py-2 text-xs text-blue-800">
            <strong>Simulation aktiv</strong> — zusätzliche Teilgebiete:&nbsp;
            {extraTgs.join(', ')}
            {hatSim && (
              <span className="ml-2 text-blue-700/80">
                · ohne Simulation: {eur(basisOhneZusatz?.gesamt ?? 0)}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Aufschlüsselung */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="px-4 py-2.5 border-b border-gray-200 bg-gray-50">
          <span className="text-sm font-medium text-gray-700">Aufschlüsselung</span>
        </div>
        <table className="w-full text-sm">
          <tbody className="divide-y divide-gray-100">
            {positionen
              .filter((p) => p.wert !== 0)
              .map((p) => (
                <tr key={p.label} className="hover:bg-gray-50">
                  <td className={`px-4 py-2 ${p.label.startsWith('—') ? 'text-gray-500 text-xs pl-8' : 'text-gray-800'}`}>
                    {p.label}
                    {p.hint && <span className="ml-2 text-xs text-gray-400">({p.hint})</span>}
                  </td>
                  <td className={`px-4 py-2 text-right font-mono ${p.label.startsWith('—') ? 'text-gray-500 text-xs' : 'text-gray-900 font-semibold'}`}>
                    {eur(p.wert)}
                  </td>
                </tr>
              ))}
            <tr className="bg-blue-50 border-t-2 border-blue-200">
              <td className="px-4 py-3 text-sm font-semibold text-blue-900">Brutto gesamt</td>
              <td className="px-4 py-3 text-right font-mono font-bold text-blue-900">{eur(er.gesamt)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Austräger-Einsätze (gesondert für Transparenz) */}
      {zeilen.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="px-4 py-2.5 border-b border-gray-200 bg-gray-50 flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-medium text-gray-700">
              Austräger-Einsätze ({er.austraegerEinsaetze.length}
              {anzSpringer > 0 && ` · davon ${anzSpringer} als Springer`}
              {vertretungen.length > 0 && ` · ${vertretungen.length} vertreten`})
            </span>
            <span className="text-xs text-gray-500">
              {hatSim
                ? 'Simulation: Springer / Ausfälle werden ignoriert'
                : 'Berücksichtigt eingetragene Springer / Ausfälle'}
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 text-gray-600">
                <tr>
                  <th className="px-3 py-1.5 text-left font-medium">KW</th>
                  <th className="px-3 py-1.5 text-left font-medium">Teilgebiet</th>
                  <th className="px-3 py-1.5 text-left font-medium">Art</th>
                  <th className="px-3 py-1.5 text-right font-medium">Zeit</th>
                  <th className="px-3 py-1.5 text-right font-medium">Grundlohn</th>
                  <th className="px-3 py-1.5 text-right font-medium">Springer-Zuschl.</th>
                  <th className="px-3 py-1.5 text-right font-medium">Gewichtsbonus</th>
                  <th className="px-3 py-1.5 text-right font-medium">Gesamt</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {zeilen.map((z) => {
                  if (z.art === 'vertretung') {
                    const v = z.v;
                    return (
                      <tr key={`v-${v.teilgebietId}-${v.jahr}-${v.kw}`} className="bg-gray-50/60 text-gray-400">
                        <td className="px-3 py-1.5 font-mono">{v.kw}/{v.jahr}</td>
                        <td className="px-3 py-1.5 line-through">{v.teilgebietName}</td>
                        <td className="px-3 py-1.5" colSpan={5}>
                          {v.typ === 'springer'
                            ? <span className="text-amber-700">vertreten durch {v.vertreterName ?? 'Springer'}</span>
                            : <span className="text-red-600">Ausfall – {v.typ === 'ungeklärt' ? 'unbesetzt' : 'ausgefallen'}</span>}
                        </td>
                        <td className="px-3 py-1.5 text-right font-mono">—</td>
                      </tr>
                    );
                  }
                  const e = z.e;
                  const d = e.detail;
                  return (
                    <tr key={`e-${e.teilgebietId}-${e.jahr}-${e.kw}`} className="hover:bg-gray-50">
                      <td className="px-3 py-1.5 font-mono">{e.kw}/{e.jahr}</td>
                      <td className="px-3 py-1.5">{e.teilgebietName}</td>
                      <td className="px-3 py-1.5">
                        {e.typ === 'springer'
                          ? <span className="inline-block rounded bg-amber-100 text-amber-800 px-1.5 py-0.5">Springer</span>
                          : <span className="text-gray-500">Standard</span>}
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono">{stdMin(d.zeitStunden)}</td>
                      <td className="px-3 py-1.5 text-right font-mono">{eur(d.grundlohn)}</td>
                      <td className="px-3 py-1.5 text-right font-mono">{d.springerZuschlag ? eur(d.springerZuschlag) : '—'}</td>
                      <td className="px-3 py-1.5 text-right font-mono">{eur((d.gewichtsbonusAnzeigenblatt ?? 0) + (d.gewichtsbonusBeilagen ?? 0))}</td>
                      <td className="px-3 py-1.5 text-right font-mono font-semibold">{eur(d.gesamt)}</td>
                    </tr>
                  );
                })}
                <tr className="bg-blue-50 border-t-2 border-blue-200 font-semibold text-blue-900">
                  <td className="px-3 py-2" colSpan={5}>Summe Austragen</td>
                  <td className="px-3 py-2 text-right font-mono">{springerZuschlagSumme ? eur(springerZuschlagSumme) : '—'}</td>
                  <td className="px-3 py-2 text-right font-mono">{eur(er.gewichtsbonusAnzeigenblatt + er.gewichtsbonusBeilagen)}</td>
                  <td className="px-3 py-2 text-right font-mono">{eur(er.austraegerGesamt)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Zusammentragen je Kalenderwoche */}
      {zusammentragenWochen.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="px-4 py-2.5 border-b border-gray-200 bg-gray-50 flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-medium text-gray-700">
              Zusammentragen je Kalenderwoche ({zusammentragenWochen.length} {zusammentragenWochen.length === 1 ? 'Woche' : 'Wochen'})
            </span>
            {hatVorarbeit && (
              <span className="text-xs text-gray-500">inkl. erfasster Vorarbeit beim Zusammentragen</span>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 text-gray-600">
                <tr>
                  <th className="px-3 py-1.5 text-left font-medium">KW</th>
                  <th className="px-3 py-1.5 text-right font-medium">Teilgebiete</th>
                  {hatVorarbeit && <th className="px-3 py-1.5 text-right font-medium">davon Vorarbeit</th>}
                  <th className="px-3 py-1.5 text-right font-medium">Zeit</th>
                  <th className="px-3 py-1.5 text-right font-medium">Betrag</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {zusammentragenWochen.map((w) => (
                  <tr key={`zt-${w.kw}`} className="hover:bg-gray-50">
                    <td className="px-3 py-1.5 font-mono">KW {w.kw}</td>
                    <td className="px-3 py-1.5 text-right font-mono">{w.anzTeilgebiete}</td>
                    {hatVorarbeit && (
                      <td className="px-3 py-1.5 text-right font-mono">{w.lohnVorarbeit > 0 ? eur(w.lohnVorarbeit) : '—'}</td>
                    )}
                    <td className="px-3 py-1.5 text-right font-mono">{w.stunden > 0 ? stdMin(w.stunden) : '—'}</td>
                    <td className="px-3 py-1.5 text-right font-mono font-semibold">{eur(w.lohnZusammentragen + w.lohnVorarbeit)}</td>
                  </tr>
                ))}
                <tr className="bg-blue-50 border-t-2 border-blue-200 font-semibold text-blue-900">
                  <td className="px-3 py-2" colSpan={hatVorarbeit ? 3 : 2}>Summe Zusammentragen</td>
                  <td className="px-3 py-2 text-right font-mono">
                    {stdMin(zusammentragenWochen.reduce((s, w) => s + w.stunden, 0))}
                  </td>
                  <td className="px-3 py-2 text-right font-mono">{eur(er.zusammentragenGesamt)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      <p className="text-xs text-gray-400 text-center italic">
        Nur Vorschau — die Werte werden NICHT gespeichert. Lohnkonto-Verschiebungen
        und Vorschüsse bleiben aus der Vorschau ausgeblendet.
      </p>
    </div>
  );
}
