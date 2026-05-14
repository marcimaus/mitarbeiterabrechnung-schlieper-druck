import { useState, useEffect, type FormEvent } from 'react';
import { useApp } from '../context/AppContext';
import AdminPinGate from '../components/AdminPinGate';
import Modal from '../components/Modal';
import {
  ladeMonatsarbeitszeiten,
  ladeAlleMonatsarbeitszeiten,
  berechneNettoMinuten,
  formatierZeit,
  formatierDatum,
  formatierDauer,
  korrigiereSession,
} from '../lib/zeiterfassung';
import { ladeFahrten, erstelleArbeitszeit, ladeAusgaben, ladeArbeitszeiten, loescheArbeitszeit, aktualisiereArbeitszeit, ladeEinsaetze, setzeEinsatz, aktualisiereEinsatzMeldung } from '../lib/db';
import { MONATSNAMEN, donnerstagDerKW, kwLabel } from '../lib/kalender';
import { ermittleStundenlohn, ermittleStundenlohnZusammen } from '../lib/berechnung';
import { findAbgeschlossenePeriodeFuerZeitraum } from '../lib/abrechnungslogik';
import { istEinsatzbereit } from '../utils';
import type { Arbeitszeit, Fahrt, ArbeitszeitsTyp, AuditEintrag, Rolle, Ausgabe } from '../types';
import { TYP_LABELS, ROLLEN_LABELS } from '../types';

const ALLE_TYPEN: ArbeitszeitsTyp[] = ['austragen', 'zusammentragen', 'vorarbeit', 'sonstige'];
const ALLE_ROLLEN = Object.keys(ROLLEN_LABELS) as Rolle[];

export default function ZeitübersichtScreen() {
  return (
    <AdminPinGate allowedRoles={['admin', 'abrechnung', 'mitarbeiter']}>
      <ZeitübersichtInhalt />
    </AdminPinGate>
  );
}

interface RestmengeMeldung {
  einsatzId: string;
  teilgebietId: string;
  ausgabeId: string;
  kw: number;
  jahr: number;
  mitarbeiterId: string;
  restmenge: number;
  fehlmenge: number;
  kommentar?: string;
  eingereichtAm?: number;
}

function ZeitübersichtInhalt() {
  const { mitarbeiter, parameter, adminName, userRole, mitarbeiterId, teilgebiete } = useApp();
  const isAdmin = userRole === 'admin';
  const istMitarbeiter = userRole === 'mitarbeiter';
  const heute = new Date();
  // Mitarbeiter sehen NUR ihre eigenen Daten — selectedMaId ist auf den
  // eingeloggten MA fixiert; keine Auswahlliste, kein Wechsel möglich.
  const [selectedMaId, setSelectedMaId] = useState<string>(
    istMitarbeiter ? (mitarbeiterId ?? '') : ''
  );
  const [monat, setMonat] = useState(heute.getMonth() + 1);
  const [jahr, setJahr] = useState(heute.getFullYear());
  const [sessions, setSessions] = useState<Arbeitszeit[]>([]);
  const [fahrten, setFahrten] = useState<Fahrt[]>([]);
  const [loading, setLoading] = useState(false);
  const [editSession, setEditSession] = useState<Arbeitszeit | null>(null);
  const [showNeueZeit, setShowNeueZeit] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [ausgaben, setAusgaben] = useState<Ausgabe[]>([]);
  const [restmengen, setRestmengen] = useState<RestmengeMeldung[]>([]);
  /** Nacherfassungs-Modal: initial-meldung gesetzt → bearbeiten, sonst neu. */
  const [nacherfassen, setNacherfassen] = useState<{
    initial: RestmengeMeldung | null;
  } | null>(null);

  // Ausgaben einmalig laden (für Ausgabe-Auswahl bei Vorarbeit)
  useEffect(() => {
    ladeAusgaben()
      .then((list) => {
        const sortiert = [...list].sort(
          (a, b) => b.jahr - a.jahr || b.kw - a.kw
        );
        setAusgaben(sortiert);
      })
      .catch((err) => console.error('Fehler beim Laden der Ausgaben:', err));
  }, []);

  // Restmengen-Meldungen für den gewählten Monat/Jahr laden.
  // Quellen: Einsätze aller Ausgaben, deren Erscheinungstag (Donnerstag der KW)
  // in den gewählten Monat/Jahr fällt, mit restmenge > 0 und mitarbeiterId gesetzt.
  useEffect(() => {
    if (ausgaben.length === 0) return;
    let cancelled = false;
    (async () => {
      const relevante = ausgaben.filter((a) => {
        const d = donnerstagDerKW(a.kw, a.jahr);
        return d.getUTCFullYear() === jahr && d.getUTCMonth() + 1 === monat;
      });
      if (relevante.length === 0) {
        if (!cancelled) setRestmengen([]);
        return;
      }
      try {
        const listen = await Promise.all(relevante.map((a) => ladeEinsaetze(a.id)));
        if (cancelled) return;
        const result: RestmengeMeldung[] = [];
        for (let i = 0; i < relevante.length; i++) {
          const a = relevante[i];
          for (const e of listen[i]) {
            const rest = e.restmenge ?? 0;
            const fehl = e.fehlmenge ?? 0;
            const komm = e.meldungKommentar;
            if (!e.mitarbeiterId) continue;
            if (rest <= 0 && fehl <= 0 && !komm) continue;
            result.push({
              einsatzId: e.id,
              teilgebietId: e.teilgebietId,
              ausgabeId: a.id,
              kw: a.kw,
              jahr: a.jahr,
              mitarbeiterId: e.mitarbeiterId,
              restmenge: rest,
              fehlmenge: fehl,
              kommentar: komm,
              eingereichtAm: e.meldungEingereichtAm,
            });
          }
        }
        setRestmengen(result);
      } catch (err) {
        console.error('Fehler beim Laden der Restmengen:', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ausgaben, jahr, monat, reloadKey]);

  // Suche / Filter
  const [suchText, setSuchText] = useState('');
  const [filterRolle, setFilterRolle] = useState<Rolle | ''>('');
  const [filterTyp, setFilterTyp] = useState<ArbeitszeitsTyp | ''>('');
  // Filter „Mit/Ohne Zeiten im Zeitraum" für die Alle-MA-Übersicht
  const [filterZeiten, setFilterZeiten] = useState<'' | 'mit' | 'ohne'>('');
  // Sessions ALLER Mitarbeiter im Zeitraum — nur geladen, wenn kein MA
  // ausgewählt ist und nicht Mitarbeiter-Login.
  const [alleSessions, setAlleSessions] = useState<Arbeitszeit[]>([]);
  const [loadingAlle, setLoadingAlle] = useState(false);

  const aktiveMitarbeiter = mitarbeiter.filter((m) => istEinsatzbereit(m));

  // Kandidaten für die Suchliste — wird NUR angezeigt, wenn noch kein Mitarbeiter
  // ausgewählt ist. Rollen-Filter greift bereits hier.
  const suchKandidaten = aktiveMitarbeiter.filter((m) => {
    if (filterRolle && !m.rollen.includes(filterRolle)) return false;
    if (suchText) {
      const q = suchText.toLowerCase();
      if (!m.name.toLowerCase().includes(q) && !m.nummer.includes(suchText)) {
        return false;
      }
    }
    return true;
  });

  useEffect(() => {
    if (!selectedMaId) return;
    setLoading(true);
    Promise.all([
      ladeMonatsarbeitszeiten(selectedMaId, jahr, monat),
      ladeFahrten({ mitarbeiterId: selectedMaId }),
    ]).then(([sess, fList]) => {
      setSessions(sess);
      const monatsFahrten = fList.filter((f) => {
        const d = new Date(f.datum);
        return d.getFullYear() === jahr && d.getMonth() + 1 === monat;
      });
      setFahrten(monatsFahrten);
    }).catch((err) => {
      console.error('Fehler beim Laden der Zeiten:', err);
    }).finally(() => {
      setLoading(false);
    });
  }, [selectedMaId, monat, jahr, reloadKey]);

  // Alle-MA-Modus: alle Arbeitszeiten des gewählten Monats laden
  useEffect(() => {
    if (selectedMaId || istMitarbeiter) {
      setAlleSessions([]);
      return;
    }
    setLoadingAlle(true);
    ladeAlleMonatsarbeitszeiten(jahr, monat)
      .then(setAlleSessions)
      .catch((err) => console.error('Fehler beim Laden aller Zeiten:', err))
      .finally(() => setLoadingAlle(false));
  }, [selectedMaId, jahr, monat, reloadKey, istMitarbeiter]);

  const ma = mitarbeiter.find((m) => m.id === selectedMaId);

  const abgeschlSessions = sessions.filter((s) => s.status === 'abgeschlossen');
  const gesamtNettoMinuten = abgeschlSessions.reduce(
    (sum, s) => sum + berechneNettoMinuten(s), 0
  );

  // Prüft, ob eine Session in die Lohnberechnung einfliesst.
  // Austragen/Zusammentragen werden standardmäßig über Parameter bzw. Teilgebiet/Stapel
  // abgerechnet — die Ist-Zeit fliesst nur ein, wenn in den Parametern der jeweilige
  // Toggle "nach Ist-Zeit" aktiviert ist.
  const fliessesInLohn = (s: Arbeitszeit): boolean => {
    if (ma?.hatFestgehalt) return false; // Festgehalt ist fix
    switch (s.typ) {
      case 'austragen':
        return parameter?.austragenNachIstZeit === true;
      case 'zusammentragen':
        return parameter?.zusammentragenNachIstZeit === true;
      case 'vorarbeit':
      case 'sonstige':
        return true;
      default:
        return false;
    }
  };

  // Aufschlüsselung für Info-Anzeige (nicht in Lohn einfliessend)
  const minutenNichtAbgerechnet: Record<ArbeitszeitsTyp, number> = {
    austragen: 0, zusammentragen: 0, vorarbeit: 0, sonstige: 0,
  };
  abgeschlSessions
    .filter((s) => !fliessesInLohn(s))
    .forEach((s) => {
      minutenNichtAbgerechnet[s.typ as ArbeitszeitsTyp] += berechneNettoMinuten(s);
    });

  // Stundenlöhne je Tarif:
  //  - Austragen/Sonstige → ermittleStundenlohn (= MiLoG / Minderjährige Austr.)
  //  - Zusammentragen/Vorarbeit → ermittleStundenlohnZusammen
  const stundenlohnAustragen = ma && parameter ? ermittleStundenlohn(ma, parameter) : null;
  const stundenlohnZusammen = ma && parameter ? ermittleStundenlohnZusammen(ma, parameter) : null;
  // Für die Karten-Sub-Anzeige bevorzugen wir den Austragen-Tarif, ergänzen
  // aber den Zusammentragen-Tarif wenn er sich unterscheidet.
  const stundenlohn = stundenlohnAustragen;
  const lohnGesamt =
    stundenlohnAustragen != null && stundenlohnZusammen != null && !ma?.hatFestgehalt
      ? abgeschlSessions
          .filter(fliessesInLohn)
          .reduce((s, sess) => {
            const stdH = berechneNettoMinuten(sess) / 60;
            const lohnsatz =
              sess.typ === 'vorarbeit' || sess.typ === 'zusammentragen'
                ? stundenlohnZusammen
                : stundenlohnAustragen;
            return s + stdH * lohnsatz;
          }, 0)
      : null;
  const fahrtSatz = (ma?.fahrkostenEurProKm ?? parameter?.fahrkostenEurProKm ?? 0.30);
  const fahrtkostenGesamt = fahrten.reduce((s, f) => s + f.streckKm * fahrtSatz, 0);

  const jahre = [heute.getFullYear() - 1, heute.getFullYear(), heute.getFullYear() + 1];

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Zeitübersicht</h1>

      {/* Filter */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 mb-6">
        <div className="flex flex-wrap gap-3 items-center">
          {selectedMaId && ma ? (
            <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 text-sm">
              <span className="font-medium text-blue-800">
                {ma.hatFestgehalt ? '🔒 ' : ''}{ma.name}
              </span>
              <span className="text-blue-500 text-xs">({ma.nummer})</span>
              {!istMitarbeiter && (
                <button
                  onClick={() => { setSelectedMaId(''); setFilterTyp(''); }}
                  className="ml-1 text-blue-500 hover:text-blue-700"
                  title="Auswahl aufheben"
                >
                  ✕
                </button>
              )}
            </div>
          ) : (
            !istMitarbeiter && (
              <input
                type="text"
                placeholder="Name oder Nummer suchen..."
                value={suchText}
                onChange={(e) => setSuchText(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-56"
              />
            )
          )}
          {!istMitarbeiter && (
            <select
              value={filterRolle}
              onChange={(e) => setFilterRolle(e.target.value as Rolle | '')}
              className={selectClass}
              title="Kategorie des Mitarbeiters"
            >
              <option value="">Alle Kategorien</option>
              {ALLE_ROLLEN.map((r) => (
                <option key={r} value={r}>{ROLLEN_LABELS[r]}</option>
              ))}
            </select>
          )}
          {/* Typ-Filter — sowohl für Einzelansicht (selectedMaId) als
              auch im Alle-MA-Modus. Beim Mitarbeiter-Login bleibt er
              ebenfalls verfügbar. */}
          <select
            value={filterTyp}
            onChange={(e) => setFilterTyp(e.target.value as ArbeitszeitsTyp | '')}
            className={selectClass}
            title="Typ der Zeiterfassung"
          >
            <option value="">Alle Typen</option>
            {ALLE_TYPEN.map((t) => (
              <option key={t} value={t}>{TYP_LABELS[t]}</option>
            ))}
          </select>
          {/* „Mit/Ohne Zeiten"-Filter: nur sinnvoll im Alle-MA-Modus,
              da er die MA-Liste (nicht die Zeiten) einschränkt. */}
          {!selectedMaId && !istMitarbeiter && (
            <select
              value={filterZeiten}
              onChange={(e) => setFilterZeiten(e.target.value as '' | 'mit' | 'ohne')}
              className={selectClass}
              title="Mitarbeiter mit oder ohne erfasste Zeiten im gewählten Zeitraum"
            >
              <option value="">MA: alle</option>
              <option value="mit">nur mit Zeiten</option>
              <option value="ohne">nur ohne Zeiten</option>
            </select>
          )}
          <select value={monat} onChange={(e) => setMonat(Number(e.target.value))} className={selectClass}>
            {MONATSNAMEN.map((name, i) => (
              <option key={i + 1} value={i + 1}>{name}</option>
            ))}
          </select>
          <select value={jahr} onChange={(e) => setJahr(Number(e.target.value))} className={selectClass}>
            {jahre.map((j) => <option key={j} value={j}>{j}</option>)}
          </select>
          {!istMitarbeiter && (
            <button
              onClick={() => setShowNeueZeit(true)}
              className="ml-auto bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700"
            >
              + Neue Zeit erfassen
            </button>
          )}
        </div>
      </div>

      {!selectedMaId && !istMitarbeiter && (() => {
        // Zeiten pro MA gruppieren (gefiltert nach Typ)
        const gefilterteSessions = filterTyp
          ? alleSessions.filter((s) => s.typ === filterTyp)
          : alleSessions;
        const minutenJeMa = new Map<string, number>();
        const zeitenJeMa = new Map<string, Arbeitszeit[]>();
        for (const s of gefilterteSessions) {
          if (s.status !== 'abgeschlossen') continue;
          minutenJeMa.set(s.mitarbeiterId, (minutenJeMa.get(s.mitarbeiterId) ?? 0) + berechneNettoMinuten(s));
          const arr = zeitenJeMa.get(s.mitarbeiterId) ?? [];
          arr.push(s);
          zeitenJeMa.set(s.mitarbeiterId, arr);
        }
        // Restmengen pro MA aggregieren (aus Selbstmeldung / QR-Code).
        const restmengeJeMa = new Map<string, { summe: number; count: number }>();
        for (const r of restmengen) {
          const cur = restmengeJeMa.get(r.mitarbeiterId) ?? { summe: 0, count: 0 };
          cur.summe += r.restmenge;
          cur.count += 1;
          restmengeJeMa.set(r.mitarbeiterId, cur);
        }
        // MA-Liste auf Such-/Rollen-Filter anwenden
        let liste = suchKandidaten;
        if (filterZeiten === 'mit') {
          liste = liste.filter((m) => (minutenJeMa.get(m.id) ?? 0) > 0);
        } else if (filterZeiten === 'ohne') {
          liste = liste.filter((m) => (minutenJeMa.get(m.id) ?? 0) === 0);
        }
        // Sortierung: MA mit Zeiten zuerst (absteigend), dann Name
        liste = [...liste].sort((a, b) => {
          const ma = minutenJeMa.get(a.id) ?? 0;
          const mb = minutenJeMa.get(b.id) ?? 0;
          if (ma !== mb) return mb - ma;
          return a.name.localeCompare(b.name, 'de');
        });
        const summeAlleMinuten = Array.from(minutenJeMa.values()).reduce((s, m) => s + m, 0);
        const maMitZeiten = Array.from(minutenJeMa.values()).filter((m) => m > 0).length;
        return (
          <div className="space-y-4">
            {/* Zusammenfassung */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <SummaryCard
                label="Mitarbeiter mit Zeiten"
                value={maMitZeiten.toString()}
                sub={`von ${suchKandidaten.length} angezeigten`}
              />
              <SummaryCard
                label="Σ Sessions"
                value={gefilterteSessions.length.toString()}
              />
              <SummaryCard
                label="Σ Netto-Stunden"
                value={formatierDauer(summeAlleMinuten)}
              />
              <SummaryCard
                label="Zeitraum"
                value={`${MONATSNAMEN[monat - 1]} ${jahr}`}
              />
            </div>

            {/* MA-Liste mit Stunden + Klick-Drilldown */}
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100 bg-gray-50 text-sm text-gray-600 font-medium flex items-center justify-between">
                <span>
                  {loadingAlle
                    ? 'Lade Zeiten…'
                    : `${liste.length} Mitarbeiter — zum Drilldown anklicken`}
                </span>
                {filterTyp && (
                  <span className="text-xs text-blue-700">
                    Filter Typ: {TYP_LABELS[filterTyp as ArbeitszeitsTyp]}
                  </span>
                )}
              </div>
              {!loadingAlle && liste.length === 0 && (
                <div className="px-4 py-8 text-center text-sm text-gray-400">
                  Keine Mitarbeiter passen zu den Filterkriterien.
                </div>
              )}
              {!loadingAlle && liste.length > 0 && (
                <ul className="max-h-[560px] overflow-y-auto divide-y divide-gray-100">
                  {liste.map((m) => {
                    const minutenSum = minutenJeMa.get(m.id) ?? 0;
                    const sessions = zeitenJeMa.get(m.id) ?? [];
                    const istLeer = minutenSum === 0;
                    const rest = restmengeJeMa.get(m.id);
                    return (
                      <li key={m.id}>
                        <button
                          onClick={() => setSelectedMaId(m.id)}
                          className={`w-full flex items-center justify-between px-4 py-3 text-left transition-colors ${
                            istLeer ? 'hover:bg-gray-50' : 'hover:bg-blue-50'
                          }`}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="font-medium text-gray-800 text-sm">
                              {m.hatFestgehalt ? '🔒 ' : ''}{m.name}
                            </div>
                            <div className="text-xs text-gray-500">
                              {m.nummer} ·{' '}
                              {m.rollen.map((r) => ROLLEN_LABELS[r]).join(', ') || 'ohne Rolle'}
                            </div>
                          </div>
                          <div className="text-right shrink-0 flex items-start gap-4">
                            {rest && rest.summe > 0 && (
                              <div
                                className="text-right"
                                title={`Σ Restmenge (von Austrägern via QR-Code gemeldet) — ${rest.count} Meldung${rest.count === 1 ? '' : 'en'}`}
                              >
                                <div className="text-xs font-semibold text-amber-700 whitespace-nowrap">
                                  📦 {rest.summe.toLocaleString('de-DE')}
                                </div>
                                <div className="text-[10px] text-amber-600">
                                  Restmenge ({rest.count})
                                </div>
                              </div>
                            )}
                            <div>
                              {istLeer ? (
                                <span className="text-xs text-gray-400 italic">keine Zeiten</span>
                              ) : (
                                <>
                                  <div className="text-sm font-semibold text-gray-800">
                                    {formatierDauer(minutenSum)}
                                  </div>
                                  <div className="text-xs text-gray-500">
                                    {sessions.length} {sessions.length === 1 ? 'Session' : 'Sessions'}
                                  </div>
                                </>
                              )}
                            </div>
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        );
      })()}

      {selectedMaId && loading && (
        <div className="text-gray-400 text-sm text-center p-8">Lädt...</div>
      )}

      {selectedMaId && !loading && (
        <>
          {/* Zusammenfassung */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <SummaryCard label="Arbeitstage" value={sessions.filter(s => s.status === 'abgeschlossen').length.toString()} />
            <SummaryCard label="Netto-Stunden" value={formatierDauer(gesamtNettoMinuten)} />
            {lohnGesamt !== null && (
              <SummaryCard
                label="Lohn (Zeiterfassung)"
                value={lohnGesamt.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}
                sub={
                  stundenlohnAustragen != null &&
                  stundenlohnZusammen != null &&
                  Math.abs(stundenlohnAustragen - stundenlohnZusammen) > 0.005
                    ? `Austragen ${stundenlohnAustragen.toFixed(2)} €/h · Zus./Vorarbeit ${stundenlohnZusammen.toFixed(2)} €/h`
                    : `${stundenlohn?.toFixed(2)} €/h`
                }
              />
            )}
            {ma?.hatFestgehalt && (
              <SummaryCard
                label="Lohn (Zeiterfassung)"
                value="Festgehalt"
                sub="Zeit fließt nicht ein"
              />
            )}
            {fahrtkostenGesamt > 0 && (
              <SummaryCard
                label="Fahrtkosten"
                value={fahrtkostenGesamt.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}
              />
            )}
          </div>

          {/* Info: nicht in Zeit-Lohn einbezogene Tätigkeiten */}
          {!ma?.hatFestgehalt &&
            (minutenNichtAbgerechnet.austragen > 0 ||
              minutenNichtAbgerechnet.zusammentragen > 0) && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 mb-6 text-sm">
                <div className="font-medium text-blue-800 mb-1">
                  ℹ Nicht im Zeit-Lohn enthalten (separate Abrechnung):
                </div>
                <ul className="space-y-0.5 text-blue-700">
                  {minutenNichtAbgerechnet.austragen > 0 && (
                    <li>
                      • <strong>Austragen:</strong>{' '}
                      {formatierDauer(minutenNichtAbgerechnet.austragen)} — Abrechnung
                      erfolgt über Teilgebiet (Strecke + Stückzahl)
                    </li>
                  )}
                  {minutenNichtAbgerechnet.zusammentragen > 0 && (
                    <li>
                      • <strong>Zusammentragen:</strong>{' '}
                      {formatierDauer(minutenNichtAbgerechnet.zusammentragen)} —
                      Abrechnung erfolgt über Stapel/Stückzahl
                    </li>
                  )}
                </ul>
              </div>
            )}

          {/* Sessions-Tabelle */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden mb-6">
            <div className="px-4 py-3 border-b border-gray-200 bg-gray-50 font-medium text-sm text-gray-600">
              Arbeitstage — {MONATSNAMEN[monat - 1]} {jahr}
            </div>
            {(() => {
              const angezeigteSessions = filterTyp
                ? sessions.filter((s) => s.typ === filterTyp)
                : sessions;
              if (angezeigteSessions.length === 0) {
                return (
                  <div className="p-6 text-center text-gray-400 text-sm">
                    {sessions.length === 0
                      ? 'Keine Zeiten erfasst in diesem Monat'
                      : `Keine Zeiten vom Typ "${TYP_LABELS[filterTyp as ArbeitszeitsTyp]}" in diesem Monat`}
                  </div>
                );
              }
              return (
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-100">
                  <tr>
                    <th className="text-left px-4 py-2.5 font-medium text-gray-600">Datum</th>
                    <th className="text-left px-4 py-2.5 font-medium text-gray-600">Start</th>
                    <th className="text-left px-4 py-2.5 font-medium text-gray-600">Ende</th>
                    <th className="text-left px-4 py-2.5 font-medium text-gray-600">Pause</th>
                    <th className="text-left px-4 py-2.5 font-medium text-gray-600">Netto</th>
                    <th className="text-left px-4 py-2.5 font-medium text-gray-600">Typ</th>
                    <th className="px-4 py-2.5"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {angezeigteSessions.map((s) => (
                    <tr key={s.id} className={`hover:bg-gray-50 ${s.autoGeschlossenUm24 ? 'bg-amber-50' : ''}`}>
                      <td className="px-4 py-2.5 text-gray-700">{formatierDatum(s.startTime)}</td>
                      <td className="px-4 py-2.5 text-gray-700">{formatierZeit(s.startTime)}</td>
                      <td className="px-4 py-2.5 text-gray-700">
                        {s.endTime ? formatierZeit(s.endTime) : (
                          <span className="text-green-600 font-medium">Aktiv</span>
                        )}
                        {s.autoGeschlossenUm24 && (
                          <span className="ml-1 text-xs text-amber-600" title="Automatisch um 23:59 geschlossen">⚠</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-gray-600">
                        {formatierDauer(s.gesamtPauseMinuten)}
                      </td>
                      <td className="px-4 py-2.5 font-medium text-gray-800">
                        {formatierDauer(berechneNettoMinuten(s))}
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">
                          {s.typ}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        {s.korrekturLog.length > 0 && (
                          <span className="text-xs text-amber-600 mr-2" title="Korrigiert">✏</span>
                        )}
                        {s.nichtBeruecksichtigen && (
                          <span
                            className="text-[10px] bg-gray-200 text-gray-600 px-1.5 py-0.5 rounded mr-1"
                            title={s.nichtBeruecksichtigenGrund || 'Wird in der Abrechnung ignoriert'}
                          >
                            🚫 ignoriert
                          </span>
                        )}
                        {!istMitarbeiter && (
                          <button
                            onClick={() => setEditSession(s)}
                            className="text-xs text-blue-600 hover:text-blue-800 mr-2"
                          >
                            Bearbeiten
                          </button>
                        )}
                        {!isAdmin && !istMitarbeiter && (
                          <button
                            onClick={async () => {
                              if (s.nichtBeruecksichtigen) {
                                if (!confirm('Markierung „nicht berücksichtigen" entfernen?\nDer Eintrag fließt dann wieder in die Abrechnung ein.')) return;
                                await aktualisiereArbeitszeit(s.id, {
                                  nichtBeruecksichtigen: undefined,
                                  nichtBeruecksichtigenGrund: undefined,
                                  korrekturLog: [
                                    ...s.korrekturLog,
                                    { zeitstempel: Date.now(), adminName, aktion: '„nicht berücksichtigen" entfernt' },
                                  ],
                                });
                              } else {
                                const grund = prompt('Grund (optional, z. B. „Datum falsch erfasst"):') ?? undefined;
                                await aktualisiereArbeitszeit(s.id, {
                                  nichtBeruecksichtigen: true,
                                  nichtBeruecksichtigenGrund: grund && grund.trim() ? grund.trim() : undefined,
                                  korrekturLog: [
                                    ...s.korrekturLog,
                                    { zeitstempel: Date.now(), adminName, aktion: `als „nicht berücksichtigen" markiert${grund ? ` — ${grund}` : ''}` },
                                  ],
                                });
                              }
                              setReloadKey((k) => k + 1);
                            }}
                            className="text-xs text-amber-600 hover:text-amber-800"
                            title="Eintrag als ungültig markieren — fließt nicht in die Abrechnung ein"
                          >
                            {s.nichtBeruecksichtigen ? '✓ wieder zählen' : 'ignorieren'}
                          </button>
                        )}
                        {isAdmin && (
                          <button
                            onClick={async () => {
                              if (!confirm(`Diesen Eintrag (${formatierDauer(berechneNettoMinuten(s))}, ${s.typ}) wirklich endgültig löschen?\nDer Eintrag wird aus der Datenbank entfernt.`)) return;
                              await loescheArbeitszeit(s.id);
                              setReloadKey((k) => k + 1);
                            }}
                            className="text-xs text-red-500 hover:text-red-700"
                            title="Eintrag endgültig löschen (Admin)"
                          >
                            ✕ Löschen
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              );
            })()}
          </div>

          {/* Rest- und Fehlmengen (vom Austräger via QR-Code gemeldet
              oder vom Admin per Nacherfassung eingetragen) */}
          <RestmengenAustraegerÜbersicht
            meldungen={restmengen.filter((r) => r.mitarbeiterId === selectedMaId)}
            teilgebiete={teilgebiete}
            isAdmin={!istMitarbeiter}
            onEdit={(m) => setNacherfassen({ initial: m })}
          />

          {/* Fahrten (read-only — Erfassung über Fahrtkosten-Screen) */}
          <FahrtenÜbersicht fahrten={fahrten} fahrtSatz={fahrtSatz} />
        </>
      )}

      {/* Neue-Zeit-Modal */}
      <Modal
        isOpen={showNeueZeit}
        onClose={() => setShowNeueZeit(false)}
        title="Neue Arbeitszeit erfassen"
        size="md"
      >
        <NeueZeitForm
          aktiveMitarbeiter={aktiveMitarbeiter}
          vorausgewaehlteMaId={selectedMaId}
          adminName={adminName}
          ausgaben={ausgaben}
          onSaved={() => {
            setShowNeueZeit(false);
            setReloadKey((k) => k + 1);
          }}
          onCancel={() => setShowNeueZeit(false)}
        />
      </Modal>

      {/* Korrektur-Modal */}
      <Modal
        isOpen={editSession !== null}
        onClose={() => setEditSession(null)}
        title="Session bearbeiten"
        size="md"
      >
        {editSession && (
          <SessionKorrektur
            session={editSession}
            adminName={adminName}
            ausgaben={ausgaben}
            onSave={async (changes, begruendung) => {
              await korrigiereSession(editSession, changes, adminName, begruendung);
              setSessions((prev) => prev.map((s) =>
                s.id === editSession.id ? { ...s, ...changes } : s
              ));
              setEditSession(null);
            }}
            onCancel={() => setEditSession(null)}
          />
        )}
      </Modal>

      {/* Nacherfassungs-Modal für Rest-/Fehlmengen */}
      <Modal
        isOpen={nacherfassen !== null}
        onClose={() => setNacherfassen(null)}
        title={nacherfassen?.initial ? 'Rest- / Fehlmenge bearbeiten' : 'Rest- / Fehlmenge nacherfassen'}
        size="md"
      >
        {nacherfassen && (
          <RestmengeNacherfassenForm
            initial={nacherfassen.initial}
            mitarbeiterId={selectedMaId}
            teilgebiete={teilgebiete}
            ausgaben={ausgaben}
            onSaved={() => {
              setNacherfassen(null);
              setReloadKey((k) => k + 1);
            }}
            onCancel={() => setNacherfassen(null)}
          />
        )}
      </Modal>
    </div>
  );
}

// ---- Summary Card ------------------------------------------

function SummaryCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
      <div className="text-xs text-gray-500 mb-1">{label}</div>
      <div className="font-bold text-gray-900">{value}</div>
      {sub && <div className="text-xs text-gray-400 mt-0.5">{sub}</div>}
    </div>
  );
}

// ---- Rest-/Fehlmengen-Übersicht (vom Austräger gemeldet) ---

function RestmengenAustraegerÜbersicht({
  meldungen,
  teilgebiete,
  isAdmin,
  onEdit,
}: {
  meldungen: RestmengeMeldung[];
  teilgebiete: import('../types').Teilgebiet[];
  isAdmin: boolean;
  onEdit: (m: RestmengeMeldung) => void;
}) {
  // Wenn der MA keine Meldungen im Zeitraum hat, gar nichts anzeigen.
  if (meldungen.length === 0) return null;
  const tgMap = new Map(teilgebiete.map((t) => [t.id, t]));
  const summeRest = meldungen.reduce((s, m) => s + m.restmenge, 0);
  const summeFehl = meldungen.reduce((s, m) => s + m.fehlmenge, 0);
  // Fehlmengen oben, dann nach KW/Jahr absteigend
  const sortiert = [...meldungen].sort((a, b) => {
    const af = a.fehlmenge > 0 ? 1 : 0;
    const bf = b.fehlmenge > 0 ? 1 : 0;
    if (af !== bf) return bf - af;
    return b.jahr !== a.jahr ? b.jahr - a.jahr : b.kw - a.kw;
  });

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden mb-6">
      <div className="px-4 py-3 border-b border-gray-200 bg-amber-50 flex items-center gap-2 flex-wrap">
        <span className="text-amber-700">📦</span>
        <span className="font-medium text-sm text-amber-900">
          Rest- &amp; Fehlmengen
        </span>
        <span className="text-xs text-amber-700">
          {summeFehl > 0 && <span className="text-red-700 font-semibold mr-2">⚠ Σ Fehl: {summeFehl.toLocaleString('de-DE')}</span>}
          Σ Rest: {summeRest.toLocaleString('de-DE')} Stk in {meldungen.length} Meldung{meldungen.length === 1 ? '' : 'en'}
        </span>
      </div>
      {meldungen.length === 0 ? (
        <div className="px-4 py-6 text-center text-sm text-gray-400">
          Keine Meldungen im gewählten Monat.
        </div>
      ) : (
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-100">
            <tr>
              <th className="text-left px-4 py-2 font-medium text-gray-600">KW/Jahr</th>
              <th className="text-left px-4 py-2 font-medium text-gray-600">Teilgebiet</th>
              <th className="text-right px-4 py-2 font-medium text-gray-600">Fehlmenge</th>
              <th className="text-right px-4 py-2 font-medium text-gray-600">Restmenge</th>
              <th className="text-right px-4 py-2 font-medium text-gray-600">Anteil</th>
              <th className="text-left px-4 py-2 font-medium text-gray-600">Kommentar</th>
              <th className="text-right px-4 py-2 font-medium text-gray-600">Gemeldet</th>
              {isAdmin && <th className="px-4 py-2"></th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {sortiert.map((m) => {
              const tg = tgMap.get(m.teilgebietId);
              const anteil = tg && tg.stueckzahl > 0 && m.restmenge > 0
                ? (m.restmenge / tg.stueckzahl) * 100
                : null;
              const hatFehl = m.fehlmenge > 0;
              return (
                <tr key={m.einsatzId} className={`align-top ${hatFehl ? 'bg-red-50/60 hover:bg-red-100/60' : 'hover:bg-gray-50'}`}>
                  <td className="px-4 py-2 text-gray-700 font-mono text-xs whitespace-nowrap">
                    {hatFehl && <span className="mr-1 text-red-600">⚠</span>}
                    {kwLabel(m.kw, m.jahr)}
                  </td>
                  <td className="px-4 py-2 text-gray-700">
                    {tg?.name ?? <span className="text-gray-400 italic">— gelöscht —</span>}
                    {tg?.plz && <span className="ml-1 text-xs text-gray-400">({tg.plz})</span>}
                  </td>
                  <td className={`px-4 py-2 text-right font-mono text-xs ${hatFehl ? 'font-bold text-red-700' : 'text-gray-300'}`}>
                    {hatFehl ? m.fehlmenge.toLocaleString('de-DE') : '—'}
                  </td>
                  <td className={`px-4 py-2 text-right font-mono text-xs ${m.restmenge > 0 ? 'font-semibold text-amber-700' : 'text-gray-300'}`}>
                    {m.restmenge > 0 ? m.restmenge.toLocaleString('de-DE') : '—'}
                  </td>
                  <td className={`px-4 py-2 text-right font-mono text-xs ${
                    anteil != null && anteil >= 5 ? 'text-red-700 font-semibold'
                      : anteil != null && anteil >= 2 ? 'text-amber-700'
                      : 'text-gray-500'
                  }`}>
                    {anteil != null ? `${anteil.toFixed(1).replace('.', ',')} %` : '—'}
                  </td>
                  <td className="px-4 py-2 text-gray-700 text-xs">
                    {m.kommentar
                      ? <span className="italic">„{m.kommentar}"</span>
                      : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-4 py-2 text-right text-xs text-gray-500 whitespace-nowrap">
                    {m.eingereichtAm
                      ? new Date(m.eingereichtAm).toLocaleDateString('de-DE')
                      : '—'}
                  </td>
                  {isAdmin && (
                    <td className="px-4 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => onEdit(m)}
                        className="text-xs text-blue-600 hover:text-blue-800"
                        title="Meldung bearbeiten"
                      >
                        ✏️
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ---- Rest-/Fehlmenge Nacherfassungs-Form ------------------

function RestmengeNacherfassenForm({
  initial,
  mitarbeiterId,
  teilgebiete,
  ausgaben,
  onSaved,
  onCancel,
}: {
  initial: RestmengeMeldung | null;
  mitarbeiterId: string;
  teilgebiete: import('../types').Teilgebiet[];
  ausgaben: Ausgabe[];
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [tgId, setTgId] = useState(initial?.teilgebietId ?? '');
  const [ausgabeId, setAusgabeId] = useState(initial?.ausgabeId ?? '');
  const [restmenge, setRestmenge] = useState(String(initial?.restmenge ?? 0));
  const [fehlmengeAn, setFehlmengeAn] = useState((initial?.fehlmenge ?? 0) > 0);
  const [fehlmenge, setFehlmenge] = useState(String(initial?.fehlmenge ?? 0));
  const [kommentar, setKommentar] = useState(initial?.kommentar ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const aktiveTeilgebiete = [...teilgebiete]
    .filter((t) => t.isActive && !t.istAuslagestelle)
    .sort((a, b) => a.name.localeCompare(b.name, 'de', { numeric: true }));
  const sortierteAusgaben = [...ausgaben].sort(
    (a, b) => b.jahr - a.jahr || b.kw - a.kw
  );

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!tgId || !ausgabeId) {
      setError('Bitte Teilgebiet und Ausgabe wählen.');
      return;
    }
    if (!mitarbeiterId) {
      setError('Kein Mitarbeiter gewählt.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const ausgabe = ausgaben.find((a) => a.id === ausgabeId);
      if (!ausgabe) throw new Error('Ausgabe nicht gefunden.');
      // Beim Bearbeiten existierender Meldung: einsatzId vorhanden — direkt
      // updaten. Beim Nacherfassen: einsatz finden oder neu anlegen.
      let einsatzId = initial?.einsatzId;
      if (!einsatzId) {
        einsatzId = await setzeEinsatz({
          ausgabeId,
          kw: ausgabe.kw,
          jahr: ausgabe.jahr,
          teilgebietId: tgId,
          mitarbeiterId,
          typ: 'standard',
        });
      }
      await aktualisiereEinsatzMeldung(einsatzId, {
        restmenge: Number(restmenge) || 0,
        fehlmenge: fehlmengeAn ? (Number(fehlmenge) || 0) : 0,
        meldungKommentar: kommentar.trim() || undefined,
        meldungEingereichtAm: Date.now(),
      });
      onSaved();
    } catch (err: any) {
      console.error(err);
      setError('Fehler beim Speichern: ' + (err.message ?? err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Teilgebiet *</label>
        <select
          value={tgId}
          onChange={(e) => setTgId(e.target.value)}
          disabled={!!initial}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
        >
          <option value="">— wählen —</option>
          {aktiveTeilgebiete.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name} {t.plz && `(${t.plz})`}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Ausgabe (KW) *</label>
        <select
          value={ausgabeId}
          onChange={(e) => setAusgabeId(e.target.value)}
          disabled={!!initial}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
        >
          <option value="">— wählen —</option>
          {sortierteAusgaben.slice(0, 30).map((a) => (
            <option key={a.id} value={a.id}>{kwLabel(a.kw, a.jahr)}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Restmenge (nicht ausgetragene Stücke)
        </label>
        <input
          type="number"
          min="0"
          value={restmenge}
          onChange={(e) => setRestmenge(e.target.value)}
          className="w-32 border border-gray-300 rounded-lg px-3 py-2 text-sm"
        />
      </div>
      <div className="rounded-lg border border-red-200 bg-red-50/40 p-3">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={fehlmengeAn}
            onChange={(e) => setFehlmengeAn(e.target.checked)}
            className="w-4 h-4"
          />
          <span className="text-sm font-medium text-red-800">
            ⚠ Fehlmenge — Austräger hat zu wenige Exemplare erhalten
          </span>
        </label>
        {fehlmengeAn && (
          <div className="mt-2 flex items-center gap-3">
            <input
              type="number"
              min="0"
              value={fehlmenge}
              onChange={(e) => setFehlmenge(e.target.value)}
              className="w-32 border border-red-300 rounded-lg px-3 py-2 text-sm"
            />
            <span className="text-red-700 text-sm">Stück fehlen</span>
          </div>
        )}
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Kommentar (optional)
        </label>
        <textarea
          value={kommentar}
          onChange={(e) => setKommentar(e.target.value)}
          rows={3}
          placeholder="z. B. ‚Neue Wohnungen in der Schulstraße 5 dazugekommen‘"
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
        />
      </div>

      {error && <p className="text-red-600 text-sm">{error}</p>}

      <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800"
        >
          Abbrechen
        </button>
        <button
          type="submit"
          disabled={saving}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? 'Speichere…' : initial ? 'Aktualisieren' : 'Speichern'}
        </button>
      </div>
    </form>
  );
}

// ---- Fahrten-Übersicht (read-only) -------------------------

function FahrtenÜbersicht({ fahrten, fahrtSatz }: { fahrten: Fahrt[]; fahrtSatz: number }) {
  if (fahrten.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-4 text-center text-sm text-gray-400">
        Keine Fahrten in diesem Monat — Erfassung über den Menüpunkt "Fahrtkosten"
      </div>
    );
  }

  const gesamt = fahrten.reduce((s, f) => s + f.streckKm * fahrtSatz, 0);

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-200 bg-gray-50 flex items-center justify-between">
        <span className="font-medium text-sm text-gray-600">
          Fahrten ({fahrten.reduce((s, f) => s + f.streckKm, 0)} km ·&nbsp;
          {gesamt.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}
          &nbsp;bei {fahrtSatz.toFixed(2)} €/km)
        </span>
      </div>
      <table className="w-full text-sm">
        <thead className="bg-gray-50 border-b border-gray-100">
          <tr>
            <th className="text-left px-4 py-2 font-medium text-gray-600">Datum</th>
            <th className="text-left px-4 py-2 font-medium text-gray-600">Ziel</th>
            <th className="text-right px-4 py-2 font-medium text-gray-600">km</th>
            <th className="text-right px-4 py-2 font-medium text-gray-600">Betrag</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {fahrten.map((f) => (
            <tr key={f.id} className="hover:bg-gray-50">
              <td className="px-4 py-2 text-gray-700">{f.datum}</td>
              <td className="px-4 py-2 text-gray-700">
                {f.ziel}
                {f.bemerkung && <span className="text-gray-400 ml-1 text-xs">({f.bemerkung})</span>}
                {f.abrechnungsperiodeId && (
                  <span className="ml-2 text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded">abgerechnet</span>
                )}
              </td>
              <td className="px-4 py-2 text-right text-gray-600">{f.streckKm}</td>
              <td className="px-4 py-2 text-right font-medium text-gray-900">
                {(f.streckKm * fahrtSatz).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---- Session-Korrektur ------------------------------------

function SessionKorrektur({
  session,
  adminName: _adminName,
  ausgaben,
  onSave,
  onCancel,
}: {
  session: Arbeitszeit;
  adminName: string;
  ausgaben: Ausgabe[];
  onSave: (changes: Partial<Arbeitszeit>, begruendung: string) => Promise<void>;
  onCancel: () => void;
}) {
  const toTimeInput = (ts: number | null) => {
    if (!ts) return '';
    const d = new Date(ts);
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
  };
  const fromTimeInput = (base: number, timeStr: string) => {
    const d = new Date(base);
    const [h, m] = timeStr.split(':').map(Number);
    d.setHours(h, m, 0, 0);
    return d.getTime();
  };

  const [startStr, setStartStr] = useState(toTimeInput(session.startTime));
  const [endeStr, setEndeStr] = useState(toTimeInput(session.endTime));
  const [typ, setTyp] = useState<ArbeitszeitsTyp>(session.typ);
  const [ausgabeId, setAusgabeId] = useState<string>(session.ausgabeId ?? '');
  const [begruendung, setBegruendung] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!begruendung.trim()) return;
    if (typ === 'vorarbeit' && !ausgabeId) return;
    setSaving(true);
    const changes: Partial<Arbeitszeit> = {};
    if (startStr) changes.startTime = fromTimeInput(session.startTime, startStr);
    if (endeStr) changes.endTime = fromTimeInput(session.endTime ?? session.startTime, endeStr);
    if (typ !== session.typ) changes.typ = typ;
    if (ausgabeId !== (session.ausgabeId ?? '')) {
      changes.ausgabeId = ausgabeId || undefined;
    }
    await onSave(changes, begruendung);
    setSaving(false);
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Start</label>
          <input type="time" value={startStr} onChange={(e) => setStartStr(e.target.value)} className={inputClass} />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Ende</label>
          <input type="time" value={endeStr} onChange={(e) => setEndeStr(e.target.value)} className={inputClass} />
        </div>
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Typ</label>
        <select
          value={typ}
          onChange={(e) => setTyp(e.target.value as ArbeitszeitsTyp)}
          className={inputClass}
        >
          {(Object.keys(TYP_LABELS) as ArbeitszeitsTyp[]).map((t) => (
            <option key={t} value={t}>{TYP_LABELS[t]}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Ausgabe {typ === 'vorarbeit' ? '*' : <span className="text-gray-400 text-xs">(optional)</span>}
        </label>
        <select
          value={ausgabeId}
          onChange={(e) => setAusgabeId(e.target.value)}
          className={inputClass}
        >
          <option value="">— keine Zuordnung —</option>
          {ausgaben.map((a) => (
            <option key={a.id} value={a.id}>
              KW {a.kw}/{a.jahr}
              {a.vorarbeitFreigegeben ? ' ✓ (Vorarbeit erlaubt)' : ''}
            </option>
          ))}
        </select>
      </div>

      {session.korrekturLog.length > 0 && (
        <div className="bg-gray-50 rounded-lg p-3">
          <p className="text-xs font-medium text-gray-600 mb-2">Korrektur-Verlauf</p>
          {session.korrekturLog.map((log, i) => (
            <div key={i} className="text-xs text-gray-500">
              {new Date(log.zeitstempel).toLocaleString('de-DE')} — {log.adminName}: {log.aktion}
            </div>
          ))}
        </div>
      )}

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Begründung *</label>
        <input
          type="text"
          value={begruendung}
          onChange={(e) => setBegruendung(e.target.value)}
          placeholder="Grund der Korrektur"
          className={inputClass}
        />
      </div>

      <div className="flex justify-end gap-3">
        <button onClick={onCancel} className="px-4 py-2 text-sm text-gray-600">Abbrechen</button>
        <button
          onClick={handleSave}
          disabled={saving || !begruendung.trim()}
          className="bg-blue-600 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? 'Speichere...' : 'Korrektur speichern'}
        </button>
      </div>
    </div>
  );
}

const selectClass = 'border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';
const inputClass = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';

// ---- Neue-Zeit-Formular -----------------------------------

/** Leitet den Default-Typ aus den Rollen eines Mitarbeiters ab.
 *  - Genau eine Rolle → eindeutige Vorbelegung
 *  - Mehrere Rollen → '' (keine Vorbelegung)
 */
function defaultTypFuerRollen(rollen: Rolle[] | undefined): ArbeitszeitsTyp | '' {
  if (!rollen || rollen.length !== 1) return '';
  switch (rollen[0]) {
    case 'austräger': return 'austragen';
    case 'zusammenträger': return 'zusammentragen';
    case 'sonstige': return 'sonstige';
    default: return '';
  }
}

/** Welche Arbeitszeit-Typen darf ein MA mit den angegebenen Rollen wählen?
 *  Strikte Zuordnung — jeder Typ ist nur erlaubt, wenn die entsprechende
 *  Rolle gesetzt ist:
 *   - austräger → austragen
 *   - zusammenträger → zusammentragen, vorarbeit (Vorbereitung)
 *   - sonstige → sonstige
 *  Reine Austräger oder Zusammenträger dürfen also nicht „Sonstige" buchen.
 */
function erlaubteTypenFuerRollen(rollen: Rolle[] | undefined): ArbeitszeitsTyp[] {
  const erlaubt = new Set<ArbeitszeitsTyp>();
  if (!rollen) return [];
  if (rollen.includes('austräger')) erlaubt.add('austragen');
  if (rollen.includes('zusammenträger')) {
    erlaubt.add('zusammentragen');
    erlaubt.add('vorarbeit');
  }
  if (rollen.includes('sonstige')) erlaubt.add('sonstige');
  // Reihenfolge wie in TYP_LABELS
  return (Object.keys(TYP_LABELS) as ArbeitszeitsTyp[]).filter((t) => erlaubt.has(t));
}

function NeueZeitForm({
  aktiveMitarbeiter,
  vorausgewaehlteMaId,
  adminName,
  ausgaben,
  onSaved,
  onCancel,
}: {
  aktiveMitarbeiter: { id: string; name: string; nummer: string; rollen?: Rolle[]; teilgebietFreigaben?: string[] }[];
  vorausgewaehlteMaId: string;
  adminName: string;
  ausgaben: Ausgabe[];
  onSaved: () => void;
  onCancel: () => void;
}) {
  const { abrechnungsperioden, teilgebiete } = useApp();
  const sortiert = [...aktiveMitarbeiter].sort((a, b) => a.name.localeCompare(b.name));
  const heute = new Date();
  const heuteIso = `${heute.getFullYear()}-${(heute.getMonth() + 1).toString().padStart(2, '0')}-${heute.getDate().toString().padStart(2, '0')}`;

  // Letzte (aktuellste) Ausgabe als Default — ausgaben ist bereits sortiert
  const defaultAusgabeId = ausgaben.length > 0 ? ausgaben[0].id : '';

  const [maId, setMaId] = useState(vorausgewaehlteMaId || '');
  // Typ-Vorbelegung aus der (ggf. eindeutigen) Rolle des MA
  const initialTyp: ArbeitszeitsTyp | '' = (() => {
    if (!vorausgewaehlteMaId) return '';
    const ma = aktiveMitarbeiter.find((m) => m.id === vorausgewaehlteMaId);
    return defaultTypFuerRollen(ma?.rollen);
  })();
  const [typ, setTyp] = useState<ArbeitszeitsTyp | ''>(initialTyp);
  const [ausgabeId, setAusgabeId] = useState<string>(defaultAusgabeId);

  // Bei MA-Wechsel Typ entsprechend der Rolle neu vorbelegen
  useEffect(() => {
    if (!maId) { setTyp(''); return; }
    const ma = aktiveMitarbeiter.find((m) => m.id === maId);
    setTyp(defaultTypFuerRollen(ma?.rollen));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maId]);
  const [datum, setDatum] = useState(heuteIso);
  const [von, setVon] = useState('08:00');
  const [bis, setBis] = useState('16:00');
  const [pausenMinuten, setPausenMinuten] = useState('0');
  const [kommentar, setKommentar] = useState('');
  const [saving, setSaving] = useState(false);
  const [fehler, setFehler] = useState('');

  // Austragen-spezifisch: Teilgebiet + Rest-/Fehlmenge
  const [tgId, setTgId] = useState('');
  const [restmenge, setRestmenge] = useState('0');
  const [fehlmengeAn, setFehlmengeAn] = useState(false);
  const [fehlmenge, setFehlmenge] = useState('0');
  const [austrKommentar, setAustrKommentar] = useState('');

  const aktiverMA = aktiveMitarbeiter.find((m) => m.id === maId);
  const erlaubteTypen = erlaubteTypenFuerRollen(aktiverMA?.rollen);

  // Wenn der aktuell ausgewählte Typ für die MA-Rollen nicht (mehr) erlaubt
  // ist (z. B. nach MA-Wechsel), zurücksetzen.
  useEffect(() => {
    if (typ && !erlaubteTypen.includes(typ as ArbeitszeitsTyp)) {
      setTyp('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maId]);

  // Auswahl der für den MA freigegebenen Teilgebiete (für Austragen-Erfassung)
  const tgOptionen = (() => {
    const freigaben = new Set(aktiverMA?.teilgebietFreigaben ?? []);
    const aktive = teilgebiete.filter((t) => t.isActive && !t.istAuslagestelle);
    const freigegeben = aktive.filter((t) => freigaben.has(t.id));
    // Wenn der MA keine Freigaben hat (oder leer): alle aktiven TGs anbieten —
    // sonst wäre keine Nacherfassung möglich.
    const list = freigegeben.length > 0 ? freigegeben : aktive;
    return list.sort((a, b) => a.name.localeCompare(b.name, 'de', { numeric: true }));
  })();

  // Wenn Ausgaben erst nachträglich geladen werden: Default nachziehen
  useEffect(() => {
    if (!ausgabeId && ausgaben.length > 0) setAusgabeId(ausgaben[0].id);
  }, [ausgaben, ausgabeId]);

  function kombiniereZeit(datumIso: string, zeit: string): number {
    const [y, m, d] = datumIso.split('-').map(Number);
    const [h, min] = zeit.split(':').map(Number);
    return new Date(y, m - 1, d, h, min, 0, 0).getTime();
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setFehler('');
    if (!maId) {
      setFehler('Bitte Mitarbeiter auswählen.');
      return;
    }
    if (!typ) {
      setFehler('Bitte einen Typ auswählen.');
      return;
    }
    if (typ === 'vorarbeit' && !ausgabeId) {
      setFehler('Bitte eine Ausgabe auswählen, der die Vorarbeit zugeordnet werden soll.');
      return;
    }
    const startTime = kombiniereZeit(datum, von);
    const endTime = kombiniereZeit(datum, bis);
    if (endTime <= startTime) {
      setFehler('Bis-Zeit muss nach Von-Zeit liegen.');
      return;
    }
    const pausen = Math.max(0, parseInt(pausenMinuten || '0', 10));
    const bruttoMin = (endTime - startTime) / 60_000;
    if (pausen > bruttoMin) {
      setFehler('Pausenminuten überschreiten die Arbeitszeit.');
      return;
    }

    setSaving(true);
    try {
      // ---- Überlappungsprüfung: gleicher Mitarbeiter darf keine parallele Zeit haben ----
      const bestehend = await ladeArbeitszeiten(maId);
      const konflikt = bestehend.find((a) => {
        const aEnde = a.endTime ?? Date.now(); // offene Session: bis jetzt
        // Überlappt, wenn nicht komplett davor oder danach
        return !(endTime <= a.startTime || startTime >= aEnde);
      });
      if (konflikt) {
        const kStart = new Date(konflikt.startTime);
        const kEnde = konflikt.endTime ? new Date(konflikt.endTime) : null;
        const fmt = (d: Date) =>
          d.toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
        setFehler(
          `Überlappung mit bestehender Arbeitszeit (${TYP_LABELS[konflikt.typ] ?? konflikt.typ}): ` +
          `${fmt(kStart)}${kEnde ? ` → ${fmt(kEnde)}` : ' → (aktiv)'}. ` +
          `Eine Person kann zu einem Zeitpunkt nur eine Tätigkeit ausführen.`
        );
        setSaving(false);
        return;
      }

      const log: AuditEintrag = {
        zeitstempel: Date.now(),
        adminName: adminName || 'Admin',
        aktion: 'Manuell erfasst',
      };
      if (kommentar && kommentar.trim()) {
        log.nachher = kommentar.trim();
      }
      const payload: Parameters<typeof erstelleArbeitszeit>[0] = {
        mitarbeiterId: maId,
        startTime,
        endTime,
        status: 'abgeschlossen',
        quelle: 'manuell',
        typ: typ as ArbeitszeitsTyp,
        pausen: [],
        gesamtPauseMinuten: pausen,
        korrekturLog: [log],
        autoGeschlossenUm24: false,
      };
      if (ausgabeId) payload.ausgabeId = ausgabeId;
      await erstelleArbeitszeit(payload);

      // Bei Austragen + TG + Ausgabe: auch Einsatz-Meldung (Rest/Fehl/Kommentar)
      // schreiben. Nur ausführen, wenn TG und Ausgabe gewählt sind UND mindestens
      // ein Wert oder Kommentar vorliegt.
      if (
        typ === 'austragen' &&
        tgId &&
        ausgabeId &&
        ((Number(restmenge) || 0) > 0 ||
          (fehlmengeAn && (Number(fehlmenge) || 0) > 0) ||
          austrKommentar.trim())
      ) {
        try {
          const ausgabe = ausgaben.find((a) => a.id === ausgabeId);
          if (ausgabe) {
            const einsatzId = await setzeEinsatz({
              ausgabeId,
              kw: ausgabe.kw,
              jahr: ausgabe.jahr,
              teilgebietId: tgId,
              mitarbeiterId: maId,
              typ: 'standard',
            });
            await aktualisiereEinsatzMeldung(einsatzId, {
              restmenge: Number(restmenge) || 0,
              fehlmenge: fehlmengeAn ? (Number(fehlmenge) || 0) : 0,
              meldungKommentar: austrKommentar.trim() || undefined,
              meldungEingereichtAm: Date.now(),
            });
          }
        } catch (einsatzErr) {
          // Arbeitszeit ist bereits gespeichert — Meldungs-Fehler nur warnen.
          console.warn('Einsatz-Meldung konnte nicht gespeichert werden:', einsatzErr);
        }
      }

      onSaved();
    } catch (err: any) {
      setFehler(err?.message ?? 'Speichern fehlgeschlagen.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Mitarbeiter *</label>
        <select
          value={maId}
          onChange={(e) => setMaId(e.target.value)}
          className={inputClass}
          required
        >
          <option value="">— auswählen —</option>
          {sortiert.map((m) => (
            <option key={m.id} value={m.id}>{m.name} ({m.nummer})</option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Typ *</label>
        <select
          value={typ}
          onChange={(e) => setTyp(e.target.value as ArbeitszeitsTyp | '')}
          className={inputClass}
          disabled={!maId}
          required
        >
          <option value="">— auswählen —</option>
          {erlaubteTypen.map((t) => (
            <option key={t} value={t}>{TYP_LABELS[t]}</option>
          ))}
        </select>
        {!maId && (
          <p className="text-xs text-gray-400 mt-1">
            Erst Mitarbeiter wählen — die Auswahl filtert sich nach den Rollen.
          </p>
        )}
        {maId && !typ && (() => {
          const ma = aktiveMitarbeiter.find((m) => m.id === maId);
          if (ma?.rollen && ma.rollen.length > 1) {
            return (
              <p className="text-xs text-gray-500 mt-1">
                Mitarbeiter hat mehrere Kategorien ({ma.rollen.map((r) => ROLLEN_LABELS[r] ?? r).join(', ')}) — Typ bitte manuell wählen.
              </p>
            );
          }
          return null;
        })()}
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Ausgabe {typ === 'vorarbeit' ? '*' : <span className="text-gray-400 text-xs">(optional)</span>}
        </label>
        <select
          value={ausgabeId}
          onChange={(e) => setAusgabeId(e.target.value)}
          className={inputClass}
          required={typ === 'vorarbeit'}
        >
          <option value="">— keine Zuordnung —</option>
          {ausgaben.map((a) => (
            <option key={a.id} value={a.id}>
              KW {a.kw}/{a.jahr}
              {a.vorarbeitFreigegeben ? ' ✓ (Vorarbeit erlaubt)' : ''}
            </option>
          ))}
        </select>
        {typ === 'vorarbeit' && ausgabeId && !ausgaben.find((a) => a.id === ausgabeId)?.vorarbeitFreigegeben && (
          <p className="text-xs text-amber-600 mt-1">
            ⚠ In dieser Ausgabe ist Vorarbeit (noch) nicht erlaubt — die Zeit wird erfasst,
            fließt aber erst in den Lohn, wenn das Kennzeichen gesetzt wird.
          </p>
        )}
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Datum *</label>
          <input
            type="date"
            value={datum}
            onChange={(e) => setDatum(e.target.value)}
            className={inputClass}
            required
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Von *</label>
          <input
            type="time"
            value={von}
            onChange={(e) => setVon(e.target.value)}
            className={inputClass}
            required
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Bis *</label>
          <input
            type="time"
            value={bis}
            onChange={(e) => setBis(e.target.value)}
            className={inputClass}
            required
          />
        </div>
      </div>

      {/* Hinweis: ausgewählter Zeitraum berührt eine bereits abgeschlossene Periode */}
      {(() => {
        const start = kombiniereZeit(datum, von);
        const end = kombiniereZeit(datum, bis);
        const periodeAbgeschlossen = findAbgeschlossenePeriodeFuerZeitraum(
          abrechnungsperioden,
          start,
          end > start ? end : start
        );
        if (!periodeAbgeschlossen) return null;
        return (
          <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            ⚠ <span className="font-medium">{periodeAbgeschlossen.bezeichnung}</span> ist
            bereits abgeschlossen. Die Zeit kann gespeichert werden, fließt aber
            <span className="font-medium"> nicht mehr in die Abrechnung</span>{' '}
            ein, da die Periode gesperrt und ihr Ergebnis fixiert ist.
          </div>
        );
      })()}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Pausenminuten</label>
          <input
            type="number"
            min={0}
            value={pausenMinuten}
            onChange={(e) => setPausenMinuten(e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Kommentar</label>
          <input
            type="text"
            value={kommentar}
            onChange={(e) => setKommentar(e.target.value)}
            placeholder="optional"
            className={inputClass}
          />
        </div>
      </div>

      {/* Bei Austragen: Teilgebiet + Rest-/Fehlmenge + Kommentar erfassen
          (analog zur QR-Code-Selbstmeldung, für Papierzettel-Nacherfassung) */}
      {typ === 'austragen' && (
        <div className="rounded-lg border border-amber-200 bg-amber-50/40 p-3 space-y-3">
          <div className="text-sm font-semibold text-amber-900">
            📦 Rest- &amp; Fehlmengen (Austragen)
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Teilgebiet</label>
              <select
                value={tgId}
                onChange={(e) => setTgId(e.target.value)}
                className={inputClass}
              >
                <option value="">— optional, kein TG-Bezug —</option>
                {tgOptionen.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} {t.plz && `(${t.plz})`}
                  </option>
                ))}
              </select>
              {!ausgabeId && tgId && (
                <p className="text-[11px] text-amber-700 mt-1">
                  ⓘ Für Rest-/Fehlmengen-Erfassung muss zusätzlich die Ausgabe (KW) oben gewählt sein.
                </p>
              )}
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Restmenge (nicht ausgetragen)</label>
              <input
                type="number"
                min={0}
                value={restmenge}
                onChange={(e) => setRestmenge(e.target.value)}
                className={inputClass}
                disabled={!tgId}
              />
            </div>
          </div>
          <div className="rounded-md border border-red-200 bg-red-50/40 p-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={fehlmengeAn}
                onChange={(e) => setFehlmengeAn(e.target.checked)}
                className="w-4 h-4"
                disabled={!tgId}
              />
              <span className="text-sm font-medium text-red-800">
                ⚠ Fehlmenge — Austräger hat zu wenige Exemplare erhalten
              </span>
            </label>
            {fehlmengeAn && (
              <div className="mt-2 flex items-center gap-3">
                <input
                  type="number"
                  min={0}
                  value={fehlmenge}
                  onChange={(e) => setFehlmenge(e.target.value)}
                  className="w-32 border border-red-300 rounded-lg px-3 py-2 text-sm"
                />
                <span className="text-red-700 text-sm">Stück fehlen</span>
              </div>
            )}
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Kommentar zur Rest-/Fehlmenge (optional)
            </label>
            <textarea
              value={austrKommentar}
              onChange={(e) => setAustrKommentar(e.target.value)}
              rows={2}
              placeholder="z. B. ‚Neue Wohnungen in der Schulstraße 5 dazugekommen‘"
              className={inputClass}
              disabled={!tgId}
            />
          </div>
        </div>
      )}

      {fehler && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
          {fehler}
        </div>
      )}

      <div className="flex justify-end gap-3">
        <button type="button" onClick={onCancel} className="px-4 py-2 text-sm text-gray-600">
          Abbrechen
        </button>
        <button
          type="submit"
          disabled={saving}
          className="bg-blue-600 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? 'Speichere...' : 'Speichern'}
        </button>
      </div>
    </form>
  );
}
