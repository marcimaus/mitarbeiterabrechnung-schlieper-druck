import { useState, type FormEvent } from 'react';
import { useApp } from '../context/AppContext';
import AdminPinGate from '../components/AdminPinGate';
import Modal from '../components/Modal';
import {
  erstelleMitarbeiter,
  aktualisiereMitarbeiter,
  deaktiviereMitarbeiter,
} from '../lib/db';
import { beschreibeNfcTag, nfcVerfuegbar } from '../lib/zeiterfassung';
import type { Mitarbeiter, Rolle, Abrechnungstyp } from '../types';
import { ROLLEN_LABELS } from '../types';
import { berechneAlter } from '../lib/berechnung';

const ALLE_ROLLEN = Object.keys(ROLLEN_LABELS) as Rolle[];

const DEFAULT_FORM: Omit<Mitarbeiter, 'id' | 'erstelltAm' | 'aktualisiertAm' | 'pinHash' | 'nfcUid'> = {
  nummer: '',
  name: '',
  adresse: { strasse: '', plz: '', ort: '' },
  telefon: '',
  geburtsdatum: '',
  rollen: [],
  abrechnungstyp: 'variabel',
  isActive: true,
};

export default function MitarbeiterScreen() {
  return (
    <AdminPinGate>
      <MitarbeiterInhalt />
    </AdminPinGate>
  );
}

function MitarbeiterInhalt() {
  const { mitarbeiter, parameter } = useApp();
  const [showForm, setShowForm] = useState(false);
  const [editTarget, setEditTarget] = useState<Mitarbeiter | null>(null);
  const [filterText, setFilterText] = useState('');
  const [filterRolle, setFilterRolle] = useState<Rolle | ''>('');
  const [nurAktive, setNurAktive] = useState(true);

  const gefiltert = mitarbeiter.filter((m) => {
    if (nurAktive && !m.isActive) return false;
    if (filterText && !m.name.toLowerCase().includes(filterText.toLowerCase()) &&
        !m.nummer.includes(filterText)) return false;
    if (filterRolle && !m.rollen.includes(filterRolle)) return false;
    return true;
  });

  function oeffneNeu() {
    setEditTarget(null);
    setShowForm(true);
  }

  function oeffneBearbeiten(m: Mitarbeiter) {
    setEditTarget(m);
    setShowForm(true);
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Mitarbeiter</h1>
          <p className="text-gray-500 text-sm">{mitarbeiter.filter(m=>m.isActive).length} aktive Mitarbeiter</p>
        </div>
        <button
          onClick={oeffneNeu}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
        >
          + Neuer Mitarbeiter
        </button>
      </div>

      {/* Filter */}
      <div className="flex flex-wrap gap-3 mb-4">
        <input
          type="text"
          placeholder="Name oder Nummer suchen..."
          value={filterText}
          onChange={(e) => setFilterText(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-52"
        />
        <select
          value={filterRolle}
          onChange={(e) => setFilterRolle(e.target.value as Rolle | '')}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">Alle Rollen</option>
          {ALLE_ROLLEN.map((r) => (
            <option key={r} value={r}>{ROLLEN_LABELS[r]}</option>
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
              <th className="text-left px-4 py-3 font-medium text-gray-600">Nr.</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Name</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Rollen</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Alter</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Abrechnung</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Status</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {gefiltert.length === 0 && (
              <tr>
                <td colSpan={7} className="text-center py-8 text-gray-400">
                  Keine Mitarbeiter gefunden
                </td>
              </tr>
            )}
            {gefiltert.map((m) => {
              const alter = m.geburtsdatum ? berechneAlter(m.geburtsdatum) : null;
              const minderjährig = alter !== null && alter < 18;
              return (
                <tr key={m.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-mono text-gray-500">{m.nummer}</td>
                  <td className="px-4 py-3 font-medium text-gray-900">{m.name}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {m.rollen.map((r) => (
                        <span
                          key={r}
                          className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full"
                        >
                          {ROLLEN_LABELS[r]}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    {alter !== null ? (
                      <span className={minderjährig ? 'text-orange-600 font-medium' : ''}>
                        {alter} J.{minderjährig ? ' ⚠' : ''}
                      </span>
                    ) : '—'}
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    <span className="text-xs bg-gray-100 px-2 py-0.5 rounded">
                      {m.abrechnungstyp === 'fix' ? 'Fix' :
                       m.abrechnungstyp === 'variabel' ? 'Variabel' : 'Fix + Variabel'}
                    </span>
                    {m.stundenlohnIndividuell !== undefined && (
                      <span className="ml-1 text-xs text-gray-400">
                        ({m.stundenlohnIndividuell.toFixed(2)} €/h)
                      </span>
                    )}
                    {m.stundenlohnIndividuell === undefined && parameter && (
                      <span className="ml-1 text-xs text-gray-400">
                        (MiLoG)
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      m.isActive
                        ? 'bg-green-100 text-green-700'
                        : 'bg-gray-100 text-gray-500'
                    }`}>
                      {m.isActive ? 'Aktiv' : 'Inaktiv'}
                    </span>
                  </td>
                  <td className="px-4 py-3 flex items-center gap-3">
                    <button
                      onClick={() => oeffneBearbeiten(m)}
                      className="text-blue-600 hover:text-blue-800 text-xs font-medium"
                    >
                      Bearbeiten
                    </button>
                    <NfcSchreibenButton mitarbeiterId={m.id} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Modal */}
      <Modal
        isOpen={showForm}
        onClose={() => setShowForm(false)}
        title={editTarget ? 'Mitarbeiter bearbeiten' : 'Neuer Mitarbeiter'}
        size="lg"
      >
        <MitarbeiterForm
          initial={editTarget}
          onSave={() => setShowForm(false)}
          onCancel={() => setShowForm(false)}
        />
      </Modal>
    </div>
  );
}

// ---- Formular ----------------------------------------------

function MitarbeiterForm({
  initial,
  onSave,
  onCancel,
}: {
  initial: Mitarbeiter | null;
  onSave: () => void;
  onCancel: () => void;
}) {
  const { parameter } = useApp();
  const [form, setForm] = useState<typeof DEFAULT_FORM>(() => {
    if (initial) {
      return {
        nummer: initial.nummer,
        name: initial.name,
        adresse: { ...initial.adresse },
        telefon: initial.telefon,
        geburtsdatum: initial.geburtsdatum,
        rollen: [...initial.rollen],
        abrechnungstyp: initial.abrechnungstyp,
        fixesGehalt: initial.fixesGehalt,
        stundenlohnIndividuell: initial.stundenlohnIndividuell,
        isActive: initial.isActive,
      };
    }
    return { ...DEFAULT_FORM, adresse: { strasse: '', plz: '', ort: '' }, rollen: [] };
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  function toggleRolle(rolle: Rolle) {
    setForm((f) => ({
      ...f,
      rollen: f.rollen.includes(rolle)
        ? f.rollen.filter((r) => r !== rolle)
        : [...f.rollen, rolle],
    }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) { setError('Name ist erforderlich.'); return; }
    if (!form.nummer.trim()) { setError('Mitarbeiternummer ist erforderlich.'); return; }
    if (form.rollen.length === 0) { setError('Mindestens eine Rolle muss ausgewählt werden.'); return; }

    setSaving(true);
    setError('');
    try {
      if (initial) {
        await aktualisiereMitarbeiter(initial.id, form);
      } else {
        await erstelleMitarbeiter(form);
      }
      onSave();
    } catch (err) {
      setError('Fehler beim Speichern. Bitte erneut versuchen.');
      console.error(err);
    } finally {
      setSaving(false);
    }
  }

  async function handleDeaktivieren() {
    if (!initial || !confirm(`Mitarbeiter "${initial.name}" wirklich deaktivieren?`)) return;
    await deaktiviereMitarbeiter(initial.id);
    onSave();
  }

  const alter = form.geburtsdatum ? berechneAlter(form.geburtsdatum) : null;
  const minderjährig = alter !== null && alter < 18;

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="grid grid-cols-2 gap-4">
        <FormField label="Mitarbeiternummer *" hint="5-stellig, beginnt mit 9">
          <input
            type="text"
            value={form.nummer}
            onChange={(e) => setForm((f) => ({ ...f, nummer: e.target.value }))}
            maxLength={5}
            placeholder="90001"
            className={inputClass}
          />
        </FormField>
        <FormField label="Name *">
          <input
            type="text"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            placeholder="Max Mustermann"
            className={inputClass}
          />
        </FormField>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="col-span-2">
          <FormField label="Straße & Hausnummer">
            <input
              type="text"
              value={form.adresse.strasse}
              onChange={(e) => setForm((f) => ({ ...f, adresse: { ...f.adresse, strasse: e.target.value } }))}
              placeholder="Musterstraße 1"
              className={inputClass}
            />
          </FormField>
        </div>
        <FormField label="PLZ">
          <input
            type="text"
            value={form.adresse.plz}
            onChange={(e) => setForm((f) => ({ ...f, adresse: { ...f.adresse, plz: e.target.value } }))}
            placeholder="37170"
            maxLength={5}
            className={inputClass}
          />
        </FormField>
      </div>

      <FormField label="Ort">
        <input
          type="text"
          value={form.adresse.ort}
          onChange={(e) => setForm((f) => ({ ...f, adresse: { ...f.adresse, ort: e.target.value } }))}
          placeholder="Uslar"
          className={inputClass}
        />
      </FormField>

      <div className="grid grid-cols-2 gap-4">
        <FormField label="Telefon">
          <input
            type="tel"
            value={form.telefon}
            onChange={(e) => setForm((f) => ({ ...f, telefon: e.target.value }))}
            placeholder="+49 5571 12345"
            className={inputClass}
          />
        </FormField>
        <FormField label="Geburtsdatum">
          <input
            type="date"
            value={form.geburtsdatum}
            onChange={(e) => setForm((f) => ({ ...f, geburtsdatum: e.target.value }))}
            className={inputClass}
          />
          {minderjährig && (
            <p className="text-xs text-orange-600 mt-1">
              ⚠ Minderjährig ({alter} Jahre) — abweichender Stundenlohn gilt
            </p>
          )}
        </FormField>
      </div>

      {/* Rollen */}
      <FormField label="Rollen *">
        <div className="flex flex-wrap gap-2 mt-1">
          {ALLE_ROLLEN.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => toggleRolle(r)}
              className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                form.rollen.includes(r)
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white text-gray-600 border-gray-300 hover:border-blue-400'
              }`}
            >
              {ROLLEN_LABELS[r]}
            </button>
          ))}
        </div>
      </FormField>

      {/* Abrechnung */}
      <FormField label="Abrechnungstyp">
        <select
          value={form.abrechnungstyp}
          onChange={(e) => setForm((f) => ({ ...f, abrechnungstyp: e.target.value as Abrechnungstyp }))}
          className={inputClass}
        >
          <option value="variabel">Variabel (nach Zeit/Leistung)</option>
          <option value="fix">Fixes Gehalt</option>
          <option value="beides">Fixes Gehalt + variabler Anteil</option>
        </select>
      </FormField>

      {(form.abrechnungstyp === 'fix' || form.abrechnungstyp === 'beides') && (
        <FormField label="Fixes Gehalt (EUR/Monat)">
          <input
            type="number"
            min="0"
            step="0.01"
            value={form.fixesGehalt ?? ''}
            onChange={(e) => setForm((f) => ({ ...f, fixesGehalt: e.target.value ? parseFloat(e.target.value) : undefined }))}
            placeholder="0.00"
            className={inputClass}
          />
        </FormField>
      )}

      <FormField
        label="Individueller Stundenlohn (EUR/h)"
        hint={`Leer lassen für Standard (${
          minderjährig
            ? `${parameter?.stundenlohnMinderjAustr ?? 10.0} €/h Minderjährige`
            : `${parameter?.stundenlohnErwachseneAustr ?? 13.9} €/h MiLoG`
        })`}
      >
        <input
          type="number"
          min="0"
          step="0.01"
          value={form.stundenlohnIndividuell ?? ''}
          onChange={(e) => setForm((f) => ({
            ...f,
            stundenlohnIndividuell: e.target.value ? parseFloat(e.target.value) : undefined,
          }))}
          placeholder="Leer = Standard"
          className={inputClass}
        />
        {form.stundenlohnIndividuell !== undefined &&
          parameter?.stundenlohnErwachseneAustr !== undefined &&
          form.stundenlohnIndividuell < parameter.mindeststundenlohn && (
            <p className="text-xs text-red-600 mt-1">
              ⚠ Stundenlohn liegt unter dem konfigurierten Mindestlohn ({parameter.mindeststundenlohn} €/h)!
            </p>
          )}
      </FormField>

      {error && <p className="text-red-600 text-sm">{error}</p>}

      <div className="flex items-center justify-between pt-2">
        <div>
          {initial && initial.isActive && (
            <button
              type="button"
              onClick={handleDeaktivieren}
              className="text-sm text-red-600 hover:text-red-700"
            >
              Mitarbeiter deaktivieren
            </button>
          )}
        </div>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800"
          >
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
      </div>
    </form>
  );
}

function FormField({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      {hint && <p className="text-xs text-gray-400 mb-1">{hint}</p>}
      {children}
    </div>
  );
}

const inputClass =
  'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';

// ---- NFC-Chip beschreiben ----------------------------------

function NfcSchreibenButton({ mitarbeiterId }: { mitarbeiterId: string }) {
  const [status, setStatus] = useState<'idle' | 'schreibt' | 'ok' | 'fehler'>('idle');

  if (!nfcVerfuegbar()) return null;

  async function handleSchreiben() {
    setStatus('schreibt');
    try {
      await beschreibeNfcTag(mitarbeiterId);
      setStatus('ok');
      setTimeout(() => setStatus('idle'), 3000);
    } catch {
      setStatus('fehler');
      setTimeout(() => setStatus('idle'), 3000);
    }
  }

  return (
    <button
      onClick={handleSchreiben}
      disabled={status === 'schreibt'}
      title="NFC-Chip beschreiben"
      className={`text-xs font-medium transition-colors ${
        status === 'ok' ? 'text-green-600' :
        status === 'fehler' ? 'text-red-600' :
        'text-gray-400 hover:text-gray-700'
      }`}
    >
      {status === 'schreibt' ? '📲...' : status === 'ok' ? '✓ NFC' : status === 'fehler' ? '✗ NFC' : '📲 NFC'}
    </button>
  );
}
