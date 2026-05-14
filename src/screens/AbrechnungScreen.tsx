import { useState, useEffect, type FormEvent, type ReactElement } from 'react';
import { useApp } from '../context/AppContext';
import AdminPinGate from '../components/AdminPinGate';
import LohnkontoVerlauf from '../components/LohnkontoVerlauf';
import { ladePeriodeData, berechneAbrechnung, eur, stdMin } from '../lib/abrechnungslogik';
import { exportiereAbrechnung, exportiereLohnuebermittlung } from '../lib/exportXlsx';
import {
  schliessePeriodeAb,
  oeffnePeriodeWieder,
  erstelleVorschuss,
  aktualisiereVorschuss,
  loescheVorschuss,
  erstelleVariablenPeriodenZusatz,
  aktualisiereVariablenPeriodenZusatz,
  loescheVariablenPeriodenZusatz,
  erstelleLohnkontoBuchung,
  loescheLohnkontoBuchung,
  ladeLohnkontoBuchungen,
  schreibeMonatswechselSnapshot,
  verwerfeMonatswechselSnapshot,
  aktualisiereMitarbeiter,
  aktualisiereTeilgebiet,
  loescheAustraegerwechsel,
  loescheStueckzahlAnpassung,
  entferneAusAbmeldungenSnapshot,
  ladeFahrten,
  ladeAusgaben,
} from '../lib/db';
import type { MitarbeiterAbrechnung } from '../lib/abrechnungslogik';
import type { Abrechnungsperiode, Vorschuss, Mitarbeiter, Rolle, Ausgabe } from '../types';
import { ROLLEN_LABELS } from '../types';

export default function AbrechnungScreen() {
  return (
    <AdminPinGate>
      <AbrechnungInhalt />
    </AdminPinGate>
  );
}

function AbrechnungInhalt() {
  const { mitarbeiter, teilgebiete, abrechnungsperioden, parameter: params, userRole, variablePeriodenZusaetze, austraegerwechsel, stueckzahlAnpassungen } = useApp();
  const [selectedPeriodeId, setSelectedPeriodeId] = useState('');
  const [ergebnisse, setErgebnisse] = useState<MitarbeiterAbrechnung[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [fehler, setFehler] = useState('');
  const [exportierend, setExportierend] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [abschliessenBestaetigt, setAbschliessenBestaetigt] = useState(false);
  const [monatswechselBestaetigt, setMonatswechselBestaetigt] = useState(false);
  const [zeigeWechselDialog, setZeigeWechselDialog] = useState(false);
  const [zeigeAnpassungDialog, setZeigeAnpassungDialog] = useState(false);
  const [suchbegriff, setSuchbegriff] = useState('');
  const [filterRolle, setFilterRolle] = useState<Rolle | ''>('');
  const [filterMinijob, setFilterMinijob] = useState<'' | 'ja' | 'nein'>('');
  const [filterSvFrei, setFilterSvFrei] = useState<'' | 'ja' | 'nein'>('');
  // Warnung: Fahrtkosten-Datensätze, die noch keiner Abrechnungsperiode
  // zugeordnet sind (abrechnungsperiodeId fehlt).
  const [unzugeordneteFahrten, setUnzugeordneteFahrten] = useState<number>(0);
  // Ausgaben der gewählten Periode — zur Prüfung auf fehlende Seitenzahl /
  // Stapelzahl. Wird beim Periodenwechsel neu geladen.
  const [periodenAusgaben, setPeriodenAusgaben] = useState<Ausgabe[]>([]);

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

  // Liste der Ausgaben mit fehlenden Pflichtwerten (Seitenzahl / Stapelzahl).
  const ausgabenMitFehlendenWerten = periodenAusgaben.filter(
    (a) => !a.seitenzahl || a.seitenzahl <= 0 || !a.stapelAnzahl || a.stapelAnzahl <= 0
  );
  const periodeIstUnvollstaendig = ausgabenMitFehlendenWerten.length > 0;

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

  async function handleBerechnen() {
    if (!selectedPeriode || !params) return;
    setLoading(true);
    setFehler('');
    setErgebnisse(null);
    setExpandedId(null);

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
      const [data, lohnkontoFresh] = await Promise.all([
        ladePeriodeData(selectedPeriode),
        ladeLohnkontoBuchungen(),
      ]);
      const result = berechneAbrechnung(
        mitarbeiter,
        teilgebiete,
        data,
        params,
        selectedPeriode,
        variablePeriodenZusaetze,
        abrechnungsperioden,
        lohnkontoFresh
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
    // selectedPeriodeId reicht als Trigger; wir wollen NICHT auf jede
    // Änderung von `abrechnungsperioden` re-rendern.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPeriodeId, selectedPeriode?.abrechnungSnapshot]);

  async function handleExport() {
    if (!selectedPeriode || !ergebnisse) return;
    setExportierend(true);
    try {
      await exportiereAbrechnung(selectedPeriode, ergebnisse);
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
      await exportiereLohnuebermittlung(selectedPeriode, ergebnisse, mitarbeiter);
    } catch (e: any) {
      alert('Export fehlgeschlagen: ' + (e.message ?? e));
    } finally {
      setExportierend(false);
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
      const ersetzteIds = new Set<string>();
      for (const m of mitarbeiter) {
        if (m.ersetztMitarbeiterId) ersetzteIds.add(m.ersetztMitarbeiterId);
      }
      const heuteIso = new Date().toISOString().slice(0, 10);
      const abzumelden = mitarbeiter.filter(
        (m) =>
          !m.abgemeldet &&
          (ersetzteIds.has(m.id) || m.letzteAbrechnungsperiodeId === selectedPeriode.id)
      );

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
        await aktualisiereMitarbeiter(m.id, {
          abgemeldet: true,
          abmeldungUebermittlungDatum: m.abmeldungUebermittlungDatum ?? heuteIso,
          letzteAbrechnungsperiodeId: selectedPeriode.id,
          isActive: false,
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
      // Vorgemerkte Austrägerwechsel zur Einzel-Bestätigung anbieten.
      if (austraegerwechsel.length > 0) {
        setZeigeWechselDialog(true);
      }
      // Vorgemerkte Stückzahl-Anpassungen ebenfalls anbieten.
      if (stueckzahlAnpassungen.length > 0) {
        setZeigeAnpassungDialog(true);
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
    if (!confirm(`Periode "${selectedPeriode.bezeichnung}" wieder öffnen? Alle Daten bleiben erhalten, Eingaben sind wieder möglich.`)) return;
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
        return true;
      })
    : [];

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Monatsabrechnung</h1>

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
                          ? 'Erst Seitenzahl und Anzahl Stapel für alle Ausgaben dieser Periode eintragen.'
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
                          ? 'Erst Seitenzahl und Anzahl Stapel für alle Ausgaben dieser Periode eintragen.'
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

        {/* Warnung: Ausgaben der Periode mit fehlenden Pflichtwerten */}
        {selectedPeriode && ausgabenMitFehlendenWerten.length > 0 && (
          <div className="mt-3 rounded-lg border border-amber-400 bg-amber-50 px-4 py-3 text-sm">
            <div className="font-semibold text-amber-900 mb-1">
              ⚠ Ausgaben der Periode unvollständig — Monatsabschluss gesperrt
            </div>
            <p className="text-xs text-amber-800 mb-1.5">
              Folgende Ausgaben dieser Periode haben keine Seitenzahl und/oder
              keine Anzahl Stapel eingetragen. Solange Werte fehlen, kann die
              Periode nicht abgeschlossen werden:
            </p>
            <ul className="list-disc list-inside text-amber-900 space-y-0.5">
              {ausgabenMitFehlendenWerten.map((a) => {
                const fehlend: string[] = [];
                if (!a.seitenzahl || a.seitenzahl <= 0) fehlend.push('Seitenzahl');
                if (!a.stapelAnzahl || a.stapelAnzahl <= 0) fehlend.push('Anzahl Stapel');
                return (
                  <li key={a.id} className="text-xs">
                    <strong>KW {a.kw}/{a.jahr}</strong> — fehlt: {fehlend.join(', ')}
                  </li>
                );
              })}
            </ul>
            <p className="text-xs text-amber-700 mt-1.5 italic">
              Bitte unter „Ausgaben &amp; Beilagen" ergänzen.
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
                Zeiten und Fahrtkosten sind weiter erfassbar.
              </span>
            </div>
          )}

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
            {(suchbegriff || filterRolle || filterMinijob || filterSvFrei) && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setSuchbegriff('');
                    setFilterRolle('');
                    setFilterMinijob('');
                    setFilterSvFrei('');
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

          {/* Detailtabelle */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-x-auto">
            <table className="min-w-[1400px] w-full text-sm whitespace-nowrap">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-gray-600 sticky left-0 bg-gray-50 z-20 shadow-[2px_0_4px_-2px_rgba(0,0,0,0.08)]">Mitarbeiter</th>
                  <th className="px-4 py-3 text-right font-medium text-gray-600">Austragen</th>
                  <th className="px-4 py-3 text-right font-medium text-amber-700" title="Gewichtszuschlag Anzeigenblatt (in Austragen enthalten)">Gew. AB</th>
                  <th className="px-4 py-3 text-right font-medium text-amber-700" title="Gewichtszuschlag Beilagen (in Austragen enthalten)">Gew. Beil.</th>
                  <th className="px-4 py-3 text-right font-medium text-gray-600">Zusammentr.</th>
                  <th className="px-4 py-3 text-right font-medium text-gray-600">Zeiterfassung</th>
                  <th className="px-4 py-3 text-right font-medium text-purple-700" title="Tätigkeits-Boni in Minuten je Ausgabe (z. B. Orga, Betreuung Zusammenträger)">Min-Boni</th>
                  <th className="px-4 py-3 text-right font-medium text-gray-600">Fix</th>
                  <th className="px-4 py-3 text-right font-medium text-gray-600">Fahrtkosten</th>
                  <th className="px-4 py-3 text-right font-medium text-gray-600" title="Erbrachte Leistung in dieser Periode (vor Lohnkonto-Bewegung)">Brutto</th>
                  <th className="px-4 py-3 text-right font-medium text-amber-700" title="Verschiebung auf / Verrechnung vom Lohnkonto in dieser Periode">Lohnkonto</th>
                  <th className="px-4 py-3 text-right font-medium text-indigo-700" title="Brutto, das an das Lohnbüro übermittelt wird (= Brutto − Verschiebung + Verrechnung)">An Lohnbüro</th>
                  <th className="px-4 py-3 text-right font-medium text-red-600">Vorschuss</th>
                  <th className="px-4 py-3 text-right font-medium text-gray-600 pr-5">Auszahlung</th>
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
                      <td className="px-4 py-3 text-right text-amber-700">
                        {er.gewichtsbonusAnzeigenblatt > 0 ? eur(er.gewichtsbonusAnzeigenblatt) : '—'}
                      </td>
                      <td className="px-4 py-3 text-right text-amber-700">
                        {er.gewichtsbonusBeilagen > 0 ? eur(er.gewichtsbonusBeilagen) : '—'}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-700">
                        {er.zusammentragenGesamt > 0 ? eur(er.zusammentragenGesamt) : '—'}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-700">
                        {er.zeitLohn > 0 ? eur(er.zeitLohn) : '—'}
                      </td>
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
                      <td className="px-4 py-3 text-right text-gray-700">
                        {er.fixesGehalt > 0 ? eur(er.fixesGehalt) : '—'}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-700">
                        {er.fahrtkostenGesamt > 0 ? eur(er.fahrtkostenGesamt) : '—'}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-gray-900">
                        {eur(er.gesamt)}
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
                        <td colSpan={14} className="bg-gray-50 px-6 py-4">
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
                  <td className="px-4 py-3 text-right font-bold text-amber-700">
                    {eur(ergebnisse.reduce((s, e) => s + e.gewichtsbonusAnzeigenblatt, 0))}
                  </td>
                  <td className="px-4 py-3 text-right font-bold text-amber-700">
                    {eur(ergebnisse.reduce((s, e) => s + e.gewichtsbonusBeilagen, 0))}
                  </td>
                  <td className="px-4 py-3 text-right font-bold text-gray-900">
                    {eur(ergebnisse.reduce((s, e) => s + e.zusammentragenGesamt, 0))}
                  </td>
                  <td className="px-4 py-3 text-right font-bold text-gray-900">
                    {eur(ergebnisse.reduce((s, e) => s + e.zeitLohn, 0))}
                  </td>
                  <td className="px-4 py-3 text-right font-bold text-purple-700">
                    {eur(ergebnisse.reduce((s, e) => s + e.ausgabenBoniLohnGesamt, 0))}
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
        </>
      )}

      {!ergebnisse && !loading && selectedPeriodeId && (
        <div className="text-center py-12 text-gray-400">
          Klicke auf "Berechnen" um die Abrechnung zu starten.
        </div>
      )}

      {zeigeWechselDialog && (
        <AustraegerwechselDialog
          wechsel={austraegerwechsel}
          teilgebiete={teilgebiete}
          mitarbeiter={mitarbeiter}
          onClose={() => setZeigeWechselDialog(false)}
        />
      )}

      {zeigeAnpassungDialog && (
        <StueckzahlAnpassungDialog
          anpassungen={stueckzahlAnpassungen}
          teilgebiete={teilgebiete}
          onClose={() => setZeigeAnpassungDialog(false)}
        />
      )}
    </div>
  );
}

// ---- Modal: Austrägerwechsel-Bestätigung ------------------

function AustraegerwechselDialog({
  wechsel,
  teilgebiete,
  mitarbeiter,
  onClose,
}: {
  wechsel: import('../types').Austraegerwechsel[];
  teilgebiete: import('../types').Teilgebiet[];
  mitarbeiter: Mitarbeiter[];
  onClose: () => void;
}) {
  const tgMap = new Map(teilgebiete.map((t) => [t.id, t]));
  const maMap = new Map(mitarbeiter.map((m) => [m.id, m]));
  const [busyId, setBusyId] = useState<string | null>(null);

  const offen = [...wechsel].sort((a, b) => {
    const na = tgMap.get(a.teilgebietId)?.name ?? '';
    const nb = tgMap.get(b.teilgebietId)?.name ?? '';
    return na.localeCompare(nb, 'de', { numeric: true });
  });

  async function handleUebernehmen(w: import('../types').Austraegerwechsel) {
    const tg = tgMap.get(w.teilgebietId);
    if (!tg) {
      alert('Teilgebiet nicht mehr vorhanden — Eintrag wird verworfen.');
      await loescheAustraegerwechsel(w.id);
      return;
    }
    setBusyId(w.id);
    try {
      await aktualisiereTeilgebiet(tg.id, { standardAustraegerId: w.neuerMitarbeiterId });
      await loescheAustraegerwechsel(w.id);
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
            Vorbereitete Austrägerwechsel ({offen.length})
          </h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Bitte einzeln bestätigen: der Mitarbeiter wird als neuer Standardausträger
            des Teilgebiets eingetragen, der Eintrag verschwindet anschließend aus der
            Vorbereitungsliste.
          </p>
        </div>
        <div className="overflow-y-auto flex-1">
          {offen.length === 0 ? (
            <div className="px-5 py-10 text-center text-sm text-gray-500">
              Keine offenen Wechsel mehr.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200 text-gray-600 text-xs">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Teilgebiet</th>
                  <th className="px-3 py-2 text-left font-medium">Bisheriger</th>
                  <th className="px-3 py-2 text-left font-medium">Neuer</th>
                  <th className="px-3 py-2 text-right font-medium">Aktion</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {offen.map((w) => {
                  const tg = tgMap.get(w.teilgebietId);
                  const bisheriger = tg?.standardAustraegerId ? maMap.get(tg.standardAustraegerId) : undefined;
                  const neuer = maMap.get(w.neuerMitarbeiterId);
                  return (
                    <tr key={w.id} className="hover:bg-gray-50">
                      <td className="px-3 py-2 font-medium text-gray-900">
                        {tg?.name ?? '— gelöscht —'}
                      </td>
                      <td className="px-3 py-2 text-gray-700">
                        {bisheriger?.name ?? <span className="text-gray-400 italic">—</span>}
                      </td>
                      <td className="px-3 py-2 text-gray-900">
                        {neuer?.name ?? <span className="text-red-600 italic">—</span>}
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
                            if (!confirm('Diesen vorbereiteten Wechsel verwerfen?')) return;
                            await loescheAustraegerwechsel(w.id);
                          }}
                          className="text-xs text-red-500 hover:text-red-700"
                          title="Wechsel verwerfen"
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
  onClose,
}: {
  anpassungen: import('../types').StueckzahlAnpassung[];
  teilgebiete: import('../types').Teilgebiet[];
  onClose: () => void;
}) {
  const tgMap = new Map(teilgebiete.map((t) => [t.id, t]));
  const [busyId, setBusyId] = useState<string | null>(null);

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
      // Manueller Override-Flag mitschreiben, damit die automatische
      // Berechnung aus der Straßenliste den neuen Wert nicht wieder
      // überschreibt.
      await aktualisiereTeilgebiet(tg.id, {
        stueckzahl: w.neueStueckzahl,
        stueckzahlManuell: true,
      });
      await loescheStueckzahlAnpassung(w.id);
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
          🔒 Periode ist abgeschlossen — Boni, Vorschüsse und Lohnkonto-Buchungen
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
      {/* Minuten-Boni je Ausgabe */}
      {er.ausgabenBoni.length > 0 && (
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
      {er.austraegerEinsaetze.length > 0 && (
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
      {er.zusammentragenEinsaetze.length > 0 && (
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
          if (typenImBlock.has('vorarbeit')) {
            gruende.push(
              'Vorarbeit: in keiner Ausgabe dieser Periode freigegeben (Kennzeichen „Vorarbeit freigegeben" in Ausgabenplanung setzen)'
            );
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
  onChange,
  istGesperrt,
}: {
  mitarbeiterId: string;
  periodeId: string;
  vorschuesse: Vorschuss[];
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

function AnAbmeldungenListe({
  periode,
  istGesperrt,
  ergebnisse,
}: {
  periode: Abrechnungsperiode;
  istGesperrt: boolean;
  ergebnisse: MitarbeiterAbrechnung[];
}) {
  const { mitarbeiter, teilgebiete, austraegerwechsel } = useApp();

  // IDs der MA, die in der aktuellen Berechnung mit Beträgen vorkommen
  const idsMitBetrag = new Set<string>();
  for (const e of ergebnisse) {
    if (e.gesamt > 0 || e.bruttoLohnbuero > 0) idsMitBetrag.add(e.mitarbeiter.id);
  }

  // Periodenende: letzter Tag des Monats (ISO-Date YYYY-MM-DD).
  const periodenEndeIso = (() => {
    const last = new Date(periode.jahr, periode.monat, 0); // monat ist 1..12, day=0 → letzter Tag des Vormonats = letzter Tag von periode.monat
    const yyyy = last.getFullYear();
    const mm = (last.getMonth() + 1).toString().padStart(2, '0');
    const dd = last.getDate().toString().padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  })();
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
  const abmeldungen = mitarbeiter
    .filter(
      (m) =>
        !m.abgemeldet &&
        (ersetzteIds.has(m.id) || m.letzteAbrechnungsperiodeId === periode.id)
    )
    .sort((a, b) => a.name.localeCompare(b.name));

  // Wechsel-Verlierer: bisherige Standardausträger der TGs auf der
  // Austrägerwechsel-Liste, die durch den Wechsel komplett ohne aktives
  // Standardausträger-TG dastehen — sie sollen explizit als Abmelde-
  // Kandidaten erscheinen, auch wenn sie in der Periode noch Beträge haben.
  const wechselTgIds = new Set(austraegerwechsel.map((w) => w.teilgebietId));
  const wechselNeuPerTg = new Map(austraegerwechsel.map((w) => [w.teilgebietId, w.neuerMitarbeiterId]));
  const wechselVerlierer = new Set<string>();
  for (const w of austraegerwechsel) {
    const tg = teilgebiete.find((t) => t.id === w.teilgebietId);
    if (!tg || !tg.isActive) continue;
    const bisheriger = tg.standardAustraegerId;
    if (!bisheriger || bisheriger === w.neuerMitarbeiterId) continue;
    // Bleibt dem bisherigen MA nach Anwendung ALLER Wechsel noch ein TG?
    const hatNochTg = teilgebiete.some((t) => {
      if (!t.isActive) return false;
      if (t.id === tg.id) return false;
      if (wechselTgIds.has(t.id)) {
        // Auch dieses TG ist im Wechsel — bleibt nur, wenn der Neuvorschlag
        // weiterhin der bisherige MA ist (Edge-Fall, selten).
        return wechselNeuPerTg.get(t.id) === bisheriger;
      }
      return t.standardAustraegerId === bisheriger;
    });
    if (!hatNochTg) wechselVerlierer.add(bisheriger);
  }

  // Vorschläge: aktive MA ohne Betrag in dieser Abrechnung — Kandidaten für
  // Abmeldung. Plus: MAs, die durch einen vorbereiteten Austrägerwechsel ihr
  // letztes Teilgebiet verlieren (auch wenn sie in dieser Periode noch
  // Beträge haben). Ausschluss in beiden Pfaden: Festgehalt, Geschäftsführer,
  // bereits abgemeldet, noch nicht angemeldet, schon in Abmeldungs-Liste.
  const abmeldungVorschlaege = mitarbeiter
    .filter((m) => {
      const grund =
        m.isActive
        && !m.abgemeldet
        && !m.nochNichtAngemeldet
        && !m.hatFestgehalt
        && !m.istGeschaeftsfuehrer
        && !ersetzteIds.has(m.id)
        && m.letzteAbrechnungsperiodeId !== periode.id;
      if (!grund) return false;
      const istWechselVerlierer = wechselVerlierer.has(m.id);
      const istLiveVorschlag = !idsMitBetrag.has(m.id);
      return istWechselVerlierer || istLiveVorschlag;
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
    await aktualisiereMitarbeiter(m.id, { abmeldungUebermittlungDatum: datum || undefined });
  }

  async function handleAuswahlAb(m: Mitarbeiter) {
    await aktualisiereMitarbeiter(m.id, { letzteAbrechnungsperiodeId: periode.id });
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
      await aktualisiereMitarbeiter(ersetzendeMa.id, { ersetztMitarbeiterId: undefined });
    }
    await aktualisiereMitarbeiter(m.id, { letzteAbrechnungsperiodeId: undefined });
  }

  // Kandidaten für die manuelle Auswahl
  const kandidatenAb = mitarbeiter
    .filter(
      (m) =>
        !m.abgemeldet &&
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
    await aktualisiereMitarbeiter(eintrag.mitarbeiterId, {
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
                Vorschläge enthalten MAs ohne Betrag in der Periode UND MAs, die
                durch einen vorbereiteten Austrägerwechsel ihr letztes Teilgebiet
                verlieren. Klick auf „+", um sie zur Abmelde-Liste hinzuzufügen.
              </p>
              <ul className="space-y-1 max-h-48 overflow-y-auto">
                {abmeldungVorschlaege.map((m) => {
                  const istVerlierer = wechselVerlierer.has(m.id);
                  return (
                    <li key={m.id} className="flex items-center justify-between bg-white rounded border border-red-100 px-2 py-1">
                      <span>
                        <span className="font-medium text-gray-900">{m.name}</span>
                        <span className="ml-1 text-gray-400 text-[10px]">({m.nummer})</span>
                        {istVerlierer && (
                          <span
                            className="ml-2 text-[10px] bg-amber-100 text-amber-800 border border-amber-200 px-1.5 py-0.5 rounded"
                            title="Verliert durch vorbereiteten Austrägerwechsel sein letztes Teilgebiet"
                          >
                            🔄 verliert TG durch Wechsel
                          </span>
                        )}
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
