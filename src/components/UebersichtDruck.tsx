// Übersicht — A4-Druckliste für den Werksleiter
// Pro Teilgebiet einer Ausgabe: Beilagen (int/ext), Austräger
// (Standard/Springer mit Adresse + Telefon + Abholer-Hinweis), Gesamt-
// gewicht. Checkboxen zum manuellen Abhaken (Zusammentragen + Auslieferung).

import { useMemo } from 'react';
import type {
  Ausgabe,
  Beilage,
  Einsatz,
  Mitarbeiter,
  Parameter,
  Teilgebiet,
  Tour,
} from '../types';
import {
  berechneGewichtAnzeigenblattKg,
  berechneGewichtBeilagenKg,
} from '../lib/berechnung';

interface Props {
  ausgabe: Ausgabe;
  teilgebiete: Teilgebiet[];
  beilagen: Beilage[];
  einsaetze: Einsatz[];
  mitarbeiter: Mitarbeiter[];
  touren: Tour[];
  parameter: Parameter;
  onClose: () => void;
}

interface Zeile {
  tg: Teilgebiet;
  tour: Tour | undefined;
  beilagenIntern: Beilage[];
  beilagenExtern: Beilage[];
  empfaenger: Mitarbeiter | null;
  istSpringer: boolean;
  gewichtKg: number;
}

const FORMAT_LABEL: Record<string, string> = {
  a4: 'A4',
  a5: 'A5',
  a6: 'A6',
  prospekt8: 'Prosp. 8-S.',
  zettel: 'Zettel',
  flyer: 'Flyer',
  individuell: 'individ.',
};

function formatLabel(f: string | undefined): string {
  if (!f) return '';
  return FORMAT_LABEL[f] ?? f;
}

export default function UebersichtDruck({
  ausgabe,
  teilgebiete,
  beilagen,
  einsaetze,
  mitarbeiter,
  touren,
  parameter,
  onClose,
}: Props) {
  const tourMap = useMemo(() => new Map(touren.map((t) => [t.id, t])), [touren]);
  const maMap = useMemo(() => new Map(mitarbeiter.map((m) => [m.id, m])), [mitarbeiter]);
  const einsatzByTg = useMemo(() => {
    const m = new Map<string, Einsatz>();
    for (const e of einsaetze) m.set(e.teilgebietId, e);
    return m;
  }, [einsaetze]);

  const zeilen: Zeile[] = useMemo(() => {
    const aktive = teilgebiete.filter((tg) => tg.isActive && !tg.istAuslagestelle);
    aktive.sort((a, b) => {
      // Tour zuerst, dann Name (natural)
      const tA = a.tourId ? (tourMap.get(a.tourId)?.name ?? 'zzz') : 'zzz';
      const tB = b.tourId ? (tourMap.get(b.tourId)?.name ?? 'zzz') : 'zzz';
      if (tA !== tB) return tA.localeCompare(tB, 'de');
      return a.name.localeCompare(b.name, 'de', { numeric: true });
    });
    return aktive.map((tg) => {
      const intB = beilagen.filter((b) => b.teilgebietIds.includes(tg.id) && b.kennzeichen === 'int');
      const extB = beilagen.filter((b) => b.teilgebietIds.includes(tg.id) && b.kennzeichen === 'ext');
      const e = einsatzByTg.get(tg.id);
      // Effektiver Austräger: Springer hat Vorrang, sonst Standardausträger.
      let empfId: string | null = null;
      let istSpringer = false;
      if (e?.typ === 'springer' && e.mitarbeiterId) {
        empfId = e.mitarbeiterId;
        istSpringer = true;
      } else if (e?.typ === 'ausfall' || e?.typ === 'ungeklärt') {
        empfId = null;
      } else {
        empfId = tg.standardAustraegerId;
      }
      const empf = empfId ? (maMap.get(empfId) ?? null) : null;
      const gAnz = berechneGewichtAnzeigenblattKg(tg, ausgabe);
      const gBei = berechneGewichtBeilagenKg(tg, [...intB, ...extB]);
      return {
        tg,
        tour: tg.tourId ? tourMap.get(tg.tourId) : undefined,
        beilagenIntern: intB,
        beilagenExtern: extB,
        empfaenger: empf,
        istSpringer,
        gewichtKg: gAnz + gBei,
      };
    });
  }, [teilgebiete, beilagen, ausgabe, einsatzByTg, tourMap, maMap]);

  return (
    <>
      <style>{`
        @media screen {
          .ub-print-only { display: none !important; }
          .ub-sheet {
            background: white;
            box-shadow: 0 2px 8px rgba(0,0,0,0.15);
            margin: 0 auto 16px;
            width: 210mm;
            min-height: 297mm;
            padding: 10mm 12mm;
            font-family: Arial, Helvetica, sans-serif;
            color: #111827;
            font-size: 11px;
          }
        }
        @media print {
          .ub-screen-only { display: none !important; }
          html, body { margin: 0 !important; padding: 0 !important; background: white !important; }
          body * { visibility: hidden !important; }
          .ub-print-root, .ub-print-root * { visibility: visible !important; }
          .ub-print-root {
            position: absolute !important;
            left: 0; top: 0;
            width: 100%;
          }
          @page { size: A4 portrait; margin: 10mm 12mm; }
          .ub-sheet { box-shadow: none !important; margin: 0 !important; padding: 0 !important; width: auto !important; min-height: 0 !important; }
          .ub-row { break-inside: avoid; }
        }
        table.ub-table { border-collapse: collapse; width: 100%; font-size: 10.5px; }
        table.ub-table th, table.ub-table td {
          border: 1px solid #6b7280;
          padding: 4px 5px;
          vertical-align: top;
        }
        table.ub-table th {
          background: #f3f4f6;
          font-weight: 600;
          font-size: 10px;
          text-transform: uppercase;
          letter-spacing: 0.03em;
          text-align: left;
        }
        .ub-checkbox {
          display: inline-block;
          width: 14px;
          height: 14px;
          border: 1.5px solid #1e3a5f;
          border-radius: 2px;
          vertical-align: middle;
          background: white;
        }
        .ub-abholer-banner {
          display: inline-block;
          margin-left: 6px;
          padding: 1px 6px;
          background: #c2410c;
          color: #fff;
          font-size: 9px;
          font-weight: 700;
          letter-spacing: 0.04em;
          border-radius: 3px;
          vertical-align: middle;
        }
        .ub-springer-banner {
          display: inline-block;
          margin-left: 6px;
          padding: 1px 6px;
          background: #b91c1c;
          color: #fff;
          font-size: 9px;
          font-weight: 700;
          letter-spacing: 0.04em;
          border-radius: 3px;
          vertical-align: middle;
        }
      `}</style>

      <div className="ub-screen-only fixed inset-0 bg-black/60 z-50 flex flex-col">
        <div className="bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3 flex-wrap shrink-0">
          <button
            onClick={onClose}
            className="text-gray-600 hover:text-gray-900 text-sm px-3 py-1.5 border border-gray-300 rounded-lg"
          >
            ✕ Schließen
          </button>
          <span className="text-gray-700 font-semibold">
            Übersicht — KW {ausgabe.kw}/{ausgabe.jahr}
          </span>
          <span className="text-gray-500 text-sm">
            ({zeilen.length} Teilgebiete)
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
          <UebersichtSheet zeilen={zeilen} ausgabe={ausgabe} parameter={parameter} />
        </div>
      </div>

      <div className="ub-print-only ub-print-root">
        <UebersichtSheet zeilen={zeilen} ausgabe={ausgabe} parameter={parameter} />
      </div>
    </>
  );
}

function UebersichtSheet({
  zeilen,
  ausgabe,
}: {
  zeilen: Zeile[];
  ausgabe: Ausgabe;
  parameter: Parameter;
}) {
  return (
    <div className="ub-sheet">
      {/* Kopf */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px', borderBottom: '2px solid #1e3a5f', paddingBottom: '5px' }}>
        <div>
          <div style={{ fontSize: '15px', fontWeight: 700, color: '#1e3a5f' }}>
            Übersicht Zusammentragen &amp; Auslieferung
          </div>
          <div style={{ fontSize: '10px', color: '#6b7280', marginTop: '1px' }}>
            Schlieper-Druck · Werksleiter-Kontrolle
          </div>
        </div>
        <div style={{ textAlign: 'right', fontSize: '10px', color: '#374151' }}>
          <div><strong>Ausgabe:</strong> KW {ausgabe.kw} / {ausgabe.jahr}</div>
          <div><strong>Seiten:</strong> {ausgabe.seitenzahl > 0 ? ausgabe.seitenzahl : '— fehlt —'}</div>
          <div><strong>Stapel:</strong> {ausgabe.stapelAnzahl > 0 ? ausgabe.stapelAnzahl : '— fehlt —'}</div>
        </div>
      </div>

      <table className="ub-table">
        <thead>
          <tr>
            <th style={{ width: '4%', textAlign: 'center' }}>ZT</th>
            <th style={{ width: '4%', textAlign: 'center' }}>AL</th>
            <th style={{ width: '13%' }}>Teilgebiet</th>
            <th style={{ width: '6%', textAlign: 'right' }}>Stk.</th>
            <th style={{ width: '7%', textAlign: 'right' }}>Gewicht<br />(kg)</th>
            <th style={{ width: '36%' }}>Beilagen (int / ext)</th>
            <th style={{ width: '30%' }}>Austräger</th>
          </tr>
        </thead>
        <tbody>
          {zeilen.length === 0 && (
            <tr>
              <td colSpan={7} style={{ textAlign: 'center', color: '#9ca3af', padding: '12px' }}>
                Keine aktiven Teilgebiete für diese Ausgabe.
              </td>
            </tr>
          )}
          {zeilen.map((z) => {
            const empf = z.empfaenger;
            const istAbholer = empf?.istAbholer === true;
            return (
              <tr key={z.tg.id} className="ub-row">
                <td style={{ textAlign: 'center' }}>
                  <span className="ub-checkbox" title="Zusammengetragen" />
                </td>
                <td style={{ textAlign: 'center' }}>
                  <span className="ub-checkbox" title="Ausgeliefert" />
                </td>
                <td>
                  <strong>{z.tg.name}</strong>
                  {z.tg.plz && <span style={{ color: '#6b7280', fontWeight: 400 }}> · {z.tg.plz}</span>}
                  {z.tour && (
                    <div style={{ fontSize: '9px', color: '#6b7280', marginTop: '1px' }}>
                      Tour:&nbsp;
                      <span style={{
                        display: 'inline-block',
                        width: '7px', height: '7px',
                        borderRadius: '50%',
                        background: z.tour.farbe,
                        verticalAlign: 'middle',
                      }} />
                      &nbsp;{z.tour.name}
                    </div>
                  )}
                </td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                  {z.tg.stueckzahl.toLocaleString('de-DE')}
                </td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                  {z.gewichtKg.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
                </td>
                <td>
                  {z.beilagenIntern.length === 0 && z.beilagenExtern.length === 0 ? (
                    <span style={{ color: '#9ca3af', fontStyle: 'italic' }}>—</span>
                  ) : (
                    <>
                      <div style={{ fontWeight: 600, fontSize: '10px', color: '#374151' }}>
                        {z.beilagenIntern.length} intern · {z.beilagenExtern.length} extern
                      </div>
                      {z.beilagenIntern.length > 0 && (
                        <div style={{ marginTop: '2px' }}>
                          {z.beilagenIntern.map((b, i) => (
                            <div key={b.id} style={{ fontSize: '10px' }}>
                              <span style={{ color: '#1d4ed8' }}>•</span>{' '}
                              {b.arbeitstitel || b.kundenname}
                              <span style={{ color: '#6b7280' }}> · {formatLabel(b.format)}</span>
                              {i === z.beilagenIntern.length - 1 ? '' : ''}
                            </div>
                          ))}
                        </div>
                      )}
                      {z.beilagenExtern.length > 0 && (
                        <div style={{ marginTop: z.beilagenIntern.length > 0 ? '3px' : '2px', borderTop: z.beilagenIntern.length > 0 ? '1px dashed #d1d5db' : 'none', paddingTop: z.beilagenIntern.length > 0 ? '2px' : '0' }}>
                          {z.beilagenExtern.map((b) => (
                            <div key={b.id} style={{ fontSize: '10px' }}>
                              <span style={{ color: '#7c3aed' }}>◇</span>{' '}
                              {b.arbeitstitel || b.kundenname}
                              <span style={{ color: '#6b7280' }}> · {formatLabel(b.format)} · extern</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </td>
                <td>
                  {empf ? (
                    <>
                      <div style={{ fontWeight: 600 }}>
                        {empf.name}
                        {z.istSpringer && <span className="ub-springer-banner">🔄 SPRINGER</span>}
                        {istAbholer && <span className="ub-abholer-banner">📦 ABHOLER</span>}
                      </div>
                      {empf.adresse?.strasse && (
                        <div style={{ fontSize: '10px', color: '#374151' }}>{empf.adresse.strasse}</div>
                      )}
                      {(empf.adresse?.plz || empf.adresse?.ort) && (
                        <div style={{ fontSize: '10px', color: '#374151' }}>
                          {empf.adresse.plz} {empf.adresse.ort}
                        </div>
                      )}
                      {(empf.telefon || empf.mobilnummer) && (
                        <div style={{ fontSize: '10px', color: '#1f2937', marginTop: '1px' }}>
                          📞 {empf.telefon || empf.mobilnummer}
                        </div>
                      )}
                    </>
                  ) : (
                    <span style={{ color: '#b91c1c', fontWeight: 600, fontStyle: 'italic' }}>
                      ⚠ Kein Austräger
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* Legende */}
      <div style={{ marginTop: '6px', fontSize: '9px', color: '#6b7280' }}>
        ZT = Zusammengetragen · AL = Ausgeliefert · <span style={{ color: '#1d4ed8' }}>•</span> intern · <span style={{ color: '#7c3aed' }}>◇</span> extern · 📦 Abholer = Stapel bleibt im Werk
      </div>
      <div style={{ marginTop: '14px', fontSize: '10px', color: '#374151', display: 'flex', gap: '24px' }}>
        <div>Unterschrift Werksleiter: <span style={{ display: 'inline-block', borderBottom: '1px solid #6b7280', minWidth: '120px' }}>&nbsp;</span></div>
        <div>Datum: <span style={{ display: 'inline-block', borderBottom: '1px solid #6b7280', minWidth: '80px' }}>&nbsp;</span></div>
      </div>
    </div>
  );
}
