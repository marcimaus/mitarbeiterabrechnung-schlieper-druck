import { useState, useEffect, type FormEvent } from 'react';
import { useApp } from '../context/AppContext';
import AdminPinGate from '../components/AdminPinGate';
import Modal from '../components/Modal';
import { erstelleTour, aktualisiereTour } from '../lib/db';
import type { Tour } from '../types';
import { STANDARD_TOUREN } from '../types';

export default function TourenScreen() {
  return (
    <AdminPinGate allowedRoles={['admin', 'abrechnung']}>
      <TourenInhalt />
    </AdminPinGate>
  );
}

function TourenInhalt() {
  const { touren, teilgebiete, userRole } = useApp();
  // Abrechnung-Rolle: nur lesender Zugriff.
  const isAdmin = userRole === 'admin';
  const [showForm, setShowForm] = useState(false);
  const [editTarget, setEditTarget] = useState<Tour | null>(null);
  const [selectedTourId, setSelectedTourId] = useState<string | null>(
    touren.length > 0 ? touren[0].id : null
  );

  useEffect(() => {
    if (touren.length > 0 && !selectedTourId) {
      setSelectedTourId(touren[0].id);
    }
  }, [touren, selectedTourId]);

  async function initialisierStandardTouren() {
    if (!confirm('Standard-Touren (rot, blau, gelb, weiß, grün) anlegen?')) return;
    for (const tour of STANDARD_TOUREN) {
      await erstelleTour({ name: tour.name, farbe: tour.farbe });
    }
  }

  const selectedTour = touren.find((t) => t.id === selectedTourId);
  const teilgebieteDerTour = teilgebiete.filter(
    (tg) => tg.tourId === selectedTourId && tg.isActive
  );
  const ohneZuordnung = teilgebiete.filter(
    (tg) => !tg.tourId && tg.isActive
  );

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Touren</h1>
          <p className="text-gray-500 text-sm">{touren.length} Touren angelegt</p>
        </div>
        {isAdmin && (
          <div className="flex gap-2">
            {touren.length === 0 && (
              <button
                onClick={initialisierStandardTouren}
                className="border border-blue-600 text-blue-600 px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-50 transition-colors"
              >
                Standard-Touren anlegen
              </button>
            )}
            <button
              onClick={() => { setEditTarget(null); setShowForm(true); }}
              className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
            >
              + Neue Tour
            </button>
          </div>
        )}
      </div>

      <div className="flex gap-6">
        {/* Tour-Liste links */}
        <div className="w-56 shrink-0">
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            {touren.length === 0 && (
              <div className="p-4 text-center text-gray-400 text-sm">
                Keine Touren angelegt
              </div>
            )}
            {touren.map((tour) => (
              <button
                key={tour.id}
                onClick={() => setSelectedTourId(tour.id)}
                className={`w-full flex items-center gap-3 px-4 py-3 text-sm border-b border-gray-100 last:border-0 transition-colors ${
                  selectedTourId === tour.id
                    ? 'bg-blue-50 text-blue-700 font-medium'
                    : 'hover:bg-gray-50 text-gray-700'
                }`}
              >
                <span
                  className="w-3 h-3 rounded-full shrink-0"
                  style={{ backgroundColor: tour.farbe }}
                />
                <span className="flex-1 text-left">{tour.name}</span>
                <span className="text-xs text-gray-400">
                  {teilgebiete.filter((tg) => tg.tourId === tour.id && tg.isActive).length}
                </span>
              </button>
            ))}
          </div>

          {ohneZuordnung.length > 0 && (
            <div className="mt-3 bg-amber-50 rounded-lg border border-amber-200 p-3">
              <p className="text-xs text-amber-700 font-medium mb-1">
                ⚠ {ohneZuordnung.length} Gebiete ohne Tour
              </p>
              {ohneZuordnung.slice(0, 5).map((tg) => (
                <p key={tg.id} className="text-xs text-amber-600">{tg.name}</p>
              ))}
              {ohneZuordnung.length > 5 && (
                <p className="text-xs text-amber-500">...und {ohneZuordnung.length - 5} weitere</p>
              )}
            </div>
          )}
        </div>

        {/* Inhalt rechts */}
        <div className="flex-1">
          {selectedTour ? (
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
              <div className="flex items-center gap-3 mb-5">
                <span
                  className="w-5 h-5 rounded-full"
                  style={{ backgroundColor: selectedTour.farbe }}
                />
                <h2 className="font-semibold text-lg text-gray-900">{selectedTour.name}</h2>
                {isAdmin && (
                  <div className="flex gap-2 ml-auto">
                    <button
                      onClick={() => { setEditTarget(selectedTour); setShowForm(true); }}
                      className="text-sm text-blue-600 hover:text-blue-800"
                    >
                      Bearbeiten
                    </button>
                  </div>
                )}
              </div>

              {selectedTour.streckeFahrkostenKm != null && (
                <div className="mb-4 rounded-lg bg-blue-50 border border-blue-200 px-3 py-2 text-sm text-blue-900">
                  🚗 <span className="font-medium">Strecke (Fahrkosten):</span>{' '}
                  {selectedTour.streckeFahrkostenKm} km regelmäßig pro Auslieferung
                </div>
              )}

              <h3 className="text-sm font-medium text-gray-600 mb-3">
                Teilgebiete dieser Tour ({teilgebieteDerTour.length})
              </h3>

              {teilgebieteDerTour.length === 0 ? (
                <p className="text-gray-400 text-sm">Noch keine Teilgebiete zugeordnet.</p>
              ) : (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                  {teilgebieteDerTour.map((tg) => (
                    <div
                      key={tg.id}
                      className="border border-gray-200 rounded-lg p-3"
                    >
                      <div className="font-medium text-sm text-gray-800">{tg.name}</div>
                      <div className="text-xs text-gray-500 mt-1">
                        {tg.stueckzahl} Stk · {
                          tg.wegstreckeM >= 1000
                            ? `${(tg.wegstreckeM / 1000).toFixed(1)} km`
                            : `${tg.wegstreckeM} m`
                        }
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 text-center text-gray-400">
              Tour links auswählen
            </div>
          )}
        </div>
      </div>

      <Modal
        isOpen={showForm}
        onClose={() => setShowForm(false)}
        title={editTarget ? 'Tour bearbeiten' : 'Neue Tour'}
        size="sm"
      >
        <TourForm
          initial={editTarget}
          onSave={() => setShowForm(false)}
          onCancel={() => setShowForm(false)}
        />
      </Modal>
    </div>
  );
}

function TourForm({
  initial,
  onSave,
  onCancel,
}: {
  initial: Tour | null;
  onSave: () => void;
  onCancel: () => void;
}) {
  const { userRole } = useApp();
  const isAdmin = userRole === 'admin';
  const [name, setName] = useState(initial?.name ?? '');
  const [farbe, setFarbe] = useState(initial?.farbe ?? '#3b82f6');
  const [streckeKm, setStreckeKm] = useState<string>(
    initial?.streckeFahrkostenKm != null ? String(initial.streckeFahrkostenKm) : ''
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setError('Name ist erforderlich.'); return; }
    let streckeFahrkostenKm: number | undefined;
    if (streckeKm.trim()) {
      const n = parseInt(streckeKm.trim(), 10);
      if (!Number.isFinite(n) || n < 0) {
        setError('Strecke muss eine positive ganze Zahl sein.');
        return;
      }
      streckeFahrkostenKm = n;
    }
    setSaving(true);
    setError('');
    try {
      if (initial) {
        await aktualisiereTour(initial.id, { name, farbe, streckeFahrkostenKm });
      } else {
        await erstelleTour({ name, farbe, streckeFahrkostenKm });
      }
      onSave();
    } catch (err) {
      setError('Fehler beim Speichern.');
      console.error(err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="z.B. Lila"
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          autoFocus
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Farbe</label>
        <div className="flex items-center gap-3">
          <input
            type="color"
            value={farbe}
            onChange={(e) => setFarbe(e.target.value)}
            className="w-12 h-10 rounded cursor-pointer border border-gray-300"
          />
          <input
            type="text"
            value={farbe}
            onChange={(e) => setFarbe(e.target.value)}
            className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
          />
        </div>
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Strecke (Fahrkosten) in km
          {!isAdmin && (
            <span className="ml-1 text-xs text-gray-400 font-normal">— nur Admin</span>
          )}
        </label>
        <input
          type="number"
          min="0"
          step="1"
          value={streckeKm}
          onChange={(e) => setStreckeKm(e.target.value)}
          placeholder="z. B. 45"
          readOnly={!isAdmin}
          className={`w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${
            !isAdmin ? 'bg-gray-50 text-gray-600 cursor-not-allowed' : ''
          }`}
        />
        <p className="text-xs text-gray-400 mt-1">
          Regelmäßig gefahrene Strecke pro Tour. Wird in der Fahrtkosten-
          Erfassung summiert, sobald der Fahrer Touren statt Ziel auswählt.
        </p>
      </div>

      {error && <p className="text-red-600 text-sm">{error}</p>}

      <div className="flex justify-end gap-3 pt-2">
        <button type="button" onClick={onCancel} className="px-4 py-2 text-sm text-gray-600">
          Abbrechen
        </button>
        <button
          type="submit"
          disabled={saving}
          className="bg-blue-600 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          {saving ? 'Speichere...' : initial ? 'Speichern' : 'Erstellen'}
        </button>
      </div>
    </form>
  );
}
