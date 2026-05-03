// Arbeitsvorbereitung Zusammentragen — "Zettelchen"
// A4 Querformat, je Teilgebiet eine Zeile, Zeile horizontal in 3 gleiche Drittel geteilt.
// Drittel 1 (links):  Info-Zettelchen (für Ablage / Archiv)
// Drittel 2 (mitte):  großes "Z" — für Zusammentragen-Abrechnung (abgerissen)
// Drittel 3 (rechts): großes "V" + "Vorarbeit" — für Vorarbeits-Zettelchen
// Tour-Farbe als Hintergrund-Streifen zur schnellen Erkennung beim Verpacken.
//
// Gedruckt wird zwischen den Teilgebieten horizontal getrennt (Trennlinie).

import { useMemo } from 'react';
import type { Ausgabe, Beilage, Teilgebiet, Tour } from '../types';

interface Props {
  ausgabe: Ausgabe;
  teilgebiete: Teilgebiet[];
  beilagen: Beilage[];
  touren: Tour[];
  onClose: () => void;
}

export default function ZettelchenDruck({
  ausgabe,
  teilgebiete,
  beilagen,
  touren,
  onClose,
}: Props) {
  const tourMap = useMemo(() => new Map(touren.map((t) => [t.id, t])), [touren]);

  const zeilen = useMemo(() => {
    const aktive = teilgebiete.filter((tg) => tg.isActive);
    // Sortierung: erst nach Tour, dann nach Name
    aktive.sort((a, b) => {
      const tA = a.tourId ? (tourMap.get(a.tourId)?.name ?? 'zzz') : 'zzz';
      const tB = b.tourId ? (tourMap.get(b.tourId)?.name ?? 'zzz') : 'zzz';
      if (tA !== tB) return tA.localeCompare(tB);
      return a.name.localeCompare(b.name);
    });
    return aktive.map((tg) => {
      const bTg = beilagen.filter((b) => b.teilgebietIds.includes(tg.id));
      const ext = bTg.filter((b) => b.kennzeichen === 'ext');
      const int = bTg.filter((b) => b.kennzeichen === 'int');
      const tour = tg.tourId ? tourMap.get(tg.tourId) : undefined;
      return { tg, ext, int, tour };
    });
  }, [teilgebiete, beilagen, tourMap]);

  return (
    <>
      <style>{`
        @media screen {
          .zettel-print-only { display: none !important; }
          .zettel-sheet {
            background: white;
            box-shadow: 0 2px 8px rgba(0,0,0,0.15);
            margin: 0 auto 16px;
            width: 285mm;
            min-height: 198mm;
            padding: 2mm;
          }
        }
        @media print {
          .zettel-screen-only { display: none !important; }
          html, body { margin: 0 !important; padding: 0 !important; background: white !important; }
          body * { visibility: hidden !important; }
          .zettel-print-root, .zettel-print-root * { visibility: visible !important; }
          .zettel-print-root {
            position: absolute !important;
            left: 0; top: 0;
            width: 100%;
          }
          @page { size: A4 landscape; margin: 6mm; }
          .zettel-row { break-inside: avoid; }
          .zettel-sheet { box-shadow: none !important; margin: 0 !important; padding: 0 !important; }
        }
        .zettel-row {
          display: grid;
          grid-template-columns: 1fr 1fr 1fr;
          border: 1.5px dashed #374151;
          margin-bottom: 2mm;
          min-height: 34mm;
        }
        .zettel-third {
          border-right: 1.5px dashed #6b7280;
          padding: 3mm 4mm;
          display: flex;
          flex-direction: column;
          position: relative;
          overflow: hidden;
        }
        .zettel-third:last-child { border-right: none; }
        .zettel-tour-stripe {
          position: absolute;
          top: 0; left: 0; right: 0;
          height: 5mm;
        }
        .zettel-content { margin-top: 6mm; flex: 1; display: flex; flex-direction: column; }
        .zettel-big-letter {
          font-size: 80px;
          font-weight: 900;
          line-height: 1;
          color: #111827;
          font-family: Arial, Helvetica, sans-serif;
        }
        .zettel-kw {
          font-size: 11px;
          color: #374151;
          font-weight: 600;
        }
        .zettel-tg {
          font-size: 22px;
          font-weight: 800;
          color: #111827;
          line-height: 1.1;
          margin-top: 1mm;
        }
        .zettel-stk {
          font-size: 14px;
          color: #111827;
          font-weight: 700;
          margin-top: 1mm;
        }
        .zettel-beil-box {
          margin-top: 2mm;
          font-size: 9px;
          color: #1f2937;
          line-height: 1.3;
        }
        .zettel-beil-title {
          font-size: 9px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          color: #6b7280;
          margin-bottom: 0.5mm;
        }
        .zettel-beil-list {
          margin: 0;
          padding-left: 3mm;
        }
        .zettel-beil-list li { margin-bottom: 0.3mm; }
      `}</style>

      {/* Steuerleiste */}
      <div className="zettel-screen-only fixed inset-0 bg-black/60 z-50 flex flex-col">
        <div className="bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3 flex-wrap shrink-0">
          <button
            onClick={onClose}
            className="text-gray-600 hover:text-gray-900 text-sm px-3 py-1.5 border border-gray-300 rounded-lg"
          >
            ✕ Schließen
          </button>
          <span className="text-gray-700 font-semibold">
            Arbeitsvorbereitung Zusammentragen — KW {ausgabe.kw}/{ausgabe.jahr}
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
              🖨️ Drucken ({zeilen.length})
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 bg-gray-200">
          <ZettelchenInhalt zeilen={zeilen} ausgabe={ausgabe} />
        </div>
      </div>

      {/* Druck-Inhalt (nur beim Drucken sichtbar) */}
      <div className="zettel-print-only zettel-print-root">
        <ZettelchenInhalt zeilen={zeilen} ausgabe={ausgabe} printOnly />
      </div>
    </>
  );
}

// ---- Inhalt ----

interface Zeile {
  tg: Teilgebiet;
  ext: Beilage[];
  int: Beilage[];
  tour: Tour | undefined;
}

function ZettelchenInhalt({
  zeilen,
  ausgabe,
  printOnly = false,
}: {
  zeilen: Zeile[];
  ausgabe: Ausgabe;
  printOnly?: boolean;
}) {
  // Ca. 5–6 Zeilen je A4-Querseite (je Zeile ca. 34mm Höhe).
  const proSeite = 5;
  const seiten: Zeile[][] = [];
  for (let i = 0; i < zeilen.length; i += proSeite) {
    seiten.push(zeilen.slice(i, i + proSeite));
  }

  return (
    <>
      {seiten.map((seite, idx) => (
        <div
          key={idx}
          className="zettel-sheet"
          style={printOnly ? { breakAfter: idx < seiten.length - 1 ? 'page' : 'auto' } : {}}
        >
          {seite.map((z) => (
            <ZettelRow key={z.tg.id} zeile={z} ausgabe={ausgabe} />
          ))}
        </div>
      ))}
    </>
  );
}

function ZettelRow({ zeile, ausgabe }: { zeile: Zeile; ausgabe: Ausgabe }) {
  const { tg, ext, int, tour } = zeile;
  const stripeFarbe = tour?.farbe ?? '#e5e7eb';

  return (
    <div className="zettel-row">
      {/* Drittel 1: Info-Zettelchen */}
      <div className="zettel-third">
        <div className="zettel-tour-stripe" style={{ background: stripeFarbe }} />
        <div className="zettel-content">
          <ZettelHeader ausgabe={ausgabe} tg={tg} tour={tour} />
          <BeilagenAbschnitte ext={ext} int={int} />
        </div>
      </div>

      {/* Drittel 2: großes Z */}
      <div className="zettel-third">
        <div className="zettel-tour-stripe" style={{ background: stripeFarbe }} />
        <div className="zettel-content" style={{ flexDirection: 'row' }}>
          <div style={{ flex: '0 0 auto', paddingRight: '3mm' }}>
            <div className="zettel-big-letter">Z</div>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <ZettelHeader ausgabe={ausgabe} tg={tg} tour={tour} compact />
            <BeilagenAbschnitte ext={ext} int={int} compact />
          </div>
        </div>
      </div>

      {/* Drittel 3: großes V + Vorarbeit */}
      <div className="zettel-third">
        <div className="zettel-tour-stripe" style={{ background: stripeFarbe }} />
        <div className="zettel-content" style={{ flexDirection: 'row' }}>
          <div style={{ flex: '0 0 auto', paddingRight: '3mm' }}>
            <div className="zettel-big-letter" style={{ color: '#b91c1c' }}>V</div>
            <div style={{
              fontSize: '10px',
              fontWeight: 700,
              color: '#b91c1c',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              marginTop: '1mm',
            }}>
              Vorarbeit
            </div>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <ZettelHeader ausgabe={ausgabe} tg={tg} tour={tour} compact />
            <BeilagenAbschnitte ext={ext} int={int} compact />
          </div>
        </div>
      </div>
    </div>
  );
}

function ZettelHeader({
  ausgabe,
  tg,
  tour,
  compact = false,
}: {
  ausgabe: Ausgabe;
  tg: Teilgebiet;
  tour: Tour | undefined;
  compact?: boolean;
}) {
  return (
    <>
      <div className="zettel-kw">
        KW {ausgabe.kw}/{ausgabe.jahr}
        {tour && (
          <span style={{ marginLeft: '3mm', color: tour.farbe, fontWeight: 700 }}>
            ● {tour.name}
          </span>
        )}
      </div>
      <div
        className="zettel-tg"
        style={compact ? { fontSize: '16px' } : undefined}
      >
        {tg.name}
      </div>
      <div className="zettel-stk">
        {tg.stueckzahl.toLocaleString('de-DE')} Stück
      </div>
    </>
  );
}

function BeilagenAbschnitte({
  ext,
  int,
  compact = false,
}: {
  ext: Beilage[];
  int: Beilage[];
  compact?: boolean;
}) {
  const style = compact ? { fontSize: '8px' } : undefined;
  return (
    <div style={{ display: 'flex', gap: '3mm', marginTop: '1.5mm', flex: 1 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="zettel-beil-title" style={{ color: '#b91c1c' }}>
          B. nicht einlegen ({ext.length})
        </div>
        {ext.length === 0 ? (
          <div className="zettel-beil-box" style={{ ...style, color: '#9ca3af' }}>—</div>
        ) : (
          <ul className="zettel-beil-list zettel-beil-box" style={style}>
            {ext.map((b) => (
              <li key={b.id}>{b.arbeitstitel || b.kundenname}</li>
            ))}
          </ul>
        )}
      </div>
      <div style={{ flex: 1, minWidth: 0, borderLeft: '1px solid #d1d5db', paddingLeft: '3mm' }}>
        <div className="zettel-beil-title" style={{ color: '#1d4ed8' }}>
          B. einlegen ({int.length})
        </div>
        {int.length === 0 ? (
          <div className="zettel-beil-box" style={{ ...style, color: '#9ca3af' }}>—</div>
        ) : (
          <ul className="zettel-beil-list zettel-beil-box" style={style}>
            {int.map((b) => (
              <li key={b.id}>{b.arbeitstitel || b.kundenname}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
