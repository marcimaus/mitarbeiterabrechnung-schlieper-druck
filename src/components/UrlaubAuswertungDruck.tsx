// Urlaubs-Auswertung — A4-Druckliste.
//
// Zwei Modi:
//  - Einzel-MA: alle Urlaube eines Mitarbeiters im gewählten Jahr — als
//    Mitarbeiter-Bestätigung („so sind deine Urlaube eingeplant").
//  - Alle MA: alle Urlaube aller Mitarbeiter im gewählten Jahr, gruppiert
//    je MA mit Zwischensumme — Übersicht für Admin/Abrechnung.

import { useEffect, useMemo, useState } from 'react';
import type { Mitarbeiter, UrlaubsEintrag } from '../types';
import { URLAUB_STATUS_LABELS } from '../types';
import { urlaubsListener } from '../lib/planung';

interface EinzelProps {
  jahr: number;
  einzel: { ma: Mitarbeiter; eintraege: UrlaubsEintrag[] };
  alle?: undefined;
  onClose: () => void;
}
interface AlleProps {
  jahr: number;
  einzel?: undefined;
  alle: { mitarbeiter: Mitarbeiter[] };
  onClose: () => void;
}
type Props = EinzelProps | AlleProps;

interface UrlaubGruppe {
  key: string;
  datumVon: string;
  datumBis: string;
  kws: Array<{
    jahr: number;
    kw: number;
    status: UrlaubsEintrag['status'];
    tage: number;
    werktage: string[];
    freigegeben: boolean;
  }>;
  kommentar?: string;
  alleFreigegeben: boolean;
  summeTage: number;
}

function gruppiere(eintraege: UrlaubsEintrag[]): UrlaubGruppe[] {
  const map = new Map<string, UrlaubGruppe>();
  for (const e of eintraege) {
    const k = `${e.datumVon ?? ''}|${e.datumBis ?? ''}`;
    const g = map.get(k) ?? {
      key: k,
      datumVon: e.datumVon ?? '',
      datumBis: e.datumBis ?? '',
      kws: [],
      kommentar: e.kommentar,
      alleFreigegeben: true,
      summeTage: 0,
    };
    g.kws.push({
      jahr: e.jahr,
      kw: e.kw,
      status: e.status,
      tage: e.werktageInKw?.length ?? 0,
      werktage: e.werktageInKw ?? [],
      freigegeben: e.freigegeben,
    });
    g.summeTage += e.werktageInKw?.length ?? 0;
    if (!e.freigegeben) g.alleFreigegeben = false;
    if (!g.kommentar && e.kommentar) g.kommentar = e.kommentar;
    map.set(k, g);
  }
  return Array.from(map.values())
    .map((g) => {
      g.kws.sort((a, b) => a.jahr - b.jahr || a.kw - b.kw);
      return g;
    })
    .sort((a, b) => {
      // Aufsteigend nach Beginn der ersten KW im Gruppen-Set
      const av = a.kws[0];
      const bv = b.kws[0];
      return av.jahr - bv.jahr || av.kw - bv.kw;
    });
}

function fmtDatum(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
function fmtTag(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' });
}

export default function UrlaubAuswertungDruck(props: Props) {
  const { jahr, onClose } = props;
  const istEinzel = props.einzel !== undefined;

  // Im Alle-MA-Modus: live alle Urlaube des Jahres laden.
  const [alleEintraege, setAlleEintraege] = useState<UrlaubsEintrag[] | null>(
    istEinzel ? null : null,
  );
  useEffect(() => {
    if (istEinzel) return;
    const unsub = urlaubsListener(jahr, setAlleEintraege);
    return () => unsub();
  }, [istEinzel, jahr]);

  return (
    <>
      <style>{`
        @media screen {
          .ua-print-only { display: none !important; }
          .ua-sheet {
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
          .ua-screen-only { display: none !important; }
          html, body { margin: 0 !important; padding: 0 !important; background: white !important; }
          body * { visibility: hidden !important; }
          .ua-print-root, .ua-print-root * { visibility: visible !important; }
          .ua-print-root { position: absolute !important; left: 0; top: 0; width: 100%; }
          @page { size: A4 portrait; margin: 12mm 14mm; }
          .ua-sheet { box-shadow: none !important; margin: 0 !important; padding: 0 !important; width: auto !important; min-height: 0 !important; }
          .ua-ma-block { break-inside: avoid; }
          .ua-row { break-inside: avoid; }
        }
        table.ua-table { border-collapse: collapse; width: 100%; font-size: 10.5px; }
        table.ua-table th, table.ua-table td {
          border: 1px solid #6b7280;
          padding: 3px 6px;
          vertical-align: top;
        }
        table.ua-table th {
          background: #f3f4f6;
          font-weight: 600;
          font-size: 10px;
          text-transform: uppercase;
          letter-spacing: 0.03em;
          text-align: left;
        }
        .ua-num { text-align: right; font-variant-numeric: tabular-nums; }
      `}</style>

      <div className="ua-screen-only fixed inset-0 bg-black/60 z-50 flex flex-col">
        <div className="bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3 flex-wrap shrink-0">
          <button
            onClick={onClose}
            className="text-gray-600 hover:text-gray-900 text-sm px-3 py-1.5 border border-gray-300 rounded-lg"
          >
            ✕ Schließen
          </button>
          <span className="text-gray-700 font-semibold">
            {istEinzel
              ? `Urlaubs-Auswertung — ${props.einzel!.ma.name}`
              : 'Urlaubs-Auswertung — alle Mitarbeiter'}
          </span>
          <span className="text-gray-500 text-sm">({jahr})</span>
          <div className="ml-auto">
            <button
              onClick={() => window.print()}
              disabled={!istEinzel && alleEintraege === null}
              className="bg-blue-700 hover:bg-blue-800 disabled:bg-gray-300 text-white px-4 py-1.5 rounded-lg text-sm font-medium"
            >
              🖨️ Drucken
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 bg-gray-200">
          {istEinzel ? (
            <EinzelSheet jahr={jahr} ma={props.einzel!.ma} eintraege={props.einzel!.eintraege} />
          ) : alleEintraege === null ? (
            <div className="text-center text-gray-500 py-12 text-sm">Lade Urlaubsdaten…</div>
          ) : (
            <AlleSheet jahr={jahr} mitarbeiter={props.alle!.mitarbeiter} eintraege={alleEintraege} />
          )}
        </div>
      </div>

      <div className="ua-print-only ua-print-root">
        {istEinzel ? (
          <EinzelSheet jahr={jahr} ma={props.einzel!.ma} eintraege={props.einzel!.eintraege} />
        ) : alleEintraege !== null ? (
          <AlleSheet jahr={jahr} mitarbeiter={props.alle!.mitarbeiter} eintraege={alleEintraege} />
        ) : null}
      </div>
    </>
  );
}

function Kopf({
  titel,
  subtitle,
  jahr,
}: {
  titel: string;
  subtitle: string;
  jahr: number;
}) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '10px', borderBottom: '2px solid #1e3a5f', paddingBottom: '6px' }}>
      <div>
        <div style={{ fontSize: '16px', fontWeight: 700, color: '#1e3a5f' }}>{titel}</div>
        <div style={{ fontSize: '10px', color: '#6b7280', marginTop: '1px' }}>{subtitle}</div>
      </div>
      <div style={{ textAlign: 'right', fontSize: '10px', color: '#374151' }}>
        <div><strong>Jahr:</strong> {jahr}</div>
        <div>Erstellt: {new Date().toLocaleDateString('de-DE')}</div>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: UrlaubsEintrag['status'] }) {
  const farbe =
    status === 'ganze-woche' ? '#fecaca' :
    status === 'einzeltag' ? '#fde68a' : '#fed7aa';
  const text =
    status === 'ganze-woche' ? '#7f1d1d' :
    status === 'einzeltag' ? '#78350f' : '#9a3412';
  return (
    <span style={{ display: 'inline-block', background: farbe, color: text, padding: '1px 4px', borderRadius: '3px', fontSize: '9px' }}>
      {URLAUB_STATUS_LABELS[status]}
    </span>
  );
}

function GruppenZeile({ g }: { g: UrlaubGruppe }) {
  const statuses = Array.from(new Set(g.kws.map((k) => k.status)));
  return (
    <tr className="ua-row">
      <td style={{ whiteSpace: 'nowrap' }}>
        {g.datumVon && g.datumBis ? (
          g.datumVon === g.datumBis
            ? fmtDatum(g.datumVon)
            : `${fmtDatum(g.datumVon)} – ${fmtDatum(g.datumBis)}`
        ) : (
          <span style={{ color: '#9ca3af', fontStyle: 'italic' }}>ohne Datum</span>
        )}
      </td>
      <td style={{ whiteSpace: 'nowrap' }}>
        {g.kws.length === 1
          ? `KW ${g.kws[0].kw}/${g.kws[0].jahr}`
          : `KW ${g.kws[0].kw} – KW ${g.kws[g.kws.length - 1].kw}/${g.kws[g.kws.length - 1].jahr} (${g.kws.length} W.)`}
      </td>
      <td>
        {statuses.map((s, i) => (
          <span key={s} style={{ marginRight: i < statuses.length - 1 ? '3px' : 0 }}>
            <StatusBadge status={s} />
          </span>
        ))}
      </td>
      <td className="ua-num">{g.summeTage}</td>
      <td>
        {g.alleFreigegeben ? (
          <span style={{ color: '#15803d' }}>✓ freigegeben</span>
        ) : (
          <span style={{ color: '#b45309' }}>⏳ offen</span>
        )}
      </td>
      <td>{g.kommentar ?? ''}</td>
    </tr>
  );
}

function GruppenTabelle({ gruppen }: { gruppen: UrlaubGruppe[] }) {
  return (
    <table className="ua-table">
      <thead>
        <tr>
          <th style={{ width: '20%' }}>Zeitraum</th>
          <th style={{ width: '18%' }}>KW(s)</th>
          <th style={{ width: '16%' }}>Status</th>
          <th style={{ width: '10%', textAlign: 'right' }}>Werktage</th>
          <th style={{ width: '14%' }}>Freigabe</th>
          <th>Kommentar</th>
        </tr>
      </thead>
      <tbody>
        {gruppen.map((g) => (
          <GruppenZeile key={g.key} g={g} />
        ))}
      </tbody>
    </table>
  );
}

// ---- Einzel-MA-Sheet ----------------------------------------

function EinzelSheet({
  jahr,
  ma,
  eintraege,
}: {
  jahr: number;
  ma: Mitarbeiter;
  eintraege: UrlaubsEintrag[];
}) {
  const desJahres = useMemo(
    () => eintraege.filter((e) => e.jahr === jahr),
    [eintraege, jahr],
  );
  const gruppen = useMemo(() => gruppiere(desJahres), [desJahres]);
  const summeTage = gruppen.reduce((s, g) => s + g.summeTage, 0);
  const offen = gruppen.filter((g) => !g.alleFreigegeben).length;

  // Detailliste: konkrete Werktage (chronologisch), kompakt
  const alleWerktage = useMemo(() => {
    const tage: string[] = [];
    for (const e of desJahres) {
      if (e.werktageInKw && e.werktageInKw.length > 0) tage.push(...e.werktageInKw);
    }
    return Array.from(new Set(tage)).sort();
  }, [desJahres]);

  return (
    <div className="ua-sheet">
      <Kopf
        titel="Urlaubs-Auswertung"
        subtitle="Schlieper-Druck GmbH"
        jahr={jahr}
      />

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
      </div>

      <div style={{ fontSize: '10.5px', color: '#374151', marginBottom: '8px' }}>
        Diese Aufstellung dokumentiert die für <strong>{ma.name}</strong> im Jahr {jahr}{' '}
        eingeplanten Urlaubszeiten zum Stand vom {new Date().toLocaleDateString('de-DE')}.
        Bitte prüfen und bei Unstimmigkeiten an die Personalabteilung wenden.
      </div>

      {gruppen.length === 0 ? (
        <div style={{ padding: '20px', textAlign: 'center', color: '#9ca3af', fontStyle: 'italic' }}>
          Keine Urlaube für {jahr} eingeplant.
        </div>
      ) : (
        <>
          <GruppenTabelle gruppen={gruppen} />

          <div style={{ marginTop: '10px', padding: '6px 8px', background: '#eef2ff', border: '1px solid #c7d2fe', borderRadius: '3px', fontSize: '11px', display: 'flex', justifyContent: 'space-between' }}>
            <span>
              <strong>Σ {gruppen.length}</strong> Urlaubszeitraum/-räume,
              davon <strong>{offen}</strong> noch nicht freigegeben
            </span>
            <span><strong>Σ {summeTage} Werktag(e)</strong></span>
          </div>

          {/* Konkrete Werktage als kompakte Liste */}
          {alleWerktage.length > 0 && (
            <>
              <div style={{ fontSize: '11px', fontWeight: 700, color: '#1e3a5f', margin: '14px 0 4px' }}>
                Konkrete Urlaubstage ({alleWerktage.length})
              </div>
              <div style={{ fontSize: '10.5px', color: '#374151', lineHeight: 1.5 }}>
                {alleWerktage.map((t) => fmtTag(t)).join(' · ')}
              </div>
            </>
          )}
        </>
      )}

      <div style={{ marginTop: '24px', fontSize: '10px', color: '#374151', display: 'flex', gap: '28px' }}>
        <div>
          Datum / Unterschrift Mitarbeiter:{' '}
          <span style={{ display: 'inline-block', borderBottom: '1px solid #6b7280', minWidth: '180px' }}>&nbsp;</span>
        </div>
      </div>
    </div>
  );
}

// ---- Alle-MA-Sheet ------------------------------------------

function AlleSheet({
  jahr,
  mitarbeiter,
  eintraege,
}: {
  jahr: number;
  mitarbeiter: Mitarbeiter[];
  eintraege: UrlaubsEintrag[];
}) {
  // Gruppieren je MA, dann je Urlaubsgruppe
  const proMa = useMemo(() => {
    const byMa = new Map<string, UrlaubsEintrag[]>();
    for (const e of eintraege) {
      if (e.jahr !== jahr) continue;
      const arr = byMa.get(e.mitarbeiterId) ?? [];
      arr.push(e);
      byMa.set(e.mitarbeiterId, arr);
    }
    const out: Array<{ ma: Mitarbeiter | undefined; maId: string; gruppen: UrlaubGruppe[]; summeTage: number }> = [];
    for (const [maId, list] of byMa) {
      const ma = mitarbeiter.find((m) => m.id === maId);
      const gruppen = gruppiere(list);
      const summeTage = gruppen.reduce((s, g) => s + g.summeTage, 0);
      out.push({ ma, maId, gruppen, summeTage });
    }
    out.sort((a, b) => {
      const an = a.ma?.name ?? 'zzz';
      const bn = b.ma?.name ?? 'zzz';
      return an.localeCompare(bn, 'de');
    });
    return out;
  }, [eintraege, jahr, mitarbeiter]);

  const gesamtTage = proMa.reduce((s, g) => s + g.summeTage, 0);
  const gesamtGruppen = proMa.reduce((s, g) => s + g.gruppen.length, 0);

  return (
    <div className="ua-sheet">
      <Kopf
        titel="Urlaubs-Auswertung — alle Mitarbeiter"
        subtitle="Schlieper-Druck GmbH"
        jahr={jahr}
      />

      <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap', marginBottom: '10px', fontSize: '10.5px', color: '#374151' }}>
        <div><strong>{proMa.length}</strong> Mitarbeiter mit Urlauben</div>
        <div><strong>{gesamtGruppen}</strong> Urlaubszeiträume</div>
        <div><strong>{gesamtTage}</strong> Σ Werktage</div>
      </div>

      {proMa.length === 0 ? (
        <div style={{ padding: '24px', textAlign: 'center', color: '#9ca3af', fontStyle: 'italic' }}>
          Keine Urlaube für {jahr} eingeplant.
        </div>
      ) : (
        proMa.map((g) => (
          <div key={g.maId} className="ua-ma-block" style={{ marginBottom: '14px' }}>
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
                {g.gruppen.length} Zeitraum/-räume · Σ {g.summeTage} Werktag(e)
              </div>
            </div>
            <GruppenTabelle gruppen={g.gruppen} />
          </div>
        ))
      )}

      {/* Gesamtsumme */}
      {proMa.length > 0 && (
        <div style={{ marginTop: '12px', borderTop: '2px solid #1e3a5f', paddingTop: '8px' }}>
          <table className="ua-table">
            <tbody>
              <tr style={{ fontWeight: 700, background: '#1e3a5f', color: 'white' }}>
                <td style={{ padding: '6px 8px', fontSize: '11px' }}>
                  Gesamt ({proMa.length} {proMa.length === 1 ? 'Mitarbeiter' : 'Mitarbeiter'} ·{' '}
                  {gesamtGruppen} Urlaubszeitraum/-räume)
                </td>
                <td className="ua-num" style={{ width: '20%', padding: '6px 8px', fontSize: '11px' }}>
                  {gesamtTage} Werktag(e)
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
