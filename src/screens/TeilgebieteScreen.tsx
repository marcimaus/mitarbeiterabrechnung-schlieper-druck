import { useState, type FormEvent } from 'react';
import { useApp } from '../context/AppContext';
import AdminPinGate from '../components/AdminPinGate';
import Modal from '../components/Modal';
import { bestaetigeMonatswechselEinmalProSession } from '../utils';
import {
  erstelleTeilgebiet,
  aktualisiereTeilgebiet,
  aktualisiereMitarbeiter,
  erstelleVerteilplanVorschlag,
  aktualisiereVerteilplanVorschlag,
  loescheVerteilplanVorschlag,
} from '../lib/db';
import type {
  Teilgebiet,
  Strasse,
  Sonderauslage,
  NichtBeliefen,
  Mitarbeiter,
  Abrechnungsperiode,
  VerteilplanVorschlag,
} from '../types';

// ---- Hilfsfunktionen -------------------------------------------------------

const newId = () => `${Date.now()}_${Math.floor(Math.random() * 100000)}`;

type TabId = 'grunddaten' | 'strassen' | 'sonderauslagen' | 'nichtBeliefen' | 'freigaben';

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
  istAuslagestelle: false,
};

const inputClass =
  'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';
const smallInputClass =
  'border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500';

// ---- Hauptkomponente -------------------------------------------------------

export default function TeilgebieteScreen() {
  return (
    <AdminPinGate allowedRoles={['admin', 'abrechnung']}>
      <TeilgebieteInhalt />
    </AdminPinGate>
  );
}

function TeilgebieteInhalt() {
  const { teilgebiete, touren, mitarbeiter, abrechnungsperioden, parameter, userRole, verteilplanVorschlaege, adminName } = useApp();
  // Abrechnung-Rolle: nur lesender Zugriff (keine Bearbeitung).
  const isAdmin = userRole === 'admin';
  const [hauptview, setHauptview] = useState<'liste' | 'vorschlaege'>('liste');
  const offeneVorschlaegeAnzahl = verteilplanVorschlaege.length;

  // Zeitwert (Stunden) aus Wegstrecke + Stückzahl
  const zeitwertStunden = (tg: Teilgebiet): number => {
    if (!parameter) return 0;
    const laufH = parameter.laufgeschwindigkeitMProH > 0
      ? tg.wegstreckeM / parameter.laufgeschwindigkeitMProH : 0;
    const steckH = parameter.steckzeitStkProH > 0
      ? tg.stueckzahl / parameter.steckzeitStkProH : 0;
    return laufH + steckH;
  };
  const formatZeitwert = (tg: Teilgebiet) => {
    if (!parameter) return '—';
    const totalMin = Math.round(zeitwertStunden(tg) * 60);
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    return `${h}:${m.toString().padStart(2, '0')} h`;
  };
  const formatEur = (betrag: number) =>
    betrag.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
  const [showForm, setShowForm] = useState(false);
  const [editTarget, setEditTarget] = useState<Teilgebiet | null>(null);
  const [filterText, setFilterText] = useState('');
  const [filterTour, setFilterTour] = useState('');
  const [filterAustraegerId, setFilterAustraegerId] = useState('');
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
    if (filterAustraegerId) {
      if (filterAustraegerId === '__keiner__') {
        // „Ohne Austräger" zeigt nur echte unbesetzte Gebiete — Auslagestellen
        // brauchen keinen Austräger und werden hier ausgeschlossen.
        if (tg.standardAustraegerId || tg.istAuslagestelle) return false;
      } else if (tg.standardAustraegerId !== filterAustraegerId) {
        return false;
      }
    }
    return true;
  });

  // Austräger-Filterliste (alle Mitarbeiter mit Rolle 'austräger'), sortiert
  const austraegerOptionen = mitarbeiter
    .filter((m) => m.rollen.includes('austräger'))
    .sort((a, b) => a.name.localeCompare(b.name));

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
        {isAdmin && hauptview === 'liste' && (
          <button
            onClick={() => {
              setEditTarget(null);
              setShowForm(true);
            }}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
          >
            + Neues Teilgebiet
          </button>
        )}
      </div>

      {/* View-Switcher: Liste / Vorschläge */}
      <div className="flex border-b border-gray-200 mb-5">
        <button
          type="button"
          onClick={() => setHauptview('liste')}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            hauptview === 'liste'
              ? 'border-blue-600 text-blue-700'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          Teilgebiete
        </button>
        <button
          type="button"
          onClick={() => setHauptview('vorschlaege')}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            hauptview === 'vorschlaege'
              ? 'border-blue-600 text-blue-700'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          Verteilplan-Vorschläge
          {offeneVorschlaegeAnzahl > 0 && (
            <span className="ml-1.5 bg-amber-100 text-amber-800 text-xs px-1.5 py-0.5 rounded-full">
              {offeneVorschlaegeAnzahl}
            </span>
          )}
        </button>
      </div>

      {hauptview === 'vorschlaege' && <VorschlaegeView />}

      {hauptview === 'liste' && (
      <>
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
        <select
          value={filterAustraegerId}
          onChange={(e) => setFilterAustraegerId(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          title="Filter auf Standardausträger"
        >
          <option value="">Alle Austräger</option>
          <option value="__keiner__">Ohne Austräger</option>
          {austraegerOptionen.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
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
        {(filterText || filterTour || filterAustraegerId) && (
          <button
            type="button"
            onClick={() => { setFilterText(''); setFilterTour(''); setFilterAustraegerId(''); }}
            className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1"
          >
            ✕ Filter zurücksetzen
          </button>
        )}
        <span className="text-xs text-gray-400 ml-auto self-center">
          {gefiltert.length} {gefiltert.length === 1 ? 'Teilgebiet' : 'Teilgebiete'}
        </span>
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
              <th className="text-right px-4 py-3 font-medium text-gray-600" title="Zeitwert aus Wegstrecke + Stückzahl laut Parameter">Zeitwert</th>
              <th className="text-right px-4 py-3 font-medium text-gray-600" title="Mindestlohn Austräger je Ausgabe ohne Beilagen / Gewichtszuschlag — Erwachsen / Minderjährig">Mindestlohn<br /><span className="text-[10px] font-normal text-gray-400">erw. / minderj.</span></th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Tour</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Standardausträger</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {gefiltert.length === 0 && (
              <tr>
                <td colSpan={9} className="text-center py-8 text-gray-400">
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
                <td className="px-4 py-3 text-right text-gray-700 font-mono text-xs">
                  {formatZeitwert(tg)}
                </td>
                <td className="px-4 py-3 text-right text-gray-700 font-mono text-xs">
                  {parameter ? (
                    <>
                      <div>{formatEur(zeitwertStunden(tg) * parameter.stundenlohnErwachseneAustr)}</div>
                      <div className="text-gray-400">{formatEur(zeitwertStunden(tg) * parameter.stundenlohnMinderjAustr)}</div>
                    </>
                  ) : '—'}
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
                  {tg.istAuslagestelle ? (
                    <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full font-medium">
                      📦 Auslagestelle
                    </span>
                  ) : (
                    getAustraeger(tg.standardAustraegerId)
                  )}
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    onClick={() => {
                      setEditTarget(tg);
                      setShowForm(true);
                    }}
                    className="text-blue-600 hover:text-blue-800 text-xs font-medium"
                  >
                    {isAdmin ? 'Bearbeiten' : 'Anzeigen'}
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

      <TeilgebietVerlauf
        teilgebiete={teilgebiete}
        abrechnungsperioden={abrechnungsperioden}
      />
      </>
      )}
    </div>
  );

  // ---- Verteilplan-Vorschläge (Reiter) ------------------------------------
  function VorschlaegeView() {
    return (
      <VerteilplanVorschlaegeReiter
        teilgebiete={teilgebiete}
        mitarbeiter={mitarbeiter}
        abrechnungsperioden={abrechnungsperioden}
        verteilplanVorschlaege={verteilplanVorschlaege}
        isAdmin={isAdmin}
        adminName={adminName}
      />
    );
  }
}

// ---- Historischer Verlauf je Teilgebiet ------------------------------------

function TeilgebietVerlauf({
  teilgebiete,
  abrechnungsperioden,
}: {
  teilgebiete: import('../types').Teilgebiet[];
  abrechnungsperioden: import('../types').Abrechnungsperiode[];
}) {
  const [ausgewaehlteTgId, setAusgewaehlteTgId] = useState('');

  // Alle Perioden mit Snapshot, nach Datum absteigend
  const periodenMitSnapshot = [...abrechnungsperioden]
    .filter((p) => p.periodeSnapshot?.teilgebietSnapshots?.length)
    .sort((a, b) => b.jahr !== a.jahr ? b.jahr - a.jahr : b.monat - a.monat);

  // Verlaufszeilen für das gewählte Teilgebiet
  const verlauf = periodenMitSnapshot.map((p) => {
    const snap = p.periodeSnapshot!.teilgebietSnapshots.find((s) => s.id === ausgewaehlteTgId);
    return snap ? { periode: p, snap } : null;
  }).filter(Boolean) as { periode: import('../types').Abrechnungsperiode; snap: import('../types').TeilgebietSnapshot }[];

  // Aktueller Wert zum Vergleich
  const aktuellTG = teilgebiete.find((tg) => tg.id === ausgewaehlteTgId);

  return (
    <div className="mt-10">
      <h2 className="text-lg font-bold text-gray-800 mb-3">
        Historischer Verlauf je Teilgebiet
      </h2>

      <div className="flex items-center gap-3 mb-4">
        <select
          value={ausgewaehlteTgId}
          onChange={(e) => setAusgewaehlteTgId(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-64"
        >
          <option value="">— Teilgebiet auswählen —</option>
          {[...teilgebiete]
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((tg) => (
              <option key={tg.id} value={tg.id}>
                {tg.name} {tg.plz ? `(${tg.plz})` : ''}
              </option>
            ))}
        </select>
        {ausgewaehlteTgId && verlauf.length === 0 && (
          <span className="text-xs text-gray-400">
            Kein historischer Snapshot für dieses Teilgebiet vorhanden.
          </span>
        )}
      </div>

      {ausgewaehlteTgId && verlauf.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Abrechnungsperiode</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Abgeschlossen</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">Stückzahl</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">Wegstrecke</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {verlauf.map(({ periode, snap }) => (
                <tr key={periode.id} className="hover:bg-gray-50">
                  <td className="px-4 py-2.5 font-medium text-gray-900">{periode.bezeichnung}</td>
                  <td className="px-4 py-2.5 text-gray-500 text-xs">
                    {periode.gesperrtAm
                      ? new Date(periode.gesperrtAm).toLocaleDateString('de-DE')
                      : '—'}
                  </td>
                  <td className="px-4 py-2.5 text-right text-gray-700">
                    {snap.stueckzahl.toLocaleString('de-DE')}
                  </td>
                  <td className="px-4 py-2.5 text-right text-gray-700">
                    {snap.wegstreckeM >= 1000
                      ? `${(snap.wegstreckeM / 1000).toFixed(1)} km`
                      : `${snap.wegstreckeM} m`}
                  </td>
                </tr>
              ))}
            </tbody>
            {/* Aktuelle Werte als Vergleichszeile */}
            {aktuellTG && (
              <tfoot className="bg-blue-50 border-t-2 border-blue-200">
                <tr>
                  <td className="px-4 py-2.5 font-semibold text-blue-800">Aktuell</td>
                  <td className="px-4 py-2.5 text-blue-500 text-xs">heute</td>
                  <td className="px-4 py-2.5 text-right font-semibold text-blue-800">
                    {aktuellTG.stueckzahl.toLocaleString('de-DE')}
                  </td>
                  <td className="px-4 py-2.5 text-right font-semibold text-blue-800">
                    {aktuellTG.wegstreckeM >= 1000
                      ? `${(aktuellTG.wegstreckeM / 1000).toFixed(1)} km`
                      : `${aktuellTG.wegstreckeM} m`}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
          <div className="bg-gray-50 border-t border-gray-200 px-4 py-2 text-xs text-gray-500">
            {verlauf.length} Abrechnungsperiode{verlauf.length !== 1 ? 'n' : ''} mit Snapshot für dieses Teilgebiet
          </div>
        </div>
      )}
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
  const { touren, mitarbeiter, userRole } = useApp();
  const isAdmin = userRole === 'admin';
  const [tab, setTab] = useState<TabId>('grunddaten');
  const [nurAktiveAustraeger, setNurAktiveAustraeger] = useState(true);

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
          istAuslagestelle: initial.istAuslagestelle ?? false,
          auslagestelleAdresse: initial.auslagestelleAdresse,
          auslagestelleKontaktName: initial.auslagestelleKontaktName,
          auslagestelleKontaktTelefon: initial.auslagestelleKontaktTelefon,
          auslagestelleKontaktEmail: initial.auslagestelleKontaktEmail,
          auslagestelleMemo: initial.auslagestelleMemo,
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

  // Freigaben: Set der Mitarbeiter-IDs, die dieses Teilgebiet bedienen dürfen
  const initialFreigabenIds = initial
    ? mitarbeiter
        .filter((m) => (m.teilgebietFreigaben ?? []).includes(initial.id))
        .map((m) => m.id)
    : [];
  const [freigegebeneMitarbeiterIds, setFreigegebeneMitarbeiterIds] =
    useState<string[]>(initialFreigabenIds);
  const [freigabeFilter, setFreigabeFilter] = useState('');
  const [freigabeNurAktive, setFreigabeNurAktive] = useState(true);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Berechnete Stückzahl aus Straßenliste
  const strasseSumme = strassen.reduce((s, r) => s + (r.stueckzahl || 0), 0);
  const effektiveStueckzahl = form.stueckzahlManuell ? form.stueckzahl : strasseSumme;

  // Nur Mitarbeiter mit expliziter Freigabe für dieses Teilgebiet (aus der aktuellen Freigabeliste).
  // Strikt: auch bei neuem TG muss der MA in der Freigabeliste dieses Formulars stehen.
  const austraeger = mitarbeiter.filter((m) => {
    // Abgemeldete MAs werden nie als Standardausträger angeboten.
    // Noch-nicht-Angemeldete dürfen ausgewählt werden — die Abrechnung warnt.
    if (m.abgemeldet) return false;
    if (nurAktiveAustraeger && !m.isActive) return false;
    return freigegebeneMitarbeiterIds.includes(m.id);
  });

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
    // Session-Confirm: Standardausträger geändert? Einmal pro Session
    // nachfragen, ob der Monatswechsel durchgeführt wurde — sonst kann die
    // laufende Periode rückwirkend verschoben werden.
    if (initial && initial.standardAustraegerId !== form.standardAustraegerId) {
      if (!bestaetigeMonatswechselEinmalProSession()) {
        return;
      }
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
        // Auslagestelle: keine Wegstrecke, kein Austräger
        ...(form.istAuslagestelle
          ? { wegstreckeM: 0, standardAustraegerId: null }
          : {}),
      };
      let tgId: string;
      if (initial) {
        await aktualisiereTeilgebiet(initial.id, payload);
        tgId = initial.id;
      } else {
        tgId = await erstelleTeilgebiet(payload);
      }

      // Freigaben je Mitarbeiter synchronisieren
      const alt = new Set(initialFreigabenIds);
      const neu = new Set(freigegebeneMitarbeiterIds);
      const hinzuzufuegen = [...neu].filter((id) => !alt.has(id));
      const zuEntfernen = [...alt].filter((id) => !neu.has(id));

      const updates: Promise<void>[] = [];
      for (const maId of hinzuzufuegen) {
        const m = mitarbeiter.find((x) => x.id === maId);
        if (!m) continue;
        const liste = [...(m.teilgebietFreigaben ?? [])];
        if (!liste.includes(tgId)) liste.push(tgId);
        updates.push(aktualisiereMitarbeiter(maId, { teilgebietFreigaben: liste }));
      }
      for (const maId of zuEntfernen) {
        const m = mitarbeiter.find((x) => x.id === maId);
        if (!m) continue;
        const liste = (m.teilgebietFreigaben ?? []).filter((x) => x !== tgId);
        updates.push(aktualisiereMitarbeiter(maId, { teilgebietFreigaben: liste }));
      }
      await Promise.all(updates);

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
    { id: 'freigaben', label: 'Freigaben', count: freigegebeneMitarbeiterIds.length },
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

          {/* Auslagestelle-Schalter */}
          <label className="flex items-start gap-2 text-sm text-gray-700 bg-purple-50 border border-purple-200 rounded-lg px-3 py-2">
            <input
              type="checkbox"
              checked={form.istAuslagestelle ?? false}
              onChange={(e) => setForm((f) => ({ ...f, istAuslagestelle: e.target.checked }))}
              disabled={!isAdmin}
              className="rounded mt-0.5"
            />
            <span>
              <span className="font-medium">📦 Auslagestelle (kein Austräger)</span>
              <span className="block text-xs text-gray-600">
                Reines Auslage-Gebiet: Fahrer legt an einer Adresse aus, Leser holen sich Exemplare. Kein Standardausträger, kein Springer, keine Wegstrecke.
              </span>
            </span>
          </label>

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
                disabled={form.istAuslagestelle}
                className={`${inputClass} ${form.istAuslagestelle ? 'bg-gray-50 text-gray-400' : ''}`}
              />
              {form.istAuslagestelle && (
                <p className="text-xs text-gray-400 mt-0.5">Bei Auslagestelle nicht relevant.</p>
              )}
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

          {!form.istAuslagestelle && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-sm font-medium text-gray-700">
                  Standardausträger
                  {initial && (
                    <span className="ml-1 text-xs font-normal text-gray-400">
                      (nur mit Gebietsfreigabe)
                    </span>
                  )}
                </label>
                <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={nurAktiveAustraeger}
                    onChange={(e) => setNurAktiveAustraeger(e.target.checked)}
                    className="rounded"
                  />
                  nur aktive
                </label>
              </div>
              <select
                value={form.standardAustraegerId ?? ''}
                onChange={(e) =>
                  setForm((f) => ({ ...f, standardAustraegerId: e.target.value || null }))
                }
                className={inputClass}
              >
                <option value="">Kein Standardausträger</option>
                {austraeger.length === 0 && (
                  <option disabled value="">— keine Freigaben für dieses Gebiet vergeben —</option>
                )}
                {austraeger.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} ({m.nummer}){!m.isActive ? ' [inaktiv]' : ''}
                  </option>
                ))}
                {/* Falls bereits ein Standardausträger gesetzt ist, der NICHT freigegeben ist:
                    trotzdem anzeigen, damit der Wert nicht unsichtbar verloren geht. */}
                {form.standardAustraegerId &&
                  !austraeger.some((m) => m.id === form.standardAustraegerId) && (() => {
                    const ma = mitarbeiter.find((m) => m.id === form.standardAustraegerId);
                    if (!ma) return null;
                    return (
                      <option value={ma.id}>
                        ⚠ {ma.name} ({ma.nummer}) — ohne Freigabe
                      </option>
                    );
                  })()}
              </select>
            </div>
          )}

          {/* Auslagestelle-Felder: nur sichtbar wenn istAuslagestelle */}
          {form.istAuslagestelle && (
            <div className="bg-purple-50 border border-purple-200 rounded-lg p-3 space-y-3">
              <div className="text-sm font-semibold text-purple-900">📦 Auslagestelle — Adresse &amp; Ansprechpartner</div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Anlieferungsadresse
                </label>
                <input
                  type="text"
                  value={form.auslagestelleAdresse ?? ''}
                  onChange={(e) => setForm((f) => ({ ...f, auslagestelleAdresse: e.target.value || undefined }))}
                  placeholder="z. B. Bäckerei Müller, Hauptstr. 12, 37170 Uslar"
                  className={inputClass}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Kontaktperson (Name)</label>
                  <input
                    type="text"
                    value={form.auslagestelleKontaktName ?? ''}
                    onChange={(e) => setForm((f) => ({ ...f, auslagestelleKontaktName: e.target.value || undefined }))}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Telefon</label>
                  <input
                    type="tel"
                    value={form.auslagestelleKontaktTelefon ?? ''}
                    onChange={(e) => setForm((f) => ({ ...f, auslagestelleKontaktTelefon: e.target.value || undefined }))}
                    className={inputClass}
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">E-Mail</label>
                <input
                  type="email"
                  value={form.auslagestelleKontaktEmail ?? ''}
                  onChange={(e) => setForm((f) => ({ ...f, auslagestelleKontaktEmail: e.target.value || undefined }))}
                  className={inputClass}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Memo (Absprachen mit Kontaktperson)
                </label>
                <textarea
                  value={form.auslagestelleMemo ?? ''}
                  onChange={(e) => setForm((f) => ({ ...f, auslagestelleMemo: e.target.value || undefined }))}
                  rows={3}
                  placeholder="z. B. Schlüssel hinter Tonne, Anlieferung nur Mo/Mi …"
                  className={inputClass}
                />
              </div>
            </div>
          )}

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
                      <td className="px-3 py-2 font-mono text-xs">
                        {s.plusCode ? (
                          <a
                            href={`https://plus.codes/${s.plusCode}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-600 hover:text-blue-800 hover:underline"
                          >
                            {s.plusCode}
                          </a>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
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

      {/* ---- Tab: Freigaben ---- */}
      {tab === 'freigaben' && (
        <div className="space-y-4">
          <p className="text-sm text-gray-500">
            Mitarbeiter mit der Rolle <strong>Austräger</strong>, die dieses Teilgebiet bedienen dürfen.
            Die Freigabe ist bidirektional: Änderungen hier werden auch auf die jeweiligen Mitarbeiter-Stammdaten übertragen.
          </p>

          {/* Filter + Zähler */}
          <div className="flex items-center gap-3 flex-wrap">
            <input
              type="text"
              placeholder="Mitarbeiter suchen..."
              value={freigabeFilter}
              onChange={(e) => setFreigabeFilter(e.target.value)}
              className={smallInputClass + ' w-56'}
            />
            <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer">
              <input
                type="checkbox"
                checked={freigabeNurAktive}
                onChange={(e) => setFreigabeNurAktive(e.target.checked)}
                className="rounded"
              />
              nur aktive
            </label>
            <span className="ml-auto text-xs text-gray-500">
              {freigegebeneMitarbeiterIds.length} Freigabe
              {freigegebeneMitarbeiterIds.length !== 1 ? 'n' : ''}
            </span>
          </div>

          {/* Liste */}
          <div className="border border-gray-200 rounded-lg overflow-hidden max-h-96 overflow-y-auto">
            {(() => {
              const sichtbar = mitarbeiter
                .filter((m) => m.rollen?.includes('austräger'))
                .filter((m) => !m.abgemeldet)
                .filter((m) => !freigabeNurAktive || m.isActive)
                .filter((m) => {
                  if (!freigabeFilter.trim()) return true;
                  const s = freigabeFilter.toLowerCase();
                  return (
                    m.name.toLowerCase().includes(s) || m.nummer.includes(freigabeFilter)
                  );
                })
                .sort((a, b) => a.name.localeCompare(b.name));

              if (sichtbar.length === 0) {
                return (
                  <div className="text-center py-6 text-gray-400 text-sm">
                    Keine passenden Mitarbeiter gefunden.
                  </div>
                );
              }

              return (
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b border-gray-200 sticky top-0">
                    <tr>
                      <th className="px-3 py-2 w-10"></th>
                      <th className="text-left px-3 py-2 font-medium text-gray-600">Name</th>
                      <th className="text-left px-3 py-2 font-medium text-gray-600">Nummer</th>
                      <th className="text-left px-3 py-2 font-medium text-gray-600">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {sichtbar.map((m) => {
                      const checked = freigegebeneMitarbeiterIds.includes(m.id);
                      return (
                        <tr
                          key={m.id}
                          className={`hover:bg-gray-50 cursor-pointer ${checked ? 'bg-blue-50/40' : ''}`}
                          onClick={() =>
                            setFreigegebeneMitarbeiterIds((prev) =>
                              checked ? prev.filter((x) => x !== m.id) : [...prev, m.id]
                            )
                          }
                        >
                          <td className="px-3 py-2">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() =>
                                setFreigegebeneMitarbeiterIds((prev) =>
                                  checked ? prev.filter((x) => x !== m.id) : [...prev, m.id]
                                )
                              }
                              onClick={(e) => e.stopPropagation()}
                              className="rounded"
                            />
                          </td>
                          <td className="px-3 py-2 font-medium text-gray-800">{m.name}</td>
                          <td className="px-3 py-2 text-gray-500 font-mono text-xs">{m.nummer}</td>
                          <td className="px-3 py-2 text-xs">
                            {m.isActive ? (
                              <span className="text-green-700">aktiv</span>
                            ) : (
                              <span className="text-gray-400">inaktiv</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              );
            })()}
          </div>

          {!initial && (
            <p className="text-xs text-amber-600">
              Hinweis: Bei einem neuen Teilgebiet werden die Freigaben erst nach dem Speichern wirksam.
            </p>
          )}
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
            {isAdmin ? 'Abbrechen' : 'Schließen'}
          </button>
          {isAdmin && (
            <button
              type="submit"
              disabled={saving}
              className="bg-blue-600 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {saving ? 'Speichere...' : initial ? 'Speichern' : 'Erstellen'}
            </button>
          )}
        </div>
      </div>
    </form>
  );
}

// ---- Verteilplan-Vorschläge (Reiter-Inhalt) -----------------------------------

function MaStatusBadge({ ma }: { ma: Mitarbeiter | undefined }) {
  if (!ma) return <span className="text-gray-300 text-xs">— unbekannt —</span>;
  if (ma.abgemeldet) {
    return (
      <span className="text-[10px] bg-red-100 text-red-700 border border-red-200 px-1.5 py-0.5 rounded">
        🚫 abgemeldet
      </span>
    );
  }
  if (ma.nochNichtAngemeldet) {
    const detail =
      ma.anmeldungStatus === 'fragebogen-beim-ma'
        ? 'Fragebogen beim MA'
        : ma.anmeldungStatus === 'fragebogen-zurueck-unvollstaendig'
          ? 'Fragebogen zurück, unvollständig'
          : ma.anmeldungStatus === 'vollstaendig'
            ? 'Anmeldung vollständig'
            : 'Anmeldung läuft';
    return (
      <span
        className="text-[10px] bg-amber-100 text-amber-800 border border-amber-200 px-1.5 py-0.5 rounded"
        title={detail}
      >
        ⏳ {detail}
      </span>
    );
  }
  return (
    <span className="text-[10px] bg-green-100 text-green-700 border border-green-200 px-1.5 py-0.5 rounded">
      ✓ angemeldet
    </span>
  );
}

function VerteilplanVorschlaegeReiter({
  teilgebiete,
  mitarbeiter,
  abrechnungsperioden,
  verteilplanVorschlaege,
  isAdmin,
  adminName,
}: {
  teilgebiete: Teilgebiet[];
  mitarbeiter: Mitarbeiter[];
  abrechnungsperioden: Abrechnungsperiode[];
  verteilplanVorschlaege: VerteilplanVorschlag[];
  isAdmin: boolean;
  adminName: string;
}) {
  // ---- Eingabe-Form-State ----
  const [tgId, setTgId] = useState<string>('');
  const [neuerStandardId, setNeuerStandardId] = useState<string>('');
  const [neueStueckzahl, setNeueStueckzahl] = useState<string>('');
  const [zielPeriodeId, setZielPeriodeId] = useState<string>('');
  const [notiz, setNotiz] = useState<string>('');
  const [editId, setEditId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const aktiveTg = teilgebiete
    .filter((t) => t.isActive)
    .sort((a, b) => a.name.localeCompare(b.name, 'de', { numeric: true }));
  const offenePerioden = [...abrechnungsperioden]
    .filter((p) => p.status === 'offen')
    .sort((a, b) => (a.jahr !== b.jahr ? a.jahr - b.jahr : a.monat - b.monat));
  const tgMap = new Map(teilgebiete.map((t) => [t.id, t]));
  const periodeMap = new Map(abrechnungsperioden.map((p) => [p.id, p]));
  const maMap = new Map(mitarbeiter.map((m) => [m.id, m]));

  // MAs mit Freigabe für gewähltes TG (für MA-Dropdown im Eingabe-Form)
  const aktuellesTg = tgId ? tgMap.get(tgId) : undefined;
  const freigegebeneMa = mitarbeiter
    .filter((m) =>
      m.isActive
      && m.rollen.includes('austräger')
      && (m.teilgebietFreigaben ?? []).includes(tgId)
    )
    .sort((a, b) => a.name.localeCompare(b.name, 'de'));

  function resetForm() {
    setTgId('');
    setNeuerStandardId('');
    setNeueStueckzahl('');
    setZielPeriodeId('');
    setNotiz('');
    setEditId(null);
    setError('');
  }

  function ladenZurBearbeitung(v: VerteilplanVorschlag) {
    setEditId(v.id);
    setTgId(v.teilgebietId);
    setNeuerStandardId(
      v.vorgeschlagenerStandardAustraegerId === undefined
        ? ''
        : v.vorgeschlagenerStandardAustraegerId === null
          ? '__keiner__'
          : v.vorgeschlagenerStandardAustraegerId
    );
    setNeueStueckzahl(v.vorgeschlageneStueckzahl != null ? String(v.vorgeschlageneStueckzahl) : '');
    setZielPeriodeId(v.zielPeriodeId);
    setNotiz(v.notiz ?? '');
    setError('');
  }

  async function handleSpeichern() {
    setError('');
    if (!tgId) {
      setError('Bitte ein Teilgebiet wählen.');
      return;
    }
    if (!zielPeriodeId) {
      setError('Bitte eine Zielperiode wählen.');
      return;
    }
    const z = periodeMap.get(zielPeriodeId);
    if (!z || z.status !== 'offen') {
      setError('Zielperiode muss eine offene Periode sein.');
      return;
    }
    let standardWert: string | null | undefined;
    if (neuerStandardId === '') {
      standardWert = undefined;
    } else if (neuerStandardId === '__keiner__') {
      standardWert = null;
    } else {
      standardWert = neuerStandardId;
    }
    let stueckzahlWert: number | undefined;
    if (neueStueckzahl.trim() !== '') {
      const n = parseInt(neueStueckzahl.replace(',', '.'), 10);
      if (!Number.isFinite(n) || n < 0) {
        setError('Stückzahl muss eine nicht-negative Zahl sein.');
        return;
      }
      stueckzahlWert = n;
    }
    if (standardWert === undefined && stueckzahlWert === undefined) {
      setError('Bitte mindestens einen Vorschlag erfassen (Standardausträger oder Stückzahl).');
      return;
    }
    setSaving(true);
    try {
      if (editId) {
        await aktualisiereVerteilplanVorschlag(editId, {
          teilgebietId: tgId,
          zielPeriodeId,
          vorgeschlagenerStandardAustraegerId: standardWert,
          vorgeschlageneStueckzahl: stueckzahlWert,
          notiz: notiz.trim() || undefined,
        });
      } else {
        await erstelleVerteilplanVorschlag({
          teilgebietId: tgId,
          zielPeriodeId,
          vorgeschlagenerStandardAustraegerId: standardWert,
          vorgeschlageneStueckzahl: stueckzahlWert,
          notiz: notiz.trim() || undefined,
          erstelltVon: adminName,
        });
      }
      resetForm();
    } catch (e) {
      console.error(e);
      setError('Fehler beim Speichern.');
    } finally {
      setSaving(false);
    }
  }

  async function handleUebernehmen(v: VerteilplanVorschlag) {
    if (!isAdmin) return;
    const tg = tgMap.get(v.teilgebietId);
    if (!tg) {
      alert('Teilgebiet nicht mehr vorhanden — Vorschlag wird gelöscht.');
      await loescheVerteilplanVorschlag(v.id);
      return;
    }
    const ziel = periodeMap.get(v.zielPeriodeId);
    if (!ziel || ziel.status !== 'offen') {
      alert('Zielperiode ist nicht mehr offen. Bitte den Vorschlag bearbeiten oder löschen.');
      return;
    }
    if (!confirm(`Vorschlag für „${tg.name}" jetzt übernehmen?`)) return;

    const update: Partial<Teilgebiet> = {};
    const bisherigerStandardId = tg.standardAustraegerId;
    if (v.vorgeschlagenerStandardAustraegerId !== undefined) {
      update.standardAustraegerId = v.vorgeschlagenerStandardAustraegerId;
    }
    if (v.vorgeschlageneStueckzahl !== undefined) {
      update.stueckzahl = v.vorgeschlageneStueckzahl;
      // Manuell-Flag setzen, damit nicht aus Straßenliste neu berechnet wird
      update.stueckzahlManuell = true;
    }
    await aktualisiereTeilgebiet(tg.id, update);

    // Wenn der bisherige Standardausträger ersetzt wurde — geplante Abmeldung
    // setzen (sofern er nicht mehr in einem anderen aktiven TG Standard ist
    // und nicht bereits abgemeldet).
    if (
      v.vorgeschlagenerStandardAustraegerId !== undefined
      && bisherigerStandardId
      && bisherigerStandardId !== v.vorgeschlagenerStandardAustraegerId
    ) {
      const nochAndereStandardZuweisung = teilgebiete.some(
        (t) => t.id !== tg.id && t.isActive && t.standardAustraegerId === bisherigerStandardId
      );
      const bisheriger = maMap.get(bisherigerStandardId);
      if (!nochAndereStandardZuweisung && bisheriger && !bisheriger.abgemeldet && !bisheriger.abmeldungGeplant) {
        await aktualisiereMitarbeiter(bisherigerStandardId, {
          abmeldungGeplant: true,
          abmeldungZielPeriodeId: v.zielPeriodeId,
          abmeldungGeplantNotiz: `Auto-Vorschlag: ersetzt als Standardausträger von „${tg.name}"`,
        });
      }
    }

    await loescheVerteilplanVorschlag(v.id);
  }

  async function handleAblehnen(v: VerteilplanVorschlag) {
    if (!confirm('Diesen Vorschlag wirklich verwerfen / löschen?')) return;
    await loescheVerteilplanVorschlag(v.id);
    if (editId === v.id) resetForm();
  }

  // Sortiere Vorschläge: nach Zielperiode (jahr/monat asc), dann TG-Name natural
  const sortiert = [...verteilplanVorschlaege].sort((a, b) => {
    const pa = periodeMap.get(a.zielPeriodeId);
    const pb = periodeMap.get(b.zielPeriodeId);
    if (pa && pb) {
      if (pa.jahr !== pb.jahr) return pa.jahr - pb.jahr;
      if (pa.monat !== pb.monat) return pa.monat - pb.monat;
    }
    const na = tgMap.get(a.teilgebietId)?.name ?? '';
    const nb = tgMap.get(b.teilgebietId)?.name ?? '';
    return na.localeCompare(nb, 'de', { numeric: true });
  });

  return (
    <div className="space-y-5">
      <div className="text-sm text-gray-600">
        Vorschläge für Änderungen am Verteilplan (neuer Standardausträger und/oder
        neue Stückzahl). {isAdmin
          ? 'Übernahme wirkt sofort — der bisherige Standardausträger wird automatisch zur Abmeldung vorgemerkt, sofern er kein anderes TG mehr betreut.'
          : 'Vorschläge werden vom Admin beim Monatswechsel/Abschluss übernommen.'}
      </div>

      {/* Eingabe-Form */}
      <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 space-y-3">
        <h3 className="text-sm font-semibold text-gray-800">
          {editId ? 'Vorschlag bearbeiten' : 'Neuen Vorschlag erfassen'}
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-gray-600 mb-1">Teilgebiet *</label>
            <select
              value={tgId}
              onChange={(e) => {
                setTgId(e.target.value);
                // Wenn der bisher gewählte MA für das neue TG keine Freigabe hat → reset
                if (e.target.value && neuerStandardId && neuerStandardId !== '__keiner__') {
                  const m = maMap.get(neuerStandardId);
                  if (!m || !(m.teilgebietFreigaben ?? []).includes(e.target.value)) {
                    setNeuerStandardId('');
                  }
                }
              }}
              className={inputClass}
            >
              <option value="">— Teilgebiet wählen —</option>
              {aktiveTg.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} {t.plz && `(${t.plz})`} · aktuell {t.stueckzahl} Stk
                </option>
              ))}
            </select>
            {aktuellesTg && (
              <p className="text-[11px] text-gray-500 mt-1">
                Bisheriger Standard:{' '}
                {aktuellesTg.standardAustraegerId
                  ? maMap.get(aktuellesTg.standardAustraegerId)?.name ?? '?'
                  : '— ohne Standard —'}
              </p>
            )}
          </div>
          <div>
            <label className="block text-xs text-gray-600 mb-1">Zielperiode *</label>
            <select
              value={zielPeriodeId}
              onChange={(e) => setZielPeriodeId(e.target.value)}
              className={inputClass}
            >
              <option value="">— Periode wählen —</option>
              {offenePerioden.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.bezeichnung}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-600 mb-1">
              Neuer Standardausträger
              <span className="text-gray-400 font-normal">
                {' '}(optional · nur MA mit Gebietsfreigabe)
              </span>
            </label>
            <select
              value={neuerStandardId}
              onChange={(e) => setNeuerStandardId(e.target.value)}
              disabled={!tgId}
              className={`${inputClass} ${!tgId ? 'opacity-60' : ''}`}
            >
              <option value="">— keine Änderung —</option>
              <option value="__keiner__">— ohne Standard —</option>
              {freigegebeneMa.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
            {tgId && freigegebeneMa.length === 0 && (
              <p className="text-[11px] text-amber-700 mt-1">
                Keine Mitarbeiter mit Gebietsfreigabe für dieses TG. Erst Freigabe
                im TG-Detail (Reiter „Freigaben") setzen.
              </p>
            )}
          </div>
          <div>
            <label className="block text-xs text-gray-600 mb-1">
              Neue Stückzahl <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            <input
              type="number"
              min="0"
              step="1"
              value={neueStueckzahl}
              onChange={(e) => setNeueStueckzahl(e.target.value)}
              placeholder={aktuellesTg ? `${aktuellesTg.stueckzahl}` : ''}
              className={inputClass}
            />
          </div>
          <div className="md:col-span-2">
            <label className="block text-xs text-gray-600 mb-1">
              Notiz <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            <input
              type="text"
              value={notiz}
              onChange={(e) => setNotiz(e.target.value)}
              placeholder="z. B. Begründung, Hinweis"
              className={inputClass}
            />
          </div>
        </div>
        {error && <p className="text-xs text-red-600">{error}</p>}
        <div className="flex justify-end gap-2">
          {editId && (
            <button
              type="button"
              onClick={resetForm}
              className="text-sm text-gray-500 hover:text-gray-700 px-3 py-1.5"
            >
              Abbrechen
            </button>
          )}
          <button
            type="button"
            onClick={handleSpeichern}
            disabled={saving}
            className="bg-blue-600 text-white px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? '…' : editId ? 'Vorschlag aktualisieren' : 'Vorschlag speichern'}
          </button>
        </div>
      </div>

      {/* Liste */}
      {sortiert.length === 0 ? (
        <div className="rounded-lg border border-gray-200 bg-white py-10 text-center text-sm text-gray-500">
          Keine offenen Verteilplan-Vorschläge.
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-gray-200">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200 text-gray-600 text-xs">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Zielperiode</th>
                <th className="px-3 py-2 text-left font-medium">Teilgebiet</th>
                <th className="px-3 py-2 text-left font-medium">Bisheriger Standard</th>
                <th className="px-3 py-2 text-left font-medium">Vorgeschlagen</th>
                <th className="px-3 py-2 text-right font-medium">Bisher Stk</th>
                <th className="px-3 py-2 text-right font-medium">Neu Stk</th>
                <th className="px-3 py-2 text-left font-medium">Notiz / Erfasst</th>
                <th className="px-3 py-2 text-right font-medium">Aktion</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {sortiert.map((v) => {
                const tg = tgMap.get(v.teilgebietId);
                const ziel = periodeMap.get(v.zielPeriodeId);
                const zielAbgeschlossen = ziel?.status === 'abgeschlossen';
                const bisheriger = tg?.standardAustraegerId ? maMap.get(tg.standardAustraegerId) : undefined;
                const vorgeschlagen =
                  v.vorgeschlagenerStandardAustraegerId === undefined
                    ? undefined
                    : v.vorgeschlagenerStandardAustraegerId === null
                      ? null
                      : maMap.get(v.vorgeschlagenerStandardAustraegerId);
                return (
                  <tr key={v.id} className={zielAbgeschlossen ? 'bg-red-50' : 'hover:bg-gray-50'}>
                    <td className="px-3 py-2">
                      <div className="font-medium text-gray-800">
                        {ziel?.bezeichnung ?? '— unbekannt —'}
                      </div>
                      {zielAbgeschlossen && (
                        <div className="text-[10px] text-red-700">
                          ⚠ bereits abgeschlossen — Zielperiode anpassen
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 font-medium text-gray-900">
                      {tg?.name ?? '— gelöscht —'}
                    </td>
                    <td className="px-3 py-2">
                      {bisheriger ? (
                        <div className="space-y-0.5">
                          <div className="text-gray-700">{bisheriger.name}</div>
                          <MaStatusBadge ma={bisheriger} />
                        </div>
                      ) : (
                        <span className="text-gray-400 italic">— ohne Standard —</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {v.vorgeschlagenerStandardAustraegerId === undefined ? (
                        <span className="text-gray-300">— keine Änderung —</span>
                      ) : vorgeschlagen === null ? (
                        <span className="text-gray-700 italic">— ohne Standard —</span>
                      ) : vorgeschlagen ? (
                        <div className="space-y-0.5">
                          <div className="text-gray-700">{vorgeschlagen.name}</div>
                          <MaStatusBadge ma={vorgeschlagen} />
                          {!(vorgeschlagen.teilgebietFreigaben ?? []).includes(v.teilgebietId) && (
                            <div className="text-[10px] text-red-700">
                              ⚠ keine Gebietsfreigabe (mehr)
                            </div>
                          )}
                        </div>
                      ) : (
                        <span className="text-red-700 italic">— MA gelöscht —</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right text-gray-600">
                      {tg ? tg.stueckzahl.toLocaleString('de-DE') : '—'}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {v.vorgeschlageneStueckzahl != null ? (
                        <span className="font-semibold text-blue-700">
                          {v.vorgeschlageneStueckzahl.toLocaleString('de-DE')}
                        </span>
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-600">
                      {v.notiz && <div>{v.notiz}</div>}
                      <div className="text-[10px] text-gray-400">
                        {v.erstelltVon ? `${v.erstelltVon} · ` : ''}
                        {new Date(v.erstelltAm).toLocaleDateString('de-DE')}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      {isAdmin && !zielAbgeschlossen && (
                        <button
                          type="button"
                          onClick={() => handleUebernehmen(v)}
                          className="text-xs bg-green-600 text-white px-2.5 py-1 rounded hover:bg-green-700 mr-1.5"
                        >
                          ✓ Übernehmen
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => ladenZurBearbeitung(v)}
                        className="text-xs text-blue-600 hover:text-blue-800 mr-2"
                      >
                        Bearbeiten
                      </button>
                      <button
                        type="button"
                        onClick={() => handleAblehnen(v)}
                        className="text-xs text-red-500 hover:text-red-700"
                        title={isAdmin ? 'Vorschlag ablehnen / verwerfen' : 'Vorschlag löschen'}
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
    </div>
  );
}
