// Zeit-Auswertung über ALLE Mitarbeiter — A4-Druckliste als Anlage zur
// Lohnabrechnung (Dokumentation). Gruppiert alle erfassten Arbeitszeiten
// eines Monats je Mitarbeiter mit Zwischensummen (Σ Sessions, Σ Netto-h)
// und einer Gesamtsumme. Wenn die Auswahl auf der Übersicht eingeschränkt
// wurde (Kategorie/Typ/Mit-Ohne-Zeiten/Rest-Fehlmenge/Suchtext), wird das
// im Kopf explizit dokumentiert.

import { useMemo } from 'react';
import type {
  Abrechnungsperiode,
  Arbeitszeit,
  ArbeitszeitsTyp,
  Mitarbeiter,
  Rolle,
} from '../types';
import { TYP_LABELS, ROLLEN_LABELS } from '../types';
import { MONATSNAMEN } from '../lib/kalender';
import {
  berechneNettoMinuten,
  formatierDauer,
  formatierDatum,
  formatierZeit,
} from '../lib/zeiterfassung';

export interface AuswertungFilter {
  /** Suchtext (Name/Nummer) auf der Übersicht. */
  suchText?: string;
  /** Eingeschränkt auf eine Kategorie/Rolle. */
  rolle?: Rolle | '';
  /** Eingeschränkt auf einen Arbeitszeit-Typ. */
  typ?: ArbeitszeitsTyp | '';
  /** „mit Zeiten" / „ohne Zeiten". */
  zeiten?: '' | 'mit' | 'ohne';
  /** Eingeschränkt auf ein Teilgebiet (Anzeigename, nicht ID). */
  teilgebiet?: string;
  /** Rest-/Fehlmengen-Filter (mitRest/ohneRest/mitFehl/ohneFehl). */
  rest?: '' | 'mitRest' | 'ohneRest' | 'mitFehl' | 'ohneFehl';
}

interface Props {
  monat: number;
  jahr: number;
  periode?: Abrechnungsperiode;
  /** Liste der zu druckenden Mitarbeiter (bereits durch Filter eingeschränkt). */
  mitarbeiter: Mitarbeiter[];
  /** Arbeitszeiten dieser Mitarbeiter im gewählten Monat (bereits geladen
   *  und ggf. nach Typ gefiltert). Status egal — wir filtern hier auf
   *  „abgeschlossen". */
  sessions: Arbeitszeit[];
  /** Aktive Filter — werden im Kopf dokumentiert. */
  filter: AuswertungFilter;
  onClose: () => void;
}

interface MaGruppe {
  ma: Mitarbeiter;
  sessions: Arbeitszeit[];
  summeMinuten: number;
}

function filterChips(filter: AuswertungFilter): string[] {
  const out: string[] = [];
  if (filter.suchText && filter.suchText.trim()) {
    out.push(`Suche: „${filter.suchText.trim()}"`);
  }
  if (filter.rolle) {
    out.push(`Kategorie: ${ROLLEN_LABELS[filter.rolle as Rolle]}`);
  }
  if (filter.typ) {
    out.push(`Typ: ${TYP_LABELS[filter.typ as ArbeitszeitsTyp]}`);
  }
  if (filter.zeiten === 'mit') out.push('nur MA mit Zeiten');
  if (filter.zeiten === 'ohne') out.push('nur MA ohne Zeiten');
  if (filter.teilgebiet) out.push(`Teilgebiet: ${filter.teilgebiet}`);
  if (filter.rest === 'mitRest') out.push('nur mit Restmenge');
  if (filter.rest === 'ohneRest') out.push('ohne Restmenge');
  if (filter.rest === 'mitFehl') out.push('nur mit Fehlmenge');
  if (filter.rest === 'ohneFehl') out.push('ohne Fehlmenge');
  return out;
}

export default function ZeitAuswertungAlleMaDruck({
  monat,
  jahr,
  periode,
  mitarbeiter,
  sessions,
  filter,
  onClose,
}: Props) {
  const gruppen: MaGruppe[] = useMemo(() => {
    const byMa = new Map<string, Arbeitszeit[]>();
    for (const s of sessions) {
      if (s.status !== 'abgeschlossen') continue;
      const arr = byMa.get(s.mitarbeiterId) ?? [];
      arr.push(s);
      byMa.set(s.mitarbeiterId, arr);
    }
    const out: MaGruppe[] = mitarbeiter.map((ma) => {
      const list = (byMa.get(ma.id) ?? []).slice()
        .sort((a, b) => a.startTime - b.startTime);
      const summeMinuten = list.reduce((s, x) => s + berechneNettoMinuten(x), 0);
      return { ma, sessions: list, summeMinuten };
    });
    out.sort((a, b) => a.ma.name.localeCompare(b.ma.name, 'de'));
    return out;
  }, [mitarbeiter, sessions]);

  const gesamtMinuten = gruppen.reduce((s, g) => s + g.summeMinuten, 0);
  const gesamtSessions = gruppen.reduce((s, g) => s + g.sessions.length, 0);
  const maMitZeiten = gruppen.filter((g) => g.summeMinuten > 0).length;
  const chips = filterChips(filter);

  return (
    <>
      <style>{`
        @media screen {
          .zaa-print-only { display: none !important; }
          .zaa-sheet {
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
          .zaa-screen-only { display: none !important; }
          html, body { margin: 0 !important; padding: 0 !important; background: white !important; }
          body * { visibility: hidden !important; }
          .zaa-print-root, .zaa-print-root * { visibility: visible !important; }
          .zaa-print-root { position: absolute !important; left: 0; top: 0; width: 100%; }
          @page { size: A4 portrait; margin: 12mm 14mm; }
          .zaa-sheet { box-shadow: none !important; margin: 0 !important; padding: 0 !important; width: auto !important; min-height: 0 !important; }
          .zaa-ma-block { break-inside: avoid; }
          .zaa-row { break-inside: avoid; }
        }
        table.zaa-table { border-collapse: collapse; width: 100%; font-size: 10.5px; }
        table.zaa-table th, table.zaa-table td {
          border: 1px solid #6b7280;
          padding: 3px 6px;
          vertical-align: top;
        }
        table.zaa-table th {
          background: #f3f4f6;
          font-weight: 600;
          font-size: 10px;
          text-transform: uppercase;
          letter-spacing: 0.03em;
          text-align: left;
        }
        .zaa-num { text-align: right; font-variant-numeric: tabular-nums; }
      `}</style>

      <div className="zaa-screen-only fixed inset-0 bg-black/60 z-50 flex flex-col">
        <div className="bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3 flex-wrap shrink-0">
          <button
            onClick={onClose}
            className="text-gray-600 hover:text-gray-900 text-sm px-3 py-1.5 border border-gray-300 rounded-lg"
          >
            ✕ Schließen
          </button>
          <span className="text-gray-700 font-semibold">
            Zeit-Auswertung — alle Mitarbeiter
          </span>
          <span className="text-gray-500 text-sm">
            ({MONATSNAMEN[monat - 1]} {jahr})
          </span>
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
            monat={monat}
            jahr={jahr}
            periode={periode}
            gruppen={gruppen}
            chips={chips}
            gesamtMinuten={gesamtMinuten}
            gesamtSessions={gesamtSessions}
            maMitZeiten={maMitZeiten}
          />
        </div>
      </div>

      <div className="zaa-print-only zaa-print-root">
        <Sheet
          monat={monat}
          jahr={jahr}
          periode={periode}
          gruppen={gruppen}
          chips={chips}
          gesamtMinuten={gesamtMinuten}
          gesamtSessions={gesamtSessions}
          maMitZeiten={maMitZeiten}
        />
      </div>
    </>
  );
}

function Sheet({
  monat,
  jahr,
  periode,
  gruppen,
  chips,
  gesamtMinuten,
  gesamtSessions,
  maMitZeiten,
}: {
  monat: number;
  jahr: number;
  periode?: Abrechnungsperiode;
  gruppen: MaGruppe[];
  chips: string[];
  gesamtMinuten: number;
  gesamtSessions: number;
  maMitZeiten: number;
}) {
  return (
    <div className="zaa-sheet">
      {/* Kopf */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px', borderBottom: '2px solid #1e3a5f', paddingBottom: '6px' }}>
        <div>
          <div style={{ fontSize: '16px', fontWeight: 700, color: '#1e3a5f' }}>
            Zeit-Auswertung — Anlage zur Lohnabrechnung
          </div>
          <div style={{ fontSize: '10px', color: '#6b7280', marginTop: '1px' }}>
            Schlieper-Druck GmbH · alle Mitarbeiter
          </div>
        </div>
        <div style={{ textAlign: 'right', fontSize: '10px', color: '#374151' }}>
          <div><strong>Monat:</strong> {MONATSNAMEN[monat - 1]} {jahr}</div>
          <div><strong>Abrechnungsperiode:</strong> {periode ? periode.bezeichnung : '— keine zugeordnet —'}</div>
          <div>Erstellt: {new Date().toLocaleDateString('de-DE')}</div>
        </div>
      </div>

      {/* Filter-Banner */}
      {chips.length > 0 ? (
        <div style={{ background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: '4px', padding: '6px 10px', marginBottom: '10px', fontSize: '10.5px', color: '#92400e' }}>
          <strong>Eingeschränkte Auswahl:</strong>{' '}
          {chips.map((c, i) => (
            <span key={i}>
              {i > 0 && <span style={{ color: '#d97706', margin: '0 6px' }}>·</span>}
              {c}
            </span>
          ))}
        </div>
      ) : (
        <div style={{ background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: '4px', padding: '6px 10px', marginBottom: '10px', fontSize: '10.5px', color: '#075985' }}>
          Auswertung über alle aktiven Mitarbeiter — keine Einschränkung gesetzt.
        </div>
      )}

      {/* Übersichtszeile */}
      <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap', marginBottom: '10px', fontSize: '10.5px', color: '#374151' }}>
        <div><strong>{gruppen.length}</strong> Mitarbeiter ausgewertet</div>
        <div><strong>{maMitZeiten}</strong> davon mit Zeiten</div>
        <div><strong>{gesamtSessions}</strong> Sessions gesamt</div>
        <div><strong>{formatierDauer(gesamtMinuten)}</strong> Σ Netto-Zeit</div>
      </div>

      {gruppen.length === 0 ? (
        <div style={{ padding: '24px', textAlign: 'center', color: '#9ca3af', fontStyle: 'italic' }}>
          Keine Mitarbeiter passen zur aktuellen Auswahl.
        </div>
      ) : (
        gruppen.map((g) => (
          <div key={g.ma.id} className="zaa-ma-block" style={{ marginBottom: '12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '3px' }}>
              <div style={{ fontSize: '12px', fontWeight: 700, color: '#1e3a5f' }}>
                {g.ma.hatFestgehalt ? '🔒 ' : ''}{g.ma.name}
                {g.ma.nummer && (
                  <span style={{ fontWeight: 400, color: '#6b7280', marginLeft: '8px' }}>
                    Nr. {g.ma.nummer}
                  </span>
                )}
              </div>
              <div style={{ fontSize: '10px', color: '#374151' }}>
                {g.ma.rollen.map((r) => ROLLEN_LABELS[r]).join(', ') || 'ohne Rolle'}
              </div>
            </div>
            {g.sessions.length === 0 ? (
              <div style={{ fontSize: '10.5px', color: '#9ca3af', fontStyle: 'italic', border: '1px dashed #d1d5db', borderRadius: '3px', padding: '4px 8px' }}>
                Keine Arbeitszeiten in diesem Monat erfasst.
              </div>
            ) : (
              <table className="zaa-table">
                <thead>
                  <tr>
                    <th style={{ width: '14%' }}>Datum</th>
                    <th style={{ width: '11%' }}>Start</th>
                    <th style={{ width: '11%' }}>Ende</th>
                    <th style={{ width: '11%', textAlign: 'right' }}>Pause</th>
                    <th style={{ width: '13%', textAlign: 'right' }}>Netto</th>
                    <th>Tätigkeit</th>
                  </tr>
                </thead>
                <tbody>
                  {g.sessions.map((s) => (
                    <tr key={s.id} className="zaa-row">
                      <td style={{ whiteSpace: 'nowrap' }}>{formatierDatum(s.startTime)}</td>
                      <td>{formatierZeit(s.startTime)}</td>
                      <td>{s.endTime ? formatierZeit(s.endTime) : '—'}</td>
                      <td className="zaa-num">{formatierDauer(s.gesamtPauseMinuten)}</td>
                      <td className="zaa-num">{formatierDauer(berechneNettoMinuten(s))}</td>
                      <td>
                        {TYP_LABELS[s.typ]}
                        {s.nichtBeruecksichtigen && (
                          <span style={{ marginLeft: '6px', fontSize: '9px', color: '#6b7280' }}>
                            (ignoriert)
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr style={{ fontWeight: 700, background: '#eef2ff' }}>
                    <td colSpan={4} style={{ textAlign: 'right' }}>
                      Zwischensumme ({g.sessions.length} {g.sessions.length === 1 ? 'Eintrag' : 'Einträge'})
                    </td>
                    <td className="zaa-num">{formatierDauer(g.summeMinuten)}</td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            )}
          </div>
        ))
      )}

      {/* Gesamtsumme */}
      {gruppen.length > 0 && (
        <div style={{ marginTop: '12px', borderTop: '2px solid #1e3a5f', paddingTop: '8px' }}>
          <table className="zaa-table">
            <tbody>
              <tr style={{ fontWeight: 700, background: '#1e3a5f', color: 'white' }}>
                <td style={{ padding: '6px 8px', fontSize: '11px' }}>
                  Gesamt ({gruppen.length} {gruppen.length === 1 ? 'Mitarbeiter' : 'Mitarbeiter'},{' '}
                  {maMitZeiten} mit Zeiten · {gesamtSessions} {gesamtSessions === 1 ? 'Session' : 'Sessions'})
                </td>
                <td className="zaa-num" style={{ width: '22%', padding: '6px 8px', fontSize: '11px' }}>
                  {formatierDauer(gesamtMinuten)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
