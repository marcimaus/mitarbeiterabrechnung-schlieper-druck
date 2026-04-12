import { useState, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import AdminPinGate from '../components/AdminPinGate';
import {
  ladeAusgaben,
  ladeZusammentragenEinsaetze,
  setzeZusammentragenEinsatz,
  loescheZusammentragenEinsatz,
} from '../lib/db';
import type { Ausgabe, ZusammentragenEinsatz } from '../types';
import { kwLabel } from '../lib/kalender';

interface ZusammenMap {
  [teilgebietId: string]: ZusammentragenEinsatz;
}

export default function ZusammentragenScreen() {
  return (
    <AdminPinGate>
      <ZusammentragenInhalt />
    </AdminPinGate>
  );
}

function ZusammentragenInhalt() {
  const { teilgebiete, mitarbeiter, touren } = useApp();
  const [ausgaben, setAusgaben] = useState<Ausgabe[]>([]);
  const [selectedAusgabeId, setSelectedAusgabeId] = useState('');
  const [einsaetze, setEinsaetze] = useState<ZusammenMap>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    ladeAusgaben().then((list) => {
      const sorted = [...list].sort((a, b) =>
        b.jahr !== a.jahr ? b.jahr - a.jahr : b.kw - a.kw
      );
      setAusgaben(sorted);
      if (sorted.length > 0) setSelectedAusgabeId(sorted[0].id);
    });
  }, []);

  useEffect(() => {
    if (!selectedAusgabeId) return;
    setLoading(true);
    ladeZusammentragenEinsaetze(selectedAusgabeId).then((list) => {
      const map: ZusammenMap = {};
      for (const e of list) map[e.teilgebietId] = e;
      setEinsaetze(map);
      setLoading(false);
    });
  }, [selectedAusgabeId]);

  const selectedAusgabe = ausgaben.find((a) => a.id === selectedAusgabeId);
  const aktiveTeilgebiete = teilgebiete
    .filter((tg) => tg.isActive)
    .sort((a, b) => a.name.localeCompare(b.name));

  const zusammentraeger = mitarbeiter.filter(
    (m) => m.isActive && m.rollen.includes('zusammenträger')
  );

  async function handleChange(
    teilgebietId: string,
    mitarbeiterId: string
  ) {
    if (!selectedAusgabe) return;
    setSaving(teilgebietId);
    try {
      if (!mitarbeiterId) {
        const e = einsaetze[teilgebietId];
        if (e) {
          await loescheZusammentragenEinsatz(e.id);
          setEinsaetze((prev) => {
            const next = { ...prev };
            delete next[teilgebietId];
            return next;
          });
        }
        return;
      }
      await setzeZusammentragenEinsatz({
        ausgabeId: selectedAusgabe.id,
        teilgebietId,
        mitarbeiterId,
        stapelBearbeitet: selectedAusgabe.stapel.length,
        istVorarbeit: einsaetze[teilgebietId]?.istVorarbeit ?? false,
        vorarbeitMinuten: einsaetze[teilgebietId]?.vorarbeitMinuten,
      });
      const updated = await ladeZusammentragenEinsaetze(selectedAusgabe.id);
      const map: ZusammenMap = {};
      for (const e of updated) map[e.teilgebietId] = e;
      setEinsaetze(map);
    } finally {
      setSaving(null);
    }
  }

  async function handleVorarbeitChange(
    teilgebietId: string,
    istVorarbeit: boolean
  ) {
    if (!selectedAusgabe) return;
    const e = einsaetze[teilgebietId];
    if (!e) return;
    setSaving(teilgebietId);
    try {
      await setzeZusammentragenEinsatz({
        ausgabeId: selectedAusgabe.id,
        teilgebietId,
        mitarbeiterId: e.mitarbeiterId,
        stapelBearbeitet: e.stapelBearbeitet,
        istVorarbeit,
        vorarbeitMinuten: istVorarbeit ? (e.vorarbeitMinuten ?? 0) : undefined,
      });
      const updated = await ladeZusammentragenEinsaetze(selectedAusgabe.id);
      const map: ZusammenMap = {};
      for (const u of updated) map[u.teilgebietId] = u;
      setEinsaetze(map);
    } finally {
      setSaving(null);
    }
  }

  async function handleVorarbeitMinuten(
    teilgebietId: string,
    stunden: number,
    minuten: number
  ) {
    if (!selectedAusgabe) return;
    const e = einsaetze[teilgebietId];
    if (!e) return;
    const gesamtMinuten = stunden * 60 + minuten;
    setSaving(teilgebietId);
    try {
      await setzeZusammentragenEinsatz({
        ausgabeId: selectedAusgabe.id,
        teilgebietId,
        mitarbeiterId: e.mitarbeiterId,
        stapelBearbeitet: e.stapelBearbeitet,
        istVorarbeit: true,
        vorarbeitMinuten: gesamtMinuten,
      });
      const updated = await ladeZusammentragenEinsaetze(selectedAusgabe.id);
      const map: ZusammenMap = {};
      for (const u of updated) map[u.teilgebietId] = u;
      setEinsaetze(map);
    } finally {
      setSaving(null);
    }
  }

  const zugewiesen = Object.keys(einsaetze).length;
  const gesamt = aktiveTeilgebiete.length;

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Zusammentragen</h1>

      {/* Ausgabeauswahl */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 mb-6">
        <div className="flex items-center gap-4 flex-wrap">
          <label className="text-sm font-medium text-gray-700">Ausgabe:</label>
          <select
            value={selectedAusgabeId}
            onChange={(e) => setSelectedAusgabeId(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {ausgaben.map((a) => (
              <option key={a.id} value={a.id}>
                {kwLabel(a.kw, a.jahr)} — {a.stapel.length} Stapel
              </option>
            ))}
          </select>

          {!loading && selectedAusgabe && (
            <div className="ml-auto flex items-center gap-3">
              <span className="text-sm text-gray-500">
                {zugewiesen} / {gesamt} Teilgebiete zugewiesen
              </span>
              <div className="h-2 w-32 bg-gray-200 rounded-full overflow-hidden">
                <div
                  className="h-full bg-green-500 rounded-full transition-all"
                  style={{ width: `${gesamt > 0 ? (zugewiesen / gesamt) * 100 : 0}%` }}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Info über Stapel */}
      {selectedAusgabe && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 mb-4 text-sm text-blue-800">
          <strong>{kwLabel(selectedAusgabe.kw, selectedAusgabe.jahr)}</strong>:
          {' '}{selectedAusgabe.seitenzahl} Seiten →
          {' '}{selectedAusgabe.stapel.length} Stapel
          {' '}({selectedAusgabe.stapel.join(' + ')} Seiten)
          — je Teilgebiet {selectedAusgabe.stapel.length} Stapel zu bearbeiten
        </div>
      )}

      {/* Tabelle */}
      {loading ? (
        <div className="text-center py-12 text-gray-500">Lade Daten...</div>
      ) : !selectedAusgabe ? (
        <div className="text-center py-12 text-gray-400">Keine Ausgabe ausgewählt</div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Teilgebiet</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Tour</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Zusammenträger</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Vorarbeit</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Zeit</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {aktiveTeilgebiete.map((tg) => {
                const e = einsaetze[tg.id];
                const tour = touren.find((t) => t.id === tg.tourId);
                const istSpeichern = saving === tg.id;

                const vorarbeitStunden = e?.vorarbeitMinuten
                  ? Math.floor(e.vorarbeitMinuten / 60)
                  : 0;
                const vorarbeitMinutenRest = e?.vorarbeitMinuten
                  ? e.vorarbeitMinuten % 60
                  : 0;

                return (
                  <tr
                    key={tg.id}
                    className={`transition-colors ${e ? 'bg-white' : 'bg-gray-50'}`}
                  >
                    {/* Teilgebiet */}
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900">{tg.name}</div>
                      <div className="text-xs text-gray-400">{tg.plz} · {tg.stueckzahl} Stk</div>
                    </td>

                    {/* Tour */}
                    <td className="px-4 py-3">
                      {tour ? (
                        <span
                          className="text-xs font-medium px-2 py-0.5 rounded-full text-white"
                          style={{ backgroundColor: tour.farbe }}
                        >
                          {tour.name}
                        </span>
                      ) : <span className="text-gray-300">—</span>}
                    </td>

                    {/* Zusammenträger auswählen */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <select
                          value={e?.mitarbeiterId ?? ''}
                          onChange={(ev) => handleChange(tg.id, ev.target.value)}
                          disabled={istSpeichern}
                          className={`border rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                            e ? 'border-green-300 bg-green-50' : 'border-gray-300'
                          }`}
                        >
                          <option value="">— nicht zugewiesen —</option>
                          {zusammentraeger.map((m) => (
                            <option key={m.id} value={m.id}>{m.name}</option>
                          ))}
                        </select>
                        {istSpeichern && (
                          <span className="text-xs text-gray-400">...</span>
                        )}
                      </div>
                    </td>

                    {/* Vorarbeit-Haken */}
                    <td className="px-4 py-3">
                      {e ? (
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={e.istVorarbeit}
                            onChange={(ev) => handleVorarbeitChange(tg.id, ev.target.checked)}
                            disabled={istSpeichern}
                            className="w-4 h-4 rounded accent-blue-600"
                          />
                          <span className="text-xs text-gray-600">Vorarbeit</span>
                        </label>
                      ) : (
                        <span className="text-gray-300 text-xs">erst Zusammenträger wählen</span>
                      )}
                    </td>

                    {/* Vorarbeit-Zeit */}
                    <td className="px-4 py-3">
                      {e?.istVorarbeit ? (
                        <VorarbeitZeitEingabe
                          stunden={vorarbeitStunden}
                          minuten={vorarbeitMinutenRest}
                          disabled={istSpeichern}
                          onSave={(h, m) => handleVorarbeitMinuten(tg.id, h, m)}
                        />
                      ) : (
                        <span className="text-gray-300 text-xs">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---- Vorarbeit-Zeit-Eingabe mit lokalem State ----------------

function VorarbeitZeitEingabe({
  stunden,
  minuten,
  disabled,
  onSave,
}: {
  stunden: number;
  minuten: number;
  disabled: boolean;
  onSave: (h: number, m: number) => void;
}) {
  const [h, setH] = useState(stunden.toString());
  const [m, setM] = useState(minuten.toString().padStart(2, '0'));

  function handleBlur() {
    const hn = Math.max(0, parseInt(h) || 0);
    const mn = Math.max(0, Math.min(59, parseInt(m) || 0));
    onSave(hn, mn);
  }

  return (
    <div className="flex items-center gap-1">
      <input
        type="number"
        min="0"
        max="23"
        value={h}
        onChange={(e) => setH(e.target.value)}
        onBlur={handleBlur}
        disabled={disabled}
        className="w-12 border border-gray-300 rounded px-1.5 py-1 text-sm text-center focus:outline-none focus:ring-1 focus:ring-blue-500"
        title="Stunden"
      />
      <span className="text-gray-500">:</span>
      <input
        type="number"
        min="0"
        max="59"
        value={m}
        onChange={(e) => setM(e.target.value)}
        onBlur={handleBlur}
        disabled={disabled}
        className="w-12 border border-gray-300 rounded px-1.5 py-1 text-sm text-center focus:outline-none focus:ring-1 focus:ring-blue-500"
        title="Minuten"
      />
      <span className="text-xs text-gray-400">h</span>
    </div>
  );
}
