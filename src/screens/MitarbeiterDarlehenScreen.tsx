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
  darlehen, onEdit, onShowPlan, onDelete,
}: {
  darlehen: MitarbeiterDarlehen[];
  onEdit: (d: MitarbeiterDarlehen) => void;
  onShowPlan: (d: MitarbeiterDarlehen) => void;
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

  // Jahre-Dropdown: ±5 ums aktuelle Jahr / Start-Jahr.
  const jahreOptionen = useMemo(() => {
    const a = new Set<number>();
    const base = heuteJahr;
    for (let j = base - 2; j <= base + 5; j++) a.add(j);
    a.add(startJahr);
    return Array.from(a).sort((x, y) => x - y);
  }, [startJahr, heuteJahr]);

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
