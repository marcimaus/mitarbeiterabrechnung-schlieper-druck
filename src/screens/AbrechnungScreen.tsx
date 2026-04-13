import { useState, type FormEvent } from 'react';
import { useApp } from '../context/AppContext';
import AdminPinGate from '../components/AdminPinGate';
import { ladePeriodeData, berechneAbrechnung, eur, stdMin } from '../lib/abrechnungslogik';
import { exportiereAbrechnung } from '../lib/exportXlsx';
import { schliessePeriodeAb, oeffnePeriodeWieder, erstelleVorschuss, aktualisiereVorschuss, loescheVorschuss } from '../lib/db';
import type { MitarbeiterAbrechnung } from '../lib/abrechnungslogik';
import type { Abrechnungsperiode, Vorschuss } from '../types';

export default function AbrechnungScreen() {
  return (
    <AdminPinGate>
      <AbrechnungInhalt />
    </AdminPinGate>
  );
}

function AbrechnungInhalt() {
  const { mitarbeiter, teilgebiete, abrechnungsperioden, parameter: params } = useApp();
  const [selectedPeriodeId, setSelectedPeriodeId] = useState('');
  const [ergebnisse, setErgebnisse] = useState<MitarbeiterAbrechnung[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [fehler, setFehler] = useState('');
  const [exportierend, setExportierend] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [abschliessenBestaetigt, setAbschliessenBestaetigt] = useState(false);

  const sortedPerioden = [...abrechnungsperioden].sort((a, b) =>
    b.jahr !== a.jahr ? b.jahr - a.jahr : b.monat - a.monat
  );

  const selectedPeriode = sortedPerioden.find((p) => p.id === selectedPeriodeId);

  async function handleBerechnen() {
    if (!selectedPeriode || !params) return;
    setLoading(true);
    setFehler('');
    setErgebnisse(null);
    setExpandedId(null);
    try {
      const data = await ladePeriodeData(selectedPeriode);
      const result = berechneAbrechnung(mitarbeiter, teilgebiete, data, params, selectedPeriode);
      setErgebnisse(result);
    } catch (e: any) {
      setFehler(e.message ?? 'Fehler bei der Berechnung');
    } finally {
      setLoading(false);
    }
  }

  async function handleExport() {
    if (!selectedPeriode || !ergebnisse) return;
    setExportierend(true);
    try {
      await exportiereAbrechnung(selectedPeriode, ergebnisse);
    } catch (e: any) {
      alert('Export fehlgeschlagen: ' + (e.message ?? e));
    } finally {
      setExportierend(false);
    }
  }

  async function handlePeriodeAbschliessen() {
    if (!selectedPeriode) return;
    try {
      await schliessePeriodeAb(selectedPeriode.id, teilgebiete);
    } catch (e: any) {
      alert('Fehler beim Abschließen: ' + (e.message ?? e));
    }
    setAbschliessenBestaetigt(false);
  }

  async function handlePeriodeWiederOeffnen() {
    if (!selectedPeriode) return;
    if (!confirm(`Periode "${selectedPeriode.bezeichnung}" wieder öffnen? Alle Daten bleiben erhalten, Eingaben sind wieder möglich.`)) return;
    await oeffnePeriodeWieder(selectedPeriode.id);
  }

  const gesamtSumme = ergebnisse?.reduce((s, e) => s + e.gesamt, 0) ?? 0;
  const gesamtVorschuesse = ergebnisse?.reduce((s, e) => s + e.vorschussSumme, 0) ?? 0;
  const gesamtNetto = gesamtSumme - gesamtVorschuesse;

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Monatsabrechnung</h1>

      {/* Periodenauswahl + Steuerung */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 mb-6">
        <div className="flex flex-wrap items-center gap-3">
          <label className="text-sm font-medium text-gray-700 shrink-0">Periode:</label>
          <select
            value={selectedPeriodeId}
            onChange={(e) => {
              setSelectedPeriodeId(e.target.value);
              setErgebnisse(null);
              setAbschliessenBestaetigt(false);
            }}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">— Periode auswählen —</option>
            {sortedPerioden.map((p) => (
              <option key={p.id} value={p.id}>
                {p.bezeichnung}
                {p.status === 'abgeschlossen' ? ' ✓' : ''}
                {' '}(KW {p.kalenderwochen.join(', ')})
              </option>
            ))}
          </select>

          <button
            onClick={handleBerechnen}
            disabled={!selectedPeriodeId || loading || !params}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Berechne...' : 'Berechnen'}
          </button>

          {ergebnisse && (
            <>
              <button
                onClick={handleExport}
                disabled={exportierend}
                className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-green-700 transition-colors disabled:opacity-50"
              >
                {exportierend ? 'Exportiere...' : '↓ Excel-Export'}
              </button>

              {selectedPeriode?.status === 'offen' && (
                !abschliessenBestaetigt ? (
                  <button
                    onClick={() => setAbschliessenBestaetigt(true)}
                    className="ml-auto bg-gray-100 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-200 transition-colors"
                  >
                    Periode abschließen
                  </button>
                ) : (
                  <div className="ml-auto flex items-center gap-2">
                    <span className="text-sm text-orange-700">Wirklich abschließen?</span>
                    <button
                      onClick={handlePeriodeAbschliessen}
                      className="bg-orange-600 text-white px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-orange-700 transition-colors"
                    >
                      Ja, abschließen
                    </button>
                    <button
                      onClick={() => setAbschliessenBestaetigt(false)}
                      className="text-sm text-gray-500 hover:text-gray-700"
                    >
                      Abbrechen
                    </button>
                  </div>
                )
              )}
              {selectedPeriode?.status === 'abgeschlossen' && (
                <div className="ml-auto flex items-center gap-2">
                  <span className="text-sm bg-green-100 text-green-700 px-3 py-1.5 rounded-lg font-medium">
                    ✓ Abgeschlossen
                  </span>
                  <button
                    onClick={handlePeriodeWiederOeffnen}
                    className="text-xs text-gray-500 hover:text-orange-600 underline"
                    title="Periode wieder öffnen (Admin)"
                  >
                    Entsperren
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        {fehler && (
          <div className="mt-3 bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
            {fehler}
          </div>
        )}
      </div>

      {/* Ergebnisse */}
      {ergebnisse && (
        <>
          {/* Gesamt-Kacheln */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <SummaryCard
              label="Mitarbeiter"
              value={ergebnisse.length.toString()}
              farbe="bg-blue-50 border-blue-100"
              textFarbe="text-blue-700"
            />
            <SummaryCard
              label="Austragen gesamt"
              value={eur(ergebnisse.reduce((s, e) => s + e.austraegerGesamt, 0))}
              farbe="bg-purple-50 border-purple-100"
              textFarbe="text-purple-700"
            />
            <SummaryCard
              label="Zeiterfassung gesamt"
              value={eur(ergebnisse.reduce((s, e) => s + e.zeitLohn + e.zusammentragenGesamt, 0))}
              farbe="bg-green-50 border-green-100"
              textFarbe="text-green-700"
            />
            <SummaryCard
              label="Gesamtlohn (brutto)"
              value={eur(gesamtSumme)}
              farbe="bg-orange-50 border-orange-100"
              textFarbe="text-orange-700"
              gross
            />
            {gesamtVorschuesse > 0 && (
              <SummaryCard
                label="Vorschüsse gesamt"
                value={`- ${eur(gesamtVorschuesse)}`}
                farbe="bg-red-50 border-red-100"
                textFarbe="text-red-700"
              />
            )}
            {gesamtVorschuesse > 0 && (
              <SummaryCard
                label="Netto-Auszahlung"
                value={eur(gesamtNetto)}
                farbe="bg-green-50 border-green-100"
                textFarbe="text-green-800"
                gross
              />
            )}
          </div>

          {/* Detailtabelle */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Mitarbeiter</th>
                  <th className="px-4 py-3 text-right font-medium text-gray-600">Austragen</th>
                  <th className="px-4 py-3 text-right font-medium text-gray-600">Zusammentr.</th>
                  <th className="px-4 py-3 text-right font-medium text-gray-600">Zeiterfassung</th>
                  <th className="px-4 py-3 text-right font-medium text-gray-600">Fix</th>
                  <th className="px-4 py-3 text-right font-medium text-gray-600">Fahrtkosten</th>
                  <th className="px-4 py-3 text-right font-medium text-gray-600">Brutto</th>
                  <th className="px-4 py-3 text-right font-medium text-red-600">Vorschuss</th>
                  <th className="px-4 py-3 text-right font-medium text-gray-600 pr-5">Auszahlung</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {ergebnisse.map((er) => (
                  <>
                    <tr
                      key={er.mitarbeiter.id}
                      className="hover:bg-gray-50 cursor-pointer transition-colors"
                      onClick={() =>
                        setExpandedId(
                          expandedId === er.mitarbeiter.id ? null : er.mitarbeiter.id
                        )
                      }
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className="text-gray-400 text-xs">
                            {expandedId === er.mitarbeiter.id ? '▼' : '▶'}
                          </span>
                          <div>
                            <div className="font-medium text-gray-900">{er.mitarbeiter.name}</div>
                            <div className="text-xs text-gray-400">{er.mitarbeiter.nummer}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right text-gray-700">
                        {er.austraegerGesamt > 0 ? eur(er.austraegerGesamt) : '—'}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-700">
                        {er.zusammentragenGesamt > 0 ? eur(er.zusammentragenGesamt) : '—'}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-700">
                        {er.zeitLohn > 0 ? eur(er.zeitLohn) : '—'}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-700">
                        {er.fixesGehalt > 0 ? eur(er.fixesGehalt) : '—'}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-700">
                        {er.fahrtkostenGesamt > 0 ? eur(er.fahrtkostenGesamt) : '—'}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-gray-900">
                        {eur(er.gesamt)}
                      </td>
                      <td className="px-4 py-3 text-right text-red-600 font-medium">
                        {er.vorschussSumme > 0 ? `- ${eur(er.vorschussSumme)}` : '—'}
                      </td>
                      <td className="px-4 py-3 text-right font-bold text-gray-900 pr-5">
                        {eur(er.gesamt - er.vorschussSumme)}
                      </td>
                    </tr>

                    {/* Detail-Aufklappung */}
                    {expandedId === er.mitarbeiter.id && (
                      <tr key={`${er.mitarbeiter.id}-detail`}>
                        <td colSpan={9} className="bg-gray-50 px-6 py-4">
                          <DetailAnsicht
                            ergebnis={er}
                            periode={selectedPeriode}
                            onVorschussChange={handleBerechnen}
                          />
                        </td>
                      </tr>
                    )}
                  </>
                ))}

                {/* Summenzeile */}
                <tr className="bg-blue-50 border-t-2 border-blue-200">
                  <td className="px-4 py-3 font-bold text-gray-900">Gesamt</td>
                  <td className="px-4 py-3 text-right font-bold text-gray-900">
                    {eur(ergebnisse.reduce((s, e) => s + e.austraegerGesamt, 0))}
                  </td>
                  <td className="px-4 py-3 text-right font-bold text-gray-900">
                    {eur(ergebnisse.reduce((s, e) => s + e.zusammentragenGesamt, 0))}
                  </td>
                  <td className="px-4 py-3 text-right font-bold text-gray-900">
                    {eur(ergebnisse.reduce((s, e) => s + e.zeitLohn, 0))}
                  </td>
                  <td className="px-4 py-3 text-right font-bold text-gray-900">
                    {eur(ergebnisse.reduce((s, e) => s + e.fixesGehalt, 0))}
                  </td>
                  <td className="px-4 py-3 text-right font-bold text-gray-900">
                    {eur(ergebnisse.reduce((s, e) => s + e.fahrtkostenGesamt, 0))}
                  </td>
                  <td className="px-4 py-3 text-right font-bold text-gray-900">
                    {eur(gesamtSumme)}
                  </td>
                  <td className="px-4 py-3 text-right font-bold text-red-700">
                    {gesamtVorschuesse > 0 ? `- ${eur(gesamtVorschuesse)}` : '—'}
                  </td>
                  <td className="px-4 py-3 text-right font-bold text-blue-800 text-base pr-5">
                    {eur(gesamtNetto)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </>
      )}

      {!ergebnisse && !loading && selectedPeriodeId && (
        <div className="text-center py-12 text-gray-400">
          Klicke auf "Berechnen" um die Abrechnung zu starten.
        </div>
      )}
    </div>
  );
}

// ---- Detail-Ansicht je Mitarbeiter -------------------------

function DetailAnsicht({
  ergebnis: er,
  periode,
  onVorschussChange,
}: {
  ergebnis: MitarbeiterAbrechnung;
  periode?: Abrechnungsperiode;
  onVorschussChange?: () => void;
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
      {/* Austräger-Einsätze */}
      {er.austraegerEinsaetze.length > 0 && (
        <div>
          <h4 className="font-semibold text-gray-700 mb-2 text-sm">Austräger ({er.austraegerEinsaetze.length} Einsätze)</h4>
          <div className="space-y-1">
            {er.austraegerEinsaetze.map((e, i) => (
              <div key={i} className="flex items-center justify-between bg-white rounded px-3 py-1.5 border border-gray-200">
                <div>
                  <span className="font-medium text-gray-800">{e.teilgebietName}</span>
                  <span className="text-gray-400 ml-2">KW {e.kw}/{e.jahr}</span>
                  {e.typ === 'springer' && (
                    <span className="ml-2 bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">Springer</span>
                  )}
                </div>
                <div className="text-right">
                  <div className="font-medium text-gray-900">{eur(e.detail.gesamt)}</div>
                  <div className="text-gray-400">{stdMin(e.detail.zeitStunden)}</div>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-1 text-right font-semibold text-gray-800 pr-1">
            ∑ {eur(er.austraegerGesamt)}
          </div>
        </div>
      )}

      {/* Zusammentragen */}
      {er.zusammentragenEinsaetze.length > 0 && (
        <div>
          <h4 className="font-semibold text-gray-700 mb-2 text-sm">Zusammentragen ({er.zusammentragenEinsaetze.length} Einsätze)</h4>
          <div className="space-y-1">
            {er.zusammentragenEinsaetze.map((z, i) => (
              <div key={i} className="flex items-center justify-between bg-white rounded px-3 py-1.5 border border-gray-200">
                <div>
                  <span className="text-gray-400">KW {z.kw}</span>
                  {z.istVorarbeit && (
                    <span className="ml-2 bg-pink-100 text-pink-700 px-1.5 py-0.5 rounded">Vorarbeit</span>
                  )}
                  <span className="text-gray-600 ml-2">{z.stapelBearbeitet} Stapel</span>
                </div>
                <div className="text-right">
                  <div className="font-medium text-gray-900">{eur(z.lohn)}</div>
                  {z.stunden != null && <div className="text-gray-400">{stdMin(z.stunden)}</div>}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-1 text-right font-semibold text-gray-800 pr-1">
            ∑ {eur(er.zusammentragenGesamt)}
          </div>
        </div>
      )}

      {/* Zeiterfassung */}
      {er.arbeitszeiten.length > 0 && (
        <div>
          <h4 className="font-semibold text-gray-700 mb-2 text-sm">
            Zeiterfassung — {stdMin(er.zeitStunden)} → {eur(er.zeitLohn)}
          </h4>
          <div className="space-y-1">
            {er.arbeitszeiten.map((az, i) => {
              const nettoMin = az.endTime
                ? Math.max(0, (az.endTime - az.startTime) / 60_000 - az.gesamtPauseMinuten)
                : 0;
              return (
                <div key={i} className="flex items-center justify-between bg-white rounded px-3 py-1.5 border border-gray-200">
                  <div>
                    <span className="text-gray-600">
                      {new Date(az.startTime).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' })}
                    </span>
                    <span className="ml-2 text-gray-500">{az.typ}</span>
                  </div>
                  <div className="text-gray-800 font-medium">{stdMin(nettoMin / 60)}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Fixes Gehalt & Fahrtkosten */}
      {(er.fixesGehalt > 0 || er.fahrten.length > 0) && (
        <div>
          {er.fixesGehalt > 0 && (
            <div className="bg-white rounded px-3 py-2 border border-gray-200 mb-2">
              <div className="flex justify-between">
                <span className="text-gray-600">Fixes Gehalt</span>
                <span className="font-semibold text-gray-900">{eur(er.fixesGehalt)}</span>
              </div>
            </div>
          )}
          {er.fahrten.length > 0 && (
            <div>
              <h4 className="font-semibold text-gray-700 mb-1 text-sm">
                Fahrtkosten ({er.fahrten.length} Fahrten · {er.fahrtSatzEurProKm.toFixed(2)} €/km)
              </h4>
              <div className="space-y-1">
                {er.fahrten.map((f, i) => (
                  <div key={i} className="flex justify-between bg-white rounded px-3 py-1.5 border border-gray-200">
                    <span className="text-gray-600">
                      {f.datum} · {f.streckKm} km → {f.ziel}
                      {f.bemerkung && <span className="text-gray-400 ml-1">({f.bemerkung})</span>}
                    </span>
                    <span className="font-medium text-gray-900">{eur(f.streckKm * er.fahrtSatzEurProKm)}</span>
                  </div>
                ))}
              </div>
              <div className="mt-1 text-right font-semibold text-gray-800 pr-1">
                ∑ {er.fahrten.reduce((s, f) => s + f.streckKm, 0)} km · {eur(er.fahrtkostenGesamt)}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Vorschüsse */}
      {periode && (
        <VorschussverwaltungDetail
          mitarbeiterId={er.mitarbeiter.id}
          periodeId={periode.id}
          vorschuesse={er.vorschuesse}
          onChange={onVorschussChange ?? (() => {})}
        />
      )}
    </div>
  );
}

// ---- Vorschuss-Verwaltung in Detail-Ansicht -----------------

function VorschussverwaltungDetail({
  mitarbeiterId,
  periodeId,
  vorschuesse,
  onChange,
}: {
  mitarbeiterId: string;
  periodeId: string;
  vorschuesse: Vorschuss[];
  onChange: () => void;
}) {
  const { userRole } = useApp();
  const isAdmin = userRole === 'admin';
  const [showForm, setShowForm] = useState(false);
  const [editTarget, setEditTarget] = useState<Vorschuss | null>(null);
  const [betrag, setBetrag] = useState('');
  const [bemerkung, setBemerkung] = useState('');
  const [saving, setSaving] = useState(false);

  function oeffneForm(v?: Vorschuss) {
    if (v) {
      setEditTarget(v);
      setBetrag(v.betragEur.toString());
      setBemerkung(v.bemerkung ?? '');
    } else {
      setEditTarget(null);
      setBetrag('');
      setBemerkung('');
    }
    setShowForm(true);
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    const betragEur = parseFloat(betrag);
    if (isNaN(betragEur) || betragEur <= 0) return;
    setSaving(true);
    try {
      if (editTarget) {
        await aktualisiereVorschuss(editTarget.id, { betragEur, bemerkung: bemerkung || undefined });
      } else {
        await erstelleVorschuss({ mitarbeiterId, abrechnungsperiodeId: periodeId, betragEur, bemerkung: bemerkung || undefined });
      }
      setShowForm(false);
      onChange();
    } finally {
      setSaving(false);
    }
  }

  async function handleLoeschen(id: string) {
    if (!confirm('Vorschuss wirklich löschen?')) return;
    await loescheVorschuss(id);
    onChange();
  }

  return (
    <div className="md:col-span-2">
      <div className="flex items-center justify-between mb-2">
        <h4 className="font-semibold text-gray-700 text-sm">
          Vorschüsse
          {vorschuesse.length > 0 && (
            <span className="ml-2 font-normal text-red-600">
              — ∑ {eur(vorschuesse.reduce((s, v) => s + v.betragEur, 0))}
            </span>
          )}
        </h4>
        {isAdmin && !showForm && (
          <button
            onClick={() => oeffneForm()}
            className="text-xs text-blue-600 hover:text-blue-800 underline"
          >
            + Vorschuss erfassen
          </button>
        )}
      </div>

      {showForm && (
        <form onSubmit={handleSave} className="bg-white rounded border border-blue-200 p-3 mb-2 flex flex-wrap gap-3 items-end">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Betrag (€) *</label>
            <input
              type="number"
              min="0.01"
              step="0.01"
              value={betrag}
              onChange={(e) => setBetrag(e.target.value)}
              placeholder="z.B. 50.00"
              className="border border-gray-300 rounded px-2 py-1 text-xs w-28 focus:outline-none focus:ring-1 focus:ring-blue-500"
              autoFocus
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Bemerkung</label>
            <input
              type="text"
              value={bemerkung}
              onChange={(e) => setBemerkung(e.target.value)}
              placeholder="Optional"
              className="border border-gray-300 rounded px-2 py-1 text-xs w-48 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={saving || !betrag}
              className="bg-blue-600 text-white px-3 py-1 rounded text-xs font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? '...' : editTarget ? 'Speichern' : 'Erfassen'}
            </button>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1"
            >
              Abbrechen
            </button>
          </div>
        </form>
      )}

      {vorschuesse.length === 0 ? (
        <div className="text-gray-400 text-xs bg-white rounded border border-gray-200 px-3 py-2">
          Keine Vorschüsse erfasst
        </div>
      ) : (
        <div className="space-y-1">
          {vorschuesse.map((v) => (
            <div key={v.id} className="flex items-center justify-between bg-white rounded px-3 py-1.5 border border-red-100">
              <div>
                <span className="font-medium text-red-700">- {eur(v.betragEur)}</span>
                {v.bemerkung && <span className="text-gray-500 ml-2">{v.bemerkung}</span>}
                <span className="text-gray-400 ml-2 text-xs">
                  {new Date(v.erstelltAm).toLocaleDateString('de-DE')}
                </span>
              </div>
              {isAdmin && !showForm && (
                <div className="flex gap-2">
                  <button onClick={() => oeffneForm(v)} className="text-xs text-blue-600 hover:text-blue-800">Bearbeiten</button>
                  <button onClick={() => handleLoeschen(v.id)} className="text-xs text-red-500 hover:text-red-700">Löschen</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---- Hilfskomponenten ----------------------------------------

function SummaryCard({
  label,
  value,
  farbe,
  textFarbe,
  gross = false,
}: {
  label: string;
  value: string;
  farbe: string;
  textFarbe: string;
  gross?: boolean;
}) {
  return (
    <div className={`rounded-xl border p-4 ${farbe}`}>
      <div className="text-xs text-gray-500 mb-1">{label}</div>
      <div className={`font-bold ${textFarbe} ${gross ? 'text-xl' : 'text-base'}`}>{value}</div>
    </div>
  );
}
