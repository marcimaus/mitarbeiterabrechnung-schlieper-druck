import { useState, useEffect, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import AdminPinGate from '../components/AdminPinGate';
import Modal from '../components/Modal';
import { istEinsatzbereit } from '../utils';
import {
  ladeFahrten,
  erstelleFahrt,
  aktualisiereFahrt,
  loescheFahrt,
  weisFahrtPeriodeZu,
  entferneFahrtPeriode,
} from '../lib/db';
import type { Fahrt } from '../types';

export default function FahrtenScreen() {
  const [searchParams] = useSearchParams();
  const { userRole, mitarbeiter } = useApp();
  const urlMaId = searchParams.get('ma') ?? '';

  // Wenn ?ma= gesetzt und NICHT eingeloggt → Login-freie Schnellerfassung
  if (urlMaId && !userRole) {
    return <FahrtNfcModus mitarbeiterId={urlMaId} mitarbeiter={mitarbeiter} />;
  }

  return (
    <AdminPinGate allowedRoles={['admin', 'abrechnung', 'mitarbeiter']}>
      <FahrtenInhalt />
    </AdminPinGate>
  );
}

function FahrtenInhalt() {
  const { mitarbeiter, abrechnungsperioden, parameter, userRole, mitarbeiterId: loggedInMaId } = useApp();
  const isAdmin = userRole === 'admin';
  const isMitarbeiter = userRole === 'mitarbeiter';
  const [searchParams] = useSearchParams();
  const urlMaId = searchParams.get('ma') ?? '';

  const [fahrten, setFahrten] = useState<Fahrt[]>([]);
  const [loading, setLoading] = useState(true);
  // Mitarbeiter-Rolle sieht nur eigene Fahrten; ?ma= öffnet direkt das Formular
  const [filterMaId, setFilterMaId] = useState(isMitarbeiter ? (loggedInMaId ?? '') : '');
  const [filterPeriodeId, setFilterPeriodeId] = useState('');
  const [showForm, setShowForm] = useState(!!urlMaId);
  const [editTarget, setEditTarget] = useState<Fahrt | null>(null);
  // URL-MA-ID direkt als Vorbelegung für die neue Fahrt (NFC-Landing)
  const [prefillMaId] = useState(urlMaId);
  // Bulk-Zuweisung
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkPeriodeId, setBulkPeriodeId] = useState('');

  const reload = async () => {
    setLoading(true);
    const list = await ladeFahrten();
    setFahrten(list.sort((a, b) => b.datum.localeCompare(a.datum)));
    setLoading(false);
  };

  useEffect(() => { reload(); }, []);

  const gefiltert = fahrten.filter((f) => {
    if (filterMaId && f.mitarbeiterId !== filterMaId) return false;
    if (filterPeriodeId === '__offen__' && f.abrechnungsperiodeId) return false;
    if (filterPeriodeId && filterPeriodeId !== '__offen__' && f.abrechnungsperiodeId !== filterPeriodeId) return false;
    return true;
  });

  // Sätze & Summen
  const aktSatz = (f: Fahrt) => {
    const ma = mitarbeiter.find((m) => m.id === f.mitarbeiterId);
    return ma?.fahrkostenEurProKm ?? parameter?.fahrkostenEurProKm ?? 0.30;
  };

  const gesamtKm = gefiltert.reduce((s, f) => s + f.streckKm, 0);
  const gesamtEur = gefiltert.reduce((s, f) => s + f.streckKm * aktSatz(f), 0);

  async function handlePeriodeZuweisen(fahrtId: string, periodeId: string) {
    if (!periodeId) {
      await entferneFahrtPeriode(fahrtId);
    } else {
      await weisFahrtPeriodeZu(fahrtId, periodeId);
    }
    await reload();
  }

  async function handleBulkZuweisen() {
    // __remove__ bedeutet: Zuweisung entfernen
    const periodeId = bulkPeriodeId === '__remove__' ? '' : bulkPeriodeId;
    for (const id of selectedIds) {
      if (!periodeId) {
        await entferneFahrtPeriode(id);
      } else {
        await weisFahrtPeriodeZu(id, periodeId);
      }
    }
    setSelectedIds(new Set());
    setBulkPeriodeId('');
    await reload();
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    const selectableFahrten = gefiltert.filter((f) => {
      const periode = abrechnungsperioden.find((p) => p.id === f.abrechnungsperiodeId);
      return !periode || periode.status !== 'abgeschlossen';
    });
    if (selectableFahrten.every((f) => selectedIds.has(f.id))) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(selectableFahrten.map((f) => f.id)));
    }
  }

  const sortedPerioden = [...abrechnungsperioden].sort((a, b) =>
    b.jahr !== a.jahr ? b.jahr - a.jahr : b.monat - a.monat
  );
  const offenePerioden = sortedPerioden.filter((p) => p.status === 'offen');

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Fahrtkosten</h1>
          <p className="text-sm text-gray-500">
            Standardsatz: {(parameter?.fahrkostenEurProKm ?? 0.30).toFixed(2)} €/km
          </p>
        </div>
        <button
          onClick={() => { setEditTarget(null); setShowForm(true); }}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
        >
          + Neue Fahrt
        </button>
      </div>

      {/* Filter */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 mb-4 flex flex-wrap gap-3">
        {!isMitarbeiter && (
          <select
            value={filterMaId}
            onChange={(e) => setFilterMaId(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">Alle Mitarbeiter</option>
            {mitarbeiter.filter((m) => istEinsatzbereit(m)).map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
        )}
        <select
          value={filterPeriodeId}
          onChange={(e) => setFilterPeriodeId(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">Alle Perioden</option>
          <option value="__offen__">Noch nicht zugeordnet</option>
          {sortedPerioden.map((p) => (
            <option key={p.id} value={p.id}>{p.bezeichnung}</option>
          ))}
        </select>

        {/* Summen-Badge */}
        <div className="ml-auto flex items-center gap-4 text-sm text-gray-600">
          <span><strong>{gefiltert.length}</strong> Fahrten</span>
          <span><strong>{gesamtKm} km</strong></span>
          <span className="font-semibold text-blue-700">
            {gesamtEur.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}
          </span>
        </div>
      </div>

      {/* Bulk-Aktionsleiste */}
      {isAdmin && selectedIds.size > 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 mb-4 flex flex-wrap items-center gap-3">
          <span className="text-sm font-medium text-blue-800">
            {selectedIds.size} Fahrt{selectedIds.size !== 1 ? 'en' : ''} ausgewählt
          </span>
          <select
            value={bulkPeriodeId}
            onChange={(e) => setBulkPeriodeId(e.target.value)}
            className="border border-blue-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
          >
            <option value="">— Periode zuweisen —</option>
            <option value="__remove__">Zuweisung entfernen</option>
            {offenePerioden.map((p) => (
              <option key={p.id} value={p.id}>{p.bezeichnung}</option>
            ))}
          </select>
          <button
            onClick={handleBulkZuweisen}
            disabled={!bulkPeriodeId}
            className="bg-blue-600 text-white px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            Zuordnen
          </button>
          <button
            onClick={() => setSelectedIds(new Set())}
            className="text-sm text-blue-600 hover:text-blue-800 underline ml-auto"
          >
            Auswahl aufheben
          </button>
        </div>
      )}

      {/* Tabelle */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        {loading && (
          <div className="p-8 text-center text-gray-400 text-sm">Lade Daten...</div>
        )}
        {!loading && gefiltert.length === 0 && (
          <div className="p-8 text-center text-gray-400 text-sm">Keine Fahrten gefunden</div>
        )}
        {!loading && gefiltert.length > 0 && (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                {isAdmin && (
                  <th className="px-3 py-3">
                    <input
                      type="checkbox"
                      onChange={toggleSelectAll}
                      checked={gefiltert.length > 0 && gefiltert.every((f) => selectedIds.has(f.id))}
                      className="rounded"
                    />
                  </th>
                )}
                <th className="px-4 py-3 text-left font-medium text-gray-600">Datum</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Mitarbeiter</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Ziel</th>
                <th className="px-4 py-3 text-right font-medium text-gray-600">km</th>
                <th className="px-4 py-3 text-right font-medium text-gray-600">Betrag</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Abrechnungsperiode</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {gefiltert.map((f) => {
                const ma = mitarbeiter.find((m) => m.id === f.mitarbeiterId);
                const satz = aktSatz(f);
                const betrag = f.streckKm * satz;
                const periode = abrechnungsperioden.find((p) => p.id === f.abrechnungsperiodeId);
                const istGesperrt = periode?.status === 'abgeschlossen';
                const isSelected = selectedIds.has(f.id);

                return (
                  <tr key={f.id} className={`hover:bg-gray-50 ${isSelected ? 'bg-blue-50' : ''}`}>
                    {isAdmin && (
                      <td className="px-3 py-2.5">
                        {!istGesperrt && (
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleSelect(f.id)}
                            className="rounded"
                          />
                        )}
                      </td>
                    )}
                    <td className="px-4 py-2.5 text-gray-700 whitespace-nowrap">{f.datum}</td>
                    <td className="px-4 py-2.5">
                      <div className="font-medium text-gray-900">{ma?.name ?? '?'}</div>
                      {ma?.fahrkostenEurProKm && (
                        <div className="text-xs text-gray-400">{satz.toFixed(2)} €/km (individuell)</div>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="text-gray-800">{f.ziel}</div>
                      {f.bemerkung && <div className="text-xs text-gray-400">{f.bemerkung}</div>}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-gray-700">{f.streckKm}</td>
                    <td className="px-4 py-2.5 text-right font-medium text-gray-900">
                      {betrag.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}
                    </td>
                    <td className="px-4 py-2.5">
                      {isAdmin && !istGesperrt ? (
                        <select
                          value={f.abrechnungsperiodeId ?? ''}
                          onChange={(e) => handlePeriodeZuweisen(f.id, e.target.value)}
                          className="border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 max-w-40"
                        >
                          <option value="">— nicht zugeordnet —</option>
                          {offenePerioden.map((p) => (
                            <option key={p.id} value={p.id}>{p.bezeichnung}</option>
                          ))}
                          {/* Wenn aktuell einer abgeschlossenen Periode zugeordnet, anzeigen */}
                          {periode && periode.status === 'abgeschlossen' && (
                            <option value={periode.id}>{periode.bezeichnung} ✓</option>
                          )}
                        </select>
                      ) : periode ? (
                        <span className={`text-xs px-2 py-0.5 rounded-full ${
                          istGesperrt
                            ? 'bg-green-100 text-green-700'
                            : 'bg-blue-100 text-blue-700'
                        }`}>
                          {periode.bezeichnung}{istGesperrt ? ' ✓' : ''}
                        </span>
                      ) : (
                        <span className="text-xs text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      {(!istGesperrt) && (
                        <div className="flex gap-2 justify-end">
                          <button
                            onClick={() => { setEditTarget(f); setShowForm(true); }}
                            className="text-xs text-blue-600 hover:text-blue-800"
                          >
                            Bearbeiten
                          </button>
                          {isAdmin && (
                            <button
                              onClick={async () => {
                                if (confirm('Fahrt wirklich löschen?')) {
                                  await loescheFahrt(f.id);
                                  await reload();
                                }
                              }}
                              className="text-xs text-red-500 hover:text-red-700"
                            >
                              Löschen
                            </button>
                          )}
                        </div>
                      )}
                      {istGesperrt && (
                        <span className="text-xs text-gray-400">gesperrt</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <Modal
        isOpen={showForm}
        onClose={() => setShowForm(false)}
        title={editTarget ? 'Fahrt bearbeiten' : 'Neue Fahrt erfassen'}
        size="md"
      >
        <FahrtForm
          initial={editTarget}
          mitarbeiter={mitarbeiter.filter((m) => istEinsatzbereit(m))}
          fixedMaId={isMitarbeiter ? (loggedInMaId ?? undefined) : (prefillMaId || undefined)}
          onSave={async () => { setShowForm(false); await reload(); }}
          onCancel={() => setShowForm(false)}
        />
      </Modal>
    </div>
  );
}

// ---- NFC-Schnellerfassung (ohne Login) ---------------------

function FahrtNfcModus({
  mitarbeiterId,
  mitarbeiter,
}: {
  mitarbeiterId: string;
  mitarbeiter: ReturnType<typeof useApp>['mitarbeiter'];
}) {
  const ma = mitarbeiter.find((m) => m.id === mitarbeiterId);
  const heute = new Date().toISOString().slice(0, 10);

  const [datum, setDatum] = useState(heute);
  const [ziel, setZiel] = useState('');
  const [km, setKm] = useState('');
  const [bemerkung, setBemerkung] = useState('');
  const [saving, setSaving] = useState(false);
  const [meldung, setMeldung] = useState('');

  // Warte bis Mitarbeiter geladen
  if (mitarbeiter.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-gray-400 text-sm">Lade...</div>
      </div>
    );
  }

  if (!ma) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
        <div className="bg-white rounded-xl shadow p-8 text-center max-w-sm w-full">
          <div className="text-4xl mb-4">❌</div>
          <p className="text-gray-700 font-medium">Mitarbeiter nicht gefunden.</p>
        </div>
      </div>
    );
  }

  async function handleSpeichern(e: FormEvent) {
    e.preventDefault();
    const kmVal = parseFloat(km.replace(',', '.'));
    if (!ziel.trim() || isNaN(kmVal) || kmVal <= 0) {
      setMeldung('Bitte Ziel und gültige km-Anzahl eingeben.');
      return;
    }
    setSaving(true);
    setMeldung('');
    try {
      await erstelleFahrt({
        mitarbeiterId,
        datum,
        streckKm: kmVal,
        ziel: ziel.trim(),
        bemerkung: bemerkung.trim() || undefined,
      });
      setMeldung('✓ Fahrt gespeichert');
      setZiel('');
      setKm('');
      setBemerkung('');
      setDatum(new Date().toISOString().slice(0, 10));
    } catch (err) {
      setMeldung('Fehler beim Speichern.');
      console.error(err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-start justify-center pt-8 p-4">
      <div className="bg-white rounded-2xl shadow-lg w-full max-w-sm overflow-hidden">
        {/* Header */}
        <div className="bg-blue-600 p-5 text-white text-center">
          <div className="text-3xl mb-1">🚗</div>
          <h1 className="text-lg font-bold">{ma.name}</h1>
          <p className="text-sm opacity-80">Fahrtkosten erfassen</p>
        </div>

        <form onSubmit={handleSpeichern} className="p-5 space-y-3">
          {meldung && (
            <div className={`text-center text-sm font-medium py-2 px-3 rounded-lg ${
              meldung.startsWith('✓') ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
            }`}>
              {meldung}
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Datum</label>
            <input
              type="date"
              value={datum}
              onChange={(e) => setDatum(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Ziel / Route *</label>
            <input
              type="text"
              value={ziel}
              onChange={(e) => setZiel(e.target.value)}
              placeholder="z.B. Göttingen – Lager"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Kilometer *</label>
            <input
              type="number"
              inputMode="decimal"
              min="0"
              step="0.1"
              value={km}
              onChange={(e) => setKm(e.target.value)}
              placeholder="0"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Bemerkung (optional)</label>
            <input
              type="text"
              value={bemerkung}
              onChange={(e) => setBemerkung(e.target.value)}
              placeholder="optional"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <button
            type="submit"
            disabled={saving}
            className="w-full py-3 bg-blue-600 text-white rounded-xl font-semibold text-sm hover:bg-blue-700 active:bg-blue-800 disabled:opacity-50 transition-colors mt-1"
          >
            {saving ? 'Speichern…' : '💾 Fahrt speichern'}
          </button>
        </form>
      </div>
    </div>
  );
}

// ---- Formular ----------------------------------------------

function FahrtForm({
  initial,
  mitarbeiter,
  fixedMaId,
  onSave,
  onCancel,
}: {
  initial: Fahrt | null;
  mitarbeiter: ReturnType<typeof useApp>['mitarbeiter'];
  fixedMaId?: string;
  onSave: () => void;
  onCancel: () => void;
}) {
  const heute = new Date().toISOString().slice(0, 10);
  const [mitarbeiterId, setMitarbeiterId] = useState(initial?.mitarbeiterId ?? fixedMaId ?? '');
  const [datum, setDatum] = useState(initial?.datum ?? heute);
  const [streckKm, setStreckKm] = useState(initial?.streckKm ?? 0);
  const [ziel, setZiel] = useState(initial?.ziel ?? '');
  const [bemerkung, setBemerkung] = useState(initial?.bemerkung ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!mitarbeiterId) { setError('Bitte Mitarbeiter auswählen.'); return; }
    if (!ziel.trim()) { setError('Bitte Ziel angeben.'); return; }
    if (streckKm <= 0) { setError('Strecke muss größer 0 sein.'); return; }
    setSaving(true);
    setError('');
    try {
      if (initial) {
        await aktualisiereFahrt(initial.id, { mitarbeiterId, datum, streckKm, ziel, bemerkung: bemerkung || undefined });
      } else {
        await erstelleFahrt({ mitarbeiterId, datum, streckKm, ziel, bemerkung: bemerkung || undefined });
      }
      onSave();
    } catch (err) {
      setError('Fehler beim Speichern.');
      console.error(err);
    } finally {
      setSaving(false);
    }
  }

  const inputClass = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Mitarbeiter *</label>
        {fixedMaId ? (
          <div className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-gray-50 text-gray-700">
            {mitarbeiter.find((m) => m.id === fixedMaId)?.name ?? fixedMaId}
          </div>
        ) : (
          <select
            value={mitarbeiterId}
            onChange={(e) => setMitarbeiterId(e.target.value)}
            className={inputClass}
          >
            <option value="">— Mitarbeiter wählen —</option>
            {mitarbeiter.map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Datum *</label>
          <input
            type="date"
            value={datum}
            onChange={(e) => setDatum(e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Strecke (km) *</label>
          <input
            type="number"
            min={1}
            max={9999}
            step={1}
            value={streckKm || ''}
            onChange={(e) => setStreckKm(Math.max(0, Number(e.target.value)))}
            placeholder="0"
            className={inputClass}
          />
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Ziel *</label>
        <input
          type="text"
          value={ziel}
          onChange={(e) => setZiel(e.target.value)}
          placeholder="z.B. Lieferant GmbH, Hannover"
          className={inputClass}
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Bemerkung</label>
        <input
          type="text"
          value={bemerkung}
          onChange={(e) => setBemerkung(e.target.value)}
          placeholder="Optional"
          className={inputClass}
        />
      </div>

      {error && <p className="text-red-600 text-sm">{error}</p>}

      <div className="flex justify-end gap-3 pt-2">
        <button type="button" onClick={onCancel} className="px-4 py-2 text-sm text-gray-600">Abbrechen</button>
        <button
          type="submit"
          disabled={saving}
          className="bg-blue-600 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          {saving ? 'Speichere...' : initial ? 'Speichern' : 'Erfassen'}
        </button>
      </div>
    </form>
  );
}
