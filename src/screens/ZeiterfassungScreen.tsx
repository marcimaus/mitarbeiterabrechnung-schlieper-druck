import { useState, useEffect, useCallback } from 'react';
import { useApp } from '../context/AppContext';
import Modal from '../components/Modal';
import {
  aktiveSessions,
  verarbeiteNfcScan,
  ausstempelnMitPausenabschluss,
  pauseStarten,
  nfcVerfuegbar,
  leseNfcTag,
  schliesseAbgelaufeneSessions,
  berechneNettoMinuten,
  formatierZeit,
  formatierDauer,
} from '../lib/zeiterfassung';
import type { Arbeitszeit, ArbeitszeitsTyp, Mitarbeiter } from '../types';

const TYP_LABELS: Record<ArbeitszeitsTyp, string> = {
  büro: 'Büro',
  zusammentragen: 'Zusammentragen',
  vorarbeit: 'Vorarbeit',
  fahrer: 'Fahrer',
  drucker: 'Drucker',
  setzer: 'Setzer',
  falzmaschine: 'Falzmaschine',
  schneidemaschine: 'Schneidemaschine',
  sonstiges: 'Sonstiges',
};

const TYP_FARBEN: Record<ArbeitszeitsTyp, string> = {
  büro: 'bg-blue-100 text-blue-700',
  zusammentragen: 'bg-purple-100 text-purple-700',
  vorarbeit: 'bg-pink-100 text-pink-700',
  fahrer: 'bg-green-100 text-green-700',
  drucker: 'bg-orange-100 text-orange-700',
  setzer: 'bg-yellow-100 text-yellow-700',
  falzmaschine: 'bg-cyan-100 text-cyan-700',
  schneidemaschine: 'bg-teal-100 text-teal-700',
  sonstiges: 'bg-gray-100 text-gray-700',
};

export default function ZeiterfassungScreen() {
  const { mitarbeiter } = useApp();
  const [aktiveSess, setAktiveSess] = useState<Arbeitszeit[]>([]);
  const [nfcStatus, setNfcStatus] = useState<'idle' | 'liest' | 'fehler'>('idle');
  const [nfcMeldung, setNfcMeldung] = useState('');
  const [letzteAktion, setLetzteAktion] = useState<{ name: string; aktion: string } | null>(null);

  // Dialog: Aktion wählen wenn bereits eingestempelt
  const [aktionDialog, setAktionDialog] = useState<{
    session: Arbeitszeit;
    mitarbeiter: Mitarbeiter;
  } | null>(null);

  // Manuelle Erfassung
  const [showManuell, setShowManuell] = useState(false);

  // Tick für laufende Zeiten
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  // Auto-Schließen um Mitternacht prüfen beim Start
  useEffect(() => {
    schliesseAbgelaufeneSessions().catch(console.error);
  }, []);

  // Aktive Sessions live
  useEffect(() => {
    const unsub = aktiveSessions(setAktiveSess);
    return unsub;
  }, []);

  const getMitarbeiter = useCallback(
    (id: string) => mitarbeiter.find((m) => m.id === id),
    [mitarbeiter]
  );

  // ---- NFC-Scan starten ------------------------------------

  async function starteNfcScan() {
    if (!nfcVerfuegbar()) {
      setNfcMeldung('Web NFC ist nicht verfügbar. Bitte Chrome auf Android verwenden oder manuell auswählen.');
      setNfcStatus('fehler');
      return;
    }
    setNfcStatus('liest');
    setNfcMeldung('NFC-Chip ans Gerät halten...');
    try {
      const mitarbeiterId = await leseNfcTag();
      await verarbeiteScan(mitarbeiterId);
    } catch (err: any) {
      setNfcMeldung(err.message ?? 'NFC-Fehler');
      setNfcStatus('fehler');
    }
  }

  async function verarbeiteScan(mitarbeiterId: string) {
    const ma = getMitarbeiter(mitarbeiterId);
    if (!ma) {
      setNfcMeldung(`Unbekannter Mitarbeiter (ID: ${mitarbeiterId}). Bitte in der Mitarbeiterverwaltung prüfen.`);
      setNfcStatus('fehler');
      return;
    }

    const defaultTyp = ma.rollen.includes('zusammenträger')
      ? 'zusammentragen'
      : ma.rollen.includes('fahrer')
      ? 'fahrer'
      : 'büro';

    const result = await verarbeiteNfcScan(mitarbeiterId, defaultTyp);
    setNfcStatus('idle');
    setNfcMeldung('');

    if (result.aktion === 'bereits_eingestempelt') {
      setAktionDialog({ session: result.session, mitarbeiter: ma });
    } else {
      const aktionTexte = {
        eingestempelt: 'eingestempelt',
        ausgestempelt: 'ausgestempelt',
        pause_gestartet: 'Pause gestartet',
        pause_beendet: 'Pause beendet',
        bereits_eingestempelt: '',
      };
      setLetzteAktion({ name: ma.name, aktion: aktionTexte[result.aktion] });
      setTimeout(() => setLetzteAktion(null), 4000);
    }
  }

  // ---- Aktions-Dialog --------------------------------------

  async function handleAktion(aktion: 'ausstempeln' | 'pause') {
    if (!aktionDialog) return;
    const { session, mitarbeiter: ma } = aktionDialog;
    setAktionDialog(null);
    if (aktion === 'ausstempeln') {
      await ausstempelnMitPausenabschluss(session);
      setLetzteAktion({ name: ma.name, aktion: 'ausgestempelt' });
    } else {
      await pauseStarten(session);
      setLetzteAktion({ name: ma.name, aktion: 'Pause gestartet' });
    }
    setTimeout(() => setLetzteAktion(null), 4000);
  }

  const inPause = aktiveSess.filter((s) => s.status === 'pause');
  const aktiv = aktiveSess.filter((s) => s.status === 'aktiv');

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Zeiterfassung</h1>

      {/* NFC-Bereich */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
        <div className="flex flex-col items-center gap-4">
          <div
            className={`w-24 h-24 rounded-full flex items-center justify-center text-4xl transition-all ${
              nfcStatus === 'liest'
                ? 'bg-blue-100 animate-pulse'
                : nfcStatus === 'fehler'
                ? 'bg-red-50'
                : 'bg-gray-50 hover:bg-blue-50 cursor-pointer'
            }`}
            onClick={nfcStatus === 'idle' ? starteNfcScan : undefined}
          >
            📲
          </div>

          {nfcStatus === 'idle' && (
            <div className="text-center">
              <button
                onClick={starteNfcScan}
                className="bg-blue-600 text-white px-6 py-2.5 rounded-lg font-medium hover:bg-blue-700 transition-colors"
              >
                NFC-Chip scannen
              </button>
              <p className="text-xs text-gray-400 mt-2">oder</p>
              <button
                onClick={() => setShowManuell(true)}
                className="text-sm text-blue-600 hover:text-blue-800 mt-1"
              >
                Mitarbeiter manuell auswählen
              </button>
            </div>
          )}

          {nfcStatus === 'liest' && (
            <p className="text-blue-600 font-medium">{nfcMeldung}</p>
          )}

          {nfcStatus === 'fehler' && (
            <div className="text-center">
              <p className="text-red-600 text-sm mb-2">{nfcMeldung}</p>
              <button
                onClick={() => { setNfcStatus('idle'); setNfcMeldung(''); }}
                className="text-sm text-gray-600 hover:text-gray-800"
              >
                Zurücksetzen
              </button>
            </div>
          )}
        </div>

        {/* Letzte Aktion */}
        {letzteAktion && (
          <div className="mt-4 bg-green-50 border border-green-200 rounded-lg p-3 text-center">
            <p className="text-green-700 font-medium">
              ✓ {letzteAktion.name} — {letzteAktion.aktion}
            </p>
          </div>
        )}
      </div>

      {/* Aktive Mitarbeiter */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Eingestempelt */}
        <div>
          <h2 className="font-semibold text-gray-700 mb-3 text-sm uppercase tracking-wide">
            Eingestempelt ({aktiv.length})
          </h2>
          <div className="space-y-2">
            {aktiv.length === 0 && (
              <p className="text-gray-400 text-sm bg-white rounded-xl border border-gray-200 p-4 text-center">
                Niemand eingestempelt
              </p>
            )}
            {aktiv.map((s) => (
              <SessionKarte
                key={s.id}
                session={s}
                mitarbeiter={getMitarbeiter(s.mitarbeiterId)}
                tick={tick}
                onAktion={() => {
                  const ma = getMitarbeiter(s.mitarbeiterId);
                  if (ma) setAktionDialog({ session: s, mitarbeiter: ma });
                }}
              />
            ))}
          </div>
        </div>

        {/* In Pause */}
        <div>
          <h2 className="font-semibold text-gray-700 mb-3 text-sm uppercase tracking-wide">
            In Pause ({inPause.length})
          </h2>
          <div className="space-y-2">
            {inPause.length === 0 && (
              <p className="text-gray-400 text-sm bg-white rounded-xl border border-gray-200 p-4 text-center">
                Niemand in der Pause
              </p>
            )}
            {inPause.map((s) => (
              <SessionKarte
                key={s.id}
                session={s}
                mitarbeiter={getMitarbeiter(s.mitarbeiterId)}
                tick={tick}
                onAktion={() => {
                  const ma = getMitarbeiter(s.mitarbeiterId);
                  if (ma) setAktionDialog({ session: s, mitarbeiter: ma });
                }}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Aktions-Dialog */}
      <Modal
        isOpen={aktionDialog !== null}
        onClose={() => setAktionDialog(null)}
        title={aktionDialog ? aktionDialog.mitarbeiter.name : ''}
        size="sm"
      >
        {aktionDialog && (
          <div className="space-y-3">
            <p className="text-gray-600 text-sm">
              Seit {formatierZeit(aktionDialog.session.startTime)} eingestempelt ·{' '}
              {formatierDauer(berechneNettoMinuten(aktionDialog.session))} Netto
            </p>
            <div className="grid grid-cols-1 gap-2">
              <button
                onClick={() => handleAktion('pause')}
                className="w-full bg-amber-500 text-white py-3 rounded-lg font-medium hover:bg-amber-600 transition-colors"
              >
                ☕ Pause starten
              </button>
              <button
                onClick={() => handleAktion('ausstempeln')}
                className="w-full bg-red-500 text-white py-3 rounded-lg font-medium hover:bg-red-600 transition-colors"
              >
                🏁 Ausstempeln
              </button>
              <button
                onClick={() => setAktionDialog(null)}
                className="w-full bg-gray-100 text-gray-700 py-2.5 rounded-lg text-sm hover:bg-gray-200 transition-colors"
              >
                Abbrechen
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Manuelles Einstempeln */}
      <Modal
        isOpen={showManuell}
        onClose={() => setShowManuell(false)}
        title="Manuell einstempeln"
        size="md"
      >
        <ManuellEinstempeln
          mitarbeiter={mitarbeiter.filter((m) => m.isActive)}
          aktiveSessions={aktiveSess}
          onScan={async (id) => {
            setShowManuell(false);
            await verarbeiteScan(id);
          }}
          onCancel={() => setShowManuell(false)}
        />
      </Modal>
    </div>
  );
}

// ---- Session-Karte ----------------------------------------

function SessionKarte({
  session,
  mitarbeiter: ma,
  tick: _tick,
  onAktion,
}: {
  session: Arbeitszeit;
  mitarbeiter: Mitarbeiter | undefined;
  tick: number;
  onAktion: () => void;
}) {
  const nettoMin = berechneNettoMinuten(session);
  const typ = session.typ as ArbeitszeitsTyp;

  return (
    <div
      className={`bg-white rounded-xl border p-3 cursor-pointer hover:border-blue-300 transition-colors ${
        session.status === 'pause' ? 'border-amber-300 bg-amber-50' : 'border-gray-200'
      }`}
      onClick={onAktion}
    >
      <div className="flex items-center justify-between">
        <div>
          <div className="font-medium text-gray-900 text-sm">{ma?.name ?? '?'}</div>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className={`text-xs px-1.5 py-0.5 rounded ${TYP_FARBEN[typ] ?? 'bg-gray-100 text-gray-600'}`}>
              {TYP_LABELS[typ] ?? typ}
            </span>
            {session.status === 'pause' && (
              <span className="text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">Pause</span>
            )}
          </div>
        </div>
        <div className="text-right">
          <div className="text-sm font-semibold text-gray-800">{formatierDauer(nettoMin)}</div>
          <div className="text-xs text-gray-400">seit {formatierZeit(session.startTime)}</div>
        </div>
      </div>
    </div>
  );
}

// ---- Manuelles Einstempeln --------------------------------

function ManuellEinstempeln({
  mitarbeiter,
  aktiveSessions,
  onScan,
  onCancel,
}: {
  mitarbeiter: Mitarbeiter[];
  aktiveSessions: Arbeitszeit[];
  onScan: (id: string) => void;
  onCancel: () => void;
}) {
  const [filter, setFilter] = useState('');

  const aktiveIds = new Set(aktiveSessions.map((s) => s.mitarbeiterId));
  const gefiltert = mitarbeiter.filter(
    (m) =>
      m.name.toLowerCase().includes(filter.toLowerCase()) ||
      m.nummer.includes(filter)
  );

  return (
    <div className="space-y-3">
      <input
        type="text"
        placeholder="Name oder Nummer suchen..."
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        autoFocus
      />
      <div className="max-h-72 overflow-y-auto space-y-1">
        {gefiltert.map((m) => {
          const istAktiv = aktiveIds.has(m.id);
          return (
            <button
              key={m.id}
              onClick={() => onScan(m.id)}
              className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm transition-colors ${
                istAktiv
                  ? 'bg-green-50 border border-green-200 hover:border-green-400'
                  : 'bg-white border border-gray-200 hover:border-blue-300 hover:bg-blue-50'
              }`}
            >
              <span className="font-medium text-gray-800">{m.name}</span>
              <span className={`text-xs ${istAktiv ? 'text-green-600' : 'text-gray-400'}`}>
                {istAktiv ? '● Eingestempelt' : m.nummer}
              </span>
            </button>
          );
        })}
      </div>
      <button onClick={onCancel} className="w-full py-2 text-sm text-gray-500 hover:text-gray-700">
        Abbrechen
      </button>
    </div>
  );
}
