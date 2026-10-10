// Urlaubs-Vergleich — A4-Querformat zum Ausdrucken.
//
// Druckt die Auswahl aus dem Bereich „Urlaub" (Mitarbeiter-Ansicht): den
// eigenen Urlaub (hervorgehoben) und die Urlaube der ausgewählten Kollegen
// im gewählten Zeitraum — als Wochenraster mit Werktagen und als Liste.
// Kommentare/Links der Kollegen werden bewusst nicht gedruckt.

import type { Mitarbeiter, UrlaubsEintrag } from '../types';
import { MONATSNAMEN } from '../lib/kalender';
import { feiertageInKw } from '../lib/ferien';
import {
  fmtZeitraum,
  gruppiereUrlaube,
  monatsSpannen,
  urlaubsTageJeMa,
  werktageDerKw,
  type UrlaubTagStatus,
} from '../lib/urlaub';

interface Props {
  jahr: number;
  kws: number[];
  zeitraumText: string;
  ich: Mitarbeiter;
  kollegen: Mitarbeiter[];
  eintraege: UrlaubsEintrag[];
  onClose: () => void;
}

const FARBE = {
  eigen: { genehmigt: '#2563eb', beantragt: 'repeating-linear-gradient(135deg,#93c5fd 0 2px,#ffffff 2px 4px)' },
  kollege: { genehmigt: '#f59e0b', beantragt: 'repeating-linear-gradient(135deg,#fcd34d 0 2px,#ffffff 2px 4px)' },
  feiertag: '#9ca3af',
  leer: '#f3f4f6',
};

export default function UrlaubVergleichDruck(props: Props) {
  const { onClose, ich, zeitraumText } = props;
  return (
    <>
      <style>{`
        @media screen {
          .uv-print-only { display: none !important; }
          .uv-sheet {
            background: white;
            box-shadow: 0 2px 8px rgba(0,0,0,0.15);
            margin: 0 auto 16px;
            width: 297mm;
            padding: 10mm 12mm;
          }
        }
        @media print {
          .uv-screen-only { display: none !important; }
          html, body { margin: 0 !important; padding: 0 !important; background: white !important; }
          body * { visibility: hidden !important; }
          .uv-print-root, .uv-print-root * { visibility: visible !important; }
          .uv-print-root { position: absolute !important; left: 0; top: 0; width: 100%; }
          @page { size: A4 landscape; margin: 10mm 12mm; }
          .uv-sheet { box-shadow: none !important; margin: 0 !important; padding: 0 !important; width: auto !important; }
          .uv-block { break-inside: avoid; }
        }
        .uv-sheet { font-family: Arial, Helvetica, sans-serif; color: #111827; font-size: 10px;
          -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        table.uv-raster { border-collapse: collapse; width: 100%; table-layout: fixed; }
        table.uv-raster th, table.uv-raster td { padding: 1px 1px; }
        table.uv-raster th { font-weight: 600; color: #374151; }
        table.uv-liste { border-collapse: collapse; width: 100%; font-size: 10px; }
        table.uv-liste th, table.uv-liste td { border: 1px solid #9ca3af; padding: 2px 5px; text-align: left; }
        table.uv-liste th { background: #f3f4f6; }
      `}</style>

      <div className="uv-screen-only fixed inset-0 bg-black/60 z-50 flex flex-col">
        <div className="bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3 flex-wrap shrink-0">
          <button
            onClick={onClose}
            className="text-gray-600 hover:text-gray-900 text-sm px-3 py-1.5 border border-gray-300 rounded-lg"
          >
            ✕ Schließen
          </button>
          <span className="text-gray-700 font-semibold">Urlaubsübersicht — {ich.name}</span>
          <span className="text-gray-500 text-sm">({zeitraumText})</span>
          <div className="ml-auto">
            <button
              onClick={() => window.print()}
              className="bg-blue-700 hover:bg-blue-800 text-white px-4 py-1.5 rounded-lg text-sm font-medium"
            >
              🖨️ Drucken
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-auto p-4 bg-gray-200">
          <Blatt {...props} />
        </div>
      </div>

      <div className="uv-print-only uv-print-root">
        <Blatt {...props} />
      </div>
    </>
  );
}

function Blatt({ jahr, kws, zeitraumText, ich, kollegen, eintraege }: Props) {
  const tageJeMa = urlaubsTageJeMa(eintraege);
  const eigene = tageJeMa.get(ich.id) ?? new Map<string, UrlaubTagStatus>();
  const spannen = monatsSpannen(jahr, kws);
  const zeitraumTage = new Set(kws.flatMap((kw) => werktageDerKw(jahr, kw)));
  const personen = [ich, ...kollegen];
  const idSet = new Set(personen.map((p) => p.id));
  const gruppen = gruppiereUrlaube(eintraege.filter((e) => idSet.has(e.mitarbeiterId)))
    .filter((g) => g.werktage.some((d) => zeitraumTage.has(d)));

  function zelle(maId: string, kw: number, art: 'eigen' | 'kollege') {
    const tage = tageJeMa.get(maId);
    const feiertage = feiertageInKw(jahr, kw);
    return (
      <div style={{ display: 'flex', gap: '1px', height: '9px' }}>
        {werktageDerKw(jahr, kw).map((d) => {
          const s = tage?.get(d);
          const feiertag = feiertage.some((f) => f.datum === d);
          return (
            <div
              key={d}
              style={{
                flex: 1,
                background: s ? FARBE[art][s] : feiertag ? FARBE.feiertag : FARBE.leer,
                boxShadow: art === 'kollege' && s && eigene.has(d) ? 'inset 0 0 0 1px #dc2626' : undefined,
              }}
            />
          );
        })}
      </div>
    );
  }

  return (
    <div className="uv-sheet">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '2px solid #1e3a5f', paddingBottom: '5px', marginBottom: '8px' }}>
        <div>
          <div style={{ fontSize: '15px', fontWeight: 700, color: '#1e3a5f' }}>Urlaubsübersicht — {ich.name}</div>
          <div style={{ fontSize: '10px', color: '#6b7280' }}>
            Eigener Urlaub (blau) im Vergleich zu {kollegen.length} ausgewählten Kollegen (orange)
          </div>
        </div>
        <div style={{ textAlign: 'right', fontSize: '10px', color: '#374151' }}>
          <div><strong>Zeitraum:</strong> {zeitraumText}</div>
          <div>Erstellt: {new Date().toLocaleDateString('de-DE')}</div>
        </div>
      </div>

      <table className="uv-raster uv-block">
        <colgroup>
          <col style={{ width: '30mm' }} />
          {kws.map((kw) => <col key={kw} />)}
        </colgroup>
        <thead>
          <tr>
            <th />
            {spannen.map((s, i) => (
              <th key={`${s.monat}-${i}`} colSpan={s.anzahl} style={{ textAlign: 'left', borderLeft: '1px solid #d1d5db', fontSize: '9px' }}>
                {MONATSNAMEN[s.monat - 1]}
              </th>
            ))}
          </tr>
          <tr style={{ borderBottom: '1px solid #9ca3af' }}>
            <th style={{ textAlign: 'left', fontSize: '8px', color: '#6b7280' }}>KW</th>
            {kws.map((kw) => (
              <th key={kw} style={{ fontSize: '7px', fontWeight: 400, color: '#6b7280' }}>{kw}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr style={{ background: '#eff6ff', borderTop: '1.5px solid #2563eb', borderBottom: '1.5px solid #2563eb' }}>
            <td style={{ fontWeight: 700, color: '#1e3a8a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>★ {ich.name}</td>
            {kws.map((kw) => <td key={kw}>{zelle(ich.id, kw, 'eigen')}</td>)}
          </tr>
          {kollegen.map((k) => (
            <tr key={k.id} style={{ borderBottom: '1px solid #e5e7eb' }}>
              <td style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{k.name}</td>
              {kws.map((kw) => <td key={kw}>{zelle(k.id, kw, 'kollege')}</td>)}
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ marginTop: '4px', fontSize: '8.5px', color: '#4b5563', display: 'flex', flexWrap: 'wrap', gap: '12px' }}>
        <Leg farbe={FARBE.eigen.genehmigt}>eigener Urlaub</Leg>
        <Leg farbe={FARBE.eigen.beantragt}>eigener Urlaub (beantragt)</Leg>
        <Leg farbe={FARBE.kollege.genehmigt}>Kollegen</Leg>
        <Leg farbe={FARBE.kollege.beantragt}>Kollegen (beantragt)</Leg>
        <Leg farbe={FARBE.feiertag}>Feiertag</Leg>
        <span>Je KW fünf Felder = Mo–Fr · rot umrandet = Überschneidung mit eigenem Urlaub</span>
      </div>

      <div style={{ marginTop: '10px', fontWeight: 700, fontSize: '11px', color: '#1e3a5f' }}>Urlaube im Zeitraum</div>
      <table className="uv-liste" style={{ marginTop: '3px' }}>
        <thead>
          <tr>
            <th style={{ width: '35%' }}>Mitarbeiter</th>
            <th>Zeitraum</th>
            <th style={{ width: '12%' }}>Werktage</th>
            <th style={{ width: '14%' }}>Status</th>
          </tr>
        </thead>
        <tbody>
          {personen.map((p) => {
            const eigeneGruppen = gruppen.filter((g) => g.mitarbeiterId === p.id);
            const istIch = p.id === ich.id;
            if (eigeneGruppen.length === 0) {
              return (
                <tr key={p.id} style={istIch ? { background: '#eff6ff', fontWeight: 700 } : undefined}>
                  <td>{p.name}</td>
                  <td colSpan={3} style={{ color: '#9ca3af', fontStyle: 'italic' }}>kein Urlaub im Zeitraum</td>
                </tr>
              );
            }
            return eigeneGruppen.map((g, i) => (
              <tr key={g.key} style={istIch ? { background: '#eff6ff', fontWeight: 700 } : undefined}>
                <td>{i === 0 ? p.name : ''}</td>
                <td>{fmtZeitraum(g.datumVon, g.datumBis)}</td>
                <td>{g.werktage.length}</td>
                <td>{g.alleFreigegeben ? 'genehmigt' : 'beantragt'}</td>
              </tr>
            ));
          })}
        </tbody>
      </table>
    </div>
  );
}

function Leg({ farbe, children }: { farbe: string; children: React.ReactNode }) {
  return (
    <span>
      <span style={{ display: 'inline-block', width: '9px', height: '9px', background: farbe, marginRight: '3px', verticalAlign: 'middle' }} />
      {children}
    </span>
  );
}
