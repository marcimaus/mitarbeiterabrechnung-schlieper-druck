import { useState, useEffect, useMemo, type FormEvent } from 'react';
import { useApp } from '../context/AppContext';
import AdminPinGate from '../components/AdminPinGate';
import Modal from '../components/Modal';
import AenderungsProtokollModal from '../components/AenderungsProtokollModal';
import { bestaetigeMonatswechselEinmalProSession } from '../utils';
import {
  erstelleTeilgebiet,
  aktualisiereTeilgebiet,
  aktualisiereMitarbeiter,
  setzeStueckzahlAnpassung,
  loescheStueckzahlAnpassung,
  einsaetzeJahrListener,
  umgesetzteAnpassungenListener,
  schreibeAuditLog,
  auditLogListener,
} from '../lib/db';
import {
  austraegerwechselPlanListener,
} from '../lib/planung';
import type {
  Teilgebiet,
  Strasse,
  Sonderauslage,
  NichtBeliefen,
  Mitarbeiter,
  StueckzahlAnpassung,
  StandardAustraegerWechselPlan,
  Einsatz,
  UmgesetzteAnpassung,
  AuditLog,
} from '../types';
import { Link } from 'react-router-dom';

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

// ---- Karten-Link-Default je Tour -------------------------------------------
// Wird primär aus dem Tour-Stammdatensatz (`Tour.kartenLink`) gezogen —
// dort kann der Admin pro Tour pflegen, welcher Standard-Link gilt.
// Kein Wert in der Tour → kein Default. Pro TG kann der Admin den
// Tour-Default über `Teilgebiet.kartenLink` jederzeit überschreiben.
function defaultKartenLink(tour: import('../types').Tour | undefined): string | null {
  if (!tour) return null;
  const link = tour.kartenLink?.trim();
  return link ? link : null;
}

/**
 * Effektiver Karten-Link eines TG: TG-spezifischer Override hat Vorrang,
 * sonst Tour-Default. Liefert null, wenn weder Override noch Tour-Default
 * existieren (z. B. TG ohne Tour).
 */
function effektiverKartenLink(
  kartenLink: string | undefined,
  tour: import('../types').Tour | undefined,
): string | null {
  const override = kartenLink?.trim();
  if (override) return override;
  return defaultKartenLink(tour);
}

// ---- Hauptkomponente -------------------------------------------------------

export default function TeilgebieteScreen() {
  return (
    <AdminPinGate allowedRoles={['admin', 'abrechnung']}>
      <TeilgebieteInhalt />
    </AdminPinGate>
  );
}

function TeilgebieteInhalt() {
  const { teilgebiete, touren, mitarbeiter, abrechnungsperioden, parameter, userRole, stueckzahlAnpassungen, adminName } = useApp();
  // Abrechnung-Rolle: nur lesender Zugriff (keine Bearbeitung).
  const isAdmin = userRole === 'admin';
  const [hauptview, setHauptview] = useState<'liste' | 'anpassung' | 'historie' | 'umgesetzt'>('liste');

  // Geplante dauerhafte Wechsel + zukünftige Springer — werden gebraucht, um
  // im TG-Form das Standardausträger-Select zu sperren, solange in der
  // Personalplanung noch ein Vorgang läuft.
  const [wechselplaene, setWechselplaene] = useState<StandardAustraegerWechselPlan[]>([]);
  const [einsaetzeAktJahr, setEinsaetzeAktJahr] = useState<Einsatz[]>([]);
  useEffect(() => austraegerwechselPlanListener(setWechselplaene), []);
  useEffect(() => {
    const jahr = new Date().getFullYear();
    return einsaetzeJahrListener(jahr, setEinsaetzeAktJahr);
  }, []);
  // Änderungsprotokoll für Teilgebietsanpassungen (Stückzahl) — Vormerken,
  // Verwerfen und die beim Monatswechsel tatsächlich umgesetzten Werte.
  const [auditLog, setAuditLog] = useState<AuditLog[]>([]);
  useEffect(() => auditLogListener(setAuditLog), []);
  const anpassungsProtokoll = useMemo(
    () => auditLog.filter((a) => a.bereich === 'teilgebiets-anpassung'),
    [auditLog],
  );

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
  const [filterAustraegerSuche, setFilterAustraegerSuche] = useState('');
  const [filterAustraegerNurMitTG, setFilterAustraegerNurMitTG] = useState(false);
  const [nurAktive, setNurAktive] = useState(true);

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
    // Volltextsuche über Standardausträger (Name + MA-Nummer)
    if (filterAustraegerSuche.trim()) {
      const s = filterAustraegerSuche.toLowerCase();
      if (!tg.standardAustraegerId) return false;
      const ma = mitarbeiter.find((m) => m.id === tg.standardAustraegerId);
      if (!ma) return false;
      if (
        !ma.name.toLowerCase().includes(s) &&
        !ma.nummer.toLowerCase().includes(s)
      ) {
        return false;
      }
    }
    return true;
  });

  // Austräger-Filterliste (alle Mitarbeiter mit Rolle 'austräger'), sortiert.
  // Optional: nur MAs, die mindestens ein TG als Standardausträger haben;
  // zusätzlich Volltext-Suche über Name + Mitarbeiternummer.
  const austraegerMitTG = new Set(
    teilgebiete
      .filter((tg) => tg.standardAustraegerId)
      .map((tg) => tg.standardAustraegerId as string)
  );
  const austraegerOptionen = mitarbeiter
    .filter((m) => m.rollen.includes('austräger'))
    .filter((m) => !filterAustraegerNurMitTG || austraegerMitTG.has(m.id))
    .filter((m) => {
      if (!filterAustraegerSuche.trim()) return true;
      const s = filterAustraegerSuche.toLowerCase();
      return (
        m.name.toLowerCase().includes(s) ||
        m.nummer.toLowerCase().includes(s)
      );
    })
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

      {/* View-Switcher */}
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
          onClick={() => setHauptview('anpassung')}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            hauptview === 'anpassung'
              ? 'border-blue-600 text-blue-700'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          Teilgebietsanpassung vorbereiten
          {stueckzahlAnpassungen.length > 0 && (
            <span className="ml-1.5 bg-amber-100 text-amber-800 text-xs px-1.5 py-0.5 rounded-full">
              {stueckzahlAnpassungen.length}
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={() => setHauptview('historie')}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            hauptview === 'historie'
              ? 'border-blue-600 text-blue-700'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          Historische Werte
        </button>
        <button
          type="button"
          onClick={() => setHauptview('umgesetzt')}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            hauptview === 'umgesetzt'
              ? 'border-blue-600 text-blue-700'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          Umgesetzte Wechselpläne &amp; Mengenanpassungen
        </button>
      </div>

      {hauptview === 'anpassung' && (
        <TeilgebietsanpassungReiter
          teilgebiete={teilgebiete}
          stueckzahlAnpassungen={stueckzahlAnpassungen}
          adminName={adminName}
          isAdmin={isAdmin}
          protokoll={anpassungsProtokoll}
        />
      )}

      {hauptview === 'historie' && (
        <HistorischeWerteReiter
          teilgebiete={teilgebiete}
          touren={touren}
          mitarbeiter={mitarbeiter}
          abrechnungsperioden={abrechnungsperioden}
        />
      )}

      {hauptview === 'umgesetzt' && <UmgesetzteAnpassungenReiter />}

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
        <div className="flex items-center gap-1.5">
          <input
            type="text"
            placeholder="Standardausträger (Name/Nr)..."
            value={filterAustraegerSuche}
            onChange={(e) => setFilterAustraegerSuche(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-44"
            title="Volltextsuche: zeigt Teilgebiete, deren Standardausträger im Namen oder in der Mitarbeiternummer übereinstimmen"
          />
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
                {m.name} ({m.nummer})
              </option>
            ))}
          </select>
          <label
            className="flex items-center gap-1 text-xs text-gray-500 cursor-pointer whitespace-nowrap"
            title="Nur Austräger anzeigen, die mindestens ein Teilgebiet als Standardausträger haben"
          >
            <input
              type="checkbox"
              checked={filterAustraegerNurMitTG}
              onChange={(e) => setFilterAustraegerNurMitTG(e.target.checked)}
              className="rounded"
            />
            nur mit TG
          </label>
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
          <input
            type="checkbox"
            checked={nurAktive}
            onChange={(e) => setNurAktive(e.target.checked)}
            className="rounded"
          />
          Nur aktive
        </label>
        {(filterText || filterTour || filterAustraegerId || filterAustraegerSuche || filterAustraegerNurMitTG) && (
          <button
            type="button"
            onClick={() => { setFilterText(''); setFilterTour(''); setFilterAustraegerId(''); setFilterAustraegerSuche(''); setFilterAustraegerNurMitTG(false); }}
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
          wechselplaene={wechselplaene}
          einsaetzeAktJahr={einsaetzeAktJahr}
          onSave={() => setShowForm(false)}
          onCancel={() => setShowForm(false)}
        />
      </Modal>

      </>
      )}
    </div>
  );
}

// ---- Reiter: Historische Werte (Periode ↔ Teilgebiet) ----------------------
//
// Vereint die beiden bisher untereinander angezeigten Tabellen in einem Reiter
// mit Umschaltung der Selektionsachse: „nach Periode" zeigt alle TG-Snapshots
// einer Abrechnungsperiode, „nach Teilgebiet" den Verlauf eines TG über alle
// Perioden. Beide lesen aus `periodeSnapshot.teilgebietSnapshots`.

function HistorischeWerteReiter({
  teilgebiete,
  touren,
  mitarbeiter,
  abrechnungsperioden,
}: {
  teilgebiete: import('../types').Teilgebiet[];
  touren: import('../types').Tour[];
  mitarbeiter: Mitarbeiter[];
  abrechnungsperioden: import('../types').Abrechnungsperiode[];
}) {
  const [modus, setModus] = useState<'periode' | 'teilgebiet'>('periode');
  const [historiePeriodeId, setHistoriePeriodeId] = useState('');

  return (
    <div className="space-y-5">
      <div className="text-sm text-gray-600">
        Historische Stamm-/Stückzahlwerte aus den beim Periodenabschluss
        gespeicherten Snapshots. Umschalten, ob nach Abrechnungsperiode oder
        nach Teilgebiet selektiert wird.
      </div>

      {/* Umschaltung der Selektionsachse */}
      <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-0.5 text-sm">
        <button
          type="button"
          onClick={() => setModus('periode')}
          className={`px-3 py-1.5 rounded-md font-medium transition-colors ${
            modus === 'periode' ? 'bg-white shadow-sm text-blue-700' : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          nach Periode
        </button>
        <button
          type="button"
          onClick={() => setModus('teilgebiet')}
          className={`px-3 py-1.5 rounded-md font-medium transition-colors ${
            modus === 'teilgebiet' ? 'bg-white shadow-sm text-blue-700' : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          nach Teilgebiet
        </button>
      </div>

      {modus === 'periode' && (
        <div>
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
      )}

      {modus === 'teilgebiet' && (
        <TeilgebietVerlauf
          teilgebiete={teilgebiete}
          abrechnungsperioden={abrechnungsperioden}
        />
      )}
    </div>
  );
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
  wechselplaene,
  einsaetzeAktJahr,
  onSave,
  onCancel,
}: {
  initial: Teilgebiet | null;
  wechselplaene: StandardAustraegerWechselPlan[];
  einsaetzeAktJahr: Einsatz[];
  onSave: () => void;
  onCancel: () => void;
}) {
  const { touren, mitarbeiter, userRole } = useApp();
  const isAdmin = userRole === 'admin';

  // F: Standardausträger-Select sperren, wenn in der Personalplanung noch
  // ein Wechsel/Springer für dieses TG läuft. Sonst überschriebe der Admin
  // den Standard, während Lücken-Einsätze noch an einem Snapshot hängen,
  // der zur alten Besetzung passt.
  const standardLockReason = useMemo(() => {
    if (!initial) return null;
    if (wechselplaene.some((p) => p.teilgebietId === initial.id)) {
      return 'wechsel' as const;
    }
    // Heutige KW im aktuell laufenden Jahr — Listener ist auf das Jahr
    // initialisiert; reicht für die übliche Planung.
    const heute = new Date();
    const jahr = heute.getFullYear();
    const startMs = Date.UTC(jahr, 0, 1);
    const dayMs = 24 * 60 * 60 * 1000;
    // ISO-KW grob: nicht perfekt, aber Bedingung lautet „zukünftiger
    // Springer" — wir verwenden hier daher das Tagesdatum als Untergrenze.
    const heutigerTagOfYear = Math.floor((heute.getTime() - startMs) / dayMs);
    const aktuelleKw = Math.max(1, Math.floor(heutigerTagOfYear / 7) + 1);
    const offenerSpringer = einsaetzeAktJahr.some(
      (e) =>
        e.teilgebietId === initial.id &&
        e.typ === 'springer' &&
        e.mitarbeiterId &&
        e.jahr >= jahr &&
        (e.jahr > jahr || e.kw >= aktuelleKw),
    );
    return offenerSpringer ? ('springer' as const) : null;
  }, [initial, wechselplaene, einsaetzeAktJahr]);
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
          kartenLink: initial.kartenLink,
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
  const [freigabeNurMitFreigabe, setFreigabeNurMitFreigabe] = useState(true);

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
              {standardLockReason && (
                <div className="mb-2 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  {standardLockReason === 'wechsel'
                    ? 'Für dieses Teilgebiet ist in der Personalplanung ein dauerhafter Wechsel geplant.'
                    : 'Für dieses Teilgebiet ist in der Personalplanung ein zukünftiger Springer eingetragen.'}
                  {' '}Bitte den Vorgang dort abschließen oder die Einträge entfernen, bevor der
                  Standardausträger geändert werden kann.
                  <Link
                    to="/planung"
                    className="ml-1 text-blue-700 underline hover:text-blue-900"
                  >
                    → Personalplanung
                  </Link>
                </div>
              )}
              <select
                value={form.standardAustraegerId ?? ''}
                onChange={(e) =>
                  setForm((f) => ({ ...f, standardAustraegerId: e.target.value || null }))
                }
                disabled={!!standardLockReason}
                className={`${inputClass} ${standardLockReason ? 'opacity-60 cursor-not-allowed' : ''}`}
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
          {/* Karten-Link: pro TG individuell oder Tour-Default */}
          <KartenLinkBox
            tour={touren.find((t) => t.id === form.tourId)}
            kartenLink={form.kartenLink}
            isAdmin={isAdmin}
            onChange={(v) => setForm((f) => ({ ...f, kartenLink: v }))}
          />

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
            <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer">
              <input
                type="checkbox"
                checked={freigabeNurMitFreigabe}
                onChange={(e) => setFreigabeNurMitFreigabe(e.target.checked)}
                className="rounded"
              />
              nur mit Freigabe
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
                .filter((m) => !freigabeNurMitFreigabe || freigegebeneMitarbeiterIds.includes(m.id))
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

// =====================================================================
// KartenLinkBox: zeigt den effektiven Karten-Link am Kopf des Strassen-
// Tabs. Wenn TG einen eigenen `kartenLink` hat, hat dieser Vorrang;
// sonst greift der Tour-Default. Admin kann den Wert pro TG
// überschreiben oder leeren (= zurück zum Default).
// =====================================================================

function KartenLinkBox({
  tour,
  kartenLink,
  isAdmin,
  onChange,
}: {
  tour: import('../types').Tour | undefined;
  kartenLink?: string;
  isAdmin: boolean;
  onChange: (v: string | undefined) => void;
}) {
  const [bearbeiten, setBearbeiten] = useState(false);
  const [draft, setDraft] = useState<string>(kartenLink ?? '');
  const effektiv = effektiverKartenLink(kartenLink, tour);
  const benutztOverride = !!kartenLink?.trim();
  const default_ = defaultKartenLink(tour);

  function speichern() {
    // Leerer Eingabe-Wert wird als „kein Override" gespeichert (leerer
    // String) — beim Lesen prüft `effektiverKartenLink` über `.trim()`
    // und fällt dann auf den Tour-Default zurück. Wir nehmen bewusst
    // den leeren String statt `undefined`, weil `aktualisiereTeilgebiet`
    // mit `stripUndef` arbeitet und sonst den alten Wert nicht löscht.
    onChange(draft.trim() ? draft.trim() : '');
    setBearbeiten(false);
  }
  function resetZuDefault() {
    onChange('');
    setDraft('');
    setBearbeiten(false);
  }

  return (
    <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-2.5 text-sm">
      {!bearbeiten ? (
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-emerald-800 font-medium">🗺️ Kartenansicht:</span>
            {effektiv ? (
              <>
                <a
                  href={effektiv}
                  target="_blank"
                  rel="noreferrer"
                  className="text-emerald-700 underline hover:text-emerald-900 truncate max-w-[36rem]"
                  title={effektiv}
                >
                  Google My Maps öffnen
                </a>
                <span className="text-[10px] text-emerald-600 shrink-0">
                  ({benutztOverride ? 'individuell' : tour ? `Standard (${tour.name})` : 'Standard'})
                </span>
              </>
            ) : (
              <span className="text-gray-500 italic">
                {tour
                  ? `kein Link hinterlegt — kann pro TG (hier) oder zentral in Tour „${tour.name}" gepflegt werden`
                  : 'kein Link verfügbar — bitte Tour zuordnen oder Link manuell setzen'}
              </span>
            )}
          </div>
          {isAdmin && (
            <button
              type="button"
              onClick={() => {
                setDraft(kartenLink ?? '');
                setBearbeiten(true);
              }}
              className="text-xs text-emerald-700 hover:text-emerald-900 px-2 py-1 border border-emerald-300 rounded hover:bg-emerald-100"
            >
              ✎ bearbeiten
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          <label className="block text-xs font-medium text-emerald-800">
            Karten-Link für dieses Teilgebiet (z. B. Google My Maps)
          </label>
          <div className="flex items-center gap-2">
            <input
              type="url"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={default_ ? `Standard: ${default_}` : 'https://…'}
              className="flex-1 border border-gray-300 rounded px-2 py-1.5 text-sm"
              autoFocus
            />
            <button
              type="button"
              onClick={speichern}
              className="text-xs bg-emerald-600 hover:bg-emerald-700 text-white rounded px-3 py-1.5"
            >
              Übernehmen
            </button>
            <button
              type="button"
              onClick={() => setBearbeiten(false)}
              className="text-xs text-gray-500 hover:text-gray-700 px-2"
            >
              Abbrechen
            </button>
          </div>
          <div className="flex items-center justify-between gap-2 text-[11px] text-emerald-700">
            <span>
              Leer lassen → Standard für die Tour wird verwendet
              {tour && default_ ? ` (${tour.name})` : ''}.
            </span>
            {benutztOverride && (
              <button
                type="button"
                onClick={resetZuDefault}
                className="text-xs text-emerald-700 hover:text-emerald-900 underline"
              >
                ↺ Zurück zum Standard
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// =====================================================================
// Reiter: Teilgebietsanpassung (Stückzahl) vorbereiten
// =====================================================================

function TeilgebietsanpassungReiter({
  teilgebiete,
  stueckzahlAnpassungen,
  adminName,
  isAdmin,
  protokoll,
}: {
  teilgebiete: Teilgebiet[];
  stueckzahlAnpassungen: StueckzahlAnpassung[];
  adminName: string;
  isAdmin: boolean;
  /** Änderungsprotokoll (Bereich `teilgebiets-anpassung`), neueste zuerst. */
  protokoll: AuditLog[];
}) {
  const [tgId, setTgId] = useState('');
  const [neueStueckzahl, setNeueStueckzahl] = useState('');
  const [bemerkung, setBemerkung] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [protokollOffen, setProtokollOffen] = useState(false);

  const aktiveTg = [...teilgebiete]
    .filter((t) => t.isActive && !t.istAuslagestelle)
    .sort((a, b) => a.name.localeCompare(b.name, 'de', { numeric: true }));
  const tgMap = new Map(teilgebiete.map((t) => [t.id, t]));

  const aktuellesTg = tgId ? tgMap.get(tgId) : undefined;

  function reset() {
    setTgId('');
    setNeueStueckzahl('');
    setBemerkung('');
    setError('');
  }

  async function handleSpeichern() {
    setError('');
    if (!tgId) {
      setError('Bitte ein Teilgebiet wählen.');
      return;
    }
    const n = parseInt(neueStueckzahl.trim(), 10);
    if (!Number.isFinite(n) || n < 0) {
      setError('Bitte eine gültige Stückzahl (≥ 0) angeben.');
      return;
    }
    setSaving(true);
    try {
      await setzeStueckzahlAnpassung({
        teilgebietId: tgId,
        neueStueckzahl: n,
        bemerkung: bemerkung.trim() || undefined,
        erstelltVon: adminName || undefined,
      });
      await schreibeAuditLog({
        adminName: adminName || 'Unbekannt',
        bereich: 'teilgebiets-anpassung',
        aktion: 'erstellt',
        teilgebietId: tgId,
        teilgebietName: aktuellesTg?.name ?? tgId,
        mitarbeiterId: null,
        mitarbeiterName: null,
        beschreibung:
          `Stückzahl-Anpassung vorgemerkt: ${aktuellesTg?.stueckzahl ?? '?'} → ${n} Stk` +
          (bemerkung.trim() ? `; Bemerkung: "${bemerkung.trim()}"` : ''),
      });
      reset();
    } catch (e) {
      console.error(e);
      setError('Fehler beim Speichern.');
    } finally {
      setSaving(false);
    }
  }

  async function handleEntfernen(w: StueckzahlAnpassung) {
    if (!confirm('Diese vorbereitete Anpassung wirklich entfernen?')) return;
    await loescheStueckzahlAnpassung(w.id);
    const tg = tgMap.get(w.teilgebietId);
    await schreibeAuditLog({
      adminName: adminName || 'Unbekannt',
      bereich: 'teilgebiets-anpassung',
      aktion: 'geloescht',
      teilgebietId: w.teilgebietId,
      teilgebietName: tg?.name ?? w.teilgebietId,
      mitarbeiterId: null,
      mitarbeiterName: null,
      beschreibung:
        `Vorgemerkte Stückzahl-Anpassung verworfen (neue Stückzahl war: ${w.neueStueckzahl} Stk)` +
        (w.bemerkung ? `; Bemerkung war: "${w.bemerkung}"` : ''),
    });
  }

  const sortiert = [...stueckzahlAnpassungen].sort((a, b) => {
    const na = tgMap.get(a.teilgebietId)?.name ?? '';
    const nb = tgMap.get(b.teilgebietId)?.name ?? '';
    return na.localeCompare(nb, 'de', { numeric: true });
  });

  const fmtStk = (n: number) => `${n.toLocaleString('de-DE')} Stk`;

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between gap-3">
        <div className="text-sm text-gray-600">
          Liste vorbereiteter Stückzahl-Anpassungen pro Teilgebiet. Beim Klick
          auf „Monatswechsel" in der Abrechnung werden die Vorschläge zur
          Einzel-Bestätigung angeboten — der neue Wert wird dann als Stückzahl
          des Teilgebiets eingetragen (mit manuellem Override, damit die
          automatische Berechnung aus der Straßenliste nicht erneut überschreibt),
          der Eintrag verschwindet aus dieser Liste.
        </div>
        <button
          type="button"
          onClick={() => setProtokollOffen(true)}
          className="shrink-0 text-xs text-gray-500 hover:text-blue-700 underline whitespace-nowrap"
          title="Änderungsprotokoll dieses Bereichs ansehen (Vormerken, Verwerfen, Monatswechsel-Umsetzung)"
        >
          📋 Protokoll
        </button>
      </div>

      {protokollOffen && (
        <AenderungsProtokollModal
          bereich="teilgebiets-anpassung"
          eintraege={protokoll}
          onClose={() => setProtokollOffen(false)}
        />
      )}

      {/* Eingabe */}
      {isAdmin && (
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 space-y-3">
          <h3 className="text-sm font-semibold text-gray-800">Neue Anpassung vormerken</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs text-gray-600 mb-1">Teilgebiet *</label>
              <select
                value={tgId}
                onChange={(e) => setTgId(e.target.value)}
                className={inputClass}
              >
                <option value="">— Teilgebiet wählen —</option>
                {aktiveTg.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} {t.plz && `(${t.plz})`}
                  </option>
                ))}
              </select>
              {aktuellesTg && (
                <p className="text-[11px] text-gray-500 mt-1">
                  Bisherige Stückzahl: <strong>{fmtStk(aktuellesTg.stueckzahl)}</strong>
                  {!aktuellesTg.stueckzahlManuell && aktuellesTg.strassen?.length > 0 && (
                    <span className="ml-1 text-gray-400">(aus Straßenliste berechnet)</span>
                  )}
                </p>
              )}
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">
                Neue Stückzahl *
              </label>
              <input
                type="number"
                min="0"
                step="1"
                value={neueStueckzahl}
                onChange={(e) => setNeueStueckzahl(e.target.value)}
                placeholder="z. B. 420"
                className={inputClass}
              />
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">Bemerkung</label>
              <input
                type="text"
                value={bemerkung}
                onChange={(e) => setBemerkung(e.target.value)}
                placeholder="optional: Grund für die Anpassung"
                className={inputClass}
              />
            </div>
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
          <div className="flex justify-end">
            <button
              type="button"
              onClick={handleSpeichern}
              disabled={saving}
              className="bg-blue-600 text-white px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? '…' : 'Anpassung vormerken'}
            </button>
          </div>
        </div>
      )}

      {/* Liste */}
      {sortiert.length === 0 ? (
        <div className="rounded-lg border border-gray-200 bg-white py-10 text-center text-sm text-gray-500">
          Keine vorbereiteten Stückzahl-Anpassungen.
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-gray-200">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200 text-gray-600 text-xs">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Teilgebiet</th>
                <th className="px-3 py-2 text-right font-medium">Bisher</th>
                <th className="px-3 py-2 text-right font-medium">Neu</th>
                <th className="px-3 py-2 text-right font-medium">Δ</th>
                <th className="px-3 py-2 text-left font-medium">Bemerkung</th>
                <th className="px-3 py-2 text-right font-medium">Vorgemerkt</th>
                <th className="px-3 py-2 text-right font-medium">Aktion</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {sortiert.map((w) => {
                const tg = tgMap.get(w.teilgebietId);
                const alt = tg?.stueckzahl ?? 0;
                const neu = w.neueStueckzahl;
                const delta = neu - alt;
                const erstellerName = w.erstelltVon || '—';
                return (
                  <tr key={w.id} className="hover:bg-gray-50">
                    <td className="px-3 py-2 font-medium text-gray-900">
                      {tg?.name ?? '— gelöscht —'}
                      {tg?.plz && <span className="ml-1 text-xs text-gray-400">({tg.plz})</span>}
                    </td>
                    <td className="px-3 py-2 text-right text-gray-600 font-mono text-xs">
                      {tg ? fmtStk(alt) : '—'}
                    </td>
                    <td className="px-3 py-2 text-right text-gray-900 font-mono text-xs font-semibold">
                      {fmtStk(neu)}
                    </td>
                    <td className={`px-3 py-2 text-right font-mono text-xs ${
                      delta > 0 ? 'text-amber-700' : delta < 0 ? 'text-green-700' : 'text-gray-400'
                    }`}>
                      {delta > 0 ? '+' : ''}{fmtStk(delta).replace(/^-/, '−')}
                    </td>
                    <td className="px-3 py-2 text-gray-600 text-xs">
                      {w.bemerkung || <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-3 py-2 text-right text-xs text-gray-500">
                      {new Date(w.erstelltAm).toLocaleDateString('de-DE')}<br />
                      <span className="text-gray-400">{erstellerName}</span>
                    </td>
                    <td className="px-3 py-2 text-right">
                      {isAdmin && (
                        <button
                          type="button"
                          onClick={() => handleEntfernen(w)}
                          className="text-xs text-red-500 hover:text-red-700"
                          title="Anpassung verwerfen"
                        >
                          ✕
                        </button>
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

// =====================================================================
// Reiter: Umgesetzte Wechselpläne & Mengenanpassungen
// =====================================================================
//
// Zeigt das Protokoll der beim Monatswechsel umgesetzten Standardausträger-
// Wechsel und Stückzahl-Anpassungen (Collection `umgesetzteAnpassungen`).
// Filter nach Teilgebiet und Monat (= Periode der Umsetzung).

function UmgesetzteAnpassungenReiter() {
  const [records, setRecords] = useState<UmgesetzteAnpassung[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterTgId, setFilterTgId] = useState('');
  const [filterMonat, setFilterMonat] = useState(''); // `${jahr}-${monat}` oder ''
  const [filterArt, setFilterArt] = useState<'' | 'wechsel' | 'menge'>('');

  useEffect(() => {
    const unsub = umgesetzteAnpassungenListener((list) => {
      setRecords(list);
      setLoading(false);
    });
    return unsub;
  }, []);

  // Filter-Optionen aus den vorhandenen Datensätzen ableiten.
  const tgOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of records) if (!map.has(r.teilgebietId)) map.set(r.teilgebietId, r.teilgebietName);
    return [...map.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name, 'de', { numeric: true }));
  }, [records]);

  const monatOptions = useMemo(() => {
    const map = new Map<string, { key: string; jahr: number; monat: number; label: string }>();
    for (const r of records) {
      const key = `${r.umsetzungJahr}-${r.umsetzungMonat}`;
      if (!map.has(key)) map.set(key, { key, jahr: r.umsetzungJahr, monat: r.umsetzungMonat, label: r.periodeBezeichnung });
    }
    return [...map.values()].sort((a, b) => (b.jahr !== a.jahr ? b.jahr - a.jahr : b.monat - a.monat));
  }, [records]);

  const gefiltert = useMemo(() => {
    return records
      .filter((r) => !filterTgId || r.teilgebietId === filterTgId)
      .filter((r) => !filterMonat || `${r.umsetzungJahr}-${r.umsetzungMonat}` === filterMonat)
      .filter((r) => !filterArt || r.art === filterArt)
      .sort((a, b) => {
        if (b.umsetzungJahr !== a.umsetzungJahr) return b.umsetzungJahr - a.umsetzungJahr;
        if (b.umsetzungMonat !== a.umsetzungMonat) return b.umsetzungMonat - a.umsetzungMonat;
        const tn = a.teilgebietName.localeCompare(b.teilgebietName, 'de', { numeric: true });
        if (tn !== 0) return tn;
        return b.umgesetztAm - a.umgesetztAm;
      });
  }, [records, filterTgId, filterMonat, filterArt]);

  const fmtAusgabe = (kw?: number, jahr?: number) =>
    kw != null && jahr != null ? `KW ${kw}/${jahr}` : '—';

  return (
    <div className="space-y-5">
      <div className="text-sm text-gray-600">
        Protokoll der beim Monatswechsel umgesetzten Standardausträger-Wechsel und
        Stückzahl-Anpassungen. Festgehalten mit den jeweils hinterlegten Werten und dem
        Monat der Umsetzung.
      </div>

      {/* Filter */}
      <div className="flex flex-wrap items-center gap-3">
        <select
          value={filterTgId}
          onChange={(e) => setFilterTgId(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">Alle Teilgebiete</option>
          {tgOptions.map((o) => (
            <option key={o.id} value={o.id}>{o.name}</option>
          ))}
        </select>
        <select
          value={filterMonat}
          onChange={(e) => setFilterMonat(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">Alle Monate</option>
          {monatOptions.map((o) => (
            <option key={o.key} value={o.key}>{o.label}</option>
          ))}
        </select>
        <select
          value={filterArt}
          onChange={(e) => setFilterArt(e.target.value as typeof filterArt)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">Alle Arten</option>
          <option value="wechsel">Nur Standardausträger-Wechsel</option>
          <option value="menge">Nur Mengenanpassungen</option>
        </select>
        {(filterTgId || filterMonat || filterArt) && (
          <button
            type="button"
            onClick={() => { setFilterTgId(''); setFilterMonat(''); setFilterArt(''); }}
            className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1"
          >
            ✕ Filter zurücksetzen
          </button>
        )}
        <span className="text-xs text-gray-400 ml-auto self-center">
          {gefiltert.length} {gefiltert.length === 1 ? 'Eintrag' : 'Einträge'}
        </span>
      </div>

      {loading ? (
        <div className="rounded-lg border border-gray-200 bg-white py-10 text-center text-sm text-gray-400">
          Lade umgesetzte Anpassungen…
        </div>
      ) : gefiltert.length === 0 ? (
        <div className="rounded-lg border border-gray-200 bg-white py-10 text-center text-sm text-gray-500">
          {records.length === 0
            ? 'Noch keine umgesetzten Wechselpläne oder Mengenanpassungen protokolliert.'
            : 'Keine Einträge passen zu den aktiven Filtern.'}
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-gray-200">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200 text-gray-600 text-xs">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Monat</th>
                <th className="px-3 py-2 text-left font-medium">Teilgebiet</th>
                <th className="px-3 py-2 text-left font-medium">Art</th>
                <th className="px-3 py-2 text-left font-medium">Details</th>
                <th className="px-3 py-2 text-right font-medium">Umgesetzt</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {gefiltert.map((r) => (
                <tr key={r.id} className="hover:bg-gray-50 align-top">
                  <td className="px-3 py-2 text-gray-700 whitespace-nowrap">{r.periodeBezeichnung}</td>
                  <td className="px-3 py-2 font-medium text-gray-900">
                    {r.teilgebietName}
                    {r.teilgebietPlz && <span className="ml-1 text-xs text-gray-400">({r.teilgebietPlz})</span>}
                  </td>
                  {r.art === 'wechsel' ? (
                    <>
                      <td className="px-3 py-2">
                        <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-medium">
                          Wechsel
                        </span>
                      </td>
                      <td className="px-3 py-2 text-gray-700 text-xs">
                        <div>
                          {r.bisherigerAustraegerName ?? <span className="italic text-gray-400">unbesetzt</span>}
                          {' → '}
                          {r.neuerAustraegerName ?? <span className="italic text-amber-700">unbesetzt</span>}
                        </div>
                        <div className="text-[11px] text-gray-500 mt-0.5">
                          letzte Ausgabe {fmtAusgabe(r.letzteAusgabeKw, r.letzteAusgabeJahr)}
                          {' · '}ab {fmtAusgabe(r.abAusgabeKw, r.abAusgabeJahr)}
                        </div>
                        {r.kommentar && (
                          <div className="text-[11px] text-gray-500 mt-0.5">💬 {r.kommentar}</div>
                        )}
                        {r.externerLink && (
                          <a
                            href={r.externerLink}
                            target="_blank"
                            rel="noreferrer"
                            className="text-[11px] text-blue-600 hover:text-blue-800 underline mt-0.5 inline-block"
                          >
                            🔗 Externer Link
                          </a>
                        )}
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="px-3 py-2">
                        <span className="text-xs bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full font-medium">
                          Menge
                        </span>
                      </td>
                      <td className="px-3 py-2 text-gray-700 text-xs">
                        <div className="font-mono">
                          {r.alteStueckzahl.toLocaleString('de-DE')} → {r.neueStueckzahl.toLocaleString('de-DE')} Stück
                          {(() => {
                            const d = r.neueStueckzahl - r.alteStueckzahl;
                            return (
                              <span className={`ml-1.5 ${d > 0 ? 'text-amber-700' : d < 0 ? 'text-green-700' : 'text-gray-400'}`}>
                                ({d > 0 ? '+' : ''}{d.toLocaleString('de-DE').replace(/^-/, '−')})
                              </span>
                            );
                          })()}
                        </div>
                        {r.bemerkung && (
                          <div className="text-[11px] text-gray-500 mt-0.5">💬 {r.bemerkung}</div>
                        )}
                      </td>
                    </>
                  )}
                  <td className="px-3 py-2 text-right text-xs text-gray-500 whitespace-nowrap">
                    {new Date(r.umgesetztAm).toLocaleDateString('de-DE')}
                    {r.umgesetztVon && <><br /><span className="text-gray-400">{r.umgesetztVon}</span></>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
