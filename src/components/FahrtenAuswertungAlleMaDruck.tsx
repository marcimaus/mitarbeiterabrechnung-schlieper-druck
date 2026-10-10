// Fahrtkosten-Auswertung über ALLE Mitarbeiter — A4-Druckliste als Anlage
// zur Lohnabrechnung (Dokumentation). Gruppiert die einer Abrechnungsperiode
// zugeordneten Fahrten je Mitarbeiter mit Zwischensummen (km + Betrag) und
// einer Gesamtsumme am Ende.

import { useMemo } from 'react';
import type { Abrechnungsperiode, Fahrt, Mitarbeiter, Parameter } from '../types';

interface Props {
  periode: Abrechnungsperiode;
  /** Alle Fahrten, die der gewählten Periode zugeordnet sind (über alle MA). */
  fahrten: Fahrt[];
  /** Alle MA — für Namens-/Stammdaten-Auflösung und individuellen Satz. */
  mitarbeiter: Mitarbeiter[];
  /** Globale Parameter (Standard-Satz, falls MA keinen individuellen hat). */
  parameter: Parameter | null;
  onClose: () => void;
}

function formatDatum(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

const eur = (n: number) =>
  n.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });

interface MaGruppe {
  ma: Mitarbeiter | undefined;
  maId: string;
  satz: number;
  fahrten: Fahrt[];
  summeKm: number;
  summeEur: number;
}

export default function FahrtenAuswertungAlleMaDruck({
  periode,
  fahrten,
  mitarbeiter,
  parameter,
  onClose,
}: Props) {
  const standardSatz = parameter?.fahrkostenEurProKm ?? 0.30;

  const gruppen: MaGruppe[] = useMemo(() => {
    const map = new Map<string, Fahrt[]>();
    for (const f of fahrten) {
      const arr = map.get(f.mitarbeiterId) ?? [];
      arr.push(f);
      map.set(f.mitarbeiterId, arr);
    }
    const result: MaGruppe[] = [];
    for (const [maId, list] of map) {
      const ma = mitarbeiter.find((m) => m.id === maId);
      const satz = ma?.fahrkostenEurProKm ?? standardSatz;
      const sortiert = [...list].sort((a, b) => a.datum.localeCompare(b.datum));
      const summeKm = sortiert.reduce((s, f) => s + f.streckKm, 0);
      const summeEur = sortiert.reduce((s, f) => s + f.streckKm * satz, 0);
      result.push({ ma, maId, satz, fahrten: sortiert, summeKm, summeEur });
    }
    result.sort((a, b) => {
      const an = a.ma?.name ?? 'zzz';
      const bn = b.ma?.name ?? 'zzz';
      return an.localeCompare(bn, 'de');
    });
    return result;
  }, [fahrten, mitarbeiter, standardSatz]);

  const gesamtKm = gruppen.reduce((s, g) => s + g.summeKm, 0);
  const gesamtEur = gruppen.reduce((s, g) => s + g.summeEur, 0);
  const gesamtFahrten = gruppen.reduce((s, g) => s + g.fahrten.length, 0);

  return (
    <>
      <style>{`
        @media screen {
          .faa-print-only { display: none !important; }
          .faa-sheet {
            background: white;
            box-shadow: 0 2px 8px rgba(0,0,0,0.15);
            margin: 0 auto 16px;
            width: 210mm;
            min-height: 297mm;
            padding: 12mm 14mm;
            font-family: Arial, Helvetica, sans-serif;
            color: #111827;
            font-size: 11px;
          }
        }
        @media print {
          .faa-screen-only { display: none !important; }
          html, body { margin: 0 !important; padding: 0 !important; background: white !important; }
          body * { visibility: hidden !important; }
          .faa-print-root, .faa-print-root * { visibility: visible !important; }
          .faa-print-root { position: absolute !important; left: 0; top: 0; width: 100%; }
          @page { size: A4 portrait; margin: 12mm 14mm; }
          .faa-sheet { box-shadow: none !important; margin: 0 !important; padding: 0 !important; width: auto !important; min-height: 0 !important; }
          .faa-ma-block { break-inside: avoid; }
          .faa-row { break-inside: avoid; }
        }
        table.faa-table { border-collapse: collapse; width: 100%; font-size: 10.5px; }
        table.faa-table th, table.faa-table td {
          border: 1px solid #6b7280;
          padding: 3px 6px;
          vertical-align: top;
        }
        table.faa-table th {
          background: #f3f4f6;
          font-weight: 600;
          font-size: 10px;
          text-transform: uppercase;
          letter-spacing: 0.03em;
          text-align: left;
        }
        .faa-num { text-align: right; font-variant-numeric: tabular-nums; }
      `}</style>

      <div className="faa-screen-only fixed inset-0 bg-black/60 z-50 flex flex-col">
        <div className="bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3 flex-wrap shrink-0">
          <button
            onClick={onClose}
            className="text-gray-600 hover:text-gray-900 text-sm px-3 py-1.5 border border-gray-300 rounded-lg"
          >
            ✕ Schließen
          </button>
          <span className="text-gray-700 font-semibold">
            Fahrtkosten-Auswertung — alle Mitarbeiter
          </span>
          <span className="text-gray-500 text-sm">({periode.bezeichnung})</span>
          <div className="ml-auto">
            <button
              onClick={() => window.print()}
              className="bg-blue-700 hover:bg-blue-800 text-white px-4 py-1.5 rounded-lg text-sm font-medium"
            >
              🖨️ Drucken
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 bg-gray-200">
          <Sheet
            periode={periode}
            gruppen={gruppen}
            gesamtKm={gesamtKm}
            gesamtEur={gesamtEur}
            gesamtFahrten={gesamtFahrten}
            standardSatz={standardSatz}
          />
        </div>
      </div>

      <div className="faa-print-only faa-print-root">
        <Sheet
          periode={periode}
          gruppen={gruppen}
          gesamtKm={gesamtKm}
          gesamtEur={gesamtEur}
          gesamtFahrten={gesamtFahrten}
          standardSatz={standardSatz}
        />
      </div>
    </>
  );
}

function Sheet({
  periode,
  gruppen,
  gesamtKm,
  gesamtEur,
  gesamtFahrten,
  standardSatz,
}: {
  periode: Abrechnungsperiode;
  gruppen: MaGruppe[];
  gesamtKm: number;
  gesamtEur: number;
  gesamtFahrten: number;
  standardSatz: number;
}) {
  return (
    <div className="faa-sheet">
      {/* Kopf */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '10px', borderBottom: '2px solid #1e3a5f', paddingBottom: '6px' }}>
        <div>
          <div style={{ fontSize: '16px', fontWeight: 700, color: '#1e3a5f' }}>
            Fahrtkosten-Auswertung — Anlage zur Lohnabrechnung
          </div>
          <div style={{ fontSize: '10px', color: '#6b7280', marginTop: '1px' }}>
            Schlieper-Druck GmbH · alle Mitarbeiter
          </div>
        </div>
        <div style={{ textAlign: 'right', fontSize: '10px', color: '#374151' }}>
          <div><strong>Abrechnungsperiode:</strong> {periode.bezeichnung}</div>
          <div><strong>Standard-Satz:</strong> {standardSatz.toFixed(2).replace('.', ',')} €/km</div>
          <div>Erstellt: {new Date().toLocaleDateString('de-DE')}</div>
        </div>
      </div>

      {gruppen.length === 0 ? (
        <div style={{ padding: '24px', textAlign: 'center', color: '#9ca3af', fontStyle: 'italic' }}>
          Keine Fahrten in dieser Abrechnungsperiode.
        </div>
      ) : (
        gruppen.map((g) => (
          <div key={g.maId} className="faa-ma-block" style={{ marginBottom: '14px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '3px' }}>
              <div style={{ fontSize: '12px', fontWeight: 700, color: '#1e3a5f' }}>
                {g.ma?.name ?? 'Unbekannter Mitarbeiter'}
                {g.ma?.nummer && (
                  <span style={{ fontWeight: 400, color: '#6b7280', marginLeft: '8px' }}>
                    Nr. {g.ma.nummer}
                  </span>
                )}
              </div>
              <div style={{ fontSize: '10px', color: '#374151' }}>
                Satz: {g.satz.toFixed(2).replace('.', ',')} €/km
                {g.ma?.fahrkostenEurProKm != null && (
                  <span style={{ color: '#6b7280', marginLeft: '4px' }}>(individuell)</span>
                )}
              </div>
            </div>
            <table className="faa-table">
              <thead>
                <tr>
                  <th style={{ width: '14%' }}>Datum</th>
                  <th>Ziel / Route</th>
                  <th style={{ width: '12%', textAlign: 'right' }}>km</th>
                  <th style={{ width: '16%', textAlign: 'right' }}>Betrag</th>
                </tr>
              </thead>
              <tbody>
                {g.fahrten.map((f) => (
                  <tr key={f.id} className="faa-row">
                    <td style={{ whiteSpace: 'nowrap' }}>{formatDatum(f.datum)}</td>
                    <td>
                      {f.ziel}
                      {f.bemerkung && (
                        <div style={{ fontSize: '9px', color: '#6b7280' }}>{f.bemerkung}</div>
                      )}
                    </td>
                    <td className="faa-num">{f.streckKm.toLocaleString('de-DE')}</td>
                    <td className="faa-num">{eur(f.streckKm * g.satz)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ fontWeight: 700, background: '#eef2ff' }}>
                  <td colSpan={2} style={{ textAlign: 'right' }}>
                    Zwischensumme ({g.fahrten.length} {g.fahrten.length === 1 ? 'Fahrt' : 'Fahrten'})
                  </td>
                  <td className="faa-num">{g.summeKm.toLocaleString('de-DE')} km</td>
                  <td className="faa-num">{eur(g.summeEur)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        ))
      )}

      {/* Gesamtsumme */}
      {gruppen.length > 0 && (
        <div style={{ marginTop: '12px', borderTop: '2px solid #1e3a5f', paddingTop: '8px' }}>
          <table className="faa-table">
            <tbody>
              <tr style={{ fontWeight: 700, background: '#1e3a5f', color: 'white' }}>
                <td style={{ padding: '6px 8px', fontSize: '11px' }}>
                  Gesamt ({gruppen.length} {gruppen.length === 1 ? 'Mitarbeiter' : 'Mitarbeiter'} ·{' '}
                  {gesamtFahrten} {gesamtFahrten === 1 ? 'Fahrt' : 'Fahrten'})
                </td>
                <td className="faa-num" style={{ width: '20%', padding: '6px 8px', fontSize: '11px' }}>
                  {gesamtKm.toLocaleString('de-DE')} km
                </td>
                <td className="faa-num" style={{ width: '20%', padding: '6px 8px', fontSize: '11px' }}>
                  {eur(gesamtEur)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
