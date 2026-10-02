import { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import {
  ladeAktiveSessionFuerMitarbeiter,
  einstempeln,
  ausstempelnMitPausenabschluss,
  pauseStarten,
  pauseBeenden,
  formatierZeit,
  formatierDauer,
  berechneNettoMinuten,
} from '../lib/zeiterfassung';
import { erstelleFahrt } from '../lib/db';
import type { Arbeitszeit, ArbeitszeitsTyp, Rolle } from '../types';
import { TYP_LABELS } from '../types';

function tätigkeitenFuerRollen(rollen: Rolle[]): ArbeitszeitsTyp[] {
  const result: ArbeitszeitsTyp[] = [];
  if (rollen.includes('zusammenträger')) { result.push('zusammentragen', 'vorarbeit'); }
  if (rollen.includes('austräger')) result.push('austragen');
  if (rollen.includes('sonstige')) result.push('sonstige');
  return result;
}

export default function NfcLandingScreen() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { mitarbeiter } = useApp();
  const mitarbeiterId = params.get('ma') ?? '';

  const ma = mitarbeiter.find((m) => m.id === mitarbeiterId);

  const [session, setSession] = useState<Arbeitszeit | null | undefined>(undefined); // undefined = loading
  const [busy, setBusy] = useState(false);
  const [meldung, setMeldung] = useState('');
  const [typ, setTyp] = useState<ArbeitszeitsTyp>('sonstige');

  // Tätigkeiten nach Rollen
  const typenOptionen = ma ? tätigkeitenFuerRollen(ma.rollen) : [];
  // Default-Typ setzen wenn Typ nicht in den erlaubten Optionen
  useEffect(() => {
    if (typenOptionen.length > 0 && !typenOptionen.includes(typ)) {
      setTyp(typenOptionen[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ma?.id]);

  // Fahrtkosten-Formular
  const [showFahrt, setShowFahrt] = useState(false);
  const [fahrtDatum, setFahrtDatum] = useState(() => new Date().toISOString().slice(0, 10));
  const [fahrtKm, setFahrtKm] = useState('');
  const [fahrtZiel, setFahrtZiel] = useState('');
  const [fahrtBemerkung, setFahrtBemerkung] = useState('');
  const [fahrtBusy, setFahrtBusy] = useState(false);
  const [fahrtMeldung, setFahrtMeldung] = useState('');
  // Laufzeit-Ticker (erzwingt Re-Render alle 30s für laufende Zeitanzeige)
  useEffect(() => {
    const id = setInterval(() => {}, 30_000);
    return () => clearInterval(id);
  }, []);

  // Session laden
  useEffect(() => {
    if (!mitarbeiterId) return;
    ladeAktiveSessionFuerMitarbeiter(mitarbeiterId)
      .then(setSession)
      .catch(() => setSession(null));
  }, [mitarbeiterId]);

  if (!mitarbeiterId || (!ma && mitarbeiter.length > 0)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
        <div className="bg-white rounded-xl shadow p-8 text-center max-w-sm w-full">
          <div className="text-4xl mb-4">❌</div>
          <p className="text-gray-700 font-medium">Mitarbeiter nicht gefunden.</p>
          <p className="text-xs text-gray-400 mt-1">Bitte NFC-Chip neu beschreiben.</p>
          <button onClick={() => navigate('/')} className="mt-6 text-sm text-blue-600 underline">
            Zur Startseite
          </button>
        </div>
      </div>
    );
  }

  if (session === undefined || !ma) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-gray-400 text-sm">Lade...</div>
      </div>
    );
  }

  async function handleEinstempeln() {
    setBusy(true);
    setMeldung('');
    try {
      const s = await einstempeln(mitarbeiterId, typ, 'nfc');
      setSession(s);
      setMeldung('✓ Eingestempelt');
    } catch (e: any) {
      setMeldung('Fehler: ' + e.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleAusstempeln() {
    if (!session) return;
    setBusy(true);
    setMeldung('');
    try {
      await ausstempelnMitPausenabschluss(session);
      setMeldung('✓ Ausgestempelt');
      setSession(null);
    } catch (e: any) {
      setMeldung('Fehler: ' + e.message);
    } finally {
      setBusy(false);
    }
  }

  /** Wechselt zwischen Zusammentragen und Vorarbeit ohne Ausstempeln — analog
   *  zum „🔄 Wechseln"-Button im ZeiterfassungScreen-Aktionsdialog. */
  async function handleTypWechsel() {
    if (!session) return;
    const neuerTyp: ArbeitszeitsTyp =
      session.typ === 'zusammentragen' ? 'vorarbeit' : 'zusammentragen';
    setBusy(true);
    setMeldung('');
    try {
      // Offene Pause erst sauber schließen
      if (session.status === 'pause') {
        await pauseBeenden(session);
      }
      await ausstempelnMitPausenabschluss(session);
      const neueSession = await einstempeln(mitarbeiterId, neuerTyp, 'nfc');
      setSession(neueSession);
      setMeldung(`✓ Gewechselt zu ${TYP_LABELS[neuerTyp]}`);
    } catch (e: any) {
      setMeldung('Fehler: ' + e.message);
    } finally {
      setBusy(false);
    }
  }

  async function handlePause() {
    if (!session) return;
    setBusy(true);
    setMeldung('');
    try {
      if (session.status === 'aktiv') {
        await pauseStarten(session);
        setSession({ ...session, status: 'pause' });
        setMeldung('✓ Pause gestartet');
      } else {
        await pauseBeenden(session);
        setSession({ ...session, status: 'aktiv' });
        setMeldung('✓ Pause beendet');
      }
    } catch (e: any) {
      setMeldung('Fehler: ' + e.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleFahrtSpeichern() {
    const km = parseFloat(fahrtKm.replace(',', '.'));
    if (!fahrtZiel.trim() || isNaN(km) || km <= 0) {
      setFahrtMeldung('Bitte Ziel und gültige km-Anzahl eingeben.');
      return;
    }
    setFahrtBusy(true);
    setFahrtMeldung('');
    try {
      await erstelleFahrt({
        mitarbeiterId,
        datum: fahrtDatum,
        streckKm: km,
        ziel: fahrtZiel.trim(),
        bemerkung: fahrtBemerkung.trim() || undefined,
      });
      setFahrtMeldung('✓ Fahrt gespeichert');
      setFahrtKm('');
      setFahrtZiel('');
      setFahrtBemerkung('');
      setFahrtDatum(new Date().toISOString().slice(0, 10));
      setTimeout(() => { setShowFahrt(false); setFahrtMeldung(''); }, 1200);
    } catch (e: any) {
      setFahrtMeldung('Fehler: ' + e.message);
    } finally {
      setFahrtBusy(false);
    }
  }

  const nettoMin = session ? berechneNettoMinuten(session) : 0;
  const isAktiv = session?.status === 'aktiv';
  const isPause = session?.status === 'pause';

  return (
    <div className="min-h-screen bg-gray-50 flex items-start justify-center pt-8 p-4">
      <div className="bg-white rounded-2xl shadow-lg w-full max-w-sm overflow-hidden">
        {/* Header */}
        <div className={`p-6 text-white text-center ${
          isAktiv ? 'bg-green-600' : isPause ? 'bg-amber-500' : 'bg-gray-600'
        }`}>
          <div className="text-4xl mb-2">
            {isAktiv ? '🟢' : isPause ? '⏸' : '⭕'}
          </div>
          <h1 className="text-xl font-bold">{ma.name}</h1>
          <p className="text-sm opacity-80">Nr. {ma.nummer}</p>
          <div className="mt-3 text-sm font-medium">
            {isAktiv && session && (
              <>
                Eingestempelt seit {formatierZeit(session.startTime)}
                <br />
                <span className="text-lg font-bold">{formatierDauer(nettoMin)}</span> Arbeitszeit
              </>
            )}
            {isPause && session && (
              <>Pause seit {formatierZeit(session.pausen[session.pausen.length - 1]?.start ?? session.startTime)}</>
            )}
            {!session && 'Nicht eingestempelt'}
          </div>
        </div>

        {/* Aktionen */}
        <div className="p-5 space-y-3">
          {meldung && (
            <div className={`text-center text-sm font-medium py-2 px-3 rounded-lg ${
              meldung.startsWith('✓') ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
            }`}>
              {meldung}
            </div>
          )}

          {!session && (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Tätigkeitsart</label>
                <div className="grid grid-cols-2 gap-2">
                  {typenOptionen.map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setTyp(t)}
                      className={`py-2 px-3 rounded-lg text-sm border transition-colors ${
                        typ === t
                          ? 'bg-blue-600 text-white border-blue-600'
                          : 'bg-white text-gray-700 border-gray-300 hover:border-blue-400'
                      }`}
                    >
                      {TYP_LABELS[t]}
                    </button>
                  ))}
                </div>
              </div>
              <button
                onClick={handleEinstempeln}
                disabled={busy}
                className="w-full py-4 bg-green-600 text-white rounded-xl font-semibold text-lg hover:bg-green-700 active:bg-green-800 disabled:opacity-50 transition-colors"
              >
                ▶ Einstempeln
              </button>
            </>
          )}

          {session && (
            <>
              <button
                onClick={handlePause}
                disabled={busy}
                className={`w-full py-3.5 rounded-xl font-semibold text-base transition-colors disabled:opacity-50 ${
                  isPause
                    ? 'bg-green-100 text-green-700 hover:bg-green-200 active:bg-green-300'
                    : 'bg-amber-100 text-amber-700 hover:bg-amber-200 active:bg-amber-300'
                }`}
              >
                {isPause ? '▶ Pause beenden' : '⏸ Pause starten'}
              </button>

              {/* Tätigkeitswechsel — nur für Zusammenträger zwischen Zusammentragen ↔ Vorarbeit */}
              {ma.rollen.includes('zusammenträger') &&
                (session.typ === 'zusammentragen' || session.typ === 'vorarbeit') && (
                  <button
                    onClick={handleTypWechsel}
                    disabled={busy}
                    className="w-full py-3.5 bg-purple-100 text-purple-800 rounded-xl font-semibold text-base hover:bg-purple-200 active:bg-purple-300 disabled:opacity-50 transition-colors"
                  >
                    🔄 Wechseln zu{' '}
                    {session.typ === 'zusammentragen'
                      ? TYP_LABELS['vorarbeit']
                      : TYP_LABELS['zusammentragen']}
                  </button>
                )}

              <button
                onClick={handleAusstempeln}
                disabled={busy}
                className="w-full py-3.5 bg-red-600 text-white rounded-xl font-semibold text-base hover:bg-red-700 active:bg-red-800 disabled:opacity-50 transition-colors"
              >
                ■ Ausstempeln
              </button>
            </>
          )}

          {/* Fahrtkosten-Button / Inline-Formular */}
          <div className="pt-2 border-t border-gray-100">
            {!showFahrt ? (
              <button
                onClick={() => setShowFahrt(true)}
                className="w-full py-3 bg-gray-100 text-gray-700 rounded-xl font-medium text-sm hover:bg-gray-200 active:bg-gray-300 transition-colors"
              >
                🚗 Fahrtkosten erfassen
              </button>
            ) : (
              <div className="bg-gray-50 rounded-xl p-4 space-y-3 border border-gray-200">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-semibold text-gray-800">🚗 Fahrt erfassen</span>
                  <button
                    onClick={() => { setShowFahrt(false); setFahrtMeldung(''); }}
                    className="text-gray-400 hover:text-gray-600 text-lg leading-none"
                  >
                    ✕
                  </button>
                </div>

                {/* Mitarbeiter (gesperrt) */}
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Mitarbeiter</label>
                  <div className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm text-gray-700 font-medium">
                    {ma.name}
                  </div>
                </div>

                {/* Datum */}
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Datum</label>
                  <input
                    type="date"
                    value={fahrtDatum}
                    onChange={(e) => setFahrtDatum(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                {/* Ziel */}
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Ziel / Route</label>
                  <input
                    type="text"
                    value={fahrtZiel}
                    onChange={(e) => setFahrtZiel(e.target.value)}
                    placeholder="z.B. Göttingen – Lager"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                {/* Kilometer */}
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Kilometer</label>
                  <input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="0.1"
                    value={fahrtKm}
                    onChange={(e) => setFahrtKm(e.target.value)}
                    placeholder="0"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                {/* Bemerkung */}
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Bemerkung (optional)</label>
                  <input
                    type="text"
                    value={fahrtBemerkung}
                    onChange={(e) => setFahrtBemerkung(e.target.value)}
                    placeholder="optional"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                {fahrtMeldung && (
                  <div className={`text-center text-sm font-medium py-2 px-3 rounded-lg ${
                    fahrtMeldung.startsWith('✓') ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
                  }`}>
                    {fahrtMeldung}
                  </div>
                )}

                <button
                  onClick={handleFahrtSpeichern}
                  disabled={fahrtBusy}
                  className="w-full py-3 bg-blue-600 text-white rounded-xl font-semibold text-sm hover:bg-blue-700 active:bg-blue-800 disabled:opacity-50 transition-colors"
                >
                  {fahrtBusy ? 'Speichern…' : '💾 Fahrt speichern'}
                </button>
              </div>
            )}
          </div>

          <button
            onClick={() => navigate('/')}
            className="w-full text-xs text-gray-400 hover:text-gray-600 py-2 transition-colors"
          >
            Zur Startseite
          </button>
        </div>
      </div>
    </div>
  );
}
