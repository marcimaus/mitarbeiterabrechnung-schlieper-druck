// Zeit-Auswertung — A4-Druckliste für einen einzelnen Mitarbeiter.
// Enthält: Stammdaten, gewählte Abrechnungsperiode, die erfassten
// Arbeitszeiten (alle Typen) des Monats sowie die Zusammentragen-Werte
// des MA — je Ausgabe welche Teilgebiete mit welchen Mengen, Stapeln und
// Beilagen zusammengelegt wurden. Bewusst OHNE Soll-Zeiten und EUR-Beträge.

import { useEffect, useMemo, useState } from 'react';
import type {
  Abrechnungsperiode,
  Arbeitszeit,
  Ausgabe,
  Mitarbeiter,
  Teilgebiet,
} from '../types';
import { TYP_LABELS } from '../types';
import { ladeZusammentragenEinsaetze, ladeBeilagen } from '../lib/db';
import { donnerstagDerKW, kwLabel, MONATSNAMEN } from '../lib/kalender';
import {
  berechneNettoMinuten,
  formatierDauer,
  formatierDatum,
  formatierZeit,
} from '../lib/zeiterfassung';

interface Props {
  ma: Mitarbeiter;
  monat: number;
  jahr: number;
  periode?: Abrechnungsperiode;
  /** Arbeitszeiten des MA im gewählten Monat (bereits geladen). */
  sessions: Arbeitszeit[];
  teilgebiete: Teilgebiet[];
  ausgaben: Ausgabe[];
  onClose: () => void;
}

interface ZusammenTgZeile {
  teilgebietId: string;
  name: string;
  plz: string;
  menge: number;
  stapel: number;
  beilagen: number;
}
interface ZusammenAusgabe {
  ausgabeId: string;
  kw: number;
  jahr: number;
  zeilen: ZusammenTgZeile[];
}

export default function ZeitAuswertungDruck({
  ma,
  monat,
  jahr,
  periode,
  sessions,
  teilgebiete,
  ausgaben,
  onClose,
}: Props) {
  const [zusammen, setZusammen] = useState<ZusammenAusgabe[]>([]);
  const [loading, setLoading] = useState(true);

  const tgMap = useMemo(() => new Map(teilgebiete.map((t) => [t.id, t])), [teilgebiete]);

  // Relevante Ausgaben: Erscheinungstag (Donnerstag der KW) im gewählten Monat.
  const relevanteAusgaben = useMemo(
    () =>
      ausgaben.filter((a) => {
        const d = donnerstagDerKW(a.kw, a.jahr);
        return d.getUTCFullYear() === jahr && d.getUTCMonth() + 1 === monat;
      }),
    [ausgaben, jahr, monat]
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const result: ZusammenAusgabe[] = [];
        for (const a of relevanteAusgaben) {
          const [einsaetze, beilagen] = await Promise.all([
            ladeZusammentragenEinsaetze(a.id),
            ladeBeilagen(a.id),
          ]);
          const meine = einsaetze.filter(
            (e) => e.mitarbeiterId === ma.id && !e.istVorarbeit
          );
          if (meine.length === 0) continue;
          const zeilen: ZusammenTgZeile[] = meine.map((e) => {
            const tg = tgMap.get(e.teilgebietId);
            const intBeil = beilagen.filter(
              (b) => b.kennzeichen === 'int' && b.teilgebietIds.includes(e.teilgebietId)
            ).length;
            return {
              teilgebietId: e.teilgebietId,
              name: tg?.name ?? '— gelöscht —',
              plz: tg?.plz ?? '',
              menge: tg?.stueckzahl ?? 0,
              stapel: e.stapelBearbeitet,
              beilagen: intBeil,
            };
          });
          zeilen.sort((x, y) => x.name.localeCompare(y.name, 'de', { numeric: true }));
          result.push({ ausgabeId: a.id, kw: a.kw, jahr: a.jahr, zeilen });
        }
        result.sort((x, y) => (x.jahr !== y.jahr ? x.jahr - y.jahr : x.kw - y.kw));
        if (!cancelled) setZusammen(result);
      } catch (err) {
        console.error('Fehler beim Laden der Zusammentragen-Daten:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [relevanteAusgaben, ma.id, tgMap]);

  const abgeschlossen = useMemo(
    () =>
      [...sessions]
        .filter((s) => s.status === 'abgeschlossen')
        .sort((a, b) => a.startTime - b.startTime),
    [sessions]
  );

  return (
    <>
      <style>{`
        @media screen {
          .za-print-only { display: none !important; }
          .za-sheet {
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
          .za-screen-only { display: none !important; }
          html, body { margin: 0 !important; padding: 0 !important; background: white !important; }
          body * { visibility: hidden !important; }
          .za-print-root, .za-print-root * { visibility: visible !important; }
          .za-print-root { position: absolute !important; left: 0; top: 0; width: 100%; }
          @page { size: A4 portrait; margin: 12mm 14mm; }
          .za-sheet { box-shadow: none !important; margin: 0 !important; padding: 0 !important; width: auto !important; min-height: 0 !important; }
          .za-row { break-inside: avoid; }
          .za-group { break-inside: avoid; }
        }
        table.za-table { border-collapse: collapse; width: 100%; font-size: 10.5px; }
        table.za-table th, table.za-table td {
          border: 1px solid #6b7280;
          padding: 4px 6px;
          vertical-align: top;
        }
        table.za-table th {
          background: #f3f4f6;
          font-weight: 600;
          font-size: 10px;
          text-transform: uppercase;
          letter-spacing: 0.03em;
          text-align: left;
        }
        .za-num { text-align: right; font-variant-numeric: tabular-nums; }
      `}</style>

      <div className="za-screen-only fixed inset-0 bg-black/60 z-50 flex flex-col">
        <div className="bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3 flex-wrap shrink-0">
          <button
            onClick={onClose}
            className="text-gray-600 hover:text-gray-900 text-sm px-3 py-1.5 border border-gray-300 rounded-lg"
          >
            ✕ Schließen
          </button>
          <span className="text-gray-700 font-semibold">
            Zeit-Auswertung — {ma.name}
          </span>
          <span className="text-gray-500 text-sm">
            ({MONATSNAMEN[monat - 1]} {jahr})
          </span>
          <div className="ml-auto">
            <button
              onClick={() => window.print()}
              disabled={loading}
              className="bg-blue-700 hover:bg-blue-800 disabled:bg-gray-300 text-white px-4 py-1.5 rounded-lg text-sm font-medium"
            >
              🖨️ Drucken
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 bg-gray-200">
          {loading ? (
            <div className="text-center text-gray-500 py-12 text-sm">Lade Daten…</div>
          ) : (
            <ZeitSheet
              ma={ma}
              monat={monat}
              jahr={jahr}
              periode={periode}
              sessions={abgeschlossen}
              zusammen={zusammen}
            />
          )}
        </div>
      </div>

      {!loading && (
        <div className="za-print-only za-print-root">
          <ZeitSheet
            ma={ma}
            monat={monat}
            jahr={jahr}
            periode={periode}
            sessions={abgeschlossen}
            zusammen={zusammen}
          />
        </div>
      )}
    </>
  );
}

function ZeitSheet({
  ma,
  monat,
  jahr,
  periode,
  sessions,
  zusammen,
}: {
  ma: Mitarbeiter;
  monat: number;
  jahr: number;
  periode?: Abrechnungsperiode;
  sessions: Arbeitszeit[];
  zusammen: ZusammenAusgabe[];
}) {
  const gesamtMinuten = sessions.reduce((s, x) => s + berechneNettoMinuten(x), 0);

  return (
    <div className="za-sheet">
      {/* Kopf */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '10px', borderBottom: '2px solid #1e3a5f', paddingBottom: '6px' }}>
        <div>
          <div style={{ fontSize: '16px', fontWeight: 700, color: '#1e3a5f' }}>
            Zeit-Auswertung
          </div>
          <div style={{ fontSize: '10px', color: '#6b7280', marginTop: '1px' }}>
            Schlieper-Druck GmbH
          </div>
        </div>
        <div style={{ textAlign: 'right', fontSize: '10px', color: '#374151' }}>
          <div><strong>Monat:</strong> {MONATSNAMEN[monat - 1]} {jahr}</div>
          <div><strong>Abrechnungsperiode:</strong> {periode ? periode.bezeichnung : '— keine zugeordnet —'}</div>
          <div>Erstellt: {new Date().toLocaleDateString('de-DE')}</div>
        </div>
      </div>

      {/* Stammdaten */}
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

      {/* Arbeitszeiten */}
      <div style={{ fontSize: '12px', fontWeight: 700, color: '#1e3a5f', margin: '4px 0 5px' }}>
        Erfasste Arbeitszeiten
      </div>
      <table className="za-table">
        <thead>
          <tr>
            <th style={{ width: '16%' }}>Datum</th>
            <th style={{ width: '12%' }}>Start</th>
            <th style={{ width: '12%' }}>Ende</th>
            <th style={{ width: '12%', textAlign: 'right' }}>Pause</th>
            <th style={{ width: '14%', textAlign: 'right' }}>Netto</th>
            <th>Tätigkeit</th>
          </tr>
        </thead>
        <tbody>
          {sessions.length === 0 && (
            <tr>
              <td colSpan={6} style={{ textAlign: 'center', color: '#9ca3af', padding: '10px' }}>
                Keine Arbeitszeiten in diesem Monat erfasst.
              </td>
            </tr>
          )}
          {sessions.map((s) => (
            <tr key={s.id} className="za-row">
              <td style={{ whiteSpace: 'nowrap' }}>{formatierDatum(s.startTime)}</td>
              <td>{formatierZeit(s.startTime)}</td>
              <td>{s.endTime ? formatierZeit(s.endTime) : '—'}</td>
              <td className="za-num">{formatierDauer(s.gesamtPauseMinuten)}</td>
              <td className="za-num">{formatierDauer(berechneNettoMinuten(s))}</td>
              <td>{TYP_LABELS[s.typ]}</td>
            </tr>
          ))}
        </tbody>
        {sessions.length > 0 && (
          <tfoot>
            <tr style={{ fontWeight: 700, background: '#eef2ff' }}>
              <td colSpan={4} style={{ textAlign: 'right' }}>
                Summe ({sessions.length} {sessions.length === 1 ? 'Eintrag' : 'Einträge'})
              </td>
              <td className="za-num">{formatierDauer(gesamtMinuten)}</td>
              <td></td>
            </tr>
          </tfoot>
        )}
      </table>

      {/* Zusammentragen je Ausgabe */}
      <div style={{ fontSize: '12px', fontWeight: 700, color: '#1e3a5f', margin: '16px 0 5px' }}>
        Zusammentragen — je Ausgabe
      </div>
      {zusammen.length === 0 ? (
        <div style={{ fontSize: '10.5px', color: '#6b7280', fontStyle: 'italic' }}>
          Keine Zusammentragen-Zuordnungen für diesen Mitarbeiter in diesem Monat.
        </div>
      ) : (
        zusammen.map((g) => {
          const summeMenge = g.zeilen.reduce((s, z) => s + z.menge, 0);
          return (
            <div key={g.ausgabeId} className="za-group" style={{ marginBottom: '12px' }}>
              <div style={{ fontSize: '11px', fontWeight: 700, color: '#374151', margin: '6px 0 3px' }}>
                {kwLabel(g.kw, g.jahr)}
              </div>
              <table className="za-table">
                <thead>
                  <tr>
                    <th>Teilgebiet</th>
                    <th style={{ width: '12%', textAlign: 'right' }}>Menge</th>
                    <th style={{ width: '12%', textAlign: 'right' }}>Stapel</th>
                    <th style={{ width: '14%', textAlign: 'right' }}>int. Beilagen</th>
                  </tr>
                </thead>
                <tbody>
                  {g.zeilen.map((z) => (
                    <tr key={z.teilgebietId} className="za-row">
                      <td>
                        {z.name}
                        {z.plz && <span style={{ color: '#6b7280' }}> · {z.plz}</span>}
                      </td>
                      <td className="za-num">{z.menge.toLocaleString('de-DE')}</td>
                      <td className="za-num">{z.stapel.toLocaleString('de-DE')}</td>
                      <td className="za-num">{z.beilagen > 0 ? z.beilagen : '—'}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr style={{ fontWeight: 700, background: '#f9fafb' }}>
                    <td style={{ textAlign: 'right' }}>
                      Σ {g.zeilen.length} {g.zeilen.length === 1 ? 'Teilgebiet' : 'Teilgebiete'}
                    </td>
                    <td className="za-num">{summeMenge.toLocaleString('de-DE')}</td>
                    <td></td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          );
        })
      )}

      <div style={{ marginTop: '20px', fontSize: '10px', color: '#374151', display: 'flex', gap: '28px' }}>
        <div>Datum / Unterschrift: <span style={{ display: 'inline-block', borderBottom: '1px solid #6b7280', minWidth: '160px' }}>&nbsp;</span></div>
      </div>
    </div>
  );
}
