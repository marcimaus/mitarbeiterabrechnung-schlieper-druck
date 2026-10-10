import { useState, useEffect, useRef, type FormEvent, type ReactElement } from 'react';
import ExcelJS from 'exceljs';
import { useApp } from '../context/AppContext';
import AdminPinGate from '../components/AdminPinGate';
import Modal from '../components/Modal';
import LohnkontoVerlauf from '../components/LohnkontoVerlauf';
import { ladePeriodeData, berechneAbrechnung, eur, stdMin, zeitLohnAufteilung } from '../lib/abrechnungslogik';
import { aktualisiereMitarbeiterMitProtokoll } from '../lib/mitarbeiterProtokoll';
import { berechneNettoMinuten } from '../lib/zeiterfassung';
import { exportiereAbrechnung, exportiereLohnuebermittlung } from '../lib/exportXlsx';
import { istPeriodeNachAbmeldung, offeneAbmeldungen, periodenEndeIso as periodenEndeIsoVon } from '../lib/abmeldungen';
import {
  schliessePeriodeAb,
  oeffnePeriodeWieder,
  aktualisiereAbrechnungsperiode,
  erstelleVorschuss,
  aktualisiereVorschuss,
  loescheVorschuss,
  erstelleVariablenPeriodenZusatz,
  aktualisiereVariablenPeriodenZusatz,
  loescheVariablenPeriodenZusatz,
  erstelleLohnkontoBuchung,
  loescheLohnkontoBuchung,
  ladeLohnkontoBuchungen,
  ladeExterneAbrechnungswerte,
  setzeExterneAbrechnungswert,
  ladeSonderzahlungen,
  setzeSonderzahlung,
  loescheSonderzahlung,
  sonderzahlungVorlagenListener,
  speichereSonderzahlungVorlagen,
  schreibeMonatswechselSnapshot,
  verwerfeMonatswechselSnapshot,
  aktualisiereMitarbeiter,
  aktualisiereTeilgebiet,
  loescheStueckzahlAnpassung,
  protokolliereUmgesetzteAnpassung,
  entferneAusAbmeldungenSnapshot,
  ladeFahrten,
  ladeAusgaben,
  ladeEinsaetzeFuerTeilgebiet,
  ladeEinsaetzeFuerJahre,
  loescheEinsatz,
  schreibeAuditLog,
} from '../lib/db';
import { sichereTeilgebietsdokuAktuell } from '../lib/teilgebietsdoku';
import { merkeVerteilplanOnlineAenderung, verteilplanRelevanteAenderung } from '../lib/verteilplanOnline';
import { analysiereRestmengen, juengstePerioden } from '../lib/restmengenanalyse';
import type { MitarbeiterAbrechnung, VorschussVormerkung } from '../lib/abrechnungslogik';
import { getISOWeek } from '../lib/kalender';
import { vorarbeitAusgabe, zeitfensterText } from '../lib/vorarbeit';
import type { Abrechnungsperiode, Vorschuss, Mitarbeiter, Rolle, Ausgabe, StandardAustraegerWechselPlan, Teilgebiet, Arbeitszeit, Einsatz } from '../types';
import {
  austraegerwechselPlanListener,
  loescheAustraegerwechselPlan,
} from '../lib/planung';
import { ROLLEN_LABELS, memoKategorieLabel } from '../types';

/**
 * Entscheidet, ob ein Standardausträger-Wechselplan beim Monatswechsel der
 * Periode P zur Übernahme angeboten wird. Der Wechsel ist relevant, wenn er an
 * der Grenze P → P+1 wirksam wird:
 *   - bisheriger Austräger trägt seine letzte Ausgabe in P aus, ODER
 *   - neuer Austräger startet in P, ODER
 *   - neuer Austräger startet zu Beginn von P+1 (deckt zuvor unbesetzte TGs ab,
 *     deren „ab Ausgabe" erst im Folgemonat liegt).
 */
function istRelevanterWechselplan(
  p: StandardAustraegerWechselPlan,
  periode: Abrechnungsperiode,
  perioden: Abrechnungsperiode[],
): boolean {
  const periodKw = new Set(periode.kalenderwochen);
  const naechste = perioden
    .filter((q) =>
      q.jahr > periode.jahr ||
      (q.jahr === periode.jahr && q.monat > periode.monat),
    )
    .sort((a, b) => (a.jahr !== b.jahr ? a.jahr - b.jahr : a.monat - b.monat))[0];
  const letzteInPeriode =
    p.letzteAusgabeJahr === periode.jahr &&
    p.letzteAusgabeKw != null &&
    periodKw.has(p.letzteAusgabeKw);
  const abInPeriode =
    p.abAusgabeJahr === periode.jahr &&
    p.abAusgabeKw != null &&
    periodKw.has(p.abAusgabeKw);
  const abInNaechster =
    naechste != null &&
    p.abAusgabeJahr === naechste.jahr &&
    p.abAusgabeKw != null &&
    naechste.kalenderwochen.includes(p.abAusgabeKw);
  return letzteInPeriode || abInPeriode || abInNaechster;
}

/**
 * Ermittelt erfasste Vorarbeit-Zeiten, deren zugeordnete Ausgabe NICHT
 * freigegeben ist (`vorarbeitFreigegeben` fehlt). Solche Minuten werden in
 * `berechneAbrechnung` verworfen und fließen NICHT in den Lohn ein — der
 * Mitarbeiter hat also Vorarbeit gestempelt, die unbezahlt bliebe. Die
 * Freigabe-Logik spiegelt exakt die der Lohnberechnung (direkte Ausgabe-
 * Zuordnung bzw. Fallback über KW/Jahr der Stempelzeit).
 */
function ermittleVorarbeitOhneFreigabe(
  data: { ausgaben: Ausgabe[]; arbeitszeiten: Arbeitszeit[] },
  mitarbeiter: Mitarbeiter[],
): { name: string; minuten: number; kws: number[] }[] {
  const istFreigegeben = (a: Arbeitszeit): boolean =>
    vorarbeitAusgabe(a, data.ausgaben)?.vorarbeitFreigegeben === true;

  const offene = data.arbeitszeiten.filter(
    (a) =>
      a.typ === 'vorarbeit' &&
      a.status === 'abgeschlossen' &&
      !a.nichtBeruecksichtigen &&
      !istFreigegeben(a),
  );

  const proMa = new Map<string, { name: string; minuten: number; kws: Set<number> }>();
  for (const a of offene) {
    const name = mitarbeiter.find((m) => m.id === a.mitarbeiterId)?.name ?? 'Unbekannt';
    const eintrag = proMa.get(a.mitarbeiterId) ?? { name, minuten: 0, kws: new Set<number>() };
    eintrag.minuten += berechneNettoMinuten(a);
    eintrag.kws.add(getISOWeek(new Date(a.startTime)));
    proMa.set(a.mitarbeiterId, eintrag);
  }

  return [...proMa.values()]
    .map((e) => ({ name: e.name, minuten: e.minuten, kws: [...e.kws].sort((x, y) => x - y) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Robustes Parsen eines EUR-Betrags aus Nutzereingabe / Excel-Zelle.
 * Akzeptiert „1.234,56", „1234,56", „1234.56", „1234". Leerstring → 0.
 * Rückgabe null, wenn nicht interpretierbar.
 */
function parseEuro(input: string): number | null {
  const t = input.trim();
  if (t === '') return 0;
  let norm = t.replace(/[^\d.,-]/g, '');
  if (norm.includes(',')) {
    // Komma = Dezimaltrenner, Punkte = Tausenderpunkte
    norm = norm.replace(/\./g, '').replace(',', '.');
  }
  const n = parseFloat(norm);
  return Number.isFinite(n) ? n : null;
}

/**
 * Editierbare Zelle „Wert externe Anwendung". Hält den Text lokal, speichert
 * erst bei Verlassen des Feldes (Blur / Enter) und triggert danach eine
 * Neuberechnung. Ein leerer / 0-Wert löscht den Eintrag (App-Berechnung greift
 * wieder).
 */
function ExternerWertZelle({
  periodeId,
  mitarbeiterId,
  wert,
  aktiv,
  disabled,
  onSaved,
}: {
  periodeId: string;
  mitarbeiterId: string;
  wert?: number;
  aktiv: boolean;
  disabled: boolean;
  onSaved: () => void;
}) {
  const anzeige = (v?: number) =>
    v != null && v > 0 ? v.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '';
  const [text, setText] = useState(anzeige(wert));
  const [saving, setSaving] = useState(false);

  // Wert von außen (Neuberechnung / Excel-Import) übernehmen.
  useEffect(() => {
    setText(anzeige(wert));
  }, [wert]);

  async function commit() {
    const val = parseEuro(text);
    const current = wert ?? 0;
    if (val == null) {
      setText(anzeige(wert));
      return;
    }
    if (Math.abs(val - current) < 0.005) {
      setText(anzeige(val > 0 ? val : undefined));
      return;
    }
    setSaving(true);
    try {
      await setzeExterneAbrechnungswert(periodeId, mitarbeiterId, val, 'manuell');
      onSaved();
    } catch (e: any) {
      alert('Speichern fehlgeschlagen: ' + (e.message ?? e));
      setText(anzeige(wert));
    } finally {
      setSaving(false);
    }
  }

  return (
    <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
      <input
        type="text"
        inputMode="decimal"
        value={text}
        disabled={disabled || saving}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
        placeholder="—"
        title={
          aktiv
            ? 'Externer Wert aktiv — ersetzt Austragen + Zusammentragen + Vorarbeit in Brutto / An Lohnbüro'
            : 'Betrag aus externer Anwendung (EUR) — ersetzt Austragen + Zusammentragen + Vorarbeit'
        }
        className={`w-24 text-right rounded border px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${
          aktiv
            ? 'border-blue-400 bg-blue-50 font-semibold text-blue-800'
            : 'border-gray-200 bg-white text-gray-700'
        } disabled:bg-gray-100 disabled:text-gray-400 disabled:border-gray-200`}
      />
    </td>
  );
}

export default function AbrechnungScreen() {
  return (
    <AdminPinGate>
      <AbrechnungInhalt />
    </AdminPinGate>
  );
}

function AbrechnungInhalt() {
  const { mitarbeiter, teilgebiete, abrechnungsperioden, parameter: params, userRole, adminName, variablePeriodenZusaetze, externeAbrechnungswerte, stueckzahlAnpassungen, mitarbeiterMemos, memoKategorienEigene, lohnbueroAbrechnungen } = useApp();
  const [selectedPeriodeId, setSelectedPeriodeId] = useState('');
  const [ergebnisse, setErgebnisse] = useState<MitarbeiterAbrechnung[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [fehler, setFehler] = useState('');
  const [exportierend, setExportierend] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // Detailspalten Gewichtszuschläge (in „Austragen" enthalten) — per Klick
  // auf den Spaltenkopf „Austragen" ein-/ausblendbar, standardmäßig aus.
  const [zeigeGewichtsspalten, setZeigeGewichtsspalten] = useState(false);
  // Detailspalten Zeiterfassung (Vorarbeit / übrige Zeit) — per Klick auf
  // den Spaltenkopf „Zeiterfassung", standardmäßig aus.
  const [zeigeZeitspalten, setZeigeZeitspalten] = useState(false);
  const [abschliessenBestaetigt, setAbschliessenBestaetigt] = useState(false);
  const [monatswechselBestaetigt, setMonatswechselBestaetigt] = useState(false);
  const [zeigeAnpassungDialog, setZeigeAnpassungDialog] = useState(false);
  // Wechselpläne (PlanungScreen-Sektion): werden beim Monatswechsel
  // gefiltert auf jene, deren `letzteAusgabe` der letzten KW der laufenden
  // Periode entspricht.
  const [wechselplaene, setWechselplaene] = useState<StandardAustraegerWechselPlan[]>([]);
  const [zeigeWechselplanDialog, setZeigeWechselplanDialog] = useState(false);
  useEffect(() => austraegerwechselPlanListener(setWechselplaene), []);
  const [suchbegriff, setSuchbegriff] = useState('');
  const [filterRolle, setFilterRolle] = useState<Rolle | ''>('');
  const [filterMinijob, setFilterMinijob] = useState<'' | 'ja' | 'nein'>('');
  const [filterSvFrei, setFilterSvFrei] = useState<'' | 'ja' | 'nein'>('');
  // Nur MA mit offenem Lohnkonto-Saldo (nach dieser Periode ≠ 0) — zeigt, bei
  // wem noch etwas zu verrechnen ist.
  const [filterLohnkontoSaldo, setFilterLohnkontoSaldo] = useState<'' | 'ja' | 'nein'>('');
  // Warnung: Fahrtkosten-Datensätze, die noch keiner Abrechnungsperiode
  // zugeordnet sind (abrechnungsperiodeId fehlt).
  const [unzugeordneteFahrten, setUnzugeordneteFahrten] = useState<number>(0);
  // Warnung: erfasste Vorarbeit-Zeiten, deren Ausgabe NICHT freigegeben ist —
  // diese Minuten fließen NICHT in den Lohn ein. Wird beim Berechnen befüllt.
  const [vorarbeitOhneFreigabe, setVorarbeitOhneFreigabe] = useState<
    { name: string; minuten: number; kws: number[] }[]
  >([]);
  // Ausgaben der gewählten Periode — zur Prüfung auf fehlende Seitenzahl /
  // Stapelzahl. Wird beim Periodenwechsel neu geladen.
  const [periodenAusgaben, setPeriodenAusgaben] = useState<Ausgabe[]>([]);

  // Excel-Upload „Werte externe Anwendung": Datei-Input + Vorschau vor dem
  // Schreiben (Zuordnung über die 5-stellige MA-Nummer).
  const excelInputRef = useRef<HTMLInputElement | null>(null);
  const [excelVorschau, setExcelVorschau] = useState<null | {
    matched: { mitarbeiterId: string; name: string; nummer: string; betrag: number; alt?: number }[];
    unmatched: { nummer?: string; name?: string; betrag: number }[];
  }>(null);
  const [excelSchreibt, setExcelSchreibt] = useState(false);

  useEffect(() => {
    if (!selectedPeriodeId) {
      setPeriodenAusgaben([]);
      return;
    }
    let cancelled = false;
    ladeAusgaben().then((alle) => {
      if (cancelled) return;
      const periode = abrechnungsperioden.find((p) => p.id === selectedPeriodeId);
      if (!periode) {
        setPeriodenAusgaben([]);
        return;
      }
      setPeriodenAusgaben(
        alle.filter((a) => a.jahr === periode.jahr && periode.kalenderwochen.includes(a.kw))
      );
    }).catch((err) => console.error('Fehler beim Laden der Periode-Ausgaben:', err));
    return () => { cancelled = true; };
  }, [selectedPeriodeId, abrechnungsperioden]);

  // Liste der Ausgaben mit fehlenden Pflichtwerten (Seitenzahl / Stapelzahl)
  // oder ohne Kennzeichen „Erfassung erledigt" im Zusammentragen.
  const ausgabenMitFehlendenWerten = periodenAusgaben
    .map((a) => {
      const fehlend: string[] = [];
      if (!a.seitenzahl || a.seitenzahl <= 0) fehlend.push('Seitenzahl');
      if (!a.stapelAnzahl || a.stapelAnzahl <= 0) fehlend.push('Anzahl Stapel');
      if (a.erfassungZusammentragenErledigt !== true) fehlend.push('„Erfassung erledigt" (Zusammentragen)');
      return { ausgabe: a, fehlend };
    })
    .filter((x) => x.fehlend.length > 0);
  const periodeIstUnvollstaendig = ausgabenMitFehlendenWerten.length > 0;
  const unvollstaendigHinweis =
    'Erst Seitenzahl und Anzahl Stapel eintragen und „Erfassung erledigt" im Zusammentragen für alle Ausgaben dieser Periode setzen.';

  // Restmengen-Hinweis für den Abschluss: Teilgebiete, die im Durchschnitt der
  // letzten beiden Perioden mehr als 10 Stück Restmenge je Meldung hatten —
  // hier sollte die hinterlegte Menge geprüft / angepasst werden.
  const SCHWELLE_REST_ANPASSUNG = 10;
  const letzteBeidePerioden = juengstePerioden(abrechnungsperioden, 2);
  const [analyseEinsaetze, setAnalyseEinsaetze] = useState<Einsatz[]>([]);
  useEffect(() => {
    if (letzteBeidePerioden.length === 0) {
      setAnalyseEinsaetze([]);
      return;
    }
    let cancelled = false;
    const jahre = Array.from(new Set(letzteBeidePerioden.map((p) => p.jahr)));
    ladeEinsaetzeFuerJahre(jahre)
      .then((list) => { if (!cancelled) setAnalyseEinsaetze(list); })
      .catch((err) => console.error('Fehler beim Laden der Einsätze für den Restmengen-Hinweis:', err));
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [letzteBeidePerioden.map((p) => p.id).join(',')]);
  const restmengenHinweisTgs = analysiereRestmengen(
    analyseEinsaetze,
    letzteBeidePerioden,
    teilgebiete,
  ).filter((t) => t.durchschnittRest > SCHWELLE_REST_ANPASSUNG);

  // Beim Mount + nach Periode-Wechsel die Anzahl der nicht zugeordneten
  // Fahrten holen. Schlank gehalten: nur Anzahl, nicht die Datensätze.
  useEffect(() => {
    let cancelled = false;
    ladeFahrten({})
      .then((alle) => {
        if (cancelled) return;
        const offen = alle.filter((f) => !f.abrechnungsperiodeId).length;
        setUnzugeordneteFahrten(offen);
      })
      .catch((err) => console.error('Fehler beim Laden der Fahrten:', err));
    return () => { cancelled = true; };
  }, [selectedPeriodeId, ergebnisse]);

  const sortedPerioden = [...abrechnungsperioden].sort((a, b) =>
    b.jahr !== a.jahr ? b.jahr - a.jahr : b.monat - a.monat
  );

  const selectedPeriode = sortedPerioden.find((p) => p.id === selectedPeriodeId);

  // Direkte Vorperiode (Vormonat), sofern sie eine nachträgliche
  // Änderungsmitteilung mit „in Folgeperiode zu berücksichtigen" trägt.
  const vorperiodeMitHinweis = (() => {
    if (!selectedPeriode) return undefined;
    const vmJahr = selectedPeriode.monat === 1 ? selectedPeriode.jahr - 1 : selectedPeriode.jahr;
    const vmMonat = selectedPeriode.monat === 1 ? 12 : selectedPeriode.monat - 1;
    const vp = abrechnungsperioden.find((p) => p.jahr === vmJahr && p.monat === vmMonat);
    return vp?.echtabrechnung && vp.inFolgeperiodeBeruecksichtigen && vp.lohnbueroAenderungsmitteilung?.trim()
      ? vp
      : undefined;
  })();

  async function handleBerechnen() {
    if (!selectedPeriode || !params) return;
    setLoading(true);
    setFehler('');
    setErgebnisse(null);
    setExpandedId(null);
    setVorarbeitOhneFreigabe([]);

    // Bei abgeschlossenen Perioden mit gespeichertem Abrechnungs-Snapshot:
    // direkt das gespeicherte Ergebnis laden, NICHT neu berechnen.
    if (
      selectedPeriode.status === 'abgeschlossen' &&
      selectedPeriode.abrechnungSnapshot?.ergebnisse
    ) {
      setErgebnisse(
        selectedPeriode.abrechnungSnapshot.ergebnisse as MitarbeiterAbrechnung[]
      );
      setLoading(false);
      return;
    }

    try {
      // Sonderzahlungen frisch laden (nicht aus einem Listener) — nach dem
      // Speichern im Detail wird direkt neu berechnet, ein Listener-Stand
      // könnte da noch veraltet sein.
      const [data, lohnkontoFresh, externeFresh, sonderzahlungenFresh] = await Promise.all([
        ladePeriodeData(selectedPeriode),
        ladeLohnkontoBuchungen(),
        ladeExterneAbrechnungswerte(selectedPeriode.id),
        ladeSonderzahlungen(selectedPeriode.id),
      ]);
      setVorarbeitOhneFreigabe(ermittleVorarbeitOhneFreigabe(data, mitarbeiter));
      const result = berechneAbrechnung(
        mitarbeiter,
        teilgebiete,
        data,
        params,
        selectedPeriode,
        variablePeriodenZusaetze,
        abrechnungsperioden,
        lohnkontoFresh,
        externeFresh,
        sonderzahlungenFresh
      );
      setErgebnisse(result);
    } catch (e: any) {
      setFehler(e.message ?? 'Fehler bei der Berechnung');
    } finally {
      setLoading(false);
    }
  }

  // Auto-Anzeige bei Periodenwechsel: wenn die ausgewählte Periode bereits
  // einen gespeicherten Abrechnungs-Snapshot hat (= abgeschlossen), zeige ihn
  // sofort an, damit der User nicht erst „Berechnen" klicken muss.
  useEffect(() => {
    if (!selectedPeriode) {
      setErgebnisse(null);
      return;
    }
    if (
      selectedPeriode.status === 'abgeschlossen' &&
      selectedPeriode.abrechnungSnapshot?.ergebnisse
    ) {
      setErgebnisse(
        selectedPeriode.abrechnungSnapshot.ergebnisse as MitarbeiterAbrechnung[]
      );
    } else {
      // Bei Wechsel auf eine offene Periode: alte Ergebnisse verwerfen,
      // erneuter „Berechnen"-Klick ist nötig.
      setErgebnisse(null);
    }
    setExpandedId(null);
    setAbschliessenBestaetigt(false);
    setVorarbeitOhneFreigabe([]);
    // selectedPeriodeId reicht als Trigger; wir wollen NICHT auf jede
    // Änderung von `abrechnungsperioden` re-rendern.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPeriodeId, selectedPeriode?.abrechnungSnapshot]);

  async function handleExport() {
    if (!selectedPeriode || !ergebnisse) return;
    setExportierend(true);
    try {
      // Vollständiges Perioden-Archiv: alle Bewegungs- und Stammdaten laden,
      // damit der Export ohne erneutes Öffnen der Periode auskunftsfähig ist.
      const [periodeData, lohnkontoBuchungen] = await Promise.all([
        ladePeriodeData(selectedPeriode).catch((err) => {
          console.error('Periodendaten für Archiv-Export nicht ladbar:', err);
          return undefined;
        }),
        ladeLohnkontoBuchungen().catch((err) => {
          console.error('Lohnkonto-Buchungen für Archiv-Export nicht ladbar:', err);
          return undefined;
        }),
      ]);
      await exportiereAbrechnung(selectedPeriode, ergebnisse, {
        periodeData,
        alleMitarbeiter: mitarbeiter,
        teilgebiete,
        parameter: params ?? undefined,
        variablePeriodenZusaetze,
        stueckzahlAnpassungen,
        lohnkontoBuchungen,
        abrechnungsperioden,
      });
    } catch (e: any) {
      alert('Export fehlgeschlagen: ' + (e.message ?? e));
    } finally {
      setExportierend(false);
    }
  }

  async function handleExportLohnuebermittlung() {
    if (!selectedPeriode || !ergebnisse) return;
    setExportierend(true);
    try {
      await exportiereLohnuebermittlung(selectedPeriode, ergebnisse, mitarbeiter, mitarbeiterMemos, memoKategorienEigene);
    } catch (e: any) {
      alert('Export fehlgeschlagen: ' + (e.message ?? e));
    } finally {
      setExportierend(false);
    }
  }

  // Excel-Datei einlesen und Vorschau aufbauen (schreibt noch nicht).
  async function handleExcelDatei(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // erlaubt erneute Auswahl derselben Datei
    if (!file || !selectedPeriode) return;
    try {
      const buf = await file.arrayBuffer();
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buf);

      // Blattwahl: Die Standard-Upload-Datei hat genau EIN Blatt mit den
      // Spalten Nr. | P-Nr. | Name | Gesamtsumme → dann dieses nehmen. Wird
      // versehentlich die große Mappe hochgeladen (viele Monatsblätter), das
      // zur Periode passende „JAHR-MM Liste"-Blatt wählen.
      const mm = String(selectedPeriode.monat).padStart(2, '0');
      const prefix = `${selectedPeriode.jahr}${mm}`;
      const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
      const ws =
        wb.worksheets.length === 1
          ? wb.worksheets[0]
          : wb.worksheets.find((w) => norm(w.name).startsWith(prefix) && norm(w.name).includes('liste')) ??
            wb.worksheets.find((w) => norm(w.name) === prefix);
      if (!ws) {
        const verfuegbar = wb.worksheets
          .map((w) => w.name)
          .filter((n) => /liste/i.test(n))
          .join(', ');
        alert(
          `Die Datei hat mehrere Blätter, aber kein Blatt „${selectedPeriode.jahr}-${mm} Liste".\n\n` +
            `Vorhandene Listen-Blätter:\n${verfuegbar || '(keine)'}\n\n` +
            `Tipp: Eine Datei mit nur einem Blatt (Nr. | P-Nr. | Name | Gesamtsumme) hochladen.`
        );
        return;
      }

      const matched: { mitarbeiterId: string; name: string; nummer: string; betrag: number; alt?: number }[] = [];
      const unmatched: { nummer?: string; name?: string; betrag: number }[] = [];
      const gesehen = new Set<string>();

      ws.eachRow((row) => {
        const werte: (string | number)[] = [];
        row.eachCell({ includeEmpty: false }, (cell) => {
          let v: unknown = cell.value;
          if (v && typeof v === 'object') {
            const obj = v as Record<string, unknown>;
            if ('result' in obj) v = obj.result; // Formel
            else if ('text' in obj) v = obj.text; // RichText / Hyperlink
          }
          if (v != null && (typeof v === 'string' || typeof v === 'number')) werte.push(v);
        });
        if (werte.length === 0) return;

        let nummer: string | undefined;
        let name: string | undefined;
        const betragKandidaten: number[] = [];
        for (const v of werte) {
          const s = String(v).trim();
          if (!nummer && /^\d{5}$/.test(s)) {
            nummer = s;
            continue;
          }
          if (typeof v === 'number') {
            betragKandidaten.push(v);
          } else if (/[a-zA-ZäöüÄÖÜß]/.test(s)) {
            if (!name) name = s;
          } else {
            const n = parseEuro(s);
            if (n != null && /\d/.test(s)) betragKandidaten.push(n);
          }
        }
        if (!nummer) return; // Header- oder Leerzeile
        const betrag = betragKandidaten.length ? betragKandidaten[betragKandidaten.length - 1] : NaN;
        if (!Number.isFinite(betrag) || betrag <= 0) return;
        if (gesehen.has(nummer)) return;
        gesehen.add(nummer);

        const ma = mitarbeiter.find((m) => m.nummer === nummer);
        if (ma) {
          const alt = externeAbrechnungswerte.find(
            (x) => x.mitarbeiterId === ma.id && x.abrechnungsperiodeId === selectedPeriode.id
          )?.betragEur;
          matched.push({ mitarbeiterId: ma.id, name: ma.name, nummer, betrag, alt });
        } else {
          unmatched.push({ nummer, name, betrag });
        }
      });

      if (matched.length === 0 && unmatched.length === 0) {
        alert(
          'Keine verwertbaren Zeilen erkannt. Erwartet werden je Zeile: eine 5-stellige Mitarbeiter-Nummer und ein Betrag (EUR).'
        );
        return;
      }
      setExcelVorschau({ matched, unmatched });
    } catch (err: any) {
      alert('Datei konnte nicht gelesen werden: ' + (err.message ?? err));
    }
  }

  // Vorschau bestätigen → externe Werte schreiben und neu berechnen.
  async function handleExcelUebernehmen() {
    if (!excelVorschau || !selectedPeriode) return;
    setExcelSchreibt(true);
    try {
      for (const m of excelVorschau.matched) {
        await setzeExterneAbrechnungswert(selectedPeriode.id, m.mitarbeiterId, m.betrag, 'excel');
      }
      setExcelVorschau(null);
      await handleBerechnen();
    } catch (e: any) {
      alert('Import fehlgeschlagen: ' + (e.message ?? e));
    } finally {
      setExcelSchreibt(false);
    }
  }

  async function handlePeriodeAbschliessen() {
    if (!selectedPeriode) return;
    if (!ergebnisse) {
      alert('Bitte zuerst auf „Berechnen" klicken — das Ergebnis wird mit der Periode gespeichert.');
      return;
    }
    if (!selectedPeriode.monatswechselSnapshot) {
      alert(
        'Vor dem Abschluss muss der Monatswechsel durchgeführt werden.\n\n' +
          'Klicke zuerst auf „📌 Monatswechsel durchführen", um Austragen und Zusammentragen zu fixieren.'
      );
      setAbschliessenBestaetigt(false);
      return;
    }
    try {
      // 1) Alle MA in der Abmelde-Liste dieser Periode auf abgemeldet=true
      //    + isActive=false (deaktiviert) setzen. Vor dem Snapshot, damit
      //    der MA-Status im Snapshot stimmt.
      const heuteIso = new Date().toISOString().slice(0, 10);
      const abzumelden = offeneAbmeldungen(selectedPeriode, mitarbeiter);

      // Hinweis: MAs, die noch Standardausträger eines Teilgebiets sind
      const tgsMitOffenemAustraeger = abzumelden
        .map((m) => ({
          ma: m,
          tgs: teilgebiete.filter((tg) => tg.standardAustraegerId === m.id && tg.isActive),
        }))
        .filter((x) => x.tgs.length > 0);

      if (tgsMitOffenemAustraeger.length > 0) {
        const lines = tgsMitOffenemAustraeger
          .map((x) =>
            `• ${x.ma.name} (${x.ma.nummer}) — Teilgebiete: ${x.tgs.map((t) => t.name).join(', ')}`
          )
          .join('\n');
        if (
          !confirm(
            'Folgende Mitarbeiter werden abgemeldet und deaktiviert, sind aber noch Standardausträger:\n\n' +
              lines +
              '\n\nNach dem Abschluss muss für diese Teilgebiete ein neuer Austräger zugeordnet werden.\n\n' +
              'Trotzdem fortfahren?'
          )
        ) {
          setAbschliessenBestaetigt(false);
          return;
        }
      }

      // Snapshot-Einträge sammeln BEVOR die Felder am MA geschrieben werden
      // (sonst wäre m.abmeldungUebermittlungDatum noch nicht final). Pro MA
      // mit Name, Nummer, effektivem Abmeldedatum und ggf. ersetztDurchId.
      const abmeldungenEintraege = abzumelden.map((m) => {
        const ersetzendeMa = mitarbeiter.find((x) => x.ersetztMitarbeiterId === m.id);
        return {
          mitarbeiterId: m.id,
          name: m.name,
          nummer: m.nummer,
          abmeldedatum: m.abmeldungUebermittlungDatum ?? heuteIso,
          ersetztDurchId: ersetzendeMa?.id,
        };
      });

      for (const m of abzumelden) {
        await aktualisiereMitarbeiterMitProtokoll(m, {
          abgemeldet: true,
          abmeldungUebermittlungDatum: m.abmeldungUebermittlungDatum ?? heuteIso,
          letzteAbrechnungsperiodeId: selectedPeriode.id,
          isActive: false,
        }, {
          adminName,
          ktx: { mitarbeiter, teilgebiete, abrechnungsperioden },
          praefix: `Periodenabschluss ${selectedPeriode.bezeichnung}: `,
          automatisch: true,
        });
      }
      // 2) Berechnetes Ergebnis als Snapshot mitschreiben — danach lassen sich
      //    die historischen Werte ohne Neu-Berechnung jederzeit anzeigen.
      //    Plus Abmelde-Liste als eigener Snapshot — bleibt auch nach
      //    Wieder-Öffnen der Periode erhalten (Verwerfen ändert die
      //    Ansicht nicht).
      await schliessePeriodeAb(
        selectedPeriode.id,
        teilgebiete,
        params,
        ergebnisse,
        abmeldungenEintraege
      );
    } catch (e: any) {
      alert('Fehler beim Abschließen: ' + (e.message ?? e));
    }
    setAbschliessenBestaetigt(false);
  }

  async function handleMonatswechsel() {
    if (!selectedPeriode) return;
    if (!ergebnisse) {
      alert('Bitte zuerst auf „Berechnen" klicken — der Monatswechsel-Snapshot wird aus dem aktuellen Ergebnis gebildet.');
      return;
    }
    try {
      await schreibeMonatswechselSnapshot(
        selectedPeriode.id,
        teilgebiete,
        params,
        ergebnisse
      );
      setMonatswechselBestaetigt(false);
      // Frisch laden, damit das Banner sofort sichtbar ist und die fixierten
      // Werte zukünftige Berechnungen greifen.
      await handleBerechnen();
      // Vorgemerkte Stückzahl-Anpassungen anbieten.
      if (stueckzahlAnpassungen.length > 0) {
        setZeigeAnpassungDialog(true);
      }
      // Wechselpläne (PlanungScreen), deren letzte Ausgabe in dieser Periode
      // liegt — plus TGs, in denen ein Springer mit „übernimmt dauerhaft"
      // in einer KW der Periode markiert ist. Beides fließt in den
      // WechselplanUebernahmeDialog. Quelle: Wechselpläne, deren
      // letzteAusgabe in dieser Periode liegt, ODER (für seit-Beginn
      // unbesetzte TGs ohne letzteAusgabe) Wechselpläne, deren
      // abAusgabe in dieser Periode liegt. Damit erfasst der Dialog
      // beide Varianten der vereinheitlichten Wechsel-Sektion.
      const relevanteWechselplaene = wechselplaene.filter((p) =>
        istRelevanterWechselplan(p, selectedPeriode, abrechnungsperioden),
      );
      if (relevanteWechselplaene.length > 0) {
        setZeigeWechselplanDialog(true);
      }
    } catch (e: any) {
      alert('Fehler beim Monatswechsel: ' + (e.message ?? e));
    }
  }

  async function handleMonatswechselVerwerfen() {
    if (!selectedPeriode) return;
    if (!confirm(
      'Monatswechsel-Snapshot wirklich verwerfen?\n\n' +
        'Die fixierten Werte für Austragen und Zusammentragen werden gelöscht; ' +
        'beim nächsten Berechnen wird wieder live aus den aktuellen Stammdaten gerechnet.'
    )) return;
    try {
      await verwerfeMonatswechselSnapshot(selectedPeriode.id);
      await handleBerechnen();
    } catch (e: any) {
      alert('Fehler beim Verwerfen: ' + (e.message ?? e));
    }
  }

  async function handlePeriodeWiederOeffnen() {
    if (!selectedPeriode) return;
    const echtHinweis = selectedPeriode.echtabrechnung
      ? '\n\n⚠ Die Periode ist als Echtabrechnung gekennzeichnet (an das Lohnbüro übermittelt). Korrekturen ggf. als Änderungsmitteilung festhalten.'
      : '';
    if (!confirm(`Periode "${selectedPeriode.bezeichnung}" wieder öffnen? Alle Daten bleiben erhalten, Eingaben sind wieder möglich.${echtHinweis}`)) return;
    await oeffnePeriodeWieder(selectedPeriode.id);
  }

  // "gesamtSumme" zeigt die Summe der erbrachten Leistungen (vor Lohnkonto-Verschiebung)
  const gesamtSumme = ergebnisse?.reduce((s, e) => s + e.gesamt, 0) ?? 0;
  // Brutto-Lohnbüro = was tatsächlich übermittelt wird (nach Lohnkonto-Bewegung)
  const gesamtBruttoLohnbuero = ergebnisse?.reduce((s, e) => s + e.bruttoLohnbuero, 0) ?? 0;
  const gesamtVorschuesse = ergebnisse?.reduce((s, e) => s + e.vorschussSumme, 0) ?? 0;
  const gesamtVerschiebung = ergebnisse?.reduce((s, e) => s + e.lohnkontoVerschiebungPeriode, 0) ?? 0;
  const gesamtVerrechnung = ergebnisse?.reduce((s, e) => s + e.lohnkontoVerrechnungPeriode, 0) ?? 0;
  // Auszahlung nur bei SV-befreiten Mitarbeitern (Brutto = Netto).
  const gesamtNetto = ergebnisse
    ?.filter((e) => e.mitarbeiter.sozialversicherungsBefreit)
    .reduce((s, e) => s + (e.bruttoLohnbuero - e.vorschussSumme), 0) ?? 0;

  // Minijob-Grenze-Überschreitungen — auf Basis des sozialversicherungspflichtigen
  // Lohns OHNE Fahrtkosten (Aufwandsersatz, steuerfrei). Warnung erst bei echtem
  // Überschreiten (gleicher Betrag = ok).
  const minijobGrenze = params?.minijobGrenzeEurProMonat ?? 556;
  const lohnOhneFaKo = (e: MitarbeiterAbrechnung) => e.bruttoLohnbuero - (e.fahrtkostenGesamt ?? 0);
  const minijobUeberschreiter = ergebnisse
    ?.filter((e) => e.mitarbeiter.istMinijob && lohnOhneFaKo(e) > minijobGrenze) ?? [];

  // Individuelle Lohngrenze (z. B. weitere Minijobs, vertragliche Höchstgrenze)
  // — ebenfalls ohne Fahrtkosten.
  const individuelleLohngrenzeUeberschreiter = ergebnisse?.filter((e) => {
    const grenze = e.mitarbeiter.lohngrenzeIndividuellEur ?? 0;
    return grenze > 0 && lohnOhneFaKo(e) > grenze;
  }) ?? [];

  // Noch nicht angemeldete MAs, die in dieser Abrechnung Beträge bekommen
  const nichtAngemeldeteWarnung = ergebnisse?.filter((e) => e.mitarbeiter.nochNichtAngemeldet) ?? [];

  // Abgemeldete MAs, die in einer Periode NACH ihrer Abmeldung Beträge
  // bekommen (z. B. als Springer eingeplant, noch Standardausträger).
  const abgemeldeteWarnung = selectedPeriode
    ? ergebnisse?.filter((e) => istPeriodeNachAbmeldung(e.mitarbeiter, selectedPeriode, abrechnungsperioden)) ?? []
    : [];

  // Dummy-MA „90000" — wird verwendet, wenn der tatsächliche MA anonym
  // sein soll. Darf NIE einen Betrag in der Abrechnung tragen — sonst
  // Hinweis auf eine fehlerhafte Zuordnung.
  const dummyMaWarnung = ergebnisse?.filter(
    (e) => e.mitarbeiter.nummer === '90000' && e.bruttoLohnbuero > 0,
  ) ?? [];

  // Festgehalt-MAs mit hinterlegter Soll-Wochen-/Monatsstunden:
  // vergleiche die im Monat tatsächlich erfassten IST-Stunden gegen die
  // erwartete monatliche Soll-Zeit. Soll-Zeit ergibt sich aus
  // `monatsstundenFestgehalt` (direkt) oder aus `wochenstundenFestgehalt * 52/12`.
  // Warnung erscheint, sobald IST > SOLL. IST = Summe aller
  // abgeschlossenen Arbeitszeiten der Periode (bei Festgehalt liegen
  // diese in `arbeitszeitenNichtAbgerechnet`, da Festgehalt-MAs keine
  // Stunden-Vergütung haben).
  const festgehaltSollIstWarnung = (ergebnisse ?? [])
    .map((e) => {
      const m = e.mitarbeiter;
      if (!m.hatFestgehalt) return null;
      const sollMonat = m.monatsstundenFestgehalt
        ?? (m.wochenstundenFestgehalt != null
          ? m.wochenstundenFestgehalt * 52 / 12
          : 0);
      if (sollMonat <= 0) return null;
      const istMin = [...e.arbeitszeitenNichtAbgerechnet, ...e.arbeitszeiten]
        .reduce((s, a) => s + berechneNettoMinuten(a), 0);
      const istStunden = istMin / 60;
      if (istStunden <= sollMonat) return null;
      return { e, sollMonat, istStunden, ueber: istStunden - sollMonat };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  const suchbegriffNorm = suchbegriff.trim().toLowerCase();
  const gefilterteErgebnisse = ergebnisse
    ? ergebnisse.filter((er) => {
        if (suchbegriffNorm) {
          const passt =
            er.mitarbeiter.name.toLowerCase().includes(suchbegriffNorm) ||
            er.mitarbeiter.nummer.toLowerCase().includes(suchbegriffNorm);
          if (!passt) return false;
        }
        if (filterRolle && !er.mitarbeiter.rollen.includes(filterRolle)) return false;
        if (filterMinijob === 'ja' && !er.mitarbeiter.istMinijob) return false;
        if (filterMinijob === 'nein' && er.mitarbeiter.istMinijob) return false;
        if (filterSvFrei === 'ja' && !er.mitarbeiter.sozialversicherungsBefreit) return false;
        if (filterSvFrei === 'nein' && er.mitarbeiter.sozialversicherungsBefreit) return false;
        if (filterLohnkontoSaldo) {
          // In Cent vergleichen, damit Float-Reste nicht als Saldo zählen.
          const hatSaldo = Math.round((er.lohnkontoSaldoNachPeriode ?? 0) * 100) !== 0;
          if (filterLohnkontoSaldo === 'ja' && !hatSaldo) return false;
          if (filterLohnkontoSaldo === 'nein' && hatSaldo) return false;
        }
        return true;
      })
    : [];

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Monatsabrechnung</h1>

      {/* Vorschau-Dialog Excel-Import „Werte externe Anwendung" */}
      {excelVorschau && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => !excelSchreibt && setExcelVorschau(null)}
        >
          <div
            className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[85vh] overflow-auto p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-bold text-gray-900 mb-1">Externe Werte übernehmen</h2>
            <p className="text-sm text-gray-600 mb-4">
              Periode <strong>{selectedPeriode?.bezeichnung}</strong> — Zuordnung über die
              5-stellige Mitarbeiter-Nummer. Bestehende externe Werte dieser Mitarbeiter werden
              überschrieben.
            </p>

            {excelVorschau.matched.length > 0 ? (
              <div className="rounded-lg border border-gray-200 overflow-hidden mb-3">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-gray-600 text-xs border-b border-gray-200">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">Nr.</th>
                      <th className="px-3 py-2 text-left font-medium">Mitarbeiter</th>
                      <th className="px-3 py-2 text-right font-medium">bisher</th>
                      <th className="px-3 py-2 text-right font-medium">neu</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {excelVorschau.matched.map((m) => (
                      <tr key={m.mitarbeiterId}>
                        <td className="px-3 py-1.5 text-gray-500">{m.nummer}</td>
                        <td className="px-3 py-1.5 text-gray-900">{m.name}</td>
                        <td className="px-3 py-1.5 text-right text-gray-400">
                          {m.alt != null ? eur(m.alt) : '—'}
                        </td>
                        <td className="px-3 py-1.5 text-right font-medium text-blue-800">
                          {eur(m.betrag)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 mb-3">
                Keine der Zeilen konnte einem Mitarbeiter zugeordnet werden.
              </div>
            )}

            {excelVorschau.unmatched.length > 0 && (
              <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 mb-3">
                <div className="font-semibold mb-1">
                  {excelVorschau.unmatched.length} Zeile
                  {excelVorschau.unmatched.length === 1 ? '' : 'n'} ohne Zuordnung (Nummer nicht
                  gefunden) — werden übersprungen:
                </div>
                <ul className="list-disc list-inside text-xs space-y-0.5">
                  {excelVorschau.unmatched.map((u, i) => (
                    <li key={i}>
                      Nr. {u.nummer ?? '?'}
                      {u.name ? ` — ${u.name}` : ''} — {eur(u.betrag)}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="flex justify-end gap-2 mt-4">
              <button
                onClick={() => setExcelVorschau(null)}
                disabled={excelSchreibt}
                className="px-4 py-2 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100 disabled:opacity-50"
              >
                Abbrechen
              </button>
              <button
                onClick={handleExcelUebernehmen}
                disabled={excelVorschau.matched.length === 0 || excelSchreibt}
                className="bg-teal-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-teal-700 transition-colors disabled:opacity-50"
              >
                {excelSchreibt
                  ? 'Speichere…'
                  : `${excelVorschau.matched.length} Wert${
                      excelVorschau.matched.length === 1 ? '' : 'e'
                    } übernehmen`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Periodenauswahl + Steuerung */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 mb-6">
        <div className="flex flex-wrap items-center gap-3">
          <label className="text-sm font-medium text-gray-700 shrink-0">Periode:</label>
          <select
            value={selectedPeriodeId}
            onChange={(e) => {
              setSelectedPeriodeId(e.target.value);
              setErgebnisse(null);
              setAbschliessenBestaetigt(false);
            }}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">— Periode auswählen —</option>
            {sortedPerioden.map((p) => (
              <option key={p.id} value={p.id}>
                {p.bezeichnung}
                {p.status === 'abgeschlossen' ? ' ✓' : ''}
                {p.echtabrechnung ? ' · Echtabrechnung' : ''}
                {' '}(KW {p.kalenderwochen.join(', ')})
              </option>
            ))}
          </select>

          {(() => {
            const istGespeicherterStand =
              selectedPeriode?.status === 'abgeschlossen' &&
              !!selectedPeriode.abrechnungSnapshot;
            const buttonText = loading
              ? istGespeicherterStand ? 'Lade…' : 'Berechne…'
              : istGespeicherterStand ? 'Anzeigen (gespeicherter Stand)' : 'Berechnen';
            return (
              <button
                onClick={handleBerechnen}
                disabled={!selectedPeriodeId || loading || !params}
                className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                title={
                  istGespeicherterStand
                    ? 'Lädt das beim Abschließen gespeicherte Ergebnis'
                    : 'Berechnet die Abrechnung neu auf Basis der aktuellen Daten'
                }
              >
                {buttonText}
              </button>
            );
          })()}

          {ergebnisse && (
            <>
              <button
                onClick={handleExport}
                disabled={exportierend}
                className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-green-700 transition-colors disabled:opacity-50"
                title="Vollständiges Perioden-Archiv: Übersicht, Austräger, Zeiten, Zusammentragen, Fahrten, Vorschüsse/Boni, MA-Stammdaten, Teilgebiete & Straßen, Ausgaben, Beilagenaufträge und verwendete Parameter"
              >
                {exportierend ? 'Exportiere...' : '↓ Excel-Export'}
              </button>
              <button
                onClick={handleExportLohnuebermittlung}
                disabled={exportierend}
                className="bg-emerald-700 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-emerald-800 transition-colors disabled:opacity-50"
                title="Schlanker Excel-Export für das Lohnbüro: nur Vorschuss, Bruttolohn, Fahrtkosten + An-/Abmeldungen"
              >
                {exportierend ? 'Exportiere...' : '✉ Lohnübermittlung'}
              </button>

              {selectedPeriode?.status === 'offen' && (
                <>
                  <input
                    ref={excelInputRef}
                    type="file"
                    accept=".xlsx,.xls"
                    className="hidden"
                    onChange={handleExcelDatei}
                  />
                  <button
                    onClick={() => excelInputRef.current?.click()}
                    disabled={excelSchreibt}
                    className="bg-teal-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-teal-700 transition-colors disabled:opacity-50"
                    title="Werte der externen Anwendung (Austragen + Zusammentragen + Vorarbeit) als Excel hochladen — Zuordnung über die 5-stellige Mitarbeiter-Nummer"
                  >
                    ⇪ Externe Werte (Excel)
                  </button>
                </>
              )}

              {selectedPeriode?.status === 'offen' && (
                <div className="ml-auto flex items-center gap-2 flex-wrap">
                  {/* Monatswechsel-Status / -Button */}
                  {selectedPeriode.monatswechselSnapshot ? (
                    <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-1.5">
                      <span className="text-sm text-emerald-800 font-medium">
                        ✓ Monatswechsel durchgeführt am{' '}
                        {new Date(selectedPeriode.monatswechselSnapshot.erstelltAm).toLocaleDateString('de-DE')}
                      </span>
                      {userRole === 'admin' && (
                        <button
                          onClick={handleMonatswechselVerwerfen}
                          className="text-xs text-emerald-700 hover:text-red-600 underline"
                          title="Snapshot verwerfen — beim nächsten Berechnen wird wieder live aus den aktuellen Stammdaten gerechnet"
                        >
                          verwerfen
                        </button>
                      )}
                    </div>
                  ) : !monatswechselBestaetigt ? (
                    <button
                      onClick={() => setMonatswechselBestaetigt(true)}
                      disabled={periodeIstUnvollstaendig}
                      className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${
                        periodeIstUnvollstaendig
                          ? 'bg-gray-50 text-gray-400 border-gray-200 cursor-not-allowed'
                          : 'bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100'
                      }`}
                      title={
                        periodeIstUnvollstaendig
                          ? unvollstaendigHinweis
                          : 'Fixiert Austragen und Zusammentragen vor dem Wechsel der Standardausträger'
                      }
                    >
                      📌 Monatswechsel durchführen
                    </button>
                  ) : (
                    <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-lg px-3 py-1.5">
                      <span className="text-sm text-blue-800">
                        Alle Tätigkeiten wurden erfasst (Zusammentragen und Austragen)?
                      </span>
                      <button
                        onClick={handleMonatswechsel}
                        className="bg-blue-600 text-white px-3 py-1.5 rounded text-sm font-medium hover:bg-blue-700 transition-colors"
                      >
                        Ja, Snapshot erstellen
                      </button>
                      <button
                        onClick={() => setMonatswechselBestaetigt(false)}
                        className="text-sm text-gray-500 hover:text-gray-700"
                      >
                        Abbrechen
                      </button>
                    </div>
                  )}

                  {/* Periode abschließen — nur möglich nach Monatswechsel */}
                  {!abschliessenBestaetigt ? (
                    <button
                      onClick={() => setAbschliessenBestaetigt(true)}
                      disabled={!selectedPeriode?.monatswechselSnapshot || periodeIstUnvollstaendig}
                      className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                        selectedPeriode?.monatswechselSnapshot && !periodeIstUnvollstaendig
                          ? 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                          : 'bg-gray-50 text-gray-400 cursor-not-allowed'
                      }`}
                      title={
                        periodeIstUnvollstaendig
                          ? unvollstaendigHinweis
                          : selectedPeriode?.monatswechselSnapshot
                            ? 'Schließt die Periode ab und speichert das aktuelle Berechnungsergebnis als Snapshot'
                            : 'Erst Monatswechsel durchführen, dann kann abgeschlossen werden'
                      }
                    >
                      🔒 Periode abschließen &amp; speichern
                    </button>
                  ) : (
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-orange-700">
                        Periode abschließen und das aktuelle Ergebnis speichern?
                      </span>
                      <button
                        onClick={handlePeriodeAbschliessen}
                        className="bg-orange-600 text-white px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-orange-700 transition-colors"
                      >
                        Ja, abschließen &amp; speichern
                      </button>
                      <button
                        onClick={() => setAbschliessenBestaetigt(false)}
                        className="text-sm text-gray-500 hover:text-gray-700"
                      >
                        Abbrechen
                      </button>
                    </div>
                  )}
                </div>
              )}
              {selectedPeriode?.status === 'abgeschlossen' && (
                <div className="ml-auto flex items-center gap-2">
                  <span className="text-sm bg-green-100 text-green-700 px-3 py-1.5 rounded-lg font-medium">
                    ✓ Abgeschlossen
                  </span>
                  {userRole === 'admin' && (
                    <button
                      onClick={handlePeriodeWiederOeffnen}
                      className="text-xs text-gray-500 hover:text-orange-600 underline"
                      title="Periode wieder öffnen (nur Admin)"
                    >
                      Entsperren
                    </button>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {fehler && (
          <div className="mt-3 bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
            {fehler}
          </div>
        )}

        {/* Kennzeichen „Echtabrechnung" + Übermittlung an das Lohnbüro */}
        {selectedPeriode && <LohnbueroUebermittlungBlock periode={selectedPeriode} />}

        {/* Hinweis aus der Vorperiode: nachträgliche Änderungsmitteilung an das
            Lohnbüro, die in dieser Periode zu berücksichtigen/prüfen ist. */}
        {vorperiodeMitHinweis && (
          <div className="mt-3 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm">
            <div className="font-semibold text-red-900 mb-1">
              ⚠ Aus {vorperiodeMitHinweis.bezeichnung} zu berücksichtigen / prüfen
            </div>
            <p className="text-xs text-red-800 mb-1.5">
              Nach der Übermittlung von {vorperiodeMitHinweis.bezeichnung} wurde dem
              Lohnbüro folgende Änderung mitgeteilt:
            </p>
            <div className="text-red-950 whitespace-pre-wrap break-words bg-white/60 border border-red-200 rounded px-3 py-2">
              {vorperiodeMitHinweis.lohnbueroAenderungsmitteilung}
            </div>
            {/^https?:\/\//i.test(vorperiodeMitHinweis.lohnbueroDriveLink ?? '') && (
              <a
                href={vorperiodeMitHinweis.lohnbueroDriveLink}
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-flex items-center text-xs border border-blue-200 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded px-2 py-1"
              >
                🔗 Unterlagen {vorperiodeMitHinweis.bezeichnung} in Google Drive
              </a>
            )}
          </div>
        )}

        {/* Warnung: Ausgaben der Periode mit fehlenden Pflichtwerten */}
        {selectedPeriode && ausgabenMitFehlendenWerten.length > 0 && (
          <div className="mt-3 rounded-lg border border-amber-400 bg-amber-50 px-4 py-3 text-sm">
            <div className="font-semibold text-amber-900 mb-1">
              ⚠ Ausgaben der Periode unvollständig — Monatsabschluss gesperrt
            </div>
            <p className="text-xs text-amber-800 mb-1.5">
              Bei folgenden Ausgaben dieser Periode fehlen Angaben. Solange
              Angaben fehlen, sind Monatswechsel und Periodenabschluss gesperrt:
            </p>
            <ul className="list-disc list-inside text-amber-900 space-y-0.5">
              {ausgabenMitFehlendenWerten.map(({ ausgabe: a, fehlend }) => (
                <li key={a.id} className="text-xs">
                  <strong>KW {a.kw}/{a.jahr}</strong> — fehlt: {fehlend.join(', ')}
                </li>
              ))}
            </ul>
            <p className="text-xs text-amber-700 mt-1.5 italic">
              Seitenzahl / Anzahl Stapel unter „Ausgaben &amp; Beilagen" ergänzen,
              „Erfassung erledigt" unter „Zusammentragen" setzen.
            </p>
          </div>
        )}

        {/* Hinweis: Teilgebiete mit hoher Ø-Restmenge (letzte 2 Perioden) —
            Mengen prüfen und ggf. anpassen. */}
        {selectedPeriode?.status === 'offen' && restmengenHinweisTgs.length > 0 && (
          <div className="mt-3 rounded-lg border border-orange-400 bg-orange-50 px-4 py-3 text-sm">
            <div className="font-semibold text-orange-900 mb-1">
              📦 Restmengen-Hinweis — Bitte Anpassung der Mengen prüfen und ggf. anpassen
            </div>
            <p className="text-xs text-orange-800 mb-1.5">
              Folgende Teilgebiete hatten im Durchschnitt der letzten beiden Perioden
              über {SCHWELLE_REST_ANPASSUNG} Stück Restmenge je Meldung:
            </p>
            <ul className="list-disc list-inside text-orange-900 space-y-0.5">
              {restmengenHinweisTgs.map((t) => (
                <li key={t.teilgebietId} className="text-xs">
                  <strong>{t.name}</strong>
                  {t.plz ? ` (${t.plz})` : ''} — Ø{' '}
                  {t.durchschnittRest.toLocaleString('de-DE', { maximumFractionDigits: 1 })} Stück
                  {' '}aus {t.anzahlMeldungen} Meldung{t.anzahlMeldungen === 1 ? '' : 'en'}
                </li>
              ))}
            </ul>
            <p className="text-xs text-orange-700 mt-1.5 italic">
              Hinterlegte Stückzahl unter „Teilgebiete" prüfen und ggf. reduzieren.
            </p>
          </div>
        )}
      </div>

      {/* Warnung: nicht zugeordnete Fahrtkosten — periodenunabhängig */}
      {unzugeordneteFahrten > 0 && (
        <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm flex items-start gap-2">
          <span className="text-amber-700">🚗</span>
          <div className="text-amber-900 flex-1">
            <div className="font-semibold mb-0.5">
              {unzugeordneteFahrten} Fahrtkosten-Datensa{unzugeordneteFahrten === 1 ? 'tz' : 'tz '}
              {unzugeordneteFahrten === 1 ? ' ist' : ' sind'} noch nicht zugeordnet
            </div>
            <p className="text-xs text-amber-800">
              Diese Fahrten haben keinen Periodenbezug („noch nicht zugeordnet")
              und fließen daher in keine Abrechnung ein. Bitte unter „Fahrtkosten"
              prüfen und der passenden Abrechnungsperiode zuordnen.
            </p>
          </div>
        </div>
      )}

      {/* Warnung: Lohnbüro-Daten des direkten (abgeschlossenen) Vormonats
          fehlen noch in der App (= PDFs vom Steuerbüro noch nicht
          indiziert). Bezug: heutiger Kalendermonat → Vormonat. */}
      {(() => {
        const heute = new Date();
        let vmJahr = heute.getFullYear();
        let vmMonat = heute.getMonth(); // 0-basiert = Vormonat (1..12-Logik: getMonth()+1 ist akt. Monat)
        if (vmMonat === 0) { vmMonat = 12; vmJahr -= 1; } // Januar → Dez Vorjahr
        // getMonth() liefert 0..11 für den AKTUELLEN Monat; der Vormonat
        // als 1..12 ist genau getMonth() (da 0-basiert), außer im Januar.
        const vormonatPeriode = abrechnungsperioden.find(
          (p) => p.jahr === vmJahr && p.monat === vmMonat,
        );
        if (!vormonatPeriode || vormonatPeriode.status !== 'abgeschlossen') return null;
        const hatLohnbueroDaten = lohnbueroAbrechnungen.some(
          (a) => a.jahr === vmJahr && a.monat === vmMonat,
        );
        if (hatLohnbueroDaten) return null;
        return (
          <div className="mb-4 rounded-lg border border-orange-300 bg-orange-50 px-4 py-3 text-sm flex items-start gap-2">
            <span className="text-orange-700">🧾</span>
            <div className="text-orange-900 flex-1">
              <div className="font-semibold mb-0.5">
                Lohnbüro-Daten für {vormonatPeriode.bezeichnung} fehlen noch
              </div>
              <p className="text-xs text-orange-800">
                Der direkte Vormonat ist abgeschlossen, aber es liegen noch
                keine vom Steuer-/Lohnbüro gelieferten Abrechnungen in der App
                vor. Bitte die PDFs importieren (Skill „Lohnbüro-PDFs") bzw.
                unter „Abrechnungen Lohnbüro auswerten" prüfen.
              </p>
            </div>
          </div>
        );
      })()}

      {/* Warnung: Lohnbüro-Memos ohne Periodenzuordnung — analog Fahrtkosten */}
      {(() => {
        const sichtbar = mitarbeiterMemos.filter((m) => userRole === 'admin' || !m.nurAdmin);
        const unzugeordneteMemos = sichtbar.filter((m) => !m.abrechnungsperiodeId).length;
        if (unzugeordneteMemos === 0) return null;
        return (
          <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm flex items-start gap-2">
            <span className="text-amber-700">📝</span>
            <div className="text-amber-900 flex-1">
              <div className="font-semibold mb-0.5">
                {unzugeordneteMemos} Memo{unzugeordneteMemos === 1 ? '' : 's'} an das
                Lohnbüro {unzugeordneteMemos === 1 ? 'ist' : 'sind'} noch nicht zugeordnet
              </div>
              <p className="text-xs text-amber-800">
                Diese Memos haben keinen Periodenbezug und werden daher in keiner
                Lohnübermittlung mitgeschickt. Bitte unter „Abrechnungsvorbereitung"
                prüfen und der passenden Abrechnungsperiode zuordnen.
              </p>
            </div>
          </div>
        );
      })()}

      {/* Warnung: erfasste Vorarbeit ohne Freigabe der Ausgabe —
          diese Zeiten werden NICHT abgerechnet (vgl. Lohnberechnung). */}
      {vorarbeitOhneFreigabe.length > 0 && (
        <div className="mb-4 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm flex items-start gap-2">
          <span className="text-red-700">⏱️</span>
          <div className="text-red-900 flex-1">
            <div className="font-semibold mb-0.5">
              Erfasste Vorarbeit ohne Freigabe — wird NICHT abgerechnet
            </div>
            <p className="text-xs text-red-800 mb-2">
              Folgende Mitarbeiter haben Zeiten als „Vorarbeit" erfasst, deren
              Ausgabe nicht für Vorarbeit freigegeben ist. Diese Stunden fließen
              daher in keinen Lohn ein. Bitte unter „Ausgaben" die Vorarbeit
              freigeben (dann erneut berechnen) oder die Zeiten korrigieren.
            </p>
            <ul className="text-xs text-red-900 space-y-0.5">
              {vorarbeitOhneFreigabe.map((v) => (
                <li key={v.name}>
                  <span className="font-medium">{v.name}</span>: {stdMin(v.minuten / 60)}
                  {' '}(KW {v.kws.join(', ')})
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* Ergebnisse */}
      {ergebnisse && (
        <>
          {/* Hinweis-Banner: gespeicherter Snapshot */}
          {selectedPeriode?.status === 'abgeschlossen' && selectedPeriode.abrechnungSnapshot && (
            <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-sm text-blue-800 flex items-center gap-2">
              <span>📦</span>
              <span>
                Gespeicherter Stand vom{' '}
                <span className="font-medium">
                  {new Date(selectedPeriode.abrechnungSnapshot.erstelltAm).toLocaleString('de-DE')}
                </span>
                {' '}— die angezeigten Werte stammen aus dem beim Abschließen
                gespeicherten Snapshot. Spätere Änderungen an Vorschüssen,
                Boni, Lohnkonto-Buchungen etc. wirken sich nicht aus, solange
                die Periode geschlossen bleibt.
              </span>
            </div>
          )}

          {/* Hinweis-Banner: Monatswechsel-Snapshot aktiv (Periode noch offen) */}
          {selectedPeriode?.status === 'offen' && selectedPeriode.monatswechselSnapshot && (
            <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-900 flex items-center gap-2">
              <span>📌</span>
              <span>
                <span className="font-medium">Austragen &amp; Zusammentragen sind fixiert</span>
                {' '}(Stand{' '}
                {new Date(selectedPeriode.monatswechselSnapshot.erstelltAm).toLocaleString('de-DE')}
                ). Stammdaten-Änderungen (Standardausträger, Stückzahlen) wirken sich
                nicht mehr auf diese Periode aus. Vorschüsse, Boni, Lohnkonto,
                Zeiten und Fahrtkosten sind weiter erfassbar. Nachträglich gemeldete
                Ausfälle/Springer werden im Einsätze-Screen, Korrekturen beim
                Zusammentragen im Zusammentragen-Screen je Ausgabe nachgetragen —
                sie wirken nur auf die betroffenen Mitarbeiter.
                {(() => {
                  const betroffen = (ergebnisse ?? []).filter(
                    (er) =>
                      er.austraegerEinsaetze.some((e) => e.nachtrag) ||
                      (er.austraegerEinsaetzeEntfallen?.length ?? 0) > 0 ||
                      er.zusammentragenEinsaetze.some((z) => z.nachtrag) ||
                      (er.zusammentragenEinsaetzeEntfallen?.length ?? 0) > 0
                  );
                  return betroffen.length > 0 ? (
                    <span className="block mt-1 font-medium">
                      Nachträge berücksichtigt bei: {betroffen.map((er) => er.mitarbeiter.name).join(', ')}
                    </span>
                  ) : null;
                })()}
              </span>
            </div>
          )}

          {/* Hinweis-Banner: Vorschau auf den Monatswechsel — welche Teilgebiete
              bekommen einen Standardausträger-Wechsel bzw. eine Mengenänderung,
              wenn jetzt „Monatswechsel durchführen" geklickt wird. */}
          {selectedPeriode?.status === 'offen' && !selectedPeriode.monatswechselSnapshot && (() => {
            const wechselVorschau = wechselplaene
              .filter((p) => istRelevanterWechselplan(p, selectedPeriode, abrechnungsperioden))
              .map((p) => {
                const tg = teilgebiete.find((t) => t.id === p.teilgebietId);
                const bisher = tg?.standardAustraegerId
                  ? mitarbeiter.find((m) => m.id === tg.standardAustraegerId)?.name ?? '?'
                  : null;
                const neu = p.neuerAustraegerId
                  ? mitarbeiter.find((m) => m.id === p.neuerAustraegerId)?.name ?? '?'
                  : null;
                return { id: p.id, tgName: tg?.name ?? '— gelöscht —', tgPlz: tg?.plz, bisher, neu,
                  abKw: p.abAusgabeKw, abJahr: p.abAusgabeJahr };
              })
              .sort((a, b) => a.tgName.localeCompare(b.tgName, 'de', { numeric: true }));
            const mengenVorschau = stueckzahlAnpassungen
              .map((w) => {
                const tg = teilgebiete.find((t) => t.id === w.teilgebietId);
                return { id: w.id, tgName: tg?.name ?? '— gelöscht —', tgPlz: tg?.plz,
                  alt: tg?.stueckzahl ?? 0, neu: w.neueStueckzahl };
              })
              .sort((a, b) => a.tgName.localeCompare(b.tgName, 'de', { numeric: true }));
            if (wechselVorschau.length === 0 && mengenVorschau.length === 0) return null;
            return (
              <div className="mb-4 rounded-lg border border-blue-300 bg-blue-50 px-4 py-3 text-sm">
                <div className="font-semibold text-blue-900 mb-1">
                  🔄 Vorschau Monatswechsel — folgende Teilgebiete werden beim Klick auf
                  „📌 Monatswechsel durchführen" zur Übernahme vorgeschlagen:
                </div>
                {wechselVorschau.length > 0 && (
                  <div className="mt-1.5">
                    <div className="text-xs font-medium text-blue-800 mb-0.5">
                      Standardausträger-Wechsel ({wechselVorschau.length}):
                    </div>
                    <ul className="list-disc list-inside text-blue-900 space-y-0.5">
                      {wechselVorschau.map((v) => (
                        <li key={v.id} className="text-xs">
                          <strong>{v.tgName}</strong>{v.tgPlz ? ` (${v.tgPlz})` : ''}:{' '}
                          {v.bisher ?? <span className="italic">unbesetzt</span>}
                          {' → '}
                          {v.neu ?? <span className="italic text-amber-700">unbesetzt</span>}
                          {v.abKw && v.abJahr ? ` (ab KW ${v.abKw}/${v.abJahr})` : ''}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {mengenVorschau.length > 0 && (
                  <div className="mt-1.5">
                    <div className="text-xs font-medium text-blue-800 mb-0.5">
                      Mengenänderungen ({mengenVorschau.length}):
                    </div>
                    <ul className="list-disc list-inside text-blue-900 space-y-0.5">
                      {mengenVorschau.map((v) => (
                        <li key={v.id} className="text-xs">
                          <strong>{v.tgName}</strong>{v.tgPlz ? ` (${v.tgPlz})` : ''}:{' '}
                          {v.alt.toLocaleString('de-DE')} → {v.neu.toLocaleString('de-DE')} Stück
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <p className="text-xs text-blue-700 mt-1.5 italic">
                  Die Übernahme erfolgt nach dem Monatswechsel einzeln zur Bestätigung in den
                  jeweiligen Dialogen.
                </p>
              </div>
            );
          })()}

          {/* Gesamt-Kacheln */}
          <div className="grid grid-cols-3 md:grid-cols-6 gap-2 mb-5">
            <SummaryCard
              label="Mitarbeiter"
              value={ergebnisse.length.toString()}
              farbe="bg-blue-50 border-blue-100"
              textFarbe="text-blue-700"
            />
            <SummaryCard
              label="Austragen gesamt"
              value={eur(ergebnisse.reduce((s, e) => s + e.austraegerGesamt, 0))}
              farbe="bg-purple-50 border-purple-100"
              textFarbe="text-purple-700"
            />
            <SummaryCard
              label="Zeiterfassung gesamt"
              value={eur(ergebnisse.reduce((s, e) => s + e.zeitLohn + e.zusammentragenGesamt, 0))}
              farbe="bg-green-50 border-green-100"
              textFarbe="text-green-700"
            />
            <SummaryCard
              label="Fahrtkosten"
              value={eur(ergebnisse.reduce((s, e) => s + (e.fahrtkostenGesamt ?? 0), 0))}
              farbe="bg-sky-50 border-sky-100"
              textFarbe="text-sky-700"
            />
            <SummaryCard
              label="Erbrachte Leistung (brutto)"
              value={eur(gesamtSumme)}
              farbe="bg-orange-50 border-orange-100"
              textFarbe="text-orange-700"
              gross
            />
            <SummaryCard
              label="Brutto an Lohnbüro"
              value={eur(gesamtBruttoLohnbuero)}
              farbe="bg-indigo-50 border-indigo-100"
              textFarbe="text-indigo-700"
              gross
            />
            {(gesamtVerschiebung > 0 || gesamtVerrechnung > 0) && (
              <SummaryCard
                label="Lohnkonto-Bewegung"
                value={`${gesamtVerschiebung > 0 ? `−${eur(gesamtVerschiebung)} ` : ''}${gesamtVerrechnung > 0 ? `+${eur(gesamtVerrechnung)}` : ''}`.trim()}
                farbe="bg-amber-50 border-amber-100"
                textFarbe="text-amber-800"
              />
            )}
            {gesamtVorschuesse > 0 && (
              <SummaryCard
                label="Vorschüsse gesamt"
                value={`- ${eur(gesamtVorschuesse)}`}
                farbe="bg-red-50 border-red-100"
                textFarbe="text-red-700"
              />
            )}
          </div>

          {/* Minijob-Warnungen */}
          {minijobUeberschreiter.length > 0 && (
            <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm">
              <div className="font-semibold text-amber-900 mb-1">
                ⚠ Minijob-Grenze ({eur(minijobGrenze)} / Monat) überschritten
              </div>
              <ul className="list-disc list-inside space-y-0.5 text-amber-800">
                {minijobUeberschreiter.map((e) => {
                  const lohn = lohnOhneFaKo(e);
                  return (
                    <li key={e.mitarbeiter.id}>
                      <span className="font-medium">{e.mitarbeiter.name}</span>
                      {' '}({e.mitarbeiter.nummer}) — Lohn ohne FaKo {eur(lohn)}
                      {' · '}
                      <span className="text-red-700 font-medium">
                        +{eur(lohn - minijobGrenze)} über der Grenze
                      </span>
                      {' — '}
                      <span className="text-amber-700 italic">
                        Tipp: Differenz auf Lohnkonto verschieben (Detailansicht)
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {/* Individuelle Lohngrenze-Warnungen */}
          {individuelleLohngrenzeUeberschreiter.length > 0 && (
            <div className="mb-4 rounded-lg border border-orange-400 bg-orange-50 px-4 py-3 text-sm">
              <div className="font-semibold text-orange-900 mb-1">
                ⚠ Individuelle Lohngrenze überschritten
              </div>
              <ul className="list-disc list-inside space-y-0.5 text-orange-900">
                {individuelleLohngrenzeUeberschreiter.map((e) => {
                  const grenze = e.mitarbeiter.lohngrenzeIndividuellEur ?? 0;
                  const kommentar = e.mitarbeiter.lohngrenzeIndividuellKommentar;
                  const lohn = lohnOhneFaKo(e);
                  return (
                    <li key={e.mitarbeiter.id}>
                      <span className="font-medium">{e.mitarbeiter.name}</span>
                      {' '}({e.mitarbeiter.nummer}) — Grenze {eur(grenze)} · Lohn ohne FaKo {eur(lohn)}
                      {' · '}
                      <span className="text-red-700 font-medium">
                        +{eur(lohn - grenze)} über der Grenze
                      </span>
                      {kommentar && (
                        <span className="block ml-5 text-xs text-orange-700 italic">
                          Grund: {kommentar}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {/* Warnung: Dummy-MA „90000" mit Betrag — niemals abrechnen. */}
          {dummyMaWarnung.length > 0 && (
            <div className="mb-4 rounded-lg border border-red-400 bg-red-50 px-4 py-3 text-sm">
              <div className="font-semibold text-red-800 mb-1">
                ⛔ Dummy-Mitarbeiter „90000" mit Betrag in der Abrechnung
              </div>
              <p className="text-xs text-red-700 mb-1">
                Der Dummy-MA „90000" wird als Platzhalter für anonyme oder
                noch unbekannte Austräger genutzt. Er darf NICHT abgerechnet
                werden. Bitte den echten Mitarbeiter in „Einsätze" zuordnen,
                bevor die Periode abgeschlossen wird.
              </p>
              <ul className="list-disc list-inside space-y-0.5 text-red-900">
                {dummyMaWarnung.map((e) => (
                  <li key={e.mitarbeiter.id}>
                    <span className="font-medium">{e.mitarbeiter.name}</span>
                    <span className="text-gray-500"> ({e.mitarbeiter.nummer})</span>
                    {' — Brutto '}
                    <span className="font-medium">{eur(e.bruttoLohnbuero)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Warnung: Festgehalt-MA mit IST > SOLL-Monatsstunden. */}
          {festgehaltSollIstWarnung.length > 0 && (
            <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm">
              <div className="font-semibold text-amber-900 mb-1">
                ⏱ Festgehalt-MA: IST-Zeit über Soll-Zeit
              </div>
              <p className="text-xs text-amber-800 mb-1">
                Bei diesen Festgehalt-Mitarbeitern liegt die erfasste
                Arbeitszeit in dieser Periode über der hinterlegten
                durchschnittlichen Monats-Soll-Zeit (Wochenstunden × 52/12).
                Prüfen, ob das Festgehalt noch passt oder eine Anpassung
                nötig ist.
              </p>
              <ul className="list-disc list-inside space-y-0.5 text-amber-900">
                {festgehaltSollIstWarnung.map(({ e, sollMonat, istStunden, ueber }) => (
                  <li key={e.mitarbeiter.id}>
                    <span className="font-medium">{e.mitarbeiter.name}</span>
                    <span className="text-gray-500"> ({e.mitarbeiter.nummer})</span>
                    {' — IST '}
                    <span className="font-medium">{istStunden.toFixed(1)} h</span>
                    {' / SOLL '}
                    <span>{sollMonat.toFixed(1)} h</span>
                    <span className="text-red-700 font-medium"> (+{ueber.toFixed(1)} h)</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Warnung: Mitarbeiter in der Abrechnung, die noch nicht angemeldet sind */}
          {nichtAngemeldeteWarnung.length > 0 && (
            <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm">
              <div className="font-semibold text-amber-900 mb-1">
                ⏳ Noch nicht angemeldete Mitarbeiter in dieser Abrechnung
              </div>
              <p className="text-xs text-amber-800 mb-1">
                Diese Mitarbeiter haben Beträge in dieser Periode, sind aber
                noch nicht beim Lohnbüro angemeldet. Vor dem Periodenabschluss
                Anmeldung prüfen.
              </p>
              <ul className="list-disc list-inside space-y-0.5 text-amber-900">
                {nichtAngemeldeteWarnung.map((e) => (
                  <li key={e.mitarbeiter.id}>
                    <span className="font-medium">{e.mitarbeiter.name}</span>
                    <span className="text-gray-500"> ({e.mitarbeiter.nummer})</span>
                    {' — Brutto '}
                    <span className="font-medium">{eur(e.gesamt)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Warnung: abgemeldete Mitarbeiter mit Betrag nach ihrer Abmeldung */}
          {abgemeldeteWarnung.length > 0 && (
            <div className="mb-4 rounded-lg border border-red-400 bg-red-50 px-4 py-3 text-sm">
              <div className="font-semibold text-red-800 mb-1">
                🚪 Abgemeldete Mitarbeiter in dieser Abrechnung
              </div>
              <p className="text-xs text-red-700 mb-1">
                Diese Mitarbeiter sind beim Lohnbüro abgemeldet, haben in dieser
                Periode (nach ihrer Abmeldung) aber Beträge — z. B. als Springer
                eingeplant oder noch als Standardausträger eingetragen. Vor dem
                Periodenabschluss klären: wieder anmelden (Mitarbeiter → Anmeldung /
                Abmeldung) oder Einsätze korrigieren. Festgehalt und
                Tätigkeitsbonus werden nach der Abmeldung nicht mehr gerechnet.
              </p>
              <ul className="list-disc list-inside space-y-0.5 text-red-900">
                {abgemeldeteWarnung.map((e) => (
                  <li key={e.mitarbeiter.id}>
                    <span className="font-medium">{e.mitarbeiter.name}</span>
                    <span className="text-gray-500"> ({e.mitarbeiter.nummer})</span>
                    {e.mitarbeiter.abmeldungUebermittlungDatum && (
                      <span className="text-gray-500">
                        {' — abgemeldet zum '}
                        {e.mitarbeiter.abmeldungUebermittlungDatum.split('-').reverse().join('.')}
                      </span>
                    )}
                    {' — Brutto '}
                    <span className="font-medium">{eur(e.gesamt)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Mitarbeiter-Suche + Filter */}
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <input
              type="text"
              value={suchbegriff}
              onChange={(e) => setSuchbegriff(e.target.value)}
              placeholder="Mitarbeiter suchen (Name oder Nummer)"
              className="w-full md:w-72 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <select
              value={filterRolle}
              onChange={(e) => setFilterRolle(e.target.value as Rolle | '')}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              title="Filter nach Rolle"
            >
              <option value="">Alle Rollen</option>
              {(Object.keys(ROLLEN_LABELS) as Rolle[]).map((r) => (
                <option key={r} value={r}>{ROLLEN_LABELS[r]}</option>
              ))}
            </select>
            <select
              value={filterMinijob}
              onChange={(e) => setFilterMinijob(e.target.value as '' | 'ja' | 'nein')}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              title="Filter Minijob"
            >
              <option value="">Minijob: alle</option>
              <option value="ja">nur Minijob</option>
              <option value="nein">nur kein Minijob</option>
            </select>
            <select
              value={filterSvFrei}
              onChange={(e) => setFilterSvFrei(e.target.value as '' | 'ja' | 'nein')}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              title="Filter SV-Befreiung"
            >
              <option value="">SV-Befreiung: alle</option>
              <option value="ja">nur SV-befreit</option>
              <option value="nein">nur nicht SV-befreit</option>
            </select>
            <select
              value={filterLohnkontoSaldo}
              onChange={(e) => setFilterLohnkontoSaldo(e.target.value as '' | 'ja' | 'nein')}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              title="Filter Lohnkonto-Saldo (nach dieser Periode) — zeigt, bei wem noch etwas zu verrechnen ist"
            >
              <option value="">Lohnkonto: alle</option>
              <option value="ja">nur mit Saldo auf Lohnkonto</option>
              <option value="nein">nur ohne Saldo</option>
            </select>
            {(suchbegriff || filterRolle || filterMinijob || filterSvFrei || filterLohnkontoSaldo) && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setSuchbegriff('');
                    setFilterRolle('');
                    setFilterMinijob('');
                    setFilterSvFrei('');
                    setFilterLohnkontoSaldo('');
                  }}
                  className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1"
                >
                  ✕ Filter zurücksetzen
                </button>
                <span className="text-xs text-gray-500">
                  {gefilterteErgebnisse.length} von {ergebnisse.length}
                </span>
              </>
            )}
          </div>

          {/* Detailtabelle — Kopfzeile bleibt beim vertikalen Scrollen sichtbar
              (Container scrollt vertikal + horizontal, thead ist sticky). */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-auto max-h-[calc(100vh-240px)]">
            <table className="min-w-[1650px] w-full text-sm whitespace-nowrap">
              <thead className="border-b border-gray-200">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-gray-600 sticky top-0 left-0 z-30 bg-gray-50 shadow-[2px_0_4px_-2px_rgba(0,0,0,0.08)]">Mitarbeiter</th>
                  <th className="px-4 py-3 text-right font-medium text-gray-600 sticky top-0 z-20 bg-gray-50">
                    <button
                      type="button"
                      onClick={() => setZeigeGewichtsspalten((v) => !v)}
                      className="inline-flex items-center gap-1 hover:text-gray-900"
                      title={
                        zeigeGewichtsspalten
                          ? 'Detailspalten Gewichtszuschläge ausblenden'
                          : 'Detailspalten Gewichtszuschläge (Gew. AB / Gew. Beil.) einblenden'
                      }
                    >
                      Austragen
                      <span className="text-[10px] text-gray-400">{zeigeGewichtsspalten ? '◂' : '▸'}</span>
                    </button>
                  </th>
                  {zeigeGewichtsspalten && (
                    <>
                      <th className="px-4 py-3 text-right font-medium text-amber-700 sticky top-0 z-20 bg-gray-50" title="Gewichtszuschlag Anzeigenblatt (in Austragen enthalten)">Gew. AB</th>
                      <th className="px-4 py-3 text-right font-medium text-amber-700 sticky top-0 z-20 bg-gray-50" title="Gewichtszuschlag Beilagen (in Austragen enthalten)">Gew. Beil.</th>
                    </>
                  )}
                  <th className="px-4 py-3 text-right font-medium text-gray-600 sticky top-0 z-20 bg-gray-50">Zusammentr.</th>
                  <th className="px-4 py-3 text-right font-medium text-gray-600 sticky top-0 z-20 bg-gray-50">
                    <button
                      type="button"
                      onClick={() => setZeigeZeitspalten((v) => !v)}
                      className="inline-flex items-center gap-1 hover:text-gray-900"
                      title={
                        zeigeZeitspalten
                          ? 'Detailspalten Zeiterfassung ausblenden'
                          : 'Detailspalten Zeiterfassung (Vorarbeit / übrige Zeit) einblenden'
                      }
                    >
                      Zeiterfassung
                      <span className="text-[10px] text-gray-400">{zeigeZeitspalten ? '◂' : '▸'}</span>
                    </button>
                  </th>
                  {zeigeZeitspalten && (
                    <>
                      <th className="px-4 py-3 text-right font-medium text-teal-700 sticky top-0 z-20 bg-gray-50" title="Zeitlohn Vorarbeit (in Zeiterfassung enthalten) — wird durch den Wert der externen Anwendung ersetzt">Vorarbeit</th>
                      <th className="px-4 py-3 text-right font-medium text-gray-600 sticky top-0 z-20 bg-gray-50" title="Übrige Zeiterfassung (in Zeiterfassung enthalten) — bleibt auch bei externem Wert erhalten">Übrige Zeit</th>
                    </>
                  )}
                  <th className="px-4 py-3 text-right font-medium text-gray-800 sticky top-0 z-20 bg-gray-50" title="Summe aus Austragen + Zusammentragen + Zeiterfassung">Summe</th>
                  <th className="px-4 py-3 text-right font-medium text-teal-700 sticky top-0 z-20 bg-gray-50" title="Betrag aus der externen Anwendung (Summe Austragen + Zusammentragen + Vorarbeit). Ist ein Wert gesetzt, ersetzt er diese App-Positionen in Brutto / An Lohnbüro / Lohnübermittlung.">Wert externe<br />Anwendung</th>
                  <th className="px-4 py-3 text-right font-medium text-purple-700 sticky top-0 z-20 bg-gray-50" title="Tätigkeits-Boni in Minuten je Ausgabe (z. B. Orga, Betreuung Zusammenträger)">Min-Boni</th>
                  <th className="px-4 py-3 text-right font-medium text-emerald-700 sticky top-0 z-20 bg-gray-50" title="Bonus Zeiterfassung Austragen — pauschal je vollständig online erfasstem Einsatz">Bonus Zeit</th>
                  <th className="px-4 py-3 text-right font-medium text-fuchsia-700 sticky top-0 z-20 bg-gray-50" title="Einmalige Sonderzahlung (z. B. Jahresbonus) — im Detail des Mitarbeiters erfassen">Sonder&shy;zahlung</th>
                  <th className="px-4 py-3 text-right font-medium text-gray-600 sticky top-0 z-20 bg-gray-50">Fix</th>
                  <th className="px-4 py-3 text-right font-medium text-gray-600 sticky top-0 z-20 bg-gray-50">Fahrtkosten</th>
                  <th className="px-4 py-3 text-right font-medium text-gray-600 sticky top-0 z-20 bg-gray-50" title="Erbrachte Leistung in dieser Periode (vor Lohnkonto-Bewegung)">Brutto</th>
                  <th className="px-4 py-3 text-right font-medium text-amber-700 sticky top-0 z-20 bg-gray-50" title="Verschiebung auf / Verrechnung vom Lohnkonto in dieser Periode">Lohnkonto</th>
                  <th className="px-4 py-3 text-right font-medium text-indigo-700 sticky top-0 z-20 bg-gray-50" title="Brutto, das an das Lohnbüro übermittelt wird (= Brutto − Verschiebung + Verrechnung)">An Lohnbüro</th>
                  <th className="px-4 py-3 text-right font-medium text-red-600 sticky top-0 z-20 bg-gray-50">Vorschuss</th>
                  <th className="px-4 py-3 text-right font-medium text-gray-600 pr-5 sticky top-0 z-20 bg-gray-50">Auszahlung</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {gefilterteErgebnisse.map((er) => (
                  <>
                    <tr
                      key={er.mitarbeiter.id}
                      className="group hover:bg-gray-50 cursor-pointer transition-colors"
                      onClick={() =>
                        setExpandedId(
                          expandedId === er.mitarbeiter.id ? null : er.mitarbeiter.id
                        )
                      }
                    >
                      <td className="px-4 py-3 sticky left-0 bg-white group-hover:bg-gray-50 z-10 shadow-[2px_0_4px_-2px_rgba(0,0,0,0.08)]">
                        <div className="flex items-center gap-2">
                          <span className="text-gray-400 text-xs">
                            {expandedId === er.mitarbeiter.id ? '▼' : '▶'}
                          </span>
                          <div>
                            <div className="font-medium text-gray-900 flex items-center gap-1.5 flex-wrap">
                              {er.mitarbeiter.name}
                              {er.mitarbeiter.istMinijob && (() => {
                                const lohn = lohnOhneFaKo(er);
                                const ueber = lohn > minijobGrenze;
                                return (
                                  <span
                                    className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                                      ueber
                                        ? 'bg-red-100 text-red-700 border border-red-300'
                                        : 'bg-gray-100 text-gray-600 border border-gray-300'
                                    }`}
                                    title={
                                      ueber
                                        ? `Minijob-Grenze ${eur(minijobGrenze)} überschritten (Lohn ohne FaKo: ${eur(lohn)})`
                                        : `Minijob (Lohn ohne FaKo: ${eur(lohn)})`
                                    }
                                  >
                                    {ueber ? '⚠ Minijob' : 'Minijob'}
                                  </span>
                                );
                              })()}
                              {(er.mitarbeiter.lohngrenzeIndividuellEur ?? 0) > 0 && (() => {
                                const g = er.mitarbeiter.lohngrenzeIndividuellEur ?? 0;
                                const ueber = lohnOhneFaKo(er) > g;
                                const titel = ueber
                                  ? `Individuelle Lohngrenze ${eur(g)} überschritten`
                                  : `Individuelle Lohngrenze: ${eur(g)}`;
                                const titelMitGrund = er.mitarbeiter.lohngrenzeIndividuellKommentar
                                  ? `${titel} — ${er.mitarbeiter.lohngrenzeIndividuellKommentar}`
                                  : titel;
                                return (
                                  <span
                                    className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                                      ueber
                                        ? 'bg-red-100 text-red-700 border border-red-300'
                                        : 'bg-orange-50 text-orange-700 border border-orange-200'
                                    }`}
                                    title={titelMitGrund}
                                  >
                                    {ueber ? '⚠ Lohngrenze' : 'Lohngrenze'}
                                  </span>
                                );
                              })()}
                              {er.mitarbeiter.sozialversicherungsBefreit && (
                                <span
                                  className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-green-100 text-green-700 border border-green-300"
                                  title="Sozialversicherungsbefreit — Brutto = Netto"
                                >
                                  SV-frei
                                </span>
                              )}
                              {userRole === 'admin' && er.lohnkontoSaldoNachPeriode !== 0 && (
                                <span
                                  title={`Lohnkonto-Saldo nach dieser Periode: ${eur(er.lohnkontoSaldoNachPeriode)}`}
                                  className={`text-xs ${
                                    er.lohnkontoSaldoNachPeriode > 0 ? 'text-amber-700' : 'text-red-700'
                                  }`}
                                >
                                  💰
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-gray-400">{er.mitarbeiter.nummer}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right text-gray-700">
                        {er.austraegerGesamt > 0 ? eur(er.austraegerGesamt) : '—'}
                      </td>
                      {zeigeGewichtsspalten && (
                        <>
                          <td className="px-4 py-3 text-right text-amber-700">
                            {er.gewichtsbonusAnzeigenblatt > 0 ? eur(er.gewichtsbonusAnzeigenblatt) : '—'}
                          </td>
                          <td className="px-4 py-3 text-right text-amber-700">
                            {er.gewichtsbonusBeilagen > 0 ? eur(er.gewichtsbonusBeilagen) : '—'}
                          </td>
                        </>
                      )}
                      <td className="px-4 py-3 text-right text-gray-700">
                        {er.zusammentragenGesamt > 0 ? eur(er.zusammentragenGesamt) : '—'}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-700">
                        {er.zeitLohn > 0 ? eur(er.zeitLohn) : '—'}
                      </td>
                      {zeigeZeitspalten && (() => {
                        const aufteilung = zeitLohnAufteilung(er);
                        const unbekannt = (
                          <span className="text-gray-400" title="Aufteilung für diese (ältere) abgeschlossene Abrechnung nicht verfügbar">?</span>
                        );
                        return (
                          <>
                            <td className="px-4 py-3 text-right text-teal-700">
                              {!aufteilung ? unbekannt : aufteilung.vorarbeit > 0 ? eur(aufteilung.vorarbeit) : '—'}
                            </td>
                            <td className="px-4 py-3 text-right text-gray-700">
                              {!aufteilung ? unbekannt : aufteilung.uebrige > 0 ? eur(aufteilung.uebrige) : '—'}
                            </td>
                          </>
                        );
                      })()}
                      <td className="px-4 py-3 text-right font-medium text-gray-900">
                        {(() => {
                          const summe = er.austraegerGesamt + er.zusammentragenGesamt + er.zeitLohn;
                          return summe > 0 ? eur(summe) : '—';
                        })()}
                      </td>
                      <ExternerWertZelle
                        periodeId={selectedPeriode?.id ?? ''}
                        mitarbeiterId={er.mitarbeiter.id}
                        wert={er.externerWert}
                        aktiv={er.externerWertAktiv}
                        disabled={
                          !selectedPeriode ||
                          selectedPeriode.status !== 'offen' ||
                          er.mitarbeiter.hatFestgehalt
                        }
                        onSaved={handleBerechnen}
                      />
                      <td
                        className="px-4 py-3 text-right text-purple-700"
                        title={
                          er.ausgabenBoniLohnGesamt > 0
                            ? `${er.ausgabenBoniMinutenGesamt} Min × Stundensatz · siehe Detail`
                            : ''
                        }
                      >
                        {er.ausgabenBoniLohnGesamt > 0 ? eur(er.ausgabenBoniLohnGesamt) : '—'}
                      </td>
                      <td
                        className="px-4 py-3 text-right text-emerald-700"
                        title={
                          er.bonusZeiterfassungAnzahl > 0
                            ? `${er.bonusZeiterfassungAnzahl} vollständig online erfasste Einsätze · ${eur(er.bonusZeiterfassungEur)}`
                            : ''
                        }
                      >
                        {er.bonusZeiterfassungEur > 0 ? eur(er.bonusZeiterfassungEur) : '—'}
                      </td>
                      <td
                        className="px-4 py-3 text-right text-fuchsia-700"
                        title={[
                          er.sonderzahlungAnmerkungLohnbuero && `Lohnbüro: ${er.sonderzahlungAnmerkungLohnbuero}`,
                          er.sonderzahlungAnmerkungIntern && `Intern: ${er.sonderzahlungAnmerkungIntern}`,
                        ].filter(Boolean).join(' · ')}
                      >
                        {(er.sonderzahlung ?? 0) !== 0 ? eur(er.sonderzahlung ?? 0) : '—'}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-700">
                        {er.fixesGehalt > 0 ? eur(er.fixesGehalt) : '—'}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-700">
                        {er.fahrtkostenGesamt > 0 ? eur(er.fahrtkostenGesamt) : '—'}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-gray-900">
                        <div className="flex items-center justify-end gap-1">
                          {er.externerWertAktiv && (
                            <span
                              className="inline-flex items-center px-1 py-0.5 rounded text-[9px] font-semibold bg-teal-100 text-teal-700 border border-teal-300"
                              title={`Externer Wert aktiv: ${eur(er.externerWert ?? 0)} ersetzt Austragen + Zusammentragen + Vorarbeit (App-Berechnung dafür: ${eur(er.externerWertErsetzt ?? 0)}); übrige Zeiterfassung bleibt enthalten`}
                            >
                              ext
                            </span>
                          )}
                          {eur(er.gesamt)}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right text-amber-700 text-xs">
                        {er.lohnkontoVerschiebungPeriode > 0 && (
                          <div title="Diese Periode auf Lohnkonto verschoben">
                            −{eur(er.lohnkontoVerschiebungPeriode)}
                          </div>
                        )}
                        {er.lohnkontoVerrechnungPeriode > 0 && (
                          <div title="Diese Periode vom Lohnkonto verrechnet">
                            +{eur(er.lohnkontoVerrechnungPeriode)}
                          </div>
                        )}
                        {er.lohnkontoSaldoNachPeriode !== 0 && (
                          <div className="text-[10px] text-gray-500 mt-0.5" title="Saldo nach dieser Periode">
                            Saldo: {eur(er.lohnkontoSaldoNachPeriode)}
                          </div>
                        )}
                        {er.lohnkontoVerschiebungPeriode === 0 &&
                          er.lohnkontoVerrechnungPeriode === 0 &&
                          er.lohnkontoSaldoNachPeriode === 0 && '—'}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-indigo-700">
                        {eur(er.bruttoLohnbuero)}
                      </td>
                      <td className="px-4 py-3 text-right text-red-600 font-medium">
                        {er.vorschussSumme > 0 ? `- ${eur(er.vorschussSumme)}` : '—'}
                        {(er.vorschussVormerkungen?.length ?? 0) > 0 && (
                          <div
                            className="text-[10px] font-normal text-emerald-700 whitespace-nowrap"
                            title={
                              'Im Einsätze-Screen als Vorschuss vorgemerkt (nur Hinweis — Buchung manuell):\n' +
                              er.vorschussVormerkungen!
                                .map((v) => `KW ${v.kw} · ${v.teilgebietName}: ${v.betragEur != null ? eur(v.betragEur) : '—'}`)
                                .join('\n')
                            }
                          >
                            💶 vorgemerkt {eur(er.vorschussVormerkungen!.reduce((s, v) => s + (v.betragEur ?? 0), 0))}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right font-bold text-gray-900 pr-5">
                        {er.mitarbeiter.sozialversicherungsBefreit ? (
                          eur(er.bruttoLohnbuero - er.vorschussSumme)
                        ) : (
                          <span
                            className="text-gray-400 font-normal italic"
                            title="Auszahlung wird vom Lohnbüro nach Abzug der Sozialversicherung berechnet"
                          >
                            Lohnbüro
                          </span>
                        )}
                      </td>
                    </tr>

                    {/* Detail-Aufklappung */}
                    {expandedId === er.mitarbeiter.id && (
                      <tr key={`${er.mitarbeiter.id}-detail`}>
                        <td colSpan={16 + (zeigeGewichtsspalten ? 2 : 0) + (zeigeZeitspalten ? 2 : 0)} className="bg-gray-50 px-6 py-4">
                          <DetailAnsicht
                            ergebnis={er}
                            periode={selectedPeriode}
                            onVorschussChange={handleBerechnen}
                          />
                        </td>
                      </tr>
                    )}
                  </>
                ))}

                {/* Summenzeile */}
                <tr className="bg-blue-50 border-t-2 border-blue-200">
                  <td className="px-4 py-3 font-bold text-gray-900 sticky left-0 bg-blue-50 z-10 shadow-[2px_0_4px_-2px_rgba(0,0,0,0.08)]">Gesamt</td>
                  <td className="px-4 py-3 text-right font-bold text-gray-900">
                    {eur(ergebnisse.reduce((s, e) => s + e.austraegerGesamt, 0))}
                  </td>
                  {zeigeGewichtsspalten && (
                    <>
                      <td className="px-4 py-3 text-right font-bold text-amber-700">
                        {eur(ergebnisse.reduce((s, e) => s + e.gewichtsbonusAnzeigenblatt, 0))}
                      </td>
                      <td className="px-4 py-3 text-right font-bold text-amber-700">
                        {eur(ergebnisse.reduce((s, e) => s + e.gewichtsbonusBeilagen, 0))}
                      </td>
                    </>
                  )}
                  <td className="px-4 py-3 text-right font-bold text-gray-900">
                    {eur(ergebnisse.reduce((s, e) => s + e.zusammentragenGesamt, 0))}
                  </td>
                  <td className="px-4 py-3 text-right font-bold text-gray-900">
                    {eur(ergebnisse.reduce((s, e) => s + e.zeitLohn, 0))}
                  </td>
                  {zeigeZeitspalten && (() => {
                    const aufteilungen = ergebnisse.map(zeitLohnAufteilung);
                    const vollstaendig = aufteilungen.every((a) => a != null);
                    const summe = (key: 'vorarbeit' | 'uebrige') =>
                      vollstaendig ? eur(aufteilungen.reduce((s, a) => s + (a?.[key] ?? 0), 0)) : '?';
                    return (
                      <>
                        <td className="px-4 py-3 text-right font-bold text-teal-700">{summe('vorarbeit')}</td>
                        <td className="px-4 py-3 text-right font-bold text-gray-900">{summe('uebrige')}</td>
                      </>
                    );
                  })()}
                  <td className="px-4 py-3 text-right font-bold text-gray-900">
                    {eur(ergebnisse.reduce((s, e) => s + e.austraegerGesamt + e.zusammentragenGesamt + e.zeitLohn, 0))}
                  </td>
                  <td className="px-4 py-3 text-right font-bold text-teal-700">
                    {(() => {
                      const summe = ergebnisse.reduce(
                        (s, e) => s + (e.externerWertAktiv ? e.externerWert ?? 0 : 0),
                        0
                      );
                      return summe > 0 ? eur(summe) : '—';
                    })()}
                  </td>
                  <td className="px-4 py-3 text-right font-bold text-purple-700">
                    {eur(ergebnisse.reduce((s, e) => s + e.ausgabenBoniLohnGesamt, 0))}
                  </td>
                  <td className="px-4 py-3 text-right font-bold text-emerald-700">
                    {eur(ergebnisse.reduce((s, e) => s + (e.bonusZeiterfassungEur ?? 0), 0))}
                  </td>
                  <td className="px-4 py-3 text-right font-bold text-fuchsia-700">
                    {eur(ergebnisse.reduce((s, e) => s + (e.sonderzahlung ?? 0), 0))}
                  </td>
                  <td className="px-4 py-3 text-right font-bold text-gray-900">
                    {eur(ergebnisse.reduce((s, e) => s + e.fixesGehalt, 0))}
                  </td>
                  <td className="px-4 py-3 text-right font-bold text-gray-900">
                    {eur(ergebnisse.reduce((s, e) => s + e.fahrtkostenGesamt, 0))}
                  </td>
                  <td className="px-4 py-3 text-right font-bold text-gray-900">
                    {eur(gesamtSumme)}
                  </td>
                  <td className="px-4 py-3 text-right font-bold text-amber-700 text-xs">
                    {gesamtVerschiebung > 0 && <div>−{eur(gesamtVerschiebung)}</div>}
                    {gesamtVerrechnung > 0 && <div>+{eur(gesamtVerrechnung)}</div>}
                    {gesamtVerschiebung === 0 && gesamtVerrechnung === 0 && '—'}
                  </td>
                  <td className="px-4 py-3 text-right font-bold text-indigo-700">
                    {eur(gesamtBruttoLohnbuero)}
                  </td>
                  <td className="px-4 py-3 text-right font-bold text-red-700">
                    {gesamtVorschuesse > 0 ? `- ${eur(gesamtVorschuesse)}` : '—'}
                  </td>
                  <td className="px-4 py-3 text-right font-bold text-blue-800 text-base pr-5">
                    {eur(gesamtNetto)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* An-/Abmeldungen ans Lohnbüro */}
          {selectedPeriode && (
            <AnAbmeldungenListe
              periode={selectedPeriode}
              istGesperrt={selectedPeriode.status === 'abgeschlossen'}
              ergebnisse={ergebnisse ?? []}
            />
          )}

          {/* Memos zur Lohnübermittlung (Abrechnungsvorbereitung) */}
          {selectedPeriode && (
            <PeriodenMemoBlock
              periodeId={selectedPeriode.id}
              istGesperrt={selectedPeriode.status === 'abgeschlossen'}
            />
          )}
        </>
      )}

      {!ergebnisse && !loading && selectedPeriodeId && (
        <div className="text-center py-12 text-gray-400">
          Klicke auf "Berechnen" um die Abrechnung zu starten.
        </div>
      )}

      {zeigeWechselplanDialog && selectedPeriode && (
        <WechselplanUebernahmeDialog
          wechselplaene={wechselplaene.filter((p) =>
            istRelevanterWechselplan(p, selectedPeriode, abrechnungsperioden),
          )}
          teilgebiete={teilgebiete}
          mitarbeiter={mitarbeiter}
          abrechnungsperioden={abrechnungsperioden}
          periode={selectedPeriode}
          adminName={adminName}
          onClose={() => setZeigeWechselplanDialog(false)}
        />
      )}

      {zeigeAnpassungDialog && selectedPeriode && (
        <StueckzahlAnpassungDialog
          anpassungen={stueckzahlAnpassungen}
          teilgebiete={teilgebiete}
          periode={selectedPeriode}
          adminName={adminName}
          onClose={() => setZeigeAnpassungDialog(false)}
        />
      )}
    </div>
  );
}

/**
 * Teilgebietsdoku nach einer halb-automatisch umgesetzten Änderung sichern
 * (Monatswechsel: Standardausträger-Wechsel, Mengenanpassung). Ein Fehler
 * beim Sichern darf den Monatswechsel nicht abbrechen — die Änderung selbst
 * ist da bereits gespeichert und protokolliert.
 */
async function sichereDokuNachUmsetzung(adminName: string, anlass: string): Promise<void> {
  try {
    await sichereTeilgebietsdokuAktuell({ adminName, anlass });
  } catch (e) {
    console.error('Sicherung der Teilgebietsdoku fehlgeschlagen:', e);
    alert(
      'Die Änderung wurde gespeichert und protokolliert, die Sicherung der Teilgebietsdoku ist ' +
        'aber fehlgeschlagen. Bitte unter „Teilgebiete" → „Jetzt sichern" nachholen.',
    );
  }
}

// ---- Modal: Wechselplan-Übernahme (PlanungScreen-Quelle) ----
//
// Nach „Monatswechsel durchführen" werden Wechselpläne aus der
// PlanungScreen-Sektion „Standard-Wechsel" einzeln zur Bestätigung
// angeboten — sofern ihre `letzteAusgabe` der letzten KW dieser Periode
// entspricht. Übernehmen setzt den neuen Standardausträger am TG und
// löscht den Wechselplan; Lücken-Einsätze in der Abrechnung bleiben
// unangetastet (vom User in der Ausfälle-Sektion zu klären).

function WechselplanUebernahmeDialog({
  wechselplaene,
  teilgebiete,
  mitarbeiter,
  abrechnungsperioden,
  periode,
  adminName,
  onClose,
}: {
  wechselplaene: StandardAustraegerWechselPlan[];
  teilgebiete: Teilgebiet[];
  mitarbeiter: Mitarbeiter[];
  abrechnungsperioden: Abrechnungsperiode[];
  periode: Abrechnungsperiode;
  adminName: string;
  onClose: () => void;
}) {
  const tgMap = new Map(teilgebiete.map((t) => [t.id, t]));
  const maMap = new Map(mitarbeiter.map((m) => [m.id, m]));
  const [busyId, setBusyId] = useState<string | null>(null);

  const offen = [...wechselplaene].sort((a, b) => {
    const na = tgMap.get(a.teilgebietId)?.name ?? '';
    const nb = tgMap.get(b.teilgebietId)?.name ?? '';
    return na.localeCompare(nb, 'de', { numeric: true });
  });

  /** Protokoll-Eintrag des umgesetzten Wechselplans schreiben (vor dem Löschen
   *  des Plans). `neuerAustraegerId === null` ⇒ als unbesetzt übernommen. */
  async function protokolliereWechsel(
    p: StandardAustraegerWechselPlan,
    tg: Teilgebiet,
    neuerAustraegerId: string | null,
    bereinigteAutoSpringer = 0,
  ) {
    const bisher = tg.standardAustraegerId
      ? maMap.get(tg.standardAustraegerId)
      : undefined;
    const neuer = neuerAustraegerId ? maMap.get(neuerAustraegerId) : undefined;
    await protokolliereUmgesetzteAnpassung({
      art: 'wechsel',
      teilgebietId: tg.id,
      teilgebietName: tg.name,
      teilgebietPlz: tg.plz || undefined,
      periodeId: periode.id,
      periodeBezeichnung: periode.bezeichnung,
      umsetzungJahr: periode.jahr,
      umsetzungMonat: periode.monat,
      umgesetztVon: adminName || undefined,
      bisherigerAustraegerId: tg.standardAustraegerId ?? null,
      bisherigerAustraegerName: bisher?.name ?? null,
      letzteAusgabeKw: p.letzteAusgabeKw,
      letzteAusgabeJahr: p.letzteAusgabeJahr,
      neuerAustraegerId: neuerAustraegerId,
      neuerAustraegerName: neuer?.name ?? null,
      abAusgabeKw: p.abAusgabeKw,
      abAusgabeJahr: p.abAusgabeJahr,
      kommentar: p.kommentar,
      externerLink: p.externerLink,
    });
    await schreibeAuditLog({
      adminName: adminName || 'Unbekannt',
      bereich: 'dauerhafter-wechsel',
      aktion: 'geaendert',
      teilgebietId: tg.id,
      teilgebietName: tg.name,
      mitarbeiterId: neuerAustraegerId,
      mitarbeiterName: neuer?.name ?? null,
      jahr: p.abAusgabeJahr ?? p.letzteAusgabeJahr,
      kwVon: p.abAusgabeKw ?? p.letzteAusgabeKw,
      kwBis: p.abAusgabeKw ?? p.letzteAusgabeKw,
      automatisch: true,
      feld: 'Standardausträger',
      altWert: bisher?.name ?? '— (unbesetzt)',
      neuWert: neuer?.name ?? '— (unbesetzt)',
      beschreibung:
        `🤖 Automatisch durch die App umgesetzt (manuell angestoßen über „Monatswechsel" → „Übernehmen"): ` +
        `zuvor in der Personalplanung hinterlegter Wechselplan — Standardausträger ${
          bisher?.name ?? '— (unbesetzt)'
        } → ${neuer?.name ?? '— (unbesetzt)'} (Periode ${periode.bezeichnung})` +
        (p.kommentar ? `; Kommentar: "${p.kommentar}"` : '') +
        (bereinigteAutoSpringer > 0
          ? `; ${bereinigteAutoSpringer} automatisch angelegte(r) Behelfs-Springer-Einsatz/Einsätze automatisch aufgeräumt`
          : ''),
    });
  }

  /** TG ohne geplanten Nachfolger als unbesetzt übernehmen: Standardausträger
   *  am TG entfernen, Wechselplan protokollieren und löschen. */
  async function handleUnbesetztUebernehmen(p: StandardAustraegerWechselPlan) {
    const tg = tgMap.get(p.teilgebietId);
    if (!tg) {
      alert('Teilgebiet nicht mehr vorhanden — Eintrag wird verworfen.');
      await loescheAustraegerwechselPlan(p.teilgebietId);
      return;
    }
    if (!confirm(`„${tg.name}" als unbesetzt übernehmen? Der Standardausträger wird entfernt.`)) {
      return;
    }
    setBusyId(p.id);
    try {
      await protokolliereWechsel(p, tg, null);
      await aktualisiereTeilgebiet(tg.id, { standardAustraegerId: null });
      await loescheAustraegerwechselPlan(p.teilgebietId);
      await sichereDokuNachUmsetzung(
        adminName,
        `Monatswechsel ${periode.bezeichnung}: ${tg.name} als unbesetzt übernommen`,
      );
    } catch (e: any) {
      alert('Fehler beim Übernehmen: ' + (e.message ?? e));
    } finally {
      setBusyId(null);
    }
  }

  async function handleUebernehmen(p: StandardAustraegerWechselPlan) {
    if (!p.neuerAustraegerId) return;
    const tg = tgMap.get(p.teilgebietId);
    if (!tg) {
      alert('Teilgebiet nicht mehr vorhanden — Eintrag wird verworfen.');
      await loescheAustraegerwechselPlan(p.teilgebietId);
      return;
    }
    setBusyId(p.id);
    try {
      // Behelfs-Springer-Einsätze (autoVomWechselplan) für den neuen Austräger
      // entfernen: Mit der Übernahme ist er offizieller Standardausträger und
      // wird ab jetzt als Standard (nicht als Springer mit Zuschlag) geführt.
      // Nur in NICHT eingefrorenen Perioden löschen — abgeschlossene/fixierte
      // Monate bleiben unangetastet. Vorab ermittelt, damit der Protokoll-
      // Eintrag die Anzahl der automatisch aufgeräumten Einsätze nennen kann.
      const istEingefroren = (jahr: number, kw: number) => {
        const per = abrechnungsperioden.find(
          (q) => q.jahr === jahr && q.kalenderwochen.includes(kw),
        );
        return !!(
          per?.periodeSnapshot?.teilgebietSnapshots?.length ||
          per?.monatswechselSnapshot?.teilgebietSnapshots?.length
        );
      };
      const tgEinsaetze = await ladeEinsaetzeFuerTeilgebiet(tg.id);
      const autoSpringerZuBereinigen = tgEinsaetze.filter(
        (e) =>
          e.autoVomWechselplan === true &&
          e.mitarbeiterId === p.neuerAustraegerId &&
          !istEingefroren(e.jahr, e.kw),
      );
      await protokolliereWechsel(p, tg, p.neuerAustraegerId, autoSpringerZuBereinigen.length);
      await aktualisiereTeilgebiet(tg.id, { standardAustraegerId: p.neuerAustraegerId });
      for (const e of autoSpringerZuBereinigen) {
        await loescheEinsatz(e.id);
      }
      await loescheAustraegerwechselPlan(p.teilgebietId);
      await sichereDokuNachUmsetzung(
        adminName,
        `Monatswechsel ${periode.bezeichnung}: Standardausträger-Wechsel ${tg.name}`,
      );
    } catch (e: any) {
      alert('Fehler beim Übernehmen: ' + (e.message ?? e));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[85vh] flex flex-col">
        <div className="px-5 py-3 border-b border-gray-200">
          <h3 className="text-base font-semibold text-gray-900">
            Geplante Standardausträger-Wechsel ({offen.length})
          </h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Aus der Personalplanung — Wechselpläne, deren letzte Ausgabe
            (bei besetzten TGs) bzw. „ab Ausgabe" (bei zuvor unbesetzten
            TGs) in dieser Periode liegt. Pro TG einzeln bestätigen: der
            neue Standardausträger wird am Teilgebiet eingetragen.
            Lücken-/Springer-Einsätze bleiben in der Abrechnung erhalten.
          </p>
        </div>
        <div className="overflow-y-auto flex-1">
          {offen.length === 0 ? (
            <div className="px-5 py-10 text-center text-sm text-gray-500">
              Keine relevanten Wechselpläne mehr.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200 text-gray-600 text-xs">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Teilgebiet</th>
                  <th className="px-3 py-2 text-left font-medium">Bisheriger</th>
                  <th className="px-3 py-2 text-left font-medium">Neuer (geplant)</th>
                  <th className="px-3 py-2 text-left font-medium">Ab Ausgabe</th>
                  <th className="px-3 py-2 text-right font-medium">Aktion</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {offen.map((p) => {
                  const tg = tgMap.get(p.teilgebietId);
                  const bisheriger = tg?.standardAustraegerId
                    ? maMap.get(tg.standardAustraegerId)
                    : undefined;
                  const neuer = p.neuerAustraegerId ? maMap.get(p.neuerAustraegerId) : undefined;
                  return (
                    <tr key={p.id} className="hover:bg-gray-50">
                      <td className="px-3 py-2 font-medium text-gray-900">
                        {tg?.name ?? '— gelöscht —'}
                        {!p.neuerAustraegerId && (
                          <div className="text-[11px] font-semibold text-red-600">kein Nachfolger</div>
                        )}
                        {p.kommentar && (
                          <div className="text-[10px] text-gray-500 truncate" title={p.kommentar}>
                            💬 {p.kommentar}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-gray-700">
                        {bisheriger?.name ?? <span className="text-gray-400 italic">—</span>}
                      </td>
                      <td className="px-3 py-2 text-gray-900">
                        {neuer?.name ?? <span className="text-amber-600 italic">kein Nachfolger geplant</span>}
                      </td>
                      <td className="px-3 py-2 text-xs text-gray-600 whitespace-nowrap">
                        {p.abAusgabeJahr && p.abAusgabeKw
                          ? `KW ${p.abAusgabeKw}/${p.abAusgabeJahr}`
                          : <span className="text-gray-400 italic">—</span>}
                      </td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        {p.neuerAustraegerId ? (
                          <button
                            type="button"
                            onClick={() => handleUebernehmen(p)}
                            disabled={busyId === p.id}
                            className="text-xs bg-green-600 text-white px-2.5 py-1 rounded hover:bg-green-700 disabled:opacity-50 mr-1.5"
                          >
                            {busyId === p.id ? '…' : '✓ Übernehmen'}
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleUnbesetztUebernehmen(p)}
                            disabled={busyId === p.id}
                            className="text-xs bg-amber-600 text-white px-2.5 py-1 rounded hover:bg-amber-700 disabled:opacity-50 mr-1.5"
                            title="Standardausträger am Teilgebiet entfernen (unbesetzt) und Wechselplan protokollieren"
                          >
                            {busyId === p.id ? '…' : '✓ Als unbesetzt übernehmen'}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={async () => {
                            if (!confirm('Diesen geplanten Wechsel verwerfen?')) return;
                            await loescheAustraegerwechselPlan(p.teilgebietId);
                            await schreibeAuditLog({
                              adminName: adminName || 'Unbekannt',
                              bereich: 'dauerhafter-wechsel',
                              aktion: 'geloescht',
                              teilgebietId: p.teilgebietId,
                              teilgebietName: tg?.name ?? p.teilgebietId,
                              mitarbeiterId: p.neuerAustraegerId ?? null,
                              mitarbeiterName: neuer?.name ?? null,
                              jahr: p.abAusgabeJahr ?? p.letzteAusgabeJahr,
                              kwVon: p.abAusgabeKw ?? p.letzteAusgabeKw,
                              kwBis: p.abAusgabeKw ?? p.letzteAusgabeKw,
                              beschreibung:
                                `Wechselplan beim Monatswechsel verworfen (nicht übernommen) — geplanter neuer Standardausträger: ${
                                  neuer?.name ?? '— (kein Nachfolger)'
                                }` + (p.kommentar ? `; Kommentar war: "${p.kommentar}"` : ''),
                            });
                          }}
                          className="text-xs text-red-500 hover:text-red-700"
                          title="Wechselplan verwerfen"
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        <div className="px-5 py-3 border-t border-gray-200 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="text-sm bg-blue-600 text-white px-4 py-1.5 rounded-lg hover:bg-blue-700"
          >
            Schließen
          </button>
        </div>
      </div>
    </div>
  );
}

// ---- Modal: Stückzahl-Anpassung-Bestätigung ---------------

function StueckzahlAnpassungDialog({
  anpassungen,
  teilgebiete,
  periode,
  adminName,
  onClose,
}: {
  anpassungen: import('../types').StueckzahlAnpassung[];
  teilgebiete: import('../types').Teilgebiet[];
  periode: Abrechnungsperiode;
  adminName: string;
  onClose: () => void;
}) {
  const { touren } = useApp();
  const tgMap = new Map(teilgebiete.map((t) => [t.id, t]));
  const [busyId, setBusyId] = useState<string | null>(null);
  /** Übernommene Mengenänderungen, die den Verteilplan online veralten lassen. */
  const [verteilplanAenderungen, setVerteilplanAenderungen] = useState<string[]>([]);

  const offen = [...anpassungen].sort((a, b) => {
    const na = tgMap.get(a.teilgebietId)?.name ?? '';
    const nb = tgMap.get(b.teilgebietId)?.name ?? '';
    return na.localeCompare(nb, 'de', { numeric: true });
  });

  const fmtStk = (n: number) => `${n.toLocaleString('de-DE')} Stk`;

  async function handleUebernehmen(w: import('../types').StueckzahlAnpassung) {
    const tg = tgMap.get(w.teilgebietId);
    if (!tg) {
      alert('Teilgebiet nicht mehr vorhanden — Eintrag wird verworfen.');
      await loescheStueckzahlAnpassung(w.id);
      return;
    }
    setBusyId(w.id);
    try {
      // Umgesetzte Mengenanpassung protokollieren (alte Stückzahl VOR dem
      // Update festhalten).
      await protokolliereUmgesetzteAnpassung({
        art: 'menge',
        teilgebietId: tg.id,
        teilgebietName: tg.name,
        teilgebietPlz: tg.plz || undefined,
        periodeId: periode.id,
        periodeBezeichnung: periode.bezeichnung,
        umsetzungJahr: periode.jahr,
        umsetzungMonat: periode.monat,
        umgesetztVon: adminName || undefined,
        alteStueckzahl: tg.stueckzahl,
        neueStueckzahl: w.neueStueckzahl,
        bemerkung: w.bemerkung,
      });
      // Manueller Override-Flag mitschreiben, damit die automatische
      // Berechnung aus der Straßenliste den neuen Wert nicht wieder
      // überschreibt.
      await aktualisiereTeilgebiet(tg.id, {
        stueckzahl: w.neueStueckzahl,
        stueckzahlManuell: true,
      });
      await loescheStueckzahlAnpassung(w.id);
      const verteilplanAenderung = verteilplanRelevanteAenderung(
        tg,
        { ...tg, stueckzahl: w.neueStueckzahl },
        touren,
      );
      if (verteilplanAenderung) {
        try {
          await merkeVerteilplanOnlineAenderung(verteilplanAenderung);
        } catch (err) {
          console.error('Hinweis „Verteilplan online" konnte nicht gespeichert werden:', err);
        }
        setVerteilplanAenderungen((prev) => [...prev, verteilplanAenderung]);
      }
      await schreibeAuditLog({
        adminName: adminName || 'Unbekannt',
        bereich: 'teilgebiets-anpassung',
        aktion: 'geaendert',
        teilgebietId: tg.id,
        teilgebietName: tg.name,
        mitarbeiterId: null,
        mitarbeiterName: null,
        jahr: periode.jahr,
        automatisch: true,
        feld: 'Stückzahl',
        altWert: `${tg.stueckzahl.toLocaleString('de-DE')} Stk`,
        neuWert: `${w.neueStueckzahl.toLocaleString('de-DE')} Stk`,
        beschreibung:
          `🤖 Automatisch durch die App umgesetzt (manuell angestoßen über „Monatswechsel" → „Übernehmen"): ` +
          `zuvor vorgemerkte Stückzahl-Anpassung — ${tg.stueckzahl} → ${w.neueStueckzahl} Stk (Periode ${periode.bezeichnung})` +
          (w.bemerkung ? `; Bemerkung: "${w.bemerkung}"` : ''),
      });
      await sichereDokuNachUmsetzung(
        adminName,
        `Monatswechsel ${periode.bezeichnung}: Mengenanpassung ${tg.name}`,
      );
    } catch (e: any) {
      alert('Fehler beim Übernehmen: ' + (e.message ?? e));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[85vh] flex flex-col">
        <div className="px-5 py-3 border-b border-gray-200">
          <h3 className="text-base font-semibold text-gray-900">
            Vorbereitete Stückzahl-Anpassungen ({offen.length})
          </h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Bitte einzeln bestätigen: der neue Wert wird als Stückzahl
            des Teilgebiets eingetragen (mit manuellem Override-Flag), der
            Eintrag verschwindet anschließend aus der Vorbereitungsliste.
          </p>
          {verteilplanAenderungen.length > 0 && (
            <div className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              <div className="font-semibold">🌐 Bitte „Verteilplan online" aktualisieren</div>
              <div className="mt-0.5">
                Geänderte Stückzahl{verteilplanAenderungen.length === 1 ? '' : 'en'}: {verteilplanAenderungen.join(' · ')}.
                Unter „Verteilplan &amp; Bestellungen" das „📄 PDF blanko" neu erzeugen und auf der Webseite austauschen.
              </div>
            </div>
          )}
        </div>
        <div className="overflow-y-auto flex-1">
          {offen.length === 0 ? (
            <div className="px-5 py-10 text-center text-sm text-gray-500">
              Keine offenen Anpassungen mehr.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200 text-gray-600 text-xs">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Teilgebiet</th>
                  <th className="px-3 py-2 text-right font-medium">Bisher</th>
                  <th className="px-3 py-2 text-right font-medium">Neu</th>
                  <th className="px-3 py-2 text-left font-medium">Bemerkung</th>
                  <th className="px-3 py-2 text-right font-medium">Aktion</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {offen.map((w) => {
                  const tg = tgMap.get(w.teilgebietId);
                  return (
                    <tr key={w.id} className="hover:bg-gray-50">
                      <td className="px-3 py-2 font-medium text-gray-900">
                        {tg?.name ?? '— gelöscht —'}
                        {tg?.plz && <span className="ml-1 text-xs text-gray-400">({tg.plz})</span>}
                      </td>
                      <td className="px-3 py-2 text-right text-gray-700 font-mono text-xs">
                        {tg ? fmtStk(tg.stueckzahl) : '—'}
                      </td>
                      <td className="px-3 py-2 text-right text-gray-900 font-mono text-xs font-semibold">
                        {fmtStk(w.neueStueckzahl)}
                      </td>
                      <td className="px-3 py-2 text-xs text-gray-600">
                        {w.bemerkung || <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => handleUebernehmen(w)}
                          disabled={busyId === w.id}
                          className="text-xs bg-green-600 text-white px-2.5 py-1 rounded hover:bg-green-700 disabled:opacity-50 mr-1.5"
                        >
                          {busyId === w.id ? '…' : '✓ Übernehmen'}
                        </button>
                        <button
                          type="button"
                          onClick={async () => {
                            if (!confirm('Diese vorbereitete Anpassung verwerfen?')) return;
                            await loescheStueckzahlAnpassung(w.id);
                            await schreibeAuditLog({
                              adminName: adminName || 'Unbekannt',
                              bereich: 'teilgebiets-anpassung',
                              aktion: 'geloescht',
                              teilgebietId: w.teilgebietId,
                              teilgebietName: tg?.name ?? w.teilgebietId,
                              mitarbeiterId: null,
                              mitarbeiterName: null,
                              jahr: periode.jahr,
                              beschreibung:
                                `Vorgemerkte Stückzahl-Anpassung beim Monatswechsel verworfen (neue Stückzahl war: ${w.neueStueckzahl} Stk)` +
                                (w.bemerkung ? `; Bemerkung war: "${w.bemerkung}"` : ''),
                            });
                          }}
                          className="text-xs text-red-500 hover:text-red-700"
                          title="Anpassung verwerfen"
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        <div className="px-5 py-3 border-t border-gray-200 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="text-sm bg-blue-600 text-white px-4 py-1.5 rounded-lg hover:bg-blue-700"
          >
            Schließen
          </button>
        </div>
      </div>
    </div>
  );
}

// ---- Detail-Ansicht je Mitarbeiter -------------------------

function DetailAnsicht({
  ergebnis: er,
  periode,
  onVorschussChange,
}: {
  ergebnis: MitarbeiterAbrechnung;
  periode?: Abrechnungsperiode;
  onVorschussChange?: () => void;
}) {
  // Wenn die Periode abgeschlossen ist, sollen KEINERLEI Manipulationen mehr
  // möglich sein (Vorschüsse, Boni, Lohnkonto-Buchungen).
  const istGesperrt = periode?.status === 'abgeschlossen';
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
      {istGesperrt && (
        <div className="md:col-span-2 rounded border border-gray-300 bg-gray-50 px-3 py-2 text-xs text-gray-600">
          🔒 Periode ist abgeschlossen — Boni, Sonderzahlung, Vorschüsse und Lohnkonto-Buchungen
          können nicht geändert werden. Zum Bearbeiten zuerst „Entsperren" klicken.
        </div>
      )}
      {/* Bonus / Variabler Periodenzusatz */}
      {periode && (
        <BonusEditor
          mitarbeiterId={er.mitarbeiter.id}
          periodeId={periode.id}
          bonus={er.bonus}
          bonusKommentar={er.bonusKommentar}
          bonusId={er.bonusId}
          onChange={onVorschussChange ?? (() => {})}
          istGesperrt={istGesperrt}
        />
      )}
      {/* Einmalige Sonderzahlung */}
      {periode && (
        <SonderzahlungEditor
          mitarbeiterId={er.mitarbeiter.id}
          periodeId={periode.id}
          ergebnis={er}
          onChange={onVorschussChange ?? (() => {})}
          istGesperrt={istGesperrt}
        />
      )}
      {/* Lohnkonto */}
      {periode && (
        <LohnkontoEditor
          mitarbeiterId={er.mitarbeiter.id}
          periodeId={periode.id}
          ergebnis={er}
          onChange={onVorschussChange ?? (() => {})}
          istGesperrt={istGesperrt}
        />
      )}
      {/* Bonus Zeiterfassung Austragen */}
      {er.bonusZeiterfassungAnzahl > 0 && (
        <div className="md:col-span-2">
          <h4 className="font-semibold text-gray-700 mb-2 text-sm">
            Bonus Zeiterfassung Austragen ({er.bonusZeiterfassungAnzahl} vollständig online erfasste Einsätze · {eur(er.bonusZeiterfassungEur)})
          </h4>
          <p className="text-xs text-gray-500 -mt-1 mb-2">
            Pauschaler Bonus je vollständig online erfasstem Austragen-Einsatz
            (Zeit + Restmenge via QR-Code). Pro Teilgebiet &amp; Ausgabe einmal.
          </p>
        </div>
      )}

      {/* Minuten-Boni je Ausgabe (inkl. laut Stammdaten entfallener Ausgaben) */}
      {(er.ausgabenBoni.length > 0 || (er.ausgabenBoniEntfallen?.length ?? 0) > 0) && (
        <div className="md:col-span-2">
          <h4 className="font-semibold text-gray-700 mb-2 text-sm">
            Min-Boni ({er.ausgabenBoni.length} Einträge ·
            {' '}{er.ausgabenBoniMinutenGesamt} min · {eur(er.ausgabenBoniLohnGesamt)})
          </h4>
          <div className="overflow-hidden rounded border border-gray-200 bg-white">
            <table className="w-full text-xs">
              <thead className="bg-gray-100 text-gray-600">
                <tr>
                  <th className="px-2 py-1.5 text-left font-medium">KW</th>
                  <th className="px-2 py-1.5 text-right font-medium">Minuten</th>
                  <th className="px-2 py-1.5 text-left font-medium">Kommentar / Grund</th>
                  <th className="px-2 py-1.5 text-right font-medium">Lohn</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {er.ausgabenBoni.map((b) => (
                  <tr key={b.id}>
                    <td className="px-2 py-1.5 text-gray-500">{b.kw}/{b.jahr}</td>
                    <td className="px-2 py-1.5 text-right text-gray-700 font-mono">{b.minuten}</td>
                    <td className="px-2 py-1.5 text-gray-700">
                      {b.kommentar ?? <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-2 py-1.5 text-right font-semibold text-purple-700">
                      {eur(b.lohn)}
                    </td>
                  </tr>
                ))}
                {(er.ausgabenBoniEntfallen ?? []).map((b, i) => (
                  <tr key={`entfallen-${b.jahr}-${b.kw}-${i}`} className="text-gray-400">
                    <td className="px-2 py-1.5">{b.kw}/{b.jahr}</td>
                    <td className="px-2 py-1.5 text-right font-mono line-through">—</td>
                    <td className="px-2 py-1.5 italic">
                      entfällt{b.grund ? ` — ${b.grund}` : ''}
                    </td>
                    <td className="px-2 py-1.5 text-right">{eur(0)}</td>
                  </tr>
                ))}
                <tr className="bg-gray-50 border-t border-gray-200 font-semibold">
                  <td className="px-2 py-1.5 text-gray-700">∑</td>
                  <td className="px-2 py-1.5 text-right text-gray-700">
                    {er.ausgabenBoniMinutenGesamt} min
                  </td>
                  <td className="px-2 py-1.5"></td>
                  <td className="px-2 py-1.5 text-right text-purple-800">
                    {eur(er.ausgabenBoniLohnGesamt)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Austräger-Einsätze */}
      {(er.austraegerEinsaetze.length > 0 || (er.austraegerEinsaetzeEntfallen?.length ?? 0) > 0) && (
        <div className="md:col-span-2">
          <h4 className="font-semibold text-gray-700 mb-2 text-sm">Austräger ({er.austraegerEinsaetze.length} Einsätze)</h4>
          <div className="overflow-hidden rounded border border-gray-200 bg-white">
            <table className="w-full text-xs">
              <thead className="bg-gray-100 text-gray-600">
                <tr>
                  <th className="px-2 py-1.5 text-left font-medium">KW</th>
                  <th className="px-2 py-1.5 text-left font-medium">Teilgebiet</th>
                  <th className="px-2 py-1.5 text-right font-medium" title="Soll-Zeit gesamt (Laufen + Stecken + externe Beilagen)">Soll-Zeit</th>
                  <th className="px-2 py-1.5 text-right font-medium text-purple-700" title="Anteil Zeit für externe Beilagen">davon ext. Beil.</th>
                  <th className="px-2 py-1.5 text-right font-medium">Grundlohn</th>
                  <th className="px-2 py-1.5 text-right font-medium text-amber-700" title="Gewichtszuschlag Anzeigenblatt">Gew. AB</th>
                  <th className="px-2 py-1.5 text-right font-medium text-amber-700" title="Gewichtszuschlag Beilagen">Gew. Beil.</th>
                  <th className="px-2 py-1.5 text-right font-medium">Sonder</th>
                  <th className="px-2 py-1.5 text-right font-medium">Gesamt</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {er.austraegerEinsaetze.map((e, i) => {
                  const gAB = e.detail.gewichtsbonusAnzeigenblatt ?? 0;
                  const gBeil = e.detail.gewichtsbonusBeilagen ?? 0;
                  const grundMitSpringer = e.detail.grundlohn + e.detail.springerZuschlag;
                  return (
                    <tr key={i}>
                      <td className="px-2 py-1.5 text-gray-500">{e.kw}/{e.jahr}</td>
                      <td className="px-2 py-1.5">
                        <span className="font-medium text-gray-800">{e.teilgebietName}</span>
                        {e.typ === 'springer' && (
                          <span className="ml-2 bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">Springer</span>
                        )}
                        {e.nachtrag && (
                          <span
                            className="ml-2 bg-emerald-100 text-emerald-800 px-1.5 py-0.5 rounded"
                            title="Nachtrag nach dem Monatswechsel — mit Teilgebiets-/Parameter-Stand des Monatswechsels neu gerechnet"
                          >
                            📌 Nachtrag
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-1.5 text-right text-gray-500">{stdMin(e.detail.zeitStunden)}</td>
                      <td className="px-2 py-1.5 text-right text-purple-700" title={`${e.detail.anzahlExtBeilagen ?? 0} externe Beilage(n)`}>
                        {(e.detail.zeitExtBeilagenStunden ?? 0) > 0
                          ? stdMin(e.detail.zeitExtBeilagenStunden ?? 0)
                          : '—'}
                      </td>
                      <td className="px-2 py-1.5 text-right text-gray-700">{eur(grundMitSpringer)}</td>
                      <td className="px-2 py-1.5 text-right text-amber-700">{gAB > 0 ? eur(gAB) : '—'}</td>
                      <td className="px-2 py-1.5 text-right text-amber-700">{gBeil > 0 ? eur(gBeil) : '—'}</td>
                      <td className="px-2 py-1.5 text-right text-gray-700">{e.detail.sonderbetrag > 0 ? eur(e.detail.sonderbetrag) : '—'}</td>
                      <td className="px-2 py-1.5 text-right font-semibold text-gray-900">{eur(e.detail.gesamt)}</td>
                    </tr>
                  );
                })}
                {(er.austraegerEinsaetzeEntfallen ?? []).map((e) => (
                  <tr key={`entfallen-${e.teilgebietId}-${e.jahr}-${e.kw}`} className="bg-gray-50/60 text-gray-400">
                    <td className="px-2 py-1.5">{e.kw}/{e.jahr}</td>
                    <td className="px-2 py-1.5" colSpan={7}>
                      <span className="line-through">{e.teilgebietName}</span>
                      <span className="ml-2 text-red-600">
                        entfällt — Nachtrag nach Monatswechsel (fixiert waren {eur(e.detail.gesamt)})
                      </span>
                    </td>
                    <td className="px-2 py-1.5 text-right">—</td>
                  </tr>
                ))}
                <tr className="bg-gray-50 border-t border-gray-200 font-semibold">
                  <td className="px-2 py-1.5 text-gray-700" colSpan={2}>∑</td>
                  <td className="px-2 py-1.5 text-right text-gray-600">
                    {stdMin(er.austraegerEinsaetze.reduce((s, e) => s + e.detail.zeitStunden, 0))}
                  </td>
                  <td className="px-2 py-1.5 text-right text-purple-700">
                    {stdMin(er.austraegerEinsaetze.reduce((s, e) => s + (e.detail.zeitExtBeilagenStunden ?? 0), 0))}
                  </td>
                  <td className="px-2 py-1.5 text-right text-gray-700">
                    {eur(er.austraegerEinsaetze.reduce(
                      (s, e) => s + e.detail.grundlohn + e.detail.springerZuschlag, 0
                    ))}
                  </td>
                  <td className="px-2 py-1.5 text-right text-amber-700">
                    {eur(er.gewichtsbonusAnzeigenblatt)}
                  </td>
                  <td className="px-2 py-1.5 text-right text-amber-700">
                    {eur(er.gewichtsbonusBeilagen)}
                  </td>
                  <td className="px-2 py-1.5 text-right text-gray-700">
                    {eur(er.austraegerEinsaetze.reduce(
                      (s, e) => s + e.detail.sonderbetrag, 0
                    ))}
                  </td>
                  <td className="px-2 py-1.5 text-right text-gray-900">{eur(er.austraegerGesamt)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Zusammentragen */}
      {(er.zusammentragenEinsaetze.length > 0 || (er.zusammentragenEinsaetzeEntfallen?.length ?? 0) > 0) && (
        <div>
          <h4 className="font-semibold text-gray-700 mb-2 text-sm">Zusammentragen ({er.zusammentragenEinsaetze.length} Einsätze)</h4>
          <div className="overflow-hidden rounded border border-gray-200 bg-white">
            <table className="w-full text-xs">
              <thead className="bg-gray-100 text-gray-600">
                <tr>
                  <th className="px-2 py-1.5 text-left font-medium">KW</th>
                  <th className="px-2 py-1.5 text-left font-medium">Teilgebiet</th>
                  <th className="px-2 py-1.5 text-left font-medium">Art</th>
                  <th className="px-2 py-1.5 text-right font-medium" title="Stückzahl des Teilgebiets">Stück</th>
                  <th className="px-2 py-1.5 text-right font-medium">Stapel</th>
                  <th className="px-2 py-1.5 text-right font-medium" title="Anzahl interner Beilagen, die mit zusammengetragen wurden">int. Beil.</th>
                  <th className="px-2 py-1.5 text-right font-medium" title="Anzahl externer Beilagen dieses Teilgebiets (Info — werden vom Austräger eingelegt, nicht beim Zusammentragen)">ext. Beil.</th>
                  <th className="px-2 py-1.5 text-right font-medium" title="Soll-Zeit die vergütet wird">Soll-Zeit</th>
                  <th className="px-2 py-1.5 text-right font-medium">Lohn</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {(() => {
                  const sortiert = [...er.zusammentragenEinsaetze].sort((a, b) => {
                    if (a.kw !== b.kw) return a.kw - b.kw;
                    return (a.teilgebietName ?? '').localeCompare(b.teilgebietName ?? '', 'de', { numeric: true });
                  });
                  const out: ReactElement[] = [];
                  let kwBuffer: typeof sortiert = [];
                  let aktuelleKw: number | null = null;
                  const flushSubtotal = () => {
                    if (kwBuffer.length === 0 || aktuelleKw === null) return;
                    const sumStd = kwBuffer.reduce((s, z) => s + (z.stunden ?? 0), 0);
                    const sumLohn = kwBuffer.reduce((s, z) => s + (z.lohn ?? 0), 0);
                    out.push(
                      <tr key={`sub-${aktuelleKw}`} className="bg-blue-50 border-t border-blue-200">
                        <td className="px-2 py-1.5 text-blue-900 font-medium" colSpan={7}>Σ KW {aktuelleKw}</td>
                        <td className="px-2 py-1.5 text-right text-blue-900 font-medium">{stdMin(sumStd)}</td>
                        <td className="px-2 py-1.5 text-right text-blue-900 font-semibold">{eur(sumLohn)}</td>
                      </tr>
                    );
                  };
                  sortiert.forEach((z, i) => {
                    if (aktuelleKw !== null && z.kw !== aktuelleKw) {
                      flushSubtotal();
                      kwBuffer = [];
                    }
                    aktuelleKw = z.kw;
                    kwBuffer.push(z);
                    out.push(
                      <tr key={i}>
                        <td className="px-2 py-1.5 text-gray-500">{z.kw}</td>
                        <td className="px-2 py-1.5 text-gray-700">{z.teilgebietName ?? '—'}</td>
                        <td className="px-2 py-1.5">
                          {z.istVorarbeit ? (
                            <span className="bg-pink-100 text-pink-700 px-1.5 py-0.5 rounded">Vorarbeit</span>
                          ) : (
                            <span className="text-gray-600">Zusammentragen</span>
                          )}
                          {z.nachtrag && (
                            <span
                              className="ml-2 bg-emerald-100 text-emerald-800 px-1.5 py-0.5 rounded"
                              title="Nachtrag nach dem Monatswechsel — mit Teilgebiets-/Parameter-Stand des Monatswechsels neu gerechnet"
                            >
                              📌 Nachtrag
                            </span>
                          )}
                        </td>
                        <td className="px-2 py-1.5 text-right text-gray-600">{z.stueckzahl != null ? z.stueckzahl.toLocaleString('de-DE') : '—'}</td>
                        <td className="px-2 py-1.5 text-right text-gray-600">{z.istVorarbeit ? '—' : z.stapelBearbeitet}</td>
                        <td className="px-2 py-1.5 text-right text-gray-600">{z.istVorarbeit ? '—' : (z.intBeilagenAnzahl ?? 0)}</td>
                        <td className="px-2 py-1.5 text-right text-gray-600">{z.istVorarbeit ? '—' : (z.extBeilagenAnzahl ?? 0)}</td>
                        <td className="px-2 py-1.5 text-right text-gray-500">
                          {z.stunden != null ? stdMin(z.stunden) : '—'}
                        </td>
                        <td className="px-2 py-1.5 text-right font-semibold text-gray-900">{eur(z.lohn)}</td>
                      </tr>
                    );
                  });
                  flushSubtotal();
                  return out;
                })()}
                {(er.zusammentragenEinsaetzeEntfallen ?? []).map((z, i) => (
                  <tr key={`zt-entfallen-${i}`} className="bg-gray-50/60 text-gray-400">
                    <td className="px-2 py-1.5">{z.kw}</td>
                    <td className="px-2 py-1.5" colSpan={7}>
                      <span className="line-through">{z.istVorarbeit ? 'Vorarbeit' : z.teilgebietName ?? '—'}</span>
                      <span className="ml-2 text-red-600">
                        entfällt — Nachtrag nach Monatswechsel (fixiert waren {eur(z.lohn)})
                      </span>
                    </td>
                    <td className="px-2 py-1.5 text-right">—</td>
                  </tr>
                ))}
                <tr className="bg-gray-50 border-t-2 border-gray-300 font-semibold">
                  <td className="px-2 py-1.5 text-gray-700" colSpan={7}>∑ Gesamt</td>
                  <td className="px-2 py-1.5 text-right text-gray-600">
                    {stdMin(er.zusammentragenEinsaetze.reduce((s, z) => s + (z.stunden ?? 0), 0))}
                  </td>
                  <td className="px-2 py-1.5 text-right text-gray-900">{eur(er.zusammentragenGesamt)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Zeiterfassung */}
      {er.arbeitszeiten.length > 0 && (
        <div>
          <h4 className="font-semibold text-gray-700 mb-2 text-sm">
            Zeiterfassung — {stdMin(er.zeitStunden)} → {eur(er.zeitLohn)}
            {(() => {
              const aufteilung = zeitLohnAufteilung(er);
              if (!aufteilung || aufteilung.vorarbeit <= 0) return null;
              return (
                <span className="ml-2 font-normal text-xs text-gray-500">
                  (<span className="text-teal-700">Vorarbeit {eur(aufteilung.vorarbeit)}</span>
                  {' · '}übrige Zeit {eur(aufteilung.uebrige)})
                </span>
              );
            })()}
          </h4>
          <div className="space-y-1">
            {er.arbeitszeiten.map((az, i) => {
              const nettoMin = az.endTime
                ? Math.max(0, (az.endTime - az.startTime) / 60_000 - az.gesamtPauseMinuten)
                : 0;
              return (
                <div key={i} className="flex items-center justify-between bg-white rounded px-3 py-1.5 border border-gray-200">
                  <div>
                    <span className="text-gray-600">
                      {new Date(az.startTime).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' })}
                    </span>
                    <span className="ml-2 text-gray-500">{az.typ}</span>
                    {az.vorarbeitKappung && (
                      <span
                        className="ml-2 text-xs text-amber-700"
                        title="Vorarbeit außerhalb des Zeitfensters der Ausgabe gilt als Zusammentragen und wird nicht nach Zeit vergütet"
                      >
                        Zeitfenster {zeitfensterText(az.vorarbeitKappung)} — erfasst {stdMin(az.vorarbeitKappung.originalNettoMin / 60)}
                      </span>
                    )}
                  </div>
                  <div className="text-gray-800 font-medium">{stdMin(nettoMin / 60)}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Zeiten, die NICHT in den Lohn einfließen (informativ) */}
      {er.arbeitszeitenNichtAbgerechnet && er.arbeitszeitenNichtAbgerechnet.length > 0 && (() => {
        const typenImBlock = new Set(
          er.arbeitszeitenNichtAbgerechnet.map((a) => a.typ)
        );
        const gruende: string[] = [];
        if (er.mitarbeiter.hatFestgehalt) {
          gruende.push('Festgehalt — Zeit fließt nicht ein');
        } else {
          if (typenImBlock.has('austragen')) {
            gruende.push('Austragen: über Teilgebiet (Strecke + Stückzahl) abgerechnet');
          }
          if (typenImBlock.has('zusammentragen')) {
            gruende.push('Zusammentragen: über Stapel/Stückzahl abgerechnet');
          }
          if (er.arbeitszeitenNichtAbgerechnet.some((a) => a.typ === 'vorarbeit' && !a.vorarbeitKappung)) {
            gruende.push(
              'Vorarbeit: in keiner Ausgabe dieser Periode freigegeben (Kennzeichen „Vorarbeit freigegeben" in Ausgabenplanung setzen)'
            );
          }
          if (er.arbeitszeitenNichtAbgerechnet.some((a) => a.vorarbeitKappung)) {
            gruende.push('Vorarbeit: vollständig außerhalb des Zeitfensters der Ausgabe — gilt als Zusammentragen');
          }
        }
        return (
          <div>
            <h4 className="font-semibold text-gray-500 mb-2 text-sm">
              Zeiten ohne Lohn-Abrechnung
            </h4>
            {gruende.length > 0 && (
              <ul className="text-xs text-gray-500 mb-2 space-y-0.5 list-disc list-inside">
                {gruende.map((g, i) => <li key={i}>{g}</li>)}
              </ul>
            )}
            <div className="space-y-1">
              {er.arbeitszeitenNichtAbgerechnet.map((az, i) => {
                const nettoMin = az.endTime
                  ? Math.max(0, (az.endTime - az.startTime) / 60_000 - az.gesamtPauseMinuten)
                  : 0;
                return (
                  <div
                    key={i}
                    className="flex items-center justify-between bg-gray-50 rounded px-3 py-1.5 border border-gray-200 text-gray-500"
                  >
                    <div>
                      <span>
                        {new Date(az.startTime).toLocaleDateString('de-DE', {
                          weekday: 'short', day: '2-digit', month: '2-digit',
                        })}
                      </span>
                      <span className="ml-2">{az.typ}</span>
                      {az.vorarbeitKappung && (
                        <span className="ml-2 text-xs text-amber-700">
                          außerhalb Zeitfenster {zeitfensterText(az.vorarbeitKappung)}
                        </span>
                      )}
                    </div>
                    <div className="font-medium">{stdMin(nettoMin / 60)}</div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* Fixes Gehalt & Fahrtkosten */}
      {(er.fixesGehalt > 0 || er.fahrten.length > 0) && (
        <div>
          {er.fixesGehalt > 0 && (
            <div className="bg-white rounded px-3 py-2 border border-gray-200 mb-2">
              <div className="flex justify-between">
                <span className="text-gray-600">Fixes Gehalt</span>
                <span className="font-semibold text-gray-900">{eur(er.fixesGehalt)}</span>
              </div>
            </div>
          )}
          {er.fahrten.length > 0 && (
            <div>
              <h4 className="font-semibold text-gray-700 mb-1 text-sm">
                Fahrtkosten ({er.fahrten.length} Fahrten · {er.fahrtSatzEurProKm.toFixed(2)} €/km)
              </h4>
              <div className="space-y-1">
                {er.fahrten.map((f, i) => (
                  <div key={i} className="flex justify-between bg-white rounded px-3 py-1.5 border border-gray-200">
                    <span className="text-gray-600">
                      {f.datum} · {f.streckKm} km → {f.ziel}
                      {f.bemerkung && <span className="text-gray-400 ml-1">({f.bemerkung})</span>}
                    </span>
                    <span className="font-medium text-gray-900">{eur(f.streckKm * er.fahrtSatzEurProKm)}</span>
                  </div>
                ))}
              </div>
              <div className="mt-1 text-right font-semibold text-gray-800 pr-1">
                ∑ {er.fahrten.reduce((s, f) => s + f.streckKm, 0)} km · {eur(er.fahrtkostenGesamt)}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Vorschüsse */}
      {periode && (
        <VorschussverwaltungDetail
          mitarbeiterId={er.mitarbeiter.id}
          periodeId={periode.id}
          vorschuesse={er.vorschuesse}
          vormerkungen={er.vorschussVormerkungen ?? []}
          onChange={onVorschussChange ?? (() => {})}
          istGesperrt={istGesperrt}
        />
      )}
    </div>
  );
}

// ---- Vorschuss-Verwaltung in Detail-Ansicht -----------------

function VorschussverwaltungDetail({
  mitarbeiterId,
  periodeId,
  vorschuesse,
  vormerkungen,
  onChange,
  istGesperrt,
}: {
  mitarbeiterId: string;
  periodeId: string;
  vorschuesse: Vorschuss[];
  /** Im Einsätze-Screen vorgemerkte Vorschüsse — nur Hinweis. */
  vormerkungen: VorschussVormerkung[];
  onChange: () => void;
  istGesperrt?: boolean;
}) {
  const { userRole } = useApp();
  // Bei abgeschlossener Periode keine Manipulationen mehr.
  const isAdmin = userRole === 'admin' && !istGesperrt;
  const [showForm, setShowForm] = useState(false);
  const [editTarget, setEditTarget] = useState<Vorschuss | null>(null);
  const [betrag, setBetrag] = useState('');
  const [bemerkung, setBemerkung] = useState('');
  const [saving, setSaving] = useState(false);

  function oeffneForm(v?: Vorschuss) {
    if (v) {
      setEditTarget(v);
      setBetrag(v.betragEur.toString());
      setBemerkung(v.bemerkung ?? '');
    } else {
      setEditTarget(null);
      setBetrag('');
      setBemerkung('');
    }
    setShowForm(true);
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    const betragEur = parseFloat(betrag);
    if (isNaN(betragEur) || betragEur <= 0) return;
    setSaving(true);
    try {
      if (editTarget) {
        await aktualisiereVorschuss(editTarget.id, { betragEur, bemerkung: bemerkung || undefined });
      } else {
        await erstelleVorschuss({ mitarbeiterId, abrechnungsperiodeId: periodeId, betragEur, bemerkung: bemerkung || undefined });
      }
      setShowForm(false);
      onChange();
    } finally {
      setSaving(false);
    }
  }

  async function handleLoeschen(id: string) {
    if (!confirm('Vorschuss wirklich löschen?')) return;
    await loescheVorschuss(id);
    onChange();
  }

  return (
    <div className="md:col-span-2">
      <div className="flex items-center justify-between mb-2">
        <h4 className="font-semibold text-gray-700 text-sm">
          Vorschüsse
          {vorschuesse.length > 0 && (
            <span className="ml-2 font-normal text-red-600">
              — ∑ {eur(vorschuesse.reduce((s, v) => s + v.betragEur, 0))}
            </span>
          )}
        </h4>
        {isAdmin && !showForm && (
          <button
            onClick={() => oeffneForm()}
            className="text-xs text-blue-600 hover:text-blue-800 underline"
          >
            + Vorschuss erfassen
          </button>
        )}
      </div>

      {vormerkungen.length > 0 && (
        <div className="mb-2 rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
          <div className="font-medium mb-1">
            💶 Als Vorschuss vorgemerkt (Einsätze/Planung) — Hinweis, wird nicht automatisch abgezogen:
          </div>
          <ul className="space-y-0.5">
            {vormerkungen.map((v) => (
              <li key={`${v.jahr}-${v.kw}-${v.teilgebietId}`} className="flex items-center gap-2">
                <span>
                  KW {v.kw}/{v.jahr} · {v.teilgebietName}: <strong>{v.betragEur != null ? eur(v.betragEur) : '—'}</strong>
                </span>
                {isAdmin && !showForm && (
                  <button
                    type="button"
                    onClick={() => {
                      setEditTarget(null);
                      setBetrag(v.betragEur != null ? v.betragEur.toFixed(2) : '');
                      setBemerkung(`Vorschuss KW ${v.kw} · ${v.teilgebietName}`);
                      setShowForm(true);
                    }}
                    className="text-blue-600 hover:text-blue-800 underline"
                    title="Betrag und Bemerkung ins Vorschuss-Formular übernehmen (Erfassen bestätigt die Buchung)"
                  >
                    ins Formular übernehmen
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {showForm && (
        <form onSubmit={handleSave} className="bg-white rounded border border-blue-200 p-3 mb-2 flex flex-wrap gap-3 items-end">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Betrag (€) *</label>
            <input
              type="number"
              min="0.01"
              step="0.01"
              value={betrag}
              onChange={(e) => setBetrag(e.target.value)}
              placeholder="z.B. 50.00"
              className="border border-gray-300 rounded px-2 py-1 text-xs w-28 focus:outline-none focus:ring-1 focus:ring-blue-500"
              autoFocus
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Bemerkung</label>
            <input
              type="text"
              value={bemerkung}
              onChange={(e) => setBemerkung(e.target.value)}
              placeholder="Optional"
              className="border border-gray-300 rounded px-2 py-1 text-xs w-48 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={saving || !betrag}
              className="bg-blue-600 text-white px-3 py-1 rounded text-xs font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? '...' : editTarget ? 'Speichern' : 'Erfassen'}
            </button>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1"
            >
              Abbrechen
            </button>
          </div>
        </form>
      )}

      {vorschuesse.length === 0 ? (
        <div className="text-gray-400 text-xs bg-white rounded border border-gray-200 px-3 py-2">
          Keine Vorschüsse erfasst
        </div>
      ) : (
        <div className="space-y-1">
          {vorschuesse.map((v) => (
            <div key={v.id} className="flex items-center justify-between bg-white rounded px-3 py-1.5 border border-red-100">
              <div>
                <span className="font-medium text-red-700">- {eur(v.betragEur)}</span>
                {v.bemerkung && <span className="text-gray-500 ml-2">{v.bemerkung}</span>}
                <span className="text-gray-400 ml-2 text-xs">
                  {new Date(v.erstelltAm).toLocaleDateString('de-DE')}
                </span>
              </div>
              {isAdmin && !showForm && (
                <div className="flex gap-2">
                  <button onClick={() => oeffneForm(v)} className="text-xs text-blue-600 hover:text-blue-800">Bearbeiten</button>
                  <button onClick={() => handleLoeschen(v.id)} className="text-xs text-red-500 hover:text-red-700">Löschen</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---- Bonus / Variabler Periodenzusatz Editor -----------------

function BonusEditor({
  mitarbeiterId,
  periodeId,
  bonus,
  bonusKommentar,
  bonusId,
  onChange,
  istGesperrt,
}: {
  mitarbeiterId: string;
  periodeId: string;
  bonus: number;
  bonusKommentar?: string;
  bonusId?: string;
  onChange: () => void;
  istGesperrt?: boolean;
}) {
  const { userRole } = useApp();
  const isAdmin = userRole === 'admin' && !istGesperrt;
  const [edit, setEdit] = useState(false);
  const [betrag, setBetrag] = useState(bonus ? bonus.toString() : '');
  const [kommentar, setKommentar] = useState(bonusKommentar ?? '');
  const [saving, setSaving] = useState(false);

  function oeffnen() {
    setBetrag(bonus ? bonus.toString() : '');
    setKommentar(bonusKommentar ?? '');
    setEdit(true);
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    const betragEur = parseFloat(betrag.replace(',', '.'));
    if (isNaN(betragEur)) return;
    setSaving(true);
    try {
      if (bonusId) {
        if (betragEur === 0 && !kommentar.trim()) {
          await loescheVariablenPeriodenZusatz(bonusId);
        } else {
          await aktualisiereVariablenPeriodenZusatz(bonusId, {
            betragEur,
            kommentar: kommentar.trim() || undefined,
          });
        }
      } else {
        await erstelleVariablenPeriodenZusatz({
          mitarbeiterId,
          abrechnungsperiodeId: periodeId,
          betragEur,
          kommentar: kommentar.trim() || undefined,
        });
      }
      setEdit(false);
      onChange();
    } finally {
      setSaving(false);
    }
  }

  async function handleLoeschen() {
    if (!bonusId) return;
    if (!confirm('Bonus wirklich löschen?')) return;
    await loescheVariablenPeriodenZusatz(bonusId);
    setEdit(false);
    onChange();
  }

  return (
    <div className="md:col-span-2">
      <div className="flex items-center justify-between mb-2">
        <h4 className="font-semibold text-gray-700 text-sm">
          Bonus
          {bonus !== 0 && (
            <span className={`ml-2 font-normal ${bonus >= 0 ? 'text-green-700' : 'text-red-700'}`}>
              — {eur(bonus)}
              {bonusKommentar && <span className="text-gray-500 ml-1">· {bonusKommentar}</span>}
            </span>
          )}
        </h4>
        {isAdmin && !edit && (
          <button
            onClick={oeffnen}
            className="text-xs text-blue-600 hover:text-blue-800 underline"
          >
            {bonusId ? 'Bearbeiten' : '+ Bonus erfassen'}
          </button>
        )}
      </div>

      {edit && (
        <form onSubmit={handleSave} className="bg-white rounded border border-blue-200 p-3 mb-2 flex flex-wrap gap-3 items-end">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Bonus (€) *</label>
            <input
              type="number"
              step="0.01"
              value={betrag}
              onChange={(e) => setBetrag(e.target.value)}
              placeholder="z.B. 50.00"
              className="border border-gray-300 rounded px-2 py-1 text-xs w-28 focus:outline-none focus:ring-1 focus:ring-blue-500"
              autoFocus
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Kommentar</label>
            <input
              type="text"
              value={kommentar}
              onChange={(e) => setKommentar(e.target.value)}
              placeholder="z.B. Bonus 2024"
              className="border border-gray-300 rounded px-2 py-1 text-xs w-56 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={saving || betrag === ''}
              className="bg-blue-600 text-white px-3 py-1 rounded text-xs font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? '...' : 'Speichern'}
            </button>
            {bonusId && (
              <button
                type="button"
                onClick={handleLoeschen}
                className="text-xs text-red-500 hover:text-red-700 px-2 py-1"
              >
                Löschen
              </button>
            )}
            <button
              type="button"
              onClick={() => setEdit(false)}
              className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1"
            >
              Abbrechen
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

// ---- Einmalige Sonderzahlung Editor ----------------------------
//
// Ein Betrag je MA und Periode mit zwei optionalen Texten:
//   - „Anmerkung Lohnbüro" (aus Textvorlagen wählbar) → Lohnübermittlung
//   - „Anmerkung intern" → nur im Excel-Export

function SonderzahlungEditor({
  mitarbeiterId,
  periodeId,
  ergebnis: er,
  onChange,
  istGesperrt,
}: {
  mitarbeiterId: string;
  periodeId: string;
  ergebnis: MitarbeiterAbrechnung;
  onChange: () => void;
  istGesperrt?: boolean;
}) {
  const { userRole } = useApp();
  const isAdmin = userRole === 'admin' && !istGesperrt;
  const betragAktuell = er.sonderzahlung ?? 0;
  const [edit, setEdit] = useState(false);
  const [betrag, setBetrag] = useState('');
  const [anmerkungLohnbuero, setAnmerkungLohnbuero] = useState('');
  const [anmerkungIntern, setAnmerkungIntern] = useState('');
  const [saving, setSaving] = useState(false);
  const [vorlagen, setVorlagen] = useState<string[]>([]);
  const [vorlagenVerwalten, setVorlagenVerwalten] = useState(false);
  useEffect(() => sonderzahlungVorlagenListener(setVorlagen), []);

  const vorlagenSortiert = [...vorlagen].sort((a, b) => a.localeCompare(b, 'de'));
  const textIstVorlage = vorlagen.some((v) => v.trim() === anmerkungLohnbuero.trim());

  function oeffnen() {
    setBetrag(betragAktuell ? betragAktuell.toString() : '');
    setAnmerkungLohnbuero(er.sonderzahlungAnmerkungLohnbuero ?? '');
    setAnmerkungIntern(er.sonderzahlungAnmerkungIntern ?? '');
    setEdit(true);
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    const betragEur = parseFloat(betrag.replace(',', '.'));
    if (isNaN(betragEur) || betragEur <= 0) {
      alert('Bitte einen Betrag größer 0 eingeben.');
      return;
    }
    setSaving(true);
    try {
      await setzeSonderzahlung({
        abrechnungsperiodeId: periodeId,
        mitarbeiterId,
        betragEur,
        anmerkungLohnbuero,
        anmerkungIntern,
      });
      setEdit(false);
      onChange();
    } catch (err) {
      alert('Speichern fehlgeschlagen: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setSaving(false);
    }
  }

  async function handleLoeschen() {
    if (!er.sonderzahlungId) return;
    if (!confirm('Sonderzahlung wirklich löschen?')) return;
    await loescheSonderzahlung(er.sonderzahlungId);
    setEdit(false);
    onChange();
  }

  async function alsVorlageSpeichern() {
    const text = anmerkungLohnbuero.trim();
    if (!text || textIstVorlage) return;
    try {
      await speichereSonderzahlungVorlagen([...vorlagen, text]);
    } catch (err) {
      alert('Vorlage konnte nicht gespeichert werden: ' + (err instanceof Error ? err.message : String(err)));
    }
  }

  return (
    <div className="md:col-span-2">
      <div className="flex items-center justify-between mb-2">
        <h4 className="font-semibold text-gray-700 text-sm">
          Einmalige Sonderzahlung
          {betragAktuell !== 0 && (
            <span className="ml-2 font-normal text-fuchsia-700">— {eur(betragAktuell)}</span>
          )}
        </h4>
        {isAdmin && !edit && (
          <button onClick={oeffnen} className="text-xs text-blue-600 hover:text-blue-800 underline">
            {er.sonderzahlungId ? 'Bearbeiten' : '+ Sonderzahlung erfassen'}
          </button>
        )}
      </div>

      {!edit && betragAktuell !== 0 && (
        <div className="bg-white rounded border border-fuchsia-100 px-3 py-1.5 space-y-0.5">
          <div>
            <span className="text-gray-500">Anmerkung Lohnbüro:</span>{' '}
            {er.sonderzahlungAnmerkungLohnbuero || <span className="text-gray-300">—</span>}
          </div>
          <div>
            <span className="text-gray-500">Anmerkung intern:</span>{' '}
            {er.sonderzahlungAnmerkungIntern || <span className="text-gray-300">—</span>}
          </div>
        </div>
      )}

      {edit && (
        <form onSubmit={handleSave} className="bg-white rounded border border-blue-200 p-3 mb-2 space-y-3">
          <div className="flex flex-wrap gap-3 items-end">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Betrag (€) *</label>
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={betrag}
                onChange={(e) => setBetrag(e.target.value)}
                placeholder="z.B. 250.00"
                className="border border-gray-300 rounded px-2 py-1 text-xs w-28 focus:outline-none focus:ring-1 focus:ring-blue-500"
                autoFocus
              />
            </div>
            <div className="flex-1 min-w-[16rem]">
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Anmerkung Lohnbüro <span className="font-normal text-gray-400">(erscheint in der Lohnübermittlung)</span>
              </label>
              <div className="flex gap-1.5">
                <select
                  value=""
                  onChange={(e) => {
                    if (e.target.value) setAnmerkungLohnbuero(e.target.value);
                  }}
                  className="border border-gray-300 rounded px-1.5 py-1 text-xs bg-white max-w-[10rem]"
                  title="Textvorlage übernehmen"
                >
                  <option value="">Vorlage…</option>
                  {vorlagenSortiert.map((v) => (
                    <option key={v} value={v}>{v}</option>
                  ))}
                </select>
                <input
                  type="text"
                  value={anmerkungLohnbuero}
                  onChange={(e) => setAnmerkungLohnbuero(e.target.value)}
                  placeholder="z.B. Jahresbonus"
                  className="flex-1 border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
              <div className="mt-1 flex gap-3 text-[11px]">
                {anmerkungLohnbuero.trim() && !textIstVorlage && (
                  <button type="button" onClick={alsVorlageSpeichern} className="text-blue-600 hover:text-blue-800 underline">
                    ☆ Als Vorlage speichern
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setVorlagenVerwalten(true)}
                  className="text-gray-500 hover:text-gray-700 underline"
                >
                  ⚙ Vorlagen verwalten
                </button>
              </div>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Anmerkung intern <span className="font-normal text-gray-400">(nur im Excel-Export, nicht ans Lohnbüro)</span>
            </label>
            <input
              type="text"
              value={anmerkungIntern}
              onChange={(e) => setAnmerkungIntern(e.target.value)}
              placeholder="Optional"
              className="w-full border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={saving || betrag === ''}
              className="bg-blue-600 text-white px-3 py-1 rounded text-xs font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? '...' : 'Speichern'}
            </button>
            {er.sonderzahlungId && (
              <button
                type="button"
                onClick={handleLoeschen}
                className="text-xs text-red-500 hover:text-red-700 px-2 py-1"
              >
                Löschen
              </button>
            )}
            <button
              type="button"
              onClick={() => setEdit(false)}
              className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1"
            >
              Abbrechen
            </button>
          </div>
        </form>
      )}

      <SonderzahlungVorlagenModal
        isOpen={vorlagenVerwalten}
        onClose={() => setVorlagenVerwalten(false)}
        vorlagen={vorlagen}
      />
    </div>
  );
}

/** Textvorlagen für die „Anmerkung Lohnbüro" anlegen, umbenennen, löschen. */
function SonderzahlungVorlagenModal({
  isOpen,
  onClose,
  vorlagen,
}: {
  isOpen: boolean;
  onClose: () => void;
  vorlagen: string[];
}) {
  const [neu, setNeu] = useState('');
  const [editIdx, setEditIdx] = useState<number | null>(null);
  const [editText, setEditText] = useState('');
  const [saving, setSaving] = useState(false);

  const sortiert = vorlagen
    .map((text, idx) => ({ text, idx }))
    .sort((a, b) => a.text.localeCompare(b.text, 'de'));

  const vergeben = (text: string, ausserIdx?: number) =>
    vorlagen.some((v, i) => i !== ausserIdx && v.trim().toLowerCase() === text.trim().toLowerCase());

  async function speichern(liste: string[]): Promise<boolean> {
    setSaving(true);
    try {
      await speichereSonderzahlungVorlagen(liste);
      return true;
    } catch (e) {
      alert('Speichern fehlgeschlagen: ' + (e instanceof Error ? e.message : String(e)));
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function hinzufuegen() {
    const text = neu.trim();
    if (!text) return;
    if (vergeben(text)) {
      alert(`Die Vorlage „${text}" gibt es bereits.`);
      return;
    }
    if (await speichern([...vorlagen, text])) setNeu('');
  }

  async function umbenennen(idx: number) {
    const text = editText.trim();
    if (!text) return;
    if (vergeben(text, idx)) {
      alert(`Die Vorlage „${text}" gibt es bereits.`);
      return;
    }
    if (await speichern(vorlagen.map((v, i) => (i === idx ? text : v)))) setEditIdx(null);
  }

  async function loeschen(idx: number) {
    if (!confirm(`Vorlage „${vorlagen[idx]}" löschen? Bereits erfasste Sonderzahlungen behalten ihren Text.`)) return;
    await speichern(vorlagen.filter((_, i) => i !== idx));
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Textvorlagen „Anmerkung Lohnbüro“" size="md">
      <div className="space-y-4 text-sm">
        {sortiert.length === 0 ? (
          <div className="text-gray-400">Noch keine Vorlagen angelegt.</div>
        ) : (
          <ul className="divide-y divide-gray-100 border border-gray-200 rounded-lg">
            {sortiert.map(({ text, idx }) => (
              <li key={`${idx}-${text}`} className="flex items-center gap-2 px-3 py-1.5">
                {editIdx === idx ? (
                  <>
                    <input
                      type="text"
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') umbenennen(idx); }}
                      autoFocus
                      className="flex-1 border border-gray-300 rounded px-2 py-1 text-sm"
                    />
                    <button
                      type="button"
                      onClick={() => umbenennen(idx)}
                      disabled={saving || !editText.trim()}
                      className="text-xs bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white px-2 py-1 rounded"
                    >
                      OK
                    </button>
                    <button type="button" onClick={() => setEditIdx(null)} className="text-xs text-gray-500 hover:text-gray-700">
                      Abbrechen
                    </button>
                  </>
                ) : (
                  <>
                    <span className="flex-1">{text}</span>
                    <button
                      type="button"
                      onClick={() => { setEditIdx(idx); setEditText(text); }}
                      className="text-xs text-blue-600 hover:text-blue-800"
                    >
                      Umbenennen
                    </button>
                    <button
                      type="button"
                      onClick={() => loeschen(idx)}
                      disabled={saving}
                      className="text-xs text-red-500 hover:text-red-700"
                    >
                      Löschen
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
        <div className="flex gap-2">
          <input
            type="text"
            value={neu}
            onChange={(e) => setNeu(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); hinzufuegen(); } }}
            placeholder="Neue Vorlage, z. B. Jahresbonus"
            className="flex-1 border border-gray-300 rounded px-2 py-1.5 text-sm"
          />
          <button
            type="button"
            onClick={hinzufuegen}
            disabled={saving || !neu.trim()}
            className="text-sm bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white px-3 py-1.5 rounded"
          >
            + Hinzufügen
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ---- Lohnkonto-Editor ----------------------------------------
//
// Verschiebung: Teil des aktuellen Lohns wird NICHT an das Lohnbüro gemeldet,
//   sondern auf das interne Lohnkonto gebucht. Wird intern für Folgemonate vorgehalten.
// Verrechnung:  Aus dem aktuellen Saldo wird ein Betrag dem Lohn dieser Periode
//   zugeschlagen — die an das Lohnbüro gemeldete Summe steigt entsprechend.
// Beide Buchungstypen sind nur für den Admin sichtbar und tauchen NICHT in
// Excel-/PDF-Exporten an das Lohn-/Steuerbüro auf.

function LohnkontoEditor({
  mitarbeiterId,
  periodeId,
  ergebnis,
  onChange,
  istGesperrt,
}: {
  mitarbeiterId: string;
  periodeId: string;
  ergebnis: MitarbeiterAbrechnung;
  onChange: () => void;
  istGesperrt?: boolean;
}) {
  const { userRole, lohnkontoBuchungen, mitarbeiter: alleMa } = useApp();
  // Bei abgeschlossener Periode keine Manipulationen mehr — auch nicht für
  // Admin. Der Verlauf-Button bleibt zur Anzeige sichtbar.
  const isAdmin = userRole === 'admin' && !istGesperrt;
  const [art, setArt] = useState<'verschiebung' | 'verrechnung'>('verschiebung');
  const [betrag, setBetrag] = useState('');
  const [kommentar, setKommentar] = useState('');
  const [saving, setSaving] = useState(false);
  const [fehler, setFehler] = useState('');
  const [verlaufOffen, setVerlaufOffen] = useState(false);

  const buchungenMaCount = lohnkontoBuchungen.filter(
    (b) => b.mitarbeiterId === mitarbeiterId
  ).length;
  const ma = alleMa.find((m) => m.id === mitarbeiterId);

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    setFehler('');
    const betragEur = parseFloat(betrag.replace(',', '.'));
    if (isNaN(betragEur) || betragEur <= 0) {
      setFehler('Bitte einen positiven Betrag eingeben.');
      return;
    }
    // Vergleiche in Cent-Integer rechnen — sonst meldet
    // „79,30 > 79,29999…" einen Fehler, obwohl beide gleich aussehen.
    const toCent = (eur: number) => Math.round(eur * 100);
    const betragCent = toCent(betragEur);
    if (art === 'verschiebung' && betragCent > toCent(ergebnis.gesamt)) {
      setFehler(
        `Verschiebung (${eur(betragEur)}) kann den Brutto dieser Periode (${eur(ergebnis.gesamt)}) nicht übersteigen.`
      );
      return;
    }
    if (art === 'verrechnung') {
      const verfuegbarCent =
        toCent(ergebnis.lohnkontoSaldoVorPeriode) +
        toCent(ergebnis.lohnkontoVerschiebungPeriode) -
        toCent(ergebnis.lohnkontoVerrechnungPeriode);
      if (betragCent > verfuegbarCent) {
        setFehler(
          `Verrechnung (${eur(betragEur)}) übersteigt das verfügbare Lohnkonto (${eur(verfuegbarCent / 100)}).`
        );
        return;
      }
    }
    setSaving(true);
    try {
      await erstelleLohnkontoBuchung({
        mitarbeiterId,
        abrechnungsperiodeId: periodeId,
        art,
        betragEur,
        kommentar: kommentar.trim() || undefined,
      });
      setBetrag('');
      setKommentar('');
      onChange();
    } catch (err) {
      setFehler('Fehler beim Speichern: ' + (err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function handleLoeschen(id: string) {
    if (!confirm('Lohnkonto-Buchung wirklich löschen?')) return;
    await loescheLohnkontoBuchung(id);
    onChange();
  }

  const verfuegbarFuerVerrechnung =
    ergebnis.lohnkontoSaldoVorPeriode +
    ergebnis.lohnkontoVerschiebungPeriode -
    ergebnis.lohnkontoVerrechnungPeriode;

  return (
    <div className="md:col-span-2">
      <div className="flex items-center justify-between mb-2">
        <h4 className="font-semibold text-gray-700 text-sm flex items-center gap-2 flex-wrap">
          🔒 Lohnkonto (intern)
          <span className="text-[10px] font-normal bg-gray-100 text-gray-600 border border-gray-300 px-1.5 py-0.5 rounded">
            nicht im Export an Lohnbüro
          </span>
          {ergebnis.lohnkontoSaldoVorPeriode !== 0 && (
            <span className="font-normal text-gray-600">
              · Saldo VOR Periode: <span className="font-medium text-gray-800">{eur(ergebnis.lohnkontoSaldoVorPeriode)}</span>
            </span>
          )}
          <span className="font-normal text-gray-600">
            · Saldo NACH Periode: <span className={`font-semibold ${ergebnis.lohnkontoSaldoNachPeriode > 0 ? 'text-amber-700' : ergebnis.lohnkontoSaldoNachPeriode < 0 ? 'text-red-700' : 'text-gray-700'}`}>{eur(ergebnis.lohnkontoSaldoNachPeriode)}</span>
          </span>
        </h4>
      </div>

      {/* Bestehende Buchungen dieser Periode */}
      {ergebnis.lohnkontoBuchungenPeriode.length > 0 && (
        <div className="mb-2 rounded border border-amber-200 bg-amber-50 p-2 text-xs">
          <div className="font-medium text-amber-900 mb-1">Buchungen dieser Periode:</div>
          <ul className="space-y-0.5">
            {ergebnis.lohnkontoBuchungenPeriode.map((b) => (
              <li key={b.id} className="flex items-center gap-2">
                <span className={`font-medium ${b.art === 'verschiebung' ? 'text-amber-800' : 'text-green-800'}`}>
                  {b.art === 'verschiebung' ? `−${eur(b.betragEur)} → Lohnkonto` : `+${eur(b.betragEur)} ← Lohnkonto`}
                </span>
                {b.kommentar && <span className="text-gray-600 italic">· {b.kommentar}</span>}
                {isAdmin && (
                  <button
                    type="button"
                    onClick={() => handleLoeschen(b.id)}
                    className="ml-auto text-[10px] text-red-500 hover:text-red-700"
                  >
                    Löschen
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Eingabe-Form */}
      {isAdmin && (
        <form onSubmit={handleSave} className="bg-white rounded border border-blue-200 p-3 mb-2 space-y-2">
          <div className="flex flex-wrap gap-2 items-end">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Aktion</label>
              <select
                value={art}
                onChange={(e) => setArt(e.target.value as 'verschiebung' | 'verrechnung')}
                className="border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                <option value="verschiebung">Auf Lohnkonto verschieben (−)</option>
                <option value="verrechnung">Vom Lohnkonto verrechnen (+)</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Betrag (€) *
                {art === 'verrechnung' && (
                  <span className="text-gray-500 font-normal ml-1">
                    (verfügbar: {eur(verfuegbarFuerVerrechnung)})
                  </span>
                )}
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={betrag}
                onChange={(e) => setBetrag(e.target.value)}
                placeholder="0,00"
                className="border border-gray-300 rounded px-2 py-1 text-xs w-28 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div className="flex-1 min-w-[180px]">
              <label className="block text-xs font-medium text-gray-600 mb-1">Kommentar</label>
              <input
                type="text"
                value={kommentar}
                onChange={(e) => setKommentar(e.target.value)}
                placeholder={art === 'verschiebung' ? 'z.B. Minijob-Grenze, Verschiebung in Folgemonat' : 'z.B. Restguthaben verrechnet'}
                className="border border-gray-300 rounded px-2 py-1 text-xs w-full focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <button
              type="submit"
              disabled={saving || !betrag}
              className="bg-blue-600 text-white px-3 py-1 rounded text-xs font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? '...' : 'Buchen'}
            </button>
          </div>
          {fehler && <div className="text-xs text-red-700">{fehler}</div>}
        </form>
      )}

      {/* Verlauf-Button (öffnet Modal) */}
      {buchungenMaCount > 0 && ma && (
        <>
          <button
            type="button"
            onClick={() => setVerlaufOffen(true)}
            className="text-xs text-blue-600 hover:text-blue-800 underline"
          >
            📜 Verlauf anzeigen ({buchungenMaCount} Buchung{buchungenMaCount === 1 ? '' : 'en'})
          </button>
          <LohnkontoVerlauf
            isOpen={verlaufOffen}
            onClose={() => setVerlaufOffen(false)}
            mitarbeiter={ma}
          />
        </>
      )}
    </div>
  );
}

// ---- Hilfskomponenten ----------------------------------------

function SummaryCard({
  label,
  value,
  farbe,
  textFarbe,
  gross = false,
}: {
  label: string;
  value: string;
  farbe: string;
  textFarbe: string;
  gross?: boolean;
}) {
  return (
    <div className={`rounded-lg border px-3 py-2 ${farbe}`}>
      <div className="text-[10px] text-gray-500 mb-0.5 leading-tight">{label}</div>
      <div className={`font-semibold ${textFarbe} ${gross ? 'text-sm' : 'text-xs'} leading-tight`}>{value}</div>
    </div>
  );
}

// ============================================================
// ABMELDUNGEN ANS LOHNBÜRO
// Listet alle MA, die in dieser Periode ans Lohnbüro gemeldet werden müssen:
// MAs, die durch einen anderen MA ersetzt werden (ersetztMitarbeiterId-Verweis)
// plus MAs, die der User manuell zur Abmeldung markiert hat. Das Kennzeichen
// abgemeldet=true wird beim Periodenabschluss automatisch gesetzt. Das Datum
// kann inline editiert werden — es wird direkt ins MA-Doc geschrieben.
// Anmeldungen werden hier NICHT geführt — das nochNichtAngemeldet-Flag wird
// ausschließlich manuell im Mitarbeiter-Stamm gesetzt/entfernt.
// ============================================================

// ============================================================
// PeriodenMemoBlock — Memos zur Lohnübermittlung
// ============================================================
// Zeigt am Ende der Abrechnung alle Memos, die DIESER Periode zugeordnet
// sind. Filtert admin-only-Memos für die Rolle „abrechnung" aus. Bei
// abgeschlossener Periode read-only.

function PeriodenMemoBlock({
  periodeId,
  istGesperrt,
}: {
  periodeId: string;
  istGesperrt: boolean;
}) {
  const { mitarbeiter, mitarbeiterMemos, memoKategorienEigene, userRole } = useApp();
  const istAdmin = userRole === 'admin';
  const sichtbar = mitarbeiterMemos
    .filter((memo) => memo.abrechnungsperiodeId === periodeId)
    .filter((memo) => istAdmin || !memo.nurAdmin);

  if (sichtbar.length === 0) return null;

  const maById = new Map(mitarbeiter.map((m) => [m.id, m]));
  const sortiert = [...sichtbar].sort((a, b) => {
    const na = maById.get(a.mitarbeiterId)?.name ?? '';
    const nb = maById.get(b.mitarbeiterId)?.name ?? '';
    return na.localeCompare(nb, 'de');
  });

  return (
    <div className="mt-8 mb-4 bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-200 bg-blue-50/40 flex items-center justify-between">
        <h3 className="font-semibold text-gray-900 text-sm">
          📝 Memos zur Lohnübermittlung ({sichtbar.length})
        </h3>
        {istGesperrt && (
          <span className="text-xs text-gray-500">🔒 Periode abgeschlossen — read-only</span>
        )}
      </div>
      <table className="w-full text-sm">
        <thead className="bg-gray-50 border-b border-gray-200 text-gray-600 text-xs">
          <tr>
            <th className="px-3 py-2 text-left font-medium">Mitarbeiter</th>
            <th className="px-3 py-2 text-left font-medium">Nr.</th>
            <th className="px-3 py-2 text-left font-medium">Kategorie</th>
            <th className="px-3 py-2 text-left font-medium">Memo</th>
            <th className="px-3 py-2 text-left font-medium">Ersteller</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {sortiert.map((memo) => {
            const ma = maById.get(memo.mitarbeiterId);
            return (
              <tr key={memo.id} className={memo.nurAdmin ? 'bg-red-50/40' : ''}>
                <td className="px-3 py-2 font-medium text-gray-900">
                  {ma?.name ?? '— gelöschter MA —'}
                  {memo.nurAdmin && (
                    <span className="ml-2 text-[10px] bg-red-100 text-red-700 px-1.5 py-0.5 rounded" title="Nur Admin">🔒</span>
                  )}
                </td>
                <td className="px-3 py-2 text-xs text-gray-500 font-mono">{ma?.nummer ?? '—'}</td>
                <td className="px-3 py-2">
                  <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded">
                    {memoKategorieLabel(memo.kategorie, memoKategorienEigene)}
                  </span>
                </td>
                <td className="px-3 py-2 text-gray-800 whitespace-pre-wrap break-words">
                  {memo.text}
                  {memo.externerLink?.trim() && (
                    <a
                      href={memo.externerLink.trim()}
                      target="_blank"
                      rel="noreferrer"
                      className="ml-2 inline-flex items-center text-xs border border-blue-200 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded px-1.5 py-0.5 align-middle"
                      title={`Externer Link: ${memo.externerLink}`}
                    >
                      🔗 öffnen
                    </a>
                  )}
                </td>
                <td className="px-3 py-2 text-xs text-gray-500">
                  {memo.erstellerName || memo.erstellerRolle}
                  <div className="text-[10px] text-gray-400">
                    {new Date(memo.erstelltAm).toLocaleDateString('de-DE')}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ============================================================
// LohnbueroUebermittlungBlock — Kennzeichen „Echtabrechnung"
// ============================================================
// Kennzeichnet, dass die App-Werte der Periode tatsächlich zur Lohnberechnung
// verwendet wurden (keine Testdaten). Setzbar erst nach Periodenabschluss;
// danach Übermittlungsdatum, Drive-Link und nachträgliche
// Änderungsmitteilungen an das Lohnbüro erfassbar. Die Folgefelder bleiben
// auch nach einem Wieder-Öffnen bearbeitbar (Korrekturfall).

function LohnbueroUebermittlungBlock({ periode }: { periode: Abrechnungsperiode }) {
  const { userRole, adminName } = useApp();
  const istAdmin = userRole === 'admin';
  const istAbgeschlossen = periode.status === 'abgeschlossen';
  const [datum, setDatum] = useState(periode.lohnbueroUebermitteltAm ?? '');
  const [link, setLink] = useState(periode.lohnbueroDriveLink ?? '');
  const [mitteilung, setMitteilung] = useState(periode.lohnbueroAenderungsmitteilung ?? '');
  const [speichert, setSpeichert] = useState(false);

  // Bei Periodenwechsel bzw. Änderung von außen lokale Eingaben nachziehen.
  useEffect(() => {
    setDatum(periode.lohnbueroUebermitteltAm ?? '');
    setLink(periode.lohnbueroDriveLink ?? '');
    setMitteilung(periode.lohnbueroAenderungsmitteilung ?? '');
  }, [periode.id, periode.lohnbueroUebermitteltAm, periode.lohnbueroDriveLink, periode.lohnbueroAenderungsmitteilung]);

  const geaendert =
    datum !== (periode.lohnbueroUebermitteltAm ?? '') ||
    link.trim() !== (periode.lohnbueroDriveLink ?? '') ||
    mitteilung.trim() !== (periode.lohnbueroAenderungsmitteilung ?? '');

  async function speichere(data: Partial<Abrechnungsperiode>) {
    setSpeichert(true);
    try {
      await aktualisiereAbrechnungsperiode(periode.id, data);
    } catch (e: any) {
      alert('Fehler beim Speichern: ' + (e.message ?? e));
    } finally {
      setSpeichert(false);
    }
  }

  async function handleEchtabrechnung(an: boolean) {
    if (an) {
      if (!istAbgeschlossen) return;
      if (!confirm(
        `Periode "${periode.bezeichnung}" als Echtabrechnung kennzeichnen?\n\n` +
        'Damit wird festgehalten, dass die mit der App berechneten Werte tatsächlich ' +
        'zur Lohnberechnung verwendet wurden (keine Testdaten).'
      )) return;
      await speichere({
        echtabrechnung: true,
        echtabrechnungGesetztAm: Date.now(),
        echtabrechnungGesetztVon: adminName || userRole || '',
      });
    } else {
      if (!confirm(
        `Kennzeichen „Echtabrechnung" für "${periode.bezeichnung}" entfernen?\n\n` +
        'Übermittlungsdatum, Drive-Link und Änderungsmitteilung bleiben gespeichert, ' +
        'werden aber ausgeblendet; ein Hinweis in der Folgeperiode erscheint nicht mehr.'
      )) return;
      await speichere({ echtabrechnung: false });
    }
  }

  async function handleSpeichern() {
    await speichere({
      lohnbueroUebermitteltAm: datum,
      lohnbueroDriveLink: link.trim(),
      lohnbueroAenderungsmitteilung: mitteilung.trim(),
      // Ohne Mitteilungstext gibt es nichts zu berücksichtigen.
      ...(mitteilung.trim() ? {} : { inFolgeperiodeBeruecksichtigen: false }),
    });
  }

  const linkGueltig = /^https?:\/\//i.test(link.trim());

  if (!periode.echtabrechnung) {
    return (
      <div className="mt-3 flex items-center gap-2 text-sm">
        <label
          className={`flex items-center gap-2 ${
            istAbgeschlossen && istAdmin ? 'cursor-pointer text-gray-700' : 'cursor-not-allowed text-gray-400'
          }`}
          title={
            !istAbgeschlossen
              ? 'Erst setzbar, wenn die Periode abgeschlossen ist'
              : !istAdmin
                ? 'Nur Admin'
                : 'Kennzeichnet, dass die App-Werte tatsächlich zur Lohnberechnung verwendet wurden'
          }
        >
          <input
            type="checkbox"
            checked={false}
            disabled={!istAbgeschlossen || !istAdmin || speichert}
            onChange={() => handleEchtabrechnung(true)}
          />
          Echtabrechnung — Werte wurden zur Lohnberechnung verwendet (keine Testdaten)
        </label>
        {!istAbgeschlossen && (
          <span className="text-xs text-gray-400 italic">erst nach Periodenabschluss setzbar</span>
        )}
      </div>
    );
  }

  return (
    <div className="mt-3 rounded-lg border border-emerald-300 bg-emerald-50/60 px-4 py-3 text-sm">
      <div className="flex items-center gap-3 flex-wrap">
        <label className={`flex items-center gap-2 font-semibold text-emerald-900 ${istAdmin ? 'cursor-pointer' : ''}`}>
          <input
            type="checkbox"
            checked
            disabled={!istAdmin || speichert}
            onChange={() => handleEchtabrechnung(false)}
          />
          ✔ Echtabrechnung — Werte wurden zur Lohnberechnung verwendet
        </label>
        {periode.echtabrechnungGesetztAm && (
          <span className="text-xs text-emerald-700">
            gesetzt am {new Date(periode.echtabrechnungGesetztAm).toLocaleDateString('de-DE')}
            {periode.echtabrechnungGesetztVon ? ` von ${periode.echtabrechnungGesetztVon}` : ''}
          </span>
        )}
        {!istAbgeschlossen && (
          <span className="text-xs bg-orange-100 text-orange-800 px-2 py-0.5 rounded">
            ⚠ Periode wurde nach der Übermittlung wieder geöffnet
          </span>
        )}
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-[auto_1fr]">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-gray-700">An Steuerbüro übermittelt am</span>
          <input
            type="date"
            value={datum}
            disabled={!istAdmin}
            onChange={(e) => setDatum(e.target.value)}
            className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm bg-white disabled:bg-gray-50"
          />
        </label>
        <label className="flex flex-col gap-1 min-w-0">
          <span className="text-xs font-medium text-gray-700">
            Link Google Drive (übermittelte Abrechnungsdaten &amp; Auswertungen)
          </span>
          <div className="flex items-center gap-2">
            <input
              type="url"
              value={link}
              disabled={!istAdmin}
              placeholder="https://drive.google.com/…"
              onChange={(e) => setLink(e.target.value)}
              className="flex-1 min-w-0 border border-gray-300 rounded-lg px-2 py-1.5 text-sm bg-white disabled:bg-gray-50"
            />
            {linkGueltig && (
              <a
                href={link.trim()}
                target="_blank"
                rel="noreferrer"
                className="shrink-0 text-xs border border-blue-200 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded px-2 py-1"
              >
                🔗 öffnen
              </a>
            )}
          </div>
        </label>
      </div>

      <label className="mt-3 flex flex-col gap-1">
        <span className="text-xs font-medium text-gray-700">
          Nachträgliche Änderungsmitteilungen an das Lohnbüro (was wurde mitgeteilt, z. B. Fehler in der Abrechnung)
        </span>
        <textarea
          value={mitteilung}
          disabled={!istAdmin}
          rows={3}
          placeholder="Nur ausfüllen, wenn nach der Übermittlung noch Korrekturen an das Lohnbüro gemeldet wurden."
          onChange={(e) => setMitteilung(e.target.value)}
          className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm bg-white disabled:bg-gray-50"
        />
      </label>

      <div className="mt-2 flex items-center gap-3 flex-wrap">
        <label
          className={`flex items-center gap-2 ${
            periode.lohnbueroAenderungsmitteilung && istAdmin ? 'cursor-pointer text-gray-800' : 'cursor-not-allowed text-gray-400'
          }`}
          title={
            periode.lohnbueroAenderungsmitteilung
              ? 'Zeigt die Änderungsmitteilung als Hinweis in der Abrechnung der Folgeperiode an'
              : 'Erst eine Änderungsmitteilung erfassen und speichern'
          }
        >
          <input
            type="checkbox"
            checked={!!periode.inFolgeperiodeBeruecksichtigen}
            disabled={!periode.lohnbueroAenderungsmitteilung || !istAdmin || speichert}
            onChange={(e) => speichere({ inFolgeperiodeBeruecksichtigen: e.target.checked })}
          />
          In Folgeperiode zu berücksichtigen
        </label>
        {istAdmin && geaendert && (
          <>
            <button
              onClick={handleSpeichern}
              disabled={speichert}
              className="ml-auto bg-emerald-600 text-white px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-emerald-700 transition-colors disabled:opacity-50"
            >
              {speichert ? 'Speichere…' : 'Speichern'}
            </button>
            <button
              onClick={() => {
                setDatum(periode.lohnbueroUebermitteltAm ?? '');
                setLink(periode.lohnbueroDriveLink ?? '');
                setMitteilung(periode.lohnbueroAenderungsmitteilung ?? '');
              }}
              disabled={speichert}
              className="text-sm text-gray-500 hover:text-gray-700"
            >
              Verwerfen
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function AnAbmeldungenListe({
  periode,
  istGesperrt,
  ergebnisse,
}: {
  periode: Abrechnungsperiode;
  istGesperrt: boolean;
  ergebnisse: MitarbeiterAbrechnung[];
}) {
  const { mitarbeiter, teilgebiete, abrechnungsperioden, adminName } = useApp();

  /** MA-Änderung mit Eintrag im Stammdaten-Änderungsprotokoll. */
  async function aendereMa(maId: string, data: Partial<Mitarbeiter>) {
    const alt = mitarbeiter.find((x) => x.id === maId);
    if (!alt) return aktualisiereMitarbeiter(maId, data);
    await aktualisiereMitarbeiterMitProtokoll(alt, data, {
      adminName,
      ktx: { mitarbeiter, teilgebiete, abrechnungsperioden },
    });
  }

  // IDs der MA, die in der aktuellen Berechnung mit Beträgen vorkommen
  const idsMitBetrag = new Set<string>();
  for (const e of ergebnisse) {
    if (e.gesamt > 0 || e.bruttoLohnbuero > 0) idsMitBetrag.add(e.mitarbeiter.id);
  }

  // Periodenende: letzter Tag des Monats (ISO-Date YYYY-MM-DD).
  const periodenEndeIso = periodenEndeIsoVon(periode);
  function effektivesAbmeldedatum(m: Mitarbeiter): string {
    return m.abmeldungUebermittlungDatum ?? periodenEndeIso;
  }

  // Abmeldungen: ersetzte MAs (deren ID an einem anderen MA als
  // ersetztMitarbeiterId steht). Plus ggf. bereits manuell abgemeldete in
  // dieser Periode (letzteAbrechnungsperiodeId === periode.id).
  const ersetzteIds = new Set<string>();
  for (const m of mitarbeiter) {
    if (m.ersetztMitarbeiterId) ersetzteIds.add(m.ersetztMitarbeiterId);
  }
  const abmeldungen = offeneAbmeldungen(periode, mitarbeiter);

  // Vorschläge: aktive MA ohne Betrag in dieser Abrechnung — Kandidaten für
  // Abmeldung. Ausschluss: Interessenten (nie beim Lohnbüro angemeldet),
  // Festgehalt, Geschäftsführer, bereits abgemeldet, „vorläufig nicht
  // abmelden", noch nicht angemeldet, schon in Abmeldungs-Liste.
  //
  // Hinweis: Der frühere „Wechsel-Verlierer"-Pfad (Standardausträger, der
  // sein letztes TG durch einen vorbereiteten Austrägerwechsel verliert)
  // ist entfallen, weil der separate Reiter „Austrägerwechsel vorbereiten"
  // abgeschafft wurde. Wechsel laufen jetzt über den Wechselplan in der
  // Personalplanung — ihre Auswirkung auf die Abmelde-Liste wird zum
  // Zeitpunkt der Wechsel-Übernahme im Monatswechsel-Dialog sichtbar.
  const abmeldungVorschlaege = mitarbeiter
    .filter((m) => {
      const grund =
        m.isActive
        && !m.istInteressent
        && !m.abgemeldet
        && !m.vorlaeufigNichtAbmelden
        && !m.nochNichtAngemeldet
        && !m.hatFestgehalt
        && !m.istGeschaeftsfuehrer
        && !ersetzteIds.has(m.id)
        && m.letzteAbrechnungsperiodeId !== periode.id;
      if (!grund) return false;
      return !idsMitBetrag.has(m.id);
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  // MA-Auswahl-Modal (manuell hinzufügen)
  const [showAuswahlAb, setShowAuswahlAb] = useState(false);

  async function handleAbmeldedatumAendern(m: Mitarbeiter, datum: string) {
    if (datum === m.abmeldungUebermittlungDatum) return;
    // Datum darf nicht NACH dem Periodenende liegen — sonst würde der MA
    // mit einem späteren Abmeldedatum geführt, beim Abschluss aber bereits
    // als „abgemeldet" markiert und in Folgeperioden nicht mehr erscheinen.
    if (datum && datum > periodenEndeIso) {
      alert(
        `Das Abmeldedatum darf nicht nach dem Ende der Abrechnungsperiode (${periodenEndeIso}) liegen.\n\n` +
          `Sonst würde der Mitarbeiter mit dem Abschluss als abgemeldet gekennzeichnet, sein Abmeldedatum aber nach der Periode liegen — er erschiene in der nächsten Abrechnung nicht mehr, obwohl er dort eigentlich noch hingehört.`
      );
      return;
    }
    await aendereMa(m.id, { abmeldungUebermittlungDatum: datum || undefined });
  }

  async function handleAuswahlAb(m: Mitarbeiter) {
    await aendereMa(m.id, { letzteAbrechnungsperiodeId: periode.id });
    setShowAuswahlAb(false);
  }

  async function handleVomAbEntfernen(m: Mitarbeiter) {
    if (!confirm(`„${m.name}" aus der Abmelde-Liste entfernen?`)) return;
    // Wenn er nur über letzteAbrechnungsperiodeId in der Liste war: Feld löschen.
    // Wenn er über ersetztMitarbeiterId eines anderen MA dort steht, müssen wir
    // das beim ersetzenden MA aufheben — sonst taucht er sofort wieder auf.
    const ersetzendeMa = mitarbeiter.find((x) => x.ersetztMitarbeiterId === m.id);
    if (ersetzendeMa) {
      if (!confirm(
        `„${m.name}" wurde von „${ersetzendeMa.name}" als ersetzt markiert. Soll diese Verknüpfung aufgehoben werden?`
      )) return;
      await aendereMa(ersetzendeMa.id, { ersetztMitarbeiterId: undefined });
    }
    await aendereMa(m.id, { letzteAbrechnungsperiodeId: undefined });
  }

  // Kandidaten für die manuelle Auswahl
  const kandidatenAb = mitarbeiter
    .filter(
      (m) =>
        !m.abgemeldet &&
        !m.istInteressent &&
        !ersetzteIds.has(m.id) &&
        m.letzteAbrechnungsperiodeId !== periode.id
    )
    .sort((a, b) => a.name.localeCompare(b.name));

  // Snapshot-Anzeige wenn beim Abschluss schon eine Abmelde-Liste fixiert
  // wurde — bleibt auch nach Verwerfen erhalten. In der offenen Periode
  // (= Periode wurde wieder geöffnet) bietet jede Zeile „Wieder aktivieren"
  // an; in der abgeschlossenen Periode ist alles read-only.
  const snapshot = periode.abmeldungenSnapshot;
  const istVerworfenMitSnapshot = !!snapshot && periode.status === 'offen';

  async function handleWiederAktivieren(eintrag: { mitarbeiterId: string; name: string }) {
    if (!confirm(
      `„${eintrag.name}" wieder aktivieren? Das Abmelde-Kennzeichen, das Abmeldedatum und die letzte Abrechnungsperiode werden zurückgesetzt; der MA wird wieder als aktiv markiert.`
    )) return;
    await aendereMa(eintrag.mitarbeiterId, {
      abgemeldet: false,
      isActive: true,
      abmeldungUebermittlungDatum: undefined,
      letzteAbrechnungsperiodeId: undefined,
    });
    await entferneAusAbmeldungenSnapshot(periode.id, eintrag.mitarbeiterId);
  }

  if (snapshot) {
    return (
      <div className="mt-6">
        <div className="bg-white rounded-xl shadow-sm border border-red-200 overflow-hidden">
          <div className="bg-red-50 px-4 py-2 border-b border-red-200 flex items-center justify-between">
            <h3 className="font-semibold text-red-900 text-sm">
              🚪 Abmeldungen ans Lohnbüro (Snapshot)
              <span className="ml-2 font-normal text-xs text-red-700">
                ({snapshot.eintraege.length})
              </span>
            </h3>
            <span className="text-[10px] text-red-700">
              Stand {new Date(snapshot.erstelltAm).toLocaleDateString('de-DE')}
              {istVerworfenMitSnapshot && ' · Periode wurde wieder geöffnet'}
            </span>
          </div>
          {snapshot.eintraege.length === 0 ? (
            <div className="px-4 py-6 text-center text-gray-400 text-xs italic">
              Snapshot ist leer.
            </div>
          ) : (
            <table className="w-full text-xs">
              <thead className="bg-gray-50 text-gray-600 border-b border-gray-200">
                <tr>
                  <th className="px-3 py-1.5 text-left font-medium">Mitarbeiter</th>
                  <th className="px-3 py-1.5 text-left font-medium">Abmeldung zum</th>
                  <th className="px-3 py-1.5 text-left font-medium">Ersetzt durch</th>
                  <th className="px-3 py-1.5 text-right font-medium">Aktion</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {snapshot.eintraege.map((e) => {
                  const ersetzendeMa = e.ersetztDurchId
                    ? mitarbeiter.find((m) => m.id === e.ersetztDurchId)
                    : undefined;
                  return (
                    <tr key={e.mitarbeiterId} className="hover:bg-red-50/40">
                      <td className="px-3 py-1.5">
                        <span className="font-medium text-gray-900">{e.name}</span>
                        <span className="ml-1 text-gray-400 text-[10px]">({e.nummer})</span>
                      </td>
                      <td className="px-3 py-1.5 text-gray-700">{e.abmeldedatum}</td>
                      <td className="px-3 py-1.5 text-gray-700">
                        {ersetzendeMa ? (
                          <span>
                            {ersetzendeMa.name}
                            <span className="ml-1 text-gray-400 text-[10px]">({ersetzendeMa.nummer})</span>
                          </span>
                        ) : (
                          <span className="text-gray-300">—</span>
                        )}
                      </td>
                      <td className="px-3 py-1.5 text-right">
                        {istVerworfenMitSnapshot ? (
                          <button
                            onClick={() => handleWiederAktivieren(e)}
                            className="text-xs text-green-700 hover:text-green-900 font-medium px-1.5"
                            title="MA wieder aktivieren und Abmelde-Kennzeichen entfernen"
                          >
                            ↺ wieder aktivieren
                          </button>
                        ) : (
                          <span className="text-[10px] text-gray-400 italic">eingefroren</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="mt-6">
      {/* Abmeldungen */}
      <div className="bg-white rounded-xl shadow-sm border border-red-200 overflow-hidden">
        <div className="bg-red-50 px-4 py-2 border-b border-red-200 flex items-center justify-between">
          <h3 className="font-semibold text-red-900 text-sm">
            🚪 Abmeldungen ans Lohnbüro
            <span className="ml-2 font-normal text-xs text-red-700">
              ({abmeldungen.length})
            </span>
          </h3>
          {!istGesperrt && (
            <button
              onClick={() => setShowAuswahlAb(true)}
              className="text-xs text-red-700 hover:text-red-900 underline"
            >
              + MA hinzufügen
            </button>
          )}
        </div>
        {abmeldungen.length === 0 ? (
          <div className="px-4 py-6 text-center text-gray-400 text-xs italic">
            Keine offenen Abmeldungen.
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead className="bg-gray-50 text-gray-600 border-b border-gray-200">
              <tr>
                <th className="px-3 py-1.5 text-left font-medium">Mitarbeiter</th>
                <th className="px-3 py-1.5 text-left font-medium">Abmeldung zum</th>
                <th className="px-3 py-1.5 text-left font-medium">Ersetzt durch</th>
                <th className="px-3 py-1.5 w-8"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {abmeldungen.map((m) => {
                const ersetzendeMa = mitarbeiter.find((x) => x.ersetztMitarbeiterId === m.id);
                return (
                  <tr key={m.id} className="hover:bg-red-50/40">
                    <td className="px-3 py-1.5">
                      <span className="font-medium text-gray-900">{m.name}</span>
                      <span className="ml-1 text-gray-400 text-[10px]">({m.nummer})</span>
                    </td>
                    <td className="px-3 py-1.5">
                      <input
                        type="date"
                        defaultValue={effektivesAbmeldedatum(m)}
                        max={periodenEndeIso}
                        disabled={istGesperrt}
                        onBlur={(e) => handleAbmeldedatumAendern(m, e.target.value)}
                        title={`Maximal ${periodenEndeIso} (Ende der Abrechnungsperiode)`}
                        className="border border-gray-200 rounded px-1.5 py-0.5 text-xs disabled:bg-gray-50 disabled:text-gray-500"
                      />
                    </td>
                    <td className="px-3 py-1.5 text-gray-700">
                      {ersetzendeMa ? (
                        <span>
                          {ersetzendeMa.name}
                          <span className="ml-1 text-gray-400 text-[10px]">({ersetzendeMa.nummer})</span>
                        </span>
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      {!istGesperrt && (
                        <button
                          onClick={() => handleVomAbEntfernen(m)}
                          className="text-gray-400 hover:text-red-600 text-[11px]"
                          title="Aus der Liste entfernen"
                        >
                          ✕
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        {/* Vorschläge: aktive MA ohne Betrag — Kandidaten für Abmeldung */}
        {!istGesperrt && abmeldungVorschlaege.length > 0 && (
          <div className="border-t border-red-200 bg-red-50/50 px-4 py-2">
            <details className="text-xs">
              <summary className="cursor-pointer text-red-800 hover:text-red-900 font-medium">
                💡 {abmeldungVorschlaege.length} Vorschlag{abmeldungVorschlaege.length === 1 ? '' : 'e'} (aktive MA ohne Betrag in dieser Periode)
              </summary>
              <p className="mt-1 mb-2 text-[11px] text-red-700">
                Vorschläge: aktive MAs ohne Betrag in der Periode. Klick auf
                „+", um sie zur Abmelde-Liste hinzuzufügen.
              </p>
              <ul className="space-y-1 max-h-48 overflow-y-auto">
                {abmeldungVorschlaege.map((m) => {
                  return (
                    <li key={m.id} className="flex items-center justify-between bg-white rounded border border-red-100 px-2 py-1">
                      <span>
                        <span className="font-medium text-gray-900">{m.name}</span>
                        <span className="ml-1 text-gray-400 text-[10px]">({m.nummer})</span>
                      </span>
                      <button
                        onClick={() => handleAuswahlAb(m)}
                        className="text-xs text-red-700 hover:text-red-900 font-medium px-1.5"
                        title="Zur Abmeldungs-Liste hinzufügen"
                      >
                        + abmelden
                      </button>
                    </li>
                  );
                })}
              </ul>
            </details>
          </div>
        )}
      </div>

      {showAuswahlAb && (
        <MaAuswahlModal
          titel="Mitarbeiter zur Abmeldung hinzufügen"
          mitarbeiter={kandidatenAb}
          onClose={() => setShowAuswahlAb(false)}
          onSelect={handleAuswahlAb}
        />
      )}
    </div>
  );
}

function MaAuswahlModal({
  titel,
  mitarbeiter,
  onClose,
  onSelect,
}: {
  titel: string;
  mitarbeiter: Mitarbeiter[];
  onClose: () => void;
  onSelect: (m: Mitarbeiter) => void;
}) {
  const [filter, setFilter] = useState('');
  const gefiltert = mitarbeiter.filter((m) =>
    !filter ||
    m.name.toLowerCase().includes(filter.toLowerCase()) ||
    m.nummer.includes(filter)
  );
  return (
    <div
      className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md max-h-[80vh] flex flex-col">
        <div className="px-4 py-3 border-b flex items-center justify-between">
          <h3 className="font-semibold text-gray-900 text-sm">{titel}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg">×</button>
        </div>
        <div className="p-3 border-b">
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Name oder Nummer suchen..."
            autoFocus
            className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div className="overflow-y-auto flex-1">
          {gefiltert.length === 0 ? (
            <div className="text-center py-6 text-gray-400 text-sm">Keine passenden Mitarbeiter.</div>
          ) : (
            <ul className="divide-y divide-gray-100">
              {gefiltert.map((m) => (
                <li key={m.id}>
                  <button
                    onClick={() => onSelect(m)}
                    className="w-full text-left px-4 py-2 hover:bg-blue-50 flex items-center justify-between"
                  >
                    <span>
                      <span className="font-medium text-gray-900">{m.name}</span>
                      <span className="ml-2 text-xs text-gray-400">({m.nummer})</span>
                    </span>
                    <span className="text-blue-600 text-xs">›</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
