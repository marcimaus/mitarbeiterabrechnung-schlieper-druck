import { useState, type FormEvent } from 'react';
import { useApp } from '../context/AppContext';
import AdminPinGate from '../components/AdminPinGate';
import Modal from '../components/Modal';
import { erstelleTeilgebiet, aktualisiereTeilgebiet } from '../lib/db';
import type { Teilgebiet, Strasse, Sonderauslage, NichtBeliefen } from '../types';

// ---- Hilfsfunktionen -------------------------------------------------------

const newId = () => `${Date.now()}_${Math.floor(Math.random() * 100000)}`;

type TabId = 'grunddaten' | 'strassen' | 'sonderauslagen' | 'nichtBeliefen';

const DEFAULT_FORM: Omit<
  Teilgebiet,
  'id' | 'erstelltAm' | 'aktualisiertAm' | 'strassen' | 'sonderauslagen' | 'nichtBeliefen'
> = {
  name: '',
  plz: '',
  stueckzahl: 0,
  stueckzahlManuell: true,
  wegstreckeM: 0,
  tourId: null,
  standardAustraegerId: null,
  isActive: true,
};

const inputClass =
  'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';
const smallInputClass =
  'border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500';

// ---- Hauptkomponente -------------------------------------------------------

export default function TeilgebieteScreen() {
  return (
    <AdminPinGate>
      <TeilgebieteInhalt />
    </AdminPinGate>
  );
}

function TeilgebieteInhalt() {
  const { teilgebiete, touren, mitarbeiter, abrechnungsperioden } = useApp();
  const [showForm, setShowForm] = useState(false);
  const [editTarget, setEditTarget] = useState<Teilgebiet | null>(null);
  const [filterText, setFilterText] = useState('');
  const [filterTour, setFilterTour] = useState('');
  const [nurAktive, setNurAktive] = useState(true);
  const [historiePeriodeId, setHistoriePeriodeId] = useState('');

  const gefiltert = teilgebiete.filter((tg) => {
    if (nurAktive && !tg.isActive) return false;
    if (
      filterText &&
      !tg.name.toLowerCase().includes(filterText.toLowerCase()) &&
      !tg.plz.includes(filterText)
    )
      return false;
    if (filterTour) {
      if (filterTour === '__keine__' && tg.tourId !== null) return false;
      if (filterTour !== '__keine__' && tg.tourId !== filterTour) return false;
    }
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
          onClick={() => {
            setEditTarget(null);
            setShowForm(true);
          }}
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
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
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
              <th className="text-right px-4 py-3 font-medium text-gray-600">Stück</th>
              <th className="text-right px-4 py-3 font-medium text-gray-600">Wegstrecke</th>
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
              <tr key={tg.id} className={tg.isActive ? 'hover:bg-gray-50' : 'opacity-50 hover:bg-gray-50'}>
                <td className="px-4 py-3 font-medium text-gray-900">{tg.name}</td>
                <td className="px-4 py-3 text-gray-600">{tg.plz}</td>
                <td className="px-4 py-3 text-right text-gray-600">
                  {tg.stueckzahl.toLocaleString('de-DE')}
                  {!tg.stueckzahlManuell && tg.strassen?.length > 0 && (
                    <span className="ml-1 text-xs text-blue-400" title="Berechnet aus Straßenliste">
                      ∑
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-right text-gray-600">
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
                <td className="px-4 py-3 text-right">
                  <button
                    onClick={() => {
                      setEditTarget(tg);
                      setShowForm(true);
                    }}
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
        title={editTarget ? `Teilgebiet: ${editTarget.name}` : 'Neues Teilgebiet'}
        size="xl"
      >
        <TeilgebietForm
          initial={editTarget}
          onSave={() => setShowForm(false)}
          onCancel={() => setShowForm(false)}
        />
      </Modal>

      {/* ---- Historische Werte ---- */}
      <div className="mt-10">
        <h2 className="text-lg font-bold text-gray-800 mb-3">
          Historische Werte zur Abrechnungsperiode
        </h2>

        <div className="flex items-center gap-3 mb-4">
          <select
            value={historiePeriodeId}
            onChange={(e) => setHistoriePeriodeId(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">— Periode auswählen —</option>
            {[...abrechnungsperioden]
              .filter((p) => p.periodeSnapshot?.teilgebietSnapshots?.length)
              .sort((a, b) => (b.jahr !== a.jahr ? b.jahr - a.jahr : b.monat - a.monat))
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.bezeichnung} ✓
                </option>
              ))}
          </select>
          {historiePeriodeId && (
            <span className="text-xs text-gray-400">Werte zum Zeitpunkt des Periodenabschlusses</span>
          )}
        </div>

        {historiePeriodeId &&
          (() => {
            const periode = abrechnungsperioden.find((p) => p.id === historiePeriodeId);
            const snapshots = periode?.periodeSnapshot?.teilgebietSnapshots ?? [];
            if (snapshots.length === 0) {
              return (
                <div className="bg-white rounded-xl border border-gray-200 p-6 text-center text-gray-400 text-sm">
                  Kein Snapshot für diese Periode vorhanden.
                </div>
              );
            }
            return (
              <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                <div className="bg-blue-50 border-b border-blue-100 px-4 py-2 text-xs text-blue-700 font-medium">
                  📸 Snapshot: {periode!.bezeichnung}
                  {periode!.gesperrtAm && (
                    <span className="ml-2 font-normal text-blue-500">
                      — abgeschlossen am{' '}
                      {new Date(periode!.gesperrtAm).toLocaleDateString('de-DE')}
                    </span>
                  )}
                </div>
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">Name</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">PLZ</th>
                      <th className="text-right px-4 py-3 font-medium text-gray-600">Stück</th>
                      <th className="text-right px-4 py-3 font-medium text-gray-600">Wegstrecke</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">Tour</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">
                        Standardausträger (historisch)
                      </th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">Heute</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {[...snapshots]
                      .sort((a, b) => a.name.localeCompare(b.name))
                      .map((snap) => {
                        const historMA = mitarbeiter.find((m) => m.id === snap.standardAustraegerId);
                        const historMAName = snap.standardAustraegerId
                          ? (historMA?.name ?? `[gelöscht: ${snap.standardAustraegerId.slice(0, 6)}…]`)
                          : '—';
                        const tourSnap = touren.find((t) => t.id === snap.tourId);
                        const aktuellTG = teilgebiete.find((tg) => tg.id === snap.id);
                        const aktuellMA = mitarbeiter.find(
                          (m) => m.id === aktuellTG?.standardAustraegerId
                        );
                        const hatGeaendert =
                          aktuellTG && aktuellTG.standardAustraegerId !== snap.standardAustraegerId;

                        return (
                          <tr
                            key={snap.id}
                            className={hatGeaendert ? 'bg-amber-50' : 'hover:bg-gray-50'}
                          >
                            <td className="px-4 py-2.5 font-medium text-gray-900">{snap.name}</td>
                            <td className="px-4 py-2.5 text-gray-500">{snap.plz}</td>
                            <td className="px-4 py-2.5 text-right text-gray-600">
                              {snap.stueckzahl.toLocaleString('de-DE')}
                            </td>
                            <td className="px-4 py-2.5 text-right text-gray-600">
                              {snap.wegstreckeM >= 1000
                                ? `${(snap.wegstreckeM / 1000).toFixed(1)} km`
                                : `${snap.wegstreckeM} m`}
                            </td>
                            <td className="px-4 py-2.5">
                              {tourSnap ? (
                                <span
                                  className="text-xs px-2 py-0.5 rounded-full text-white font-medium"
                                  style={{ backgroundColor: tourSnap.farbe }}
                                >
                                  {tourSnap.name}
                                </span>
                              ) : (
                                <span className="text-gray-400 text-xs">—</span>
                              )}
                            </td>
                            <td className="px-4 py-2.5 text-gray-700">{historMAName}</td>
                            <td className="px-4 py-2.5 text-xs">
                              {hatGeaendert ? (
                                <span className="text-amber-700 font-medium">
                                  ⚠ {aktuellMA?.name ?? '—'}
                                </span>
                              ) : aktuellTG ? (
                                <span className="text-green-600">✓ unverändert</span>
                              ) : (
                                <span className="text-gray-400">nicht mehr vorhanden</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
                <div className="bg-gray-50 border-t border-gray-200 px-4 py-2 text-xs text-gray-500 flex gap-4">
                  <span>{snapshots.length} Teilgebiete im Snapshot</span>
                  <span className="text-amber-600">
                    {
                      snapshots.filter((s) => {
                        const tg = teilgebiete.find((t) => t.id === s.id);
                        return tg && tg.standardAustraegerId !== s.standardAustraegerId;
                      }).length
                    }{' '}
                    mit geändertem Austräger seit Abschluss
                  </span>
                </div>
              </div>
            );
          })()}
      </div>
    </div>
  );
}

// ---- Bearbeitungsformular mit Tabs ----------------------------------------

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
  const [tab, setTab] = useState<TabId>('grunddaten');

  // Grunddaten
  const [form, setForm] = useState<typeof DEFAULT_FORM>(() =>
    initial
      ? {
          name: initial.name,
          plz: initial.plz,
          stueckzahl: initial.stueckzahl,
          stueckzahlManuell: initial.stueckzahlManuell ?? true,
          wegstreckeM: initial.wegstreckeM,
          tourId: initial.tourId,
          standardAustraegerId: initial.standardAustraegerId,
          isActive: initial.isActive,
        }
      : { ...DEFAULT_FORM }
  );

  // Straßenliste
  const [strassen, setStrassen] = useState<Strasse[]>(initial?.strassen ?? []);
  const [strasseEditId, setStrasseEditId] = useState<string | null>(null);
  const [strasseEditData, setStrasseEditData] = useState<Omit<Strasse, 'id'>>({
    strassenname: '',
    stueckzahl: 0,
    plusCode: '',
  });
  const [neueStrasse, setNeueStrasse] = useState<Omit<Strasse, 'id'>>({
    strassenname: '',
    stueckzahl: 0,
    plusCode: '',
  });

  // Sonderauslagen
  const [sonderauslagen, setSonderauslagen] = useState<Sonderauslage[]>(
    initial?.sonderauslagen ?? []
  );
  const [neueSonderauslage, setNeueSonderauslage] = useState<Omit<Sonderauslage, 'id'>>({
    bezeichnung: '',
    adresse: '',
    stueckzahl: 0,
  });

  // Nicht beliefern
  const [nichtBeliefen, setNichtBeliefen] = useState<NichtBeliefen[]>(
    initial?.nichtBeliefen ?? []
  );
  const [neueNichtBeliefen, setNeueNichtBeliefen] = useState<Omit<NichtBeliefen, 'id'>>({
    adresse: '',
    bemerkung: '',
  });

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Berechnete Stückzahl aus Straßenliste
  const strasseSumme = strassen.reduce((s, r) => s + (r.stueckzahl || 0), 0);
  const effektiveStueckzahl = form.stueckzahlManuell ? form.stueckzahl : strasseSumme;

  const austraeger = mitarbeiter.filter((m) => m.isActive && m.rollen.includes('austräger'));

  // ---- Speichern ----
  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) {
      setError('Name ist erforderlich.');
      return;
    }
    const stueckzahlFinal = form.stueckzahlManuell ? form.stueckzahl : strasseSumme;
    if (stueckzahlFinal <= 0 && form.stueckzahlManuell) {
      setError('Stückzahl muss größer als 0 sein.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const payload = {
        ...form,
        stueckzahl: stueckzahlFinal,
        strassen,
        sonderauslagen,
        nichtBeliefen,
      };
      if (initial) {
        await aktualisiereTeilgebiet(initial.id, payload);
      } else {
        await erstelleTeilgebiet(payload);
      }
      onSave();
    } catch (err) {
      setError('Fehler beim Speichern.');
      console.error(err);
    } finally {
      setSaving(false);
    }
  }

  // ---- Straßen-Aktionen ----
  function startEditStrasse(s: Strasse) {
    setStrasseEditId(s.id);
    setStrasseEditData({ strassenname: s.strassenname, stueckzahl: s.stueckzahl, plusCode: s.plusCode ?? '' });
  }
  function saveEditStrasse() {
    if (!strasseEditId) return;
    setStrassen((prev) =>
      prev.map((s) =>
        s.id === strasseEditId ? { ...s, ...strasseEditData } : s
      )
    );
    setStrasseEditId(null);
  }
  function cancelEditStrasse() {
    setStrasseEditId(null);
  }
  function deleteStrasse(id: string) {
    setStrassen((prev) => prev.filter((s) => s.id !== id));
  }
  function addStrasse() {
    if (!neueStrasse.strassenname.trim()) return;
    setStrassen((prev) => [...prev, { id: newId(), ...neueStrasse }]);
    setNeueStrasse({ strassenname: '', stueckzahl: 0, plusCode: '' });
  }

  // ---- Sonderauslagen-Aktionen ----
  function addSonderauslage() {
    if (!neueSonderauslage.bezeichnung.trim()) return;
    setSonderauslagen((prev) => [...prev, { id: newId(), ...neueSonderauslage }]);
    setNeueSonderauslage({ bezeichnung: '', adresse: '', stueckzahl: 0 });
  }
  function deleteSonderauslage(id: string) {
    setSonderauslagen((prev) => prev.filter((s) => s.id !== id));
  }

  // ---- Nicht-Beliefern-Aktionen ----
  function addNichtBeliefen() {
    if (!neueNichtBeliefen.adresse.trim()) return;
    setNichtBeliefen((prev) => [...prev, { id: newId(), ...neueNichtBeliefen }]);
    setNeueNichtBeliefen({ adresse: '', bemerkung: '' });
  }
  function deleteNichtBeliefen(id: string) {
    setNichtBeliefen((prev) => prev.filter((n) => n.id !== id));
  }

  // ---- Tab-Labels mit Badges ----
  const TABS: { id: TabId; label: string; count?: number }[] = [
    { id: 'grunddaten', label: 'Grunddaten' },
    { id: 'strassen', label: 'Straßenliste', count: strassen.length },
    { id: 'sonderauslagen', label: 'Sonderauslagen', count: sonderauslagen.length },
    { id: 'nichtBeliefen', label: 'Nicht beliefern', count: nichtBeliefen.length },
  ];

  return (
    <form onSubmit={handleSubmit} className="space-y-0">
      {/* Tab-Navigation */}
      <div className="flex border-b border-gray-200 mb-6 -mt-2 gap-0">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              tab === t.id
                ? 'border-blue-600 text-blue-700'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
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

      {/* ---- Tab: Grunddaten ---- */}
      {tab === 'grunddaten' && (
        <div className="space-y-4">
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
              <div className="flex items-center justify-between mb-1">
                <label className="text-sm font-medium text-gray-700">Stückzahl *</label>
                <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.stueckzahlManuell}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        stueckzahlManuell: e.target.checked,
                        // Bei Wechsel auf manuell: aktuelle berechnete Summe übernehmen
                        stueckzahl: e.target.checked ? strasseSumme || f.stueckzahl : f.stueckzahl,
                      }))
                    }
                    className="rounded"
                  />
                  Manuell
                </label>
              </div>
              {form.stueckzahlManuell ? (
                <input
                  type="number"
                  min="0"
                  value={form.stueckzahl || ''}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, stueckzahl: parseInt(e.target.value) || 0 }))
                  }
                  placeholder="450"
                  className={inputClass}
                />
              ) : (
                <div className={`${inputClass} bg-gray-50 text-gray-600 cursor-not-allowed flex items-center justify-between`}>
                  <span>{strasseSumme.toLocaleString('de-DE')}</span>
                  <span className="text-xs text-blue-500">∑ Straßenliste</span>
                </div>
              )}
              {!form.stueckzahlManuell && strassen.length === 0 && (
                <p className="text-xs text-amber-600 mt-1">
                  Keine Straßen erfasst — Stückzahl ist 0.
                </p>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Wegstrecke (Meter)
              </label>
              <input
                type="number"
                min="0"
                value={form.wegstreckeM || ''}
                onChange={(e) =>
                  setForm((f) => ({ ...f, wegstreckeM: parseInt(e.target.value) || 0 }))
                }
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
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Standardausträger
            </label>
            <select
              value={form.standardAustraegerId ?? ''}
              onChange={(e) =>
                setForm((f) => ({ ...f, standardAustraegerId: e.target.value || null }))
              }
              className={inputClass}
            >
              <option value="">Kein Standardausträger</option>
              {austraeger.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} ({m.nummer})
                </option>
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
        </div>
      )}

      {/* ---- Tab: Straßenliste ---- */}
      {tab === 'strassen' && (
        <div className="space-y-4">
          {/* Summen-Info */}
          <div className="flex items-center justify-between bg-blue-50 rounded-lg px-4 py-2.5 text-sm">
            <div className="flex gap-6">
              <span className="text-blue-700">
                Summe Straßen:{' '}
                <strong>{strasseSumme.toLocaleString('de-DE')} Stück</strong>
              </span>
              <span className={`${
                form.stueckzahlManuell
                  ? strasseSumme !== effektiveStueckzahl
                    ? 'text-amber-700'
                    : 'text-gray-500'
                  : 'text-gray-500'
              }`}>
                Gesamt-Stückzahl:{' '}
                <strong>{effektiveStueckzahl.toLocaleString('de-DE')}</strong>
                {form.stueckzahlManuell && strasseSumme !== form.stueckzahl && strassen.length > 0 && (
                  <span className="ml-1 text-amber-600 text-xs">⚠ Abweichung</span>
                )}
              </span>
            </div>
            {!form.stueckzahlManuell && (
              <span className="text-xs text-blue-500 bg-blue-100 px-2 py-1 rounded">
                Stückzahl wird automatisch berechnet
              </span>
            )}
          </div>

          {/* Straßen-Tabelle */}
          <div className="border border-gray-200 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-3 py-2 font-medium text-gray-600">Straße</th>
                  <th className="text-right px-3 py-2 font-medium text-gray-600">Stück</th>
                  <th className="text-left px-3 py-2 font-medium text-gray-600">PlusCode</th>
                  <th className="px-3 py-2 w-20"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {strassen.length === 0 && (
                  <tr>
                    <td colSpan={4} className="text-center py-6 text-gray-400 text-sm">
                      Noch keine Straßen erfasst
                    </td>
                  </tr>
                )}
                {strassen.map((s) =>
                  strasseEditId === s.id ? (
                    // Bearbeitungszeile
                    <tr key={s.id} className="bg-blue-50">
                      <td className="px-2 py-1.5">
                        <input
                          type="text"
                          value={strasseEditData.strassenname}
                          onChange={(e) =>
                            setStrasseEditData((d) => ({ ...d, strassenname: e.target.value }))
                          }
                          className={smallInputClass + ' w-full'}
                          autoFocus
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <input
                          type="number"
                          min="0"
                          value={strasseEditData.stueckzahl || ''}
                          onChange={(e) =>
                            setStrasseEditData((d) => ({
                              ...d,
                              stueckzahl: parseInt(e.target.value) || 0,
                            }))
                          }
                          className={smallInputClass + ' w-20 text-right'}
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <input
                          type="text"
                          value={strasseEditData.plusCode ?? ''}
                          onChange={(e) =>
                            setStrasseEditData((d) => ({ ...d, plusCode: e.target.value }))
                          }
                          placeholder="8FW4+XQ"
                          className={smallInputClass + ' w-full'}
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <div className="flex gap-1">
                          <button
                            type="button"
                            onClick={saveEditStrasse}
                            className="text-green-600 hover:text-green-800 text-xs font-medium"
                          >
                            ✓
                          </button>
                          <button
                            type="button"
                            onClick={cancelEditStrasse}
                            className="text-gray-400 hover:text-gray-600 text-xs"
                          >
                            ✕
                          </button>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    // Anzeigezeile
                    <tr key={s.id} className="hover:bg-gray-50">
                      <td className="px-3 py-2 text-gray-800">{s.strassenname}</td>
                      <td className="px-3 py-2 text-right text-gray-600">
                        {s.stueckzahl.toLocaleString('de-DE')}
                      </td>
                      <td className="px-3 py-2 text-gray-400 font-mono text-xs">
                        {s.plusCode || '—'}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => startEditStrasse(s)}
                            className="text-blue-600 hover:text-blue-800 text-xs"
                          >
                            ✎
                          </button>
                          <button
                            type="button"
                            onClick={() => deleteStrasse(s.id)}
                            className="text-red-400 hover:text-red-600 text-xs"
                          >
                            ✕
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                )}
              </tbody>
              {/* Summenzeile */}
              {strassen.length > 0 && (
                <tfoot className="bg-gray-50 border-t border-gray-200">
                  <tr>
                    <td className="px-3 py-2 text-sm font-medium text-gray-600">
                      Gesamt ({strassen.length} Straßen)
                    </td>
                    <td className="px-3 py-2 text-right font-bold text-gray-800">
                      {strasseSumme.toLocaleString('de-DE')}
                    </td>
                    <td colSpan={2}></td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>

          {/* Neue Straße hinzufügen */}
          <div className="border border-dashed border-gray-300 rounded-lg p-3">
            <p className="text-xs font-medium text-gray-500 mb-2">Straße hinzufügen</p>
            <div className="flex gap-2 items-end">
              <div className="flex-1">
                <label className="block text-xs text-gray-500 mb-1">Straßenname *</label>
                <input
                  type="text"
                  value={neueStrasse.strassenname}
                  onChange={(e) =>
                    setNeueStrasse((n) => ({ ...n, strassenname: e.target.value }))
                  }
                  placeholder="Musterstraße"
                  className={smallInputClass + ' w-full'}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addStrasse(); } }}
                />
              </div>
              <div className="w-24">
                <label className="block text-xs text-gray-500 mb-1">Stückzahl</label>
                <input
                  type="number"
                  min="0"
                  value={neueStrasse.stueckzahl || ''}
                  onChange={(e) =>
                    setNeueStrasse((n) => ({ ...n, stueckzahl: parseInt(e.target.value) || 0 }))
                  }
                  placeholder="50"
                  className={smallInputClass + ' w-full text-right'}
                />
              </div>
              <div className="w-36">
                <label className="block text-xs text-gray-500 mb-1">PlusCode</label>
                <input
                  type="text"
                  value={neueStrasse.plusCode ?? ''}
                  onChange={(e) =>
                    setNeueStrasse((n) => ({ ...n, plusCode: e.target.value }))
                  }
                  placeholder="8FW4+XQ"
                  className={smallInputClass + ' w-full font-mono'}
                />
              </div>
              <button
                type="button"
                onClick={addStrasse}
                disabled={!neueStrasse.strassenname.trim()}
                className="bg-blue-600 text-white px-3 py-1.5 rounded text-sm font-medium hover:bg-blue-700 disabled:opacity-40 transition-colors"
              >
                + Hinzufügen
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---- Tab: Sonderauslagen ---- */}
      {tab === 'sonderauslagen' && (
        <div className="space-y-4">
          <p className="text-sm text-gray-500">
            Orte, an denen ein Austräger Exemplare stapelweise abgeben kann (z.B. Bäcker, Arztpraxis).
          </p>

          {/* Liste */}
          {sonderauslagen.length === 0 ? (
            <div className="border border-gray-200 rounded-lg p-6 text-center text-gray-400 text-sm">
              Keine Sonderauslagen erfasst
            </div>
          ) : (
            <div className="border border-gray-200 rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium text-gray-600">Bezeichnung</th>
                    <th className="text-left px-3 py-2 font-medium text-gray-600">Adresse</th>
                    <th className="text-right px-3 py-2 font-medium text-gray-600">Stück</th>
                    <th className="px-3 py-2 w-10"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {sonderauslagen.map((s) => (
                    <tr key={s.id} className="hover:bg-gray-50">
                      <td className="px-3 py-2 font-medium text-gray-800">{s.bezeichnung}</td>
                      <td className="px-3 py-2 text-gray-500">{s.adresse || '—'}</td>
                      <td className="px-3 py-2 text-right text-gray-700">
                        {s.stueckzahl.toLocaleString('de-DE')}
                      </td>
                      <td className="px-3 py-2">
                        <button
                          type="button"
                          onClick={() => deleteSonderauslage(s.id)}
                          className="text-red-400 hover:text-red-600 text-xs"
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-gray-50 border-t border-gray-200">
                  <tr>
                    <td colSpan={2} className="px-3 py-2 text-xs text-gray-500">
                      Gesamt ({sonderauslagen.length})
                    </td>
                    <td className="px-3 py-2 text-right font-bold text-gray-700 text-sm">
                      {sonderauslagen.reduce((s, a) => s + (a.stueckzahl || 0), 0).toLocaleString('de-DE')}
                    </td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          {/* Neue Sonderauslage */}
          <div className="border border-dashed border-gray-300 rounded-lg p-3">
            <p className="text-xs font-medium text-gray-500 mb-2">Sonderauslage hinzufügen</p>
            <div className="flex gap-2 items-end">
              <div className="flex-1">
                <label className="block text-xs text-gray-500 mb-1">Bezeichnung *</label>
                <input
                  type="text"
                  value={neueSonderauslage.bezeichnung}
                  onChange={(e) =>
                    setNeueSonderauslage((n) => ({ ...n, bezeichnung: e.target.value }))
                  }
                  placeholder="Bäckerei Müller"
                  className={smallInputClass + ' w-full'}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addSonderauslage(); } }}
                />
              </div>
              <div className="flex-1">
                <label className="block text-xs text-gray-500 mb-1">Adresse</label>
                <input
                  type="text"
                  value={neueSonderauslage.adresse ?? ''}
                  onChange={(e) =>
                    setNeueSonderauslage((n) => ({ ...n, adresse: e.target.value }))
                  }
                  placeholder="Hauptstr. 5"
                  className={smallInputClass + ' w-full'}
                />
              </div>
              <div className="w-24">
                <label className="block text-xs text-gray-500 mb-1">Stückzahl</label>
                <input
                  type="number"
                  min="0"
                  value={neueSonderauslage.stueckzahl || ''}
                  onChange={(e) =>
                    setNeueSonderauslage((n) => ({
                      ...n,
                      stueckzahl: parseInt(e.target.value) || 0,
                    }))
                  }
                  placeholder="25"
                  className={smallInputClass + ' w-full text-right'}
                />
              </div>
              <button
                type="button"
                onClick={addSonderauslage}
                disabled={!neueSonderauslage.bezeichnung.trim()}
                className="bg-blue-600 text-white px-3 py-1.5 rounded text-sm font-medium hover:bg-blue-700 disabled:opacity-40 transition-colors"
              >
                + Hinzufügen
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---- Tab: Nicht beliefern ---- */}
      {tab === 'nichtBeliefen' && (
        <div className="space-y-4">
          <p className="text-sm text-gray-500">
            Adressen, an die explizit <strong>nicht</strong> geliefert werden soll.
          </p>

          {/* Liste */}
          {nichtBeliefen.length === 0 ? (
            <div className="border border-gray-200 rounded-lg p-6 text-center text-gray-400 text-sm">
              Keine Sperradressen erfasst
            </div>
          ) : (
            <div className="border border-gray-200 rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium text-gray-600">Adresse</th>
                    <th className="text-left px-3 py-2 font-medium text-gray-600">Bemerkung</th>
                    <th className="px-3 py-2 w-10"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {nichtBeliefen.map((n) => (
                    <tr key={n.id} className="hover:bg-gray-50">
                      <td className="px-3 py-2 font-medium text-gray-800">{n.adresse}</td>
                      <td className="px-3 py-2 text-gray-500">{n.bemerkung || '—'}</td>
                      <td className="px-3 py-2">
                        <button
                          type="button"
                          onClick={() => deleteNichtBeliefen(n.id)}
                          className="text-red-400 hover:text-red-600 text-xs"
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Neue Sperrung */}
          <div className="border border-dashed border-gray-300 rounded-lg p-3">
            <p className="text-xs font-medium text-gray-500 mb-2">Adresse hinzufügen</p>
            <div className="flex gap-2 items-end">
              <div className="flex-1">
                <label className="block text-xs text-gray-500 mb-1">Adresse *</label>
                <input
                  type="text"
                  value={neueNichtBeliefen.adresse}
                  onChange={(e) =>
                    setNeueNichtBeliefen((n) => ({ ...n, adresse: e.target.value }))
                  }
                  placeholder="Musterstraße 12"
                  className={smallInputClass + ' w-full'}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addNichtBeliefen(); } }}
                />
              </div>
              <div className="flex-1">
                <label className="block text-xs text-gray-500 mb-1">Bemerkung</label>
                <input
                  type="text"
                  value={neueNichtBeliefen.bemerkung ?? ''}
                  onChange={(e) =>
                    setNeueNichtBeliefen((n) => ({ ...n, bemerkung: e.target.value }))
                  }
                  placeholder="Abbestellt"
                  className={smallInputClass + ' w-full'}
                />
              </div>
              <button
                type="button"
                onClick={addNichtBeliefen}
                disabled={!neueNichtBeliefen.adresse.trim()}
                className="bg-red-600 text-white px-3 py-1.5 rounded text-sm font-medium hover:bg-red-700 disabled:opacity-40 transition-colors"
              >
                + Hinzufügen
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Fehler + Aktionen (immer sichtbar) */}
      {error && <p className="text-red-600 text-sm mt-4">{error}</p>}

      <div className="flex justify-between items-center gap-3 pt-6 mt-4 border-t border-gray-100">
        <div className="text-xs text-gray-400">
          {!form.stueckzahlManuell && (
            <span>
              Stückzahl wird aus {strassen.length} Straße{strassen.length !== 1 ? 'n' : ''} berechnet
              ({strasseSumme.toLocaleString('de-DE')} Stück)
            </span>
          )}
        </div>
        <div className="flex gap-3">
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
      </div>
    </form>
  );
}
