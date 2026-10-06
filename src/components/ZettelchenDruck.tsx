// Arbeitsvorbereitung Zusammentragen — "Zettelchen"
// A4 Querformat, je Teilgebiet eine Zeile, Zeile horizontal in 3 gleiche Drittel geteilt.
// Drittel 1 (links):  Info-Zettelchen (für Ablage / Archiv)
// Drittel 2 (mitte):  großes "Z" — für Zusammentragen-Abrechnung (abgerissen)
// Drittel 3 (rechts): großes "V" + "Vorarbeit" — für Vorarbeits-Zettelchen
// Tour-Farbe als Hintergrund-Streifen zur schnellen Erkennung beim Verpacken.
//
// Gedruckt wird zwischen den Teilgebieten horizontal getrennt (Trennlinie).

import { useEffect, useMemo, useRef, useState } from 'react';
import { istTgAktivFuer } from '../lib/saison';
import type { Ausgabe, Beilage, Teilgebiet, Tour } from '../types';

// Seitenraster A4 quer mit 6 mm Rand: 196 mm nutzbare Höhe (mit Reserve),
// 2 mm Abstand zwischen den Zeilen, Mindesthöhe je Zeile 47 mm.
const SEITE_MM = 196;
const ABSTAND_MM = 2;
const MIN_ZEILE_MM = 47;
const PX_PRO_MM = 96 / 25.4;

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
    // Saisonteilgebiete in ihrer Pause werden nicht zusammengetragen.
    const aktive = teilgebiete.filter((tg) => istTgAktivFuer(tg, ausgabe));
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
  }, [teilgebiete, beilagen, tourMap, ausgabe.kw, ausgabe.jahr]);

  // Einheitliche Zeilenhöhe: Alle Zeilen werden unsichtbar in natürlicher
  // Höhe gerendert, die höchste bestimmt die Höhe ALLER Zeilen. So steht
  // alles drauf und das Schnittraster ist auf jeder Seite identisch.
  const messRef = useRef<HTMLDivElement>(null);
  const [zeilenHoeheMm, setZeilenHoeheMm] = useState<number | null>(null);
  useEffect(() => {
    const root = messRef.current;
    if (!root) return;
    // Der Observer meldet sich direkt nach dem Layout einmal — dann messen.
    const observer = new ResizeObserver(() => {
      let maxPx = 0;
      root.querySelectorAll<HTMLElement>('.zettel-row').forEach((row) => {
        maxPx = Math.max(maxPx, row.offsetHeight);
      });
      // +1 mm Reserve für Rundungs-/Schriftunterschiede im Druck
      const mm = Math.ceil(maxPx / PX_PRO_MM) + 1;
      setZeilenHoeheMm(Math.min(SEITE_MM, Math.max(MIN_ZEILE_MM, mm)));
    });
    observer.observe(root);
    return () => observer.disconnect();
  }, [zeilen]);
  const hoeheMm = zeilenHoeheMm ?? MIN_ZEILE_MM;
  const proSeite = Math.max(1, Math.floor((SEITE_MM + ABSTAND_MM) / (hoeheMm + ABSTAND_MM)));

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
          }
        }
        /* Alle Seiten haben exakt dasselbe Raster, weil der ganze Stapel in
           einem Schnitt geschnitten wird: alle Zeilen sind so hoch wie die
           höchste Zeile (per Inline-Style gesetzt), 2 mm Abstand. */
        .zettel-sheet {
          height: 196mm;
          overflow: hidden;
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
          margin-bottom: 2mm;
          overflow: hidden;
        }
        /* Messbereich: Zeilen in natürlicher Höhe, unsichtbar */
        .zettel-mess {
          position: absolute;
          left: -10000px;
          top: 0;
          width: 285mm;
          visibility: hidden;
          pointer-events: none;
        }
        .zettel-mess .zettel-row { height: auto !important; }
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
        .zettel-tg-zeile {
          display: flex;
          flex-wrap: wrap;
          align-items: baseline;
          column-gap: 3mm;
          margin-top: 1mm;
        }
        .zettel-tg {
          font-size: 22px;
          font-weight: 800;
          color: #111827;
          line-height: 1.1;
        }
        .zettel-stk {
          font-size: 22px;
          color: #111827;
          font-weight: 800;
          line-height: 1.1;
          white-space: nowrap;
        }
        .zettel-stk-einheit {
          font-size: 0.6em;
          font-weight: 700;
          margin-left: 0.25em;
        }
        .zettel-beil-box.zettel-einlegen-list {
          font-size: 10pt;
          font-weight: 700;
          color: #111827;
          line-height: 1.25;
        }
        .zettel-beil-box {
          margin-top: 2mm;
          font-size: 8pt;
          color: #1f2937;
          line-height: 1.3;
        }
        .zettel-beil-title {
          font-size: 8pt;
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
          {zeilenHoeheMm != null && (
            <span className="text-gray-500 text-xs">
              Zeilenhöhe {zeilenHoeheMm} mm · {proSeite} je Seite
            </span>
          )}
          <div className="ml-auto">
            <button
              onClick={() => window.print()}
              disabled={zeilen.length === 0 || zeilenHoeheMm == null}
              className="bg-blue-700 hover:bg-blue-800 disabled:bg-gray-300 text-white px-4 py-1.5 rounded-lg text-sm font-medium"
            >
              🖨️ Drucken ({zeilen.length})
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 bg-gray-200">
          <ZettelchenInhalt zeilen={zeilen} ausgabe={ausgabe} hoeheMm={hoeheMm} proSeite={proSeite} />
        </div>

        {/* Messbereich für die einheitliche Zeilenhöhe (unsichtbar) */}
        <div ref={messRef} className="zettel-mess" aria-hidden>
          {zeilen.map((z) => (
            <ZettelRow key={z.tg.id} zeile={z} ausgabe={ausgabe} />
          ))}
        </div>
      </div>

      {/* Druck-Inhalt (nur beim Drucken sichtbar) */}
      <div className="zettel-print-only zettel-print-root">
        <ZettelchenInhalt zeilen={zeilen} ausgabe={ausgabe} hoeheMm={hoeheMm} proSeite={proSeite} printOnly />
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
  hoeheMm,
  proSeite,
  printOnly = false,
}: {
  zeilen: Zeile[];
  ausgabe: Ausgabe;
  hoeheMm: number;
  proSeite: number;
  printOnly?: boolean;
}) {
  // Gleich viele, gleich hohe Zeilen je A4-Querseite, damit das
  // Schnittraster auf allen Seiten identisch ist.
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
            <ZettelRow key={z.tg.id} zeile={z} ausgabe={ausgabe} hoeheMm={hoeheMm} />
          ))}
        </div>
      ))}
    </>
  );
}

function ZettelRow({ zeile, ausgabe, hoeheMm }: { zeile: Zeile; ausgabe: Ausgabe; hoeheMm?: number }) {
  const { tg, ext, int, tour } = zeile;
  const stripeFarbe = tour?.farbe ?? '#e5e7eb';

  return (
    <div className="zettel-row" style={hoeheMm ? { height: `${hoeheMm}mm` } : undefined}>
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
      <div className="zettel-tg-zeile">
        <span
          className="zettel-tg"
          style={compact ? { fontSize: '16px' } : undefined}
        >
          {tg.name}
        </span>
        <span
          className="zettel-stk"
          style={compact ? { fontSize: '16px' } : undefined}
        >
          {tg.stueckzahl.toLocaleString('de-DE')}
          <span className="zettel-stk-einheit">Stück</span>
        </span>
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
  const style = compact ? { fontSize: '8pt' } : undefined;
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
          <ul
            className="zettel-beil-list zettel-beil-box zettel-einlegen-list"
            style={compact ? { fontSize: '9.5pt' } : undefined}
          >
            {int.map((b) => (
              <li key={b.id}>{b.arbeitstitel || b.kundenname}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
