import { useState, useEffect, useCallback } from 'react';
import { useApp } from '../context/AppContext';
import AdminPinGate from '../components/AdminPinGate';
import Modal from '../components/Modal';
import { ladeAusgaben, ladeEinsaetze, setzeEinsatz, loescheEinsatz } from '../lib/db';
import type { Ausgabe, Einsatz, Teilgebiet } from '../types';
import { kwLabel } from '../lib/kalender';

// Hilfsfunktion: Ausgaben der letzten 2 Jahre laden (aus AppContext)
// Teilgebiete + Mitarbeiter kommen aus AppContext

interface EinsatzMap {
  [teilgebietId: string]: Einsatz;
}

export default function EinsaetzeScreen() {
  return (
    <AdminPinGate>
      <EinsaetzeInhalt />
    </AdminPinGate>
  );
}

function EinsaetzeInhalt() {
  const { teilgebiete, mitarbeiter, touren } = useApp();
  const [ausgaben, setAusgaben] = useState<Ausgabe[]>([]);
  const [selectedAusgabeId, setSelectedAusgabeId] = useState<string>('');
  const [einsaetze, setEinsaetze] = useState<EinsatzMap>({});
  const [loading, setLoading] = useState(false);
  const [springerDialog, setSpringerDialog] = useState<Teilgebiet | null>(null);
  const [springerMitarbeiterId, setSpringerMitarbeiterId] = useState('');
  const [springerZuschlag, setSpringerZuschlag] = useState('');
  const [springerFilter, setSpringerFilter] = useState('');

  // Ausgaben laden
  useEffect(() => {
    ladeAusgaben().then((list) => {
      const sorted = [...list].sort((a, b) =>
        b.jahr !== a.jahr ? b.jahr - a.jahr : b.kw - a.kw
      );
      setAusgaben(sorted);
      if (sorted.length > 0 && !selectedAusgabeId) {
        setSelectedAusgabeId(sorted[0].id);
      }
    });
  }, []);

  // Einsätze laden wenn Ausgabe wechselt
  useEffect(() => {
    if (!selectedAusgabeId) return;
    setLoading(true);
    ladeEinsaetze(selectedAusgabeId).then((list) => {
      const map: EinsatzMap = {};
      for (const e of list) map[e.teilgebietId] = e;
      setEinsaetze(map);
      setLoading(false);
    });
  }, [selectedAusgabeId]);

  const selectedAusgabe = ausgaben.find((a) => a.id === selectedAusgabeId);

  const aktiveTeilgebiete = teilgebiete
    .filter((tg) => tg.isActive)
    .sort((a, b) => a.name.localeCompare(b.name));

  const getMitarbeiter = useCallback(
    (id: string | null) => (id ? mitarbeiter.find((m) => m.id === id) : undefined),
    [mitarbeiter]
  );

  const getTour = useCallback(
    (tourId: string | null) => (tourId ? touren.find((t) => t.id === tourId) : undefined),
    [touren]
  );

  async function handleSetzeAusfall(tg: Teilgebiet) {
    if (!selectedAusgabe) return;
    await setzeEinsatz({
      ausgabeId: selectedAusgabe.id,
      kw: selectedAusgabe.kw,
      jahr: selectedAusgabe.jahr,
      teilgebietId: tg.id,
      mitarbeiterId: null,
      typ: 'ausfall',
    });
    const updated = await ladeEinsaetze(selectedAusgabe.id);
    const map: EinsatzMap = {};
    for (const e of updated) map[e.teilgebietId] = e;
    setEinsaetze(map);
  }

  async function handleSetzeUngeklaert(tg: Teilgebiet) {
    if (!selectedAusgabe) return;
    await setzeEinsatz({
      ausgabeId: selectedAusgabe.id,
      kw: selectedAusgabe.kw,
      jahr: selectedAusgabe.jahr,
      teilgebietId: tg.id,
      mitarbeiterId: null,
      typ: 'ungeklärt',
    });
    const updated = await ladeEinsaetze(selectedAusgabe.id);
    const map: EinsatzMap = {};
    for (const e of updated) map[e.teilgebietId] = e;
    setEinsaetze(map);
  }

  async function handleResetStandard(tg: Teilgebiet) {
    const e = einsaetze[tg.id];
    if (e) {
      await loescheEinsatz(e.id);
      setEinsaetze((prev) => {
        const next = { ...prev };
        delete next[tg.id];
        return next;
      });
    }
  }

  function oeffneSpringerDialog(tg: Teilgebiet) {
    const e = einsaetze[tg.id];
    setSpringerMitarbeiterId(e?.typ === 'springer' ? (e.mitarbeiterId ?? '') : '');
    setSpringerZuschlag(e?.springerZuschlagProzent?.toString() ?? '');
    setSpringerFilter('');
    setSpringerDialog(tg);
  }

  async function handleSpringerSpeichern() {
    if (!springerDialog || !selectedAusgabe || !springerMitarbeiterId) return;
    await setzeEinsatz({
      ausgabeId: selectedAusgabe.id,
      kw: selectedAusgabe.kw,
      jahr: selectedAusgabe.jahr,
      teilgebietId: springerDialog.id,
      mitarbeiterId: springerMitarbeiterId,
      typ: 'springer',
      springerZuschlagProzent: springerZuschlag ? parseFloat(springerZuschlag) : undefined,
    });
    const updated = await ladeEinsaetze(selectedAusgabe.id);
    const map: EinsatzMap = {};
    for (const e of updated) map[e.teilgebietId] = e;
    setEinsaetze(map);
    setSpringerDialog(null);
  }

  // Statistiken
  const stats = aktiveTeilgebiete.reduce(
    (acc, tg) => {
      const e = einsaetze[tg.id];
      if (!e) acc.standard++;
      else if (e.typ === 'springer') acc.springer++;
      else if (e.typ === 'ausfall') acc.ausfall++;
      else if (e.typ === 'ungeklärt') acc.ungeklaert++;
      return acc;
    },
    { standard: 0, springer: 0, ausfall: 0, ungeklaert: 0 }
  );

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Einsätze</h1>

      {/* Ausgabe auswählen */}
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
                {kwLabel(a.kw, a.jahr)} — {a.seitenzahl} S.
              </option>
            ))}
          </select>

          {/* Statistik-Badges */}
          {!loading && (
            <div className="flex gap-2 flex-wrap ml-auto">
              <StatBadge label="Standard" count={stats.standard} farbe="bg-gray-100 text-gray-700" />
              <StatBadge label="Springer" count={stats.springer} farbe="bg-blue-100 text-blue-700" />
              <StatBadge label="Ausfall" count={stats.ausfall} farbe="bg-red-100 text-red-700" />
              <StatBadge label="Ungeklärt" count={stats.ungeklaert} farbe="bg-yellow-100 text-yellow-700" />
            </div>
          )}
        </div>
      </div>

      {/* Tabelle */}
      {loading ? (
        <div className="text-center py-12 text-gray-500">Lade Einsätze...</div>
      ) : !selectedAusgabe ? (
        <div className="text-center py-12 text-gray-400">Keine Ausgabe ausgewählt</div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Teilgebiet</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Tour</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Standardausträger</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Status</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Austräger</th>
                <th className="px-4 py-3 text-right font-medium text-gray-600">Aktion</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {aktiveTeilgebiete.map((tg) => {
                const einsatz = einsaetze[tg.id];
                const standardMA = getMitarbeiter(tg.standardAustraegerId);
                const tour = getTour(tg.tourId);
                const springerMA = einsatz?.typ === 'springer'
                  ? getMitarbeiter(einsatz.mitarbeiterId)
                  : undefined;

                return (
                  <tr key={tg.id} className="hover:bg-gray-50 transition-colors">
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
                      ) : (
                        <span className="text-gray-300 text-xs">—</span>
                      )}
                    </td>

                    {/* Standardausträger */}
                    <td className="px-4 py-3 text-gray-700">
                      {standardMA ? standardMA.name : <span className="text-gray-300">—</span>}
                    </td>

                    {/* Status-Badge */}
                    <td className="px-4 py-3">
                      <EinsatzBadge einsatz={einsatz} />
                    </td>

                    {/* Aktueller Austräger */}
                    <td className="px-4 py-3 text-gray-700">
                      {!einsatz || einsatz.typ === 'standard' ? (
                        <span className="text-gray-400 text-xs">Standard</span>
                      ) : einsatz.typ === 'springer' ? (
                        <span className="font-medium text-blue-700">
                          {springerMA?.name ?? '?'}
                          {einsatz.springerZuschlagProzent != null && (
                            <span className="text-xs text-blue-400 ml-1">+{einsatz.springerZuschlagProzent}%</span>
                          )}
                        </span>
                      ) : (
                        <span className="text-gray-400 text-xs">—</span>
                      )}
                    </td>

                    {/* Aktionen */}
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => oeffneSpringerDialog(tg)}
                          className="text-xs px-2 py-1 rounded bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors"
                          title="Springer einsetzen"
                        >
                          Springer
                        </button>
                        <button
                          onClick={() => handleSetzeAusfall(tg)}
                          className="text-xs px-2 py-1 rounded bg-red-50 text-red-700 hover:bg-red-100 transition-colors"
                          title="Als Ausfall markieren"
                        >
                          Ausfall
                        </button>
                        <button
                          onClick={() => handleSetzeUngeklaert(tg)}
                          className="text-xs px-2 py-1 rounded bg-yellow-50 text-yellow-700 hover:bg-yellow-100 transition-colors"
                          title="Als ungeklärt markieren"
                        >
                          ?
                        </button>
                        {einsatz && (
                          <button
                            onClick={() => handleResetStandard(tg)}
                            className="text-xs px-2 py-1 rounded bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors"
                            title="Auf Standardausträger zurücksetzen"
                          >
                            ↩
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Springer-Dialog */}
      <Modal
        isOpen={springerDialog !== null}
        onClose={() => setSpringerDialog(null)}
        title={`Springer für ${springerDialog?.name ?? ''}`}
        size="md"
      >
        {springerDialog && (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Mitarbeiter suchen
              </label>
              <input
                type="text"
                placeholder="Name oder Nummer..."
                value={springerFilter}
                onChange={(e) => setSpringerFilter(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                autoFocus
              />
            </div>

            <div className="max-h-48 overflow-y-auto border border-gray-200 rounded-lg divide-y divide-gray-100">
              {mitarbeiter
                .filter((m) => m.isActive && m.rollen.includes('austräger'))
                .filter((m) =>
                  m.name.toLowerCase().includes(springerFilter.toLowerCase()) ||
                  m.nummer.includes(springerFilter)
                )
                .map((m) => (
                  <button
                    key={m.id}
                    onClick={() => setSpringerMitarbeiterId(m.id)}
                    className={`w-full flex items-center justify-between px-3 py-2 text-sm transition-colors ${
                      springerMitarbeiterId === m.id
                        ? 'bg-blue-50 text-blue-700'
                        : 'hover:bg-gray-50 text-gray-800'
                    }`}
                  >
                    <span className="font-medium">{m.name}</span>
                    <span className="text-gray-400">{m.nummer}</span>
                  </button>
                ))}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Springerzuschlag % (leer = Standard aus Parametern)
              </label>
              <input
                type="number"
                min="0"
                max="100"
                placeholder="z.B. 25"
                value={springerZuschlag}
                onChange={(e) => setSpringerZuschlag(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div className="flex gap-2 pt-2">
              <button
                onClick={handleSpringerSpeichern}
                disabled={!springerMitarbeiterId}
                className="flex-1 bg-blue-600 text-white py-2 rounded-lg font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Springer speichern
              </button>
              <button
                onClick={() => setSpringerDialog(null)}
                className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors text-sm"
              >
                Abbrechen
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

function EinsatzBadge({ einsatz }: { einsatz: Einsatz | undefined }) {
  if (!einsatz || einsatz.typ === 'standard') {
    return (
      <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
        Standard
      </span>
    );
  }
  if (einsatz.typ === 'springer') {
    return (
      <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 font-medium">
        Springer
      </span>
    );
  }
  if (einsatz.typ === 'ausfall') {
    return (
      <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700 font-medium">
        Ausfall
      </span>
    );
  }
  return (
    <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-700 font-medium">
      Ungeklärt
    </span>
  );
}

function StatBadge({
  label,
  count,
  farbe,
}: {
  label: string;
  count: number;
  farbe: string;
}) {
  return (
    <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${farbe}`}>
      {label}: {count}
    </span>
  );
}
