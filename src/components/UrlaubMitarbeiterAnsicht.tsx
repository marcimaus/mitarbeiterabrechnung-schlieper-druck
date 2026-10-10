// ============================================================
// Urlaub — Ansicht für angemeldete Mitarbeiter
// ============================================================
//
// Der Mitarbeiter sieht seine eigenen Urlaube (Vorbelegung: aktuelles
// Jahr) hervorgehoben neben den Urlauben ausgewählter Kollegen — als
// Wochenraster mit einzelnen Werktagen. Daran entscheidet er, wann er
// Urlaub beantragt. Die Kollegen-Auswahl wird je Mitarbeiter gespeichert.
//
// Schreibrechte: ausschließlich eigene Anträge (freigegeben=false), die
// er bis zur Freigabe ändern oder zurückziehen darf. Urlaube anderer
// Mitarbeiter sind nur lesbar — Kommentare/Links werden nicht gezeigt.

import { useEffect, useMemo, useState } from 'react';
import Modal from './Modal';
import UrlaubVergleichDruck from './UrlaubVergleichDruck';
import { useApp } from '../context/AppContext';
import {
  urlaubsListener,
  urlaubsListenerProMa,
  setzeUrlaubsGruppe,
  loescheUrlaubsGruppe,
  urlaubVergleichAuswahlListener,
  speichereUrlaubVergleichAuswahl,
} from '../lib/planung';
import { alleKWsImJahr, getCurrentKW, MONATSNAMEN } from '../lib/kalender';
import { feiertageInKw, ferienInKw, setzeFerienkalender } from '../lib/ferien';
import { ferienkalenderListener } from '../lib/ferienkalender';
import {
  bisAusWerktage,
  fmtZeitraum,
  gruppiereUrlaube,
  isoFromDate,
  monatDerKw,
  monatsSpannen,
  urlaubWochenAusBereich,
  urlaubsTageJeMa,
  werktageDerKw,
  zaehleWerktage,
  type UrlaubGruppe,
  type UrlaubTagStatus,
} from '../lib/urlaub';
import type { Mitarbeiter, UrlaubsEintrag } from '../types';

const WOCHENTAG = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];

/** Farben der Tagessegmente — eigene Urlaube blau, Kollegen orange. */
const FARBE = {
  eigen: { genehmigt: '#2563eb', beantragt: 'repeating-linear-gradient(135deg,#93c5fd 0 2px,#dbeafe 2px 4px)' },
  kollege: { genehmigt: '#f59e0b', beantragt: 'repeating-linear-gradient(135deg,#fcd34d 0 2px,#fef3c7 2px 4px)' },
  feiertag: '#9ca3af',
  leer: '#f3f4f6',
};

function tagLabel(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  return `${WOCHENTAG[d.getDay()]} ${d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })}`;
}

export default function UrlaubMitarbeiterAnsicht() {
  const { mitarbeiter, mitarbeiterId } = useApp();
  const ich = mitarbeiter.find((m) => m.id === mitarbeiterId);
  const heute = getCurrentKW();
  const heuteIso = isoFromDate(new Date());

  // ---- Zeitraum: Jahr + Monate (Vorbelegung: aktuelles Jahr komplett) ----
  const [jahr, setJahr] = useState(heute.jahr);
  const [monatVon, setMonatVon] = useState(1);
  const [monatBis, setMonatBis] = useState(12);
  const kws = useMemo(
    () => alleKWsImJahr(jahr).filter((kw) => {
      const m = monatDerKw(jahr, kw);
      return m >= monatVon && m <= monatBis;
    }),
    [jahr, monatVon, monatBis],
  );
  const zeitraumTage = useMemo(() => new Set(kws.flatMap((kw) => werktageDerKw(jahr, kw))), [jahr, kws]);

  // ---- Daten ----
  // Mit Jahr gespeichert, damit nach einem Jahreswechsel nicht kurz die
  // Daten des alten Jahres erscheinen (null = lädt).
  const [jahrDaten, setJahrDaten] = useState<{ jahr: number; liste: UrlaubsEintrag[] } | null>(null);
  useEffect(() => urlaubsListener(jahr, (liste) => setJahrDaten({ jahr, liste })), [jahr]);
  const eintraegeJahr = jahrDaten?.jahr === jahr ? jahrDaten.liste : null;
  // Eigene Einträge jahresübergreifend — für den Konfliktcheck beim Antrag
  // (Urlaub über den Jahreswechsel).
  const [eigeneAlle, setEigeneAlle] = useState<UrlaubsEintrag[]>([]);
  useEffect(() => {
    if (!mitarbeiterId) return;
    return urlaubsListenerProMa(mitarbeiterId, setEigeneAlle);
  }, [mitarbeiterId]);
  // Feiertage/Schulferien (gepflegter Kalender, sonst eingebaute Vorlage).
  const [, setFerienStand] = useState(0);
  useEffect(
    () => ferienkalenderListener((list) => {
      setzeFerienkalender(list);
      setFerienStand((v) => v + 1);
    }),
    [],
  );

  // ---- Kollegen + gemerkte Auswahl ----
  // Wie die Urlaubs-Sektion der Personalplanung: aktive MAs mit Rolle
  // „Sonstige", die dort nicht ausgeblendet sind.
  const kollegen = useMemo(
    () => mitarbeiter
      .filter((m) =>
        m.id !== mitarbeiterId &&
        m.isActive && !m.istInteressent &&
        m.rollen.includes('sonstige') &&
        !m.urlaubsplanungAusgeblendet,
      )
      .sort((a, b) => {
        const aHas = a.sortierungUrlaub !== undefined;
        const bHas = b.sortierungUrlaub !== undefined;
        if (aHas && bHas) return a.sortierungUrlaub! - b.sortierungUrlaub!;
        if (aHas) return -1;
        if (bHas) return 1;
        return a.name.localeCompare(b.name, 'de');
      }),
    [mitarbeiter, mitarbeiterId],
  );
  // undefined = lädt, null = noch nie gespeichert (→ alle Kollegen)
  const [gespeicherteAuswahl, setGespeicherteAuswahl] = useState<string[] | null | undefined>(undefined);
  useEffect(() => {
    if (!mitarbeiterId) return;
    return urlaubVergleichAuswahlListener(mitarbeiterId, setGespeicherteAuswahl);
  }, [mitarbeiterId]);
  const ausgewaehlt = useMemo(() => {
    if (gespeicherteAuswahl == null) return kollegen;
    const ids = new Set(gespeicherteAuswahl);
    return kollegen.filter((k) => ids.has(k.id));
  }, [kollegen, gespeicherteAuswahl]);
  const [auswahlOffen, setAuswahlOffen] = useState(false);

  async function setzeAuswahl(ids: string[]) {
    if (!mitarbeiterId) return;
    setGespeicherteAuswahl(ids);
    await speichereUrlaubVergleichAuswahl(mitarbeiterId, ids);
  }

  // ---- Abgeleitete Daten ----
  const tageJeMa = useMemo(() => urlaubsTageJeMa(eintraegeJahr ?? []), [eintraegeJahr]);
  const eigeneTage = useMemo(
    () => (mitarbeiterId && tageJeMa.get(mitarbeiterId)) || new Map<string, UrlaubTagStatus>(),
    [tageJeMa, mitarbeiterId],
  );
  const eigeneGruppen = useMemo(
    () => gruppiereUrlaube(eigeneAlle).filter((g) => g.werktage.some((d) => zeitraumTage.has(d))),
    [eigeneAlle, zeitraumTage],
  );
  const kollegenGruppen = useMemo(() => {
    const ids = new Set(ausgewaehlt.map((k) => k.id));
    return gruppiereUrlaube((eintraegeJahr ?? []).filter((e) => ids.has(e.mitarbeiterId)))
      .filter((g) => g.werktage.some((d) => zeitraumTage.has(d)));
  }, [eintraegeJahr, ausgewaehlt, zeitraumTage]);

  const summeEigen = useMemo(() => {
    let genehmigt = 0;
    let beantragt = 0;
    for (const [d, s] of eigeneTage) {
      if (!zeitraumTage.has(d)) continue;
      if (s === 'genehmigt') genehmigt++;
      else beantragt++;
    }
    return { genehmigt, beantragt };
  }, [eigeneTage, zeitraumTage]);

  // ---- Antrag-Dialog ----
  const [antrag, setAntrag] = useState<{ gruppe?: UrlaubGruppe; von?: string; bis?: string } | null>(null);
  const [druckOffen, setDruckOffen] = useState(false);

  function klickEigeneKw(kw: number) {
    const tage = werktageDerKw(jahr, kw);
    const gruppe = eigeneGruppen.find((g) => g.werktage.some((d) => tage.includes(d)));
    if (gruppe) {
      setAntrag({ gruppe });
      return;
    }
    const zukunft = tage.filter((d) => d >= heuteIso);
    if (zukunft.length === 0) return;
    setAntrag({ von: zukunft[0], bis: tage[4] });
  }

  if (!ich) {
    return (
      <div className="p-6 text-sm text-gray-500 italic">Mitarbeiter-Datensatz nicht gefunden.</div>
    );
  }

  const jahre = [heute.jahr - 1, heute.jahr, heute.jahr + 1];
  const zeitraumText = monatVon === 1 && monatBis === 12
    ? `${jahr}`
    : `${MONATSNAMEN[monatVon - 1]}${monatVon !== monatBis ? ` – ${MONATSNAMEN[monatBis - 1]}` : ''} ${jahr}`;

  return (
    <div className="p-3 md:p-5 max-w-7xl mx-auto">
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[220px]">
          <h1 className="text-xl md:text-2xl font-bold text-gray-900">Mein Urlaub</h1>
          <p className="text-xs text-gray-500">
            Deine Urlaube (blau) neben den Urlauben deiner Kollegen (orange). Neue Anträge werden von der
            Verwaltung freigegeben.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setAntrag({})}
          className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-3 py-2 rounded-lg"
        >
          + Urlaub beantragen
        </button>
      </div>

      {/* Zeitraum + Kollegen-Auswahl + Druck */}
      <div className="bg-white border border-gray-200 rounded-lg p-3 mb-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Jahr</label>
          <select
            value={jahr}
            onChange={(e) => setJahr(Number(e.target.value))}
            className="border border-gray-300 rounded px-2 py-1.5 text-sm"
          >
            {jahre.map((j) => <option key={j} value={j}>{j}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Zeitraum von</label>
          <select
            value={monatVon}
            onChange={(e) => {
              const v = Number(e.target.value);
              setMonatVon(v);
              if (monatBis < v) setMonatBis(v);
            }}
            className="border border-gray-300 rounded px-2 py-1.5 text-sm"
          >
            {MONATSNAMEN.map((n, i) => <option key={n} value={i + 1}>{n}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">bis</label>
          <select
            value={monatBis}
            onChange={(e) => {
              const v = Number(e.target.value);
              setMonatBis(v);
              if (monatVon > v) setMonatVon(v);
            }}
            className="border border-gray-300 rounded px-2 py-1.5 text-sm"
          >
            {MONATSNAMEN.map((n, i) => <option key={n} value={i + 1}>{n}</option>)}
          </select>
        </div>
        <div className="flex-1 min-w-[200px]">
          <label className="block text-xs font-medium text-gray-600 mb-1">Kollegen im Vergleich</label>
          <button
            type="button"
            onClick={() => setAuswahlOffen(true)}
            className="w-full text-left border border-gray-300 rounded px-2 py-1.5 text-sm hover:border-blue-400 truncate"
            title="Auswählen, wessen Urlaube neben deinen angezeigt werden"
          >
            {ausgewaehlt.length === kollegen.length
              ? `alle (${kollegen.length})`
              : ausgewaehlt.length === 0
                ? 'keine ausgewählt'
                : `${ausgewaehlt.length} von ${kollegen.length}: ${ausgewaehlt.map((k) => k.name.split(' ')[0]).join(', ')}`}
            <span className="float-right text-blue-600 text-xs">ändern ›</span>
          </button>
        </div>
        <button
          type="button"
          onClick={() => setDruckOffen(true)}
          disabled={eintraegeJahr === null}
          className="bg-white border border-gray-300 text-gray-700 px-3 py-1.5 rounded text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
          title="Deine Urlaube und die der ausgewählten Kollegen im gewählten Zeitraum drucken"
        >
          🖨️ Drucken
        </button>
      </div>

      {/* Raster */}
      {eintraegeJahr === null ? (
        <div className="bg-white border border-gray-200 rounded-lg p-6 text-sm text-gray-500 italic">Lade Urlaubsdaten…</div>
      ) : (
        <UrlaubRaster
          jahr={jahr}
          kws={kws}
          ich={ich}
          kollegen={ausgewaehlt}
          tageJeMa={tageJeMa}
          heute={heute}
          onKlickEigeneKw={klickEigeneKw}
        />
      )}

      {/* Meine Urlaube */}
      <div className="mt-4 bg-white border border-gray-200 rounded-lg overflow-hidden">
        <div className="px-3 py-2 bg-blue-50 border-b border-blue-100 flex flex-wrap items-baseline gap-x-3">
          <h2 className="text-sm font-semibold text-blue-900">Meine Urlaube — {zeitraumText}</h2>
          <span className="text-xs text-blue-800">
            {summeEigen.genehmigt} Werktag(e) genehmigt
            {summeEigen.beantragt > 0 && ` · ${summeEigen.beantragt} beantragt`}
          </span>
        </div>
        {eigeneGruppen.length === 0 ? (
          <div className="px-3 py-4 text-sm text-gray-500 italic">Keine Urlaube im gewählten Zeitraum.</div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {eigeneGruppen.map((g) => (
              <li key={g.key} className="px-3 py-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                <span className="font-medium text-gray-900 whitespace-nowrap">{fmtZeitraum(g.datumVon, g.datumBis)}</span>
                <span className="text-xs text-gray-600">{g.werktage.length} Werktag{g.werktage.length === 1 ? '' : 'e'}</span>
                {g.alleFreigegeben ? (
                  <span className="text-xs px-1.5 py-0.5 rounded bg-green-100 text-green-800">✓ genehmigt</span>
                ) : g.keinerFreigegeben ? (
                  <span className="text-xs px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">⏳ beantragt</span>
                ) : (
                  <span className="text-xs px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">⏳ teilweise genehmigt</span>
                )}
                {g.kommentar && <span className="text-xs text-gray-500 truncate max-w-xs" title={g.kommentar}>💬 {g.kommentar}</span>}
                <button
                  type="button"
                  onClick={() => setAntrag({ gruppe: g })}
                  className="ml-auto text-xs text-blue-600 hover:underline"
                >
                  {g.keinerFreigegeben && g.eintraege.every((e) => e.erstellerRolle === 'mitarbeiter')
                    ? 'Ändern / zurückziehen ›'
                    : 'Details ›'}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Kollegen-Urlaube als Liste */}
      {ausgewaehlt.length > 0 && (
        <details className="mt-4 bg-white border border-gray-200 rounded-lg overflow-hidden">
          <summary className="px-3 py-2 bg-amber-50 border-b border-amber-100 text-sm font-semibold text-amber-900 cursor-pointer">
            Urlaube der ausgewählten Kollegen — {zeitraumText} ({kollegenGruppen.length})
          </summary>
          {kollegenGruppen.length === 0 ? (
            <div className="px-3 py-4 text-sm text-gray-500 italic">Keine Urlaube im gewählten Zeitraum.</div>
          ) : (
            <ul className="divide-y divide-gray-100">
              {kollegenGruppen.map((g) => (
                <li key={g.key} className="px-3 py-1.5 flex flex-wrap items-center gap-x-3 text-sm">
                  <span className="w-40 truncate font-medium text-gray-800">
                    {mitarbeiter.find((m) => m.id === g.mitarbeiterId)?.name ?? '?'}
                  </span>
                  <span className="whitespace-nowrap">{fmtZeitraum(g.datumVon, g.datumBis)}</span>
                  <span className="text-xs text-gray-600">{g.werktage.length} Werktag{g.werktage.length === 1 ? '' : 'e'}</span>
                  {!g.alleFreigegeben && <span className="text-xs text-amber-700">⏳ beantragt</span>}
                </li>
              ))}
            </ul>
          )}
        </details>
      )}

      {auswahlOffen && (
        <KollegenAuswahlModal
          kollegen={kollegen}
          ausgewaehlteIds={ausgewaehlt.map((k) => k.id)}
          onSpeichern={(ids) => { void setzeAuswahl(ids); setAuswahlOffen(false); }}
          onClose={() => setAuswahlOffen(false)}
        />
      )}

      {antrag && (
        <UrlaubAntragModal
          ich={ich}
          gruppe={antrag.gruppe}
          vorgabeVon={antrag.von}
          vorgabeBis={antrag.bis}
          eigeneAlle={eigeneAlle}
          kollegen={ausgewaehlt}
          kollegenEintraege={eintraegeJahr ?? []}
          heuteIso={heuteIso}
          onClose={() => setAntrag(null)}
        />
      )}

      {druckOffen && (
        <UrlaubVergleichDruck
          jahr={jahr}
          kws={kws}
          zeitraumText={zeitraumText}
          ich={ich}
          kollegen={ausgewaehlt}
          eintraege={eintraegeJahr ?? []}
          onClose={() => setDruckOffen(false)}
        />
      )}
    </div>
  );
}

// ============================================================
// Wochenraster: je KW fünf Tagessegmente (Mo–Fr)
// ============================================================

function UrlaubRaster({
  jahr,
  kws,
  ich,
  kollegen,
  tageJeMa,
  heute,
  onKlickEigeneKw,
}: {
  jahr: number;
  kws: number[];
  ich: Mitarbeiter;
  kollegen: Mitarbeiter[];
  tageJeMa: Map<string, Map<string, UrlaubTagStatus>>;
  heute: { jahr: number; kw: number };
  onKlickEigeneKw: (kw: number) => void;
}) {
  const spannen = monatsSpannen(jahr, kws);
  const eigene = tageJeMa.get(ich.id) ?? new Map<string, UrlaubTagStatus>();
  const feiertageJeKw = new Map(kws.map((kw) => [kw, feiertageInKw(jahr, kw)]));

  const istAktuell = (kw: number) => jahr === heute.jahr && kw === heute.kw;
  const kwCls = (kw: number) => `px-[2px] ${istAktuell(kw) ? 'bg-blue-50' : ''}`;

  function segmente(maId: string, kw: number, art: 'eigen' | 'kollege') {
    const tage = tageJeMa.get(maId);
    const feiertage = feiertageJeKw.get(kw) ?? [];
    const tageKw = werktageDerKw(jahr, kw);
    const urlaubTage = tageKw.filter((d) => tage?.has(d));
    const titel =
      `KW ${kw}: ` +
      (urlaubTage.length === 0
        ? 'kein Urlaub'
        : urlaubTage.map((d) => `${tagLabel(d)}${tage!.get(d) === 'beantragt' ? ' (beantragt)' : ''}`).join(', '));
    return (
      <div className="flex gap-px h-4" title={titel}>
        {tageKw.map((d) => {
          const s = tage?.get(d);
          const feiertag = feiertage.find((f) => f.datum === d);
          const ueberschneidung = art === 'kollege' && s && eigene.has(d);
          return (
            <div
              key={d}
              className="flex-1 rounded-[1px]"
              style={{
                background: s ? FARBE[art][s] : feiertag ? FARBE.feiertag : FARBE.leer,
                boxShadow: ueberschneidung ? 'inset 0 0 0 1px #dc2626' : undefined,
              }}
            />
          );
        })}
      </div>
    );
  }

  return (
    <div className="bg-white border border-gray-200 rounded-lg overflow-x-auto">
      {/* Volle Breite; auf schmalen Bildschirmen mind. 16 px je KW →
          horizontal scrollen, Namensspalte bleibt stehen. */}
      <table
        className="border-collapse text-[11px]"
        style={{ tableLayout: 'fixed', width: '100%', minWidth: 120 + kws.length * 16 }}
      >
        <colgroup>
          <col style={{ width: 120 }} />
          {kws.map((kw) => <col key={kw} />)}
        </colgroup>
        <thead>
          <tr>
            <th className="sticky left-0 z-10 bg-white" />
            {spannen.map((s, i) => (
              <th
                key={`${s.monat}-${i}`}
                colSpan={s.anzahl}
                className="text-left font-semibold text-gray-700 px-1 pt-1.5 border-l border-gray-200 truncate"
              >
                {MONATSNAMEN[s.monat - 1]}
              </th>
            ))}
          </tr>
          <tr className="border-b border-gray-200">
            <th className="sticky left-0 z-10 bg-white text-left px-2 py-1 font-medium text-gray-500">KW</th>
            {kws.map((kw) => (
              <th
                key={kw}
                className={`py-1 text-center font-mono font-normal ${istAktuell(kw) ? 'bg-blue-100 text-blue-800 font-semibold' : 'text-gray-500'}`}
              >
                {kw}
              </th>
            ))}
          </tr>
          <tr className="border-b border-gray-100">
            <th className="sticky left-0 z-10 bg-white text-left px-2 py-0.5 font-normal text-gray-400">Feiertage / Ferien</th>
            {kws.map((kw) => {
              const fe = feiertageJeKw.get(kw) ?? [];
              const fer = ferienInKw(jahr, kw);
              const tip = [
                ...fe.map((f) => `Feiertag: ${f.name} (${tagLabel(f.datum)})`),
                ...fer.map((f) => `Schulferien: ${f.name}`),
              ].join('\n');
              return (
                <td key={kw} className={`${kwCls(kw)} text-center leading-none`} title={tip || undefined}>
                  {fe.length > 0 && <span className="text-red-600">●</span>}
                  {fer.length > 0 && <span className="text-purple-500">▬</span>}
                </td>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {/* Eigene Zeile — hervorgehoben, klickbar */}
          <tr className="bg-blue-50 border-y-2 border-blue-300">
            <td className="sticky left-0 z-10 bg-blue-50 px-2 py-1.5 font-bold text-blue-900 truncate">
              ★ {ich.name}
            </td>
            {kws.map((kw) => (
              <td key={kw} className={`${kwCls(kw)} py-1.5 cursor-pointer hover:bg-blue-100`} onClick={() => onKlickEigeneKw(kw)}>
                {segmente(ich.id, kw, 'eigen')}
              </td>
            ))}
          </tr>
          {kollegen.map((k) => (
            <tr key={k.id} className="border-b border-gray-100">
              <td className="sticky left-0 z-10 bg-white px-2 py-1 text-gray-800 truncate" title={k.name}>{k.name}</td>
              {kws.map((kw) => (
                <td key={kw} className={`${kwCls(kw)} py-1`}>
                  {segmente(k.id, kw, 'kollege')}
                </td>
              ))}
            </tr>
          ))}
          {/* Zusammenfassung: wie viele der ausgewählten Kollegen sind in der KW weg? */}
          {kollegen.length > 0 && (
            <tr className="border-t-2 border-gray-200">
              <td className="sticky left-0 z-10 bg-white px-2 py-1 text-gray-600 font-medium">Kollegen im Urlaub</td>
              {kws.map((kw) => {
                const tageKw = werktageDerKw(jahr, kw);
                const weg = kollegen.filter((k) => tageKw.some((d) => tageJeMa.get(k.id)?.has(d)));
                const konflikt = weg.some((k) => tageKw.some((d) => eigene.has(d) && tageJeMa.get(k.id)?.has(d)));
                const cls = weg.length === 0
                  ? 'text-green-600'
                  : konflikt
                    ? 'bg-red-100 text-red-700 font-bold'
                    : 'bg-amber-50 text-amber-800 font-semibold';
                return (
                  <td
                    key={kw}
                    className={`text-center py-1 ${cls}`}
                    title={weg.length === 0 ? `KW ${kw}: niemand der Ausgewählten im Urlaub` : `KW ${kw}: ${weg.map((k) => k.name).join(', ')}`}
                  >
                    {weg.length === 0 ? '·' : weg.length}
                  </td>
                );
              })}
            </tr>
          )}
        </tbody>
      </table>
      <div className="px-3 py-2 border-t border-gray-100 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-gray-600">
        <Legende farbe={FARBE.eigen.genehmigt}>mein Urlaub (genehmigt)</Legende>
        <Legende farbe={FARBE.eigen.beantragt}>mein Urlaub (beantragt)</Legende>
        <Legende farbe={FARBE.kollege.genehmigt}>Kollegen</Legende>
        <Legende farbe={FARBE.kollege.beantragt}>Kollegen (beantragt)</Legende>
        <Legende farbe={FARBE.feiertag}>Feiertag</Legende>
        <span><span className="inline-block w-3 h-3 align-middle mr-1 rounded-sm" style={{ background: FARBE.kollege.genehmigt, boxShadow: 'inset 0 0 0 1px #dc2626' }} />Überschneidung mit deinem Urlaub</span>
        <span className="text-gray-500">Klick in deine Zeile: Urlaub in dieser KW beantragen bzw. ansehen.</span>
      </div>
    </div>
  );
}

function Legende({ farbe, children }: { farbe: string; children: React.ReactNode }) {
  return (
    <span>
      <span className="inline-block w-3 h-3 align-middle mr-1 rounded-sm" style={{ background: farbe }} />
      {children}
    </span>
  );
}

// ============================================================
// Kollegen-Auswahl
// ============================================================

function KollegenAuswahlModal({
  kollegen,
  ausgewaehlteIds,
  onSpeichern,
  onClose,
}: {
  kollegen: Mitarbeiter[];
  ausgewaehlteIds: string[];
  onSpeichern: (ids: string[]) => void;
  onClose: () => void;
}) {
  const [ids, setIds] = useState(new Set(ausgewaehlteIds));
  const toggle = (id: string) =>
    setIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <Modal isOpen={true} onClose={onClose} title="Kollegen im Vergleich" size="md">
      <p className="text-xs text-gray-500 mb-3">
        Wähle die Kollegen, deren Urlaube für dich relevant sind. Die Auswahl wird gespeichert.
      </p>
      <div className="flex gap-2 mb-2 text-xs">
        <button type="button" onClick={() => setIds(new Set(kollegen.map((k) => k.id)))} className="text-blue-600 hover:underline">alle</button>
        <button type="button" onClick={() => setIds(new Set())} className="text-blue-600 hover:underline">keine</button>
      </div>
      <div className="max-h-80 overflow-y-auto border border-gray-200 rounded divide-y divide-gray-100">
        {kollegen.length === 0 ? (
          <div className="px-3 py-3 text-sm text-gray-500 italic">Keine Kollegen in der Urlaubsplanung.</div>
        ) : kollegen.map((k) => (
          <label key={k.id} className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-gray-50 cursor-pointer">
            <input type="checkbox" checked={ids.has(k.id)} onChange={() => toggle(k.id)} />
            {k.name}
          </label>
        ))}
      </div>
      <div className="flex justify-end gap-2 pt-3">
        <button type="button" onClick={onClose} className="text-sm text-gray-500 px-3 py-1.5">Abbrechen</button>
        <button
          type="button"
          onClick={() => onSpeichern(kollegen.filter((k) => ids.has(k.id)).map((k) => k.id))}
          className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-3 py-1.5 rounded"
        >
          Übernehmen
        </button>
      </div>
    </Modal>
  );
}

// ============================================================
// Urlaubsantrag (nur für sich selbst)
// ============================================================

function UrlaubAntragModal({
  ich,
  gruppe,
  vorgabeVon,
  vorgabeBis,
  eigeneAlle,
  kollegen,
  kollegenEintraege,
  heuteIso,
  onClose,
}: {
  ich: Mitarbeiter;
  /** Bestehender eigener Urlaub — bearbeiten (solange nicht freigegeben) oder ansehen. */
  gruppe?: UrlaubGruppe;
  vorgabeVon?: string;
  vorgabeBis?: string;
  eigeneAlle: UrlaubsEintrag[];
  kollegen: Mitarbeiter[];
  kollegenEintraege: UrlaubsEintrag[];
  heuteIso: string;
  onClose: () => void;
}) {
  // Ändern/Zurückziehen nur bei eigenen, noch nicht (auch nicht teilweise)
  // freigegebenen Anträgen. Von der Verwaltung eingetragene Urlaube bleiben
  // für den Mitarbeiter gesperrt.
  const vonVerwaltung = !!gruppe && gruppe.eintraege.some((e) => e.erstellerRolle !== 'mitarbeiter');
  const nurLesen = !!gruppe && (!gruppe.keinerFreigegeben || vonVerwaltung);
  const [datumVon, setDatumVon] = useState(gruppe?.datumVon ?? vorgabeVon ?? '');
  const [datumBis, setDatumBis] = useState(gruppe?.datumBis ?? vorgabeBis ?? '');
  const [kommentar, setKommentar] = useState(gruppe?.kommentar ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const bisEff = datumBis || datumVon;
  const wochen = useMemo(() => urlaubWochenAusBereich(datumVon, bisEff), [datumVon, bisEff]);
  const alleTage = useMemo(() => wochen.flatMap((w) => w.werktageInKw), [wochen]);

  // Eigene Urlaube in denselben KWs, die NICHT zu diesem Antrag gehören —
  // je Mitarbeiter und KW gibt es nur einen Datensatz.
  const eigeneGruppeIds = new Set(gruppe?.eintraege.map((e) => e.id) ?? []);
  const kwKonflikte = eigeneAlle.filter(
    (e) => !eigeneGruppeIds.has(e.id) && wochen.some((w) => w.jahr === e.jahr && w.kw === e.kw),
  );

  // Gleichzeitig abwesende Kollegen (aus der Auswahl).
  const tageSet = new Set(alleTage);
  const kollegenTage = urlaubsTageJeMa(kollegenEintraege);
  const gleichzeitig = kollegen
    .map((k) => ({ k, tage: [...(kollegenTage.get(k.id)?.keys() ?? [])].filter((d) => tageSet.has(d)).sort() }))
    .filter((x) => x.tage.length > 0);

  async function speichern() {
    setError(null);
    if (!datumVon) return setError('Bitte „Datum von" angeben.');
    if (bisEff < datumVon) return setError('„Datum bis" liegt vor „Datum von".');
    if (datumVon < heuteIso && !gruppe) return setError('Urlaub kann nur ab heute beantragt werden.');
    if (wochen.length === 0) return setError('Im Zeitraum liegt kein Werktag (Mo–Fr).');
    if (kwKonflikte.length > 0) {
      const k = kwKonflikte[0];
      return setError(
        `In KW ${k.kw}/${k.jahr} ist bereits Urlaub eingetragen (${fmtZeitraum(k.datumVon ?? '', k.datumBis ?? '')}). ` +
          'Bitte diesen Urlaub anpassen oder die Verwaltung ansprechen.',
      );
    }
    setSaving(true);
    try {
      await setzeUrlaubsGruppe(ich.id, wochen, {
        datumVon,
        datumBis: bisEff,
        kommentar: kommentar.trim() || undefined,
        erstellerName: ich.name,
        erstellerRolle: 'mitarbeiter',
        altDatumVon: gruppe?.datumVon,
        altDatumBis: gruppe?.datumBis,
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Speichern fehlgeschlagen.');
    } finally {
      setSaving(false);
    }
  }

  async function zurueckziehen() {
    if (!gruppe || nurLesen) return;
    if (!confirm(`Urlaubsantrag ${fmtZeitraum(gruppe.datumVon, gruppe.datumBis)} wirklich zurückziehen?`)) return;
    setSaving(true);
    try {
      await loescheUrlaubsGruppe(ich.id, gruppe.datumVon, gruppe.datumBis);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Zurückziehen fehlgeschlagen.');
    } finally {
      setSaving(false);
    }
  }

  const titel = !gruppe ? 'Urlaub beantragen' : nurLesen ? 'Mein Urlaub' : 'Urlaubsantrag ändern';

  return (
    <Modal isOpen={true} onClose={onClose} title={titel} size="md">
      <div className="space-y-3 text-sm">
        {nurLesen && (
          <div className="rounded-lg border border-green-200 bg-green-50 p-2 text-xs text-green-800">
            {gruppe!.alleFreigegeben ? '✓ Genehmigt' : gruppe!.keinerFreigegeben ? '⏳ Von der Verwaltung eingetragen, noch nicht freigegeben' : '⏳ Teilweise genehmigt'}
            {' '}— Änderungen bitte über die Verwaltung.
          </div>
        )}
        {gruppe && !nurLesen && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
            ⏳ Beantragt — noch nicht genehmigt. Du kannst den Antrag bis zur Freigabe ändern oder zurückziehen.
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Datum von</label>
            <input
              type="date"
              value={datumVon}
              min={gruppe ? undefined : heuteIso}
              onChange={(e) => setDatumVon(e.target.value)}
              disabled={nurLesen}
              className="w-full border border-gray-300 rounded px-2 py-1.5"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Datum bis</label>
            <input
              type="date"
              value={datumBis}
              min={datumVon || undefined}
              onChange={(e) => setDatumBis(e.target.value)}
              disabled={nurLesen}
              className="w-full border border-gray-300 rounded px-2 py-1.5"
            />
          </div>
        </div>
        {!nurLesen && (
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-600">… oder Anzahl Werktage:</label>
            <input
              type="number"
              min={1}
              value={zaehleWerktage(datumVon, bisEff) || ''}
              onChange={(e) => {
                const n = parseInt(e.target.value, 10);
                if (!datumVon || isNaN(n) || n < 1) return;
                setDatumBis(bisAusWerktage(datumVon, n));
              }}
              disabled={!datumVon}
              className="w-20 border border-gray-300 rounded px-2 py-1"
            />
          </div>
        )}

        {wochen.length > 0 && (
          <div className="rounded-lg border border-blue-200 bg-blue-50 p-2 text-xs text-blue-900">
            <strong>{alleTage.length} Werktag{alleTage.length === 1 ? '' : 'e'}</strong>
            {' · '}
            {wochen.map((w) => `KW ${w.kw}: ${w.werktageInKw.length}`).join(' · ')}
            {(() => {
              const fe = wochen.flatMap((w) => feiertageInKw(w.jahr, w.kw)).filter((f) => tageSet.has(f.datum));
              return fe.length > 0 ? (
                <div className="mt-1 text-blue-800">
                  Feiertag im Zeitraum: {fe.map((f) => `${f.name} (${tagLabel(f.datum)})`).join(', ')}
                </div>
              ) : null;
            })()}
          </div>
        )}

        {gleichzeitig.length > 0 && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
            <div className="font-semibold mb-0.5">Gleichzeitig im Urlaub:</div>
            <ul className="space-y-0.5">
              {gleichzeitig.map(({ k, tage }) => (
                <li key={k.id}>
                  {k.name}: {tage.length === 1 ? tagLabel(tage[0]) : `${tagLabel(tage[0])} – ${tagLabel(tage[tage.length - 1])} (${tage.length} Tage)`}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Bemerkung an die Verwaltung (optional)</label>
          <textarea
            value={kommentar}
            onChange={(e) => setKommentar(e.target.value)}
            disabled={nurLesen}
            rows={2}
            className="w-full border border-gray-300 rounded px-2 py-1.5"
          />
        </div>

        {error && <p className="text-red-600 text-sm">{error}</p>}

        <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-gray-100">
          {!nurLesen && (
            <button
              type="button"
              onClick={speichern}
              disabled={saving}
              className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white font-medium px-3 py-1.5 rounded"
            >
              {saving ? 'Speichert…' : gruppe ? 'Antrag speichern' : 'Beantragen'}
            </button>
          )}
          {gruppe && !nurLesen && (
            <button type="button" onClick={zurueckziehen} disabled={saving} className="text-red-600 hover:text-red-700 px-2">
              Antrag zurückziehen
            </button>
          )}
          <button type="button" onClick={onClose} className="ml-auto text-gray-500 hover:text-gray-700 px-2">
            Schließen
          </button>
        </div>
      </div>
    </Modal>
  );
}
