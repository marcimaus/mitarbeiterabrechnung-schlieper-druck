import { useState, useEffect, type FormEvent } from 'react';
import { useApp } from '../context/AppContext';
import AdminPinGate from '../components/AdminPinGate';
import Modal from '../components/Modal';
import {
  abonniereReklamationen,
  erstelleReklamation,
  aktualisiereReklamation,
  loescheReklamation,
} from '../lib/db';
import type { Reklamation } from '../types';

const DEFAULT_FORM: Omit<Reklamation, 'id' | 'erstelltAm' | 'aktualisiertAm'> = {
  anruferName: '',
  telefon: '',
  email: '',
  briefkastenVorhanden: true,
  aufkleberKeineWerbung: false,
  anmerkung: '',
  teilgebietId: '',
  mitarbeiterId: '',
  mitgeteilt: false,
  seitWann: '',
  schonMalMitgeteilt: false,
};

const inputClass =
  'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';

export default function ReklamationenScreen() {
  return (
    <AdminPinGate allowedRoles={['admin', 'abrechnung']}>
      <ReklamationenInhalt />
    </AdminPinGate>
  );
}

function ReklamationenInhalt() {
  const { mitarbeiter, teilgebiete } = useApp();
  const [reklamationen, setReklamationen] = useState<Reklamation[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editTarget, setEditTarget] = useState<Reklamation | null>(null);
  const [filterMitgeteilt, setFilterMitgeteilt] = useState<'' | 'offen' | 'mitgeteilt'>('');

  useEffect(() => {
    const unsub = abonniereReklamationen(setReklamationen);
    return unsub;
  }, []);

  const gefiltert = reklamationen.filter((r) => {
    if (filterMitgeteilt === 'offen' && r.mitgeteilt) return false;
    if (filterMitgeteilt === 'mitgeteilt' && !r.mitgeteilt) return false;
    return true;
  });

  const getTg = (id?: string) => id ? (teilgebiete.find((t) => t.id === id)?.name ?? '?') : '—';
  const getMA = (id?: string) => id ? (mitarbeiter.find((m) => m.id === id)?.name ?? '?') : '—';

  async function toggleMitgeteilt(r: Reklamation) {
    await aktualisiereReklamation(r.id, { mitgeteilt: !r.mitgeteilt });
  }

  return (
    <div className="p-4 md:p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Reklamationen</h1>
          <p className="text-gray-500 text-sm">
            {reklamationen.filter((r) => !r.mitgeteilt).length} offen ·{' '}
            {reklamationen.length} gesamt
          </p>
        </div>
        <button
          onClick={() => { setEditTarget(null); setShowForm(true); }}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
        >
          + Neue Reklamation
        </button>
      </div>

      {/* Filter */}
      <div className="flex gap-3 mb-4 flex-wrap">
        {(['', 'offen', 'mitgeteilt'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilterMitgeteilt(f)}
            className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${
              filterMitgeteilt === f
                ? 'bg-blue-600 text-white border-blue-600'
                : 'bg-white text-gray-600 border-gray-300 hover:border-gray-400'
            }`}
          >
            {f === '' ? 'Alle' : f === 'offen' ? 'Offen' : 'Mitgeteilt'}
          </button>
        ))}
      </div>

      {/* Tabelle */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Datum</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Anrufer</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Teilgebiet</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Austräger</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Hinweise</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Status</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {gefiltert.length === 0 && (
              <tr>
                <td colSpan={7} className="text-center py-8 text-gray-400">
                  Keine Reklamationen gefunden
                </td>
              </tr>
            )}
            {gefiltert.map((r) => (
              <tr key={r.id} className={`hover:bg-gray-50 ${!r.mitgeteilt ? 'bg-red-50/30' : ''}`}>
                <td className="px-4 py-3 text-gray-500 text-xs">
                  {new Date(r.erstelltAm).toLocaleDateString('de-DE')}
                </td>
                <td className="px-4 py-3">
                  <div className="font-medium text-gray-900">{r.anruferName}</div>
                  {r.telefon && <div className="text-xs text-gray-500">{r.telefon}</div>}
                </td>
                <td className="px-4 py-3 text-gray-600">{getTg(r.teilgebietId)}</td>
                <td className="px-4 py-3 text-gray-600">{getMA(r.mitarbeiterId)}</td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1">
                    {!r.briefkastenVorhanden && (
                      <span className="text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">Kein BK</span>
                    )}
                    {r.aufkleberKeineWerbung && (
                      <span className="text-xs bg-red-100 text-red-700 px-1.5 py-0.5 rounded">Aufkleber</span>
                    )}
                    {r.schonMalMitgeteilt && (
                      <span className="text-xs bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded">Wiederholt</span>
                    )}
                    {r.seitWann && (
                      <span className="text-xs text-gray-400">seit {new Date(r.seitWann).toLocaleDateString('de-DE')}</span>
                    )}
                  </div>
                  {r.anmerkung && (
                    <div className="text-xs text-gray-500 mt-0.5 truncate max-w-[16rem]" title={r.anmerkung}>
                      {r.anmerkung}
                    </div>
                  )}
                </td>
                <td className="px-4 py-3">
                  <button
                    onClick={() => toggleMitgeteilt(r)}
                    className={`text-xs px-2 py-1 rounded-full font-medium transition-colors ${
                      r.mitgeteilt
                        ? 'bg-green-100 text-green-700 hover:bg-green-200'
                        : 'bg-amber-100 text-amber-700 hover:bg-amber-200'
                    }`}
                  >
                    {r.mitgeteilt ? '✓ Mitgeteilt' : 'Offen'}
                  </button>
                </td>
                <td className="px-4 py-3">
                  <div className="flex gap-2">
                    <button
                      onClick={() => { setEditTarget(r); setShowForm(true); }}
                      className="text-blue-600 hover:text-blue-800 text-xs font-medium"
                    >
                      Bearbeiten
                    </button>
                    <button
                      onClick={async () => {
                        if (confirm('Reklamation wirklich löschen?')) {
                          await loescheReklamation(r.id);
                        }
                      }}
                      className="text-red-400 hover:text-red-600 text-xs"
                    >
                      Löschen
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal
        isOpen={showForm}
        onClose={() => setShowForm(false)}
        title={editTarget ? 'Reklamation bearbeiten' : 'Neue Reklamation erfassen'}
        size="lg"
      >
        <ReklamationForm
          initial={editTarget}
          onSave={() => setShowForm(false)}
          onCancel={() => setShowForm(false)}
        />
      </Modal>
    </div>
  );
}

function ReklamationForm({
  initial,
  onSave,
  onCancel,
}: {
  initial: Reklamation | null;
  onSave: () => void;
  onCancel: () => void;
}) {
  const { mitarbeiter, teilgebiete } = useApp();
  const [form, setForm] = useState<typeof DEFAULT_FORM>(() =>
    initial
      ? {
          anruferName: initial.anruferName,
          telefon: initial.telefon ?? '',
          email: initial.email ?? '',
          briefkastenVorhanden: initial.briefkastenVorhanden,
          aufkleberKeineWerbung: initial.aufkleberKeineWerbung,
          anmerkung: initial.anmerkung ?? '',
          teilgebietId: initial.teilgebietId ?? '',
          mitarbeiterId: initial.mitarbeiterId ?? '',
          mitgeteilt: initial.mitgeteilt,
          seitWann: initial.seitWann ?? '',
          schonMalMitgeteilt: initial.schonMalMitgeteilt,
        }
      : { ...DEFAULT_FORM }
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const austraeger = mitarbeiter.filter((m) => m.isActive && m.rollen.includes('austräger'));

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!form.anruferName.trim()) { setError('Name des Anrufers ist erforderlich.'); return; }
    setSaving(true);
    setError('');
    try {
      const payload = {
        ...form,
        telefon: form.telefon || undefined,
        email: form.email || undefined,
        anmerkung: form.anmerkung || undefined,
        teilgebietId: form.teilgebietId || undefined,
        mitarbeiterId: form.mitarbeiterId || undefined,
        seitWann: form.seitWann || undefined,
      };
      if (initial) {
        await aktualisiereReklamation(initial.id, payload);
      } else {
        await erstelleReklamation(payload);
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
      {/* Anrufer */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Name des Anrufers *</label>
          <input
            type="text"
            value={form.anruferName}
            onChange={(e) => setForm((f) => ({ ...f, anruferName: e.target.value }))}
            placeholder="Max Mustermann"
            className={inputClass}
            autoFocus
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Telefon</label>
          <input
            type="tel"
            value={form.telefon ?? ''}
            onChange={(e) => setForm((f) => ({ ...f, telefon: e.target.value }))}
            placeholder="+49 5571 12345"
            className={inputClass}
          />
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">E-Mail</label>
        <input
          type="email"
          value={form.email ?? ''}
          onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
          placeholder="max@beispiel.de"
          className={inputClass}
        />
      </div>

      {/* Briefkasten & Aufkleber */}
      <div className="grid grid-cols-2 gap-4">
        <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer p-3 border border-gray-200 rounded-lg hover:bg-gray-50">
          <input
            type="checkbox"
            checked={form.briefkastenVorhanden}
            onChange={(e) => setForm((f) => ({ ...f, briefkastenVorhanden: e.target.checked }))}
            className="rounded"
          />
          Briefkasten vorhanden
        </label>
        <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer p-3 border border-gray-200 rounded-lg hover:bg-gray-50">
          <input
            type="checkbox"
            checked={form.aufkleberKeineWerbung}
            onChange={(e) => setForm((f) => ({ ...f, aufkleberKeineWerbung: e.target.checked }))}
            className="rounded"
          />
          Aufkleber „Keine Werbung"
        </label>
      </div>

      {/* Zuordnung */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Teilgebiet</label>
          <select
            value={form.teilgebietId ?? ''}
            onChange={(e) => setForm((f) => ({ ...f, teilgebietId: e.target.value }))}
            className={inputClass}
          >
            <option value="">— Kein Teilgebiet —</option>
            {[...teilgebiete]
              .filter((t) => t.isActive)
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((t) => (
                <option key={t.id} value={t.id}>{t.name} {t.plz ? `(${t.plz})` : ''}</option>
              ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Austräger</label>
          <select
            value={form.mitarbeiterId ?? ''}
            onChange={(e) => setForm((f) => ({ ...f, mitarbeiterId: e.target.value }))}
            className={inputClass}
          >
            <option value="">— Kein Austräger —</option>
            {[...austraeger]
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((m) => (
                <option key={m.id} value={m.id}>{m.name} ({m.nummer})</option>
              ))}
          </select>
        </div>
      </div>

      {/* Zeitangaben */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Problem bekannt seit</label>
          <input
            type="date"
            value={form.seitWann ?? ''}
            onChange={(e) => setForm((f) => ({ ...f, seitWann: e.target.value }))}
            className={inputClass}
          />
        </div>
        <div className="flex flex-col gap-2 justify-end">
          <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer p-3 border border-gray-200 rounded-lg hover:bg-gray-50">
            <input
              type="checkbox"
              checked={form.schonMalMitgeteilt}
              onChange={(e) => setForm((f) => ({ ...f, schonMalMitgeteilt: e.target.checked }))}
              className="rounded"
            />
            Schon mal mitgeteilt
          </label>
        </div>
      </div>

      {/* Anmerkung */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Anmerkung</label>
        <textarea
          value={form.anmerkung ?? ''}
          onChange={(e) => setForm((f) => ({ ...f, anmerkung: e.target.value }))}
          rows={3}
          placeholder="Details zur Reklamation..."
          className={inputClass + ' resize-none'}
        />
      </div>

      {/* Mitgeteilt */}
      <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer p-3 border border-gray-200 rounded-lg hover:bg-gray-50">
        <input
          type="checkbox"
          checked={form.mitgeteilt}
          onChange={(e) => setForm((f) => ({ ...f, mitgeteilt: e.target.checked }))}
          className="rounded"
        />
        Dem Mitarbeiter mitgeteilt
      </label>

      {error && <p className="text-red-600 text-sm">{error}</p>}

      <div className="flex justify-end gap-3 pt-2">
        <button type="button" onClick={onCancel} className="px-4 py-2 text-sm text-gray-600">
          Abbrechen
        </button>
        <button
          type="submit"
          disabled={saving}
          className="bg-blue-600 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? 'Speichere...' : initial ? 'Speichern' : 'Erfassen'}
        </button>
      </div>
    </form>
  );
}
