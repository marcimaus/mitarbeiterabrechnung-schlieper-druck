import { useState, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import AdminPinGate from '../components/AdminPinGate';
import Modal from '../components/Modal';
import {
  ladeMonatsarbeitszeiten,
  berechneNettoMinuten,
  formatierZeit,
  formatierDatum,
  formatierDauer,
  korrigiereSession,
} from '../lib/zeiterfassung';
import { ladeFahrten } from '../lib/db';
import { MONATSNAMEN } from '../lib/kalender';
import { ermittleStundenlohn } from '../lib/berechnung';
import type { Arbeitszeit, Fahrt } from '../types';

export default function ZeitübersichtScreen() {
  return (
    <AdminPinGate>
      <ZeitübersichtInhalt />
    </AdminPinGate>
  );
}

function ZeitübersichtInhalt() {
  const { mitarbeiter, parameter, adminName } = useApp();
  const heute = new Date();
  const [selectedMaId, setSelectedMaId] = useState<string>('');
  const [monat, setMonat] = useState(heute.getMonth() + 1);
  const [jahr, setJahr] = useState(heute.getFullYear());
  const [sessions, setSessions] = useState<Arbeitszeit[]>([]);
  const [fahrten, setFahrten] = useState<Fahrt[]>([]);
  const [loading, setLoading] = useState(false);
  const [editSession, setEditSession] = useState<Arbeitszeit | null>(null);

  const aktiveMitarbeiter = mitarbeiter.filter((m) => m.isActive);

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
      setLoading(false);
    });
  }, [selectedMaId, monat, jahr]);

  const ma = mitarbeiter.find((m) => m.id === selectedMaId);

  const gesamtNettoMinuten = sessions
    .filter((s) => s.status === 'abgeschlossen')
    .reduce((sum, s) => sum + berechneNettoMinuten(s), 0);

  const stundenlohn = ma && parameter ? ermittleStundenlohn(ma, parameter) : null;
  const lohnGesamt = stundenlohn ? (gesamtNettoMinuten / 60) * stundenlohn : null;
  const fahrtSatz = (ma?.fahrkostenEurProKm ?? parameter?.fahrkostenEurProKm ?? 0.30);
  const fahrtkostenGesamt = fahrten.reduce((s, f) => s + f.streckKm * fahrtSatz, 0);

  const jahre = [heute.getFullYear() - 1, heute.getFullYear(), heute.getFullYear() + 1];

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Zeitübersicht</h1>

      {/* Filter */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 mb-6">
        <div className="flex flex-wrap gap-3">
          <select
            value={selectedMaId}
            onChange={(e) => setSelectedMaId(e.target.value)}
            className={selectClass}
          >
            <option value="">Mitarbeiter wählen...</option>
            {aktiveMitarbeiter.map((m) => (
              <option key={m.id} value={m.id}>{m.name} ({m.nummer})</option>
            ))}
          </select>
          <select value={monat} onChange={(e) => setMonat(Number(e.target.value))} className={selectClass}>
            {MONATSNAMEN.map((name, i) => (
              <option key={i + 1} value={i + 1}>{name}</option>
            ))}
          </select>
          <select value={jahr} onChange={(e) => setJahr(Number(e.target.value))} className={selectClass}>
            {jahre.map((j) => <option key={j} value={j}>{j}</option>)}
          </select>
        </div>
      </div>

      {!selectedMaId && (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-400">
          Bitte einen Mitarbeiter auswählen
        </div>
      )}

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
                sub={`${stundenlohn?.toFixed(2)} €/h`}
              />
            )}
            {fahrtkostenGesamt > 0 && (
              <SummaryCard
                label="Fahrtkosten"
                value={fahrtkostenGesamt.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}
              />
            )}
          </div>

          {/* Sessions-Tabelle */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden mb-6">
            <div className="px-4 py-3 border-b border-gray-200 bg-gray-50 font-medium text-sm text-gray-600">
              Arbeitstage — {MONATSNAMEN[monat - 1]} {jahr}
            </div>
            {sessions.length === 0 ? (
              <div className="p-6 text-center text-gray-400 text-sm">
                Keine Zeiten erfasst in diesem Monat
              </div>
            ) : (
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
                  {sessions.map((s) => (
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
                        <button
                          onClick={() => setEditSession(s)}
                          className="text-xs text-blue-600 hover:text-blue-800"
                        >
                          Bearbeiten
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Fahrten (read-only — Erfassung über Fahrtkosten-Screen) */}
          <FahrtenÜbersicht fahrten={fahrten} fahrtSatz={fahrtSatz} />
        </>
      )}

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
  onSave,
  onCancel,
}: {
  session: Arbeitszeit;
  adminName: string;
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
  const [begruendung, setBegruendung] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!begruendung.trim()) return;
    setSaving(true);
    const changes: Partial<Arbeitszeit> = {};
    if (startStr) changes.startTime = fromTimeInput(session.startTime, startStr);
    if (endeStr) changes.endTime = fromTimeInput(session.endTime ?? session.startTime, endeStr);
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
