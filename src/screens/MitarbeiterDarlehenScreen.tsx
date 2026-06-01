// Mitarbeiterdarlehen — Admin-Verwaltung von kurzfristigen, zinslosen
// Darlehen an Mitarbeiter mit automatisch generiertem Tilgungsplan und
// Plan/Ist-Vergleich auf Mitarbeiter-Ebene.
//
// Pattern: AbrechnungsvorbereitungScreen (AdminPinGate + MA-Filter +
// Detail-Panel je MA).

import { useState, useMemo, useEffect, type FormEvent } from 'react';
import { useApp } from '../context/AppContext';
import AdminPinGate from '../components/AdminPinGate';
import Modal from '../components/Modal';
import {
  erstelleMitarbeiterDarlehen,
  aktualisiereMitarbeiterDarlehen,
  loescheMitarbeiterDarlehen,
} from '../lib/db';
import {
  berechneTilgungsplan,
  darlehenStatus,
  aggregiereMaDarlehen,
  klassifiziereAbweichung,
  type AbweichungsKlasse,
} from '../lib/darlehen';
import { MONATSNAMEN } from '../lib/kalender';
import type { MitarbeiterDarlehen, Mitarbeiter } from '../types';

const inputClass =
  'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';

function eur(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
}

export default function MitarbeiterDarlehenScreen() {
  return (
    <AdminPinGate allowedRoles={['admin']}>
      <Inhalt />
    </AdminPinGate>
  );
}

function Inhalt() {
  const { mitarbeiter, mitarbeiterDarlehen, lohnbueroAbrechnungen } = useApp();
  const [selectedMaId, setSelectedMaId] = useState<string>('');
  const [editTarget, setEditTarget] = useState<MitarbeiterDarlehen | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [planFor, setPlanFor] = useState<MitarbeiterDarlehen | null>(null);
  const [printFor, setPrintFor] = useState<MitarbeiterDarlehen | null>(null);
  const [filterMaText, setFilterMaText] = useState('');

  // MA-Liste: alle mit ≥1 Darlehen, plus alphabetisch alle anderen.
  const maMitDarlehen = useMemo(() => {
    const ids = new Set(mitarbeiterDarlehen.map((d) => d.mitarbeiterId));
    return mitarbeiter.filter((m) => ids.has(m.id));
  }, [mitarbeiter, mitarbeiterDarlehen]);

  const alleMaSortiert = useMemo(
    () => [...mitarbeiter].sort((a, b) => a.name.localeCompare(b.name, 'de')),
    [mitarbeiter],
  );

  // Wenn noch nichts ausgewählt und es Darlehen gibt → ersten MA mit Darlehen vorbelegen.
  useEffect(() => {
    if (!selectedMaId && maMitDarlehen.length > 0) {
      setSelectedMaId(maMitDarlehen[0].id);
    }
  }, [selectedMaId, maMitDarlehen]);

  const selectedMa = useMemo(
    () => mitarbeiter.find((m) => m.id === selectedMaId) ?? null,
    [mitarbeiter, selectedMaId],
  );

  const darlehenOfMa = useMemo(
    () =>
      mitarbeiterDarlehen
        .filter((d) => d.mitarbeiterId === selectedMaId)
        .sort((a, b) => b.auszahlungsdatum.localeCompare(a.auszahlungsdatum)),
    [mitarbeiterDarlehen, selectedMaId],
  );

  const aggregat = useMemo(
    () =>
      selectedMaId
        ? aggregiereMaDarlehen(mitarbeiterDarlehen, lohnbueroAbrechnungen, selectedMaId)
        : [],
    [mitarbeiterDarlehen, lohnbueroAbrechnungen, selectedMaId],
  );

  // ---- MA-Auswahl-Liste (mit Suche) ----
  const maListeGefiltert = useMemo(() => {
    const f = filterMaText.trim().toLowerCase();
    if (!f) return alleMaSortiert;
    return alleMaSortiert.filter(
      (m) => m.name.toLowerCase().includes(f) || String(m.nummer ?? '').includes(f),
    );
  }, [alleMaSortiert, filterMaText]);

  return (
    <div className="p-4 md:p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">💸 Mitarbeiterdarlehen</h1>
          <p className="text-gray-500 text-sm">
            Kurzfristige zinslose Darlehen an Mitarbeiter — Tilgungsplan, Restschuld,
            Vergleich mit den tatsächlichen Lohnbüro-Abzügen (Lohnart 9993).
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[280px_1fr] gap-4">
        {/* MA-Auswahl (links) */}
        <aside className="bg-white rounded-xl border border-gray-200 p-3 max-h-[80vh] overflow-y-auto">
          <input
            type="text"
            value={filterMaText}
            onChange={(e) => setFilterMaText(e.target.value)}
            placeholder="🔎 Mitarbeiter suchen…"
            className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm mb-2 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />

          {maMitDarlehen.length > 0 && (
            <>
              <div className="text-[11px] uppercase tracking-wide text-gray-400 px-1 mb-1 mt-1">
                Mit Darlehen ({maMitDarlehen.length})
              </div>
              <ul className="space-y-0.5 mb-3">
                {maMitDarlehen
                  .filter((m) =>
                    !filterMaText.trim() ||
                    m.name.toLowerCase().includes(filterMaText.toLowerCase()) ||
                    String(m.nummer ?? '').includes(filterMaText),
                  )
                  .map((m) => (
                    <MaListItem
                      key={m.id}
                      ma={m}
                      anzahl={mitarbeiterDarlehen.filter((d) => d.mitarbeiterId === m.id).length}
                      aktiv={selectedMaId === m.id}
                      onClick={() => setSelectedMaId(m.id)}
                    />
                  ))}
              </ul>
            </>
          )}

          <div className="text-[11px] uppercase tracking-wide text-gray-400 px-1 mb-1">
            Alle Mitarbeiter
          </div>
          <ul className="space-y-0.5">
            {maListeGefiltert.map((m) => (
              <MaListItem
                key={m.id}
                ma={m}
                aktiv={selectedMaId === m.id}
                onClick={() => setSelectedMaId(m.id)}
              />
            ))}
            {maListeGefiltert.length === 0 && (
              <li className="text-xs text-gray-400 italic px-2 py-1">Keine Treffer.</li>
            )}
          </ul>
        </aside>

        {/* Detail-Panel (rechts) */}
        <main className="space-y-4 min-w-0">
          {!selectedMa ? (
            <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-400">
              Bitte links einen Mitarbeiter auswählen.
            </div>
          ) : (
            <>
              {/* MA-Kopf + neues Darlehen-Button */}
              <div className="bg-white rounded-xl border border-gray-200 p-4 flex items-center justify-between flex-wrap gap-2">
                <div>
                  <div className="text-lg font-semibold text-gray-900">{selectedMa.name}</div>
                  <div className="text-xs text-gray-500 font-mono">{selectedMa.nummer}</div>
                </div>
                <button
                  type="button"
                  onClick={() => { setEditTarget(null); setShowForm(true); }}
                  className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700"
                >
                  + Neues Darlehen
                </button>
              </div>

              {/* Darlehen-Liste */}
              <DarlehenListe
                darlehen={darlehenOfMa}
                onEdit={(d) => { setEditTarget(d); setShowForm(true); }}
                onShowPlan={(d) => setPlanFor(d)}
                onPrint={(d) => setPrintFor(d)}
                onDelete={async (d) => {
                  const txt = `Darlehen vom ${new Date(d.auszahlungsdatum).toLocaleDateString('de-DE')} über ${eur(d.auszahlungsbetragEur)} wirklich löschen?`;
                  if (confirm(txt)) await loescheMitarbeiterDarlehen(d.id);
                }}
              />

              {/* Gesamtübersicht (Plan/Ist je Periode) */}
              {aggregat.length > 0 && <Gesamtuebersicht zeilen={aggregat} />}
            </>
          )}
        </main>
      </div>

      {/* Formular-Modal */}
      <Modal
        isOpen={showForm}
        onClose={() => setShowForm(false)}
        title={editTarget ? 'Darlehen bearbeiten' : 'Neues Darlehen erfassen'}
        size="lg"
      >
        <DarlehenForm
          initial={editTarget}
          fixerMa={selectedMa}
          alleMitarbeiter={alleMaSortiert}
          onSave={() => setShowForm(false)}
          onCancel={() => setShowForm(false)}
        />
      </Modal>

      {/* Tilgungsplan-Detail-Modal */}
      <Modal
        isOpen={!!planFor}
        onClose={() => setPlanFor(null)}
        title="Tilgungsplan"
        size="md"
      >
        {planFor && <TilgungsplanDetail darlehen={planFor} />}
      </Modal>

      {/* Druck-Vorschau-Modal */}
      <Modal
        isOpen={!!printFor}
        onClose={() => setPrintFor(null)}
        title="Druckvorschau — Mitarbeiterdarlehen"
        size="xl"
      >
        {printFor && selectedMa && (
          <DarlehenDruckVorschau
            darlehen={printFor}
            ma={selectedMa}
            onClose={() => setPrintFor(null)}
          />
        )}
      </Modal>
    </div>
  );
}

// ---- Komponenten ---------------------------------------------------------

function MaListItem({
  ma, aktiv, onClick, anzahl,
}: { ma: Mitarbeiter; aktiv: boolean; onClick: () => void; anzahl?: number }) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className={`w-full text-left text-sm px-2 py-1.5 rounded transition-colors ${
          aktiv ? 'bg-blue-100 text-blue-900 font-medium' : 'text-gray-700 hover:bg-gray-50'
        }`}
      >
        <span>{ma.name}</span>
        <span className="ml-2 text-xs font-mono text-gray-400">{ma.nummer}</span>
        {anzahl != null && anzahl > 0 && (
          <span className="ml-2 text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full">{anzahl}</span>
        )}
      </button>
    </li>
  );
}

function DarlehenListe({
  darlehen, onEdit, onShowPlan, onPrint, onDelete,
}: {
  darlehen: MitarbeiterDarlehen[];
  onEdit: (d: MitarbeiterDarlehen) => void;
  onShowPlan: (d: MitarbeiterDarlehen) => void;
  onPrint: (d: MitarbeiterDarlehen) => void;
  onDelete: (d: MitarbeiterDarlehen) => void;
}) {
  if (darlehen.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-6 text-center text-sm text-gray-400">
        Noch keine Darlehen erfasst.
      </div>
    );
  }
  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 border-b border-gray-200 text-gray-600 text-xs">
          <tr>
            <th className="px-3 py-2 text-right font-medium">Auszahlung</th>
            <th className="px-3 py-2 text-left font-medium">Datum</th>
            <th className="px-3 py-2 text-right font-medium">Rate</th>
            <th className="px-3 py-2 text-left font-medium">Start</th>
            <th className="px-3 py-2 text-right font-medium" title="Bereits planmäßig getilgt (Stand heute)">Getilgt&nbsp;(Plan)</th>
            <th className="px-3 py-2 text-right font-medium" title="Verbleibender Restbetrag laut Plan (Stand heute)">Rest&nbsp;(Plan)</th>
            <th className="px-3 py-2 text-center font-medium">Status</th>
            <th className="px-3 py-2 text-center font-medium">🔗</th>
            <th className="px-3 py-2 text-left font-medium">Bemerkung</th>
            <th className="px-3 py-2"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {darlehen.map((d) => {
            const st = darlehenStatus(d);
            return (
              <tr key={d.id} className="hover:bg-gray-50">
                <td className="px-3 py-2 text-right font-mono font-medium text-gray-900">{eur(d.auszahlungsbetragEur)}</td>
                <td className="px-3 py-2 text-gray-700 whitespace-nowrap">{new Date(d.auszahlungsdatum).toLocaleDateString('de-DE')}</td>
                <td className="px-3 py-2 text-right font-mono text-gray-700">{eur(d.monatsRateEur)}</td>
                <td className="px-3 py-2 text-gray-700 whitespace-nowrap font-mono text-xs">
                  {String(d.startMonat).padStart(2, '0')}/{d.startJahr}
                </td>
                <td className="px-3 py-2 text-right font-mono text-gray-700">{eur(st.getilgtPlan)}</td>
                <td className="px-3 py-2 text-right font-mono font-medium text-gray-900">{eur(st.restPlan)}</td>
                <td className="px-3 py-2 text-center">
                  {st.status === 'aktiv' ? (
                    <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">aktiv ({st.rateNr}/{st.rateGesamt})</span>
                  ) : (
                    <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">✓ getilgt</span>
                  )}
                </td>
                <td className="px-3 py-2 text-center">
                  {d.externerLink && /^https?:\/\//i.test(d.externerLink) ? (
                    <a href={d.externerLink} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:text-blue-800" title="Vertrag öffnen">🔗</a>
                  ) : (
                    <span className="text-gray-300">—</span>
                  )}
                </td>
                <td className="px-3 py-2 text-xs text-gray-500 max-w-[14rem] truncate" title={d.bemerkung ?? ''}>{d.bemerkung || '—'}</td>
                <td className="px-3 py-2 whitespace-nowrap">
                  <div className="flex gap-2 text-xs">
                    <button type="button" onClick={() => onShowPlan(d)} className="text-blue-600 hover:text-blue-800 underline" title="Tilgungsplan anzeigen">📋 Plan</button>
                    <button type="button" onClick={() => onPrint(d)} className="text-gray-600 hover:text-gray-900 underline" title="Drucken / PDF">🖨️</button>
                    <button type="button" onClick={() => onEdit(d)} className="text-gray-600 hover:text-gray-900 underline">✎</button>
                    <button type="button" onClick={() => onDelete(d)} className="text-red-400 hover:text-red-600">✕</button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Gesamtuebersicht({
  zeilen,
}: {
  zeilen: ReturnType<typeof aggregiereMaDarlehen>;
}) {
  const farbeFuer = (k: AbweichungsKlasse): string => {
    switch (k) {
      case 'gruen': return 'text-green-700';
      case 'gelb':  return 'text-yellow-700 font-medium';
      case 'rot':   return 'text-red-700 font-semibold';
      default:      return 'text-gray-300';
    }
  };
  // Heute (Jahr+Monat) für visuelle Markierung
  const heute = new Date();
  const heuteYm = heute.getFullYear() * 12 + heute.getMonth();
  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
        <h2 className="font-semibold text-gray-800">Gesamtübersicht (Plan vs. Ist)</h2>
        <div className="text-xs text-gray-500 flex items-center gap-3">
          <span className="inline-flex items-center gap-1"><span className="w-2 h-2 bg-green-500 rounded-full"></span> planmäßig</span>
          <span className="inline-flex items-center gap-1"><span className="w-2 h-2 bg-yellow-400 rounded-full"></span> ≤ 10 €</span>
          <span className="inline-flex items-center gap-1"><span className="w-2 h-2 bg-red-500 rounded-full"></span> &gt; 10 €</span>
        </div>
      </div>
      <table className="w-full text-sm">
        <thead className="bg-gray-50 border-b border-gray-200 text-gray-600 text-xs">
          <tr>
            <th className="px-3 py-2 text-left font-medium">Periode</th>
            <th className="px-3 py-2 text-right font-medium" title="Summe der geplanten Tilgungen aller aktiven Darlehen in dieser Periode">Geplant Σ</th>
            <th className="px-3 py-2 text-right font-medium" title="Summe der tatsächlichen Tilgungen laut Lohnbüro-PDF (Lohnart 9993)">Ist Σ (LB)</th>
            <th className="px-3 py-2 text-right font-medium" title="Plan − Ist. Positiv = weniger getilgt als geplant.">Δ</th>
            <th className="px-3 py-2 text-right font-medium" title="Summe der offenen Restbeträge aller Darlehen NACH dieser Periode">Rest Σ</th>
            <th className="px-3 py-2 text-right font-medium" title="Bisher (plan-)getilgt insgesamt">Getilgt Σ</th>
            <th className="px-3 py-2 text-center font-medium">Aktiv</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {zeilen.map((z) => {
            const k = klassifiziereAbweichung(z.summeGeplant, z.summeIst);
            const istVergangenheit = z.jahr * 12 + (z.monat - 1) <= heuteYm;
            const showDelta = istVergangenheit && z.summeGeplant > 0;
            return (
              <tr key={`${z.jahr}-${z.monat}`} className="hover:bg-gray-50">
                <td className="px-3 py-2 font-mono text-xs text-gray-700 whitespace-nowrap">{String(z.monat).padStart(2,'0')}/{z.jahr}</td>
                <td className="px-3 py-2 text-right font-mono text-gray-700">{z.summeGeplant > 0 ? eur(z.summeGeplant) : <span className="text-gray-300">—</span>}</td>
                <td className="px-3 py-2 text-right font-mono text-gray-700">{z.summeIst != null ? eur(z.summeIst) : <span className="text-gray-300" title="Keine Lohnbüro-PDF indiziert">—</span>}</td>
                <td className={`px-3 py-2 text-right font-mono ${showDelta ? farbeFuer(k) : 'text-gray-300'}`}>
                  {!showDelta || z.differenz == null
                    ? '—'
                    : Math.abs(z.differenz) < 0.005 ? '0,00 €' : (z.differenz > 0 ? '+' : '') + eur(z.differenz)}
                </td>
                <td className="px-3 py-2 text-right font-mono text-gray-700">{eur(z.restSumme)}</td>
                <td className="px-3 py-2 text-right font-mono text-gray-700">{eur(z.getilgtSumme)}</td>
                <td className="px-3 py-2 text-center text-gray-600">{z.anzahlAktiv > 0 ? z.anzahlAktiv : '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function TilgungsplanDetail({ darlehen }: { darlehen: MitarbeiterDarlehen }) {
  const plan = berechneTilgungsplan(darlehen);
  const st = darlehenStatus(darlehen);
  return (
    <div>
      <div className="text-sm text-gray-600 mb-3">
        Auszahlung: <strong>{eur(darlehen.auszahlungsbetragEur)}</strong> am{' '}
        {new Date(darlehen.auszahlungsdatum).toLocaleDateString('de-DE')} •{' '}
        Rate: <strong>{eur(darlehen.monatsRateEur)}</strong> •{' '}
        Start: <strong>{String(darlehen.startMonat).padStart(2,'0')}/{darlehen.startJahr}</strong> •{' '}
        Gesamt: <strong>{st.rateGesamt} Raten</strong>
        {plan.length > 0 && (
          <> • Ende: <strong>{String(plan[plan.length-1].monat).padStart(2,'0')}/{plan[plan.length-1].jahr}</strong></>
        )}
      </div>
      <div className="max-h-[60vh] overflow-y-auto border border-gray-200 rounded">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200 text-gray-600 text-xs sticky top-0">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Periode</th>
              <th className="px-3 py-2 text-right font-medium">Geplante Tilgung</th>
              <th className="px-3 py-2 text-right font-medium">Restschuld danach</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {plan.map((z, i) => (
              <tr key={i} className="hover:bg-gray-50">
                <td className="px-3 py-1.5 font-mono text-xs">{String(z.monat).padStart(2,'0')}/{z.jahr}</td>
                <td className="px-3 py-1.5 text-right font-mono">{eur(z.geplanteTilgung)}</td>
                <td className="px-3 py-1.5 text-right font-mono text-gray-700">{eur(z.restSchuldDanach)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---- Druck-Vorschau & HTML-Generator ----------------------------------------

function druckHtml(darlehen: MitarbeiterDarlehen, ma: Mitarbeiter): string {
  const plan = berechneTilgungsplan(darlehen);
  const st = darlehenStatus(darlehen);
  const heute = new Date();
  const heuteYm = heute.getFullYear() * 12 + heute.getMonth();

  const endeZeile = plan.length ? plan[plan.length - 1] : null;
  const letzteRate = endeZeile?.geplanteTilgung ?? 0;
  const endeStr = endeZeile
    ? `${String(endeZeile.monat).padStart(2, '0')}/${endeZeile.jahr}`
    : '–';
  const startStr = `${String(darlehen.startMonat).padStart(2, '0')}/${darlehen.startJahr}`;
  const datumStr = new Date(darlehen.auszahlungsdatum + 'T12:00:00').toLocaleDateString('de-DE');
  const druckDatum = heute.toLocaleDateString('de-DE');
  const druckZeit = heute.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });

  const adresseHtml = ma.adresse
    ? `${ma.adresse.strasse ?? ''}, ${ma.adresse.plz ?? ''} ${ma.adresse.ort ?? ''}`.trim().replace(/^,\s*/, '')
    : '';

  const planZeilen = plan.map((z, i) => {
    const ym = z.jahr * 12 + (z.monat - 1);
    const istVerg = ym < heuteYm;
    const istAktuell = ym === heuteYm;
    const bg = istAktuell ? 'background:#e8f4fd;font-weight:bold;' : istVerg ? 'color:#555;' : '';
    return `<tr style="${bg}">
      <td>${i + 1}</td>
      <td>${String(z.monat).padStart(2,'0')}/${z.jahr}</td>
      <td class="r">${fmtEur(z.geplanteTilgung)}</td>
      <td class="r">${fmtEur(z.restSchuldDanach)}</td>
    </tr>`;
  }).join('\n');

  const statusStr = st.status === 'getilgt'
    ? '✓ vollständig getilgt'
    : `Aktiv — Rate ${st.rateNr} von ${st.rateGesamt}`;

  return `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="UTF-8">
<title>Mitarbeiterdarlehen – ${ma.name}</title>
<style>
  @page { size: A4 portrait; margin: 18mm 20mm 22mm 20mm; }
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 10pt; color: #1a1a1a; margin: 0; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #1a3a6e; padding-bottom: 8px; margin-bottom: 14px; }
  .company { font-size: 13pt; font-weight: bold; color: #1a3a6e; }
  .company-sub { font-size: 8pt; color: #555; margin-top: 2px; }
  .doc-meta { font-size: 8pt; color: #666; text-align: right; }
  h1 { font-size: 14pt; color: #1a3a6e; margin: 0 0 16px 0; font-weight: bold; border-bottom: 1px solid #c0c8d8; padding-bottom: 6px; }
  .section { margin-bottom: 14px; }
  .section-title { font-size: 9pt; font-weight: bold; text-transform: uppercase; letter-spacing: 0.05em; color: #1a3a6e; border-bottom: 1px solid #dde4ef; padding-bottom: 3px; margin-bottom: 8px; }
  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 24px; }
  .grid3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 6px 24px; }
  .field { display: flex; gap: 6px; align-items: baseline; }
  .field-label { font-size: 8.5pt; color: #555; white-space: nowrap; min-width: 155px; }
  .field-value { font-size: 10pt; font-weight: 600; }
  .field-value.mono { font-family: 'Courier New', monospace; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 8pt; font-weight: 600; }
  .badge-aktiv { background: #dbeafe; color: #1d4ed8; }
  .badge-getilgt { background: #d1fae5; color: #065f46; }
  .bemerkung { background: #f9f9f9; border-left: 3px solid #c0c8d8; padding: 6px 10px; font-size: 9.5pt; color: #333; margin-top: 4px; }
  table.plan { width: 100%; border-collapse: collapse; font-size: 9pt; margin-top: 4px; }
  table.plan th { background: #1a3a6e; color: white; padding: 4px 8px; text-align: left; font-size: 8.5pt; }
  table.plan th.r, table.plan td.r { text-align: right; }
  table.plan td { padding: 3px 8px; border-bottom: 1px solid #eee; }
  table.plan tr:last-child td { border-bottom: 2px solid #1a3a6e; font-weight: bold; }
  .legende { font-size: 7.5pt; color: #666; margin-top: 4px; }
  .vereinbarung { font-size: 8.5pt; color: #333; line-height: 1.55; margin-top: 6px; }
  .unterschriften { display: grid; grid-template-columns: 1fr 1fr; gap: 0 40px; margin-top: 28px; }
  .sig-block { border-top: 1px solid #555; padding-top: 4px; font-size: 8pt; color: #444; }
  .sig-line { margin-bottom: 28px; border-bottom: 1px dotted #999; font-size: 7.5pt; color: #aaa; padding-top: 2px; }
  @media print {
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .no-print { display: none !important; }
    table.plan { page-break-inside: auto; }
    table.plan tr { page-break-inside: avoid; }
  }
</style>
</head>
<body>
<div class="header">
  <div>
    <div class="company">Schlieper-Druck GmbH</div>
    <div class="company-sub">Personalverwaltung / Lohnabrechnung</div>
  </div>
  <div class="doc-meta">
    Erstellt: ${druckDatum}, ${druckZeit}<br>
    Druck-ID: ${darlehen.id.slice(0, 8).toUpperCase()}
  </div>
</div>

<h1>Kurzfristiges zinsloses Mitarbeiterdarlehen</h1>

<div class="section">
  <div class="section-title">Mitarbeiter</div>
  <div class="grid2">
    <div class="field"><span class="field-label">Name:</span><span class="field-value">${ma.name}</span></div>
    <div class="field"><span class="field-label">Personalnummer:</span><span class="field-value mono">${ma.nummer}</span></div>
    ${adresseHtml ? `<div class="field" style="grid-column:1/-1"><span class="field-label">Anschrift:</span><span class="field-value">${adresseHtml}</span></div>` : ''}
  </div>
</div>

<div class="section">
  <div class="section-title">Darlehenskonditionen</div>
  <div class="grid2">
    <div class="field"><span class="field-label">Darlehensbetrag:</span><span class="field-value mono">${fmtEur(darlehen.auszahlungsbetragEur)}</span></div>
    <div class="field"><span class="field-label">Auszahlungsdatum:</span><span class="field-value">${datumStr}</span></div>
    <div class="field"><span class="field-label">Monatliche Tilgungsrate:</span><span class="field-value mono">${fmtEur(darlehen.monatsRateEur)}</span></div>
    <div class="field"><span class="field-label">Erste Verrechnung mit Lohn:</span><span class="field-value mono">${startStr}</span></div>
    <div class="field"><span class="field-label">Zinssatz:</span><span class="field-value">0,00 % (zinslos)</span></div>
    <div class="field"><span class="field-label">Voraussichtliches Ende:</span><span class="field-value mono">${endeStr}</span></div>
  </div>
</div>

<div class="section">
  <div class="section-title">Berechnete Werte (Stand ${druckDatum})</div>
  <div class="grid3">
    <div class="field"><span class="field-label">Anzahl Raten gesamt:</span><span class="field-value">${st.rateGesamt}</span></div>
    <div class="field"><span class="field-label">Letzte Rate:</span><span class="field-value mono">${fmtEur(letzteRate)}</span></div>
    <div class="field"><span class="field-label">Status:</span><span class="badge ${st.status === 'getilgt' ? 'badge-getilgt' : 'badge-aktiv'}">${statusStr}</span></div>
    <div class="field"><span class="field-label">Bereits getilgt (Plan):</span><span class="field-value mono">${fmtEur(st.getilgtPlan)}</span></div>
    <div class="field"><span class="field-label">Verbleibende Restschuld:</span><span class="field-value mono">${fmtEur(st.restPlan)}</span></div>
    <div class="field"><span class="field-label">Bereits fällige Raten:</span><span class="field-value">${st.rateNr} von ${st.rateGesamt}</span></div>
  </div>
</div>

${darlehen.bemerkung ? `<div class="section"><div class="section-title">Bemerkung</div><div class="bemerkung">${escHtml(darlehen.bemerkung)}</div></div>` : ''}

<div class="section">
  <div class="section-title">Tilgungsplan</div>
  <table class="plan">
    <thead>
      <tr>
        <th>#</th>
        <th>Periode</th>
        <th class="r">Tilgung</th>
        <th class="r">Restschuld danach</th>
      </tr>
    </thead>
    <tbody>
      ${planZeilen}
    </tbody>
  </table>
  <div class="legende">Fett/blau = aktueller Monat · Grau = vergangene Perioden · Letzte Zeile = tatsächlich letzte Rate (ggf. gekürzt)</div>
</div>

<div class="section">
  <div class="section-title">Vereinbarung</div>
  <div class="vereinbarung">
    Die Firma Schlieper-Druck GmbH gewährt dem oben genannten Mitarbeiter ein kurzfristiges, zinsloses Darlehen in Höhe des genannten Darlehensbetrags.
    Das Darlehen wird durch monatliche Verrechnung mit der Lohnabrechnung in der oben angegebenen Rate zurückgezahlt,
    beginnend ab dem Monat der ersten Verrechnung. Das Darlehen ist unverzüglich in voller Höhe fällig, sofern das Arbeitsverhältnis endet.
    Eine vorzeitige Rückzahlung ist jederzeit möglich. Änderungen dieser Vereinbarung bedürfen der Schriftform.
  </div>
</div>

<div class="unterschriften">
  <div>
    <div class="sig-line">Ort, Datum</div>
    <div class="sig-block">Arbeitgeber — Schlieper-Druck GmbH</div>
  </div>
  <div>
    <div class="sig-line">Ort, Datum</div>
    <div class="sig-block">Arbeitnehmer — ${escHtml(ma.name)}</div>
  </div>
</div>

</body>
</html>`;
}

function fmtEur(n: number): string {
  return n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '&nbsp;€';
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function DarlehenDruckVorschau({
  darlehen, ma, onClose,
}: {
  darlehen: MitarbeiterDarlehen;
  ma: Mitarbeiter;
  onClose: () => void;
}) {
  function drucken() {
    const html = druckHtml(darlehen, ma);
    const win = window.open('', '_blank', 'width=900,height=700,scrollbars=yes');
    if (!win) {
      alert('Pop-up wurde blockiert. Bitte Pop-up-Blockierung für diese Seite deaktivieren und erneut versuchen.');
      return;
    }
    win.document.open();
    win.document.write(html);
    win.document.close();
    win.focus();
    // Kurz warten bis DOM gerendert, dann drucken
    setTimeout(() => { win.print(); }, 400);
  }

  const plan = berechneTilgungsplan(darlehen);
  const st = darlehenStatus(darlehen);
  const endeZeile = plan.length ? plan[plan.length - 1] : null;
  const datumStr = new Date(darlehen.auszahlungsdatum + 'T12:00:00').toLocaleDateString('de-DE');

  return (
    <div className="space-y-4">
      {/* Vorschau-Karte */}
      <div className="border border-gray-200 rounded-lg p-5 bg-white text-sm space-y-4 font-[Arial,Helvetica,sans-serif]">
        {/* Briefkopf */}
        <div className="flex justify-between items-start border-b-2 border-blue-900 pb-3">
          <div>
            <div className="text-lg font-bold text-blue-900">Schlieper-Druck GmbH</div>
            <div className="text-xs text-gray-500">Personalverwaltung / Lohnabrechnung</div>
          </div>
          <div className="text-xs text-gray-400 text-right">
            {new Date().toLocaleDateString('de-DE')}<br/>
            ID: {darlehen.id.slice(0, 8).toUpperCase()}
          </div>
        </div>

        <h2 className="text-base font-bold text-blue-900 border-b border-blue-200 pb-2">
          Kurzfristiges zinsloses Mitarbeiterdarlehen
        </h2>

        {/* Mitarbeiter */}
        <div>
          <div className="text-[10px] uppercase tracking-wider font-bold text-blue-800 mb-1.5">Mitarbeiter</div>
          <div className="grid grid-cols-2 gap-1 text-sm">
            <span className="text-gray-500 text-xs">Name:</span><span className="font-semibold">{ma.name}</span>
            <span className="text-gray-500 text-xs">Personalnummer:</span><span className="font-mono">{ma.nummer}</span>
          </div>
        </div>

        {/* Konditionen */}
        <div>
          <div className="text-[10px] uppercase tracking-wider font-bold text-blue-800 mb-1.5">Darlehenskonditionen</div>
          <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
            <div className="flex gap-2"><span className="text-gray-500 text-xs w-44 shrink-0">Darlehensbetrag:</span><span className="font-mono font-semibold">{eur(darlehen.auszahlungsbetragEur)}</span></div>
            <div className="flex gap-2"><span className="text-gray-500 text-xs w-44 shrink-0">Auszahlungsdatum:</span><span className="font-semibold">{datumStr}</span></div>
            <div className="flex gap-2"><span className="text-gray-500 text-xs w-44 shrink-0">Monatl. Tilgungsrate:</span><span className="font-mono font-semibold">{eur(darlehen.monatsRateEur)}</span></div>
            <div className="flex gap-2"><span className="text-gray-500 text-xs w-44 shrink-0">Erste Verrechnung:</span><span className="font-mono">{String(darlehen.startMonat).padStart(2,'0')}/{darlehen.startJahr}</span></div>
            <div className="flex gap-2"><span className="text-gray-500 text-xs w-44 shrink-0">Zinssatz:</span><span>0,00 % (zinslos)</span></div>
            <div className="flex gap-2"><span className="text-gray-500 text-xs w-44 shrink-0">Voraussichtl. Ende:</span><span className="font-mono">{endeZeile ? `${String(endeZeile.monat).padStart(2,'0')}/${endeZeile.jahr}` : '–'}</span></div>
          </div>
        </div>

        {/* Berechnete Werte */}
        <div>
          <div className="text-[10px] uppercase tracking-wider font-bold text-blue-800 mb-1.5">Berechnete Werte (Stand heute)</div>
          <div className="grid grid-cols-3 gap-x-4 gap-y-1 text-sm">
            <div className="flex gap-2 flex-col"><span className="text-gray-500 text-xs">Raten gesamt</span><span className="font-semibold">{st.rateGesamt}</span></div>
            <div className="flex gap-2 flex-col"><span className="text-gray-500 text-xs">Letzte Rate</span><span className="font-mono font-semibold">{eur(endeZeile?.geplanteTilgung ?? 0)}</span></div>
            <div className="flex gap-2 flex-col"><span className="text-gray-500 text-xs">Status</span>
              <span className={`text-xs px-2 py-0.5 rounded-full font-semibold inline-block ${st.status === 'getilgt' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'}`}>
                {st.status === 'getilgt' ? '✓ getilgt' : `Aktiv ${st.rateNr}/${st.rateGesamt}`}
              </span>
            </div>
            <div className="flex gap-2 flex-col"><span className="text-gray-500 text-xs">Bereits getilgt</span><span className="font-mono">{eur(st.getilgtPlan)}</span></div>
            <div className="flex gap-2 flex-col"><span className="text-gray-500 text-xs">Restschuld</span><span className="font-mono font-semibold">{eur(st.restPlan)}</span></div>
          </div>
        </div>

        {darlehen.bemerkung && (
          <div>
            <div className="text-[10px] uppercase tracking-wider font-bold text-blue-800 mb-1.5">Bemerkung</div>
            <div className="bg-gray-50 border-l-2 border-gray-300 pl-3 py-1.5 text-xs text-gray-700">{darlehen.bemerkung}</div>
          </div>
        )}

        {/* Tilgungsplan kompakt */}
        <div>
          <div className="text-[10px] uppercase tracking-wider font-bold text-blue-800 mb-1.5">
            Tilgungsplan ({plan.length} Raten)
          </div>
          <div className="max-h-48 overflow-y-auto border border-gray-200 rounded text-xs">
            <table className="w-full">
              <thead className="bg-blue-900 text-white sticky top-0">
                <tr>
                  <th className="px-2 py-1.5 text-left">#</th>
                  <th className="px-2 py-1.5 text-left">Periode</th>
                  <th className="px-2 py-1.5 text-right">Tilgung</th>
                  <th className="px-2 py-1.5 text-right">Rest danach</th>
                </tr>
              </thead>
              <tbody>
                {plan.map((z, i) => {
                  const heuteYm = new Date().getFullYear() * 12 + new Date().getMonth();
                  const ym = z.jahr * 12 + (z.monat - 1);
                  const isNow = ym === heuteYm;
                  return (
                    <tr key={i} className={`border-b border-gray-100 ${isNow ? 'bg-blue-50 font-semibold' : ''}`}>
                      <td className="px-2 py-1 text-gray-500">{i + 1}</td>
                      <td className="px-2 py-1 font-mono">{String(z.monat).padStart(2,'0')}/{z.jahr}</td>
                      <td className="px-2 py-1 text-right font-mono">{eur(z.geplanteTilgung)}</td>
                      <td className="px-2 py-1 text-right font-mono">{eur(z.restSchuldDanach)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Unterschriften-Vorschau */}
        <div className="grid grid-cols-2 gap-8 pt-4 mt-2 border-t border-gray-200">
          <div>
            <div className="border-b border-dotted border-gray-400 text-xs text-gray-300 pb-1 mb-1.5">Ort, Datum</div>
            <div className="text-xs text-gray-600">Arbeitgeber — Schlieper-Druck GmbH</div>
          </div>
          <div>
            <div className="border-b border-dotted border-gray-400 text-xs text-gray-300 pb-1 mb-1.5">Ort, Datum</div>
            <div className="text-xs text-gray-600">Arbeitnehmer — {ma.name}</div>
          </div>
        </div>
      </div>

      {/* Aktions-Buttons */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={drucken}
          className="flex items-center gap-2 bg-blue-700 hover:bg-blue-800 text-white font-medium px-5 py-2.5 rounded-lg text-sm shadow transition-colors"
        >
          🖨️ Drucken / Als PDF speichern
        </button>
        <button
          type="button"
          onClick={onClose}
          className="text-sm text-gray-500 hover:text-gray-700 px-3 py-2"
        >
          Schließen
        </button>
        <span className="text-xs text-gray-400 ml-auto">
          Im Druckdialog „Als PDF speichern" wählen für digitales Exemplar.
        </span>
      </div>
    </div>
  );
}

// ---- Form ----------------------------------------------------------------

function DarlehenForm({
  initial, fixerMa, alleMitarbeiter, onSave, onCancel,
}: {
  initial: MitarbeiterDarlehen | null;
  fixerMa: Mitarbeiter | null;
  alleMitarbeiter: Mitarbeiter[];
  onSave: () => void;
  onCancel: () => void;
}) {
  const heuteIso = new Date().toISOString().slice(0, 10);
  const heuteJahr = new Date().getFullYear();
  const heuteMonat = new Date().getMonth() + 1;

  const [maId, setMaId] = useState<string>(initial?.mitarbeiterId ?? fixerMa?.id ?? '');
  const [auszahlung, setAuszahlung] = useState<string>(initial ? String(initial.auszahlungsbetragEur) : '');
  const [datum, setDatum] = useState<string>(initial?.auszahlungsdatum ?? heuteIso);
  const [rate, setRate] = useState<string>(initial ? String(initial.monatsRateEur) : '');
  const [startJahr, setStartJahr] = useState<number>(initial?.startJahr ?? (heuteMonat === 12 ? heuteJahr + 1 : heuteJahr));
  const [startMonat, setStartMonat] = useState<number>(initial?.startMonat ?? (heuteMonat === 12 ? 1 : heuteMonat + 1));
  const [externerLink, setExternerLink] = useState<string>(initial?.externerLink ?? '');
  const [bemerkung, setBemerkung] = useState<string>(initial?.bemerkung ?? '');

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Vorschau-Berechnung
  const vorschau = useMemo(() => {
    const a = parseFloat(auszahlung.replace(',', '.'));
    const r = parseFloat(rate.replace(',', '.'));
    if (!Number.isFinite(a) || a <= 0 || !Number.isFinite(r) || r <= 0) return null;
    const fake: MitarbeiterDarlehen = {
      id: '_preview', mitarbeiterId: maId || '_',
      auszahlungsbetragEur: a, auszahlungsdatum: datum, monatsRateEur: r,
      startJahr, startMonat,
      erstelltAm: 0, aktualisiertAm: 0,
    };
    const plan = berechneTilgungsplan(fake);
    return {
      anzahl: plan.length,
      letzteRate: plan.length ? plan[plan.length - 1].geplanteTilgung : 0,
      letzterMonat: plan.length ? `${String(plan[plan.length - 1].monat).padStart(2,'0')}/${plan[plan.length - 1].jahr}` : '–',
    };
  }, [auszahlung, rate, datum, maId, startJahr, startMonat]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (!maId) { setError('Mitarbeiter ist erforderlich.'); return; }
    const a = parseFloat(auszahlung.replace(',', '.'));
    const r = parseFloat(rate.replace(',', '.'));
    if (!Number.isFinite(a) || a <= 0) { setError('Auszahlungsbetrag muss > 0 sein.'); return; }
    if (!Number.isFinite(r) || r <= 0) { setError('Monatsrate muss > 0 sein.'); return; }
    if (r > a) { setError('Monatsrate darf nicht größer als der Auszahlungsbetrag sein.'); return; }
    if (!datum) { setError('Auszahlungsdatum ist erforderlich.'); return; }
    if (datum > heuteIso) { setError('Auszahlungsdatum darf nicht in der Zukunft liegen.'); return; }
    // Start-Periode ≥ Auszahlungsmonat
    const dy = parseInt(datum.slice(0, 4), 10);
    const dm = parseInt(datum.slice(5, 7), 10);
    const startYm = startJahr * 12 + (startMonat - 1);
    const datumYm = dy * 12 + (dm - 1);
    if (startYm < datumYm) {
      setError('Start-Periode der Verrechnung darf nicht vor dem Auszahlungsmonat liegen.');
      return;
    }

    setSaving(true);
    try {
      const payload: Omit<MitarbeiterDarlehen, 'id' | 'erstelltAm' | 'aktualisiertAm'> = {
        mitarbeiterId: maId,
        auszahlungsbetragEur: a,
        auszahlungsdatum: datum,
        monatsRateEur: r,
        startJahr,
        startMonat,
        externerLink: externerLink.trim() || undefined,
        bemerkung: bemerkung.trim() || undefined,
      };
      if (initial) {
        await aktualisiereMitarbeiterDarlehen(initial.id, payload);
      } else {
        await erstelleMitarbeiterDarlehen(payload);
      }
      onSave();
    } catch (err) {
      console.error(err);
      setError('Fehler beim Speichern.');
    } finally {
      setSaving(false);
    }
  }

  // Jahre-Dropdown: vom Auszahlungsjahr (oder 10 Jahre zurück) bis heuteJahr+5.
  const jahreOptionen = useMemo(() => {
    const a = new Set<number>();
    const datumJahr = parseInt(datum.slice(0, 4), 10);
    const von = Math.min(
      Number.isFinite(datumJahr) ? datumJahr : heuteJahr,
      heuteJahr - 10,
      startJahr,
    );
    const bis = heuteJahr + 5;
    for (let j = von; j <= bis; j++) a.add(j);
    a.add(startJahr);
    return Array.from(a).sort((x, y) => x - y);
  }, [startJahr, heuteJahr, datum]);

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Mitarbeiter *</label>
        {initial ? (
          <input
            type="text"
            value={(alleMitarbeiter.find((m) => m.id === maId)?.name) ?? maId}
            disabled
            className={inputClass + ' bg-gray-100 text-gray-600'}
          />
        ) : (
          <select
            value={maId}
            onChange={(e) => setMaId(e.target.value)}
            className={inputClass}
          >
            <option value="">— wählen —</option>
            {alleMitarbeiter.map((m) => (
              <option key={m.id} value={m.id}>{m.name} ({m.nummer})</option>
            ))}
          </select>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Auszahlungsbetrag (€) *</label>
          <input type="text" inputMode="decimal" value={auszahlung} onChange={(e) => setAuszahlung(e.target.value)} placeholder="z. B. 500,00" className={inputClass} />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Auszahlungsdatum *</label>
          <input type="date" value={datum} max={heuteIso} onChange={(e) => setDatum(e.target.value)} className={inputClass} />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Monatsrate (€) *</label>
          <input type="text" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="z. B. 100,00" className={inputClass} />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Start-Monat *</label>
          <select value={startMonat} onChange={(e) => setStartMonat(Number(e.target.value))} className={inputClass}>
            {MONATSNAMEN.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Start-Jahr *</label>
          <select value={startJahr} onChange={(e) => setStartJahr(Number(e.target.value))} className={inputClass}>
            {jahreOptionen.map((j) => <option key={j} value={j}>{j}</option>)}
          </select>
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          🔗 Externer Link <span className="text-xs text-gray-400 font-normal">(z. B. Google-Drive zum unterschriebenen Vertrag)</span>
        </label>
        <input type="url" value={externerLink} onChange={(e) => setExternerLink(e.target.value)} placeholder="https://drive.google.com/…" className={inputClass} />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Bemerkung</label>
        <textarea value={bemerkung} onChange={(e) => setBemerkung(e.target.value)} rows={2} placeholder="optional" className={inputClass + ' resize-none'} />
      </div>

      {vorschau && (
        <div className="rounded-lg border border-blue-200 bg-blue-50/60 p-3 text-sm text-blue-900">
          📋 Tilgungsplan-Vorschau: <strong>{vorschau.anzahl} Raten</strong>,
          letzte Rate <strong>{eur(vorschau.letzteRate)}</strong>, Ende{' '}
          <strong>{vorschau.letzterMonat}</strong>.
        </div>
      )}

      {error && <p className="text-red-600 text-sm">{error}</p>}

      <div className="flex justify-end gap-3 pt-2">
        <button type="button" onClick={onCancel} className="px-4 py-2 text-sm text-gray-600">Abbrechen</button>
        <button
          type="submit"
          disabled={saving}
          className="bg-blue-600 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? 'Speichere…' : initial ? 'Speichern' : 'Anlegen'}
        </button>
      </div>
    </form>
  );
}
