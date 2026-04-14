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
import type { Arbeitszeit, ArbeitszeitsTyp } from '../types';

const TYP_LABELS: Partial<Record<ArbeitszeitsTyp, string>> = {
  büro: 'Büro',
  zusammentragen: 'Zusammentragen',
  fahrer: 'Fahrer',
  sonstiges: 'Sonstiges',
};

const AUSTRAEGER_TYPEN: ArbeitszeitsTyp[] = ['büro', 'zusammentragen', 'fahrer', 'sonstiges'];

export default function NfcLandingScreen() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { mitarbeiter } = useApp();
  const mitarbeiterId = params.get('ma') ?? '';

  const ma = mitarbeiter.find((m) => m.id === mitarbeiterId);

  const [session, setSession] = useState<Arbeitszeit | null | undefined>(undefined); // undefined = loading
  const [busy, setBusy] = useState(false);
  const [meldung, setMeldung] = useState('');
  const [typ, setTyp] = useState<ArbeitszeitsTyp>('büro');
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
                  {AUSTRAEGER_TYPEN.map((t) => (
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
              <button
                onClick={handleAusstempeln}
                disabled={busy}
                className="w-full py-3.5 bg-red-600 text-white rounded-xl font-semibold text-base hover:bg-red-700 active:bg-red-800 disabled:opacity-50 transition-colors"
              >
                ■ Ausstempeln
              </button>
            </>
          )}

          {/* Fahrtkosten-Button */}
          <div className="pt-2 border-t border-gray-100">
            <button
              onClick={() => navigate(`/fahrten?ma=${encodeURIComponent(mitarbeiterId)}`)}
              className="w-full py-3 bg-gray-100 text-gray-700 rounded-xl font-medium text-sm hover:bg-gray-200 active:bg-gray-300 transition-colors"
            >
              🚗 Fahrtkosten erfassen
            </button>
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
