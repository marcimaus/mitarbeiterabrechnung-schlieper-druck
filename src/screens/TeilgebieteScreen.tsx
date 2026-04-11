import { useState, type FormEvent } from 'react';
import { useApp } from '../context/AppContext';
import AdminPinGate from '../components/AdminPinGate';
import Modal from '../components/Modal';
import { erstelleTeilgebiet, aktualisiereTeilgebiet } from '../lib/db';
import type { Teilgebiet } from '../types';

const DEFAULT_FORM: Omit<Teilgebiet, 'id' | 'erstelltAm' | 'aktualisiertAm'> = {
  name: '',
  plz: '',
  stueckzahl: 0,
  wegstreckeM: 0,
  tourId: null,
  standardAustraegerId: null,
  isActive: true,
};

export default function TeilgebieteScreen() {
  return (
    <AdminPinGate>
      <TeilgebieteInhalt />
    </AdminPinGate>
  );
}

function TeilgebieteInhalt() {
  const { teilgebiete, touren, mitarbeiter } = useApp();
  const [showForm, setShowForm] = useState(false);
  const [editTarget, setEditTarget] = useState<Teilgebiet | null>(null);
  const [filterText, setFilterText] = useState('');
  const [filterTour, setFilterTour] = useState('');
  const [nurAktive, setNurAktive] = useState(true);

  const gefiltert = teilgebiete.filter((tg) => {
    if (nurAktive && !tg.isActive) return false;
    if (filterText && !tg.name.toLowerCase().includes(filterText.toLowerCase()) &&
        !tg.plz.includes(filterText)) return false;
    if (filterTour && tg.tourId !== filterTour) return false;
    return true;
  });

  const getTourName = (id: string | null) => {
    if (!id) return '—';
    return touren.find((t) => t.id === id)?.name ?? '?';
  };

  const getTourFarbe = (id: string | null) => {
    if (!id) return '#9ca3af';
    return touren.find((t) => t.id === id)?.farbe ?? '#9ca3af';
  };

  const getAustraeger = (id: string | null) => {
    if (!id) return '—';
    return mitarbeiter.find((m) => m.id === id)?.name ?? '?';
  };

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Teilgebiete</h1>
          <p className="text-gray-500 text-sm">
            {teilgebiete.filter((t) => t.isActive).length} aktive Gebiete
          </p>
        </div>
        <button
          onClick={() => { setEditTarget(null); setShowForm(true); }}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
        >
          + Neues Teilgebiet
        </button>
      </div>

      {/* Filter */}
      <div className="flex flex-wrap gap-3 mb-4">
        <input
          type="text"
          placeholder="Name oder PLZ suchen..."
          value={filterText}
          onChange={(e) => setFilterText(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-52"
        />
        <select
          value={filterTour}
          onChange={(e) => setFilterTour(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">Alle Touren</option>
          <option value="__keine__">Ohne Tour</option>
          {touren.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
          <input
            type="checkbox"
            checked={nurAktive}
            onChange={(e) => setNurAktive(e.target.checked)}
            className="rounded"
          />
          Nur aktive
        </label>
      </div>

      {/* Tabelle */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Name</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">PLZ</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Stück</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Wegstrecke</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Tour</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Standardausträger</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {gefiltert.length === 0 && (
              <tr>
                <td colSpan={7} className="text-center py-8 text-gray-400">
                  Keine Teilgebiete gefunden
                </td>
              </tr>
            )}
            {gefiltert.map((tg) => (
              <tr key={tg.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-medium text-gray-900">{tg.name}</td>
                <td className="px-4 py-3 text-gray-600">{tg.plz}</td>
                <td className="px-4 py-3 text-gray-600">{tg.stueckzahl.toLocaleString('de-DE')}</td>
                <td className="px-4 py-3 text-gray-600">
                  {tg.wegstreckeM >= 1000
                    ? `${(tg.wegstreckeM / 1000).toFixed(1)} km`
                    : `${tg.wegstreckeM} m`}
                </td>
                <td className="px-4 py-3">
                  {tg.tourId ? (
                    <span
                      className="text-xs px-2 py-0.5 rounded-full text-white font-medium"
                      style={{ backgroundColor: getTourFarbe(tg.tourId) }}
                    >
                      {getTourName(tg.tourId)}
                    </span>
                  ) : (
                    <span className="text-gray-400 text-xs">—</span>
                  )}
                </td>
                <td className="px-4 py-3 text-gray-600 text-sm">
                  {getAustraeger(tg.standardAustraegerId)}
                </td>
                <td className="px-4 py-3">
                  <button
                    onClick={() => { setEditTarget(tg); setShowForm(true); }}
                    className="text-blue-600 hover:text-blue-800 text-xs font-medium"
                  >
                    Bearbeiten
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal
        isOpen={showForm}
        onClose={() => setShowForm(false)}
        title={editTarget ? 'Teilgebiet bearbeiten' : 'Neues Teilgebiet'}
        size="md"
      >
        <TeilgebietForm
          initial={editTarget}
          onSave={() => setShowForm(false)}
          onCancel={() => setShowForm(false)}
        />
      </Modal>
    </div>
  );
}

function TeilgebietForm({
  initial,
  onSave,
  onCancel,
}: {
  initial: Teilgebiet | null;
  onSave: () => void;
  onCancel: () => void;
}) {
  const { touren, mitarbeiter } = useApp();
  const [form, setForm] = useState<typeof DEFAULT_FORM>(() =>
    initial
      ? {
          name: initial.name,
          plz: initial.plz,
          stueckzahl: initial.stueckzahl,
          wegstreckeM: initial.wegstreckeM,
          tourId: initial.tourId,
          standardAustraegerId: initial.standardAustraegerId,
          isActive: initial.isActive,
        }
      : { ...DEFAULT_FORM }
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const austraeger = mitarbeiter.filter(
    (m) => m.isActive && m.rollen.includes('austräger')
  );

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) { setError('Name ist erforderlich.'); return; }
    if (form.stueckzahl <= 0) { setError('Stückzahl muss größer als 0 sein.'); return; }
    setSaving(true);
    setError('');
    try {
      if (initial) {
        await aktualisiereTeilgebiet(initial.id, form);
      } else {
        await erstelleTeilgebiet(form);
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
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
          <input
            type="text"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            placeholder="Uslar1"
            className={inputClass}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">PLZ</label>
          <input
            type="text"
            value={form.plz}
            onChange={(e) => setForm((f) => ({ ...f, plz: e.target.value }))}
            placeholder="37170"
            maxLength={5}
            className={inputClass}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Stückzahl *</label>
          <input
            type="number"
            min="1"
            value={form.stueckzahl || ''}
            onChange={(e) => setForm((f) => ({ ...f, stueckzahl: parseInt(e.target.value) || 0 }))}
            placeholder="450"
            className={inputClass}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Wegstrecke (Meter)</label>
          <input
            type="number"
            min="0"
            value={form.wegstreckeM || ''}
            onChange={(e) => setForm((f) => ({ ...f, wegstreckeM: parseInt(e.target.value) || 0 }))}
            placeholder="2500"
            className={inputClass}
          />
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Tour</label>
        <select
          value={form.tourId ?? ''}
          onChange={(e) => setForm((f) => ({ ...f, tourId: e.target.value || null }))}
          className={inputClass}
        >
          <option value="">Keine Tour</option>
          {touren.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Standardausträger</label>
        <select
          value={form.standardAustraegerId ?? ''}
          onChange={(e) => setForm((f) => ({ ...f, standardAustraegerId: e.target.value || null }))}
          className={inputClass}
        >
          <option value="">Kein Standardausträger</option>
          {austraeger.map((m) => (
            <option key={m.id} value={m.id}>{m.name} ({m.nummer})</option>
          ))}
        </select>
      </div>

      <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
        <input
          type="checkbox"
          checked={form.isActive}
          onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))}
          className="rounded"
        />
        Teilgebiet aktiv
      </label>

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

const inputClass =
  'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';
