// Kontrolle Gewichte — Druckliste für die manuelle Gewichtskontrolle nach dem Zusammentragen
// Je Teilgebiet wird das STAPEL-Soll-Gewicht (Stückzahl × Anzeigenblatt + Stückzahl × aller
// für das Teilgebiet gebuchten Beilagen) berechnet — die Kollegen wiegen den fertigen Stapel
// im Ganzen, deshalb ist Stapel-kg der maßgebliche Wert (nicht g/Stück).
// Grenzwerte: Min = Soll * (1 - toleranzUnten%),  Max = Soll * (1 + toleranzOben%)
//
// Spalten: Teilgebiet | Stk. | IST | Min. | IST | Max. | IST | Soll | Seiten Azb. | Beilagen Soll | Beilagen IST

import { useMemo } from 'react';
import type { Ausgabe, Beilage, Parameter, Teilgebiet, Tour } from '../types';
import {
  berechneGewichtAnzeigenblattKg,
  berechneGewichtBeilagenKg,
} from '../lib/berechnung';

interface Props {
  ausgabe: Ausgabe;
  teilgebiete: Teilgebiet[];
  beilagen: Beilage[];
  touren: Tour[];
  parameter: Parameter;
  onClose: () => void;
}

interface Zeile {
  tg: Teilgebiet;
  tour: Tour | undefined;
  /** STAPEL-Sollgewicht in kg: Stückzahl × Anzeigenblatt + Stückzahl × aller Beilagen. */
  sollKg: number;
  minKg: number;
  maxKg: number;
  /** Anzahl aller für das TG gebuchten Beilagen (intern + extern). */
  beilagenAnz: number;
}

function fmtKg(v: number): string {
  return v.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function KontrolleGewichteDruck({
  ausgabe,
  teilgebiete,
  beilagen,
  touren,
  parameter,
  onClose,
}: Props) {
  const tourMap = useMemo(() => new Map(touren.map((t) => [t.id, t])), [touren]);
  const tolOben = parameter.gewichtToleranzObenProzent ?? 2;
  const tolUnten = parameter.gewichtToleranzUntenProzent ?? 1;

  const zeilen: Zeile[] = useMemo(() => {
    const aktive = teilgebiete.filter((tg) => tg.isActive);
    aktive.sort((a, b) => {
      const tA = a.tourId ? (tourMap.get(a.tourId)?.name ?? 'zzz') : 'zzz';
      const tB = b.tourId ? (tourMap.get(b.tourId)?.name ?? 'zzz') : 'zzz';
      if (tA !== tB) return tA.localeCompare(tB);
      return a.name.localeCompare(b.name);
    });
    return aktive.map((tg) => {
      // ALLE für dieses TG gebuchten Beilagen einrechnen — die Kollegen
      // wiegen den fertigen Stapel inkl. aller Beilagen, also gehört
      // jede gebuchte Beilage ins Soll-Gewicht.
      const tgBeilagen = beilagen.filter((b) => b.teilgebietIds.includes(tg.id));
      const gAnz = berechneGewichtAnzeigenblattKg(tg, ausgabe);
      const gBei = berechneGewichtBeilagenKg(tg, tgBeilagen);
      const sollKg = gAnz + gBei;
      const minKg = sollKg * (1 - tolUnten / 100);
      const maxKg = sollKg * (1 + tolOben / 100);
      return {
        tg,
        tour: tg.tourId ? tourMap.get(tg.tourId) : undefined,
        sollKg,
        minKg,
        maxKg,
        beilagenAnz: tgBeilagen.length,
      };
    });
  }, [teilgebiete, beilagen, ausgabe, tolOben, tolUnten, tourMap]);

  return (
    <>
      <style>{`
        @media screen {
          .kg-print-only { display: none !important; }
          .kg-sheet {
            background: white;
            box-shadow: 0 2px 8px rgba(0,0,0,0.15);
            margin: 0 auto 16px;
            width: 200mm;
            padding: 10mm 12mm;
            font-family: Arial, Helvetica, sans-serif;
            color: #111827;
          }
        }
        @media print {
          .kg-screen-only { display: none !important; }
          html, body { margin: 0 !important; padding: 0 !important; background: white !important; }
          body * { visibility: hidden !important; }
          .kg-print-root, .kg-print-root * { visibility: visible !important; }
          .kg-print-root {
            position: absolute !important;
            left: 0; top: 0;
            width: 100%;
          }
          @page { size: A4 portrait; margin: 10mm 12mm; }
          .kg-sheet { box-shadow: none !important; margin: 0 !important; padding: 0 !important; }
          .kg-row { break-inside: avoid; }
        }
        table.kg-table { border-collapse: collapse; width: 100%; font-size: 12px; }
        table.kg-table th, table.kg-table td {
          border: 1px solid #6b7280;
          padding: 5px 5px;
          vertical-align: middle;
        }
        table.kg-table th {
          background: #f3f4f6;
          font-weight: 600;
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.03em;
        }
        .kg-fill {
          display: block;
          min-height: 22px;
          background: #fff;
        }
        .kg-group-gewicht { background: #fff7ed; }
        .kg-group-stichprobe { background: #eff6ff; }
      `}</style>

      <div className="kg-screen-only fixed inset-0 bg-black/60 z-50 flex flex-col">
        <div className="bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3 flex-wrap shrink-0">
          <button
            onClick={onClose}
            className="text-gray-600 hover:text-gray-900 text-sm px-3 py-1.5 border border-gray-300 rounded-lg"
          >
            ✕ Schließen
          </button>
          <span className="text-gray-700 font-semibold">
            Kontrolle Gewichte — KW {ausgabe.kw}/{ausgabe.jahr}
          </span>
          <span className="text-gray-500 text-sm">
            ({zeilen.length} Teilgebiete · Toleranz −{tolUnten}% / +{tolOben}%)
          </span>
          <div className="ml-auto">
            <button
              onClick={() => window.print()}
              disabled={zeilen.length === 0}
              className="bg-blue-700 hover:bg-blue-800 disabled:bg-gray-300 text-white px-4 py-1.5 rounded-lg text-sm font-medium"
            >
              🖨️ Drucken
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 bg-gray-200">
          <KontrolleSheet zeilen={zeilen} ausgabe={ausgabe} tolOben={tolOben} tolUnten={tolUnten} />
        </div>
      </div>

      <div className="kg-print-only kg-print-root">
        <KontrolleSheet zeilen={zeilen} ausgabe={ausgabe} tolOben={tolOben} tolUnten={tolUnten} />
      </div>
    </>
  );
}

function KontrolleSheet({
  zeilen,
  ausgabe,
  tolOben,
  tolUnten,
}: {
  zeilen: Zeile[];
  ausgabe: Ausgabe;
  tolOben: number;
  tolUnten: number;
}) {
  return (
    <div className="kg-sheet">
      {/* Kopf */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '10px', borderBottom: '2px solid #1e3a5f', paddingBottom: '6px' }}>
        <div>
          <div style={{ fontSize: '16px', fontWeight: 700, color: '#1e3a5f' }}>
            Kontrolle Gewichte — Zusammentragen
          </div>
          <div style={{ fontSize: '11px', color: '#6b7280', marginTop: '2px' }}>
            Schlieper-Druck · Tip aktuell
          </div>
        </div>
        <div style={{ textAlign: 'right', fontSize: '11px', color: '#374151' }}>
          <div><strong>Ausgabe:</strong> KW {ausgabe.kw} / {ausgabe.jahr}</div>
          <div><strong>Seiten:</strong> {ausgabe.seitenzahl}</div>
          <div><strong>Grammatur:</strong> {ausgabe.grammaturGqm} g/m²</div>
          <div style={{ color: '#6b7280', marginTop: '2px' }}>
            Toleranz: −{tolUnten}% / +{tolOben}%
          </div>
        </div>
      </div>

      <table className="kg-table">
        <thead>
          <tr>
            <th rowSpan={2} style={{ width: '18%', textAlign: 'left' }}>Teilgebiet</th>
            <th rowSpan={2} style={{ width: '6%', textAlign: 'center' }}>Stk.</th>
            <th colSpan={6} className="kg-group-gewicht" style={{ textAlign: 'center' }}>
              Gewichtskontrolle (kg)
            </th>
            <th colSpan={3} className="kg-group-stichprobe" style={{ textAlign: 'center' }}>
              Stichprobe (bei Abweichung)
            </th>
          </tr>
          <tr>
            <th className="kg-group-gewicht" style={{ width: '10%', textAlign: 'center' }}>IST</th>
            <th className="kg-group-gewicht" style={{ width: '7%', textAlign: 'center' }}>Min.</th>
            <th className="kg-group-gewicht" style={{ width: '10%', textAlign: 'center' }}>IST</th>
            <th className="kg-group-gewicht" style={{ width: '7%', textAlign: 'center' }}>Max.</th>
            <th className="kg-group-gewicht" style={{ width: '10%', textAlign: 'center' }}>IST</th>
            <th className="kg-group-gewicht" style={{ width: '6%', textAlign: 'center', color: '#6b7280', fontSize: '10px' }}>Soll</th>
            <th className="kg-group-stichprobe" style={{ width: '9%', textAlign: 'center' }}>Seiten<br />Azb.</th>
            <th className="kg-group-stichprobe" style={{ width: '8%', textAlign: 'center' }}>Beil.<br />Soll</th>
            <th className="kg-group-stichprobe" style={{ width: '9%', textAlign: 'center' }}>Beil.<br />IST</th>
          </tr>
        </thead>
        <tbody>
          {zeilen.map((z) => (
            <tr key={z.tg.id} className="kg-row">
              <td>
                <strong>{z.tg.name}</strong>
                {z.tour && (
                  <span
                    style={{
                      marginLeft: '6px',
                      fontSize: '8px',
                      padding: '1px 5px',
                      borderRadius: '8px',
                      color: 'white',
                      background: z.tour.farbe,
                    }}
                  >
                    {z.tour.name}
                  </span>
                )}
              </td>
              <td style={{ textAlign: 'center' }}>{z.tg.stueckzahl.toLocaleString('de-DE')}</td>
              {/* IST (leer) */}
              <td className="kg-group-gewicht"><span className="kg-fill" /></td>
              {/* Min. */}
              <td className="kg-group-gewicht" style={{ textAlign: 'center', fontWeight: 600, color: '#b45309' }}>
                {fmtKg(z.minKg)}
              </td>
              {/* IST (leer, zweite Spalte zum Eintragen) */}
              <td className="kg-group-gewicht"><span className="kg-fill" /></td>
              {/* Max. */}
              <td className="kg-group-gewicht" style={{ textAlign: 'center', fontWeight: 600, color: '#b45309' }}>
                {fmtKg(z.maxKg)}
              </td>
              {/* IST (dritte leere Spalte) */}
              <td className="kg-group-gewicht"><span className="kg-fill" /></td>
              {/* Soll (zur Orientierung) */}
              <td className="kg-group-gewicht" style={{ textAlign: 'center', color: '#6b7280', fontSize: '10px' }}>
                {fmtKg(z.sollKg)}
              </td>
              {/* Seiten Azb. leer */}
              <td className="kg-group-stichprobe"><span className="kg-fill" /></td>
              {/* Beilagen Soll (alle gebuchten Beilagen) */}
              <td className="kg-group-stichprobe" style={{ textAlign: 'center', fontWeight: 600 }}>
                {z.beilagenAnz}
              </td>
              {/* Beilagen IST leer */}
              <td className="kg-group-stichprobe"><span className="kg-fill" /></td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ marginTop: '10px', fontSize: '9px', color: '#6b7280', lineHeight: 1.4 }}>
        <strong>Hinweis:</strong> Es wird der fertige <strong>Stapel</strong> gewogen, nicht
        Einzel-Exemplare. Liegt das IST-Gewicht außerhalb der Grenzwerte (Min./Max.),
        wird ein Stapel stichprobenartig geprüft: Ist das Anzeigenblatt korrekt eingelegt
        (Seitenzahl) und stimmt die Anzahl Beilagen mit dem Soll überein?<br />
        Soll-Gewicht = Stückzahl × (Anzeigenblatt-Gewicht + Gewicht aller für das Teilgebiet gebuchten Beilagen).
      </div>

      <div style={{
        marginTop: '12px', paddingTop: '6px',
        borderTop: '1px dashed #d1d5db',
        display: 'flex', justifyContent: 'space-between',
        fontSize: '9px', color: '#9ca3af',
      }}>
        <span>Kontrolle durch: _____________________________</span>
        <span>Datum: ______________</span>
        <span>Druckdatum: {new Date().toLocaleDateString('de-DE')}</span>
      </div>
    </div>
  );
}
