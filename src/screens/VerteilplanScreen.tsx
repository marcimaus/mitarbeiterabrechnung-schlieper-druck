// Verteilplan / Bestellzettel für Kunden
// Interaktiv: Teilgebiete, ganze Touren, PLZ-Bereiche oder das Gesamtgebiet
// anklicken → Summe der Auswahl. Touren zusammenklappbar. Darunter Summen je
// PLZ. Druck/PDF als A4-Dokument (mehrseitig) — blanko zum händischen
// Ankreuzen oder ausgefüllt mit Auswahl und berechneten Summen.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../context/AppContext';
import AdminPinGate from '../components/AdminPinGate';
import type { Teilgebiet, Tour } from '../types';

export default function VerteilplanScreen() {
  return (
    <AdminPinGate allowedRoles={['admin', 'abrechnung']}>
      <VerteilplanInhalt />
    </AdminPinGate>
  );
}

// ── Datenmodell ───────────────────────────────────────────────────────────────

interface TourGruppe {
  key: string;
  tour: Tour | null;
  label: string;
  tgs: Teilgebiet[];
  summe: number;
}

interface PlzGruppe {
  plz: string;
  orte: string;
  tgs: Teilgebiet[];
  summe: number;
}

interface Kundendaten {
  kundenname: string;
  ansprechpartner: string;
  telefon: string;
  datum: string;
  kw: string;
  format: string;
  gewichtGStk: string;
}

type Variante = 'blanko' | 'ausgefuellt';

/** Auswahlzustand einer Menge von TGs: none / some / all. */
type Status = 'none' | 'some' | 'all';

const nf = (n: number) => n.toLocaleString('de-DE');
const nameSort = (a: string, b: string) => a.localeCompare(b, 'de', { numeric: true });
const summe = (tgs: Teilgebiet[]) => tgs.reduce((s, tg) => s + (tg.stueckzahl || 0), 0);

/** "Uslar1" / "Uslar 2" → "Uslar" */
function ortAusName(name: string): string {
  return name.replace(/[\s\d_\-/.]+$/, '').trim() || name;
}

function statusVon(tgs: Teilgebiet[], auswahl: Set<string>): Status {
  let n = 0;
  for (const tg of tgs) if (auswahl.has(tg.id)) n++;
  if (n === 0) return 'none';
  return n === tgs.length ? 'all' : 'some';
}

function summeAuswahl(tgs: Teilgebiet[], auswahl: Set<string>): number {
  return tgs.reduce((s, tg) => s + (auswahl.has(tg.id) ? tg.stueckzahl || 0 : 0), 0);
}

// ── Screen ────────────────────────────────────────────────────────────────────

function VerteilplanInhalt() {
  const { teilgebiete, touren } = useApp();

  const [kunde, setKunde] = useState<Kundendaten>({
    kundenname: '',
    ansprechpartner: '',
    telefon: '',
    datum: new Date().toISOString().slice(0, 10),
    kw: '',
    format: '',
    gewichtGStk: '',
  });
  const [auswahl, setAuswahl] = useState<Set<string>>(new Set());
  // Startansicht: alle Touren zugeklappt
  const [aufgeklappt, setAufgeklappt] = useState<Set<string>>(new Set());
  const [vorschau, setVorschau] = useState<Variante | null>(null);

  // Nicht buchbare Gebiete ausblenden: TG selbst markiert oder seine Tour markiert.
  const aktiveTGs = useMemo(() => {
    const gesperrteTouren = new Set(touren.filter((t) => t.nichtImVerteilplan).map((t) => t.id));
    return teilgebiete
      .filter((tg) => tg.isActive && !tg.nichtImVerteilplan && !(tg.tourId && gesperrteTouren.has(tg.tourId)))
      .sort((a, b) => nameSort(a.name, b.name));
  }, [teilgebiete, touren]);

  const tourGruppen: TourGruppe[] = useMemo(() => {
    const gruppen: TourGruppe[] = touren
      .filter((t) => !t.nichtImVerteilplan)
      .sort((a, b) => nameSort(a.name, b.name))
      .map((tour) => {
        const tgs = aktiveTGs.filter((tg) => tg.tourId === tour.id);
        return { key: tour.id, tour, label: `Tour ${tour.name}`, tgs, summe: summe(tgs) };
      });
    const tourIds = new Set(touren.map((t) => t.id));
    const ohne = aktiveTGs.filter((tg) => !tg.tourId || !tourIds.has(tg.tourId));
    gruppen.push({ key: '__ohne__', tour: null, label: 'Ohne Tour', tgs: ohne, summe: summe(ohne) });
    return gruppen.filter((g) => g.tgs.length > 0);
  }, [touren, aktiveTGs]);

  const plzGruppen: PlzGruppe[] = useMemo(() => {
    const map = new Map<string, Teilgebiet[]>();
    for (const tg of aktiveTGs) {
      const plz = tg.plz?.trim() || '—';
      if (!map.has(plz)) map.set(plz, []);
      map.get(plz)!.push(tg);
    }
    return [...map.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([plz, tgs]) => ({
        plz,
        orte: [...new Set(tgs.map((tg) => ortAusName(tg.name)))].sort(nameSort).join(', '),
        tgs,
        summe: summe(tgs),
      }));
  }, [aktiveTGs]);

  const gesamt = summe(aktiveTGs);
  const auswahlSumme = summeAuswahl(aktiveTGs, auswahl);
  const auswahlAnzahl = aktiveTGs.filter((tg) => auswahl.has(tg.id)).length;

  /** Setzt/entfernt eine Menge TGs: sind alle gewählt → abwählen, sonst alle wählen. */
  function toggleMenge(tgs: Teilgebiet[]) {
    setAuswahl((prev) => {
      const next = new Set(prev);
      const alle = tgs.every((tg) => next.has(tg.id));
      for (const tg of tgs) {
        if (alle) next.delete(tg.id);
        else next.add(tg.id);
      }
      return next;
    });
  }

  function toggleKlappe(key: string) {
    setAufgeklappt((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const alleAuf = tourGruppen.length > 0 && tourGruppen.every((g) => aufgeklappt.has(g.key));

  return (
    <>
    <div className="p-4 md:p-6 max-w-5xl mx-auto print:hidden">
      {/* Kopf */}
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Verteilplan — Bestellzettel</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Teilgebiete, Touren, PLZ-Bereiche oder das Gesamtgebiet anklicken — die Summe wird berechnet.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setVorschau('blanko')}
            className="px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50"
          >
            📄 PDF blanko
          </button>
          <button
            onClick={() => setVorschau('ausgefuellt')}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
          >
            🖨 PDF ausgefüllt
          </button>
        </div>
      </div>

      {/* Kundendaten */}
      <details className="bg-gray-50 border border-gray-200 rounded-lg px-4 py-3 mb-4">
        <summary className="text-xs font-semibold text-gray-500 uppercase cursor-pointer select-none">
          Kundendaten für den ausgefüllten Plan
        </summary>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
          <Eingabe label="Kundenname / Firma" value={kunde.kundenname} placeholder="REWE Uslar GmbH"
            onChange={(v) => setKunde({ ...kunde, kundenname: v })} />
          <Eingabe label="Ansprechpartner" value={kunde.ansprechpartner} placeholder="Max Mustermann"
            onChange={(v) => setKunde({ ...kunde, ansprechpartner: v })} />
          <Eingabe label="Telefon" value={kunde.telefon} placeholder="05571 12345"
            onChange={(v) => setKunde({ ...kunde, telefon: v })} />
          <Eingabe label="Datum" type="date" value={kunde.datum}
            onChange={(v) => setKunde({ ...kunde, datum: v })} />
          <Eingabe label="Kalenderwoche" value={kunde.kw} placeholder="KW 17/2026"
            onChange={(v) => setKunde({ ...kunde, kw: v })} />
          <Eingabe label="Format der Beilage" value={kunde.format} placeholder="DIN A4, DIN A5 …"
            onChange={(v) => setKunde({ ...kunde, format: v })} />
          <Eingabe label="Gewicht (g/Stk)" value={kunde.gewichtGStk} placeholder="28"
            onChange={(v) => setKunde({ ...kunde, gewichtGStk: v })} />
        </div>
      </details>

      {/* Auswahl-Leiste (klebt oben) */}
      <div className="sticky top-0 z-10 bg-blue-50 border border-blue-200 rounded-lg px-4 py-2.5 mb-3 flex flex-wrap items-center gap-x-5 gap-y-2 shadow-sm">
        <div className="text-sm text-blue-900">
          <span className="font-semibold">Auswahl:</span> {auswahlAnzahl} von {aktiveTGs.length} Teilgebieten
        </div>
        <div className="text-lg font-bold text-blue-900 tabular-nums">
          {nf(auswahlSumme)} <span className="text-sm font-normal">Stück</span>
        </div>
        <div className="ml-auto flex gap-2">
          <button
            onClick={() => setAufgeklappt(alleAuf ? new Set() : new Set(tourGruppen.map((g) => g.key)))}
            className="px-3 py-1 text-xs border border-blue-300 bg-white rounded hover:bg-blue-100"
          >
            {alleAuf ? '▸ Alle zuklappen' : '▾ Alle aufklappen'}
          </button>
          <button
            onClick={() => setAuswahl(new Set())}
            disabled={auswahl.size === 0}
            className="px-3 py-1 text-xs border border-blue-300 bg-white rounded hover:bg-blue-100 disabled:opacity-40"
          >
            Auswahl leeren
          </button>
        </div>
      </div>

      {/* Verteilplan */}
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        {/* Gesamtgebiet */}
        <label className="flex items-center gap-3 px-3 py-2.5 bg-blue-700 text-white cursor-pointer select-none">
          <Checkbox status={statusVon(aktiveTGs, auswahl)} onChange={() => toggleMenge(aktiveTGs)} hell />
          <span className="font-semibold flex-1">Gesamtgebiet</span>
          <span className="text-xs opacity-80 w-24 text-right tabular-nums">
            {auswahlSumme > 0 ? `${nf(auswahlSumme)} gew.` : ''}
          </span>
          <span className="font-bold w-20 text-right tabular-nums">{nf(gesamt)}</span>
        </label>

        {tourGruppen.map((g) => {
          const offen = aufgeklappt.has(g.key);
          const gew = summeAuswahl(g.tgs, auswahl);
          const farbe = g.tour?.farbe ?? '#9ca3af';
          return (
            <div key={g.key} className="border-t border-gray-200">
              <div
                className="flex items-center gap-3 px-3 py-2 select-none"
                style={{ background: farbe + '22', borderLeft: `4px solid ${farbe}` }}
              >
                <Checkbox status={statusVon(g.tgs, auswahl)} onChange={() => toggleMenge(g.tgs)} />
                <button
                  onClick={() => toggleKlappe(g.key)}
                  className="flex-1 flex items-center gap-2 text-left font-semibold text-gray-800"
                >
                  <span className="inline-block w-4 text-gray-500">{offen ? '▾' : '▸'}</span>
                  {g.label}
                  <span className="text-xs font-normal text-gray-500">({g.tgs.length} TG)</span>
                </button>
                <span className="text-xs text-blue-700 w-24 text-right tabular-nums">
                  {gew > 0 ? `${nf(gew)} gew.` : ''}
                </span>
                <span className="font-bold text-gray-900 w-20 text-right tabular-nums">{nf(g.summe)}</span>
              </div>

              {offen && (
                <div>
                  {g.tgs.map((tg) => {
                    const an = auswahl.has(tg.id);
                    return (
                      <label
                        key={tg.id}
                        className={`flex items-center gap-3 pl-10 pr-3 py-1.5 border-t border-gray-100 cursor-pointer text-sm ${an ? 'bg-blue-50' : 'hover:bg-gray-50'}`}
                      >
                        <Checkbox status={an ? 'all' : 'none'} onChange={() => toggleMenge([tg])} />
                        <span className="flex-1 text-gray-800">{tg.name}</span>
                        <span className="w-16 text-gray-500 tabular-nums">{tg.plz}</span>
                        <span className="w-20 text-right tabular-nums text-gray-900">{nf(tg.stueckzahl || 0)}</span>
                      </label>
                    );
                  })}
                  <div className="flex items-center gap-3 pl-10 pr-3 py-1.5 border-t border-gray-200 bg-gray-50 text-sm">
                    <span className="flex-1 font-medium text-gray-600">Summe {g.label}</span>
                    <span className="text-xs text-blue-700 w-24 text-right tabular-nums">
                      {gew > 0 ? `${nf(gew)} gew.` : ''}
                    </span>
                    <span className="w-20 text-right font-bold tabular-nums">{nf(g.summe)}</span>
                  </div>
                </div>
              )}
            </div>
          );
        })}

        <div className="flex items-center gap-3 px-3 py-2.5 bg-blue-700 text-white border-t border-blue-800">
          <span className="w-5" />
          <span className="font-semibold flex-1">Summe Gesamtgebiet</span>
          <span className="text-xs opacity-80 w-24 text-right tabular-nums">
            {auswahlSumme > 0 ? `${nf(auswahlSumme)} gew.` : ''}
          </span>
          <span className="font-bold w-20 text-right tabular-nums">{nf(gesamt)}</span>
        </div>
      </div>

      {/* Summen je PLZ */}
      <h2 className="text-base font-semibold text-gray-900 mt-6 mb-2">Summen je Postleitzahl</h2>
      <div className="bg-white border border-gray-200 rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-100 text-xs uppercase text-gray-600">
            <tr>
              <th className="px-3 py-2 w-10" />
              <th className="px-3 py-2 text-left">PLZ</th>
              <th className="px-3 py-2 text-left">Orte</th>
              <th className="px-3 py-2 text-right">TG</th>
              <th className="px-3 py-2 text-right">Ausgewählt</th>
              <th className="px-3 py-2 text-right">Stückzahl</th>
            </tr>
          </thead>
          <tbody>
            {plzGruppen.map((p) => {
              const gew = summeAuswahl(p.tgs, auswahl);
              const st = statusVon(p.tgs, auswahl);
              return (
                <tr
                  key={p.plz}
                  onClick={() => toggleMenge(p.tgs)}
                  className={`border-t border-gray-100 cursor-pointer ${st !== 'none' ? 'bg-blue-50' : 'hover:bg-gray-50'}`}
                >
                  <td className="px-3 py-1.5" onClick={(e) => e.stopPropagation()}>
                    <Checkbox status={st} onChange={() => toggleMenge(p.tgs)} />
                  </td>
                  <td className="px-3 py-1.5 font-medium tabular-nums">{p.plz}</td>
                  <td className="px-3 py-1.5 text-gray-600">{p.orte}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{p.tgs.length}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-blue-700">{gew > 0 ? nf(gew) : ''}</td>
                  <td className="px-3 py-1.5 text-right font-semibold tabular-nums">{nf(p.summe)}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-gray-300 bg-gray-50 font-bold">
              <td />
              <td className="px-3 py-2" colSpan={2}>Gesamt</td>
              <td className="px-3 py-2 text-right tabular-nums">{aktiveTGs.length}</td>
              <td className="px-3 py-2 text-right tabular-nums text-blue-700">{auswahlSumme > 0 ? nf(auswahlSumme) : ''}</td>
              <td className="px-3 py-2 text-right tabular-nums">{nf(gesamt)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>

      {vorschau && (
        <DruckVorschau
          variante={vorschau}
          kunde={kunde}
          tourGruppen={tourGruppen}
          plzGruppen={plzGruppen}
          aktiveTGs={aktiveTGs}
          auswahl={auswahl}
          onVariante={setVorschau}
          onClose={() => setVorschau(null)}
        />
      )}
    </>
  );
}

// ── Bildschirm-Hilfskomponenten ───────────────────────────────────────────────

function Checkbox({ status, onChange, hell }: { status: Status; onChange: () => void; hell?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = status === 'some';
  }, [status]);
  return (
    <input
      ref={ref}
      type="checkbox"
      checked={status === 'all'}
      onChange={onChange}
      className={`w-5 h-5 cursor-pointer shrink-0 ${hell ? 'accent-white' : 'accent-blue-600'}`}
    />
  );
}

function Eingabe({
  label, value, onChange, placeholder, type = 'text',
}: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string }) {
  return (
    <div>
      <label className="block text-xs text-gray-500 mb-1">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
    </div>
  );
}

// ── Druck / PDF ───────────────────────────────────────────────────────────────

interface DruckProps {
  variante: Variante;
  kunde: Kundendaten;
  tourGruppen: TourGruppe[];
  plzGruppen: PlzGruppe[];
  aktiveTGs: Teilgebiet[];
  auswahl: Set<string>;
}

function DruckVorschau(props: DruckProps & { onVariante: (v: Variante) => void; onClose: () => void }) {
  const { variante, onVariante, onClose } = props;

  function drucken() {
    // Dateiname-Vorschlag für „Als PDF speichern"
    const alt = document.title;
    const kunde = props.kunde.kundenname.trim().replace(/[^\wäöüÄÖÜß-]+/g, '_');
    document.title = variante === 'blanko'
      ? 'Verteilplan_blanko'
      : `Verteilplan${kunde ? '_' + kunde : ''}_${props.kunde.datum}`;
    window.print();
    document.title = alt;
  }

  return (
    <>
      <style>{`
        @media screen {
          .vp-print-root { display: none; }
          .vp-sheet {
            width: 210mm; min-height: 297mm; margin: 0 auto 16px; padding: 8mm 10mm;
            background: white; box-shadow: 0 2px 12px rgba(0,0,0,.25); box-sizing: border-box;
          }
        }
        @media print {
          .vp-screen-only { display: none !important; }
          html, body { margin: 0 !important; padding: 0 !important; background: white !important; }
          body * { visibility: hidden !important; }
          .vp-print-root, .vp-print-root * { visibility: visible !important; }
          .vp-print-root { position: absolute !important; left: 0; top: 0; width: 100%; }
          @page { size: A4 portrait; margin: 8mm 10mm; }
          .vp-sheet { width: auto; padding: 0; }
          .vp-t tr { break-inside: avoid; }
          .vp-tour-kopf { break-after: avoid; }
          .vp-block { break-inside: avoid; }
        }
        .vp-sheet { font-family: Arial, Helvetica, sans-serif; font-size: 7.5pt; line-height: 1.2; color: #111; }
        table.vp-t { width: 100%; border-collapse: collapse; font-size: 7pt; line-height: 1.15; }
        table.vp-t th {
          background: #1d4ed8; color: white; font-size: 6.5pt; font-weight: bold;
          padding: 0.8mm 1.5mm; text-align: left;
        }
        table.vp-t td { padding: 0.3mm 1.5mm; border-bottom: 1px solid #e5e7eb; }
        table.vp-t .r { text-align: right; font-variant-numeric: tabular-nums; }
        table.vp-t .c { text-align: center; width: 6mm; padding-top: 0; padding-bottom: 0; }
        .vp-box {
          display: inline-block; width: 2.6mm; height: 2.6mm; border: 1px solid #444;
          border-radius: 1px; vertical-align: middle; background: white;
          line-height: 2.5mm; text-align: center; font-size: 6pt; font-weight: bold; color: #1d4ed8;
        }
      `}</style>

      <div className="vp-screen-only fixed inset-0 bg-black/60 z-50 flex flex-col">
        <div className="bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3 flex-wrap shrink-0">
          <button
            onClick={onClose}
            className="text-gray-600 hover:text-gray-900 text-sm px-3 py-1.5 border border-gray-300 rounded-lg"
          >
            ✕ Schließen
          </button>
          <div className="flex rounded-lg border border-gray-300 overflow-hidden text-sm">
            {(['blanko', 'ausgefuellt'] as Variante[]).map((v) => (
              <button
                key={v}
                onClick={() => onVariante(v)}
                className={`px-3 py-1.5 ${variante === v ? 'bg-blue-600 text-white' : 'bg-white hover:bg-gray-50'}`}
              >
                {v === 'blanko' ? 'Blanko' : 'Ausgefüllt'}
              </button>
            ))}
          </div>
          <span className="text-gray-500 text-sm hidden md:inline">A4-Vorschau · Seitenumbruch erfolgt beim Drucken</span>
          <div className="ml-auto">
            <button
              onClick={drucken}
              className="bg-blue-700 hover:bg-blue-800 text-white px-4 py-1.5 rounded-lg text-sm font-medium"
            >
              🖨 Drucken / Als PDF speichern
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-auto p-4 bg-gray-300">
          <VerteilplanSheet {...props} />
        </div>
      </div>

      <div className="vp-print-root">
        <VerteilplanSheet {...props} />
      </div>
    </>
  );
}

function VerteilplanSheet({ variante, kunde, tourGruppen, plzGruppen, aktiveTGs, auswahl }: DruckProps) {
  const voll = variante === 'ausgefuellt';
  const gesamt = summe(aktiveTGs);
  const gewGesamt = summeAuswahl(aktiveTGs, auswahl);

  /** Kästchen: blanko immer leer; ausgefüllt ✕ bei voller Auswahl, – bei Teilauswahl. */
  const box = (tgs: Teilgebiet[]) => {
    const st = voll ? statusVon(tgs, auswahl) : 'none';
    return <span className="vp-box">{st === 'all' ? '✕' : st === 'some' ? '–' : ''}</span>;
  };
  const gew = (tgs: Teilgebiet[]) => {
    if (!voll) return '';
    const s = summeAuswahl(tgs, auswahl);
    return s > 0 ? nf(s) : '';
  };

  const datum = voll && kunde.datum ? new Date(kunde.datum).toLocaleDateString('de-DE') : '';

  return (
    <div className="vp-sheet">
      {/* Kopf */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '2px solid #1d4ed8', paddingBottom: '1.5mm', marginBottom: '2.5mm' }}>
        <div>
          <div style={{ fontSize: '12pt', fontWeight: 'bold', color: '#1d4ed8' }}>Schlieper-Druck GmbH</div>
          <div style={{ fontSize: '6.5pt', color: '#555', marginTop: '0.3mm' }}>
            Tel. 05571 9203-0 · info@schlieper-druck.com · www.schlieper-druck.com
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: '11pt', fontWeight: 'bold' }}>Verteilplan</div>
          <div style={{ fontSize: '6.5pt', color: '#555' }}>Bestellzettel Beilagenverteilung · Tip aktuell</div>
        </div>
      </div>

      {/* Kundendaten */}
      <div className="vp-block" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', columnGap: '5mm', rowGap: '1mm', marginBottom: '2mm' }}>
        <DruckFeld label="Kunde / Firma" value={voll ? kunde.kundenname : ''} />
        <DruckFeld label="Ansprechpartner" value={voll ? kunde.ansprechpartner : ''} />
        <DruckFeld label="Telefon" value={voll ? kunde.telefon : ''} />
        <DruckFeld label="Datum" value={datum} />
        <DruckFeld label="Kalenderwoche" value={voll ? kunde.kw : ''} />
        <DruckFeld label="Format / Gewicht (g/Stk)" value={voll ? [kunde.format, kunde.gewichtGStk && `${kunde.gewichtGStk} g`].filter(Boolean).join(' · ') : ''} />
      </div>

      <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '3px', padding: '0.8mm 2mm', marginBottom: '2mm', fontSize: '6.5pt', color: '#1e40af' }}>
        {voll
          ? <>Ausgewählt: <b>{aktiveTGs.filter((tg) => auswahl.has(tg.id)).length} Teilgebiete</b> mit insgesamt <b>{nf(gewGesamt)} Stück</b>.</>
          : <>Bitte kreuzen Sie die gewünschten Teilgebiete, ganze Touren, PLZ-Bereiche oder das Gesamtgebiet an und senden Sie diesen Bogen zurück.</>}
      </div>

      {/* Verteilplan-Tabelle */}
      <table className="vp-t">
        <thead>
          <tr>
            <th className="c">✓</th>
            <th>Teilgebiet</th>
            <th style={{ width: '18mm' }}>PLZ</th>
            <th className="r" style={{ width: '22mm' }}>Stückzahl</th>
            <th className="r" style={{ width: '24mm' }}>Bestellmenge</th>
          </tr>
        </thead>
        <tbody>
          <tr style={{ background: '#dbeafe', fontWeight: 'bold' }}>
            <td className="c">{box(aktiveTGs)}</td>
            <td colSpan={2}>Gesamtgebiet</td>
            <td className="r">{nf(gesamt)}</td>
            <td className="r">{gew(aktiveTGs)}</td>
          </tr>
          {tourGruppen.map((g) => {
            const farbe = g.tour?.farbe ?? '#9ca3af';
            return [
              <tr key={`k-${g.key}`} className="vp-tour-kopf" style={{ background: farbe + '2a' }}>
                <td className="c" style={{ borderLeft: `3px solid ${farbe}` }}>{box(g.tgs)}</td>
                <td colSpan={2} style={{ fontWeight: 'bold' }}>
                  {g.label} <span style={{ fontWeight: 'normal', color: '#666', fontSize: '6pt' }}>({g.tgs.length} Teilgebiete)</span>
                </td>
                <td className="r" style={{ fontWeight: 'bold' }}>{nf(g.summe)}</td>
                <td className="r" style={{ fontWeight: 'bold' }}>{gew(g.tgs)}</td>
              </tr>,
              ...g.tgs.map((tg) => (
                <tr key={tg.id}>
                  <td className="c">{box([tg])}</td>
                  <td style={{ paddingLeft: '4mm' }}>{tg.name}</td>
                  <td>{tg.plz}</td>
                  <td className="r">{nf(tg.stueckzahl || 0)}</td>
                  <td className="r">{gew([tg])}</td>
                </tr>
              )),
              <tr key={`s-${g.key}`} style={{ background: '#f3f4f6' }}>
                <td className="c" />
                <td colSpan={2} style={{ fontStyle: 'italic', color: '#444' }}>Summe {g.label}</td>
                <td className="r" style={{ fontWeight: 'bold' }}>{nf(g.summe)}</td>
                <td className="r" style={{ fontWeight: 'bold' }}>{gew(g.tgs)}</td>
              </tr>,
            ];
          })}
          <tr style={{ background: '#1d4ed8', color: 'white', fontWeight: 'bold', fontSize: '7.5pt' }}>
            <td className="c" />
            <td colSpan={2}>Summe Gesamtgebiet</td>
            <td className="r">{nf(gesamt)}</td>
            <td className="r">{voll ? nf(gewGesamt) : ''}</td>
          </tr>
        </tbody>
      </table>

      {/* Summen je PLZ */}
      <div style={{ fontSize: '8.5pt', fontWeight: 'bold', margin: '3mm 0 1mm', breakAfter: 'avoid' }}>
        Summen je Postleitzahl
      </div>
      <table className="vp-t">
        <thead>
          <tr>
            <th className="c">✓</th>
            <th style={{ width: '18mm' }}>PLZ</th>
            <th>Orte</th>
            <th className="r" style={{ width: '12mm' }}>TG</th>
            <th className="r" style={{ width: '22mm' }}>Stückzahl</th>
            <th className="r" style={{ width: '24mm' }}>Bestellmenge</th>
          </tr>
        </thead>
        <tbody>
          {plzGruppen.map((p) => (
            <tr key={p.plz}>
              <td className="c">{box(p.tgs)}</td>
              <td style={{ fontWeight: 'bold' }}>{p.plz}</td>
              <td style={{ color: '#444' }}>{p.orte}</td>
              <td className="r">{p.tgs.length}</td>
              <td className="r">{nf(p.summe)}</td>
              <td className="r">{gew(p.tgs)}</td>
            </tr>
          ))}
          <tr style={{ background: '#1d4ed8', color: 'white', fontWeight: 'bold' }}>
            <td className="c" />
            <td colSpan={2}>Gesamt</td>
            <td className="r">{aktiveTGs.length}</td>
            <td className="r">{nf(gesamt)}</td>
            <td className="r">{voll ? nf(gewGesamt) : ''}</td>
          </tr>
        </tbody>
      </table>

      {/* Unterschrift */}
      <div className="vp-block" style={{ marginTop: '9mm', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15mm' }}>
        <div style={{ borderTop: '1px solid #555', paddingTop: '0.8mm', fontSize: '6.5pt', color: '#555' }}>
          Unterschrift Kunde / Datum
        </div>
        <div style={{ borderTop: '1px solid #555', paddingTop: '0.8mm', fontSize: '6.5pt', color: '#555' }}>
          Schlieper-Druck GmbH — Auftragsannahme
        </div>
      </div>
    </div>
  );
}

function DruckFeld({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: '5.5pt', color: '#888', textTransform: 'uppercase', letterSpacing: '0.3px' }}>{label}</div>
      <div style={{ borderBottom: '1px solid #aaa', minHeight: '4.2mm', fontSize: '8pt', paddingTop: '0.2mm' }}>
        {value || ' '}
      </div>
    </div>
  );
}
