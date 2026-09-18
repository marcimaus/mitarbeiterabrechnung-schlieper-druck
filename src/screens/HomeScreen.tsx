import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../context/AppContext';
import { abonniereReklamationen, ausgabenListener, ladeEinsaetzeFuerJahre, mitarbeiterDarlehenListener } from '../lib/db';
import { urlaubsAusstehendListener, urlaubsWochenListener } from '../lib/planung';
import { aktiveSessions, vorarbeitArbeitszeitenListener } from '../lib/zeiterfassung';
import { getCurrentKW, getISOWeek, getISOYear, kwLabel, maxKWinJahr } from '../lib/kalender';
import { analysiereRestmengen, juengstePerioden, type TgRestmengeStat } from '../lib/restmengenanalyse';
import { berechneTilgungsplan, darlehenStatus } from '../lib/darlehen';
import { formatierEuro } from '../lib/berechnung';
import type { Arbeitszeit, Reklamation, UrlaubsEintrag, Ausgabe, Einsatz, MitarbeiterDarlehen, Mitarbeiter } from '../types';
import { URLAUB_STATUS_LABELS } from '../types';

// ---- Offene Darlehen (Startseite, nur Admin) ---------------

interface OffenesDarlehen {
  id: string;
  auszahlungsdatum: string;   // ISO YYYY-MM-DD
  getilgt: number;            // bereits planmäßig getilgt (Stand heute)
  offen: number;              // verbleibende Restschuld
  rateNr: number;             // bereits fällige Raten
  rateGesamt: number;         // Anzahl Raten gesamt (Laufzeit)
  startJahr: number;
  startMonat: number;
  endeJahr?: number;
  endeMonat?: number;
}

interface OffeneDarlehenMa {
  ma: Mitarbeiter;
  eintraege: OffenesDarlehen[];
  summeOffen: number;
}

export default function HomeScreen() {
  const { mitarbeiter, teilgebiete, touren, abrechnungsperioden, isAdminAuthenticated, userRole } = useApp();
  // Offene Darlehen werden ausschließlich dem Admin angezeigt (nicht „Abrechnung").
  const istAdmin = userRole === 'admin';

  const aktiveMitarbeiter = mitarbeiter.filter((m) => m.isActive);
  const aktiveTouren = touren.length;
  const offenePerioden = abrechnungsperioden.filter((p) => p.status === 'offen').length;

  // Teilgebiete ohne Standardausträger (aktiv, keine Auslagestellen — diese
  // brauchen keinen Austräger).
  const tgsOhneAustraeger = teilgebiete
    .filter((tg) => tg.isActive && !tg.istAuslagestelle && !tg.standardAustraegerId)
    .sort((a, b) => a.name.localeCompare(b.name, 'de', { numeric: true }));

  // Offene Reklamationen: Datensätze, die noch nicht dem MA mitgeteilt wurden.
  const [reklamationen, setReklamationen] = useState<Reklamation[]>([]);
  useEffect(() => {
    if (!isAdminAuthenticated) return;
    const unsub = abonniereReklamationen(setReklamationen);
    return () => unsub();
  }, [isAdminAuthenticated]);
  const offeneReklamationen = reklamationen.filter((r) => !r.mitgeteilt && !r.archiviert);

  // Urlaubsanträge, die durch Abrechnung erfasst und noch nicht freigegeben
  // sind. Zeigen wir Admin & Abrechnung — Admin damit er entscheidet,
  // Abrechnung damit sie sieht, was noch in der Warteschlange hängt.
  const [offeneUrlaubsantraege, setOffeneUrlaubsantraege] = useState<UrlaubsEintrag[]>([]);
  useEffect(() => {
    if (!isAdminAuthenticated) return;
    const unsub = urlaubsAusstehendListener(setOffeneUrlaubsantraege);
    return () => unsub();
  }, [isAdminAuthenticated]);
  const urlaubsantraegeSortiert = [...offeneUrlaubsantraege].sort(
    (a, b) => a.jahr - b.jahr || a.kw - b.kw,
  );

  // Ausgaben mit Zusammenträger-Selbsterfassung, die noch nicht geprüft wurden.
  const [ausgaben, setAusgaben] = useState<Ausgabe[]>([]);
  useEffect(() => {
    if (!isAdminAuthenticated) return;
    const unsub = ausgabenListener(setAusgaben);
    return () => unsub();
  }, [isAdminAuthenticated]);
  const ungepruefteSelbsterfassung = ausgaben
    .filter((a) => a.selbsterfassungZusammentragenAm && !a.erfassungZusammentragenGeprueft)
    .sort((a, b) => (b.jahr - a.jahr) || (b.kw - a.kw));

  // Aktive Stempel-Sessions: Mitarbeiter, die gerade eingestempelt sind
  // (Status „aktiv" oder „pause"). Wird auf der Startseite als Chip
  // angezeigt — nur für Admin, da Stempelzustände sonst nicht offengelegt
  // werden sollen.
  const [aktiveStempelSessions, setAktiveStempelSessions] = useState<Arbeitszeit[]>([]);
  useEffect(() => {
    if (!isAdminAuthenticated) return;
    const unsub = aktiveSessions(setAktiveStempelSessions);
    return () => unsub();
  }, [isAdminAuthenticated]);
  const eingestempelteMitarbeiter = (() => {
    const ids = new Set(aktiveStempelSessions.map((s) => s.mitarbeiterId));
    return mitarbeiter
      .filter((m) => ids.has(m.id))
      .sort((a, b) => a.name.localeCompare(b.name, 'de'));
  })();

  // Vorarbeit-Arbeitszeiten ohne Freigabe: ein Mitarbeiter hat Vorarbeit
  // gestempelt, die zugeordnete Ausgabe trägt aber nicht
  // `vorarbeitFreigegeben=true`. Diese Minuten würden in der Abrechnung
  // verworfen — Admin muss die Freigabe nachholen oder die Zeit korrigieren.
  const [vorarbeitZeiten, setVorarbeitZeiten] = useState<Arbeitszeit[]>([]);
  useEffect(() => {
    if (!isAdminAuthenticated) return;
    const unsub = vorarbeitArbeitszeitenListener(setVorarbeitZeiten);
    return () => unsub();
  }, [isAdminAuthenticated]);
  const vorarbeitOhneFreigabe = (() => {
    const freigabeProAusgabe = new Map(ausgaben.map((a) => [a.id, !!a.vorarbeitFreigegeben]));
    // Fallback: über (jahr, kw) der Stempelzeit — falls Stempelung ohne
    // explizite Ausgaben-Zuordnung erfolgte (analog zur Abrechnungslogik).
    const freigegebenInKw = (jahr: number, kw: number) =>
      ausgaben.some((x) => x.jahr === jahr && x.kw === kw && x.vorarbeitFreigegeben === true);
    type Eintrag = {
      mitarbeiterId: string;
      mitarbeiterName: string;
      ausgabenLabel: Set<string>;
    };
    const proMa = new Map<string, Eintrag>();
    for (const a of vorarbeitZeiten) {
      if (a.nichtBeruecksichtigen) continue;
      // Aktive und abgeschlossene Sessions zeigen — eine laufende Vorarbeit-
      // Stempelung ohne Freigabe ist ein genauso starkes Signal wie eine
      // abgeschlossene.
      if (a.status !== 'aktiv' && a.status !== 'pause' && a.status !== 'abgeschlossen') continue;
      const startD = new Date(a.startTime);
      const jahr = getISOYear(startD);
      const kw = getISOWeek(startD);
      const istFreigegeben = a.ausgabeId
        ? freigabeProAusgabe.get(a.ausgabeId) === true
        : freigegebenInKw(jahr, kw);
      if (istFreigegeben) continue;
      const ma = mitarbeiter.find((m) => m.id === a.mitarbeiterId);
      const name = ma?.name ?? 'Unbekannt';
      const eintrag = proMa.get(a.mitarbeiterId) ?? {
        mitarbeiterId: a.mitarbeiterId,
        mitarbeiterName: name,
        ausgabenLabel: new Set<string>(),
      };
      eintrag.ausgabenLabel.add(kwLabel(kw, jahr));
      proMa.set(a.mitarbeiterId, eintrag);
    }
    return Array.from(proMa.values())
      .map((e) => ({
        ...e,
        ausgabenLabel: Array.from(e.ausgabenLabel).sort(),
      }))
      .sort((a, b) => a.mitarbeiterName.localeCompare(b.mitarbeiterName, 'de'));
  })();

  // Urlaub aktuelle + kommende Woche — auf der Startseite als Hinweis,
  // damit anstehende Abwesenheiten nicht übersehen werden.
  const aktuelleUndKommendeWoche = useMemo(() => {
    const { jahr, kw } = getCurrentKW();
    const max = maxKWinJahr(jahr);
    const next = kw < max ? { jahr, kw: kw + 1 } : { jahr: jahr + 1, kw: 1 };
    return [{ jahr, kw }, next];
  }, []);
  const [urlaubeWochen, setUrlaubeWochen] = useState<UrlaubsEintrag[]>([]);
  useEffect(() => {
    if (!isAdminAuthenticated) return;
    const unsub = urlaubsWochenListener(aktuelleUndKommendeWoche, setUrlaubeWochen);
    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdminAuthenticated, aktuelleUndKommendeWoche.map((w) => `${w.jahr}-${w.kw}`).join('|')]);
  const urlaubeSortiert = [...urlaubeWochen].sort(
    (a, b) => a.jahr - b.jahr || a.kw - b.kw || (a.datumVon ?? '').localeCompare(b.datumVon ?? ''),
  );

  // Restmengen-Analyse: Rest-/Fehlmengen der aktuellen + letzten beiden
  // Perioden, aggregiert je Teilgebiet (Ø je Meldung), Top 5 absteigend.
  const analysePerioden = juengstePerioden(abrechnungsperioden, 3);
  const [analyseEinsaetze, setAnalyseEinsaetze] = useState<Einsatz[]>([]);
  useEffect(() => {
    if (!isAdminAuthenticated || analysePerioden.length === 0) {
      setAnalyseEinsaetze([]);
      return;
    }
    let cancelled = false;
    const jahre = Array.from(new Set(analysePerioden.map((p) => p.jahr)));
    ladeEinsaetzeFuerJahre(jahre)
      .then((list) => { if (!cancelled) setAnalyseEinsaetze(list); })
      .catch((err) => console.error('Fehler beim Laden der Einsätze für die Restmengen-Analyse:', err));
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdminAuthenticated, analysePerioden.map((p) => p.id).join(',')]);
  const topRestmengen = analysiereRestmengen(analyseEinsaetze, analysePerioden, teilgebiete).slice(0, 5);
  const analyseZeitraum = analysePerioden.length > 0
    ? [...analysePerioden]
        .sort((a, b) => (a.jahr - b.jahr) || (a.monat - b.monat))
        .map((p) => p.bezeichnung)
        .join(' – ')
    : '';

  // Mitarbeiter, die noch nicht beim Lohnbüro angemeldet sind (Flag
  // `nochNichtAngemeldet=true`). Abgemeldete und Interessenten werden
  // ausgeblendet — beide brauchen keine Anmeldung.
  const nichtAngemeldeteMitarbeiter = mitarbeiter
    .filter((m) => m.nochNichtAngemeldet && !m.abgemeldet && !m.istInteressent)
    .sort((a, b) => a.name.localeCompare(b.name, 'de'));

  // Mitarbeiterdarlehen — nur für den Admin. Offene Darlehen (Restschuld > 0)
  // je Mitarbeiter gebündelt, mit offener Summe und Detail je Darlehen.
  const [darlehen, setDarlehen] = useState<MitarbeiterDarlehen[]>([]);
  useEffect(() => {
    if (!istAdmin) return;
    const unsub = mitarbeiterDarlehenListener(setDarlehen);
    return () => unsub();
  }, [istAdmin]);

  const offeneDarlehenProMa = (() => {
    const proMa = new Map<string, OffeneDarlehenMa>();
    for (const d of darlehen) {
      const st = darlehenStatus(d);
      if (st.restPlan <= 0.005) continue; // nur Darlehen mit Restschuld
      const ma = mitarbeiter.find((m) => m.id === d.mitarbeiterId);
      if (!ma) continue;
      const plan = berechneTilgungsplan(d);
      const ende = plan.length > 0 ? plan[plan.length - 1] : null;
      const eintrag: OffenesDarlehen = {
        id: d.id,
        auszahlungsdatum: d.auszahlungsdatum,
        getilgt: st.getilgtPlan,
        offen: st.restPlan,
        rateNr: st.rateNr,
        rateGesamt: st.rateGesamt,
        startJahr: d.startJahr,
        startMonat: d.startMonat,
        endeJahr: ende?.jahr,
        endeMonat: ende?.monat,
      };
      const cur = proMa.get(d.mitarbeiterId) ?? { ma, eintraege: [], summeOffen: 0 };
      cur.eintraege.push(eintrag);
      cur.summeOffen += st.restPlan;
      proMa.set(d.mitarbeiterId, cur);
    }
    return Array.from(proMa.values())
      .map((x) => ({
        ...x,
        eintraege: x.eintraege.sort((a, b) => b.auszahlungsdatum.localeCompare(a.auszahlungsdatum)),
      }))
      .sort((a, b) => b.summeOffen - a.summeOffen);
  })();
  const gesamtOffeneDarlehen = offeneDarlehenProMa.reduce((s, x) => s + x.summeOffen, 0);

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto">
      <h1 className="text-xl md:text-2xl font-bold text-gray-900 mb-0.5">
        Mitarbeiterabrechnung
      </h1>
      <p className="text-gray-500 mb-6 text-sm">Schlieper-Druck GmbH</p>

      {/* Statistik-Chips — kompakt, einzeilig */}
      <div className="flex flex-wrap gap-2 mb-5">
        <StatChip label="Aktive Mitarbeiter" value={aktiveMitarbeiter.length} icon="👥" color="blue" />
        <StatChip label="Teilgebiete" value={teilgebiete.filter(t => t.isActive).length} icon="📍" color="green" />
        <StatChip label="Touren" value={aktiveTouren} icon="🗺" color="yellow" />
        <StatChip label="Offene Perioden" value={offenePerioden} icon="💰" color="orange" />
        {isAdminAuthenticated && (
          <StatChip
            label={eingestempelteMitarbeiter.length === 1 ? 'Eingestempelt' : 'Eingestempelte'}
            value={eingestempelteMitarbeiter.length}
            icon="⏱"
            color="purple"
          />
        )}
      </div>

      {/* Schnellzugriff */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 md:p-6 mb-4">
        <h2 className="font-semibold text-gray-800 mb-3">Schnellzugriff</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <QuickLink href="/zeiterfassung" icon="⏱" title="Stempeluhr" desc="Zeiten stempeln & erfassen" />
          <QuickLink href="/fahrten" icon="🚗" title="Fahrtkosten" desc="Fahrt erfassen" />
          {isAdminAuthenticated && (
            <>
              <QuickLink href="/mitarbeiter" icon="👥" title="Mitarbeiter" desc="Stammdaten verwalten" />
              <QuickLink href="/ausgaben" icon="📄" title="Ausgaben & Beilagen" desc="Wochenausgaben planen" />
              <QuickLink href="/planung" icon="🗒" title="Personalplanung" desc="Drucksaal · Fahrer · Springer" />
              <QuickLink href="/einsaetze" icon="🗓" title="Einsätze" desc="Austräger zuweisen" />
              <QuickLink href="/reklamationen" icon="📞" title="Reklamationen" desc="Leser-Reklamationen erfassen" />
              <QuickLink href="/abrechnung" icon="💰" title="Abrechnung" desc="Monatsabrechnung & Export" />
              <QuickLink href="/teilgebiete" icon="📍" title="Teilgebiete" desc="Gebiete & Straßenlisten" />
            </>
          )}
        </div>
      </div>

      {/* Auswertungen: Teilgebiete ohne Standardausträger + offene Reklamationen */}
      {isAdminAuthenticated && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Teilgebiete ohne Standardausträger */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 md:p-6">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-amber-600">⚠</span>
              <h2 className="font-semibold text-gray-800">Teilgebiete ohne Standardausträger</h2>
              <span className={`ml-auto text-xs px-2 py-0.5 rounded-full font-medium ${
                tgsOhneAustraeger.length === 0
                  ? 'bg-green-100 text-green-700'
                  : 'bg-amber-100 text-amber-800'
              }`}>
                {tgsOhneAustraeger.length}
              </span>
            </div>
            {tgsOhneAustraeger.length === 0 ? (
              <p className="text-sm text-gray-500 italic">
                Alle aktiven Teilgebiete haben einen Standardausträger zugeordnet. ✓
              </p>
            ) : (
              <div className="space-y-1.5 max-h-64 overflow-y-auto">
                {tgsOhneAustraeger.map((tg) => (
                  <a
                    key={tg.id}
                    href="/teilgebiete"
                    className="flex items-center justify-between py-1.5 px-2.5 rounded-md bg-amber-50 border border-amber-200 hover:bg-amber-100"
                  >
                    <span className="text-sm font-medium text-amber-900">{tg.name}</span>
                    {tg.plz && (
                      <span className="text-xs text-amber-700 font-mono">{tg.plz}</span>
                    )}
                  </a>
                ))}
              </div>
            )}
          </div>

          {/* Offene Reklamationen */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 md:p-6">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-red-600">📞</span>
              <h2 className="font-semibold text-gray-800">Offene Reklamationen</h2>
              <span className={`ml-auto text-xs px-2 py-0.5 rounded-full font-medium ${
                offeneReklamationen.length === 0
                  ? 'bg-green-100 text-green-700'
                  : 'bg-red-100 text-red-700'
              }`}>
                {offeneReklamationen.length}
              </span>
            </div>
            {offeneReklamationen.length === 0 ? (
              <p className="text-sm text-gray-500 italic">
                Keine offenen Reklamationen. ✓
              </p>
            ) : (
              <div className="space-y-1.5 max-h-64 overflow-y-auto">
                {offeneReklamationen.slice(0, 10).map((r) => (
                  <a
                    key={r.id}
                    href="/reklamationen"
                    className="block py-1.5 px-2.5 rounded-md bg-red-50 border border-red-200 hover:bg-red-100"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium text-red-900 truncate">
                        {r.anruferName || '— ohne Name —'}
                      </span>
                      <span className="text-[11px] text-red-600 shrink-0 font-mono">
                        {new Date(r.erstelltAm).toLocaleDateString('de-DE')}
                      </span>
                    </div>
                    {(r.strasse || r.ort) && (
                      <div className="text-xs text-red-700/80 truncate">
                        {[r.strasse, r.hausnummer].filter(Boolean).join(' ')}
                        {(r.strasse || r.hausnummer) && (r.plz || r.ort) ? ', ' : ''}
                        {[r.plz, r.ort].filter(Boolean).join(' ')}
                      </div>
                    )}
                  </a>
                ))}
                {offeneReklamationen.length > 10 && (
                  <a
                    href="/reklamationen"
                    className="block py-1 text-center text-xs text-red-700 hover:text-red-900 font-medium"
                  >
                    … und {offeneReklamationen.length - 10} weitere
                  </a>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Offene Darlehen — nur Admin */}
      {istAdmin && (
        <div className="mt-4 bg-white rounded-xl shadow-sm border border-gray-200 p-4 md:p-6">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-indigo-600">💸</span>
            <h2 className="font-semibold text-gray-800">Offene Darlehen</h2>
            <span className={`ml-auto text-xs px-2 py-0.5 rounded-full font-medium ${
              offeneDarlehenProMa.length === 0
                ? 'bg-green-100 text-green-700'
                : 'bg-indigo-100 text-indigo-700'
            }`}>
              {offeneDarlehenProMa.length}
            </span>
          </div>
          {offeneDarlehenProMa.length === 0 ? (
            <p className="text-sm text-gray-500 italic">
              Keine offenen Mitarbeiterdarlehen. ✓
            </p>
          ) : (
            <>
              <div className="mb-3 text-sm text-gray-600">
                Gesamte offene Summe:{' '}
                <span className="font-bold text-gray-900">{formatierEuro(gesamtOffeneDarlehen)}</span>
                {' '}· {offeneDarlehenProMa.length}{' '}
                {offeneDarlehenProMa.length === 1 ? 'Mitarbeiter' : 'Mitarbeiter'}
              </div>
              <div className="space-y-2.5 max-h-96 overflow-y-auto">
                {offeneDarlehenProMa.map((x) => (
                  <a
                    key={x.ma.id}
                    href="/mitarbeiterdarlehen"
                    className="block rounded-lg border border-indigo-200 bg-indigo-50/40 hover:bg-indigo-50 p-3 transition-colors"
                  >
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <span className="font-medium text-gray-900 truncate">{x.ma.name}</span>
                      <span className="text-sm font-bold text-indigo-800 shrink-0 whitespace-nowrap">
                        {formatierEuro(x.summeOffen)} offen
                      </span>
                    </div>
                    <div className="space-y-1">
                      {x.eintraege.map((e) => (
                        <div
                          key={e.id}
                          className="grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-0.5 text-xs text-gray-600"
                        >
                          <span title="Auszahlungsdatum">
                            📅 {new Date(e.auszahlungsdatum + 'T12:00:00').toLocaleDateString('de-DE')}
                          </span>
                          <span>
                            Getilgt:{' '}
                            <span className="font-mono text-gray-700">{formatierEuro(e.getilgt)}</span>
                          </span>
                          <span>
                            Offen:{' '}
                            <span className="font-mono font-semibold text-gray-900">{formatierEuro(e.offen)}</span>
                          </span>
                          <span title="Laufzeit (Beginn – Ende, fällige/gesamte Raten)">
                            ⏳ {laufzeitLabel(e)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </a>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* Restmengen-Analyse — Teilgebiete mit höchstem Ø Rest/Fehl */}
      {isAdminAuthenticated && (
        <div className="mt-4 bg-white rounded-xl shadow-sm border border-gray-200 p-4 md:p-6">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-amber-600">📦</span>
            <h2 className="font-semibold text-gray-800">
              Restmengen-Analyse — höchste Durchschnitte je Teilgebiet
            </h2>
          </div>
          <p className="text-xs text-gray-500 mb-3">
            Ø Restmenge je Meldung über die aktuelle und die letzten beiden Perioden
            {analyseZeitraum && <> ({analyseZeitraum})</>}. Top 5, absteigend.
          </p>
          {topRestmengen.length === 0 ? (
            <p className="text-sm text-gray-500 italic">
              Keine Rest-/Fehlmengen-Meldungen in diesem Zeitraum. ✓
            </p>
          ) : (
            <div className="space-y-1.5">
              {topRestmengen.map((t, i) => (
                <RestmengeZeile key={t.teilgebietId} rang={i + 1} stat={t} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Vorarbeit ohne Freigabe — Stempelungen, die in der Abrechnung verworfen würden */}
      {isAdminAuthenticated && (
        <div className={`mt-4 bg-white rounded-xl shadow-sm p-4 md:p-6 border ${
          vorarbeitOhneFreigabe.length > 0 ? 'border-red-300' : 'border-gray-200'
        }`}>
          <div className="flex items-center gap-2 mb-3">
            <span className={vorarbeitOhneFreigabe.length > 0 ? 'text-red-600' : 'text-gray-400'}>⚠</span>
            <h2 className="font-semibold text-gray-800">
              Vorarbeit ohne Freigabe
            </h2>
            <span className={`ml-auto text-xs px-2 py-0.5 rounded-full font-medium ${
              vorarbeitOhneFreigabe.length === 0
                ? 'bg-green-100 text-green-700'
                : 'bg-red-100 text-red-700'
            }`}>
              {vorarbeitOhneFreigabe.length}
            </span>
          </div>
          {vorarbeitOhneFreigabe.length === 0 ? (
            <p className="text-sm text-gray-500 italic">
              Alle Vorarbeit-Stempelungen haben eine Freigabe. ✓
            </p>
          ) : (
            <>
              <p className="text-xs text-gray-500 mb-3">
                Diese Mitarbeiter haben Vorarbeit erfasst, aber in der zugeordneten
                Ausgabe ist das Kennzeichen „Vorarbeit für diese Ausgabe erlauben"
                nicht gesetzt — die Minuten fließen so nicht in den Lohn ein.
              </p>
              <div className="space-y-1.5 max-h-64 overflow-y-auto">
                {vorarbeitOhneFreigabe.map((e) => (
                  <a
                    key={e.mitarbeiterId}
                    href="/ausgaben"
                    className="flex items-center justify-between gap-2 py-1.5 px-2.5 rounded-md bg-red-50 border border-red-200 hover:bg-red-100"
                  >
                    <span className="text-sm font-medium text-red-900 truncate">
                      {e.mitarbeiterName}
                    </span>
                    <span className="text-xs text-red-700 shrink-0 font-mono">
                      {e.ausgabenLabel.join(' · ')}
                    </span>
                  </a>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* Urlaub aktuelle + kommende Woche */}
      {isAdminAuthenticated && (
        <div className={`mt-4 bg-white rounded-xl shadow-sm p-4 md:p-6 border ${
          urlaubeSortiert.length > 0 ? 'border-sky-300' : 'border-gray-200'
        }`}>
          <div className="flex items-center gap-2 mb-3">
            <span className={urlaubeSortiert.length > 0 ? 'text-sky-600' : 'text-gray-400'}>🏖</span>
            <h2 className="font-semibold text-gray-800">
              Urlaub diese & nächste Woche
            </h2>
            <span className={`ml-auto text-xs px-2 py-0.5 rounded-full font-medium ${
              urlaubeSortiert.length === 0
                ? 'bg-green-100 text-green-700'
                : 'bg-sky-100 text-sky-800'
            }`}>
              {urlaubeSortiert.length}
            </span>
          </div>
          {urlaubeSortiert.length === 0 ? (
            <p className="text-sm text-gray-500 italic">
              Keine Urlaube in dieser oder der kommenden Woche. ✓
            </p>
          ) : (
            <div className="space-y-1.5 max-h-64 overflow-y-auto">
              {urlaubeSortiert.map((u) => {
                const ma = mitarbeiter.find((m) => m.id === u.mitarbeiterId);
                const datumBereich = u.datumVon && u.datumBis
                  ? (u.datumVon === u.datumBis ? u.datumVon : `${u.datumVon} – ${u.datumBis}`)
                  : '';
                return (
                  <a
                    key={u.id}
                    href="/planung"
                    className="flex items-center justify-between gap-2 py-1.5 px-2.5 rounded-md bg-sky-50 border border-sky-200 hover:bg-sky-100"
                  >
                    <span className="text-sm font-medium text-sky-900 truncate">
                      {ma?.name ?? '?'}
                      {!u.freigegeben && (
                        <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 font-medium align-middle">
                          offen
                        </span>
                      )}
                    </span>
                    <span className="text-xs text-sky-700 shrink-0">
                      KW {u.kw}/{u.jahr}
                      {datumBereich ? ` · ${datumBereich}` : ''}
                      <span className="ml-2 text-[10px] text-sky-600">
                        {URLAUB_STATUS_LABELS[u.status]}
                      </span>
                    </span>
                  </a>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Urlaubsanträge — offen, warten auf Admin-Freigabe */}
      {isAdminAuthenticated && (
        <div className={`mt-4 bg-white rounded-xl shadow-sm p-4 md:p-6 border ${
          urlaubsantraegeSortiert.length > 0 ? 'border-amber-300' : 'border-gray-200'
        }`}>
          <div className="flex items-center gap-2 mb-3">
            <span className={urlaubsantraegeSortiert.length > 0 ? 'text-amber-600' : 'text-gray-400'}>🏖</span>
            <h2 className="font-semibold text-gray-800">
              Urlaub — Freigabe ausstehend
            </h2>
            <span className={`ml-auto text-xs px-2 py-0.5 rounded-full font-medium ${
              urlaubsantraegeSortiert.length === 0
                ? 'bg-green-100 text-green-700'
                : 'bg-amber-100 text-amber-800'
            }`}>
              {urlaubsantraegeSortiert.length}
            </span>
          </div>
          {urlaubsantraegeSortiert.length === 0 ? (
            <p className="text-sm text-gray-500 italic">
              Keine Urlaubsanträge warten auf Freigabe. ✓
            </p>
          ) : (
            <div className="space-y-1.5 max-h-64 overflow-y-auto">
              {urlaubsantraegeSortiert.slice(0, 12).map((u) => {
                const ma = mitarbeiter.find((m) => m.id === u.mitarbeiterId);
                return (
                  <a
                    key={u.id}
                    href="/planung"
                    className="flex items-center justify-between gap-2 py-1.5 px-2.5 rounded-md bg-amber-50 border border-amber-200 hover:bg-amber-100"
                  >
                    <span className="text-sm font-medium text-amber-900 truncate">
                      {ma?.name ?? '?'}
                    </span>
                    <span className="text-xs text-amber-700 shrink-0">
                      KW {u.kw}/{u.jahr}
                      {u.datumVon && u.datumBis ? ` · ${u.datumVon} – ${u.datumBis}` : ''}
                    </span>
                    <span className="text-[10px] text-amber-600 shrink-0 font-mono">
                      {u.erstellerName}
                    </span>
                  </a>
                );
              })}
              {urlaubsantraegeSortiert.length > 12 && (
                <a
                  href="/planung"
                  className="block py-1 text-center text-xs text-amber-700 hover:text-amber-900 font-medium"
                >
                  … und {urlaubsantraegeSortiert.length - 12} weitere
                </a>
              )}
            </div>
          )}
        </div>
      )}

      {/* Selbsterfassung Zusammenträger — Prüfung ausstehend */}
      {isAdminAuthenticated && (
        <div className={`mt-4 bg-white rounded-xl shadow-sm p-4 md:p-6 border ${
          ungepruefteSelbsterfassung.length > 0 ? 'border-amber-300' : 'border-gray-200'
        }`}>
          <div className="flex items-center gap-2 mb-3">
            <span className={ungepruefteSelbsterfassung.length > 0 ? 'text-amber-600' : 'text-gray-400'}>📦</span>
            <h2 className="font-semibold text-gray-800">
              Selbsterfassung Zusammenträger — Prüfung ausstehend
            </h2>
            <span className={`ml-auto text-xs px-2 py-0.5 rounded-full font-medium ${
              ungepruefteSelbsterfassung.length === 0
                ? 'bg-green-100 text-green-700'
                : 'bg-amber-100 text-amber-800'
            }`}>
              {ungepruefteSelbsterfassung.length}
            </span>
          </div>
          {ungepruefteSelbsterfassung.length === 0 ? (
            <p className="text-sm text-gray-500 italic">
              Keine offene Selbsterfassung zu prüfen. ✓
            </p>
          ) : (
            <div className="space-y-1.5 max-h-64 overflow-y-auto">
              {ungepruefteSelbsterfassung.map((a) => (
                <a
                  key={a.id}
                  href="/zusammentragen"
                  className="flex items-center justify-between gap-2 py-1.5 px-2.5 rounded-md bg-amber-50 border border-amber-200 hover:bg-amber-100"
                >
                  <span className="text-sm font-medium text-amber-900">
                    Bitte Selbsterfassung Zusammenträger in {kwLabel(a.kw, a.jahr)} prüfen
                  </span>
                  {a.selbsterfassungZusammentragenAm && (
                    <span className="text-[11px] text-amber-600 shrink-0 font-mono">
                      {new Date(a.selbsterfassungZusammentragenAm).toLocaleDateString('de-DE')}
                    </span>
                  )}
                </a>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Noch nicht angemeldete Mitarbeiter (unterhalb der anderen Auswertungen) */}
      {isAdminAuthenticated && (
        <div className="mt-4 bg-white rounded-xl shadow-sm border border-gray-200 p-4 md:p-6">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-amber-600">⏳</span>
            <h2 className="font-semibold text-gray-800">
              Noch nicht beim Lohnbüro angemeldet
            </h2>
            <span className={`ml-auto text-xs px-2 py-0.5 rounded-full font-medium ${
              nichtAngemeldeteMitarbeiter.length === 0
                ? 'bg-green-100 text-green-700'
                : 'bg-amber-100 text-amber-800'
            }`}>
              {nichtAngemeldeteMitarbeiter.length}
            </span>
          </div>
          {nichtAngemeldeteMitarbeiter.length === 0 ? (
            <p className="text-sm text-gray-500 italic">
              Alle Mitarbeiter sind beim Lohnbüro angemeldet. ✓
            </p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              {nichtAngemeldeteMitarbeiter.map((m) => (
                <a
                  key={m.id}
                  href="/mitarbeiter"
                  className="flex items-center justify-between py-1.5 px-2.5 rounded-md bg-amber-50 border border-amber-200 hover:bg-amber-100"
                >
                  <span className="text-sm font-medium text-amber-900 truncate">{m.name}</span>
                  <span className="text-xs text-amber-700 font-mono shrink-0 ml-2">{m.nummer}</span>
                </a>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Laufzeit eines Darlehens als „MM/JJJJ – MM/JJJJ (Rate n/gesamt)". */
function laufzeitLabel(e: OffenesDarlehen): string {
  const mm = (m: number) => String(m).padStart(2, '0');
  const start = `${mm(e.startMonat)}/${e.startJahr}`;
  const ende =
    e.endeMonat != null && e.endeJahr != null ? `${mm(e.endeMonat)}/${e.endeJahr}` : '–';
  return `${start} – ${ende} (Rate ${e.rateNr}/${e.rateGesamt})`;
}

function RestmengeZeile({ rang, stat }: { rang: number; stat: TgRestmengeStat }) {
  const rest = stat.durchschnittRest;
  const hoch = rest > 10; // Schwelle für Mengen-Anpassungs-Hinweis
  return (
    <a
      href="/zeitübersicht"
      className={`flex items-center justify-between gap-3 py-1.5 px-2.5 rounded-md border ${
        hoch
          ? 'bg-amber-50 border-amber-200 hover:bg-amber-100'
          : 'bg-gray-50 border-gray-200 hover:bg-gray-100'
      }`}
      title="Zur Zeiten- & Restmengen-Übersicht"
    >
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-xs font-mono text-gray-400 w-4 shrink-0">{rang}.</span>
        <span className="text-sm font-medium text-gray-800 truncate">{stat.name}</span>
        {stat.plz && <span className="text-xs text-gray-400 font-mono shrink-0">{stat.plz}</span>}
      </div>
      <div className="flex items-center gap-3 shrink-0 text-right">
        {stat.durchschnittFehl > 0 && (
          <span className="text-xs text-red-700 font-medium whitespace-nowrap" title="Ø Fehlmenge je Meldung">
            ⚠ {stat.durchschnittFehl.toLocaleString('de-DE', { maximumFractionDigits: 1 })}
          </span>
        )}
        <span className={`text-sm font-semibold whitespace-nowrap ${hoch ? 'text-amber-800' : 'text-gray-700'}`}>
          Ø {rest.toLocaleString('de-DE', { maximumFractionDigits: 1 })}
          <span className="text-xs font-normal text-gray-500"> Stk</span>
        </span>
        <span className="text-[11px] text-gray-400 whitespace-nowrap w-16 text-right">
          {stat.anzahlMeldungen} Meld.
        </span>
      </div>
    </a>
  );
}

function StatChip({
  label,
  value,
  icon,
  color,
}: {
  label: string;
  value: number;
  icon: string;
  color: 'blue' | 'green' | 'yellow' | 'orange' | 'purple';
}) {
  const colors = {
    blue: 'bg-blue-50 text-blue-700',
    green: 'bg-green-50 text-green-700',
    yellow: 'bg-yellow-50 text-yellow-700',
    orange: 'bg-orange-50 text-orange-700',
    purple: 'bg-purple-50 text-purple-700',
  };
  return (
    <div className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm ${colors[color]}`}>
      <span className="text-base leading-none">{icon}</span>
      <span className="font-bold">{value}</span>
      <span className="text-xs font-medium opacity-80">{label}</span>
    </div>
  );
}

function QuickLink({
  href,
  icon,
  title,
  desc,
}: {
  href: string;
  icon: string;
  title: string;
  desc: string;
}) {
  return (
    <a
      href={href}
      className="flex items-center gap-3 p-3.5 rounded-lg border border-gray-200 hover:border-blue-300 hover:bg-blue-50 active:bg-blue-100 transition-colors group"
    >
      <span className="text-2xl shrink-0">{icon}</span>
      <div>
        <div className="text-sm font-medium text-gray-800 group-hover:text-blue-700">
          {title}
        </div>
        <div className="text-xs text-gray-500">{desc}</div>
      </div>
    </a>
  );
}
