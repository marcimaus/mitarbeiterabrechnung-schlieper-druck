import { useState, useEffect, useCallback, useMemo } from 'react';
import { useApp } from '../context/AppContext';
import AdminPinGate from '../components/AdminPinGate';
import Modal from '../components/Modal';
import LieferscheinDruck from '../components/LieferscheinDruck';
import ZettelchenDruck from '../components/ZettelchenDruck';
import KontrolleGewichteDruck from '../components/KontrolleGewichteDruck';
import UebersichtDruck from '../components/UebersichtDruck';
import AuslieferungsmemoVerwaltung from '../components/AuslieferungsmemoVerwaltung';
import { ladeAusgaben, ladeEinsaetze, setzeEinsatz, loescheEinsatz, ladeBeilagen } from '../lib/db';
import { getCurrentKW } from '../lib/kalender';
import type { Ausgabe, Einsatz, Teilgebiet, Abrechnungsperiode, Beilage } from '../types';
import { kwLabel, MONATSNAMEN } from '../lib/kalender';
import { berechneGewichtAnzeigenblattKg, berechneGewichtBeilagenKg, berechneAustraegezeit, berechneZusammentragZeit, formatierStunden } from '../lib/berechnung';

// Hilfsfunktion: Ausgaben der letzten 2 Jahre laden (aus AppContext)
// Teilgebiete + Mitarbeiter kommen aus AppContext

interface EinsatzMap {
  [teilgebietId: string]: Einsatz;
}

/**
 * Effektiver Einsatz-Status eines Teilgebiets:
 *  - 'standard': hat Standardausträger UND kein expliziter Springer/Ausfall
 *  - 'springer': expliziter Einsatz vom Typ 'springer'
 *  - 'unbesetzt': weder Standardausträger noch Springer (auch bei 'ausfall'/'ungeklärt')
 */
function berechneStatus(
  tg: { standardAustraegerId: string | null },
  e: Einsatz | undefined
): 'standard' | 'springer' | 'unbesetzt' {
  if (e?.typ === 'springer') return 'springer';
  // ausfall / ungeklärt → unbesetzt
  if (e?.typ === 'ausfall' || e?.typ === 'ungeklärt') return 'unbesetzt';
  // ohne expliziten Einsatz: hängt am Standardausträger
  return tg.standardAustraegerId ? 'standard' : 'unbesetzt';
}

export default function EinsaetzeScreen() {
  return (
    <AdminPinGate allowedRoles={['admin', 'abrechnung']}>
      <EinsaetzeInhalt />
    </AdminPinGate>
  );
}

function EinsaetzeInhalt() {
  const { teilgebiete, mitarbeiter, touren, parameter, abrechnungsperioden } = useApp();
  const [ausgaben, setAusgaben] = useState<Ausgabe[]>([]);
  const [selectedAusgabeId, setSelectedAusgabeId] = useState<string>('');
  // Eingrenzung der Ausgaben-Auswahl nach Abrechnungsperiode (Jahr/Monat).
  const [filterAusgabeJahr, setFilterAusgabeJahr] = useState<number | ''>('');
  const [filterAusgabeMonat, setFilterAusgabeMonat] = useState<number | ''>('');
  const [einsaetze, setEinsaetze] = useState<EinsatzMap>({});
  const [beilagen, setBeilagen] = useState<Beilage[]>([]);
  const [loading, setLoading] = useState(false);
  const [springerDialog, setSpringerDialog] = useState<Teilgebiet | null>(null);
  const [springerMitarbeiterId, setSpringerMitarbeiterId] = useState('');
  const [springerZuschlag, setSpringerZuschlag] = useState('');
  const [springerIndividuell, setSpringerIndividuell] = useState(false);
  const [springerFilter, setSpringerFilter] = useState('');
  const [lieferscheinPeriode, setLieferscheinPeriode] = useState<{ periode: Abrechnungsperiode; kw: number } | null>(null);
  const [zettelchenOffen, setZettelchenOffen] = useState(false);
  const [kontrolleOffen, setKontrolleOffen] = useState(false);
  const [uebersichtOffen, setUebersichtOffen] = useState(false);
  const [memosOffen, setMemosOffen] = useState(false);
  const [beilagenDialogTg, setBeilagenDialogTg] = useState<Teilgebiet | null>(null);

  // ---- Such- und Filter-Zustand ----
  const [suche, setSuche] = useState('');
  const [filterTourId, setFilterTourId] = useState<string>('');
  const [filterStatus, setFilterStatus] = useState<'' | 'standard' | 'springer' | 'unbesetzt'>('');
  const [filterMitarbeiterId, setFilterMitarbeiterId] = useState('');

  // Ausgaben laden
  useEffect(() => {
    ladeAusgaben().then((list) => {
      const sorted = [...list].sort((a, b) =>
        b.jahr !== a.jahr ? b.jahr - a.jahr : b.kw - a.kw
      );
      setAusgaben(sorted);
      if (sorted.length > 0 && !selectedAusgabeId) {
        // Bevorzugt die Ausgabe der aktuellen Kalenderwoche; wenn es
        // dazu keine angelegte Ausgabe gibt, fällt es auf die jüngste
        // vorhandene Ausgabe zurück.
        const heute = getCurrentKW();
        const aktuell = sorted.find((a) => a.jahr === heute.jahr && a.kw === heute.kw);
        setSelectedAusgabeId((aktuell ?? sorted[0]).id);
      }
    });
  }, []);

  // Einsätze + Beilagen laden wenn Ausgabe wechselt
  useEffect(() => {
    if (!selectedAusgabeId) return;
    setLoading(true);
    Promise.all([
      ladeEinsaetze(selectedAusgabeId),
      ladeBeilagen(selectedAusgabeId),
    ]).then(([einsatzListe, beilagenListe]) => {
      const map: EinsatzMap = {};
      for (const e of einsatzListe) map[e.teilgebietId] = e;
      setEinsaetze(map);
      setBeilagen(beilagenListe);
      setLoading(false);
    });
  }, [selectedAusgabeId]);

  // Monat (Abrechnungsperiode) je Ausgabe — über die KW-Zuordnung der Periode.
  const monatFuerAusgabe = useCallback(
    (a: Ausgabe): number | null => {
      const p = abrechnungsperioden.find(
        (per) => per.jahr === a.jahr && per.kalenderwochen?.includes(a.kw)
      );
      return p ? p.monat : null;
    },
    [abrechnungsperioden]
  );

  // Jahre, die in den Ausgaben vorkommen (absteigend).
  const ausgabenJahre = useMemo(
    () => Array.from(new Set(ausgaben.map((a) => a.jahr))).sort((x, y) => y - x),
    [ausgaben]
  );

  // Nach Jahr/Monat gefilterte Ausgaben-Liste für das Dropdown.
  const gefilterteAusgaben = useMemo(
    () =>
      ausgaben.filter((a) => {
        if (filterAusgabeJahr !== '' && a.jahr !== filterAusgabeJahr) return false;
        if (filterAusgabeMonat !== '' && monatFuerAusgabe(a) !== filterAusgabeMonat) return false;
        return true;
      }),
    [ausgaben, filterAusgabeJahr, filterAusgabeMonat, monatFuerAusgabe]
  );

  // Wenn die aktuell gewählte Ausgabe durch den Filter rausfällt, auf die
  // erste gefilterte Ausgabe umschalten.
  useEffect(() => {
    if (gefilterteAusgaben.length === 0) return;
    if (!gefilterteAusgaben.some((a) => a.id === selectedAusgabeId)) {
      setSelectedAusgabeId(gefilterteAusgaben[0].id);
    }
  }, [gefilterteAusgaben, selectedAusgabeId]);

  const selectedAusgabe = ausgaben.find((a) => a.id === selectedAusgabeId);

  // Auslagestellen sind keine austräger-relevanten Gebiete und werden in
  // der Einsätze-Liste ausgeblendet — sie brauchen weder Standard- noch
  // Springer-Einsatz.
  const aktiveTeilgebiete = teilgebiete
    .filter((tg) => tg.isActive && !tg.istAuslagestelle)
    // Natural Sort: Uslar1 < Uslar2 < … < Uslar10 (statt lexikographisch)
    .sort((a, b) => a.name.localeCompare(b.name, 'de', { numeric: true }));

  const getMitarbeiter = useCallback(
    (id: string | null) => (id ? mitarbeiter.find((m) => m.id === id) : undefined),
    [mitarbeiter]
  );

  const getTour = useCallback(
    (tourId: string | null) => (tourId ? touren.find((t) => t.id === tourId) : undefined),
    [touren]
  );

  async function handleSetzeUngeklaert(tg: Teilgebiet) {
    if (!selectedAusgabe) return;
    await setzeEinsatz({
      ausgabeId: selectedAusgabe.id,
      kw: selectedAusgabe.kw,
      jahr: selectedAusgabe.jahr,
      teilgebietId: tg.id,
      mitarbeiterId: null,
      typ: 'ungeklärt',
    });
    const updated = await ladeEinsaetze(selectedAusgabe.id);
    const map: EinsatzMap = {};
    for (const e of updated) map[e.teilgebietId] = e;
    setEinsaetze(map);
  }

  async function handleResetStandard(tg: Teilgebiet) {
    const e = einsaetze[tg.id];
    if (!e) return;
    // Warnung, wenn Daten verloren gehen — Kommentar, externer Link,
    // gesetzter Springer/Ausfall etc.
    const verlust: string[] = [];
    if (e.kommentar?.trim()) verlust.push(`• Kommentar: „${e.kommentar.trim()}"`);
    if (e.externerLink?.trim()) verlust.push(`• Externer Link: ${e.externerLink.trim()}`);
    if (e.typ === 'springer' && e.mitarbeiterId) verlust.push('• Springer-Zuweisung');
    if (e.typ === 'ungeklärt') verlust.push('• Markierung „ungeklärt"');
    if (e.ausfallBisKw) verlust.push(`• Ausfall-Bereich bis KW ${e.ausfallBisKw}`);
    const warnText = verlust.length > 0
      ? `Der bestehende Eintrag für „${tg.name}" wird gelöscht. Folgendes geht dabei verloren:\n\n${verlust.join('\n')}\n\nFortfahren?`
      : `Eintrag für „${tg.name}" wirklich auf Standardausträger zurücksetzen?`;
    if (!confirm(warnText)) return;

    await loescheEinsatz(e.id);
    setEinsaetze((prev) => {
      const next = { ...prev };
      delete next[tg.id];
      return next;
    });
  }

  function oeffneSpringerDialog(tg: Teilgebiet) {
    const e = einsaetze[tg.id];
    setSpringerMitarbeiterId(e?.typ === 'springer' ? (e.mitarbeiterId ?? '') : '');
    // Default: 0 % (kein Zuschlag). Vorhandenen Wert übernehmen falls gesetzt.
    const vorhanden = e?.springerZuschlagProzent;
    setSpringerZuschlag(vorhanden != null ? vorhanden.toString() : '0');
    // „Individuell"-Modus nur öffnen, wenn bestehender Wert kein Listenwert ist
    const optionen = parameter?.springerZuschlagOptionen ?? [];
    const istListenwert = vorhanden != null && optionen.includes(vorhanden);
    setSpringerIndividuell(!istListenwert);
    setSpringerFilter('');
    setSpringerDialog(tg);
  }

  async function handleSpringerSpeichern() {
    if (!springerDialog || !selectedAusgabe || !springerMitarbeiterId) return;
    await setzeEinsatz({
      ausgabeId: selectedAusgabe.id,
      kw: selectedAusgabe.kw,
      jahr: selectedAusgabe.jahr,
      teilgebietId: springerDialog.id,
      mitarbeiterId: springerMitarbeiterId,
      typ: 'springer',
      springerZuschlagProzent: springerZuschlag ? parseFloat(springerZuschlag) : undefined,
    });
    const updated = await ladeEinsaetze(selectedAusgabe.id);
    const map: EinsatzMap = {};
    for (const e of updated) map[e.teilgebietId] = e;
    setEinsaetze(map);
    setSpringerDialog(null);
  }

  const zugehoerigerPeriode = selectedAusgabe
    ? abrechnungsperioden.find((p) => p.jahr === selectedAusgabe.jahr && p.kalenderwochen.includes(selectedAusgabe.kw))
    : undefined;
  const istGesperrt = zugehoerigerPeriode?.status === 'abgeschlossen';

  function handleLieferscheineDrucken() {
    if (!selectedAusgabe) return;
    // Abrechnungsperiode finden, die diese KW enthält
    const periode = abrechnungsperioden.find(
      (p) =>
        p.kalenderwochen.includes(selectedAusgabe.kw) &&
        p.jahr === selectedAusgabe.jahr
    );
    if (!periode) {
      alert(
        `Keine Abrechnungsperiode gefunden, die KW ${selectedAusgabe.kw}/${selectedAusgabe.jahr} enthält.\n\nBitte zuerst die Abrechnungsperiode anlegen und die KW zuordnen.`
      );
      return;
    }
    setLieferscheinPeriode({ periode, kw: selectedAusgabe.kw });
  }

  // ---- Filter auf Teilgebiete anwenden ----
  const gefilterte = aktiveTeilgebiete.filter((tg) => {
    // Namens-Suche (Teilgebiet-Name, PLZ ODER Name des effektiven Austrägers).
    // Effektiver Austräger = Springer wenn gesetzt, sonst Standardausträger.
    if (suche.trim()) {
      const s = suche.toLowerCase();
      const e = einsaetze[tg.id];
      const effId =
        e?.typ === 'springer'
          ? (e.mitarbeiterId ?? null)
          : tg.standardAustraegerId;
      const ma = effId ? mitarbeiter.find((m) => m.id === effId) : null;
      const austraegerName = ma ? `${ma.name} ${ma.nummer}`.toLowerCase() : '';
      if (
        !tg.name.toLowerCase().includes(s) &&
        !tg.plz.toLowerCase().includes(s) &&
        !austraegerName.includes(s)
      ) {
        return false;
      }
    }
    // Tour-Filter
    if (filterTourId) {
      if (filterTourId === '__keine__') {
        if (tg.tourId) return false;
      } else if (tg.tourId !== filterTourId) return false;
    }
    // Mitarbeiter-Filter: zeige TG, in dem der gewählte MA als Standardausträger
    // ODER (für diese Ausgabe) als Springer eingeplant ist. Entscheidend ist der
    // EFFEKTIVE Austräger in der gewählten Ausgabe:
    //   - Standard (kein Einsatz-Doc oder typ='standard') → Standardausträger des TG
    //   - Springer (typ='springer') → einsatz.mitarbeiterId
    //   - Ausfall / Ungeklärt → kein Austräger, wird rausgefiltert
    if (filterMitarbeiterId) {
      const e = einsaetze[tg.id];
      let effektivId: string | null = null;
      if (!e || e.typ === 'standard') {
        effektivId = tg.standardAustraegerId;
      } else if (e.typ === 'springer') {
        effektivId = e.mitarbeiterId ?? null;
      } else {
        effektivId = null; // ausfall / ungeklärt
      }
      if (effektivId !== filterMitarbeiterId) return false;
    }
    // Status-Filter
    if (filterStatus) {
      const status = berechneStatus(tg, einsaetze[tg.id]);
      if (status !== filterStatus) return false;
    }
    return true;
  });

  // Statistiken (über alle aktiven Teilgebiete, nicht über gefilterte)
  const stats = aktiveTeilgebiete.reduce(
    (acc, tg) => {
      const status = berechneStatus(tg, einsaetze[tg.id]);
      if (status === 'standard') acc.standard++;
      else if (status === 'springer') acc.springer++;
      else if (status === 'unbesetzt') acc.unbesetzt++;
      return acc;
    },
    { standard: 0, springer: 0, unbesetzt: 0 }
  );

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Einsätze</h1>

      {/* Ausgabe auswählen */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 mb-6">
        <div className="flex items-center gap-4 flex-wrap">
          <label className="text-sm font-medium text-gray-700">Jahr:</label>
          <select
            value={filterAusgabeJahr === '' ? '' : String(filterAusgabeJahr)}
            onChange={(e) => setFilterAusgabeJahr(e.target.value === '' ? '' : Number(e.target.value))}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">alle</option>
            {ausgabenJahre.map((j) => (
              <option key={j} value={j}>{j}</option>
            ))}
          </select>

          <label className="text-sm font-medium text-gray-700">Monat:</label>
          <select
            value={filterAusgabeMonat === '' ? '' : String(filterAusgabeMonat)}
            onChange={(e) => setFilterAusgabeMonat(e.target.value === '' ? '' : Number(e.target.value))}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">alle</option>
            {MONATSNAMEN.map((name, i) => (
              <option key={i} value={i + 1}>{name}</option>
            ))}
          </select>

          <label className="text-sm font-medium text-gray-700">Ausgabe:</label>
          <select
            value={selectedAusgabeId}
            onChange={(e) => setSelectedAusgabeId(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {gefilterteAusgaben.length === 0 && <option value="">— keine Ausgabe —</option>}
            {gefilterteAusgaben.map((a) => (
              <option key={a.id} value={a.id}>
                {kwLabel(a.kw, a.jahr)} — {a.seitenzahl} S.
              </option>
            ))}
          </select>

          {/* Statistik-Badges + Lieferscheine-Button */}
          {!loading && (() => {
            const seitenFehlen = !!selectedAusgabe && (!selectedAusgabe.seitenzahl || selectedAusgabe.seitenzahl <= 0);
            const stapelFehlen = !!selectedAusgabe && (!selectedAusgabe.stapelAnzahl || selectedAusgabe.stapelAnzahl <= 0);
            const lieferscheineGesperrt = seitenFehlen || stapelFehlen;
            const kontrolleGesperrt = seitenFehlen;
            return (
              <div className="flex gap-2 flex-wrap ml-auto items-center">
                <StatBadge label="Standard" count={stats.standard} farbe="bg-gray-100 text-gray-700" />
                <StatBadge label="Springer" count={stats.springer} farbe="bg-blue-100 text-blue-700" />
                <StatBadge label="Unbesetzt" count={stats.unbesetzt} farbe="bg-yellow-100 text-yellow-700" />
                <button
                  type="button"
                  onClick={handleLieferscheineDrucken}
                  disabled={!selectedAusgabe || lieferscheineGesperrt}
                  className="ml-2 text-xs font-medium px-3 py-1.5 rounded-lg border border-gray-300 bg-white text-gray-700 hover:border-blue-500 hover:text-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  title={
                    lieferscheineGesperrt
                      ? 'Seitenzahl und/oder Stapelzahl fehlen — Lieferscheine wären unvollständig. Bitte zuerst in „Ausgaben & Beilagen" ergänzen.'
                      : 'Lieferscheine für die Abrechnungsperiode dieser Ausgabe drucken'
                  }
                >
                  🖨️ Lieferscheine
                </button>
                <button
                  type="button"
                  onClick={() => setZettelchenOffen(true)}
                  disabled={!selectedAusgabe}
                  className="text-xs font-medium px-3 py-1.5 rounded-lg border border-gray-300 bg-white text-gray-700 hover:border-blue-500 hover:text-blue-700 disabled:opacity-40 transition-colors"
                  title="Arbeitsvorbereitungs-Zettelchen (Zusammentragen + Vorarbeit) für diese Ausgabe drucken"
                >
                  🗒️ Zettelchen
                </button>
                <button
                  type="button"
                  onClick={() => setKontrolleOffen(true)}
                  disabled={!selectedAusgabe || kontrolleGesperrt}
                  className="text-xs font-medium px-3 py-1.5 rounded-lg border border-gray-300 bg-white text-gray-700 hover:border-blue-500 hover:text-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  title={
                    kontrolleGesperrt
                      ? 'Seitenzahl fehlt — Gewichts-Kontrolle nicht möglich. Bitte zuerst in „Ausgaben & Beilagen" eintragen.'
                      : 'Kontrollliste Gewichte (Soll/Min/Max) zum Ausdrucken'
                  }
                >
                  ⚖️ Kontrolle Gewichte
                </button>
                <button
                  type="button"
                  onClick={() => setUebersichtOffen(true)}
                  disabled={!selectedAusgabe}
                  className="text-xs font-medium px-3 py-1.5 rounded-lg border border-gray-300 bg-white text-gray-700 hover:border-blue-500 hover:text-blue-700 disabled:opacity-40 transition-colors"
                  title="A4-Übersicht für den Werksleiter: Teilgebiete mit Beilagen, Austrägern und Gewichten — mit Checkboxen zum Abhaken"
                >
                  📋 Übersicht
                </button>
                <button
                  type="button"
                  onClick={() => setMemosOffen(true)}
                  disabled={!selectedAusgabe}
                  className="text-xs font-medium px-3 py-1.5 rounded-lg border border-gray-300 bg-white text-gray-700 hover:border-blue-500 hover:text-blue-700 disabled:opacity-40 transition-colors"
                  title="Auslieferungs-Memos für diese Ausgabe verwalten (werden auf den Lieferscheinen angezeigt)"
                >
                  📝 Memos
                </button>
              </div>
            );
          })()}
        </div>

        {/* Warn-Banner: fehlende Seitenzahl / Stapelzahl */}
        {selectedAusgabe && (() => {
          const seitenFehlen = !selectedAusgabe.seitenzahl || selectedAusgabe.seitenzahl <= 0;
          const stapelFehlen = !selectedAusgabe.stapelAnzahl || selectedAusgabe.stapelAnzahl <= 0;
          if (!seitenFehlen && !stapelFehlen) return null;
          const fehlend: string[] = [];
          if (seitenFehlen) fehlend.push('Seitenzahl');
          if (stapelFehlen) fehlend.push('Anzahl Stapel');
          return (
            <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm text-amber-900 flex items-start gap-2">
              <span className="text-amber-700">⚠</span>
              <div className="flex-1">
                <strong>Daten unvollständig:</strong> {fehlend.join(' und ')} {fehlend.length === 1 ? 'fehlt' : 'fehlen'} für diese Ausgabe.
                {seitenFehlen && stapelFehlen
                  ? ' Lieferscheine und Gewichts-Kontrolle sind deshalb deaktiviert.'
                  : seitenFehlen
                    ? ' Lieferscheine und Gewichts-Kontrolle sind deshalb deaktiviert.'
                    : ' Lieferscheine sind deshalb deaktiviert (Stapelzahl wird für die Lieferscheine benötigt).'}
                {' '}Bitte unter „Ausgaben &amp; Beilagen" ergänzen.
              </div>
            </div>
          );
        })()}
      </div>

      {/* Filter-Leiste */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 mb-6">
        <div className="flex items-center gap-3 flex-wrap">
          <input
            type="text"
            placeholder="Teilgebiet, PLZ, Austräger-Name oder MA-Nummer..."
            value={suche}
            onChange={(e) => setSuche(e.target.value)}
            className="flex-1 min-w-[200px] border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <select
            value={filterTourId}
            onChange={(e) => setFilterTourId(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">— alle Touren —</option>
            <option value="__keine__">Ohne Tour</option>
            {touren.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value as '' | 'standard' | 'springer' | 'unbesetzt')}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">— alle Status —</option>
            <option value="standard">Standard (mit Standardausträger)</option>
            <option value="springer">Springer (Springer-Einsatz)</option>
            <option value="unbesetzt">Unbesetzt (ohne Austräger)</option>
          </select>
          <select
            value={filterMitarbeiterId}
            onChange={(e) => setFilterMitarbeiterId(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            title="Nur Teilgebiete anzeigen, auf denen der gewählte Mitarbeiter in dieser Ausgabe austrägt (Standard oder Springer)"
          >
            <option value="">— alle Austräger (dieser Ausgabe) —</option>
            {(() => {
              // Nur Austräger anbieten, denen in DIESER Ausgabe ein Gebiet
              // zugeordnet ist: Standard (über tg.standardAustraegerId, sofern
              // kein abweichender Einsatz vorliegt) ODER Springer-Einsatz.
              const ids = new Set<string>();
              for (const tg of aktiveTeilgebiete) {
                const e = einsaetze[tg.id];
                if (e?.typ === 'springer' && e.mitarbeiterId) {
                  ids.add(e.mitarbeiterId);
                } else if (!e || e.typ === 'standard') {
                  if (tg.standardAustraegerId) ids.add(tg.standardAustraegerId);
                }
                // ausfall / ungeklärt → kein Austräger
              }
              return mitarbeiter
                .filter((m) => ids.has(m.id))
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} ({m.nummer})
                  </option>
                ));
            })()}
          </select>
          {(suche || filterTourId || filterStatus || filterMitarbeiterId) && (
            <button
              type="button"
              onClick={() => { setSuche(''); setFilterTourId(''); setFilterStatus(''); setFilterMitarbeiterId(''); }}
              className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1"
            >
              ✕ Filter zurücksetzen
            </button>
          )}
          <span className="text-xs text-gray-400 ml-auto">
            {gefilterte.length} von {aktiveTeilgebiete.length}
          </span>
        </div>
      </div>

      {istGesperrt && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mb-4 text-sm text-amber-800 flex items-center gap-2">
          🔒 Diese Ausgabe gehört zu einer <strong>abgeschlossenen Abrechnungsperiode</strong> — keine Änderungen mehr möglich.
        </div>
      )}

      {/* Tabelle */}
      {loading ? (
        <div className="text-center py-12 text-gray-500">Lade Einsätze...</div>
      ) : !selectedAusgabe ? (
        <div className="text-center py-12 text-gray-400">Keine Ausgabe ausgewählt</div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Teilgebiet</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Tour</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Standardausträger</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Status</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Austräger</th>
                <th className="px-4 py-3 text-center font-medium text-gray-600" title="Anzahl Beilagen je Teilgebiet — intern (Druckerei) / extern (Austräger)">Beilagen<br /><span className="text-[10px] font-normal text-gray-400">int / ext</span></th>
                <th className="px-4 py-3 text-right font-medium text-gray-600" title="Gesamtgewicht (Anzeigenblatt + Beilagen) je Teilgebiet">Gewicht</th>
                <th className="px-4 py-3 text-right font-medium text-gray-600" title="Soll-Zeit Austragen (Laufzeit + Steckzeit + externe Beilagen)">Soll-Zeit<br /><span className="text-[10px] font-normal text-gray-400">Austragen</span></th>
                <th className="px-4 py-3 text-right font-medium text-gray-600" title="Soll-Zeit Zusammentragen je Teilgebiet (abhängig von Stapelanzahl und internen Beilagen)">Soll-Zeit<br /><span className="text-[10px] font-normal text-gray-400">Zusammentr.</span></th>
                <th className="px-4 py-3 text-right font-medium text-gray-600">Aktion</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {gefilterte.map((tg) => {
                const einsatz = einsaetze[tg.id];
                const standardMA = getMitarbeiter(tg.standardAustraegerId);
                const tour = getTour(tg.tourId);
                const springerMA = einsatz?.typ === 'springer'
                  ? getMitarbeiter(einsatz.mitarbeiterId)
                  : undefined;
                const gewichtKg = selectedAusgabe
                  ? berechneGewichtAnzeigenblattKg(tg, selectedAusgabe) +
                    berechneGewichtBeilagenKg(tg, beilagen)
                  : 0;
                const beilagenTg = beilagen.filter((b) => b.teilgebietIds.includes(tg.id));
                const beilagenIntern = beilagenTg.filter((b) => b.kennzeichen === 'int').length;
                const beilagenExtern = beilagenTg.filter((b) => b.kennzeichen === 'ext').length;

                return (
                  <tr key={tg.id} className="hover:bg-gray-50 transition-colors">
                    {/* Teilgebiet */}
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900">{tg.name}</div>
                      <div className="text-xs text-gray-400">
                        {tg.plz} · {tg.stueckzahl} Stk · {tg.wegstreckeM >= 1000
                          ? `${(tg.wegstreckeM / 1000).toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km`
                          : `${tg.wegstreckeM} m`}
                      </div>
                    </td>

                    {/* Tour */}
                    <td className="px-4 py-3">
                      {tour ? (
                        <span
                          className="text-xs font-medium px-2 py-0.5 rounded-full text-white"
                          style={{ backgroundColor: tour.farbe }}
                        >
                          {tour.name}
                        </span>
                      ) : (
                        <span className="text-gray-300 text-xs">—</span>
                      )}
                    </td>

                    {/* Standardausträger */}
                    <td className="px-4 py-3 text-gray-700">
                      {standardMA ? standardMA.name : <span className="text-gray-300">—</span>}
                    </td>

                    {/* Status-Badge */}
                    <td className="px-4 py-3">
                      <EinsatzBadge einsatz={einsatz} teilgebiet={tg} />
                    </td>

                    {/* Aktueller Austräger */}
                    <td className="px-4 py-3 text-gray-700">
                      {!einsatz || einsatz.typ === 'standard' ? (
                        <span className="text-gray-400 text-xs">Standard</span>
                      ) : einsatz.typ === 'springer' ? (
                        <span className="font-medium text-blue-700">
                          {springerMA?.name ?? '?'}
                          {einsatz.springerZuschlagProzent != null && (
                            <span className="text-xs text-blue-400 ml-1">+{einsatz.springerZuschlagProzent}%</span>
                          )}
                        </span>
                      ) : (
                        <span className="text-gray-400 text-xs">—</span>
                      )}
                      {/* Kommentar + externer Link unter dem Austräger, kompakt. */}
                      {einsatz && (einsatz.kommentar?.trim() || einsatz.externerLink?.trim()) && (
                        <div className="flex flex-col gap-0.5 mt-0.5">
                          {einsatz.kommentar?.trim() && (
                            <div
                              className="text-[11px] text-gray-600 max-w-[12rem] truncate"
                              title={einsatz.kommentar}
                            >
                              💬 {einsatz.kommentar}
                            </div>
                          )}
                          {einsatz.externerLink?.trim() && (
                            <a
                              href={einsatz.externerLink.trim()}
                              target="_blank"
                              rel="noreferrer"
                              className="text-[11px] text-blue-600 hover:underline w-fit"
                              title="Link in neuem Tab öffnen"
                            >
                              🔗 Link öffnen
                            </a>
                          )}
                        </div>
                      )}
                    </td>

                    {/* Beilagen int/ext — klickbar: zeigt Details der gebuchten Beilagen */}
                    <td className="px-4 py-3 text-center text-xs">
                      {beilagenTg.length === 0 ? (
                        <span className="text-gray-300">—</span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setBeilagenDialogTg(tg)}
                          className="inline-flex items-center gap-1 hover:ring-2 hover:ring-blue-300 rounded px-1 -mx-1"
                          title="Klicken um die gebuchten Beilagen anzuzeigen"
                        >
                          <span
                            className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-700 font-medium"
                          >
                            {beilagenIntern}
                          </span>
                          <span className="text-gray-300">/</span>
                          <span
                            className={`px-1.5 py-0.5 rounded font-medium ${
                              beilagenExtern > 0
                                ? 'bg-orange-100 text-orange-700'
                                : 'bg-gray-100 text-gray-500'
                            }`}
                          >
                            {beilagenExtern}
                          </span>
                        </button>
                      )}
                    </td>

                    {/* Gewicht */}
                    <td className="px-4 py-3 text-right text-gray-700 font-mono text-xs">
                      {gewichtKg > 0
                        ? `${gewichtKg.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} kg`
                        : <span className="text-gray-300">—</span>}
                    </td>

                    {/* Soll-Zeit Austragen */}
                    <td className="px-4 py-3 text-right text-gray-700 font-mono text-xs">
                      {(() => {
                        if (!parameter) return <span className="text-gray-300">—</span>;
                        const sollH = berechneAustraegezeit(tg, parameter, beilagenExtern);
                        return sollH > 0
                          ? formatierStunden(sollH)
                          : <span className="text-gray-300">—</span>;
                      })()}
                    </td>

                    {/* Soll-Zeit Zusammentragen */}
                    <td className="px-4 py-3 text-right text-gray-700 font-mono text-xs">
                      {(() => {
                        if (!parameter || !selectedAusgabe) return <span className="text-gray-300">—</span>;
                        const sollZ = berechneZusammentragZeit(
                          tg.stueckzahl,
                          selectedAusgabe.stapelAnzahl,
                          beilagenIntern,
                          parameter,
                        );
                        return sollZ > 0
                          ? formatierStunden(sollZ)
                          : <span className="text-gray-300">—</span>;
                      })()}
                    </td>

                    {/* Aktionen */}
                    <td className="px-4 py-3 text-right">
                      {istGesperrt ? (
                        <span className="text-xs text-gray-400">gesperrt</span>
                      ) : (
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => oeffneSpringerDialog(tg)}
                            className="text-xs px-2 py-1 rounded bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors"
                            title="Springer einsetzen"
                          >
                            Springer
                          </button>
                          <button
                            onClick={() => handleSetzeUngeklaert(tg)}
                            className="text-xs px-2 py-1 rounded bg-yellow-50 text-yellow-700 hover:bg-yellow-100 transition-colors"
                            title="Als ungeklärt markieren"
                          >
                            ?
                          </button>
                          {einsatz && (
                            <button
                              onClick={() => handleResetStandard(tg)}
                              className="text-xs px-2 py-1 rounded bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors"
                              title="Auf Standardausträger zurücksetzen"
                            >
                              ↩
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
              {/* Summenzeile über die GEFILTERTEN Teilgebiete */}
              {gefilterte.length > 0 && (() => {
                const summeGewicht = gefilterte.reduce((s, tg) => {
                  if (!selectedAusgabe) return s;
                  return (
                    s +
                    berechneGewichtAnzeigenblattKg(tg, selectedAusgabe) +
                    berechneGewichtBeilagenKg(tg, beilagen)
                  );
                }, 0);
                const summeSollH = gefilterte.reduce((s, tg) => {
                  if (!parameter) return s;
                  const beilagenExternTg = beilagen.filter(
                    (b) => b.kennzeichen === 'ext' && b.teilgebietIds.includes(tg.id)
                  ).length;
                  return s + berechneAustraegezeit(tg, parameter, beilagenExternTg);
                }, 0);
                const summeSollZ = gefilterte.reduce((s, tg) => {
                  if (!parameter || !selectedAusgabe) return s;
                  const beilagenInternTg = beilagen.filter(
                    (b) => b.kennzeichen === 'int' && b.teilgebietIds.includes(tg.id)
                  ).length;
                  return (
                    s +
                    berechneZusammentragZeit(
                      tg.stueckzahl,
                      selectedAusgabe.stapelAnzahl,
                      beilagenInternTg,
                      parameter,
                    )
                  );
                }, 0);
                return (
                  <tr className="bg-blue-50 border-t-2 border-blue-200 font-semibold">
                    <td className="px-4 py-3 text-gray-900" colSpan={6}>
                      Σ {gefilterte.length} Teilgebiet{gefilterte.length === 1 ? '' : 'e'}
                      {gefilterte.length !== aktiveTeilgebiete.length && (
                        <span className="ml-2 font-normal text-xs text-gray-500">
                          (gefiltert von {aktiveTeilgebiete.length})
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-900 font-mono text-xs">
                      {summeGewicht > 0
                        ? `${summeGewicht.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} kg`
                        : '—'}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-900 font-mono text-xs">
                      {summeSollH > 0 ? formatierStunden(summeSollH) : '—'}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-900 font-mono text-xs">
                      {summeSollZ > 0 ? formatierStunden(summeSollZ) : '—'}
                    </td>
                    <td></td>
                  </tr>
                );
              })()}
            </tbody>
          </table>
        </div>
      )}

      {/* Springer-Dialog */}
      <Modal
        isOpen={springerDialog !== null}
        onClose={() => setSpringerDialog(null)}
        title={`Springer für ${springerDialog?.name ?? ''}`}
        size="md"
      >
        {springerDialog && (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Mitarbeiter suchen
              </label>
              <input
                type="text"
                placeholder="Name oder Nummer..."
                value={springerFilter}
                onChange={(e) => setSpringerFilter(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                autoFocus
              />
            </div>

            <div className="max-h-48 overflow-y-auto border border-gray-200 rounded-lg divide-y divide-gray-100">
              {mitarbeiter
                .filter((m) => {
                  if (m.abgemeldet) return false;
                  if (!m.isActive || !m.rollen.includes('austräger')) return false;
                  // Strikte Gebietsfreigabe: nur Mitarbeiter, die für dieses Teilgebiet freigegeben sind.
                  if (!springerDialog) return false;
                  const f = m.teilgebietFreigaben ?? [];
                  if (!f.includes(springerDialog.id)) return false;
                  return true;
                })
                .filter((m) =>
                  m.name.toLowerCase().includes(springerFilter.toLowerCase()) ||
                  m.nummer.includes(springerFilter)
                )
                .map((m) => (
                  <button
                    key={m.id}
                    onClick={() => setSpringerMitarbeiterId(m.id)}
                    className={`w-full flex items-center justify-between px-3 py-2 text-sm transition-colors ${
                      springerMitarbeiterId === m.id
                        ? 'bg-blue-50 text-blue-700'
                        : 'hover:bg-gray-50 text-gray-800'
                    }`}
                  >
                    <span className="font-medium">{m.name}</span>
                    <span className="text-gray-400">{m.nummer}</span>
                  </button>
                ))}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Springer-Zuschlag %
              </label>
              {/* Auswahl: Standard + konfigurierte Optionen */}
              <div className="flex flex-wrap gap-2 mb-2">
                <button
                  type="button"
                  onClick={() => { setSpringerZuschlag(''); setSpringerIndividuell(false); }}
                  className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${
                    springerZuschlag === '' && !springerIndividuell
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-white text-gray-700 border-gray-300 hover:border-blue-400'
                  }`}
                  title="Standard-Wert aus Systemparametern"
                >
                  Standard ({parameter?.springerZuschlagProzent ?? 25} %)
                </button>
                {[...(parameter?.springerZuschlagOptionen ?? [])]
                  .sort((a, b) => a - b)
                  .map((opt) => (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => { setSpringerZuschlag(opt.toString()); setSpringerIndividuell(false); }}
                      className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${
                        !springerIndividuell && springerZuschlag === opt.toString()
                          ? 'bg-blue-600 text-white border-blue-600'
                          : 'bg-white text-gray-700 border-gray-300 hover:border-blue-400'
                      }`}
                    >
                      {opt} %
                    </button>
                  ))}
                <button
                  type="button"
                  onClick={() => setSpringerIndividuell(true)}
                  className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${
                    springerIndividuell
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-white text-gray-500 border-dashed border-gray-300 hover:border-blue-400'
                  }`}
                >
                  Individuell…
                </button>
              </div>
              {springerIndividuell && (
                <div className="flex items-center gap-2 mt-2">
                  <input
                    type="number"
                    min="0"
                    max="200"
                    placeholder="z. B. 35"
                    value={springerZuschlag}
                    onChange={(e) => setSpringerZuschlag(e.target.value)}
                    className="w-36 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    autoFocus
                  />
                  <span className="text-sm text-gray-400">%</span>
                </div>
              )}
              <p className="text-xs text-gray-400 mt-1">
                „Standard" übernimmt den in den Parametern hinterlegten Wert ({parameter?.springerZuschlagProzent ?? 25} %).
              </p>
            </div>

            <div className="flex gap-2 pt-2">
              <button
                onClick={handleSpringerSpeichern}
                disabled={!springerMitarbeiterId}
                className="flex-1 bg-blue-600 text-white py-2 rounded-lg font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Springer speichern
              </button>
              <button
                onClick={() => setSpringerDialog(null)}
                className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors text-sm"
              >
                Abbrechen
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Lieferschein-Druck-Modal */}
      {lieferscheinPeriode && (
        <LieferscheinDruck
          periode={lieferscheinPeriode.periode}
          ausgaben={ausgaben}
          selectedKw={lieferscheinPeriode.kw}
          mitarbeiter={mitarbeiter}
          teilgebiete={teilgebiete}
          onClose={() => setLieferscheinPeriode(null)}
        />
      )}

      {/* Zettelchen-Druck-Modal */}
      {zettelchenOffen && selectedAusgabe && (
        <ZettelchenDruck
          ausgabe={selectedAusgabe}
          teilgebiete={teilgebiete}
          beilagen={beilagen}
          touren={touren}
          onClose={() => setZettelchenOffen(false)}
        />
      )}

      {/* Auslieferungs-Memos-Modal */}
      {selectedAusgabe && (
        <AuslieferungsmemoVerwaltung
          isOpen={memosOffen}
          onClose={() => setMemosOffen(false)}
          ausgabe={selectedAusgabe}
          teilgebiete={teilgebiete}
          touren={touren}
        />
      )}

      {/* Kontrolle-Gewichte-Druck-Modal */}
      {kontrolleOffen && selectedAusgabe && parameter && (
        <KontrolleGewichteDruck
          ausgabe={selectedAusgabe}
          teilgebiete={teilgebiete}
          beilagen={beilagen}
          touren={touren}
          parameter={parameter}
          onClose={() => setKontrolleOffen(false)}
        />
      )}

      {/* Übersicht-Druck-Modal (A4, mit Checkboxen) */}
      {uebersichtOffen && selectedAusgabe && parameter && (
        <UebersichtDruck
          ausgabe={selectedAusgabe}
          teilgebiete={teilgebiete}
          beilagen={beilagen}
          einsaetze={Object.values(einsaetze)}
          mitarbeiter={mitarbeiter}
          touren={touren}
          parameter={parameter}
          onClose={() => setUebersichtOffen(false)}
        />
      )}

      {/* Beilagen-Detail-Modal je Teilgebiet */}
      {beilagenDialogTg && selectedAusgabe && (
        <BeilagenDetailModal
          isOpen={!!beilagenDialogTg}
          onClose={() => setBeilagenDialogTg(null)}
          teilgebiet={beilagenDialogTg}
          ausgabe={selectedAusgabe}
          beilagen={beilagen.filter((b) => b.teilgebietIds.includes(beilagenDialogTg.id))}
        />
      )}
    </div>
  );
}

// ---- Beilagen-Detail-Modal ----------------------------------
// Wird in der Einsätze-Tabelle per Klick auf das Beilagen-Badge geöffnet.
// Zeigt für ein einzelnes Teilgebiet die in der gewählten Ausgabe gebuchten
// Beilagen (Arbeitstitel, Kunde, Format, Gewicht, Kennzeichen, Stückzahl).
function BeilagenDetailModal({
  isOpen,
  onClose,
  teilgebiet,
  ausgabe,
  beilagen,
}: {
  isOpen: boolean;
  onClose: () => void;
  teilgebiet: Teilgebiet;
  ausgabe: Ausgabe;
  beilagen: Beilage[];
}) {
  const intern = beilagen.filter((b) => b.kennzeichen === 'int');
  const extern = beilagen.filter((b) => b.kennzeichen === 'ext');
  const stk = teilgebiet.stueckzahl;

  function gewichtKg(b: Beilage): number {
    return (b.gewichtGStk * stk) / 1000;
  }

  function renderTabelle(title: string, list: Beilage[], farbe: 'gray' | 'orange') {
    if (list.length === 0) return null;
    const headerCls = farbe === 'orange' ? 'bg-orange-50 text-orange-800' : 'bg-gray-50 text-gray-700';
    return (
      <div>
        <h4 className={`text-sm font-semibold mb-1 px-2 py-1 rounded ${headerCls}`}>
          {title} ({list.length})
        </h4>
        <div className="overflow-hidden rounded border border-gray-200">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600 border-b border-gray-200">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Arbeitstitel</th>
                <th className="px-3 py-2 text-left font-medium">Kunde</th>
                <th className="px-3 py-2 text-left font-medium">Format</th>
                <th className="px-3 py-2 text-right font-medium">g/Stk</th>
                <th className="px-3 py-2 text-right font-medium">Stückzahl</th>
                <th className="px-3 py-2 text-right font-medium">Gewicht ges.</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {list.map((b) => (
                <tr key={b.id}>
                  <td className="px-3 py-2 font-medium text-gray-900">{b.arbeitstitel}</td>
                  <td className="px-3 py-2 text-gray-700">{b.kundenname}</td>
                  <td className="px-3 py-2 text-gray-600">{b.format}</td>
                  <td className="px-3 py-2 text-right text-gray-700 font-mono text-xs">
                    {b.gewichtGStk.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
                  </td>
                  <td className="px-3 py-2 text-right text-gray-700 font-mono text-xs">
                    {stk.toLocaleString('de-DE')}
                  </td>
                  <td className="px-3 py-2 text-right text-gray-800 font-mono text-xs">
                    {gewichtKg(b).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kg
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Beilagen — ${teilgebiet.name} (KW ${ausgabe.kw}/${ausgabe.jahr})`}
      size="xl"
    >
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-3 text-sm">
          <div className="rounded border border-gray-200 bg-gray-50 px-3 py-2">
            <div className="text-xs text-gray-500">Stückzahl Teilgebiet</div>
            <div className="font-bold text-gray-900">{stk.toLocaleString('de-DE')}</div>
          </div>
          <div className="rounded border border-gray-200 bg-gray-50 px-3 py-2">
            <div className="text-xs text-gray-500">Beilagen intern</div>
            <div className="font-bold text-gray-700">{intern.length}</div>
          </div>
          <div className="rounded border border-orange-200 bg-orange-50 px-3 py-2">
            <div className="text-xs text-orange-700">Beilagen extern</div>
            <div className="font-bold text-orange-800">{extern.length}</div>
          </div>
        </div>

        {beilagen.length === 0 ? (
          <div className="text-center py-8 text-sm text-gray-400 italic">
            Keine Beilagen für dieses Teilgebiet gebucht.
          </div>
        ) : (
          <div className="space-y-4">
            {renderTabelle('🏭 Intern (in der Druckerei einzulegen)', intern, 'gray')}
            {renderTabelle('🚚 Extern (vom Austräger einzulegen)', extern, 'orange')}
          </div>
        )}
      </div>
    </Modal>
  );
}

function EinsatzBadge({
  einsatz,
  teilgebiet,
}: {
  einsatz: Einsatz | undefined;
  teilgebiet: { standardAustraegerId: string | null };
}) {
  const status = berechneStatus(teilgebiet, einsatz);
  if (status === 'springer') {
    return (
      <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 font-medium">
        Springer
      </span>
    );
  }
  if (status === 'unbesetzt') {
    return (
      <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-700 font-medium">
        Unbesetzt
      </span>
    );
  }
  return (
    <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
      Standard
    </span>
  );
}

function StatBadge({
  label,
  count,
  farbe,
}: {
  label: string;
  count: number;
  farbe: string;
}) {
  return (
    <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${farbe}`}>
      {label}: {count}
    </span>
  );
}
