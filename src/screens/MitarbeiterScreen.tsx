import { useState, type FormEvent } from 'react';
import { useApp } from '../context/AppContext';
import AdminPinGate from '../components/AdminPinGate';
import Modal from '../components/Modal';
import {
  erstelleMitarbeiter,
  aktualisiereMitarbeiter,
  deaktiviereMitarbeiter,
} from '../lib/db';
import { hashPin } from '../lib/auth';
import { beschreibeNfcTag, nfcVerfuegbar } from '../lib/zeiterfassung';
import type { Mitarbeiter, Rolle, Abrechnungstyp, TeilgebietBonus } from '../types';
import { ROLLEN_LABELS } from '../types';
import { berechneAlter } from '../lib/berechnung';

type MaFormTab = 'stammdaten' | 'freigaben' | 'boni';

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
        title={editTarget ? `Mitarbeiter: ${editTarget.name}` : 'Neuer Mitarbeiter'}
        size="xl"
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
  const { parameter, teilgebiete } = useApp();
  const [tab, setTab] = useState<MaFormTab>('stammdaten');
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
  // Freigaben und Boni als eigene States
  const [freigaben, setFreigaben] = useState<string[]>(initial?.teilgebietFreigaben ?? []);
  const [boni, setBoni] = useState<TeilgebietBonus[]>(initial?.teilgebietBoni ?? []);
  const [neuBonusTgId, setNeuBonusTgId] = useState('');
  const [neuBonusBetrag, setNeuBonusBetrag] = useState('');

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const aktiveTeilgebiete = teilgebiete.filter((tg) => tg.isActive);

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
      const payload = { ...form, teilgebietFreigaben: freigaben, teilgebietBoni: boni };
      if (initial) {
        await aktualisiereMitarbeiter(initial.id, payload);
      } else {
        await erstelleMitarbeiter(payload);
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

  function toggleFreigabe(tgId: string) {
    setFreigaben((prev) =>
      prev.includes(tgId) ? prev.filter((id) => id !== tgId) : [...prev, tgId]
    );
  }

  function addBonus() {
    if (!neuBonusTgId || !neuBonusBetrag) return;
    const betrag = parseFloat(neuBonusBetrag);
    if (isNaN(betrag) || betrag <= 0) return;
    setBoni((prev) => {
      const existing = prev.findIndex((b) => b.teilgebietId === neuBonusTgId);
      if (existing >= 0) {
        return prev.map((b, i) => i === existing ? { ...b, betragEur: betrag } : b);
      }
      return [...prev, { teilgebietId: neuBonusTgId, betragEur: betrag }];
    });
    setNeuBonusTgId('');
    setNeuBonusBetrag('');
  }

  const TABS: { id: MaFormTab; label: string; count?: number }[] = [
    { id: 'stammdaten', label: 'Stammdaten' },
    { id: 'freigaben', label: 'Gebiets-Freigaben', count: freigaben.length },
    { id: 'boni', label: 'Teilgebiet-Boni', count: boni.length },
  ];

  return (
    <form onSubmit={handleSubmit} className="space-y-0">
      {/* Tabs */}
      <div className="flex border-b border-gray-200 mb-5 -mt-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              tab === t.id
                ? 'border-blue-600 text-blue-700'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t.label}
            {t.count != null && t.count > 0 && (
              <span className="ml-1.5 bg-gray-200 text-gray-600 text-xs px-1.5 py-0.5 rounded-full">
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ---- Tab: Stammdaten ---- */}
      {tab === 'stammdaten' && (
      <div className="space-y-5">
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

      <FormField
        label="Individueller Fahrkostensatz (EUR/km)"
        hint={`Leer lassen für globalen Standardsatz (${parameter?.fahrkostenEurProKm ?? 0.30} €/km)`}
      >
        <input
          type="number"
          min="0"
          step="0.01"
          value={(form as any).fahrkostenEurProKm ?? ''}
          onChange={(e) => setForm((f) => ({
            ...f,
            fahrkostenEurProKm: e.target.value ? parseFloat(e.target.value) : undefined,
          } as any))}
          placeholder="Leer = Standard"
          className={inputClass}
        />
      </FormField>

      {error && <p className="text-red-600 text-sm">{error}</p>}

      {/* PIN-Verwaltung (nur bei bestehenden Mitarbeitern) */}
      {initial && (
        <PinVerwaltung mitarbeiter={initial} />
      )}
      </div>
      )}

      {/* ---- Tab: Freigaben ---- */}
      {tab === 'freigaben' && (
        <div className="space-y-4">
          <p className="text-sm text-gray-500">
            Wähle die Teilgebiete aus, die dieser Austräger kennt und austragen darf.
            Nur freigegebene Austräger können als Standardausträger eines Teilgebiets hinterlegt werden.
          </p>
          {aktiveTeilgebiete.length === 0 ? (
            <div className="text-gray-400 text-sm text-center py-8">Keine aktiven Teilgebiete vorhanden.</div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {[...aktiveTeilgebiete].sort((a, b) => a.name.localeCompare(b.name)).map((tg) => (
                <button
                  key={tg.id}
                  type="button"
                  onClick={() => toggleFreigabe(tg.id)}
                  className={`text-left px-3 py-2.5 rounded-lg border text-sm transition-colors ${
                    freigaben.includes(tg.id)
                      ? 'bg-green-50 border-green-400 text-green-800 font-medium'
                      : 'bg-white border-gray-200 text-gray-600 hover:border-gray-400'
                  }`}
                >
                  <div className="font-medium">{tg.name}</div>
                  {tg.plz && <div className="text-xs opacity-70">{tg.plz}</div>}
                </button>
              ))}
            </div>
          )}
          <p className="text-xs text-gray-400">
            {freigaben.length} von {aktiveTeilgebiete.length} Teilgebieten freigegeben
          </p>
        </div>
      )}

      {/* ---- Tab: Boni ---- */}
      {tab === 'boni' && (
        <div className="space-y-4">
          <p className="text-sm text-gray-500">
            Definiere einen zusätzlichen Betrag, der je verteilter Ausgabe vergütet wird,
            wenn dieser Austräger als <strong>Standardausträger</strong> eingesetzt wird.
          </p>

          {boni.length === 0 ? (
            <div className="border border-gray-200 rounded-lg p-6 text-center text-gray-400 text-sm">
              Keine Teilgebiet-Boni hinterlegt
            </div>
          ) : (
            <div className="border border-gray-200 rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium text-gray-600">Teilgebiet</th>
                    <th className="text-right px-3 py-2 font-medium text-gray-600">Bonus je Ausgabe</th>
                    <th className="px-3 py-2 w-10"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {boni.map((b) => {
                    const tg = teilgebiete.find((t) => t.id === b.teilgebietId);
                    return (
                      <tr key={b.teilgebietId} className="hover:bg-gray-50">
                        <td className="px-3 py-2 font-medium text-gray-800">{tg?.name ?? b.teilgebietId}</td>
                        <td className="px-3 py-2 text-right text-green-700 font-medium">
                          + {b.betragEur.toFixed(2)} €
                        </td>
                        <td className="px-3 py-2">
                          <button
                            type="button"
                            onClick={() => setBoni((prev) => prev.filter((x) => x.teilgebietId !== b.teilgebietId))}
                            className="text-red-400 hover:text-red-600 text-xs"
                          >
                            ✕
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Neue Bonus-Zeile */}
          <div className="border border-dashed border-gray-300 rounded-lg p-3">
            <p className="text-xs font-medium text-gray-500 mb-2">Bonus hinzufügen</p>
            <div className="flex gap-2 items-end">
              <div className="flex-1">
                <label className="block text-xs text-gray-500 mb-1">Teilgebiet</label>
                <select
                  value={neuBonusTgId}
                  onChange={(e) => setNeuBonusTgId(e.target.value)}
                  className="border border-gray-300 rounded px-2 py-1.5 text-sm w-full focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  <option value="">— Teilgebiet wählen —</option>
                  {[...aktiveTeilgebiete]
                    .filter((tg) => !boni.find((b) => b.teilgebietId === tg.id))
                    .sort((a, b) => a.name.localeCompare(b.name))
                    .map((tg) => (
                      <option key={tg.id} value={tg.id}>{tg.name} {tg.plz ? `(${tg.plz})` : ''}</option>
                    ))}
                </select>
              </div>
              <div className="w-28">
                <label className="block text-xs text-gray-500 mb-1">Betrag (€)</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={neuBonusBetrag}
                  onChange={(e) => setNeuBonusBetrag(e.target.value)}
                  placeholder="0.00"
                  className="border border-gray-300 rounded px-2 py-1.5 text-sm w-full text-right focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
              <button
                type="button"
                onClick={addBonus}
                disabled={!neuBonusTgId || !neuBonusBetrag}
                className="bg-blue-600 text-white px-3 py-1.5 rounded text-sm font-medium hover:bg-blue-700 disabled:opacity-40"
              >
                + Hinzufügen
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Aktionen — immer sichtbar */}
      {error && <p className="text-red-600 text-sm mt-4">{error}</p>}
      <div className="flex items-center justify-between pt-5 mt-4 border-t border-gray-100">
        <div>
          {initial && initial.isActive && tab === 'stammdaten' && (
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
          <button type="button" onClick={onCancel} className="px-4 py-2 text-sm text-gray-600">
            Abbrechen
          </button>
          <button
            type="submit"
            disabled={saving}
            className="bg-blue-600 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? 'Speichere...' : initial ? 'Speichern' : 'Erstellen'}
          </button>
        </div>
      </div>
    </form>
  );
}

// ---- PIN-Verwaltung für Mitarbeiter ------------------------

function PinVerwaltung({ mitarbeiter }: { mitarbeiter: Mitarbeiter }) {
  const [neuerPin, setNeuerPin] = useState('');
  const [pinBestaetigung, setPinBestaetigung] = useState('');
  const [showPinForm, setShowPinForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  const hatPin = !!mitarbeiter.pinHash;

  async function handlePinSetzen(e: FormEvent) {
    e.preventDefault();
    if (neuerPin.length < 4) { setMessage('PIN muss mindestens 4 Stellen haben.'); return; }
    if (neuerPin !== pinBestaetigung) { setMessage('PINs stimmen nicht überein.'); return; }
    setSaving(true);
    setMessage('');
    try {
      const hash = await hashPin(neuerPin);
      await aktualisiereMitarbeiter(mitarbeiter.id, { pinHash: hash });
      setNeuerPin('');
      setPinBestaetigung('');
      setShowPinForm(false);
      setMessage('✓ PIN gesetzt');
      setTimeout(() => setMessage(''), 3000);
    } catch {
      setMessage('Fehler beim Speichern.');
    } finally {
      setSaving(false);
    }
  }

  async function handlePinLoeschen() {
    if (!confirm(`PIN von "${mitarbeiter.name}" wirklich löschen?`)) return;
    setSaving(true);
    try {
      await aktualisiereMitarbeiter(mitarbeiter.id, { pinHash: undefined });
      setMessage('✓ PIN gelöscht');
      setTimeout(() => setMessage(''), 3000);
    } catch {
      setMessage('Fehler beim Löschen.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-4 pt-4 border-t border-gray-200">
      <div className="flex items-center gap-3 mb-2">
        <h4 className="text-sm font-semibold text-gray-700">Mitarbeiter-PIN (Selbstschutz)</h4>
        {hatPin ? (
          <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">🔒 PIN gesetzt</span>
        ) : (
          <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">Kein PIN</span>
        )}
      </div>
      <p className="text-xs text-gray-400 mb-3">
        Wenn ein PIN gesetzt ist, können die eigenen Daten dieses Mitarbeiters durch ihn selbst geschützt werden.
      </p>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setShowPinForm(!showPinForm)}
          className="text-xs text-blue-600 hover:text-blue-800 underline"
        >
          {hatPin ? 'PIN ändern' : 'PIN setzen'}
        </button>
        {hatPin && (
          <button
            type="button"
            onClick={handlePinLoeschen}
            disabled={saving}
            className="text-xs text-red-500 hover:text-red-700 underline"
          >
            PIN löschen
          </button>
        )}
      </div>

      {showPinForm && (
        <form onSubmit={handlePinSetzen} className="mt-3 bg-gray-50 rounded-lg p-3 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs text-gray-600 mb-1">Neuer PIN (min. 4 Stellen)</label>
              <input
                type="password"
                inputMode="numeric"
                maxLength={8}
                value={neuerPin}
                onChange={(e) => setNeuerPin(e.target.value.replace(/\D/g, ''))}
                placeholder="••••"
                className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">Bestätigung</label>
              <input
                type="password"
                inputMode="numeric"
                maxLength={8}
                value={pinBestaetigung}
                onChange={(e) => setPinBestaetigung(e.target.value.replace(/\D/g, ''))}
                placeholder="••••"
                className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
          </div>
          <div className="flex gap-2 items-center">
            <button
              type="submit"
              disabled={saving || neuerPin.length < 4}
              className="text-xs bg-blue-600 text-white px-3 py-1.5 rounded hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? '...' : 'PIN setzen'}
            </button>
            <button
              type="button"
              onClick={() => { setShowPinForm(false); setNeuerPin(''); setPinBestaetigung(''); }}
              className="text-xs text-gray-500 hover:text-gray-700"
            >
              Abbrechen
            </button>
          </div>
        </form>
      )}
      {message && (
        <p className={`text-xs mt-1 ${message.startsWith('✓') ? 'text-green-600' : 'text-red-600'}`}>
          {message}
        </p>
      )}
    </div>
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
  const [showInfo, setShowInfo] = useState(false);
  const [kopiert, setKopiert] = useState(false);

  const nfcUrl = `${window.location.origin}/nfc?ma=${encodeURIComponent(mitarbeiterId)}`;

  async function handleSchreiben() {
    if (!nfcVerfuegbar()) {
      // Desktop: Info-Box mit URL zum Kopieren anzeigen
      setShowInfo((v) => !v);
      return;
    }
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

  async function handleKopieren() {
    await navigator.clipboard.writeText(nfcUrl);
    setKopiert(true);
    setTimeout(() => setKopiert(false), 2000);
  }

  return (
    <div className="relative">
      <button
        onClick={handleSchreiben}
        disabled={status === 'schreibt'}
        title={nfcVerfuegbar() ? 'NFC-Chip beschreiben' : 'NFC-Chip-URL anzeigen'}
        className={`text-xs font-medium transition-colors ${
          status === 'ok' ? 'text-green-600' :
          status === 'fehler' ? 'text-red-600' :
          showInfo ? 'text-blue-600' :
          'text-gray-400 hover:text-gray-700'
        }`}
      >
        {status === 'schreibt' ? '📲...' :
         status === 'ok' ? '✓ NFC' :
         status === 'fehler' ? '✗ NFC' : '📲 NFC'}
      </button>

      {/* Info-Box für Desktop (kein NFC verfügbar) */}
      {showInfo && (
        <div className="absolute left-0 top-6 z-50 bg-white border border-gray-200 rounded-xl shadow-xl p-4 w-80">
          <div className="flex items-start justify-between mb-2">
            <p className="text-xs font-semibold text-gray-700">NFC-Chip beschreiben</p>
            <button onClick={() => setShowInfo(false)} className="text-gray-400 hover:text-gray-600 text-sm ml-2">✕</button>
          </div>
          <p className="text-xs text-gray-500 mb-3">
            Web NFC ist nur in <strong>Chrome auf Android</strong> verfügbar.
            Diese URL auf den Chip schreiben — zum Beispiel mit der App <em>NFC Tools</em>:
          </p>
          <div className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 mb-3">
            <p className="text-xs font-mono text-blue-700 break-all">{nfcUrl}</p>
          </div>
          <button
            onClick={handleKopieren}
            className="w-full text-xs bg-blue-600 text-white py-2 rounded-lg hover:bg-blue-700 transition-colors"
          >
            {kopiert ? '✓ Kopiert!' : '📋 URL kopieren'}
          </button>
          <p className="text-xs text-gray-400 mt-2 text-center">
            Oder öffne diese Seite auf dem Android-Handy und tippe dort auf 📲 NFC
          </p>
        </div>
      )}
    </div>
  );
}
