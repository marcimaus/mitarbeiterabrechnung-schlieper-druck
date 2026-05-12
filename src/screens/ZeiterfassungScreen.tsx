import { useState, useEffect, useCallback } from 'react';
import { useApp } from '../context/AppContext';
import Modal from '../components/Modal';
import { istEinsatzbereit } from '../utils';
import {
  aktiveSessions,
  verarbeiteNfcScan,
  ausstempelnMitPausenabschluss,
  pauseStarten,
  pauseBeenden,
  nfcVerfuegbar,
  leseNfcTag,
  schliesseAbgelaufeneSessions,
  ladeAktiveSessionFuerMitarbeiter,
  ladeVortagesAutoGeschlossen,
  einstempeln,
  korrigiereSession,
  berechneNettoMinuten,
  formatierZeit,
  formatierDatum,
  formatierDauer,
} from '../lib/zeiterfassung';
import type { Arbeitszeit, ArbeitszeitsTyp, Ausgabe, Mitarbeiter, Rolle } from '../types';
import { TYP_LABELS } from '../types';
import { nameMitFestgehaltSymbol } from '../utils';
import { ladeAusgaben } from '../lib/db';
import { getISOWeek, getISOYear } from '../lib/kalender';

const TYP_FARBEN: Record<ArbeitszeitsTyp, string> = {
  zusammentragen: 'bg-purple-100 text-purple-700',
  austragen: 'bg-green-100 text-green-700',
  vorarbeit: 'bg-pink-100 text-pink-700',
  sonstige: 'bg-gray-100 text-gray-700',
};

/** Gibt die für einen Mitarbeiter möglichen Tätigkeiten zurück. */
function tätigkeitenFuerMitarbeiter(rollen: Rolle[]): ArbeitszeitsTyp[] {
  const result: ArbeitszeitsTyp[] = [];
  if (rollen.includes('zusammenträger')) { result.push('zusammentragen', 'vorarbeit'); }
  if (rollen.includes('austräger')) result.push('austragen');
  if (rollen.includes('sonstige')) result.push('sonstige');
  return result;
}

export default function ZeiterfassungScreen() {
  const { mitarbeiter, userRole, mitarbeiterId } = useApp();
  const istMitarbeiter = userRole === 'mitarbeiter';
  const eigenerMa = mitarbeiterId
    ? mitarbeiter.find((m) => m.id === mitarbeiterId)
    : undefined;
  const [aktiveSess, setAktiveSess] = useState<Arbeitszeit[]>([]);
  const [nfcStatus, setNfcStatus] = useState<'idle' | 'liest' | 'fehler'>('idle');
  const [nfcMeldung, setNfcMeldung] = useState('');
  const [letzteAktion, setLetzteAktion] = useState<{ name: string; aktion: string } | null>(null);

  // Dialog: Aktion wählen wenn bereits eingestempelt
  const [aktionDialog, setAktionDialog] = useState<{
    session: Arbeitszeit;
    mitarbeiter: Mitarbeiter;
  } | null>(null);

  // Dialog: Auto-geschlossene Session vom Vortag korrigieren
  const [autoGeschlossen, setAutoGeschlossen] = useState<{
    session: Arbeitszeit;
    mitarbeiter: Mitarbeiter;
    /** Typ für neues Einstempeln nach Korrektur */
    defaultTyp: ArbeitszeitsTyp;
  } | null>(null);

  // Manuelle Erfassung
  const [showManuell, setShowManuell] = useState(false);

  // Tätigkeitsauswahl (für Mitarbeiter mit mehreren möglichen Tätigkeiten)
  const [tätigkeitsWahl, setTätigkeitsWahl] = useState<{
    mitarbeiter: Mitarbeiter;
    optionen: ArbeitszeitsTyp[];
    quelle: 'nfc' | 'manuell';
  } | null>(null);

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

  // Ausgaben für Vorarbeit-Zuordnung: NUR Ausgaben der aktuellen Kalenderwoche.
  // Ältere Ausgaben würden bei der Vorarbeits-Erfassung an der Stempeluhr
  // nichts zur regulären Erfassung beitragen — Korrekturen laufen über die
  // Zusammentragen-Maske.
  const aktuellesKw = (() => {
    const d = new Date();
    return { kw: getISOWeek(d), jahr: getISOYear(d) };
  })();
  const [alleAusgaben, setAlleAusgaben] = useState<Ausgabe[]>([]);
  const [vorarbeitAusgabeId, setVorarbeitAusgabeId] = useState<string>('');
  useEffect(() => {
    ladeAusgaben().then((list) => {
      const aktuelleKwAusgaben = list.filter(
        (a) => a.jahr === aktuellesKw.jahr && a.kw === aktuellesKw.kw
      );
      setAlleAusgaben(aktuelleKwAusgaben);
      if (aktuelleKwAusgaben.length === 0) { setVorarbeitAusgabeId(''); return; }
      setVorarbeitAusgabeId(aktuelleKwAusgaben[0].id);
    }).catch((err) => console.error('Ausgaben laden fehlgeschlagen:', err));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Für einen bestimmten Typ ggf. die zugehörige AusgabeId liefern (nur Vorarbeit) */
  const ausgabeIdFuerTyp = useCallback(
    (typ: ArbeitszeitsTyp): string | undefined =>
      typ === 'vorarbeit' && vorarbeitAusgabeId ? vorarbeitAusgabeId : undefined,
    [vorarbeitAusgabeId]
  );

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

  async function verarbeiteScan(mitarbeiterId: string, quelle: 'nfc' | 'manuell' = 'nfc') {
    const ma = getMitarbeiter(mitarbeiterId);
    if (!ma) {
      setNfcMeldung(`Unbekannter Mitarbeiter (ID: ${mitarbeiterId}). Bitte in der Mitarbeiterverwaltung prüfen.`);
      setNfcStatus('fehler');
      return;
    }

    const optionen = tätigkeitenFuerMitarbeiter(ma.rollen);
    if (optionen.length === 0) {
      setNfcMeldung(`${ma.name} hat keine Rolle. Bitte in der Mitarbeiterverwaltung prüfen.`);
      setNfcStatus('fehler');
      return;
    }

    // Aktive Session vorhanden? → direkt Aktionsdialog (egal welche Tätigkeit)
    const aktive = await ladeAktiveSessionFuerMitarbeiter(mitarbeiterId);
    if (aktive) {
      setNfcStatus('idle');
      setNfcMeldung('');
      setAktionDialog({ session: aktive, mitarbeiter: ma });
      return;
    }

    // Auto-geschlossene Vortages-Session?
    const vortag = await ladeVortagesAutoGeschlossen(mitarbeiterId);
    if (vortag) {
      setNfcStatus('idle');
      setNfcMeldung('');
      setAutoGeschlossen({ session: vortag, mitarbeiter: ma, defaultTyp: optionen[0] });
      return;
    }

    // Mehrere Tätigkeiten möglich? → Dialog
    if (optionen.length > 1) {
      setNfcStatus('idle');
      setNfcMeldung('');
      setTätigkeitsWahl({ mitarbeiter: ma, optionen, quelle });
      return;
    }

    // Genau eine Tätigkeit → direkt einstempeln
    await stempelEin(ma, optionen[0], quelle);
    setNfcStatus('idle');
    setNfcMeldung('');
  }

  async function stempelEin(ma: Mitarbeiter, typ: ArbeitszeitsTyp, quelle: 'nfc' | 'manuell') {
    const result = await verarbeiteNfcScan(ma.id, typ, ausgabeIdFuerTyp(typ));
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
      setLetzteAktion({ name: ma.name, aktion: `${aktionTexte[result.aktion]} (${TYP_LABELS[typ]})` });
      setTimeout(() => setLetzteAktion(null), 4000);
    }
    // quelle wird aktuell nur intern genutzt; verarbeiteNfcScan setzt die Quelle selbst
    void quelle;
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
      if (session.status === 'pause') {
        await pauseBeenden(session);
        setLetzteAktion({ name: ma.name, aktion: 'Pause beendet' });
      } else {
        await pauseStarten(session);
        setLetzteAktion({ name: ma.name, aktion: 'Pause gestartet' });
      }
    }
    setTimeout(() => setLetzteAktion(null), 4000);
  }

  /** Wechselt zwischen Zusammentragen und Vorarbeit ohne ausstempeln zu müssen. */
  async function handleTaetigkeitWechsel() {
    if (!aktionDialog) return;
    const { session, mitarbeiter: ma } = aktionDialog;
    const neuerTyp: ArbeitszeitsTyp =
      session.typ === 'zusammentragen' ? 'vorarbeit' : 'zusammentragen';
    setAktionDialog(null);
    // Falls in Pause: Pause beenden (damit Pause-Zeit sauber zählt)
    if (session.status === 'pause') {
      await pauseBeenden(session);
    }
    await ausstempelnMitPausenabschluss(session);
    await einstempeln(ma.id, neuerTyp, session.quelle, ausgabeIdFuerTyp(neuerTyp));
    setLetzteAktion({
      name: ma.name,
      aktion: `gewechselt zu ${TYP_LABELS[neuerTyp]}`,
    });
    setTimeout(() => setLetzteAktion(null), 4000);
  }

  // Mitarbeiter sehen ALLE Sessions (wer ist gerade eingestempelt, mit
  // welcher Tätigkeit, wie lange, seit wann), dürfen aber NUR an der
  // eigenen Session Aktionen auslösen — Klick auf fremde Karte ist gesperrt.
  const inPause = aktiveSess.filter((s) => s.status === 'pause');
  const aktiv = aktiveSess.filter((s) => s.status === 'aktiv');

  function darfAgieren(s: Arbeitszeit): boolean {
    if (!istMitarbeiter) return true;
    return s.mitarbeiterId === mitarbeiterId;
  }

  /** MA-Modus: direkt eigenen Scan-Flow anstoßen (kein NFC-Lesen, keine Auswahl). */
  async function eigenenScanAusloesen() {
    if (!eigenerMa) {
      setNfcMeldung('Mitarbeiter-Daten nicht verfügbar — bitte neu anmelden.');
      setNfcStatus('fehler');
      return;
    }
    setNfcStatus('idle');
    setNfcMeldung('');
    await verarbeiteScan(eigenerMa.id, 'manuell');
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Zeiterfassung</h1>

      {/* NFC-Bereich — bzw. eigener Stempel-Button im MA-Login */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
        <div className="flex flex-col items-center gap-4">
          {istMitarbeiter ? (
            <>
              <div className="text-center">
                <p className="text-sm text-gray-500 mb-1">Angemeldet als</p>
                <p className="font-semibold text-gray-900 text-lg">{eigenerMa?.name ?? '?'}</p>
              </div>
              {nfcStatus === 'idle' && (
                <button
                  onClick={eigenenScanAusloesen}
                  disabled={!eigenerMa}
                  className="bg-blue-600 text-white px-6 py-2.5 rounded-lg font-medium hover:bg-blue-700 transition-colors disabled:opacity-50"
                >
                  ⏱ Stempeln
                </button>
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
            </>
          ) : (
            <>
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
            </>
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
                readOnly={!darfAgieren(s)}
                onAktion={() => {
                  if (!darfAgieren(s)) return;
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
                readOnly={!darfAgieren(s)}
                onAktion={() => {
                  if (!darfAgieren(s)) return;
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
        title={aktionDialog ? nameMitFestgehaltSymbol(aktionDialog.mitarbeiter) : ''}
        size="sm"
      >
        {aktionDialog && (
          <div className="space-y-3">
            <p className="text-gray-600 text-sm">
              Seit {formatierZeit(aktionDialog.session.startTime)} eingestempelt ·{' '}
              {formatierDauer(berechneNettoMinuten(aktionDialog.session))} Netto
            </p>
            <div className="grid grid-cols-1 gap-2">
              {/* Tätigkeit wechseln: nur für Zusammenträger zwischen Zusammentragen ↔ Vorarbeit */}
              {aktionDialog.mitarbeiter.rollen.includes('zusammenträger') &&
                (aktionDialog.session.typ === 'zusammentragen' ||
                  aktionDialog.session.typ === 'vorarbeit') && (
                  <button
                    onClick={handleTaetigkeitWechsel}
                    className="w-full bg-purple-600 text-white py-3 rounded-lg font-medium hover:bg-purple-700 transition-colors"
                  >
                    🔄 Wechseln zu{' '}
                    {aktionDialog.session.typ === 'zusammentragen'
                      ? 'Vorarbeit'
                      : 'Zusammentragen'}
                  </button>
                )}
              <button
                onClick={() => handleAktion('pause')}
                className={`w-full text-white py-3 rounded-lg font-medium transition-colors ${
                  aktionDialog.session.status === 'pause'
                    ? 'bg-green-600 hover:bg-green-700'
                    : 'bg-amber-500 hover:bg-amber-600'
                }`}
              >
                {aktionDialog.session.status === 'pause' ? '▶ Pause beenden' : '☕ Pause starten'}
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

      {/* Auto-Schliessen Korrektur-Dialog */}
      <Modal
        isOpen={autoGeschlossen !== null}
        onClose={() => setAutoGeschlossen(null)}
        title="Ausstempeln vergessen?"
        size="md"
      >
        {autoGeschlossen && (
          <VortagsKorrektur
            session={autoGeschlossen.session}
            mitarbeiter={autoGeschlossen.mitarbeiter}
            onSave={async (neuesEnde) => {
              const { session, mitarbeiter: ma, defaultTyp } = autoGeschlossen;
              // Pausen anpassen: falls letzte Pause auch auf auto-close-Zeit endet → auf neuesEnde setzen
              const pausen = session.pausen.map((p, i) => {
                if (i === session.pausen.length - 1 && p.ende === session.endTime) {
                  return { ...p, ende: Math.min(neuesEnde, p.ende ?? neuesEnde) };
                }
                return p;
              });
              await korrigiereSession(
                session,
                { endTime: neuesEnde, pausen },
                ma.name,
                'Ausstempeln vergessen — nachträgliche Korrektur durch Mitarbeiter'
              );
              setAutoGeschlossen(null);
              await einstempeln(ma.id, defaultTyp, 'nfc', ausgabeIdFuerTyp(defaultTyp));
              setLetzteAktion({ name: ma.name, aktion: 'eingestempelt' });
              setTimeout(() => setLetzteAktion(null), 4000);
            }}
            onUeberspringen={async () => {
              const { mitarbeiter: ma, defaultTyp } = autoGeschlossen;
              setAutoGeschlossen(null);
              await einstempeln(ma.id, defaultTyp, 'nfc', ausgabeIdFuerTyp(defaultTyp));
              setLetzteAktion({ name: ma.name, aktion: 'eingestempelt' });
              setTimeout(() => setLetzteAktion(null), 4000);
            }}
            onAbbrechen={() => setAutoGeschlossen(null)}
          />
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
          mitarbeiter={mitarbeiter
            .filter((m) => istEinsatzbereit(m))
            .sort((a, b) => a.name.localeCompare(b.name))}
          aktiveSessions={aktiveSess}
          onScan={async (id) => {
            setShowManuell(false);
            await verarbeiteScan(id, 'manuell');
          }}
          onCancel={() => setShowManuell(false)}
        />
      </Modal>

      {/* Tätigkeits-Dialog */}
      <Modal
        isOpen={tätigkeitsWahl !== null}
        onClose={() => setTätigkeitsWahl(null)}
        title={tätigkeitsWahl ? `Tätigkeit für ${tätigkeitsWahl.mitarbeiter.name}` : ''}
        size="sm"
      >
        {tätigkeitsWahl && (
          <div className="space-y-2">
            <p className="text-sm text-gray-600 mb-2">
              Welche Tätigkeit wird jetzt begonnen?
            </p>
            {tätigkeitsWahl.optionen.includes('vorarbeit') && alleAusgaben.length > 0 && (
              <div className="bg-pink-50 border border-pink-200 rounded-lg p-2.5 mb-2">
                <label className="block text-xs font-medium text-pink-800 mb-1">
                  Ausgabe für Vorarbeit-Zuordnung:
                </label>
                <select
                  value={vorarbeitAusgabeId}
                  onChange={(e) => setVorarbeitAusgabeId(e.target.value)}
                  className="w-full border border-pink-300 rounded px-2 py-1.5 text-sm bg-white"
                >
                  {alleAusgaben.map((a) => (
                    <option key={a.id} value={a.id}>
                      KW {a.kw}/{a.jahr}{a.vorarbeitFreigegeben ? ' ✓ (erlaubt)' : ' — Vorarbeit nicht erlaubt'}
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-pink-700 mt-1">
                  Zeit wird erfasst — Lohn nur, wenn für diese Ausgabe „Vorarbeit erlauben" gesetzt ist.
                </p>
              </div>
            )}
            {tätigkeitsWahl.optionen.map((t) => (
              <button
                key={t}
                onClick={async () => {
                  const { mitarbeiter: ma, quelle } = tätigkeitsWahl;
                  setTätigkeitsWahl(null);
                  await stempelEin(ma, t, quelle);
                }}
                className={`w-full py-3 rounded-lg font-medium transition-colors ${TYP_FARBEN[t]} hover:opacity-90`}
              >
                {TYP_LABELS[t]}
              </button>
            ))}
            <button
              onClick={() => setTätigkeitsWahl(null)}
              className="w-full py-2 text-sm text-gray-500 hover:text-gray-700"
            >
              Abbrechen
            </button>
          </div>
        )}
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
  readOnly = false,
}: {
  session: Arbeitszeit;
  mitarbeiter: Mitarbeiter | undefined;
  tick: number;
  onAktion: () => void;
  /** Wenn true: Karte ist nicht antippbar (fremder MA für Mitarbeiter-Rolle). */
  readOnly?: boolean;
}) {
  const nettoMin = berechneNettoMinuten(session);
  const typ = session.typ as ArbeitszeitsTyp;
  const istVorarbeit = typ === 'vorarbeit';

  return (
    <div
      className={`bg-white rounded-xl border p-3 transition-colors ${
        readOnly
          ? 'cursor-default'
          : 'cursor-pointer hover:border-blue-300'
      } ${
        session.status === 'pause' ? 'border-amber-300 bg-amber-50' : 'border-gray-200'
      }`}
      onClick={readOnly ? undefined : onAktion}
      title={readOnly ? 'Nur lesender Zugriff — andere Mitarbeiter darf nur Admin/Abrechnung stempeln' : undefined}
    >
      <div className="flex items-center justify-between">
        <div>
          <div className="font-medium text-gray-900 text-sm">
            {ma ? nameMitFestgehaltSymbol(ma) : '?'}
            {istVorarbeit && <span className="ml-1 text-xs text-pink-600">(Vorarbeit)</span>}
          </div>
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

// ---- Vortags-Korrektur Dialog ------------------------------

function VortagsKorrektur({
  session,
  mitarbeiter: ma,
  onSave,
  onUeberspringen,
  onAbbrechen,
}: {
  session: Arbeitszeit;
  mitarbeiter: Mitarbeiter;
  onSave: (neuesEnde: number) => Promise<void>;
  onUeberspringen: () => Promise<void>;
  onAbbrechen: () => void;
}) {
  const warInPause = session.pausen.length > 0 &&
    session.pausen[session.pausen.length - 1].ende === session.endTime;

  // Vorschlag: Startzeit der letzten Pause (wenn in Pause), sonst leer
  const vorschlagTs = warInPause
    ? session.pausen[session.pausen.length - 1].start
    : null;
  const vorschlag = vorschlagTs
    ? (() => {
        const d = new Date(vorschlagTs);
        return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
      })()
    : '';

  const [endeZeit, setEndeZeit] = useState(vorschlag);
  const [saving, setSaving] = useState(false);

  const startDatum = new Date(session.startTime);

  async function handleSpeichern() {
    if (!endeZeit) return;
    setSaving(true);
    const [h, m] = endeZeit.split(':').map(Number);
    const neuesEnde = new Date(
      startDatum.getFullYear(), startDatum.getMonth(), startDatum.getDate(), h, m, 0, 0
    ).getTime();
    await onSave(neuesEnde);
    setSaving(false);
  }

  async function handleUeberspringen() {
    setSaving(true);
    await onUeberspringen();
    setSaving(false);
  }

  return (
    <div className="space-y-4">
      <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
        <p className="text-amber-800 font-medium text-sm mb-1">
          ⚠ {ma.name} hat vergessen auszustempeln!
        </p>
        <p className="text-amber-700 text-sm">
          Eingestempelt am <strong>{formatierDatum(session.startTime)}</strong> um{' '}
          <strong>{formatierZeit(session.startTime)}</strong> Uhr
          {warInPause && (
            <span className="block mt-1 text-amber-600">
              ☕ War noch in der Pause (seit {formatierZeit(session.pausen[session.pausen.length - 1].start)} Uhr)
            </span>
          )}
        </p>
        <p className="text-xs text-amber-500 mt-1">
          Automatisch geschlossen um 23:59 Uhr
        </p>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          {warInPause
            ? 'Bis wann ging die Schicht / Pause? (tatsächliches Arbeitsende)'
            : 'Bis wann wurde tatsächlich gearbeitet?'}
        </label>
        <input
          type="time"
          value={endeZeit}
          onChange={(e) => setEndeZeit(e.target.value)}
          className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          autoFocus
        />
        <p className="text-xs text-gray-400 mt-1">
          Datum: {formatierDatum(session.startTime)}
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <button
          onClick={handleSpeichern}
          disabled={saving || !endeZeit}
          className="w-full py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          {saving ? 'Speichere...' : '✓ Zeit korrigieren & Einstempeln'}
        </button>
        <button
          onClick={handleUeberspringen}
          disabled={saving}
          className="w-full py-2.5 bg-gray-100 text-gray-700 rounded-lg text-sm hover:bg-gray-200 disabled:opacity-50 transition-colors"
        >
          Überspringen & trotzdem Einstempeln (23:59 bleibt)
        </button>
        <button
          onClick={onAbbrechen}
          disabled={saving}
          className="w-full py-2 text-sm text-gray-400 hover:text-gray-600 transition-colors"
        >
          Abbrechen
        </button>
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
              <span className="font-medium text-gray-800">{nameMitFestgehaltSymbol(m)}</span>
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
