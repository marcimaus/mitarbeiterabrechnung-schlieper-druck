// Ferienliste Zusammenträger — Druckauswertung (A4 Querformat).
// Zeigt für jeden Ferienzeitraum des Jahres die relevanten Kalenderwochen
// (Ferienwochen ± 1 Pufferwoche) als Spalten, Zusammenträger als Zeilen.

import { useMemo } from 'react';
import type { Mitarbeiter } from '../types';
import { ferienDesjahres, kwsImFerienzeitraum } from '../lib/ferien';
import { donnerstagDerKW, maxKWinJahr } from '../lib/kalender';

interface Props {
  jahr: number;
  zusammenFest: Mitarbeiter[];
  zusammenAbruf: Mitarbeiter[];
  onClose: () => void;
}

function montagDerKW(kw: number, jahr: number): Date {
  const donnerstag = donnerstagDerKW(kw, jahr);
  const d = new Date(donnerstag);
  d.setDate(d.getDate() - 3);
  return d;
}

function sonntagDerKW(kw: number, jahr: number): Date {
  const d = montagDerKW(kw, jahr);
  d.setDate(d.getDate() + 6);
  return d;
}

function fmt(d: Date): string {
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
}

function fmtLang(d: Date): string {
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export default function FerienlisterZusammentraeger({
  jahr,
  zusammenFest,
  zusammenAbruf,
  onClose,
}: Props) {
  const alleZusammen = useMemo(
    () => [...zusammenFest, ...zusammenAbruf],
    [zusammenFest, zusammenAbruf],
  );
  const abrufIds = useMemo(
    () => new Set(zusammenAbruf.map((m) => m.id)),
    [zusammenAbruf],
  );

  const ferien = ferienDesjahres(jahr);
  const maxKw = maxKWinJahr(jahr);

  const abschnitte = useMemo(() => {
    return ferien
      .map((periode) => {
        const ferienKws = kwsImFerienzeitraum(periode, jahr);
        if (ferienKws.length === 0) return null;
        const kwVon = Math.max(1, ferienKws[0] - 1);
        const kwBis = Math.min(maxKw, ferienKws[ferienKws.length - 1] + 1);
        const kws: number[] = [];
        for (let k = kwVon; k <= kwBis; k++) kws.push(k);
        return { periode, ferienKwSet: new Set(ferienKws), kws };
      })
      .filter(Boolean) as Array<{
        periode: ReturnType<typeof ferienDesjahres>[number];
        ferienKwSet: Set<number>;
        kws: number[];
      }>;
  }, [ferien, jahr, maxKw]);

  return (
    <>
      <style>{`
        @media screen {
          .fl-sheet {
            background: white;
            box-shadow: 0 2px 12px rgba(0,0,0,0.15);
            margin: 0 auto 20px;
            width: 297mm;
            min-height: 210mm;
            padding: 10mm 12mm;
            font-family: Arial, Helvetica, sans-serif;
            color: #111;
            font-size: 10pt;
          }
          .fl-screen-bar {
            background: #f3f4f6;
            border-bottom: 1px solid #d1d5db;
            padding: 10px 16px;
            display: flex;
            align-items: center;
            gap: 12px;
            position: sticky;
            top: 0;
            z-index: 50;
          }
        }
        @media print {
          .fl-screen-bar { display: none !important; }
          html, body { margin: 0 !important; padding: 0 !important; background: white !important; }
          body * { visibility: hidden !important; }
          .fl-print-root, .fl-print-root * { visibility: visible !important; }
          .fl-print-root { position: absolute !important; left: 0; top: 0; width: 100%; }
          @page { size: A4 landscape; margin: 10mm 12mm; }
          .fl-sheet {
            box-shadow: none !important;
            margin: 0 !important;
            padding: 0 !important;
            width: auto !important;
            min-height: 0 !important;
          }
          .fl-abschnitt { break-before: page; }
          .fl-abschnitt:first-of-type { break-before: auto; }
        }

        table.fl-tbl {
          border-collapse: collapse;
          width: 100%;
          font-size: 10pt;
          table-layout: fixed;
        }
        table.fl-tbl th,
        table.fl-tbl td {
          border: 1px solid #374151;
          padding: 2px 4px;
          vertical-align: middle;
        }
        table.fl-tbl thead th {
          background: #1e3a5f;
          color: #fff;
          text-align: center;
          font-weight: bold;
          font-size: 10pt;
          line-height: 1.4;
        }
        table.fl-tbl thead th.fl-th-ferien {
          background: #5b21b6;
        }
        .fl-name-cell {
          font-weight: bold;
          font-size: 10pt;
          text-align: left;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .fl-abruf-badge {
          font-weight: normal;
          font-size: 10pt;
          color: #9ca3af;
          display: block;
        }
        .fl-check {
          text-align: left;
          line-height: 1.75;
          padding: 2px 5px !important;
        }
        .fl-check label {
          display: block;
          white-space: nowrap;
          cursor: pointer;
          font-size: 10pt;
        }
        .fl-check input[type="checkbox"] {
          margin-right: 3px;
          width: 10px;
          height: 10px;
          vertical-align: middle;
        }
        tr.fl-row-abruf .fl-name-cell {
          color: #6b7280;
        }
      `}</style>

      <div className="fl-print-root">
        {/* Steuerleiste */}
        <div className="fl-screen-bar">
          <button
            type="button"
            onClick={onClose}
            className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 bg-white hover:bg-gray-50 font-medium"
          >
            ← Zurück zur Planung
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            className="text-sm border border-blue-300 rounded-lg px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-800 font-medium"
          >
            🖨 Drucken / Als PDF speichern
          </button>
          <span className="text-xs text-gray-500 ml-2">
            Ferienliste Zusammenträger {jahr} —&nbsp;
            {abschnitte.length} Ferienperiode(n) —&nbsp;
            {alleZusammen.length} Zusammenträger
            {zusammenAbruf.length > 0 ? ` (davon ${zusammenAbruf.length} auf Abruf)` : ''}
          </span>
        </div>

        {/* Druckblatt */}
        <div className="fl-sheet">
          <div style={{ textAlign: 'center', marginBottom: '5mm' }}>
            <div style={{ fontSize: '14pt', fontWeight: 'bold', letterSpacing: 0.5 }}>
              Ferienliste Zusammenträger {jahr}
            </div>
            <div style={{ fontSize: '10pt', color: '#6b7280', marginTop: 2 }}>
              Bitte ankreuzen: In welchen Kalenderwochen sind Sie da / nicht da / wissen Sie es noch nicht?
            </div>
          </div>

          {abschnitte.length === 0 && (
            <div style={{ color: '#9ca3af', textAlign: 'center', padding: '20mm 0' }}>
              Keine Feriendaten für {jahr} hinterlegt.
            </div>
          )}

          {abschnitte.map((abschnitt, idx) => {
            const { periode, ferienKwSet, kws } = abschnitt;
            const ferienKwsSorted = Array.from(ferienKwSet).sort((a, b) => a - b);
            // Spaltenbreiten: Name-Spalte fix, KW-Spalten gleichmäßig aufteilen
            const namenBreite = 52; // mm
            return (
              <div
                key={`${periode.von}-${periode.bis}`}
                className={idx > 0 ? 'fl-abschnitt' : undefined}
                style={
                  idx > 0
                    ? { paddingTop: '6mm', marginTop: '6mm', borderTop: '2px solid #1e3a5f' }
                    : undefined
                }
              >
                {/* Abschnitts-Kopfzeile */}
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 4 }}>
                  <span style={{ fontSize: '12pt', fontWeight: 'bold', color: '#1e3a5f' }}>
                    {periode.name}
                  </span>
                  <span style={{ fontSize: '10pt', color: '#374151' }}>
                    {fmtLang(new Date(periode.von))} – {fmtLang(new Date(periode.bis))}
                  </span>
                  <span style={{ fontSize: '10pt', color: '#6b7280' }}>
                    Ferienwochen: KW {ferienKwsSorted.join(', ')}
                    {' '}· je 1 Woche Puffer
                  </span>
                </div>

                <table className="fl-tbl">
                  <colgroup>
                    <col style={{ width: `${namenBreite}mm` }} />
                    {kws.map((kw) => (
                      <col key={kw} />
                    ))}
                  </colgroup>
                  <thead>
                    <tr>
                      <th style={{ textAlign: 'left', paddingLeft: 5 }}>Name</th>
                      {kws.map((kw) => {
                        const mo = montagDerKW(kw, jahr);
                        const so = sonntagDerKW(kw, jahr);
                        const istFerien = ferienKwSet.has(kw);
                        return (
                          <th key={kw} className={istFerien ? 'fl-th-ferien' : ''}>
                            <div>KW {kw}</div>
                            <div style={{ fontWeight: 'normal', fontSize: '10pt', opacity: 0.85 }}>
                              {fmt(mo)}–{fmt(so)}
                            </div>
                            {istFerien && (
                              <div style={{ fontSize: '10pt', marginTop: 1 }}>🏫 Ferien</div>
                            )}
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {alleZusammen.map((ma) => (
                      <tr key={ma.id} className={abrufIds.has(ma.id) ? 'fl-row-abruf' : ''}>
                        <td className="fl-name-cell">
                          {ma.name}
                          {abrufIds.has(ma.id) && (
                            <span className="fl-abruf-badge">auf Abruf</span>
                          )}
                        </td>
                        {kws.map((kw) => (
                          <td key={kw} className="fl-check">
                            <label>
                              <input type="checkbox" /> da
                            </label>
                            <label>
                              <input type="checkbox" /> nicht da
                            </label>
                            <label>
                              <input type="checkbox" /> unklar
                            </label>
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
