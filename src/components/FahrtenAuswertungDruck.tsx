// Fahrtkosten-Auswertung — A4-Druckliste für einen einzelnen Mitarbeiter.
// Zeigt die einer Abrechnungsperiode zugeordneten Fahrten sowie — separat —
// die noch keinem Monat (keiner Periode) zugeordneten Fahrten desselben MA.
// Enthält Stammdaten des Mitarbeiters und die gewählte Abrechnungsperiode.

import { useMemo } from 'react';
import type { Abrechnungsperiode, Fahrt, Mitarbeiter } from '../types';

interface Props {
  ma: Mitarbeiter;
  periode: Abrechnungsperiode;
  /** Fahrten dieses MA, die der gewählten Periode zugeordnet sind. */
  fahrtenPeriode: Fahrt[];
  /** Fahrten dieses MA ohne Periodenzuordnung (noch keinem Monat zugeordnet). */
  fahrtenOffen: Fahrt[];
  /** EUR pro km für diesen MA (individuell oder global). */
  satz: number;
  onClose: () => void;
}

function formatDatum(iso: string): string {
  // iso = YYYY-MM-DD
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

const eur = (n: number) =>
  n.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });

export default function FahrtenAuswertungDruck({
  ma,
  periode,
  fahrtenPeriode,
  fahrtenOffen,
  satz,
  onClose,
}: Props) {
  const sortPeriode = useMemo(
    () => [...fahrtenPeriode].sort((a, b) => a.datum.localeCompare(b.datum)),
    [fahrtenPeriode]
  );
  const sortOffen = useMemo(
    () => [...fahrtenOffen].sort((a, b) => a.datum.localeCompare(b.datum)),
    [fahrtenOffen]
  );

  return (
    <>
      <style>{`
        @media screen {
          .fa-print-only { display: none !important; }
          .fa-sheet {
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
          .fa-screen-only { display: none !important; }
          html, body { margin: 0 !important; padding: 0 !important; background: white !important; }
          body * { visibility: hidden !important; }
          .fa-print-root, .fa-print-root * { visibility: visible !important; }
          .fa-print-root { position: absolute !important; left: 0; top: 0; width: 100%; }
          @page { size: A4 portrait; margin: 12mm 14mm; }
          .fa-sheet { box-shadow: none !important; margin: 0 !important; padding: 0 !important; width: auto !important; min-height: 0 !important; }
          .fa-row { break-inside: avoid; }
        }
        table.fa-table { border-collapse: collapse; width: 100%; font-size: 10.5px; }
        table.fa-table th, table.fa-table td {
          border: 1px solid #6b7280;
          padding: 4px 6px;
          vertical-align: top;
        }
        table.fa-table th {
          background: #f3f4f6;
          font-weight: 600;
          font-size: 10px;
          text-transform: uppercase;
          letter-spacing: 0.03em;
          text-align: left;
        }
        .fa-num { text-align: right; font-variant-numeric: tabular-nums; }
      `}</style>

      <div className="fa-screen-only fixed inset-0 bg-black/60 z-50 flex flex-col">
        <div className="bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3 flex-wrap shrink-0">
          <button
            onClick={onClose}
            className="text-gray-600 hover:text-gray-900 text-sm px-3 py-1.5 border border-gray-300 rounded-lg"
          >
            ✕ Schließen
          </button>
          <span className="text-gray-700 font-semibold">
            Fahrtkosten-Auswertung — {ma.name}
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
          <FahrtenSheet
            ma={ma}
            periode={periode}
            fahrtenPeriode={sortPeriode}
            fahrtenOffen={sortOffen}
            satz={satz}
          />
        </div>
      </div>

      <div className="fa-print-only fa-print-root">
        <FahrtenSheet
          ma={ma}
          periode={periode}
          fahrtenPeriode={sortPeriode}
          fahrtenOffen={sortOffen}
          satz={satz}
        />
      </div>
    </>
  );
}

function FahrtenSheet({
  ma,
  periode,
  fahrtenPeriode,
  fahrtenOffen,
  satz,
}: {
  ma: Mitarbeiter;
  periode: Abrechnungsperiode;
  fahrtenPeriode: Fahrt[];
  fahrtenOffen: Fahrt[];
  satz: number;
}) {
  const summeKm = fahrtenPeriode.reduce((s, f) => s + f.streckKm, 0);
  const summeEur = fahrtenPeriode.reduce((s, f) => s + f.streckKm * satz, 0);
  const offenKm = fahrtenOffen.reduce((s, f) => s + f.streckKm, 0);
  const offenEur = fahrtenOffen.reduce((s, f) => s + f.streckKm * satz, 0);

  return (
    <div className="fa-sheet">
      {/* Kopf */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '10px', borderBottom: '2px solid #1e3a5f', paddingBottom: '6px' }}>
        <div>
          <div style={{ fontSize: '16px', fontWeight: 700, color: '#1e3a5f' }}>
            Fahrtkosten-Auswertung
          </div>
          <div style={{ fontSize: '10px', color: '#6b7280', marginTop: '1px' }}>
            Schlieper-Druck GmbH
          </div>
        </div>
        <div style={{ textAlign: 'right', fontSize: '10px', color: '#374151' }}>
          <div><strong>Abrechnungsperiode:</strong> {periode.bezeichnung}</div>
          <div><strong>Satz:</strong> {satz.toFixed(2).replace('.', ',')} €/km</div>
          <div>Erstellt: {new Date().toLocaleDateString('de-DE')}</div>
        </div>
      </div>

      {/* Stammdaten */}
      <StammdatenBlock ma={ma} />

      {/* Fahrten der Periode */}
      <div style={{ fontSize: '12px', fontWeight: 700, color: '#1e3a5f', margin: '4px 0 5px' }}>
        Fahrten — {periode.bezeichnung}
      </div>
      <table className="fa-table">
        <thead>
          <tr>
            <th style={{ width: '14%' }}>Datum</th>
            <th>Ziel / Route</th>
            <th style={{ width: '12%', textAlign: 'right' }}>km</th>
            <th style={{ width: '16%', textAlign: 'right' }}>Betrag</th>
          </tr>
        </thead>
        <tbody>
          {fahrtenPeriode.length === 0 && (
            <tr>
              <td colSpan={4} style={{ textAlign: 'center', color: '#9ca3af', padding: '10px' }}>
                Keine Fahrten in dieser Abrechnungsperiode.
              </td>
            </tr>
          )}
          {fahrtenPeriode.map((f) => (
            <tr key={f.id} className="fa-row">
              <td style={{ whiteSpace: 'nowrap' }}>{formatDatum(f.datum)}</td>
              <td>
                {f.ziel}
                {f.bemerkung && (
                  <div style={{ fontSize: '9px', color: '#6b7280' }}>{f.bemerkung}</div>
                )}
              </td>
              <td className="fa-num">{f.streckKm.toLocaleString('de-DE')}</td>
              <td className="fa-num">{eur(f.streckKm * satz)}</td>
            </tr>
          ))}
        </tbody>
        {fahrtenPeriode.length > 0 && (
          <tfoot>
            <tr style={{ fontWeight: 700, background: '#eef2ff' }}>
              <td colSpan={2} style={{ textAlign: 'right' }}>
                Summe ({fahrtenPeriode.length} {fahrtenPeriode.length === 1 ? 'Fahrt' : 'Fahrten'})
              </td>
              <td className="fa-num">{summeKm.toLocaleString('de-DE')} km</td>
              <td className="fa-num">{eur(summeEur)}</td>
            </tr>
          </tfoot>
        )}
      </table>

      {/* Noch nicht zugeordnete Fahrten */}
      <div style={{ fontSize: '12px', fontWeight: 700, color: '#92400e', margin: '16px 0 5px' }}>
        Noch keinem Monat zugeordnete Fahrten
      </div>
      {fahrtenOffen.length === 0 ? (
        <div style={{ fontSize: '10.5px', color: '#6b7280', fontStyle: 'italic' }}>
          Alle Fahrten dieses Mitarbeiters sind einer Abrechnungsperiode zugeordnet.
        </div>
      ) : (
        <table className="fa-table">
          <thead>
            <tr>
              <th style={{ width: '14%' }}>Datum</th>
              <th>Ziel / Route</th>
              <th style={{ width: '12%', textAlign: 'right' }}>km</th>
              <th style={{ width: '16%', textAlign: 'right' }}>Betrag</th>
            </tr>
          </thead>
          <tbody>
            {fahrtenOffen.map((f) => (
              <tr key={f.id} className="fa-row">
                <td style={{ whiteSpace: 'nowrap' }}>{formatDatum(f.datum)}</td>
                <td>
                  {f.ziel}
                  {f.bemerkung && (
                    <div style={{ fontSize: '9px', color: '#6b7280' }}>{f.bemerkung}</div>
                  )}
                </td>
                <td className="fa-num">{f.streckKm.toLocaleString('de-DE')}</td>
                <td className="fa-num">{eur(f.streckKm * satz)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr style={{ fontWeight: 700, background: '#fffbeb' }}>
              <td colSpan={2} style={{ textAlign: 'right' }}>
                Summe ({fahrtenOffen.length} {fahrtenOffen.length === 1 ? 'Fahrt' : 'Fahrten'})
              </td>
              <td className="fa-num">{offenKm.toLocaleString('de-DE')} km</td>
              <td className="fa-num">{eur(offenEur)}</td>
            </tr>
          </tfoot>
        </table>
      )}

      <div style={{ marginTop: '20px', fontSize: '10px', color: '#374151', display: 'flex', gap: '28px' }}>
        <div>Datum / Unterschrift Mitarbeiter: <span style={{ display: 'inline-block', borderBottom: '1px solid #6b7280', minWidth: '160px' }}>&nbsp;</span></div>
      </div>
    </div>
  );
}

function StammdatenBlock({ ma }: { ma: Mitarbeiter }) {
  return (
    <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap', marginBottom: '12px', fontSize: '10.5px', color: '#374151', background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '4px', padding: '7px 10px' }}>
      <div>
        <div style={{ fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.04em', color: '#9ca3af' }}>Mitarbeiter</div>
        <div style={{ fontWeight: 700, fontSize: '12px', color: '#111827' }}>{ma.name}</div>
        <div>Nr. {ma.nummer}</div>
      </div>
      {(ma.adresse?.strasse || ma.adresse?.ort) && (
        <div>
          <div style={{ fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.04em', color: '#9ca3af' }}>Anschrift</div>
          {ma.adresse?.strasse && <div>{ma.adresse.strasse}</div>}
          <div>{ma.adresse?.plz} {ma.adresse?.ort}</div>
        </div>
      )}
      {(ma.telefon || ma.mobilnummer) && (
        <div>
          <div style={{ fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.04em', color: '#9ca3af' }}>Kontakt</div>
          {ma.telefon && <div>☎ {ma.telefon}</div>}
          {ma.mobilnummer && <div>📱 {ma.mobilnummer}</div>}
        </div>
      )}
    </div>
  );
}
