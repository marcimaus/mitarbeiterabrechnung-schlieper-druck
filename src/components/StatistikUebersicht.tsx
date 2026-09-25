// Statistik „Seitenzahl & Beilagensumme je KW/Jahr".
//
// Zwei Matrix-Tabellen (Umschalter): Jahre horizontal absteigend, KW vertikal.
// Zusatzspalten je KW: Gesamt-Durchschnitt und Ø der letzten 4 Jahre (±1 KW).
// Fußzeilen je Jahr: Summe / Ø / Min / Max. Jede Zelle ist editierbar und
// farblich markierbar; eine Legende erklärt die Farben.
//
// Alt-Daten (≤ 2025) werden per Script importiert. Ab 2026 zeigt die App einen
// Vorschlag aus den erfassten Daten (Seitenzahl bzw. verteilte Exemplare/1000),
// der per Klick übernommen oder manuell überschrieben werden kann.

import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../context/AppContext';
import {
  ladeStatistik,
  setzeStatistikZelle,
  ladeStatistikMeta,
  speichereStatistikMeta,
  ladeAusgaben,
  ladeBeilagen,
} from '../lib/db';
import {
  zellWert,
  gesamtDurchschnittJeKW,
  durchschnitt4JahreUmKW,
  jahresKennzahlen,
  appVorschlagSeiten,
  appVorschlagBeilagen,
} from '../lib/statistik';
import { getCurrentKW } from '../lib/kalender';
import type {
  StatistikTyp,
  StatistikJahr,
  StatistikMeta,
  StatistikLegendeEintrag,
  Ausgabe,
  Beilage,
} from '../types';

const KWS = Array.from({ length: 53 }, (_, i) => i + 1);

function fmtWert(typ: StatistikTyp, v: number | null): string {
  if (v == null) return '';
  if (typ === 'seiten') {
    return Number.isInteger(v) ? String(v) : v.toLocaleString('de-DE', { maximumFractionDigits: 1 });
  }
  return v.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

function fmtDurchschnitt(v: number | null): string {
  if (v == null) return '';
  return v.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

export default function StatistikUebersicht() {
  const { teilgebiete } = useApp();
  const aktuellesJahr = getCurrentKW().jahr;

  const [typ, setTyp] = useState<StatistikTyp>('seiten');
  const [alle, setAlle] = useState<StatistikJahr[]>([]);
  const [meta, setMeta] = useState<StatistikMeta>({
    kwBezeichnungen: {},
    legendeSeiten: [],
    legendeBeilagen: [],
  });
  const [ausgaben, setAusgaben] = useState<Ausgabe[]>([]);
  const [alleBeilagen, setAlleBeilagen] = useState<Beilage[]>([]);
  const [loading, setLoading] = useState(true);
  const [legendeOffen, setLegendeOffen] = useState(false);

  // Welche Zelle wird gerade bearbeitet?
  const [editKey, setEditKey] = useState<string | null>(null); // `${jahr}-${kw}`
  // Welche Bezeichnungs-Zelle (erste Spalte) wird gerade bearbeitet?
  const [editBezKw, setEditBezKw] = useState<number | null>(null);

  useEffect(() => {
    Promise.all([ladeStatistik(), ladeStatistikMeta(), ladeAusgaben(), ladeBeilagen()])
      .then(([s, m, a, b]) => {
        setAlle(s);
        setMeta(m);
        setAusgaben(a);
        setAlleBeilagen(b);
      })
      .finally(() => setLoading(false));
  }, []);

  // Nur Dokumente des aktuellen Typs.
  const jahreDaten = useMemo(() => alle.filter((s) => s.typ === typ), [alle, typ]);

  // Anzuzeigende Jahresspalten: alle vorhandenen + aktuelles Jahr, absteigend.
  const jahre = useMemo(() => {
    const set = new Set<number>(jahreDaten.map((s) => s.jahr));
    set.add(aktuellesJahr);
    return Array.from(set).sort((a, b) => b - a);
  }, [jahreDaten, aktuellesJahr]);

  const jahrDoc = (jahr: number): StatistikJahr | undefined =>
    jahreDaten.find((s) => s.jahr === jahr);

  // App-Vorschlag für (jahr ≥ aktuellesJahr, kw). Index: `${jahr}-${kw}` → Wert.
  const vorschlaege = useMemo(() => {
    const map = new Map<string, number | null>();
    const beilagenProAusgabe = new Map<string, Beilage[]>();
    for (const b of alleBeilagen) {
      const arr = beilagenProAusgabe.get(b.ausgabeId) ?? [];
      arr.push(b);
      beilagenProAusgabe.set(b.ausgabeId, arr);
    }
    for (const a of ausgaben) {
      if (a.jahr < aktuellesJahr) continue;
      const key = `${a.jahr}-${a.kw}`;
      const v =
        typ === 'seiten'
          ? appVorschlagSeiten(a)
          : appVorschlagBeilagen(beilagenProAusgabe.get(a.id) ?? [], teilgebiete);
      map.set(key, v);
    }
    return map;
  }, [ausgaben, alleBeilagen, teilgebiete, typ, aktuellesJahr]);

  // Eine gemeinsame Legende für beide Tabellen — Seitenzahl und Beilagensumme
  // beziehen sich auf dieselben Ausgaben, daher müssen Farben + ihre Bedeutung
  // identisch sein. Existierende Einträge aus beiden Feldern (Migrations-Fall)
  // werden über die ID dedupliziert.
  const legende: StatistikLegendeEintrag[] = useMemo(() => {
    const map = new Map<string, StatistikLegendeEintrag>();
    for (const e of meta.legendeSeiten) map.set(e.id, e);
    for (const e of meta.legendeBeilagen) if (!map.has(e.id)) map.set(e.id, e);
    return Array.from(map.values());
  }, [meta.legendeSeiten, meta.legendeBeilagen]);

  // Schwester-Doc (anderer Typ, gleiches Jahr) — für Lesen geteilter Felder.
  const otherJahrDoc = (jahr: number): StatistikJahr | undefined =>
    alle.find((s) => s.typ !== typ && s.jahr === jahr);

  /** Speichert eine Zelle (Wert + Farbe) und aktualisiert den lokalen State. */
  async function speichereZelle(
    jahr: number,
    kw: number,
    wert: number | null,
    farbe?: string,
    kommentar?: string,
    link?: string,
  ) {
    await setzeStatistikZelle(typ, jahr, kw, { wert, farbe, kommentar, link });
    const k = kommentar?.trim();
    const l = link?.trim();
    const shared = {
      ...(farbe !== undefined ? { farbe } : {}),
      ...(k ? { kommentar: k } : {}),
      ...(l ? { link: l } : {}),
    };
    const otherTyp: StatistikTyp = typ === 'seiten' ? 'beilagen' : 'seiten';
    setAlle((prev) => {
      const next = [...prev];
      // Aktuellen Typ: Wert + geteilte Felder setzen.
      const idx = next.findIndex((s) => s.typ === typ && s.jahr === jahr);
      const zelle = { wert, ...shared };
      if (idx >= 0) {
        next[idx] = { ...next[idx], zellen: { ...next[idx].zellen, [kw]: zelle } };
      } else {
        next.push({
          id: `${typ}_${jahr}`,
          typ,
          jahr,
          zellen: { [kw]: zelle },
          aktualisiertAm: Date.now(),
        } as StatistikJahr);
      }
      // Schwester-Typ: nur geteilte Felder mergen, Wert bleibt.
      const oIdx = next.findIndex((s) => s.typ === otherTyp && s.jahr === jahr);
      if (oIdx >= 0) {
        const prevZ = next[oIdx].zellen?.[kw] ?? { wert: null };
        next[oIdx] = {
          ...next[oIdx],
          zellen: { ...next[oIdx].zellen, [kw]: { ...prevZ, ...shared, ...(farbe === undefined ? { farbe: undefined } : {}) } },
        };
      } else if (Object.keys(shared).length > 0 || farbe === undefined) {
        next.push({
          id: `${otherTyp}_${jahr}`,
          typ: otherTyp,
          jahr,
          zellen: { [kw]: { wert: null, ...shared } },
          aktualisiertAm: Date.now(),
        } as StatistikJahr);
      }
      return next;
    });
    setEditKey(null);
  }

  async function speichereKwBezeichnung(kw: number, text: string, farbe?: string) {
    const neuBez = { ...meta.kwBezeichnungen };
    if (text.trim()) neuBez[kw] = text.trim();
    else delete neuBez[kw];
    const neuFarben = { ...(meta.kwFarben ?? {}) };
    neuFarben[kw] = farbe ?? ''; // '' = keine Farbe
    setMeta((m) => ({ ...m, kwBezeichnungen: neuBez, kwFarben: neuFarben }));
    await speichereStatistikMeta({ kwBezeichnungen: neuBez, kwFarben: neuFarben });
  }

  async function speichereLegende(neu: StatistikLegendeEintrag[]) {
    // Gemeinsame Legende: identisch in beiden Feldern persistieren.
    setMeta((m) => ({ ...m, legendeSeiten: neu, legendeBeilagen: neu }));
    await speichereStatistikMeta({ legendeSeiten: neu, legendeBeilagen: neu });
  }

  if (loading) {
    return <div className="p-8 text-center text-gray-400 text-sm">Lade Statistik…</div>;
  }

  return (
    <div className="space-y-4">
      {/* Kopf: Typ-Umschalter + Legende-Button */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 flex flex-wrap items-center gap-3">
        <div className="flex rounded-lg border border-gray-300 overflow-hidden text-sm">
          <button
            onClick={() => setTyp('seiten')}
            className={`px-4 py-2 ${typ === 'seiten' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
          >
            📄 Seitenzahl
          </button>
          <button
            onClick={() => setTyp('beilagen')}
            className={`px-4 py-2 border-l border-gray-300 ${typ === 'beilagen' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
          >
            📦 Beilagensumme
          </button>
        </div>
        <p className="text-xs text-gray-500 flex-1 min-w-[200px]">
          {typ === 'seiten'
            ? 'Seitenzahl je KW. Ab ' + aktuellesJahr + ' aus den App-Ausgaben vorgeschlagen.'
            : 'Verteilte Exemplare (in Tausend) je KW. Ab ' + aktuellesJahr + ' aus den App-Beilagen vorgeschlagen.'}
        </p>
        <button
          onClick={() => setLegendeOffen((o) => !o)}
          className="text-xs font-medium px-3 py-1.5 rounded-lg border border-gray-300 bg-white text-gray-700 hover:border-blue-500 hover:text-blue-700"
        >
          🎨 Legende {legendeOffen ? 'ausblenden' : 'bearbeiten'}
        </button>
      </div>

      {legendeOffen && (
        <LegendeEditor eintraege={legende} onChange={speichereLegende} />
      )}

      {/* Matrix-Tabelle — vertikales + horizontales Scrollen im Container,
          damit Kopfzeile (Jahre) sticky-top und Bezeichnungsspalte sticky-left
          beim Scrollen sichtbar bleiben. */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-auto" style={{ maxHeight: '75vh' }}>
        <table className="text-xs border-separate" style={{ borderSpacing: 0 }}>
          <thead>
            <tr>
              <th className="sticky left-0 top-0 z-30 bg-gray-100 px-2 py-2 text-left font-medium text-gray-600 border-b border-r border-gray-300 whitespace-nowrap" style={{ width: '180px', minWidth: '180px', maxWidth: '180px' }}>
                Bezeichnung
              </th>
              <th className="sticky top-0 z-30 bg-gray-100 px-2 py-2 text-center font-medium text-gray-600 border-b border-gray-300" style={{ left: '180px', width: '50px', minWidth: '50px' }}>
                KW
              </th>
              <th className="sticky top-0 z-20 bg-gray-100 px-2 py-2 text-center font-medium text-gray-600 border-b border-gray-300 whitespace-nowrap" title="Gesamt-Durchschnitt je KW über alle Jahre">
                Ø ges.
              </th>
              <th className="sticky top-0 z-20 bg-gray-100 px-2 py-2 text-center font-medium text-gray-600 border-b border-gray-300 border-r-2 border-r-gray-400 whitespace-nowrap" title="Durchschnitt der letzten 4 Jahre (±1 KW)">
                Ø 4 J. ±1
              </th>
              {jahre.map((j) => (
                <th
                  key={j}
                  className={`sticky top-0 z-20 px-2 py-2 text-center font-semibold border-b border-gray-300 whitespace-nowrap ${
                    j >= aktuellesJahr ? 'bg-blue-50 text-blue-800' : 'bg-gray-100 text-gray-700'
                  }`}
                  style={{ minWidth: '52px' }}
                >
                  {j}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {KWS.map((kw) => {
              const gesamtOe = gesamtDurchschnittJeKW(jahreDaten, kw);
              const vier = durchschnitt4JahreUmKW(jahreDaten, kw, aktuellesJahr + 1);
              return (
                <tr key={kw} className="hover:bg-blue-50/30">
                  <td
                    className="sticky left-0 z-10 bg-white px-2 py-1 border-b border-r border-gray-200 align-top overflow-hidden"
                    style={{
                      width: '180px',
                      minWidth: '180px',
                      maxWidth: '180px',
                      backgroundColor: meta.kwFarben?.[kw] || '#ffffff',
                    }}
                  >
                    <KwBezeichnungZelle
                      kw={kw}
                      wert={meta.kwBezeichnungen[kw] ?? ''}
                      farbe={meta.kwFarben?.[kw] || undefined}
                      legende={legende}
                      open={editBezKw === kw}
                      onOpen={() => setEditBezKw(kw)}
                      onClose={() => setEditBezKw(null)}
                      onSave={(t, f) => speichereKwBezeichnung(kw, t, f)}
                    />
                  </td>
                  <td className="sticky z-10 bg-gray-100 px-2 py-1 text-center font-bold text-gray-700 border-b border-gray-200" style={{ left: '180px', width: '50px', minWidth: '50px' }}>
                    {kw}
                  </td>
                  <td className="px-2 py-1 text-center text-gray-600 border-b border-gray-200 bg-gray-100">
                    {fmtDurchschnitt(gesamtOe)}
                  </td>
                  <td className="px-2 py-1 text-center text-gray-600 border-b border-gray-200 border-r-2 border-r-gray-400 bg-gray-100">
                    {fmtDurchschnitt(vier)}
                  </td>
                  {jahre.map((j) => {
                    const key = `${j}-${kw}`;
                    const zelle = jahrDoc(j)?.zellen?.[kw];
                    const otherZelle = otherJahrDoc(j)?.zellen?.[kw];
                    const wert = zellWert(jahrDoc(j), kw);
                    // Geteilte Felder: aktueller Typ hat Vorrang, sonst Schwester-Doc.
                    const farbe = zelle?.farbe ?? otherZelle?.farbe;
                    const kommentar = zelle?.kommentar ?? otherZelle?.kommentar;
                    const link = zelle?.link ?? otherZelle?.link;
                    const vorschlag =
                      wert == null && j >= aktuellesJahr ? vorschlaege.get(key) ?? null : null;
                    return (
                      <td
                        key={j}
                        className="px-0.5 py-0.5 text-center border-b border-gray-100"
                        style={{ backgroundColor: farbe, position: editKey === key ? 'relative' : undefined }}
                      >
                        {editKey === key ? (
                          <ZellEditor
                            typ={typ}
                            wert={wert}
                            farbe={farbe}
                            kommentar={kommentar}
                            link={link}
                            legende={legende}
                            onSave={(w, f, k, l) => speichereZelle(j, kw, w, f, k, l)}
                            onCancel={() => setEditKey(null)}
                          />
                        ) : (
                          <button
                            type="button"
                            onClick={() => setEditKey(key)}
                            className="relative w-full min-w-[44px] px-1 py-1 text-center hover:ring-1 hover:ring-blue-400 rounded"
                            title={kommentar ? `💬 ${kommentar}` : 'Zum Bearbeiten klicken'}
                          >
                            {wert != null ? (
                              <span className="text-gray-800">{fmtWert(typ, wert)}</span>
                            ) : vorschlag != null ? (
                              <span className="text-blue-400 italic" title="App-Vorschlag — klicken zum Übernehmen">
                                {fmtWert(typ, vorschlag)}*
                              </span>
                            ) : (
                              <span className="text-gray-200">·</span>
                            )}
                            {kommentar && (
                              <span
                                className="absolute top-0 right-0 w-0 h-0 border-t-[6px] border-l-[6px] border-t-red-500 border-l-transparent"
                                aria-label="Kommentar vorhanden"
                              />
                            )}
                            {link && (
                              <a
                                href={link}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                className="absolute bottom-0 left-0 text-[8px] leading-none text-blue-600 hover:text-blue-800"
                                title="Ausgabe-Ordner öffnen"
                                aria-label="Link zur Ausgabe"
                              >
                                🔗
                              </a>
                            )}
                          </button>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}

            {/* Fußzeilen je Jahr: Summe / Ø / Min / Max */}
            <KennzahlenZeile label="Summe" jahre={jahre} jahrDoc={jahrDoc} pick={(k) => k.summe} aktuellesJahr={aktuellesJahr} />
            <KennzahlenZeile label="Ø" jahre={jahre} jahrDoc={jahrDoc} pick={(k) => k.durchschnitt} aktuellesJahr={aktuellesJahr} />
            <KennzahlenZeile label="Min" jahre={jahre} jahrDoc={jahrDoc} pick={(k) => k.min} aktuellesJahr={aktuellesJahr} />
            <KennzahlenZeile label="Max" jahre={jahre} jahrDoc={jahrDoc} pick={(k) => k.max} aktuellesJahr={aktuellesJahr} />
          </tbody>
        </table>
      </div>

      <p className="text-xs text-gray-400">
        <span className="text-blue-400 italic">Wert*</span> = App-Vorschlag (noch nicht übernommen). Zelle anklicken zum Bearbeiten,
        Farbe markieren, Kommentar erfassen oder Vorschlag übernehmen. Ein rotes Eck oben rechts kennzeichnet einen hinterlegten Kommentar (Tooltip beim Überfahren).
      </p>
    </div>
  );
}

// ---- Fußzeile mit Jahres-Kennzahl ---------------------------

function KennzahlenZeile({
  label,
  jahre,
  jahrDoc,
  pick,
  aktuellesJahr,
}: {
  label: string;
  jahre: number[];
  jahrDoc: (jahr: number) => StatistikJahr | undefined;
  pick: (k: ReturnType<typeof jahresKennzahlen>) => number | null;
  aktuellesJahr: number;
}) {
  return (
    <tr className="bg-blue-50 font-semibold text-blue-900">
      <td className="sticky left-0 z-10 bg-blue-50 px-2 py-1.5 text-right border-t-2 border-r border-blue-200" style={{ width: '180px', minWidth: '180px', maxWidth: '180px' }}>
        {label}
      </td>
      <td className="sticky z-10 bg-blue-50 px-2 py-1.5 border-t-2 border-blue-200" style={{ left: '180px', width: '50px', minWidth: '50px' }} />
      <td className="bg-blue-50 px-2 py-1.5 border-t-2 border-blue-200" />
      <td className="bg-blue-50 px-2 py-1.5 border-t-2 border-blue-200 border-r-2 border-r-gray-400" />
      {jahre.map((j) => {
        const v = pick(jahresKennzahlen(jahrDoc(j)));
        return (
          <td key={j} className={`px-2 py-1.5 text-center border-t-2 border-blue-200 ${j >= aktuellesJahr ? 'bg-blue-100' : ''}`}>
            {v == null ? '' : fmtDurchschnitt(v)}
          </td>
        );
      })}
    </tr>
  );
}

// ---- KW-Bezeichnungs-Zelle (inline editierbar) --------------

function KwBezeichnungZelle({
  kw,
  wert,
  farbe,
  legende,
  open,
  onOpen,
  onClose,
  onSave,
}: {
  kw: number;
  wert: string;
  farbe?: string;
  legende: StatistikLegendeEintrag[];
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  onSave: (text: string, farbe?: string) => void;
}) {
  const [val, setVal] = useState(wert);
  const [f, setF] = useState<string | undefined>(farbe);
  useEffect(() => setVal(wert), [wert]);
  useEffect(() => setF(farbe), [farbe]);

  function abbrechen() {
    onClose();
    setVal(wert);
    setF(farbe);
  }
  function speichern() {
    onClose();
    onSave(val, f);
  }

  // Anzeige-Modus
  if (!open) {
    return (
      <button
        type="button"
        onClick={onOpen}
        className="block w-full text-left text-gray-700 hover:text-blue-700 truncate overflow-hidden whitespace-nowrap"
        title={wert ? `${wert} — klicken zum Bearbeiten` : 'Bezeichnung & Farbe bearbeiten'}
      >
        {wert || <span className="text-gray-300">—</span>}
      </button>
    );
  }

  // Editier-Modus: inline in der Zelle (Zeile wächst kurz in der Höhe) —
  // kein Overlay/Popover, damit keine Stacking-/Overflow-Probleme entstehen.
  return (
    <div className="flex flex-col gap-1.5 py-0.5" style={{ whiteSpace: 'normal' }}>
      <input
        autoFocus
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') speichern();
          if (e.key === 'Escape') abbrechen();
        }}
        placeholder={`Bezeichnung KW ${kw}…`}
        className="w-full border border-blue-400 rounded px-1.5 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
      />
      <div className="flex flex-col gap-1">
        <button
          type="button"
          onClick={() => setF(undefined)}
          className={`flex items-center gap-2 px-1.5 py-0.5 rounded border text-left ${f === undefined ? 'ring-2 ring-blue-500 border-blue-300' : 'border-gray-200 hover:border-gray-400'}`}
          title="Keine Farbe"
        >
          <span
            className="inline-block w-4 h-4 rounded border border-gray-300 flex-shrink-0"
            style={{ background: 'repeating-linear-gradient(45deg,#fff,#fff 3px,#eee 3px,#eee 6px)' }}
          />
          <span className="text-[11px] text-gray-500">Keine Farbe</span>
        </button>
        {legende.map((eintrag) => (
          <button
            key={eintrag.id}
            type="button"
            onClick={() => setF(eintrag.farbe)}
            className={`flex items-center gap-2 px-1.5 py-0.5 rounded border text-left ${f === eintrag.farbe ? 'ring-2 ring-blue-500 border-blue-300' : 'border-gray-200 hover:border-gray-400'}`}
            title={eintrag.text}
          >
            <span
              className="inline-block w-4 h-4 rounded border border-gray-300 flex-shrink-0"
              style={{ backgroundColor: eintrag.farbe }}
            />
            <span className="text-[11px] text-gray-700 truncate">{eintrag.text || <em className="text-gray-400">(ohne Text)</em>}</span>
          </button>
        ))}
        {legende.length === 0 && (
          <span className="text-[10px] text-gray-400">Keine Legende angelegt</span>
        )}
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={speichern}
          className="text-[11px] bg-blue-600 text-white px-2 py-0.5 rounded hover:bg-blue-700"
        >
          Speichern
        </button>
        <button type="button" onClick={abbrechen} className="text-[11px] text-gray-500 hover:text-gray-700">
          Abbrechen
        </button>
      </div>
    </div>
  );
}

// ---- Zell-Editor (Wert + Farbe) -----------------------------

function ZellEditor({
  typ,
  wert,
  farbe,
  kommentar,
  link,
  legende,
  onSave,
  onCancel,
}: {
  typ: StatistikTyp;
  wert: number | null;
  farbe?: string;
  kommentar?: string;
  link?: string;
  legende: StatistikLegendeEintrag[];
  onSave: (wert: number | null, farbe?: string, kommentar?: string, link?: string) => void;
  onCancel: () => void;
}) {
  const [val, setVal] = useState(wert == null ? '' : String(wert).replace('.', ','));
  const [f, setF] = useState<string | undefined>(farbe);
  const [k, setK] = useState(kommentar ?? '');
  const [l, setL] = useState(link ?? '');

  function parse(): number | null {
    const t = val.trim().replace(',', '.');
    if (t === '') return null;
    const n = Number(t);
    return Number.isNaN(n) ? null : n;
  }

  return (
    <div className="absolute z-30 mt-1 bg-white border border-gray-300 rounded-lg shadow-lg p-2 flex flex-col gap-2 text-left" style={{ minWidth: '200px' }}>
      <input
        autoFocus
        type="text"
        inputMode="decimal"
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onSave(parse(), f, k, l);
          if (e.key === 'Escape') onCancel();
        }}
        placeholder={typ === 'seiten' ? 'Seiten' : 'Exempl./1000'}
        className="border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
      />
      <div className="flex flex-col gap-1">
        <button
          type="button"
          onClick={() => setF(undefined)}
          className={`flex items-center gap-2 px-1.5 py-0.5 rounded border text-left ${f === undefined ? 'ring-2 ring-blue-500 border-blue-300' : 'border-gray-200 hover:border-gray-400'}`}
          title="Keine Farbe"
        >
          <span
            className="inline-block w-4 h-4 rounded border border-gray-300 flex-shrink-0"
            style={{ background: 'repeating-linear-gradient(45deg,#fff,#fff 3px,#eee 3px,#eee 6px)' }}
          />
          <span className="text-[11px] text-gray-500">Keine Farbe</span>
        </button>
        {legende.map((eintrag) => (
          <button
            key={eintrag.id}
            type="button"
            onClick={() => setF(eintrag.farbe)}
            className={`flex items-center gap-2 px-1.5 py-0.5 rounded border text-left ${f === eintrag.farbe ? 'ring-2 ring-blue-500 border-blue-300' : 'border-gray-200 hover:border-gray-400'}`}
            title={eintrag.text}
          >
            <span
              className="inline-block w-4 h-4 rounded border border-gray-300 flex-shrink-0"
              style={{ backgroundColor: eintrag.farbe }}
            />
            <span className="text-[11px] text-gray-700 truncate">{eintrag.text || <em className="text-gray-400">(ohne Text)</em>}</span>
          </button>
        ))}
        {legende.length === 0 && (
          <span className="text-[10px] text-gray-400">Keine Legende — über „Legende bearbeiten" anlegen</span>
        )}
      </div>
      <textarea
        value={k}
        onChange={(e) => setK(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onCancel();
        }}
        placeholder="Kommentar (optional)…"
        rows={2}
        className="border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 resize-y"
      />
      <div className="flex items-center gap-1">
        <input
          type="url"
          value={l}
          onChange={(e) => setL(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onSave(parse(), f, k, l);
            if (e.key === 'Escape') onCancel();
          }}
          placeholder="Link (z. B. Drive-Ordner)…"
          className="flex-1 border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
        {l.trim() && (
          <a
            href={l}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-blue-600 hover:text-blue-800 px-1"
            title="Link öffnen"
          >
            🔗
          </a>
        )}
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="text-[11px] text-gray-500 hover:text-gray-700">
          Abbrechen
        </button>
        <button
          type="button"
          onClick={() => onSave(parse(), f, k, l)}
          className="text-[11px] bg-blue-600 text-white px-2 py-0.5 rounded hover:bg-blue-700"
        >
          Speichern
        </button>
      </div>
    </div>
  );
}

// ---- Legenden-Editor ----------------------------------------

function LegendeEditor({
  eintraege,
  onChange,
}: {
  eintraege: StatistikLegendeEintrag[];
  onChange: (neu: StatistikLegendeEintrag[]) => void;
}) {
  function update(id: string, patch: Partial<StatistikLegendeEintrag>) {
    onChange(eintraege.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  }
  function add() {
    onChange([...eintraege, { id: crypto.randomUUID(), farbe: '#fde68a', text: '' }]);
  }
  function remove(id: string) {
    onChange(eintraege.filter((e) => e.id !== id));
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-gray-800 text-sm">Legende</h3>
        <button onClick={add} className="text-xs bg-blue-600 text-white px-3 py-1.5 rounded-lg hover:bg-blue-700">
          + Eintrag
        </button>
      </div>
      {eintraege.length === 0 ? (
        <p className="text-xs text-gray-400">Noch keine Farb-Erklärungen.</p>
      ) : (
        <div className="space-y-2">
          {eintraege.map((e) => (
            <div key={e.id} className="flex items-center gap-2">
              <input
                type="color"
                value={e.farbe}
                onChange={(ev) => update(e.id, { farbe: ev.target.value })}
                className="w-8 h-8 rounded border border-gray-300 cursor-pointer p-0.5"
              />
              <input
                type="text"
                value={e.text}
                onChange={(ev) => update(e.id, { text: ev.target.value })}
                placeholder="Erklärung der Markierung…"
                className="flex-1 border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              <button onClick={() => remove(e.id)} className="text-red-500 hover:text-red-700 text-sm px-2">
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
