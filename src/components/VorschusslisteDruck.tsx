// Vorschussliste — A4-Druckliste aus dem Einsätze-Screen.
// Alle Einsätze einer Ausgabe, die als Vorschuss ausgezahlt werden sollen:
// Teilgebiet, Austräger, geplanter Vorschuss-Betrag + Spalte zum Quittieren.

import type { Ausgabe, Mitarbeiter, Teilgebiet, Tour } from '../types';
import { formatDonnerstag, kwLabel } from '../lib/kalender';

export interface VorschusslisteZeile {
  teilgebiet: Teilgebiet;
  tour: Tour | null;
  mitarbeiter: Mitarbeiter | null;
  istSpringer: boolean;
  /** null = nicht berechenbar (z. B. Parameter fehlen). */
  betragEur: number | null;
  /** Betrag fest hinterlegt statt berechnet. */
  festerBetrag: boolean;
}

const eur = (n: number) => n.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });

export default function VorschusslisteDruck({
  ausgabe,
  zeilen,
  onClose,
}: {
  ausgabe: Ausgabe;
  zeilen: VorschusslisteZeile[];
  onClose: () => void;
}) {
  const sortiert = [...zeilen].sort((a, b) => {
    if (a.tour?.id !== b.tour?.id) {
      if (!a.tour) return 1;
      if (!b.tour) return -1;
      return a.tour.name.localeCompare(b.tour.name, 'de', { numeric: true });
    }
    return a.teilgebiet.name.localeCompare(b.teilgebiet.name, 'de', { numeric: true });
  });
  const summe = sortiert.reduce((s, z) => s + (z.betragEur ?? 0), 0);

  return (
    <>
      <style>{`
        @media screen {
          .vl-print-only { display: none !important; }
          .vl-sheet { background: white; box-shadow: 0 2px 8px rgba(0,0,0,0.15); margin: 0 auto; width: 210mm; min-height: 297mm; padding: 14mm; }
        }
        @media print {
          .vl-screen-only { display: none !important; }
          html, body { margin: 0 !important; padding: 0 !important; background: white !important; }
          body * { visibility: hidden !important; }
          .vl-print-root, .vl-print-root * { visibility: visible !important; }
          .vl-print-root { position: absolute !important; left: 0; top: 0; width: 100%; }
          @page { size: A4 portrait; margin: 14mm; }
          .vl-sheet { box-shadow: none !important; margin: 0 !important; padding: 0 !important; width: auto !important; min-height: 0 !important; }
          tr { break-inside: avoid; }
        }
        .vl-sheet { font-family: Arial, Helvetica, sans-serif; color: #111827; font-size: 11px; }
        table.vl-table { border-collapse: collapse; width: 100%; }
        table.vl-table th, table.vl-table td { border: 1px solid #6b7280; padding: 5px 6px; vertical-align: middle; }
        table.vl-table th { background: #f3f4f6; text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: 0.03em; }
        .vl-num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
      `}</style>

      <div className="vl-screen-only fixed inset-0 bg-black/60 z-50 flex flex-col">
        <div className="bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3 flex-wrap shrink-0">
          <button onClick={onClose} className="text-gray-600 hover:text-gray-900 text-sm px-3 py-1.5 border border-gray-300 rounded-lg">
            ✕ Schließen
          </button>
          <span className="text-gray-700 font-semibold">Vorschussliste — {kwLabel(ausgabe.kw, ausgabe.jahr)}</span>
          <span className="text-gray-500 text-sm">({sortiert.length} Einsatz/Einsätze)</span>
          <div className="ml-auto">
            <button onClick={() => window.print()} className="bg-blue-700 hover:bg-blue-800 text-white px-4 py-1.5 rounded-lg text-sm font-medium">
              🖨️ Drucken
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-4 bg-gray-200">
          <Blatt ausgabe={ausgabe} zeilen={sortiert} summe={summe} />
        </div>
      </div>

      <div className="vl-print-only vl-print-root">
        <Blatt ausgabe={ausgabe} zeilen={sortiert} summe={summe} />
      </div>
    </>
  );
}

function Blatt({ ausgabe, zeilen, summe }: { ausgabe: Ausgabe; zeilen: VorschusslisteZeile[]; summe: number }) {
  const hatFeste = zeilen.some((z) => z.festerBetrag);
  return (
    <div className="vl-sheet">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '2px solid #1e3a5f', paddingBottom: '6px', marginBottom: '12px' }}>
        <div>
          <div style={{ fontSize: '17px', fontWeight: 700, color: '#1e3a5f' }}>Vorschussliste</div>
          <div style={{ fontSize: '11px', color: '#374151', marginTop: '2px' }}>
            Ausgabe {kwLabel(ausgabe.kw, ausgabe.jahr)} · Erscheinung {formatDonnerstag(ausgabe.kw, ausgabe.jahr)}
          </div>
        </div>
        <div style={{ textAlign: 'right', fontSize: '10px', color: '#374151' }}>
          <div>Schlieper-Druck GmbH · Tip aktuell</div>
          <div>Erstellt: {new Date().toLocaleDateString('de-DE')}</div>
        </div>
      </div>

      <table className="vl-table">
        <thead>
          <tr>
            <th style={{ width: '17%' }}>Tour</th>
            <th style={{ width: '18%' }}>Teilgebiet</th>
            <th>Austräger</th>
            <th style={{ width: '15%' }} className="vl-num">Vorschuss</th>
            <th style={{ width: '24%' }}>Erhalten (Datum / Unterschrift)</th>
          </tr>
        </thead>
        <tbody>
          {zeilen.map((z) => (
            <tr key={z.teilgebiet.id}>
              <td>
                {z.tour ? (
                  <>
                    <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', background: z.tour.farbe, border: '1px solid #374151', marginRight: '4px', verticalAlign: 'middle' }} />
                    {z.tour.name}
                  </>
                ) : '—'}
              </td>
              <td style={{ fontWeight: 600 }}>{z.teilgebiet.name}</td>
              <td>
                {z.mitarbeiter ? (
                  <>
                    <span style={{ fontWeight: 600 }}>{z.mitarbeiter.name}</span>
                    {z.mitarbeiter.nummer && <span style={{ color: '#6b7280' }}> ({z.mitarbeiter.nummer})</span>}
                    {z.istSpringer && <span style={{ color: '#b91c1c', fontSize: '9px', marginLeft: '4px' }}>SPRINGER</span>}
                  </>
                ) : '?'}
              </td>
              <td className="vl-num" style={{ fontWeight: 700 }}>
                {z.betragEur != null ? eur(z.betragEur) : '—'}
                {z.festerBetrag && <sup>*</sup>}
              </td>
              <td style={{ height: '26px' }} />
            </tr>
          ))}
          <tr>
            <td colSpan={3} style={{ fontWeight: 700, textAlign: 'right', background: '#f9fafb' }}>Summe</td>
            <td className="vl-num" style={{ fontWeight: 700, background: '#f9fafb' }}>{eur(summe)}</td>
            <td style={{ background: '#f9fafb' }} />
          </tr>
        </tbody>
      </table>

      <div style={{ marginTop: '8px', fontSize: '9.5px', color: '#4b5563', lineHeight: 1.4 }}>
        Geplanter Vorschuss = rechnerischer Lohn des Einsatzes (Soll-Zeit, Gewichtszulage, ggf. Springer-Zuschlag und
        Sondervereinbarung){hatFeste ? '; * = fest vereinbarter Betrag' : ''}. Der Vorschuss wird mit der Monatsabrechnung verrechnet.
      </div>
    </div>
  );
}
