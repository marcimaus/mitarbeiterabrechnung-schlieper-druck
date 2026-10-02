// Teilgebiet auswerten — Gebietsbeschreibung + Verdienstmöglichkeiten
// ------------------------------------------------------------
// Bereich der Abrechnungsvorschau, um Interessenten ein Teilgebiet zu
// beschreiben: Stammdaten (Stückzahl, Wegstrecke, Straßenliste,
// Sonderauslagen, Nicht-beliefern-Adressen) plus Verdienst je Ausgabe und
// im Durchschnittsmonat — mit Aufschlüsselung des Abrechnungsmodus und
// einer Beispielrechnung auf Basis der echten Ausgaben/Beilagen der
// vergangenen Monate. Der Bericht wird als A4-Seite angezeigt und lässt sich
// drucken bzw. über den Druckdialog als PDF speichern.

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useApp } from '../context/AppContext';
import type { Abrechnungsperiode, Parameter, Teilgebiet, Tour } from '../types';
import { eur, stdMin } from '../lib/abrechnungslogik';
import {
  ladeAusgabenUndBeilagen,
  berechneTgAuswertung,
  type LohnPaar,
  type PeriodeAusgabenDaten,
  type TgAuswertung,
} from '../lib/teilgebietAuswertung';
import { saisonPauseText } from '../lib/saison';

type LohnAuswahl = 'beide' | 'erwachsene' | 'minderjaehrige';

interface Spalte {
  key: keyof LohnPaar;
  label: string;
}

interface DruckOptionen {
  monatsuebersicht: boolean;
  einzelaufstellung: boolean;
  strassen: boolean;
  sonderauslagen: boolean;
  nichtBeliefen: boolean;
}

const ZEITRAUM_OPTIONEN = [1, 2, 3, 6, 12];

function zahl(n: number, stellen = 0): string {
  return n.toLocaleString('de-DE', { minimumFractionDigits: stellen, maximumFractionDigits: stellen });
}

function stunden(h: number): string {
  return `${zahl(h, 2)} h`;
}

function zeitraumText(perioden: Abrechnungsperiode[]): string {
  if (perioden.length === 0) return '—';
  const sort = [...perioden].sort((a, b) => (a.jahr - b.jahr) * 12 + (a.monat - b.monat));
  const erste = sort[0].bezeichnung;
  const letzte = sort[sort.length - 1].bezeichnung;
  return erste === letzte ? erste : `${erste} – ${letzte}`;
}

export default function TeilgebietAuswertung() {
  const { teilgebiete, touren, mitarbeiter, abrechnungsperioden, parameter } = useApp();

  const [suche, setSuche] = useState('');
  const [inklInaktive, setInklInaktive] = useState(false);
  const [tgId, setTgId] = useState('');
  const [listeEingeklappt, setListeEingeklappt] = useState(false);
  const [anzMonate, setAnzMonate] = useState(3);
  const [lohnAuswahl, setLohnAuswahl] = useState<LohnAuswahl>('beide');
  const [mitBonus, setMitBonus] = useState(true);
  const [druck, setDruck] = useState<DruckOptionen>({
    monatsuebersicht: true,
    einzelaufstellung: true,
    strassen: true,
    sonderauslagen: true,
    nichtBeliefen: true,
  });

  const [daten, setDaten] = useState<PeriodeAusgabenDaten[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [fehler, setFehler] = useState('');

  const tourVon = (tg: Teilgebiet): Tour | undefined => touren.find((t) => t.id === tg.tourId);

  // Auslagestellen haben keinen Austräger — für Interessenten uninteressant.
  const kandidaten = useMemo(
    () =>
      teilgebiete
        .filter((t) => !t.istAuslagestelle && (inklInaktive || t.isActive))
        .sort((a, b) => a.name.localeCompare(b.name, 'de', { numeric: true })),
    [teilgebiete, inklInaktive]
  );

  const treffer = useMemo(() => {
    const q = suche.trim().toLowerCase();
    if (!q) return kandidaten;
    return kandidaten.filter((t) => {
      const tour = touren.find((x) => x.id === t.tourId);
      return (
        t.name.toLowerCase().includes(q) ||
        (t.plz ?? '').toLowerCase().includes(q) ||
        (tour?.name ?? '').toLowerCase().includes(q)
      );
    });
  }, [kandidaten, suche, touren]);

  // Vergangene Monate: Perioden vor dem aktuellen Monat, neueste zuerst.
  const auswertungsPerioden = useMemo(() => {
    const heute = new Date();
    const grenze = heute.getFullYear() * 12 + heute.getMonth() + 1;
    return [...abrechnungsperioden]
      .filter((p) => p.jahr * 12 + p.monat < grenze)
      .sort((a, b) => (b.jahr - a.jahr) * 12 + (b.monat - a.monat))
      .slice(0, anzMonate);
  }, [abrechnungsperioden, anzMonate]);

  const periodenKey = auswertungsPerioden.map((p) => p.id).join(',');

  // Ausgaben + Beilagen hängen nur vom Zeitraum ab — erst laden, wenn ein
  // TG gewählt ist, und für weitere TGs wiederverwenden.
  useEffect(() => {
    if (!tgId) return;
    let abgebrochen = false;
    setLoading(true);
    setFehler('');
    setDaten(null);
    ladeAusgabenUndBeilagen(auswertungsPerioden)
      .then((d) => { if (!abgebrochen) setDaten(d); })
      .catch((e) => {
        console.error(e);
        if (!abgebrochen) setFehler('Fehler beim Laden der Ausgaben: ' + (e?.message ?? e));
      })
      .finally(() => { if (!abgebrochen) setLoading(false); });
    return () => { abgebrochen = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodenKey, tgId !== '']);

  const tg = teilgebiete.find((t) => t.id === tgId) ?? null;

  const auswertung = useMemo(
    () => (tg && daten && parameter ? berechneTgAuswertung(tg, daten, parameter, mitBonus) : null),
    [tg, daten, parameter, mitBonus]
  );

  const spalten: Spalte[] = [
    ...(lohnAuswahl !== 'minderjaehrige' ? [{ key: 'erwachsene' as const, label: 'ab 18 Jahre' }] : []),
    ...(lohnAuswahl !== 'erwachsene' ? [{ key: 'minderjaehrige' as const, label: 'unter 18 Jahre' }] : []),
  ];

  function waehle(id: string) {
    setTgId(id);
    setListeEingeklappt(true);
  }

  const bonusMoeglich = (parameter?.bonusZeiterfassungEur ?? 0) > 0;

  return (
    <div className="space-y-6">
      {/* ---- Auswahl ---- */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
        <span className="block text-sm font-medium text-gray-700 mb-2">Teilgebiet *</span>
        {listeEingeklappt && tg ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3">
            <div className="text-sm text-blue-900">
              Ausgewählt: <span className="font-semibold">{tg.name}</span>
              {tg.plz && <span className="ml-1 font-mono text-blue-700">({tg.plz})</span>}
              {tourVon(tg) && <span className="ml-2 text-xs text-blue-700">Tour {tourVon(tg)!.name}</span>}
            </div>
            <button
              type="button"
              onClick={() => setListeEingeklappt(false)}
              className="rounded-lg border border-blue-300 bg-white px-3 py-1.5 text-sm font-medium text-blue-700 hover:bg-blue-100"
            >
              ▾ Anderes Teilgebiet wählen
            </button>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3 mb-3">
              <input
                type="text"
                placeholder="Name, Tour oder PLZ suchen…"
                value={suche}
                onChange={(e) => setSuche(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-full sm:w-72"
                autoFocus
              />
              <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
                <input
                  type="checkbox"
                  checked={inklInaktive}
                  onChange={(e) => setInklInaktive(e.target.checked)}
                  className="rounded"
                />
                inkl. inaktive
              </label>
              <span className="text-xs text-gray-500 ml-auto">
                {treffer.length} Treffer{treffer.length !== kandidaten.length && ` (von ${kandidaten.length})`}
                {tg && (
                  <button type="button" onClick={() => setListeEingeklappt(true)} className="ml-3 text-blue-600 hover:underline">
                    ▴ Liste ausblenden
                  </button>
                )}
              </span>
            </div>
            {treffer.length === 0 ? (
              <div className="bg-gray-50 rounded-lg border border-gray-200 p-6 text-center text-gray-400 text-sm">
                Keine Teilgebiete gefunden
              </div>
            ) : (
              <div className="max-h-80 overflow-y-auto rounded-lg border border-gray-200">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-gray-50 border-b border-gray-200 text-gray-600 text-xs">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">Teilgebiet</th>
                      <th className="px-3 py-2 text-left font-medium">PLZ</th>
                      <th className="px-3 py-2 text-left font-medium hidden sm:table-cell">Tour</th>
                      <th className="px-3 py-2 text-right font-medium">Stück</th>
                      <th className="px-3 py-2 text-right font-medium hidden sm:table-cell">Weg</th>
                      <th className="px-3 py-2 text-left font-medium hidden md:table-cell">Austräger</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 bg-white">
                    {treffer.map((t) => {
                      const tour = tourVon(t);
                      return (
                        <tr
                          key={t.id}
                          onClick={() => waehle(t.id)}
                          className={`cursor-pointer ${tgId === t.id ? 'bg-blue-50' : 'hover:bg-gray-50'}`}
                        >
                          <td className="px-3 py-2 font-medium text-gray-900">
                            {t.name}
                            {!t.isActive && <span className="ml-2 text-xs text-gray-400">inaktiv</span>}
                          </td>
                          <td className="px-3 py-2 font-mono text-gray-500">{t.plz}</td>
                          <td className="px-3 py-2 text-xs text-gray-600 hidden sm:table-cell">
                            {tour && (
                              <span className="inline-flex items-center gap-1.5">
                                <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: tour.farbe }} />
                                {tour.name}
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right font-mono">{zahl(t.stueckzahl)}</td>
                          <td className="px-3 py-2 text-right font-mono text-gray-500 hidden sm:table-cell">
                            {zahl(t.wegstreckeM / 1000, 1)} km
                          </td>
                          <td className="px-3 py-2 text-xs hidden md:table-cell">
                            {t.standardAustraegerId ? (
                              <span className="text-gray-600">
                                {mitarbeiter.find((m) => m.id === t.standardAustraegerId)?.name ?? 'besetzt'}
                              </span>
                            ) : (
                              <span className="text-amber-700 font-medium">unbesetzt</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        {/* ---- Optionen ---- */}
        <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Datenbasis</label>
            <select
              value={anzMonate}
              onChange={(e) => setAnzMonate(Number(e.target.value))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
            >
              {ZEITRAUM_OPTIONEN.map((n) => (
                <option key={n} value={n}>
                  {n === 1 ? 'letzter Monat' : `letzte ${n} Monate`}
                </option>
              ))}
            </select>
            <div className="text-xs text-gray-400 mt-1">{zeitraumText(auswertungsPerioden)}</div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Stundenlohn</label>
            <select
              value={lohnAuswahl}
              onChange={(e) => setLohnAuswahl(e.target.value as LohnAuswahl)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
            >
              <option value="beide">beide Altersgruppen</option>
              <option value="erwachsene">ab 18 Jahre</option>
              <option value="minderjaehrige">unter 18 Jahre</option>
            </select>
          </div>
          <div className="flex items-end">
            <label
              className={`flex items-center gap-2 text-sm ${bonusMoeglich ? 'text-gray-700 cursor-pointer' : 'text-gray-400'}`}
              title={bonusMoeglich ? undefined : 'Bonus Zeiterfassung ist in den Parametern deaktiviert'}
            >
              <input
                type="checkbox"
                checked={mitBonus && bonusMoeglich}
                disabled={!bonusMoeglich}
                onChange={(e) => setMitBonus(e.target.checked)}
                className="rounded"
              />
              Bonus Zeiterfassung einrechnen
            </label>
          </div>
        </div>

        <div className="mt-4">
          <span className="block text-xs font-medium text-gray-700 mb-1">Im Ausdruck enthalten</span>
          <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-gray-700">
            {([
              ['monatsuebersicht', 'Monatsübersicht'],
              ['einzelaufstellung', 'Einzelaufstellung je Ausgabe'],
              ['strassen', 'Straßenliste'],
              ['sonderauslagen', 'Sonderauslagen'],
              ['nichtBeliefen', 'Nicht-beliefern-Adressen'],
            ] as [keyof DruckOptionen, string][]).map(([key, label]) => (
              <label key={key} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={druck[key]}
                  onChange={(e) => setDruck((d) => ({ ...d, [key]: e.target.checked }))}
                  className="rounded"
                />
                {label}
              </label>
            ))}
          </div>
        </div>

        {fehler && <p className="text-red-600 text-sm mt-3">{fehler}</p>}
        {auswertungsPerioden.length === 0 && (
          <p className="text-amber-700 text-sm mt-3">
            Es gibt noch keine abgelaufene Abrechnungsperiode — ohne Echtdaten ist keine Verdienstberechnung möglich.
          </p>
        )}
      </div>

      {/* ---- Ergebnis ---- */}
      {tg && loading && (
        <div className="text-center text-sm text-gray-500 py-6">Lade Ausgaben und Beilagen…</div>
      )}
      {tg && auswertung && parameter && (
        <Ergebnis
          tg={tg}
          tour={tourVon(tg)}
          auswertung={auswertung}
          params={parameter}
          spalten={spalten}
          druck={druck}
          perioden={auswertungsPerioden}
        />
      )}
    </div>
  );
}

// ---- Ergebnis: Kurzübersicht + A4-Bericht ------------------

function Ergebnis({
  tg,
  tour,
  auswertung,
  params,
  spalten,
  druck,
  perioden,
}: {
  tg: Teilgebiet;
  tour?: Tour;
  auswertung: TgAuswertung;
  params: Parameter;
  spalten: Spalte[];
  druck: DruckOptionen;
  perioden: Abrechnungsperiode[];
}) {
  const a = auswertung;
  const kartenLink = tg.kartenLink?.trim() || tour?.kartenLink?.trim() || '';
  const haupt = spalten[0];

  const bericht = (
    <TgBericht tg={tg} tour={tour} auswertung={a} params={params} spalten={spalten} druck={druck} perioden={perioden} />
  );

  return (
    <>
      <style>{BERICHT_CSS}</style>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
          <div>
            <div className="text-xs text-gray-500">Teilgebiet</div>
            <div className="text-lg font-semibold text-gray-900">
              {tg.name} {tg.plz && <span className="font-mono text-gray-500 text-base">({tg.plz})</span>}
            </div>
            <div className="text-xs text-gray-500">
              {tour ? `Tour ${tour.name}` : 'ohne Tour'}
              {tg.standardAustraegerId ? '' : ' · derzeit unbesetzt'}
              {(tg.saisonPauseMonate?.length ?? 0) > 0 && ` · Saisonpause ${saisonPauseText(tg.saisonPauseMonate)}`}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {kartenLink && (
              <a
                href={kartenLink}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                🗺️ Karte öffnen
              </a>
            )}
            <button
              type="button"
              onClick={() => window.print()}
              className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700"
              title="Im Druckdialog „Als PDF speichern“ wählen, um eine PDF-Datei zu erhalten"
            >
              🖨️ Drucken / PDF
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <Kachel label="Stückzahl" wert={zahl(tg.stueckzahl)} sub="Exemplare je Ausgabe" />
          <Kachel label="Wegstrecke" wert={`${zahl(tg.wegstreckeM / 1000, 1)} km`} sub={`${(tg.strassen ?? []).length} Straßen`} />
          <Kachel
            label="Ø Zeit je Ausgabe"
            wert={a.jeAusgabe ? stdMin(a.jeAusgabe.zeitH) : '—'}
            sub="Soll-Zeit (vergütet)"
          />
          <Kachel
            label={`Ø je Ausgabe (${haupt.label})`}
            wert={a.jeAusgabe ? eur(a.jeAusgabe.gesamt[haupt.key]) : '—'}
            sub={spalten[1] && a.jeAusgabe ? `${spalten[1].label}: ${eur(a.jeAusgabe.gesamt[spalten[1].key])}` : undefined}
          />
          <Kachel
            label={`Ø Monat (${haupt.label})`}
            wert={a.jeAusgabe ? eur(a.jeMonat.gesamt[haupt.key]) : '—'}
            sub={spalten[1] && a.jeAusgabe ? `${spalten[1].label}: ${eur(a.jeMonat.gesamt[spalten[1].key])}` : `Ø ${zahl(a.ausgabenJeMonat, 2)} Ausgaben`}
            betont
          />
        </div>
        {params.austragenNachIstZeit && (
          <p className="mt-3 text-xs text-amber-700">
            ⚠️ In den Parametern ist „Austragen nach Ist-Zeit" aktiv — vergütet wird dann die erfasste Arbeitszeit.
            Die Soll-Zeit-Berechnung dient nur als Richtwert.
          </p>
        )}
      </div>

      {/* A4-Vorschau = identisch mit dem Ausdruck */}
      <div className="rounded-xl bg-gray-200 p-3 sm:p-6 overflow-x-auto">
        <div className="tga-vorschau">{bericht}</div>
      </div>

      {/* Druckbereich direkt an <body>, damit beim Drucken die ganze App
          ausgeblendet werden kann und die Seiten normal umbrechen. */}
      {createPortal(<div className="tga-druckbereich">{bericht}</div>, document.body)}
    </>
  );
}

function Kachel({ label, wert, sub, betont }: { label: string; wert: string; sub?: string; betont?: boolean }) {
  return (
    <div className={`rounded-lg border px-3 py-2 ${betont ? 'border-blue-200 bg-blue-50' : 'border-gray-200 bg-gray-50'}`}>
      <div className="text-[11px] text-gray-500 truncate">{label}</div>
      <div className={`font-bold font-mono ${betont ? 'text-blue-700 text-xl' : 'text-gray-900 text-lg'}`}>{wert}</div>
      {sub && <div className="text-[11px] text-gray-500 truncate">{sub}</div>}
    </div>
  );
}

// ---- A4-Bericht --------------------------------------------

const BERICHT_CSS = `
  @media screen {
    .tga-druckbereich { display: none; }
    .tga-vorschau .tga-blatt {
      background: white;
      box-shadow: 0 2px 12px rgba(0,0,0,0.18);
      width: 210mm;
      min-height: 297mm;
      margin: 0 auto;
      padding: 14mm 15mm;
    }
  }
  @media print {
    @page { size: A4 portrait; margin: 12mm 14mm; }
    #root { display: none !important; }
    body { margin: 0; background: white !important; }
    .tga-druckbereich { display: block !important; }
    .tga-blatt { width: auto; padding: 0; }
    .tga-abschnitt { break-inside: avoid; }
    .tga-tabelle tr { break-inside: avoid; }
    .tga-titel { break-after: avoid; }
  }
  .tga-blatt {
    font-family: Arial, Helvetica, sans-serif;
    color: #111827;
    font-size: 10pt;
    line-height: 1.35;
  }
  .tga-blatt * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .tga-kopf {
    display: flex; justify-content: space-between; align-items: flex-start; gap: 12mm;
    border-bottom: 2px solid #1e3a5f; padding-bottom: 3mm; margin-bottom: 5mm;
  }
  .tga-kopf h1 { font-size: 16pt; font-weight: 700; color: #1e3a5f; margin: 0; }
  .tga-kopf .tga-unter { font-size: 9.5pt; color: #4b5563; margin-top: 1mm; }
  .tga-kopf img { height: 15mm; width: auto; display: block; }
  .tga-titel {
    font-size: 11.5pt; font-weight: 700; color: #1e3a5f;
    margin: 6mm 0 2mm; padding-bottom: 1mm; border-bottom: 1px solid #cbd5e1;
  }
  .tga-kennzahlen { display: grid; grid-template-columns: repeat(4, 1fr); gap: 2mm; }
  .tga-kennzahl { border: 1px solid #e5e7eb; background: #f9fafb; border-radius: 1.5mm; padding: 1.5mm 2.5mm; }
  .tga-kennzahl .l { font-size: 7.5pt; text-transform: uppercase; letter-spacing: 0.04em; color: #6b7280; }
  .tga-kennzahl .w { font-size: 11pt; font-weight: 700; }
  .tga-kennzahl .s { font-size: 8pt; color: #6b7280; }
  table.tga-tabelle { border-collapse: collapse; width: 100%; font-size: 9pt; }
  table.tga-tabelle th, table.tga-tabelle td { border: 1px solid #cbd5e1; padding: 1.2mm 2mm; vertical-align: top; }
  table.tga-tabelle th { background: #f1f5f9; font-weight: 600; font-size: 8pt; text-align: left; }
  table.tga-tabelle .n { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  table.tga-tabelle tr.summe td { font-weight: 700; background: #eef2ff; }
  table.tga-tabelle tr.zwischen td { font-weight: 600; background: #f8fafc; }
  table.tga-tabelle tr.grau td { color: #9ca3af; }
  table.tga-tabelle .rech { color: #4b5563; font-size: 8.5pt; }
  .tga-liste { margin: 0; padding-left: 5mm; }
  .tga-liste li { margin-bottom: 1mm; }
  .tga-hinweis { font-size: 8pt; color: #6b7280; margin-top: 2mm; }
  .tga-strassen { columns: 2; column-gap: 6mm; font-size: 9pt; }
  .tga-strassen div { display: flex; justify-content: space-between; gap: 3mm; border-bottom: 1px dotted #d1d5db; padding: 0.6mm 0; break-inside: avoid; }
  .tga-fuss { margin-top: 8mm; padding-top: 2mm; border-top: 1px solid #cbd5e1; font-size: 8pt; color: #6b7280; }
`;

function TgBericht({
  tg,
  tour,
  auswertung: a,
  params,
  spalten,
  druck,
  perioden,
}: {
  tg: Teilgebiet;
  tour?: Tour;
  auswertung: TgAuswertung;
  params: Parameter;
  spalten: Spalte[];
  druck: DruckOptionen;
  perioden: Abrechnungsperiode[];
}) {
  const d = a.jeAusgabe;
  const strassen = [...(tg.strassen ?? [])].sort((x, y) => x.strassenname.localeCompare(y.strassenname, 'de'));
  const sonderauslagen = tg.sonderauslagen ?? [];
  const nichtBeliefen = tg.nichtBeliefen ?? [];
  const summeSonderauslagen = sonderauslagen.reduce((s, x) => s + (x.stueckzahl || 0), 0);
  const ausgewertet = a.monate.map((m) => m.periode);
  const zeitraum = zeitraumText(ausgewertet.length > 0 ? ausgewertet : perioden);
  const extGeschw = params.externeBeilageEinlegeGeschwStkProH || params.steckzeitStkProH;
  const heute = new Date().toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const saison = saisonPauseText(tg.saisonPauseMonate);
  const anzBeliefert = a.zeilen.filter((z) => !z.inSaisonpause).length;

  // Ergebnis-Zellen je gewählter Altersgruppe.
  const lohnZellen = (paar: LohnPaar, fett = false) =>
    spalten.map((s) => (
      <td key={s.key} className="n" style={fett ? { fontWeight: 700 } : undefined}>{eur(paar[s.key])}</td>
    ));
  // Beträge, die nicht vom Alter abhängen, über alle Spalten.
  const festZelle = (wert: ReactNode) => (
    <td className="n" colSpan={spalten.length}>{wert}</td>
  );

  return (
    <div className="tga-blatt">
      <div className="tga-kopf">
        <div>
          <h1>Teilgebiet {tg.name}</h1>
          <div className="tga-unter">
            Gebietsbeschreibung und Verdienstmöglichkeiten beim Austragen
            {tg.plz && <> · PLZ {tg.plz}</>}
            {tour && <> · Tour {tour.name}</>}
          </div>
          <div className="tga-unter">Schlieper-Druck GmbH · Stand {heute}</div>
        </div>
        <img src="/schlieper-druck-logo.jpg" alt="Schlieper-Druck" />
      </div>

      {/* ---- Gebiet ---- */}
      <div className="tga-abschnitt">
        <div className="tga-titel">Das Gebiet</div>
        <div className="tga-kennzahlen">
          <div className="tga-kennzahl">
            <div className="l">Stückzahl</div>
            <div className="w">{zahl(tg.stueckzahl)}</div>
            <div className="s">Exemplare je Ausgabe</div>
          </div>
          <div className="tga-kennzahl">
            <div className="l">Wegstrecke</div>
            <div className="w">{zahl(tg.wegstreckeM / 1000, 1)} km</div>
            <div className="s">{zahl(tg.wegstreckeM)} m je Ausgabe</div>
          </div>
          <div className="tga-kennzahl">
            <div className="l">Straßen</div>
            <div className="w">{strassen.length}</div>
            <div className="s">siehe Straßenliste</div>
          </div>
          <div className="tga-kennzahl">
            <div className="l">Erscheinung</div>
            <div className="w">wöchentlich</div>
            <div className="s">{saison ? `Saisonpause: ${saison}` : 'ganzjährig'}</div>
          </div>
          <div className="tga-kennzahl">
            <div className="l">Sonderauslagen</div>
            <div className="w">{sonderauslagen.length}</div>
            <div className="s">{sonderauslagen.length > 0 ? `zus. ${zahl(summeSonderauslagen)} Stück` : 'keine'}</div>
          </div>
          <div className="tga-kennzahl">
            <div className="l">Nicht beliefern</div>
            <div className="w">{nichtBeliefen.length}</div>
            <div className="s">{nichtBeliefen.length === 1 ? 'Adresse' : 'Adressen'}</div>
          </div>
          <div className="tga-kennzahl">
            <div className="l">Ø Beilagen</div>
            <div className="w">{d ? zahl(d.beilagenInt + d.beilagenExt, 1) : '—'}</div>
            <div className="s">je Ausgabe ({zeitraum})</div>
          </div>
          <div className="tga-kennzahl">
            <div className="l">Ø Soll-Zeit</div>
            <div className="w">{d ? stdMin(d.zeitH) : '—'}</div>
            <div className="s">je Ausgabe</div>
          </div>
        </div>
      </div>

      {/* ---- Verdienst auf einen Blick ---- */}
      <div className="tga-abschnitt">
        <div className="tga-titel">Verdienst auf einen Blick</div>
        {!d ? (
          <p>Im ausgewerteten Zeitraum ({zeitraum}) wurde das Gebiet nicht beliefert — keine Berechnung möglich.</p>
        ) : (
          <table className="tga-tabelle">
            <thead>
              <tr>
                <th>Durchschnitt</th>
                {spalten.map((s) => <th key={s.key} className="n">{s.label}</th>)}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Vergütete Soll-Zeit je Ausgabe</td>
                {festZelle(stdMin(d.zeitH))}
              </tr>
              <tr>
                <td>Stundenlohn</td>
                {spalten.map((s) => <td key={s.key} className="n">{eur(a.stundenlohn[s.key])} / h</td>)}
              </tr>
              <tr className="zwischen">
                <td>Verdienst je Ausgabe</td>
                {lohnZellen(d.gesamt)}
              </tr>
              <tr>
                <td>Belieferte Ausgaben je Monat</td>
                {festZelle(zahl(a.ausgabenJeMonat, 2))}
              </tr>
              <tr className="summe">
                <td>Verdienst im Durchschnittsmonat (brutto)</td>
                {lohnZellen(a.jeMonat.gesamt, true)}
              </tr>
              <tr>
                <td>Verdienst je vergüteter Stunde inkl. Zulagen</td>
                {spalten.map((s) => (
                  <td key={s.key} className="n">{d.zeitH > 0 ? `${eur(d.gesamt[s.key] / d.zeitH)} / h` : '—'}</td>
                ))}
              </tr>
            </tbody>
          </table>
        )}
        <div className="tga-hinweis">
          Datenbasis: {anzBeliefert} belieferte {anzBeliefert === 1 ? 'Ausgabe' : 'Ausgaben'} aus {zeitraum}
          {a.periodenOhneDaten.length > 0 && <> (ohne {a.periodenOhneDaten.map((p) => p.bezeichnung).join(', ')} — keine Ausgaben erfasst)</>}.
        </div>
      </div>

      {/* ---- Abrechnungsmodus ---- */}
      <div className="tga-abschnitt">
        <div className="tga-titel">So wird abgerechnet</div>
        <ul className="tga-liste">
          {params.austragenNachIstZeit ? (
            <li>
              Vergütet wird die <strong>tatsächlich erfasste Arbeitszeit</strong>. Die unten berechnete Soll-Zeit ist
              ein Richtwert dafür, wie lange das Gebiet üblicherweise dauert.
            </li>
          ) : (
            <li>
              Vergütet wird je Ausgabe eine feste <strong>Soll-Arbeitszeit</strong>, die sich aus dem Gebiet ergibt —
              unabhängig davon, wie lange das Austragen tatsächlich dauert. Wer zügig arbeitet, verdient effektiv mehr
              pro Stunde.
            </li>
          )}
          <li>
            <strong>Soll-Zeit</strong> = Laufzeit (Wegstrecke ÷ {zahl(params.laufgeschwindigkeitMProH)} m/h)
            + Steckzeit (Stückzahl ÷ {zahl(params.steckzeitStkProH)} Stück/h)
            + Einlegezeit für Beilagen, die nicht schon vorab eingelegt sind (Stückzahl × Anzahl ÷ {zahl(extGeschw)} Stück/h).
          </li>
          <li>
            <strong>Grundlohn</strong> = Soll-Zeit × Stundenlohn: {eur(params.stundenlohnErwachseneAustr)}/h ab 18 Jahren,{' '}
            {eur(params.stundenlohnMinderjAustr)}/h unter 18 Jahren.
          </li>
          <li>
            <strong>Gewichtszulage Anzeigenblatt</strong>: {eur(params.gewichtszulageAnzeigenblattEurKg)} je kg ausgetragenes
            Papiergewicht — je mehr Seiten, desto höher.
          </li>
          <li>
            <strong>Gewichtszulage Beilagen</strong>: {eur(params.gewichtszulageBeilagenEurKg)} je kg Beilagen (alle Prospekte
            und Beilagen der Ausgabe).
          </li>
          {(params.bonusZeiterfassungEur ?? 0) > 0 && (
            <li>
              <strong>Bonus Zeiterfassung</strong>: {eur(params.bonusZeiterfassungEur ?? 0)} je Ausgabe, wenn Arbeitszeit,
              Restmenge und Meldung vollständig per QR-Code online erfasst werden
              {a.bonusJeAusgabe === 0 && ' (in dieser Berechnung nicht eingerechnet)'}.
            </li>
          )}
          <li>Abgerechnet wird monatlich über alle Ausgaben des Monats; alle Beträge sind Bruttobeträge.</li>
        </ul>
      </div>

      {/* ---- Beispielrechnung ---- */}
      {d && (
        <div className="tga-abschnitt">
          <div className="tga-titel">Beispielrechnung — Durchschnitt {zeitraum}</div>
          <table className="tga-tabelle">
            <thead>
              <tr>
                <th style={{ width: '26%' }}>Position</th>
                <th>Rechnung</th>
                {spalten.map((s) => <th key={s.key} className="n" style={{ width: '15%' }}>{s.label}</th>)}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Laufzeit</td>
                <td className="rech">{zahl(tg.wegstreckeM)} m ÷ {zahl(params.laufgeschwindigkeitMProH)} m/h</td>
                {festZelle(stunden(d.laufzeitH))}
              </tr>
              <tr>
                <td>Steckzeit</td>
                <td className="rech">{zahl(tg.stueckzahl)} Stück ÷ {zahl(params.steckzeitStkProH)} Stück/h</td>
                {festZelle(stunden(d.steckzeitH))}
              </tr>
              <tr>
                <td>Einlegezeit Beilagen</td>
                <td className="rech">
                  {zahl(tg.stueckzahl)} Stück × Ø {zahl(d.beilagenExt, 2)} nicht vorab eingelegte Beilagen ÷ {zahl(extGeschw)} Stück/h
                </td>
                {festZelle(stunden(d.einlegezeitH))}
              </tr>
              <tr className="zwischen">
                <td>= Soll-Zeit je Ausgabe</td>
                <td className="rech">{stdMin(d.zeitH)} (Std:Min)</td>
                {festZelle(stunden(d.zeitH))}
              </tr>
              <tr>
                <td>Grundlohn</td>
                <td className="rech">
                  {zahl(d.zeitH, 2)} h × {spalten.map((s) => eur(a.stundenlohn[s.key])).join(' bzw. ')} / h
                </td>
                {lohnZellen(d.grundlohn)}
              </tr>
              <tr>
                <td>Gewichtszulage Anzeigenblatt</td>
                <td className="rech">
                  Ø {zahl(d.seitenzahl, 1)} Seiten = {zahl(d.gewichtExemplarG, 1)} g × {zahl(tg.stueckzahl)} Stück
                  = {zahl(d.gewichtAnzeigenblattKg, 1)} kg × {eur(params.gewichtszulageAnzeigenblattEurKg)}/kg
                </td>
                {festZelle(eur(d.gewichtsbonusAnzeigenblatt))}
              </tr>
              <tr>
                <td>Gewichtszulage Beilagen</td>
                <td className="rech">
                  Ø {zahl(d.beilagenInt + d.beilagenExt, 2)} Beilagen ({zahl(d.beilagenInt, 2)} vorab eingelegt,{' '}
                  {zahl(d.beilagenExt, 2)} lose) mit zus. {zahl(d.beilagenGewichtG, 1)} g × {zahl(tg.stueckzahl)} Stück
                  = {zahl(d.gewichtBeilagenKg, 1)} kg × {eur(params.gewichtszulageBeilagenEurKg)}/kg
                </td>
                {festZelle(eur(d.gewichtsbonusBeilagen))}
              </tr>
              {a.bonusJeAusgabe > 0 && (
                <tr>
                  <td>Bonus Zeiterfassung</td>
                  <td className="rech">je Ausgabe bei vollständiger Online-Erfassung</td>
                  {festZelle(eur(d.bonusZeiterfassung))}
                </tr>
              )}
              <tr className="zwischen">
                <td>= Verdienst je Ausgabe</td>
                <td className="rech">Durchschnitt aus {anzBeliefert} Ausgaben</td>
                {lohnZellen(d.gesamt)}
              </tr>
              <tr>
                <td>× Ausgaben je Monat</td>
                <td className="rech">
                  Ø {zahl(a.ausgabenJeMonat, 2)} belieferte Ausgaben in {a.monate.length}{' '}
                  {a.monate.length === 1 ? 'Monat' : 'Monaten'}
                </td>
                {festZelle(`× ${zahl(a.ausgabenJeMonat, 2)}`)}
              </tr>
              <tr className="summe">
                <td>= Verdienst im Durchschnittsmonat</td>
                <td className="rech">brutto</td>
                {lohnZellen(a.jeMonat.gesamt, true)}
              </tr>
            </tbody>
          </table>
          <div className="tga-hinweis">
            Vorab eingelegte Beilagen werden beim Zusammentragen eingelegt und bringen dem Austräger nur die Gewichtszulage;
            lose Beilagen legt der Austräger selbst ein — dafür wird zusätzlich Einlegezeit vergütet.
          </div>
        </div>
      )}

      {/* ---- Monatsübersicht ---- */}
      {druck.monatsuebersicht && a.monate.length > 0 && (
        <div className="tga-abschnitt">
          <div className="tga-titel">Monatsübersicht (Echtdaten)</div>
          <table className="tga-tabelle">
            <thead>
              <tr>
                <th>Monat</th>
                <th className="n">Ausgaben</th>
                <th className="n">Soll-Zeit</th>
                {spalten.map((s) => <th key={s.key} className="n">Verdienst {s.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {a.monate.map((m) => (
                <tr key={m.periode.id}>
                  <td>
                    {m.periode.bezeichnung}
                    {m.anzSaisonpause > 0 && <span className="rech"> · {m.anzSaisonpause}× Saisonpause</span>}
                  </td>
                  <td className="n">{m.anzAusgaben}</td>
                  <td className="n">{stdMin(m.zeitH)}</td>
                  {lohnZellen(m.gesamt)}
                </tr>
              ))}
              <tr className="summe">
                <td>Durchschnitt</td>
                <td className="n">{zahl(a.ausgabenJeMonat, 2)}</td>
                <td className="n">{stdMin(a.jeMonat.zeitH)}</td>
                {lohnZellen(a.jeMonat.gesamt)}
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {/* ---- Einzelaufstellung ---- */}
      {druck.einzelaufstellung && a.zeilen.length > 0 && (
        <div>
          <div className="tga-titel">Einzelaufstellung je Ausgabe</div>
          <table className="tga-tabelle">
            <thead>
              <tr>
                <th>KW</th>
                <th className="n">Seiten</th>
                <th className="n">Soll-Zeit</th>
                <th className="n">Gewichts­zulagen</th>
                {spalten.map((s) => <th key={s.key} className="n">Verdienst {s.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {a.zeilen.map((z) =>
                z.inSaisonpause ? (
                  <tr key={z.ausgabeId} className="grau">
                    <td>{z.kw}/{z.jahr}</td>
                    <td colSpan={3 + spalten.length}>nicht beliefert (Saisonpause)</td>
                  </tr>
                ) : (
                  <tr key={z.ausgabeId}>
                    <td>{z.kw}/{z.jahr}</td>
                    <td className="n">{z.seitenzahl}</td>
                    <td className="n">{stdMin(z.zeitH)}</td>
                    <td className="n">{eur(z.gewichtsbonusAnzeigenblatt + z.gewichtsbonusBeilagen)}</td>
                    {lohnZellen(z.gesamt)}
                  </tr>
                )
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* ---- Straßenliste ---- */}
      {druck.strassen && (
        <div>
          <div className="tga-titel">
            Straßenliste ({strassen.length} {strassen.length === 1 ? 'Straße' : 'Straßen'},{' '}
            {zahl(strassen.reduce((s, x) => s + (x.stueckzahl || 0), 0))} Stück)
          </div>
          {strassen.length === 0 ? (
            <p className="tga-hinweis">Keine Straßen hinterlegt.</p>
          ) : (
            <div className="tga-strassen">
              {strassen.map((s) => (
                <div key={s.id}>
                  <span>{s.strassenname}</span>
                  <span style={{ fontVariantNumeric: 'tabular-nums' }}>{zahl(s.stueckzahl || 0)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ---- Sonderauslagen ---- */}
      {druck.sonderauslagen && (
        <div className="tga-abschnitt">
          <div className="tga-titel">Sonderauslagen</div>
          {sonderauslagen.length === 0 ? (
            <p className="tga-hinweis">Keine Sonderauslagen.</p>
          ) : (
            <table className="tga-tabelle">
              <thead>
                <tr>
                  <th>Bezeichnung</th>
                  <th>Adresse</th>
                  <th className="n">Stück</th>
                </tr>
              </thead>
              <tbody>
                {sonderauslagen.map((s) => (
                  <tr key={s.id}>
                    <td>{s.bezeichnung}</td>
                    <td>{s.adresse ?? ''}</td>
                    <td className="n">{zahl(s.stueckzahl || 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ---- Nicht beliefern ---- */}
      {druck.nichtBeliefen && (
        <div className="tga-abschnitt">
          <div className="tga-titel">Bitte nicht beliefern</div>
          {nichtBeliefen.length === 0 ? (
            <p className="tga-hinweis">Keine Adressen hinterlegt.</p>
          ) : (
            <table className="tga-tabelle">
              <thead>
                <tr>
                  <th>Adresse</th>
                  <th>Bemerkung</th>
                </tr>
              </thead>
              <tbody>
                {nichtBeliefen.map((n) => (
                  <tr key={n.id}>
                    <td>{n.adresse}</td>
                    <td>{n.bemerkung ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      <div className="tga-fuss">
        Unverbindliche Beispielrechnung auf Basis der Ausgaben und Beilagen aus {zeitraum}, der aktuellen Gebietsdaten
        (Stückzahl, Wegstrecke) und der aktuell gültigen Vergütungssätze (Stand {heute}). Der tatsächliche Verdienst
        hängt vom Seitenumfang und den Beilagen der jeweiligen Ausgabe ab. Alle Beträge brutto.
      </div>
    </div>
  );
}
