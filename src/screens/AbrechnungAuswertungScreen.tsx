// =============================================================
// Abrechnung auswerten
// -------------------------------------------------------------
// Lese-Auswertung der historischen Abrechnungs-Snapshots eines
// einzelnen Mitarbeiters. Sichtbar für 'admin' und 'abrechnung'.
//
// MA-Auswahl ist eingeschränkt auf:
//   - mindestens eine der Rollen 'austräger' oder 'zusammenträger'
//   - kein Festgehalt (`hatFestgehalt !== true`)
// Reine 'sonstige'-MAs und alle Festgehalt-MAs werden bewusst
// ausgeblendet — letztere haben in dieser Auswertung keine
// aussagekräftigen Werte, da ihre Vergütung fix ist.
//
// Such-/Filter-Maske ist analog zum MitarbeiterScreen aufgebaut
// (ohne Interessenten-spezifische Filter).
// =============================================================

import { useMemo, useState } from 'react';
import AdminPinGate from '../components/AdminPinGate';
import { useApp } from '../context/AppContext';
import { eur } from '../lib/abrechnungslogik';
import type { MitarbeiterAbrechnung } from '../lib/abrechnungslogik';
import type { Mitarbeiter, Rolle, Abrechnungsperiode } from '../types';
import { ROLLEN_LABELS } from '../types';
import { nameMitFestgehaltSymbol } from '../utils';

// Rollen, die in dieser Auswertung relevant sind. Die Liste wirkt als
// Hard-Filter (nur MAs mit mindestens einer dieser Rollen werden
// angezeigt) UND als Optionsliste für das Rolle-Dropdown.
const RELEVANTE_ROLLEN: Rolle[] = ['austräger', 'zusammenträger'];

export default function AbrechnungAuswertungScreen() {
  return (
    <AdminPinGate allowedRoles={['admin', 'abrechnung']}>
      <AbrechnungAuswertungInhalt />
    </AdminPinGate>
  );
}

function AbrechnungAuswertungInhalt() {
  const { mitarbeiter, abrechnungsperioden, userRole } = useApp();
  // Hard-Filter (Festgehalt + reine 'sonstige'-Rolle ausschließen) gilt
  // nur für den Benutzer "Abrechnung". Admin sieht alle Mitarbeiter.
  const istAbrechnung = userRole === 'abrechnung';

  // Such-/Filterzustand — Schnittmenge der Filter im MitarbeiterScreen
  // (Interessenten-Filter sind hier irrelevant und entfallen).
  const [filterText, setFilterText] = useState('');
  const [filterOrtPlz, setFilterOrtPlz] = useState('');
  const [filterRolle, setFilterRolle] = useState<Rolle | ''>('');
  const [filterMinijob, setFilterMinijob] = useState<'' | 'ja' | 'nein'>('');
  const [filterSvFrei, setFilterSvFrei] = useState<'' | 'ja' | 'nein'>('');
  const [filterAnmeldung, setFilterAnmeldung] = useState<'' | 'offen' | 'angemeldet' | 'abgemeldet'>('');
  const [filterFahrtkosten, setFilterFahrtkosten] = useState<'' | 'ja' | 'nein'>('');
  const [nurAktive, setNurAktive] = useState(true);

  const [selectedMaId, setSelectedMaId] = useState('');

  // Schritt 1: Hard-Filter — Berechtigung für diese Auswertung.
  // Für "Abrechnung": nur Austräger/Zusammenträger ohne Festgehalt.
  // Für Admin: alle MAs (Interessenten immer ausgeschlossen).
  const erlaubteMa = useMemo(() => {
    return mitarbeiter.filter((m) => {
      if (m.istInteressent) return false;
      if (istAbrechnung) {
        if (m.hatFestgehalt) return false;
        const r = m.rollen ?? [];
        if (!RELEVANTE_ROLLEN.some((x) => r.includes(x))) return false;
      }
      return true;
    });
  }, [mitarbeiter, istAbrechnung]);

  // Schritt 2: User-Filter, in der Logik 1:1 aus MitarbeiterScreen übernommen
  const gefiltert = useMemo(() => {
    const list = erlaubteMa.filter((m) => {
      if (nurAktive && !m.isActive) return false;
      if (filterText
        && !m.name.toLowerCase().includes(filterText.toLowerCase())
        && !m.nummer.includes(filterText)) return false;
      if (filterOrtPlz.trim()) {
        const q = filterOrtPlz.trim().toLowerCase();
        const plz = (m.adresse?.plz ?? '').toLowerCase();
        const ort = (m.adresse?.ort ?? '').toLowerCase();
        if (!plz.includes(q) && !ort.includes(q)) return false;
      }
      if (filterRolle && !m.rollen.includes(filterRolle)) return false;
      if (filterMinijob === 'ja' && !m.istMinijob) return false;
      if (filterMinijob === 'nein' && m.istMinijob) return false;
      if (filterSvFrei === 'ja' && !m.sozialversicherungsBefreit) return false;
      if (filterSvFrei === 'nein' && m.sozialversicherungsBefreit) return false;
      if (filterAnmeldung === 'offen' && !m.nochNichtAngemeldet) return false;
      if (filterAnmeldung === 'angemeldet' && (m.nochNichtAngemeldet || m.abgemeldet)) return false;
      if (filterAnmeldung === 'abgemeldet' && !m.abgemeldet) return false;
      if (filterFahrtkosten === 'ja' && !m.fahrtkostenerstattung) return false;
      if (filterFahrtkosten === 'nein' && m.fahrtkostenerstattung) return false;
      return true;
    });
    return [...list].sort((a, b) => a.name.localeCompare(b.name, 'de'));
  }, [
    erlaubteMa,
    nurAktive,
    filterText,
    filterOrtPlz,
    filterRolle,
    filterMinijob,
    filterSvFrei,
    filterAnmeldung,
    filterFahrtkosten,
  ]);

  const selectedMa = selectedMaId
    ? erlaubteMa.find((m) => m.id === selectedMaId) ?? null
    : null;

  // Wenn der ausgewählte MA gerade aus der gefilterten Liste fällt, zeigen
  // wir die Auswertung trotzdem an — der User hat ihn ja bewusst gewählt.

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-2">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">🔎 Abrechnung auswerten</h1>
          <p className="text-gray-500 text-sm">
            Werte vergangener Abrechnungsperioden
            {istAbrechnung ? ' für Austräger/Zusammenträger ' : ' '}
            — auf Basis des Snapshots beim Periodenabschluss.
            <span className="ml-1 text-gray-400">
              ({erlaubteMa.length} Mitarbeiter)
            </span>
          </p>
        </div>
      </div>

      {/* Filter — Schnittmenge der MitarbeiterScreen-Filter */}
      <div className="flex flex-wrap gap-3 mb-4 mt-4">
        <input
          type="text"
          placeholder="Name oder Nummer suchen..."
          value={filterText}
          onChange={(e) => setFilterText(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-52"
          autoFocus
        />
        <input
          type="text"
          placeholder="Ort oder PLZ..."
          value={filterOrtPlz}
          onChange={(e) => setFilterOrtPlz(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-36"
          title="Filter auf Wohnort oder Postleitzahl"
        />
        <select
          value={filterRolle}
          onChange={(e) => setFilterRolle(e.target.value as Rolle | '')}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">Rolle: alle</option>
          {(istAbrechnung
            ? RELEVANTE_ROLLEN
            : (Object.keys(ROLLEN_LABELS) as Rolle[])
          ).map((r) => (
            <option key={r} value={r}>{ROLLEN_LABELS[r]}</option>
          ))}
        </select>
        <select
          value={filterMinijob}
          onChange={(e) => setFilterMinijob(e.target.value as '' | 'ja' | 'nein')}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          title="Filter Minijob"
        >
          <option value="">Minijob: alle</option>
          <option value="ja">nur Minijob</option>
          <option value="nein">nur kein Minijob</option>
        </select>
        <select
          value={filterSvFrei}
          onChange={(e) => setFilterSvFrei(e.target.value as '' | 'ja' | 'nein')}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          title="Filter Befreiung von Sozialversicherung"
        >
          <option value="">SV-Befreiung: alle</option>
          <option value="ja">nur SV-befreit</option>
          <option value="nein">nur nicht SV-befreit</option>
        </select>
        <select
          value={filterAnmeldung}
          onChange={(e) => setFilterAnmeldung(e.target.value as '' | 'offen' | 'angemeldet' | 'abgemeldet')}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          title="Filter Anmeldung"
        >
          <option value="">Anmeldung: alle</option>
          <option value="offen">⏳ noch nicht angemeldet</option>
          <option value="angemeldet">✓ angemeldet</option>
          <option value="abgemeldet">🚪 abgemeldet</option>
        </select>
        <select
          value={filterFahrtkosten}
          onChange={(e) => setFilterFahrtkosten(e.target.value as '' | 'ja' | 'nein')}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          title="Filter Fahrtkosten-Erstattung"
        >
          <option value="">Fahrtkosten: alle</option>
          <option value="ja">🚗 nur erlaubt</option>
          <option value="nein">nur nicht erlaubt</option>
        </select>
        <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
          <input
            type="checkbox"
            checked={nurAktive}
            onChange={(e) => setNurAktive(e.target.checked)}
            className="rounded"
          />
          Nur aktive
          {nurAktive && erlaubteMa.filter((m) => !m.isActive).length > 0 && (
            <span className="text-xs text-gray-400">
              ({erlaubteMa.filter((m) => !m.isActive).length} inaktive ausgeblendet)
            </span>
          )}
        </label>
      </div>

      {/* Treffer-Liste */}
      <div className="mb-6">
        <div className="text-xs text-gray-500 mb-2">
          {gefiltert.length} Treffer
          {gefiltert.length !== erlaubteMa.length && ` (von ${erlaubteMa.length})`}
        </div>

        {gefiltert.length === 0 ? (
          <div className="bg-white rounded-lg border border-gray-200 p-6 text-center text-gray-400 text-sm">
            Keine Mitarbeiter gefunden
          </div>
        ) : (
          <>
            {/* Mobile: Karten */}
            <div className="md:hidden space-y-2">
              {gefiltert.map((m) => (
                <button
                  key={m.id}
                  onClick={() => setSelectedMaId(m.id)}
                  className={`w-full text-left bg-white rounded-xl border px-4 py-3 transition-colors ${
                    selectedMaId === m.id
                      ? 'border-blue-500 ring-2 ring-blue-200'
                      : 'border-gray-200 active:bg-blue-50'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-gray-900 truncate">
                      {nameMitFestgehaltSymbol(m)}
                    </span>
                    {!m.isActive && <span className="text-xs text-gray-400">inaktiv</span>}
                  </div>
                  <div className="text-xs text-gray-400 font-mono">{m.nummer}</div>
                  <div className="text-xs text-gray-500 mt-0.5">
                    {(m.rollen ?? []).map((r) => ROLLEN_LABELS[r]).join(', ')}
                  </div>
                </button>
              ))}
            </div>

            {/* Desktop: Tabelle */}
            <div className="hidden md:block overflow-hidden rounded-lg border border-gray-200">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200 text-gray-600 text-xs">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Name</th>
                    <th className="px-3 py-2 text-left font-medium">Nummer</th>
                    <th className="px-3 py-2 text-left font-medium">Rollen</th>
                    <th className="px-3 py-2 text-left font-medium">Ort</th>
                    <th className="px-3 py-2 text-left font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {gefiltert.map((m) => (
                    <tr
                      key={m.id}
                      onClick={() => setSelectedMaId(m.id)}
                      className={`cursor-pointer ${
                        selectedMaId === m.id ? 'bg-blue-50' : 'hover:bg-gray-50'
                      }`}
                    >
                      <td className="px-3 py-2 font-medium text-gray-900">
                        {nameMitFestgehaltSymbol(m)}
                        {!m.isActive && <span className="ml-2 text-xs text-gray-400">inaktiv</span>}
                      </td>
                      <td className="px-3 py-2 font-mono text-gray-500">{m.nummer}</td>
                      <td className="px-3 py-2 text-xs text-gray-600">
                        {(m.rollen ?? []).map((r) => ROLLEN_LABELS[r]).join(', ')}
                      </td>
                      <td className="px-3 py-2 text-xs text-gray-600">
                        {m.adresse?.plz && <span className="font-mono">{m.adresse.plz}</span>}{' '}
                        {m.adresse?.ort}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {m.nochNichtAngemeldet && <span title="Noch nicht beim Lohnbüro angemeldet" className="text-amber-600 mr-1">⏳</span>}
                        {m.abgemeldet && <span title="Abgemeldet" className="text-red-500 mr-1">🚪</span>}
                        {m.istMinijob && <span title="Minijob" className="text-blue-600 mr-1">M</span>}
                        {m.sozialversicherungsBefreit && <span title="SV-befreit" className="text-purple-600 mr-1">SV</span>}
                        {m.fahrtkostenerstattung && <span title="Fahrtkosten-Erstattung" className="text-gray-600 mr-1">🚗</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {/* Auswertung des gewählten MA */}
      {selectedMa ? (
        <MitarbeiterAuswertung
          ma={selectedMa}
          perioden={abrechnungsperioden}
        />
      ) : (
        <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 py-10 text-center text-sm text-gray-500">
          Bitte einen Mitarbeiter aus der Liste wählen.
        </div>
      )}
    </div>
  );
}

// ---- Detail-Auswertung pro MA --------------------------------

interface PeriodenZeile {
  periode: Abrechnungsperiode;
  abrechnung: MitarbeiterAbrechnung | null;
  snapshotAm: number | null;
}

function MitarbeiterAuswertung({
  ma,
  perioden,
}: {
  ma: Mitarbeiter;
  perioden: Abrechnungsperiode[];
}) {
  const zeilen = useMemo<PeriodenZeile[]>(() => {
    return perioden
      .filter((p) => p.status === 'abgeschlossen' && p.abrechnungSnapshot)
      .sort((a, b) =>
        a.jahr !== b.jahr ? b.jahr - a.jahr : b.monat - a.monat
      )
      .map((p) => {
        const erg = (p.abrechnungSnapshot?.ergebnisse ?? []) as MitarbeiterAbrechnung[];
        const eintrag = erg.find((e) => e.mitarbeiter?.id === ma.id) ?? null;
        return {
          periode: p,
          abrechnung: eintrag,
          snapshotAm: p.abrechnungSnapshot?.erstelltAm ?? null,
        };
      });
  }, [perioden, ma.id]);

  if (zeilen.length === 0) {
    return (
      <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
        Es liegen noch keine abgeschlossenen Abrechnungsperioden vor.
      </div>
    );
  }

  const mitWerten = zeilen.filter((z) => z.abrechnung !== null);
  const ohneWerte = zeilen.filter((z) => z.abrechnung === null);

  const summe = mitWerten.reduce(
    (acc, z) => {
      const a = z.abrechnung!;
      acc.brutto += a.bruttoLohnbuero ?? 0;
      acc.austragen += a.austraegerGesamt ?? 0;
      acc.zusammentragen += a.zusammentragenGesamt ?? 0;
      acc.zeitLohn += a.zeitLohn ?? 0;
      acc.fahrt += a.fahrtkostenGesamt ?? 0;
      acc.bonus += (a.bonus ?? 0) + (a.ausgabenBoniLohnGesamt ?? 0) + (a.bonusZeiterfassungEur ?? 0);
      acc.vorschuss += a.vorschussSumme ?? 0;
      return acc;
    },
    { brutto: 0, austragen: 0, zusammentragen: 0, zeitLohn: 0, fahrt: 0, bonus: 0, vorschuss: 0 },
  );

  return (
    <div className="space-y-4">
      <div className="flex items-baseline gap-3">
        <h2 className="text-lg font-semibold text-gray-900">
          {ma.name}{' '}
          <span className="text-gray-500 font-normal">({ma.nummer})</span>
        </h2>
        <span className="text-xs text-gray-500">
          {mitWerten.length} Periode(n) mit Werten
          {ohneWerte.length > 0 && ` · ${ohneWerte.length} ohne Werte`}
        </span>
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200 text-gray-600 text-xs">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Periode</th>
              <th className="px-3 py-2 text-right font-medium" title="Brutto, der ans Lohnbüro übermittelt wurde (inkl. Lohnkonto-Verschiebung/Verrechnung)">Brutto&nbsp;Lohnbüro</th>
              <th className="px-3 py-2 text-right font-medium" title="Austragen gesamt (inkl. Gewichtsboni)">Austragen</th>
              <th className="px-3 py-2 text-right font-medium">Zusammentragen</th>
              <th className="px-3 py-2 text-right font-medium" title="Zeitlohn (Zeiterfassung, nur gelohnte Zeiten)">Zeitlohn</th>
              <th className="px-3 py-2 text-right font-medium">Fahrtkosten</th>
              <th className="px-3 py-2 text-right font-medium" title="Variabler Bonus + Ausgaben-Boni + Bonus Zeiterfassung">Boni</th>
              <th className="px-3 py-2 text-right font-medium">Vorschüsse</th>
              <th className="px-3 py-2 text-right font-medium" title="Lohnkonto-Saldo NACH dieser Periode">Saldo n. Periode</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {zeilen.map((z) => {
              const a = z.abrechnung;
              if (!a) {
                return (
                  <tr key={z.periode.id} className="text-gray-400">
                    <td className="px-3 py-2">{z.periode.bezeichnung}</td>
                    <td className="px-3 py-2 text-right text-xs italic" colSpan={8}>
                      Mitarbeiter nicht im Snapshot dieser Periode
                    </td>
                  </tr>
                );
              }
              const boni =
                (a.bonus ?? 0) +
                (a.ausgabenBoniLohnGesamt ?? 0) +
                (a.bonusZeiterfassungEur ?? 0);
              return (
                <tr key={z.periode.id} className="hover:bg-gray-50">
                  <td className="px-3 py-2 font-medium text-gray-900">
                    {z.periode.bezeichnung}
                    {z.snapshotAm && (
                      <div className="text-[10px] text-gray-400">
                        Abschluss {new Date(z.snapshotAm).toLocaleDateString('de-DE')}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right font-mono font-semibold text-gray-900">
                    {eur(a.bruttoLohnbuero)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-gray-700">
                    {a.austraegerGesamt > 0 ? eur(a.austraegerGesamt) : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-gray-700">
                    {a.zusammentragenGesamt > 0 ? eur(a.zusammentragenGesamt) : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-gray-700">
                    {a.zeitLohn > 0 ? eur(a.zeitLohn) : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-gray-700">
                    {a.fahrtkostenGesamt > 0 ? eur(a.fahrtkostenGesamt) : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-gray-700">
                    {boni !== 0 ? eur(boni) : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-gray-700">
                    {a.vorschussSumme > 0 ? eur(a.vorschussSumme) : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-xs text-gray-500">
                    {eur(a.lohnkontoSaldoNachPeriode ?? 0)}
                  </td>
                </tr>
              );
            })}
          </tbody>
          {mitWerten.length > 1 && (
            <tfoot className="bg-gray-50 border-t border-gray-200">
              <tr className="text-xs">
                <td className="px-3 py-2 font-semibold text-gray-700">
                  Summe ({mitWerten.length} Perioden)
                </td>
                <td className="px-3 py-2 text-right font-mono font-bold text-gray-900">{eur(summe.brutto)}</td>
                <td className="px-3 py-2 text-right font-mono text-gray-700">{summe.austragen > 0 ? eur(summe.austragen) : '—'}</td>
                <td className="px-3 py-2 text-right font-mono text-gray-700">{summe.zusammentragen > 0 ? eur(summe.zusammentragen) : '—'}</td>
                <td className="px-3 py-2 text-right font-mono text-gray-700">{summe.zeitLohn > 0 ? eur(summe.zeitLohn) : '—'}</td>
                <td className="px-3 py-2 text-right font-mono text-gray-700">{summe.fahrt > 0 ? eur(summe.fahrt) : '—'}</td>
                <td className="px-3 py-2 text-right font-mono text-gray-700">{summe.bonus !== 0 ? eur(summe.bonus) : '—'}</td>
                <td className="px-3 py-2 text-right font-mono text-gray-700">{summe.vorschuss > 0 ? eur(summe.vorschuss) : '—'}</td>
                <td className="px-3 py-2 text-right font-mono text-gray-400">—</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      <p className="text-[11px] text-gray-400">
        Quelle: <code>abrechnungSnapshot.ergebnisse</code> je Periode. Werte
        spiegeln den Zustand zum Zeitpunkt des Periodenabschlusses und
        ändern sich nicht mehr, auch wenn die Periode wieder geöffnet wird.
      </p>
    </div>
  );
}
