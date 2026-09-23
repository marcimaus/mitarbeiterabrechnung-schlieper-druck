import { useState, useEffect, useRef, type FormEvent } from 'react';
import { useApp } from '../context/AppContext';
import AdminPinGate from '../components/AdminPinGate';
import Modal from '../components/Modal';
import LohnkontoVerlauf from '../components/LohnkontoVerlauf';
import {
  erstelleMitarbeiter,
  aktualisiereMitarbeiter,
  deaktiviereMitarbeiter,
  aktiviereMitarbeiter,
  ladeEinsaetzeFuerMitarbeiter,
  ladeArbeitszeiten,
  ladeFahrten,
  erstelleLohnkontoBuchung,
  aktualisiereLohnkontoBuchung,
  loescheLohnkontoBuchung,
  sondervereinbarungenListener,
  erstelleSondervereinbarung,
  aktualisiereSondervereinbarung,
  loescheSondervereinbarung,
  ladeVerdienstbescheinigungWerte,
  setzeVerdienstbescheinigungWert,
  erstelleVerdienstbescheinigungFrage,
  loescheVerdienstbescheinigungFrage,
} from '../lib/db';
import VerdienstbescheinigungDruck from '../components/VerdienstbescheinigungDruck';
import type { LohnbueroAbrechnung, LohnbueroDriveLink, VerdienstbescheinigungWert, VerdienstbescheinigungFrage, VerdienstbescheinigungAntwortTyp } from '../types';
import { hashPin, ermittlePinAusHash } from '../lib/auth';
import { beschreibeNfcTag, nfcVerfuegbar } from '../lib/zeiterfassung';
import type { Mitarbeiter, Rolle, Sondervereinbarung, Teilgebiet, InteresseTaetigkeit, TeilgebietLieferadresse } from '../types';
// Re-Export, damit die Tab-Komponente unten den selben Typen-Pfad nutzt.
import { ROLLEN_LABELS, INTERESSE_TAETIGKEIT_LABELS } from '../types';
import { berechneAlter } from '../lib/berechnung';
import { nameMitFestgehaltSymbol } from '../utils';
import { eur } from '../lib/abrechnungslogik';

type MaFormTab = 'stammdaten' | 'freigaben' | 'boni' | 'lieferadressen' | 'anmeldung' | 'lohnkonto' | 'verdienstbescheinigung';

const ALLE_ROLLEN = Object.keys(ROLLEN_LABELS) as Rolle[];

/**
 * Schlägt die nächste freie 5-stellige Mitarbeiternummer beginnend mit 9
 * vor (z. B. 90001, 90002, …). Sucht das Maximum unter den bisher
 * vergebenen Nummern; fallback auf 90001, wenn keine passt.
 *
 * Verboten ist eine bereits vergebene Nummer — die Submit-Prüfung blockt
 * das ebenfalls noch einmal redundant.
 */
function naechsteFreieNummer(mitarbeiter: Mitarbeiter[]): string {
  let max = 90000;
  for (const m of mitarbeiter) {
    if (!m.nummer) continue;
    if (!/^9\d{4}$/.test(m.nummer)) continue;
    const n = parseInt(m.nummer, 10);
    if (n > max) max = n;
  }
  return String(max + 1);
}

/**
 * Schlägt aus einem Namen ein 3-Buchstaben-Kürzel vor: Vorname[0] +
 * Nachname[0..1]. Bei Einzelwort: erste 3 Buchstaben. Liefert leeren
 * String, wenn nicht genug Buchstaben vorhanden sind.
 */
function kuerzelVorschlag(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '';
  const onlyLetters = (s: string) => s.replace(/[^A-Za-zÄÖÜäöüß]/g, '');
  if (parts.length === 1) {
    return onlyLetters(parts[0]).slice(0, 3).toUpperCase();
  }
  const v = onlyLetters(parts[0]).slice(0, 1);
  const n = onlyLetters(parts[parts.length - 1]).slice(0, 2);
  return (v + n).toUpperCase();
}

const DEFAULT_FORM: Omit<Mitarbeiter, 'id' | 'erstelltAm' | 'aktualisiertAm' | 'pinHash' | 'nfcUid'> = {
  nummer: '',
  name: '',
  adresse: { strasse: '', plz: '', ort: '' },
  telefon: '',
  geburtsdatum: '',
  rollen: [],
  hatFestgehalt: false,
  istMinijob: false,
  sozialversicherungsBefreit: false,
  // Bei Neuanlage default: noch nicht beim Lohnbüro angemeldet — der MA
  // erscheint dann automatisch in der Anmelde-Liste der Abrechnung.
  nochNichtAngemeldet: true,
  isActive: true,
  istInteressent: false,
  abweichendeLieferadresseAktiv: false,
  abweichendeLieferadresse: { strasse: '', plz: '', ort: '', telefon: '', memo: '' },
};

/** Leere Lieferadresse mit ausschließlich String-Feldern (Firestore-sicher). */
const LEERE_LIEFERADRESSE = { strasse: '', plz: '', ort: '', telefon: '', memo: '' };

const ALLE_INTERESSE_TAETIGKEITEN: InteresseTaetigkeit[] = [
  'aushilfeProduktion',
  'auslieferungsfahrer',
  'zusammentragen',
  'austragen',
  'buero',
];

export default function MitarbeiterScreen() {
  return (
    <AdminPinGate allowedRoles={['admin', 'abrechnung']}>
      <MitarbeiterInhalt />
    </AdminPinGate>
  );
}

function MitarbeiterInhalt() {
  const { mitarbeiter, lohnkontoBuchungen, userRole } = useApp();
  const isAdmin = userRole === 'admin';
  const [showForm, setShowForm] = useState(false);
  const [editTarget, setEditTarget] = useState<Mitarbeiter | null>(null);
  const [filterText, setFilterText] = useState('');
  const [filterRolle, setFilterRolle] = useState<Rolle | ''>('');
  // Tri-State-Filter: '' = egal, 'ja' = nur mit Kennzeichen, 'nein' = nur ohne
  const [filterMinijob, setFilterMinijob] = useState<'' | 'ja' | 'nein'>('');
  const [filterSvFrei, setFilterSvFrei] = useState<'' | 'ja' | 'nein'>('');
  const [filterAnmeldung, setFilterAnmeldung] = useState<'' | 'offen' | 'angemeldet' | 'abgemeldet'>('');
  const [filterFahrtkosten, setFilterFahrtkosten] = useState<'' | 'ja' | 'nein'>('');
  // Nur für Admin: MA mit / ohne offenem Lohnkonto-Saldo.
  const [filterLohnkontoSaldo, setFilterLohnkontoSaldo] = useState<'' | 'ja' | 'nein'>('');
  const [filterInteressent, setFilterInteressent] = useState<'' | 'nur' | 'ohne'>('ohne');
  const [filterInteresseTaetigkeit, setFilterInteresseTaetigkeit] = useState<InteresseTaetigkeit | ''>('');
  // Nur bei „nur Interessenten": Auto vorhanden ja/nein.
  const [filterAuto, setFilterAuto] = useState<'' | 'ja' | 'nein'>('');
  // Sortierung der Liste, sobald Interessenten angezeigt werden.
  // 'standard' = Reihenfolge wie geladen (nach Name).
  const [sortierung, setSortierung] = useState<'standard' | 'kontaktNeu' | 'kontaktAlt'>('kontaktNeu');
  const [filterOrtPlz, setFilterOrtPlz] = useState('');
  const [nurAktive, setNurAktive] = useState(true);
  const [verlaufFor, setVerlaufFor] = useState<Mitarbeiter | null>(null);

  // Maps: mitarbeiterId → Anzahl Buchungen / aktueller Saldo des Lohnkontos.
  // Saldo: Verschiebung (+), Verrechnung (−). Damit das Icon auch dann angezeigt
  // wird, wenn der Saldo negativ ist (selten, aber möglich), prüfen wir auf ≠ 0.
  const lohnkontoCountMap = new Map<string, number>();
  const lohnkontoSaldoMap = new Map<string, number>();
  for (const b of lohnkontoBuchungen) {
    lohnkontoCountMap.set(b.mitarbeiterId, (lohnkontoCountMap.get(b.mitarbeiterId) ?? 0) + 1);
    const delta = b.art === 'verschiebung' ? b.betragEur : -b.betragEur;
    lohnkontoSaldoMap.set(b.mitarbeiterId, (lohnkontoSaldoMap.get(b.mitarbeiterId) ?? 0) + delta);
  }

  // Aktuelles Alter — funktioniert für Geburtsdatum ODER für die Alters-
  // Angabe bei Interessenten (interessentAlterBeiErfassung + Kontaktdatum).
  function aktuellesAlter(m: Mitarbeiter): { jahre: number; quelle: 'geburtsdatum' | 'alterBeiErfassung' } | null {
    if (m.geburtsdatum) {
      try {
        const a = berechneAlter(m.geburtsdatum);
        if (Number.isFinite(a)) return { jahre: a, quelle: 'geburtsdatum' };
      } catch { /* ignore */ }
    }
    const alterErf = m.interessentAlterBeiErfassung;
    const datum = m.interessentKontaktDatum;
    if (alterErf != null && alterErf > 0 && datum) {
      const erf = new Date(datum);
      const heute = new Date();
      let zusatz = heute.getFullYear() - erf.getFullYear();
      const md = heute.getMonth() - erf.getMonth();
      if (md < 0 || (md === 0 && heute.getDate() < erf.getDate())) zusatz--;
      return { jahre: alterErf + zusatz, quelle: 'alterBeiErfassung' };
    }
    return null;
  }

  const gefiltert = mitarbeiter.filter((m) => {
    // Interessenten-Filter: 'ohne' (Standard) blendet Interessenten aus,
    // 'nur' zeigt ausschließlich Interessenten, '' zeigt alle.
    if (filterInteressent === 'ohne' && m.istInteressent) return false;
    if (filterInteressent === 'nur' && !m.istInteressent) return false;
    // Tätigkeits-Filter: nur sinnvoll bei Interessenten — wird auch nur dort
    // angewendet. Andere MAs (kein istInteressent) bleiben unberührt, außer
    // der Filter ist aktiv UND wir suchen explizit nach Tätigkeit.
    if (filterInteresseTaetigkeit) {
      if (!m.istInteressent) return false;
      const list = m.interesseTaetigkeiten ?? [];
      if (!list.includes(filterInteresseTaetigkeit)) return false;
    }
    // „Nur aktive" gilt sowohl für normale MAs (isActive) als auch für
    // Interessenten (interessentDeinteressiert).
    if (nurAktive) {
      if (m.istInteressent) {
        if (m.interessentDeinteressiert) return false;
      } else {
        if (!m.isActive) return false;
      }
    }
    if (filterText) {
      const q = filterText.toLowerCase();
      // Bei „nur Interessenten" zusätzlich in den Interessens-Orten und im
      // Wohnort suchen.
      const trifftOrt = filterInteressent === 'nur' &&
        [...(m.interessentOrte ?? []), m.adresse?.ort ?? '']
          .some((o) => o.toLowerCase().includes(q));
      if (!m.name.toLowerCase().includes(q) && !m.nummer.includes(filterText) && !trifftOrt) return false;
    }
    if (filterInteressent === 'nur') {
      if (filterAuto === 'ja' && !m.autoVorhanden) return false;
      if (filterAuto === 'nein' && m.autoVorhanden) return false;
    }
    if (filterOrtPlz.trim()) {
      const q = filterOrtPlz.trim().toLowerCase();
      const plz = (m.adresse?.plz ?? '').toLowerCase();
      const ort = (m.adresse?.ort ?? '').toLowerCase();
      if (!plz.includes(q) && !ort.includes(q)) return false;
    }
    // Bei „nur Interessenten" werden Rolle/Minijob/SV/Anmeldung/Fahrtkosten
    // ausgeblendet und auch nicht angewendet — sie sind für Interessenten
    // bedeutungslos und würden die Liste sonst leeren.
    if (filterInteressent !== 'nur') {
      if (filterRolle && !m.rollen.includes(filterRolle)) return false;
      if (filterMinijob === 'ja' && !m.istMinijob) return false;
      if (filterMinijob === 'nein' && m.istMinijob) return false;
      if (filterSvFrei === 'ja' && !m.sozialversicherungsBefreit) return false;
      if (filterSvFrei === 'nein' && m.sozialversicherungsBefreit) return false;
      if (filterAnmeldung === 'offen' && !m.nochNichtAngemeldet) return false;
      if (filterAnmeldung === 'angemeldet' && (m.nochNichtAngemeldet || m.abgemeldet)) return false;
      if (filterAnmeldung === 'abgemeldet' && !m.abgemeldet) return false;
      if (filterFahrtkosten === 'ja' && !m.fahrtkostenerstattung) return false;
      if (filterFahrtkosten === 'nein' && m.fahrtkostenerstattung) return false;
      if (isAdmin && filterLohnkontoSaldo) {
        // In Cent vergleichen, damit Float-Reste nicht als Saldo zählen.
        const hatSaldo = Math.round((lohnkontoSaldoMap.get(m.id) ?? 0) * 100) !== 0;
        if (filterLohnkontoSaldo === 'ja' && !hatSaldo) return false;
        if (filterLohnkontoSaldo === 'nein' && hatSaldo) return false;
      }
    }
    return true;
  });

  // Sortierung nach Datum der Kontaktaufnahme (nur wenn Interessenten
  // angezeigt werden). Fehlende Daten immer ans Ende.
  if (filterInteressent !== 'ohne' && sortierung !== 'standard') {
    const richtung = sortierung === 'kontaktNeu' ? -1 : 1;
    gefiltert.sort((a, b) => {
      const da = a.interessentKontaktDatum ?? '';
      const db = b.interessentKontaktDatum ?? '';
      if (!da && !db) return 0;
      if (!da) return 1;
      if (!db) return -1;
      return richtung * da.localeCompare(db);
    });
  }

  function oeffneNeu() {
    setEditTarget(null);
    setShowForm(true);
  }

  function oeffneBearbeiten(m: Mitarbeiter) {
    setEditTarget(m);
    setShowForm(true);
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Mitarbeiter</h1>
          <p className="text-gray-500 text-sm">
            {mitarbeiter.filter((m) => m.isActive && !m.istInteressent).length} aktive Mitarbeiter
            {mitarbeiter.filter((m) => m.istInteressent && !m.interessentDeinteressiert).length > 0 && (
              <span className="ml-2 text-amber-700">
                · {mitarbeiter.filter((m) => m.istInteressent && !m.interessentDeinteressiert).length} Interessenten
              </span>
            )}
          </p>
        </div>
        <button
          onClick={oeffneNeu}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
        >
          + Neuer Mitarbeiter
        </button>
      </div>

      {/* Filter */}
      <div className="flex flex-wrap gap-3 mb-4">
        <input
          type="text"
          placeholder={filterInteressent === 'nur' ? 'Name oder Interessens-Ort suchen...' : 'Name oder Nummer suchen...'}
          value={filterText}
          onChange={(e) => setFilterText(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-60"
          title={filterInteressent === 'nur' ? 'Sucht in Name, Nummer, Wohnort und den Orten/Teilgebieten, für die sich der Interessent interessiert' : undefined}
        />
        <input
          type="text"
          placeholder="Ort oder PLZ..."
          value={filterOrtPlz}
          onChange={(e) => setFilterOrtPlz(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-36"
          title="Filter auf Wohnort oder Postleitzahl des Mitarbeiters"
        />
        {filterInteressent !== 'nur' && (
          <>
            <select
              value={filterRolle}
              onChange={(e) => setFilterRolle(e.target.value as Rolle | '')}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Alle Rollen</option>
              {ALLE_ROLLEN.map((r) => (
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
              title="Filter Befreiung von Sozialversicherung"
            >
              <option value="">SV-Befreiung: alle</option>
              <option value="ja">nur SV-befreit</option>
              <option value="nein">nur nicht SV-befreit</option>
            </select>
            <select
              value={filterAnmeldung}
              onChange={(e) => setFilterAnmeldung(e.target.value as '' | 'offen' | 'angemeldet' | 'abgemeldet')}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              title="Filter Anmeldung"
            >
              <option value="">Anmeldung: alle</option>
              <option value="offen">⏳ noch nicht angemeldet</option>
              <option value="angemeldet">✓ angemeldet</option>
              <option value="abgemeldet">🚪 abgemeldet</option>
            </select>
            <select
              value={filterFahrtkosten}
              onChange={(e) => setFilterFahrtkosten(e.target.value as '' | 'ja' | 'nein')}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              title="Filter Fahrtkosten-Erstattung"
            >
              <option value="">Fahrtkosten: alle</option>
              <option value="ja">🚗 nur erlaubt</option>
              <option value="nein">nur nicht erlaubt</option>
            </select>
            {isAdmin && (
              <select
                value={filterLohnkontoSaldo}
                onChange={(e) => setFilterLohnkontoSaldo(e.target.value as '' | 'ja' | 'nein')}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                title="Filter Lohnkonto-Saldo (aktueller Stand) — zeigt, bei wem noch etwas zu verrechnen ist"
              >
                <option value="">Lohnkonto: alle</option>
                <option value="ja">nur mit Saldo im Lohnkonto</option>
                <option value="nein">nur ohne Saldo</option>
              </select>
            )}
          </>
        )}
        <select
          value={filterInteressent}
          onChange={(e) => {
            const v = e.target.value as '' | 'nur' | 'ohne';
            setFilterInteressent(v);
            // Tätigkeits-Filter zurücksetzen, wenn Interessenten ausgeblendet sind.
            if (v === 'ohne') setFilterInteresseTaetigkeit('');
            if (v !== 'nur') setFilterAuto('');
            // „nur Interessenten": neueste Kontakte oben; sonst nach Name.
            setSortierung(v === 'nur' ? 'kontaktNeu' : 'standard');
          }}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          title="Filter Interessenten"
        >
          <option value="ohne">ohne Interessenten</option>
          <option value="nur">💡 nur Interessenten</option>
          <option value="">alle (inkl. Interessenten)</option>
        </select>
        {filterInteressent !== 'ohne' && (
          <select
            value={filterInteresseTaetigkeit}
            onChange={(e) => setFilterInteresseTaetigkeit(e.target.value as InteresseTaetigkeit | '')}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            title="Interessenten nach Tätigkeit filtern, für die sie sich interessieren"
          >
            <option value="">Interesse: alle Tätigkeiten</option>
            {ALLE_INTERESSE_TAETIGKEITEN.map((t) => (
              <option key={t} value={t}>{INTERESSE_TAETIGKEIT_LABELS[t]}</option>
            ))}
          </select>
        )}
        {filterInteressent === 'nur' && (
          <select
            value={filterAuto}
            onChange={(e) => setFilterAuto(e.target.value as '' | 'ja' | 'nein')}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            title="Filter Auto vorhanden"
          >
            <option value="">Auto: alle</option>
            <option value="ja">🚗 Auto vorhanden</option>
            <option value="nein">kein Auto</option>
          </select>
        )}
        {filterInteressent !== 'ohne' && (
          <select
            value={sortierung}
            onChange={(e) => setSortierung(e.target.value as 'standard' | 'kontaktNeu' | 'kontaktAlt')}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            title="Sortierung der Liste"
          >
            <option value="standard">Sortierung: Name</option>
            <option value="kontaktNeu">Kontaktdatum: neueste zuerst</option>
            <option value="kontaktAlt">Kontaktdatum: älteste zuerst</option>
          </select>
        )}
        <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
          <input
            type="checkbox"
            checked={nurAktive}
            onChange={(e) => setNurAktive(e.target.checked)}
            className="rounded"
          />
          Nur aktive
          {nurAktive && mitarbeiter.filter((m) => !m.isActive).length > 0 && (
            <span className="text-xs text-gray-400">
              ({mitarbeiter.filter((m) => !m.isActive).length} inaktive ausgeblendet)
            </span>
          )}
        </label>
      </div>

      {/* ---- Mobile: Karten-Liste ---- */}
      <div className="md:hidden space-y-2">
        {gefiltert.length === 0 && (
          <div className="bg-white rounded-xl border border-gray-200 p-6 text-center text-gray-400 text-sm">
            Keine Mitarbeiter gefunden
          </div>
        )}
        {gefiltert.map((m) => {
          const alterInfo = aktuellesAlter(m);
          const alter = alterInfo ? alterInfo.jahre : null;
          const minderjährig = alter !== null && alter < 18;
          return (
            <button
              key={m.id}
              onClick={() => oeffneBearbeiten(m)}
              className="w-full text-left bg-white rounded-xl border border-gray-200 px-4 py-3 active:bg-blue-50 transition-colors"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-semibold text-gray-900 truncate">{nameMitFestgehaltSymbol(m)}</span>
                    {m.nochNichtAngemeldet && (
                      <span title="Noch nicht beim Lohnbüro angemeldet" className="text-amber-600 shrink-0">⏳</span>
                    )}
                    {m.nochNichtAngemeldet && m.lohnbueroBestaetigungLink && (
                      <a
                        href={m.lohnbueroBestaetigungLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        title="FastDok-Bestätigungsmail öffnen"
                        className="text-amber-700 hover:text-amber-900 shrink-0"
                      >
                        ✉
                      </a>
                    )}
                    {m.abgemeldet && (
                      <span title="Abgemeldet" className="text-red-500 shrink-0">🚪</span>
                    )}
                    {minderjährig && <span className="text-orange-500 text-xs shrink-0">⚠ {alter} J.</span>}
                    {m.googleDriveLink && (
                      <a
                        href={m.googleDriveLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        title="Unterlagen im Google Drive öffnen"
                        className="text-blue-600 hover:text-blue-800 shrink-0 text-base leading-none"
                      >
                        🔗
                      </a>
                    )}
                  </div>
                  <div className="text-xs text-gray-400 font-mono mb-2">{m.nummer}</div>
                  {filterInteressent === 'nur' && (
                    <div className="text-xs text-gray-600 mb-2 flex items-center gap-2 flex-wrap">
                      {m.interessentKontaktDatum && (
                        <span>
                          📅 {new Date(m.interessentKontaktDatum).toLocaleDateString('de-DE')}
                        </span>
                      )}
                      {alter !== null && (
                        <span className={minderjährig ? 'text-orange-600 font-medium' : ''}>
                          · {alter} J.
                          {alterInfo?.quelle === 'alterBeiErfassung' && (
                            <span
                              className="ml-0.5 text-gray-400"
                              title={'Berechnet aus „Alter bei Erfassung" + verstrichene Zeit'}
                            >🧮</span>
                          )}
                        </span>
                      )}
                      {m.interessentKorrespondenzLink && (
                        <a
                          href={m.interessentKorrespondenzLink}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="text-blue-600 hover:text-blue-800"
                          title="Korrespondenz öffnen"
                        >
                          ✉ Korrespondenz
                        </a>
                      )}
                    </div>
                  )}
                  <div className="flex flex-wrap gap-1">
                    {m.istInteressent && m.autoVorhanden && (
                      <span className="text-xs bg-green-100 text-green-800 px-2 py-0.5 rounded-full" title="Auto vorhanden">🚗 Auto</span>
                    )}
                    {m.istInteressent && (m.interessentOrte ?? []).map((o) => (
                      <span key={`ort-${o}`} className="text-xs bg-gray-100 text-gray-700 px-2 py-0.5 rounded-full" title="Interesse für Ort / Teilgebiet">📍 {o}</span>
                    ))}
                    {m.istInteressent
                      ? (m.interesseTaetigkeiten ?? []).map((t) => (
                          <span key={t} className="text-xs bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full">
                            {INTERESSE_TAETIGKEIT_LABELS[t]}
                          </span>
                        ))
                      : m.rollen.map((r) => (
                          <span key={r} className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">
                            {ROLLEN_LABELS[r]}
                          </span>
                        ))}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  {m.istInteressent ? (
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      m.interessentDeinteressiert
                        ? 'bg-gray-100 text-gray-500'
                        : 'bg-amber-100 text-amber-800'
                    }`}>
                      {m.interessentDeinteressiert ? '💡 desinteressiert' : '💡 Interessent'}
                    </span>
                  ) : (
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      m.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                    }`}>
                      {m.isActive ? 'Aktiv' : 'Inaktiv'}
                    </span>
                  )}
                  <span className="text-blue-600 text-xs font-medium">Bearbeiten ›</span>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* ---- Desktop: Tabelle ---- */}
      <div className="hidden md:block bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Nr.</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Name</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Rollen</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Alter</th>
              {filterInteressent === 'nur' && (
                <th className="text-left px-4 py-3 font-medium text-gray-600">
                  <button
                    type="button"
                    onClick={() => setSortierung((s) => (s === 'kontaktNeu' ? 'kontaktAlt' : 'kontaktNeu'))}
                    className="inline-flex items-center gap-1 hover:text-gray-900"
                    title="Nach Kontaktdatum sortieren"
                  >
                    Kontakt
                    <span className="text-xs">
                      {sortierung === 'kontaktNeu' ? '▼' : sortierung === 'kontaktAlt' ? '▲' : '↕'}
                    </span>
                  </button>
                </th>
              )}
              <th className="text-left px-4 py-3 font-medium text-gray-600">Abrechnung</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Status</th>
              {isAdmin && (
                <th className="text-left px-4 py-3 font-medium text-gray-600">Lohnkonto</th>
              )}
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {gefiltert.length === 0 && (
              <tr>
                <td colSpan={(isAdmin ? 8 : 7) + (filterInteressent === 'nur' ? 1 : 0)} className="text-center py-8 text-gray-400">
                  Keine Mitarbeiter gefunden
                </td>
              </tr>
            )}
            {gefiltert.map((m) => {
              const alterInfo = aktuellesAlter(m);
              const alter = alterInfo ? alterInfo.jahre : null;
              const minderjährig = alter !== null && alter < 18;
              return (
                <tr key={m.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => oeffneBearbeiten(m)}>
                  <td className="px-4 py-3 font-mono text-gray-500">{m.nummer}</td>
                  <td className="px-4 py-3 font-medium text-gray-900">
                    <span className="inline-flex items-center gap-1.5">
                      <span>{nameMitFestgehaltSymbol(m)}</span>
                      {m.nochNichtAngemeldet && (
                        <span
                          title="Noch nicht beim Lohnbüro angemeldet"
                          className="text-amber-600 text-sm leading-none"
                        >
                          ⏳
                        </span>
                      )}
                      {m.nochNichtAngemeldet && m.lohnbueroBestaetigungLink && (
                        <a
                          href={m.lohnbueroBestaetigungLink}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          title="FastDok-Bestätigungsmail öffnen"
                          className="text-amber-700 hover:text-amber-900 text-sm leading-none"
                        >
                          ✉
                        </a>
                      )}
                      {m.abgemeldet && (
                        <span
                          title="Abgemeldet"
                          className="text-red-500 text-sm leading-none"
                        >
                          🚪
                        </span>
                      )}
                      {m.googleDriveLink && (
                        <a
                          href={m.googleDriveLink}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          title="Unterlagen im Google Drive öffnen"
                          className="text-blue-600 hover:text-blue-800 text-base leading-none"
                        >
                          🔗
                        </a>
                      )}
                      {isAdmin && (lohnkontoSaldoMap.get(m.id) ?? 0) !== 0 && (
                        <span
                          title={`Lohnkonto-Saldo: ${eur(lohnkontoSaldoMap.get(m.id) ?? 0)}`}
                          className={`text-xs ${
                            (lohnkontoSaldoMap.get(m.id) ?? 0) > 0
                              ? 'text-amber-700'
                              : 'text-red-700'
                          }`}
                        >
                          💰
                        </span>
                      )}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {m.istInteressent && m.autoVorhanden && (
                        <span className="text-xs bg-green-100 text-green-800 px-2 py-0.5 rounded-full" title="Auto vorhanden">🚗 Auto</span>
                      )}
                      {m.istInteressent && (m.interessentOrte ?? []).map((o) => (
                        <span key={`ort-${o}`} className="text-xs bg-gray-100 text-gray-700 px-2 py-0.5 rounded-full" title="Interesse für Ort / Teilgebiet">📍 {o}</span>
                      ))}
                      {m.istInteressent
                        ? (m.interesseTaetigkeiten ?? []).map((t) => (
                            <span key={t} className="text-xs bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full">
                              {INTERESSE_TAETIGKEIT_LABELS[t]}
                            </span>
                          ))
                        : m.rollen.map((r) => (
                            <span key={r} className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">
                              {ROLLEN_LABELS[r]}
                            </span>
                          ))}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    {alter !== null ? (
                      <span
                        className={minderjährig ? 'text-orange-600 font-medium' : ''}
                        title={
                          alterInfo?.quelle === 'alterBeiErfassung'
                            ? 'Berechnet aus „Alter bei Erfassung" + verstrichene Zeit'
                            : undefined
                        }
                      >
                        {alter} J.{minderjährig ? ' ⚠' : ''}
                        {alterInfo?.quelle === 'alterBeiErfassung' && (
                          <span className="ml-0.5 text-[10px] text-gray-400">🧮</span>
                        )}
                      </span>
                    ) : '—'}
                  </td>
                  {filterInteressent === 'nur' && (
                    <td className="px-4 py-3 text-gray-600 text-xs" onClick={(e) => {
                      // Click auf den Link soll nicht das Bearbeiten-Modal öffnen.
                      if ((e.target as HTMLElement).closest('a')) e.stopPropagation();
                    }}>
                      {m.interessentKontaktDatum ? (
                        <span>
                          {new Date(m.interessentKontaktDatum).toLocaleDateString('de-DE')}
                        </span>
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                      {m.interessentKorrespondenzLink && (
                        <a
                          href={m.interessentKorrespondenzLink}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          title="Korrespondenz öffnen"
                          className="ml-1.5 text-blue-600 hover:text-blue-800"
                        >
                          ✉
                        </a>
                      )}
                    </td>
                  )}
                  <td className="px-4 py-3 text-gray-600">
                    <span className="text-xs bg-gray-100 px-2 py-0.5 rounded">
                      {m.hatFestgehalt ? 'Festgehalt' : 'Variabel'}
                    </span>
                    {m.stundenlohnIndividuell !== undefined && (
                      <span className="ml-1 text-xs text-gray-400">
                        ({m.stundenlohnIndividuell.toFixed(2)} €/h)
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {m.istInteressent ? (
                      <span className={`text-xs px-2 py-0.5 rounded-full ${
                        m.interessentDeinteressiert
                          ? 'bg-gray-100 text-gray-500'
                          : 'bg-amber-100 text-amber-800'
                      }`}>
                        {m.interessentDeinteressiert ? '💡 deinteressiert' : '💡 Interessent'}
                      </span>
                    ) : (
                      <span className={`text-xs px-2 py-0.5 rounded-full ${
                        m.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                      }`}>
                        {m.isActive ? 'Aktiv' : 'Inaktiv'}
                      </span>
                    )}
                  </td>
                  {isAdmin && (
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      {(lohnkontoCountMap.get(m.id) ?? 0) > 0 ? (
                        <button
                          type="button"
                          onClick={() => setVerlaufFor(m)}
                          className="text-xs bg-amber-50 text-amber-800 border border-amber-200 hover:bg-amber-100 px-2 py-1 rounded inline-flex items-center gap-1"
                          title={`Lohnkonto-Verlauf anzeigen — Saldo: ${eur(lohnkontoSaldoMap.get(m.id) ?? 0)}`}
                        >
                          📜 Verlauf ({lohnkontoCountMap.get(m.id)})
                        </button>
                      ) : (
                        <span className="text-xs text-gray-300">—</span>
                      )}
                    </td>
                  )}
                  <td className="px-4 py-3 text-right">
                    <span className="text-blue-600 text-xs font-medium">Bearbeiten</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Modal */}
      <Modal
        isOpen={showForm}
        onClose={() => setShowForm(false)}
        title={editTarget ? `Mitarbeiter: ${editTarget.name}` : 'Neuer Mitarbeiter'}
        size="xl"
      >
        <MitarbeiterForm
          initial={editTarget}
          onSave={() => setShowForm(false)}
          onCancel={() => setShowForm(false)}
        />
      </Modal>

      {/* Lohnkonto-Verlauf Modal */}
      {verlaufFor && (
        <LohnkontoVerlauf
          isOpen={!!verlaufFor}
          onClose={() => setVerlaufFor(null)}
          mitarbeiter={verlaufFor}
        />
      )}
    </div>
  );
}

// ---- Formular ----------------------------------------------

function MitarbeiterForm({
  initial,
  onSave,
  onCancel,
}: {
  initial: Mitarbeiter | null;
  onSave: () => void;
  onCancel: () => void;
}) {
  const { parameter, teilgebiete, mitarbeiter, userRole, abrechnungsperioden, lohnkontoBuchungen, lohnbueroAbrechnungen, lohnbueroDriveLinks, adminName, verdienstbescheinigungFragen } = useApp();
  const isAdmin = userRole === 'admin';
  // Bei Mitarbeitern mit Status "noch nicht angemeldet" direkt den Anmelde-Tab öffnen,
  // damit die offene Erfassung sofort sichtbar ist.
  const [tab, setTab] = useState<MaFormTab>(
    initial?.nochNichtAngemeldet ? 'anmeldung' : 'stammdaten'
  );
  const [form, setForm] = useState<typeof DEFAULT_FORM>(() => {
    if (initial) {
      return {
        nummer: initial.nummer,
        name: initial.name,
        adresse: { ...initial.adresse },
        telefon: initial.telefon,
        mobilnummer: initial.mobilnummer,
        email: initial.email,
        nutztWhatsApp: initial.nutztWhatsApp ?? false,
        nutztTelegram: initial.nutztTelegram ?? false,
        elternName: initial.elternName,
        elternTelefon: initial.elternTelefon,
        elternMobil: initial.elternMobil,
        elternEmail: initial.elternEmail,
        elternNutztWhatsApp: initial.elternNutztWhatsApp ?? false,
        elternNutztTelegram: initial.elternNutztTelegram ?? false,
        nochNichtAngemeldet: initial.nochNichtAngemeldet ?? false,
        erlaubnisElternEingeholt: initial.erlaubnisElternEingeholt ?? false,
        lohnbueroBestaetigungLink: initial.lohnbueroBestaetigungLink,
        startAbrechnungsperiodeId: initial.startAbrechnungsperiodeId,
        startDatum: initial.startDatum,
        anmeldungStatus: initial.anmeldungStatus,
        anmeldungUnvollstaendigMemo: initial.anmeldungUnvollstaendigMemo,
        anmeldungUebermittlungDatum: initial.anmeldungUebermittlungDatum,
        anmeldungMemo: initial.anmeldungMemo,
        abgemeldet: initial.abgemeldet ?? false,
        abmeldungUebermittlungDatum: initial.abmeldungUebermittlungDatum,
        letzteAbrechnungsperiodeId: initial.letzteAbrechnungsperiodeId,
        geburtsdatum: initial.geburtsdatum,
        rollen: [...initial.rollen],
        hatFestgehalt: initial.hatFestgehalt ?? false,
        festgehaltEur: initial.festgehaltEur,
        wochenstundenFestgehalt: initial.wochenstundenFestgehalt,
        monatsstundenFestgehalt: initial.monatsstundenFestgehalt,
        istGeschaeftsfuehrer: initial.istGeschaeftsfuehrer ?? false,
        googleDriveLink: initial.googleDriveLink,
        fixesGehalt: initial.fixesGehalt,
        stundenlohnIndividuell: initial.stundenlohnIndividuell,
        abrechnungAlsErwachseneMiLoG: initial.abrechnungAlsErwachseneMiLoG ?? false,
        istMinijob: initial.istMinijob ?? false,
        sozialversicherungsNummer: initial.sozialversicherungsNummer,
        steuerId: initial.steuerId,
        lohngrenzeIndividuellEur: initial.lohngrenzeIndividuellEur,
        lohngrenzeIndividuellKommentar: initial.lohngrenzeIndividuellKommentar,
        lohngrenzeIndividuellLink: initial.lohngrenzeIndividuellLink,
        sozialversicherungsBefreit: initial.sozialversicherungsBefreit ?? false,
        ausgabenBonusMinuten: initial.ausgabenBonusMinuten,
        ausgabenBonusKommentar: initial.ausgabenBonusKommentar,
        isActive: initial.isActive,
        istInteressent: initial.istInteressent ?? false,
        interessentDeinteressiert: initial.interessentDeinteressiert ?? false,
        interesseTaetigkeiten: initial.interesseTaetigkeiten ? [...initial.interesseTaetigkeiten] : [],
        autoVorhanden: initial.autoVorhanden ?? false,
        interessentOrte: initial.interessentOrte ? [...initial.interessentOrte] : [],
        interessentKontaktDatum: initial.interessentKontaktDatum,
        interessentKorrespondenzLink: initial.interessentKorrespondenzLink,
        interessentMemo: initial.interessentMemo,
        interessentAlterBeiErfassung: initial.interessentAlterBeiErfassung,
        abweichendeLieferadresseAktiv: initial.abweichendeLieferadresseAktiv ?? false,
        abweichendeLieferadresse: {
          strasse: initial.abweichendeLieferadresse?.strasse ?? '',
          plz: initial.abweichendeLieferadresse?.plz ?? '',
          ort: initial.abweichendeLieferadresse?.ort ?? '',
          telefon: initial.abweichendeLieferadresse?.telefon ?? '',
          memo: initial.abweichendeLieferadresse?.memo ?? '',
        },
        // Cast: Felder, die nicht im DEFAULT_FORM-Typ sind, werden über (form as any) gelesen
        ...(initial.fahrtkostenerstattung ? { fahrtkostenerstattung: true } : {}),
        ...(initial.fahrkostenEurProKm !== undefined ? { fahrkostenEurProKm: initial.fahrkostenEurProKm } : {}),
        ...(initial.istAbholer ? { istAbholer: true } : {}),
        ...(initial.onlineErfassungAktiv ? { onlineErfassungAktiv: true } : {}),
        ...(initial.istDrucksaal ? { istDrucksaal: true } : {}),
        ...(initial.kuerzel ? { kuerzel: initial.kuerzel } : {}),
        ...(initial.vorlaeufigNichtAbmelden ? { vorlaeufigNichtAbmelden: true } : {}),
      } as typeof DEFAULT_FORM;
    }
    // Neu-Anlage: nächste freie Mitarbeiternummer vorschlagen (5-stellig,
    // beginnt mit 9, fortlaufend). Bestehende werden geparst, das Maximum
    // +1 verwendet. Fällt nichts heraus, starten wir bei 90001.
    return {
      ...DEFAULT_FORM,
      nummer: naechsteFreieNummer(mitarbeiter),
      adresse: { strasse: '', plz: '', ort: '' },
      rollen: [],
    };
  });
  // Freigaben und Boni als eigene States
  const [freigaben, setFreigaben] = useState<string[]>(initial?.teilgebietFreigaben ?? []);
  // Abweichende Lieferadressen je Teilgebiet — eigener Reiter, eigener State.
  const [lieferadressenTg, setLieferadressenTg] = useState<TeilgebietLieferadresse[]>(
    () =>
      (initial?.lieferadressenJeTeilgebiet ?? []).map((l) => ({
        teilgebietId: l.teilgebietId,
        strasse: l.strasse ?? '',
        plz: l.plz ?? '',
        ort: l.ort ?? '',
        telefon: l.telefon ?? '',
        memo: l.memo ?? '',
      })),
  );
  // Anzahl der Sondervereinbarungen — wird vom Reiter selbst aktualisiert,
  // damit der Tab-Badge ohne zusätzliche Daten am MA-Payload korrekt zählt.
  const [sondervereinbarungenCount, setSondervereinbarungenCount] = useState(0);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const aktiveTeilgebiete = teilgebiete.filter((tg) => tg.isActive);

  // Interessens-Orte: Eingabefeld + Vorschläge aus Teilgebietsnamen und
  // bereits bei anderen Interessenten erfassten Orten.
  const [neuerOrt, setNeuerOrt] = useState('');
  const ortVorschlaege = [...new Set([
    ...aktiveTeilgebiete.map((tg) => tg.name),
    ...mitarbeiter.flatMap((m) => m.interessentOrte ?? []),
  ])].sort((a, b) => a.localeCompare(b, 'de'));

  function ortHinzufuegen() {
    const o = neuerOrt.trim();
    if (!o) return;
    setForm((f) => {
      const cur = f.interessentOrte ?? [];
      if (cur.some((x) => x.toLowerCase() === o.toLowerCase())) return f;
      return { ...f, interessentOrte: [...cur, o] };
    });
    setNeuerOrt('');
  }

  function toggleRolle(rolle: Rolle) {
    setForm((f) => ({
      ...f,
      rollen: f.rollen.includes(rolle)
        ? f.rollen.filter((r) => r !== rolle)
        : [...f.rollen, rolle],
    }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) { setError('Name ist erforderlich.'); return; }

    // Interessenten: drastisch reduzierte Pflichtfelder.
    // Wir umgehen Nummer-, Rollen-, Geburtsdatum-, Eltern-, Festgehalt- und
    // Stundenstunden-Prüfungen komplett. Die Daten werden erst beim Wechsel
    // zu „echtem Mitarbeiter" verlangt.
    if (form.istInteressent) {
      setSaving(true);
      setError('');
      try {
        // Bei Interessent: Rollen leer halten, keine TG-Freigaben, kein Bonus.
        // Neue Interessenten bekommen keine Mitarbeiternummer — die wird erst
        // beim Wechsel zum „echten" MA vergeben. Bereits vergebene Nummern
        // bestehender Datensätze bleiben unangetastet.
        const orte = [...new Set((form.interessentOrte ?? []).map((o) => o.trim()).filter(Boolean))];
        const payload = {
          ...form,
          nummer: initial?.nummer ?? '',
          autoVorhanden: form.autoVorhanden ?? false,
          interessentOrte: orte.length > 0 ? orte : undefined,
          rollen: [] as Rolle[],
          teilgebietFreigaben: [],
          nochNichtAngemeldet: false,
          abgemeldet: false,
        };
        if (initial) {
          await aktualisiereMitarbeiter(initial.id, payload);
        } else {
          await erstelleMitarbeiter(payload);
        }
        onSave();
      } catch (err) {
        setError('Fehler beim Speichern. Bitte erneut versuchen.');
        console.error(err);
      } finally {
        setSaving(false);
      }
      return;
    }

    // War vorher Interessent, ist es jetzt nicht mehr → wie Neuerfassung
    // behandeln: nochNichtAngemeldet=true setzen.
    const warInteressent = initial?.istInteressent === true;
    const wurdeEntInteressent = warInteressent && !form.istInteressent;

    if (!form.nummer.trim()) { setError('Mitarbeiternummer ist erforderlich.'); return; }
    const nummerBelegt = mitarbeiter.some(
      (m) => m.nummer === form.nummer.trim() && m.id !== initial?.id
    );
    if (nummerBelegt) { setError(`Mitarbeiternummer ${form.nummer.trim()} ist bereits vergeben.`); return; }
    if (form.rollen.length === 0) { setError('Mindestens eine Rolle muss ausgewählt werden.'); return; }

    // Solange „noch nicht angemeldet": Pflichtprüfungen für Geburtsdatum und
    // Eltern-/Erziehungsberechtigten-Daten aussetzen — die Daten werden noch
    // per Fragebogen erfasst. Bei wurdeEntInteressent gilt dies automatisch.
    const ueberspringePflicht = form.nochNichtAngemeldet === true || wurdeEntInteressent;

    if (!form.geburtsdatum) {
      if (!ueberspringePflicht) {
        setError('Geburtsdatum ist erforderlich.');
        return;
      }
      // Bei "noch nicht angemeldet": Geburtsdatum darf leer bleiben.
    }

    // Plausibilität Geburtsdatum — nur wenn überhaupt eingetragen
    let alterJahre = Number.POSITIVE_INFINITY; // Default: volljährig (für Folge-Checks)
    if (form.geburtsdatum) {
      const geb = new Date(form.geburtsdatum);
      const heute = new Date();
      if (isNaN(geb.getTime())) { setError('Geburtsdatum ist ungültig.'); return; }
      if (geb.getTime() > heute.getTime()) { setError('Geburtsdatum darf nicht in der Zukunft liegen.'); return; }
      if (geb.getFullYear() < 1930) { setError('Geburtsdatum darf nicht vor 1930 liegen.'); return; }
      alterJahre = berechneAlter(form.geburtsdatum);
      if (alterJahre < 13) {
        // Gesetzliches Mindestalter für Schülerarbeit (JArbSchG §5): 13 Jahre.
        // Eingaben unter 13 sind nicht zulässig — kein Bypass möglich.
        setError(
          `Der Mitarbeiter ist laut Geburtsdatum erst ${alterJahre} Jahre alt. ` +
          `Das gesetzliche Mindestalter für Beschäftigung beträgt 13 Jahre. ` +
          `Bitte das Geburtsdatum prüfen.`
        );
        return;
      }
    }

    // Pflicht: Eltern-/Erziehungsberechtigten-Daten bei Minderjährigen
    // — entfällt bei „noch nicht angemeldet".
    if (!ueberspringePflicht && alterJahre < 18) {
      if (!form.elternName || !form.elternName.trim()) {
        setError('Bei Minderjährigen ist der Name eines Erziehungsberechtigten Pflicht.');
        return;
      }
      const hatKontakt =
        (form.elternTelefon && form.elternTelefon.trim()) ||
        (form.elternMobil && form.elternMobil.trim()) ||
        (form.elternEmail && form.elternEmail.trim());
      if (!hatKontakt) {
        setError('Bei Minderjährigen ist mindestens ein Kontakt der Erziehungsberechtigten Pflicht (Telefon, Mobil oder E-Mail).');
        return;
      }
    }

    // Plausibilität PLZ (optional, nur wenn eingetragen)
    if (form.adresse.plz && form.adresse.plz.trim() && !/^\d{5}$/.test(form.adresse.plz.trim())) {
      if (!confirm(`PLZ "${form.adresse.plz}" entspricht nicht dem 5-stelligen Format. Trotzdem speichern?`)) {
        return;
      }
    }

    // Plausibilität Festgehalt
    if (form.hatFestgehalt && (!form.festgehaltEur || form.festgehaltEur <= 0)) {
      setError('Wenn "Festgehalt" aktiviert ist, muss ein Festgehalt > 0 € eingetragen werden.');
      return;
    }
    if (
      form.hatFestgehalt &&
      !form.istGeschaeftsfuehrer &&
      (!form.monatsstundenFestgehalt || form.monatsstundenFestgehalt <= 0)
    ) {
      setError('Bei Festgehalt müssen die durchschnittlichen Stunden (Woche oder Monat) angegeben werden — außer bei Geschäftsführern.');
      return;
    }

    setSaving(true);
    setError('');
    try {
      // Abweichende Lieferadresse je TG: nur Einträge mit befüllter Adresse
      // (Straße oder Ort) persistieren; leere Hülsen verwerfen.
      const lieferadressenTgClean: TeilgebietLieferadresse[] = lieferadressenTg
        .filter((l) => l.strasse.trim() || l.ort.trim())
        .map((l) => ({
          teilgebietId: l.teilgebietId,
          strasse: l.strasse.trim(),
          plz: l.plz.trim(),
          ort: l.ort.trim(),
          telefon: (l.telefon ?? '').trim(),
          memo: (l.memo ?? '').trim(),
        }));

      // Hinweis: teilgebietBoni am MA wird NICHT mehr aktiv gepflegt — die
      // echte Quelle für TG-bezogene Zuschläge ist die Collection
      // `sondervereinbarungen` (eigener Reiter „Teilgebiet-Boni").
      const payload = {
        ...form,
        teilgebietFreigaben: freigaben,
        // Abweichende Lieferadresse nur speichern, wenn aktiviert — sonst Feld
        // löschen (undefined → deleteField in aktualisiereMitarbeiter).
        abweichendeLieferadresse: form.abweichendeLieferadresseAktiv
          ? {
              strasse: (form.abweichendeLieferadresse?.strasse ?? '').trim(),
              plz: (form.abweichendeLieferadresse?.plz ?? '').trim(),
              ort: (form.abweichendeLieferadresse?.ort ?? '').trim(),
              telefon: (form.abweichendeLieferadresse?.telefon ?? '').trim(),
              memo: (form.abweichendeLieferadresse?.memo ?? '').trim(),
            }
          : undefined,
        lieferadressenJeTeilgebiet:
          lieferadressenTgClean.length > 0 ? lieferadressenTgClean : undefined,
        // Wenn aus Interessent ein „echter" MA wird, automatisch als
        // „noch nicht angemeldet" markieren — analog zu Neuerfassung.
        ...(wurdeEntInteressent ? { nochNichtAngemeldet: true } : {}),
      };
      if (initial) {
        await aktualisiereMitarbeiter(initial.id, payload);
      } else {
        await erstelleMitarbeiter(payload);
      }
      onSave();
    } catch (err) {
      setError('Fehler beim Speichern. Bitte erneut versuchen.');
      console.error(err);
    } finally {
      setSaving(false);
    }
  }

  async function handleDeaktivieren() {
    if (!initial) return;

    // Umfangreiche Prüfung — verhindert versehentliches Deaktivieren wenn
    // der MA noch operative Verbindungen oder offene Beträge hat.
    const probleme: string[] = [];

    // 1) Steht der MA noch als Standardausträger eines aktiven Teilgebiets?
    const tgsAlsStandard = teilgebiete.filter(
      (tg) => tg.isActive && tg.standardAustraegerId === initial.id
    );
    if (tgsAlsStandard.length > 0) {
      probleme.push(
        `Standardausträger in ${tgsAlsStandard.length} Teilgebiet${tgsAlsStandard.length === 1 ? '' : 'en'}: ${tgsAlsStandard.map((t) => t.name).join(', ')}`
      );
    }

    // 2) Lohnkonto-Saldo — in Cent gerechnet gegen Float-Drift
    const saldoCent = lohnkontoBuchungen
      .filter((b) => b.mitarbeiterId === initial.id)
      .reduce(
        (s, b) => s + (b.art === 'verschiebung' ? Math.round(b.betragEur * 100) : -Math.round(b.betragEur * 100)),
        0
      );
    if (saldoCent !== 0) {
      probleme.push(`Lohnkonto-Saldo nicht ausgeglichen: ${eur(saldoCent / 100)}`);
    }

    // 3) Springer-Einsätze in offenen Folge-Perioden + 4) Arbeitszeiten + 5) Fahrtkosten
    let springerInOffenen = 0;
    let arbeitszeitenOffen = 0;
    let fahrtenOffen = 0;
    try {
      const [einsaetzeMa, arbeitszeiten, fahrten] = await Promise.all([
        ladeEinsaetzeFuerMitarbeiter(initial.id),
        ladeArbeitszeiten(initial.id),
        ladeFahrten({ mitarbeiterId: initial.id }),
      ]);
      // Offene Perioden (status='offen')
      const offenePeriodenKWs = new Set<string>();
      for (const p of abrechnungsperioden) {
        if (p.status === 'offen') {
          for (const kw of p.kalenderwochen) {
            offenePeriodenKWs.add(`${p.jahr}-${kw}`);
          }
        }
      }
      // Springer-Einsätze in offenen Perioden
      for (const e of einsaetzeMa) {
        if (e.typ === 'springer' && offenePeriodenKWs.has(`${e.jahr}-${e.kw}`)) {
          springerInOffenen++;
        }
      }
      // Arbeitszeiten ohne Periode-Zuordnung oder in offenen Perioden
      // (vereinfacht: jede vorhandene zählt — der Admin entscheidet)
      arbeitszeitenOffen = arbeitszeiten.filter(
        (a) => a.status === 'abgeschlossen'
      ).length;
      // Fahrten ohne Abrechnungsperiode-ID (= noch nicht fakturiert)
      fahrtenOffen = fahrten.filter((f) => !f.abrechnungsperiodeId).length;
    } catch {
      probleme.push('Prüfung der Einsätze/Zeiten/Fahrten fehlgeschlagen — bitte manuell prüfen');
    }

    if (springerInOffenen > 0) {
      probleme.push(`Als Springer in ${springerInOffenen} Einsatz${springerInOffenen === 1 ? '' : 'en'} offener Perioden eingeplant`);
    }
    if (arbeitszeitenOffen > 0) {
      probleme.push(`${arbeitszeitenOffen} abgeschlossene Arbeitszeit${arbeitszeitenOffen === 1 ? '' : 'en'} vorhanden (Kontrolle ob abgerechnet)`);
    }
    if (fahrtenOffen > 0) {
      probleme.push(`${fahrtenOffen} Fahrt${fahrtenOffen === 1 ? '' : 'en'} ohne Periodenzuordnung (noch nicht abgerechnet)`);
    }

    let bestaetigung = `Mitarbeiter "${initial.name}" wirklich deaktivieren?`;
    if (probleme.length > 0) {
      bestaetigung =
        `Mitarbeiter "${initial.name}" deaktivieren?\n\n` +
        `Folgende Punkte sollten vorher geprüft werden:\n\n` +
        probleme.map((p) => `• ${p}`).join('\n') +
        `\n\nTrotzdem deaktivieren?`;
    }
    if (!confirm(bestaetigung)) return;

    await deaktiviereMitarbeiter(initial.id);
    onSave();
  }

  async function handleAktivieren() {
    if (!initial) return;
    await aktiviereMitarbeiter(initial.id);
    onSave();
  }

  const alter = form.geburtsdatum ? berechneAlter(form.geburtsdatum) : null;
  const minderjährig = alter !== null && alter < 18;

  function toggleFreigabe(tgId: string) {
    setFreigaben((prev) =>
      prev.includes(tgId) ? prev.filter((id) => id !== tgId) : [...prev, tgId]
    );
  }

  const TABS: { id: MaFormTab; label: string; count?: number }[] = form.istInteressent
    ? [{ id: 'stammdaten', label: 'Interessent-Daten' }]
    : [
      { id: 'stammdaten', label: 'Stammdaten' },
      { id: 'freigaben', label: 'Gebiets-Freigaben', count: freigaben.length },
      { id: 'boni', label: 'Teilgebiet-Boni', count: sondervereinbarungenCount },
      { id: 'lieferadressen', label: 'Lieferadressen je TG', count: lieferadressenTg.filter((l) => l.strasse.trim() || l.ort.trim()).length },
      { id: 'anmeldung', label: 'Anmeldung / Abmeldung' },
      ...(isAdmin && initial ? [{ id: 'lohnkonto' as const, label: 'Lohnkonto' }] : []),
      ...(isAdmin && initial && form.istMinijob
        ? [{ id: 'verdienstbescheinigung' as const, label: 'Verdienstbescheinigung Minijob' }]
        : []),
    ];

  // Wenn Interessent-Modus aktiv ist und ein anderer Tab gewählt war,
  // automatisch auf Stammdaten zurückspringen.
  useEffect(() => {
    if (form.istInteressent && tab !== 'stammdaten') {
      setTab('stammdaten');
    }
  }, [form.istInteressent, tab]);

  // Wenn Minijob-Haken entfernt wird, während der Bescheinigungs-Tab offen ist,
  // zurück auf Stammdaten — der Tab ist dann ja gar nicht mehr in TABS.
  useEffect(() => {
    if (tab === 'verdienstbescheinigung' && !form.istMinijob) {
      setTab('stammdaten');
    }
  }, [form.istMinijob, tab]);

  return (
    <form onSubmit={handleSubmit} className="space-y-0">
      {/* Tabs */}
      <div className="flex border-b border-gray-200 mb-5 -mt-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              tab === t.id
                ? 'border-blue-600 text-blue-700'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t.label}
            {t.count != null && t.count > 0 && (
              <span className="ml-1.5 bg-gray-200 text-gray-600 text-xs px-1.5 py-0.5 rounded-full">
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ---- Tab: Stammdaten ---- */}
      {tab === 'stammdaten' && (
      <div className="space-y-5">

      {/* Interessent-Toggle (zuoberst) */}
      <div className={`rounded-lg border p-3 ${form.istInteressent ? 'border-amber-300 bg-amber-50' : 'border-gray-200 bg-gray-50'}`}>
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={form.istInteressent ?? false}
            onChange={(e) => {
              const next = e.target.checked;
              setForm((f) => ({
                ...f,
                istInteressent: next,
                // Mitarbeiternummer: Interessenten ohne bereits vergebene
                // Nummer bekommen keine; beim Wechsel zum MA wird die
                // nächste freie Nummer vorgeschlagen.
                nummer: next
                  ? (initial?.nummer ?? '')
                  : (f.nummer || naechsteFreieNummer(mitarbeiter)),
                // Beim Aktivieren: aus den operativen Daten erstmal nichts
                // löschen. Wenn noch kein Kontaktdatum gesetzt ist, mit
                // dem heutigen Datum vorbelegen — der User kann ändern.
                ...(next && !f.interessentKontaktDatum
                  ? { interessentKontaktDatum: new Date().toISOString().slice(0, 10) }
                  : {}),
              }));
            }}
            className="mt-0.5 rounded"
          />
          <div className="flex-1">
            <div className="text-sm font-semibold text-gray-800">
              💡 Interessent (Bewerber / Lead)
            </div>
            <p className="text-xs text-gray-600 mt-0.5">
              Person ist als potenzieller MA erfasst — noch nicht eingestellt.
              Reduzierte Pflichtfelder, keine Mitarbeiternummer, keine
              Altersprüfung, keine Gebiets-/Bonus-Zuordnung, nicht in Auswahl-
              listen, nicht in der Abrechnung. Wird der Haken später entfernt,
              wird der Datensatz wie ein neuer Mitarbeiter behandelt
              („noch nicht angemeldet").
            </p>
          </div>
        </label>
      </div>

      {/* Interessent-spezifische Felder */}
      {form.istInteressent && (
        <div className="space-y-4 rounded-lg border border-amber-200 bg-white p-4">
          <FormField label="Name *">
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="Vorname Nachname"
              className={inputClass}
            />
          </FormField>

          <div className="grid grid-cols-3 gap-4">
            <div className="col-span-2">
              <FormField label="Straße & Hausnummer">
                <input
                  type="text"
                  value={form.adresse.strasse}
                  onChange={(e) => setForm((f) => ({ ...f, adresse: { ...f.adresse, strasse: e.target.value } }))}
                  placeholder="Musterstraße 1"
                  className={inputClass}
                />
              </FormField>
            </div>
            <FormField label="PLZ">
              <input
                type="text"
                value={form.adresse.plz}
                onChange={(e) => setForm((f) => ({ ...f, adresse: { ...f.adresse, plz: e.target.value } }))}
                maxLength={5}
                className={inputClass}
              />
            </FormField>
          </div>
          <FormField label="Ort">
            <input
              type="text"
              value={form.adresse.ort}
              onChange={(e) => setForm((f) => ({ ...f, adresse: { ...f.adresse, ort: e.target.value } }))}
              className={inputClass}
            />
          </FormField>

          <div className="grid grid-cols-2 gap-4">
            <FormField label="Telefon">
              <input
                type="tel"
                value={form.telefon}
                onChange={(e) => setForm((f) => ({ ...f, telefon: e.target.value }))}
                className={inputClass}
              />
            </FormField>
            <FormField label="Mobilnummer">
              <input
                type="tel"
                value={form.mobilnummer ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, mobilnummer: e.target.value || undefined }))}
                className={inputClass}
              />
            </FormField>
          </div>
          <FormField label="E-Mail">
            <input
              type="email"
              value={form.email ?? ''}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value || undefined }))}
              className={inputClass}
            />
          </FormField>

          {/* Alter: entweder Geburtsdatum ODER Alter bei Erfassung */}
          <div className="grid grid-cols-2 gap-4">
            <FormField label="Geburtsdatum (optional)">
              <input
                type="date"
                value={form.geburtsdatum ?? ''}
                onChange={(e) => setForm((f) => ({
                  ...f,
                  geburtsdatum: e.target.value,
                  // Wenn ein Geburtsdatum gesetzt ist, das Alter-Feld leeren
                  // (Geburtsdatum ist die präzisere Angabe).
                  ...(e.target.value ? { interessentAlterBeiErfassung: undefined } : {}),
                }))}
                disabled={form.interessentAlterBeiErfassung != null && form.interessentAlterBeiErfassung > 0}
                className={inputClass}
              />
            </FormField>
            <FormField
              label="… oder: Alter in Jahren"
              hint="Alternative wenn das Geburtsdatum unbekannt ist. Das aktuelle Alter wird dann anhand des Kontaktdatums fortlaufend berechnet."
            >
              <input
                type="number"
                min={10}
                max={99}
                step={1}
                value={form.interessentAlterBeiErfassung ?? ''}
                onChange={(e) => {
                  const v = e.target.value;
                  setForm((f) => ({
                    ...f,
                    interessentAlterBeiErfassung: v === '' ? undefined : parseInt(v, 10),
                    // Wenn Alter eingetragen wird: Geburtsdatum leeren.
                    ...(v !== '' ? { geburtsdatum: '' } : {}),
                  }));
                }}
                disabled={!!form.geburtsdatum}
                placeholder="z. B. 22"
                className={inputClass}
              />
            </FormField>
          </div>

          {/* Berechnetes aktuelles Alter — sichtbar, wenn eine Angabe vorliegt */}
          {(() => {
            const heute = new Date();
            // Aus Geburtsdatum:
            if (form.geburtsdatum) {
              try {
                const a = berechneAlter(form.geburtsdatum);
                if (Number.isFinite(a)) {
                  return (
                    <div className="rounded-md bg-blue-50 border border-blue-200 px-3 py-2 text-xs text-blue-800">
                      🧮 Aktuelles Alter: <strong>{a} Jahre</strong>
                      <span className="text-blue-600/80"> — berechnet aus dem Geburtsdatum.</span>
                    </div>
                  );
                }
              } catch { /* ignore */ }
            }
            // Aus Alter bei Erfassung + Kontaktdatum:
            const alterErf = form.interessentAlterBeiErfassung;
            const datum = form.interessentKontaktDatum;
            if (alterErf != null && alterErf > 0 && datum) {
              const erf = new Date(datum);
              let zusatz = heute.getFullYear() - erf.getFullYear();
              const md = heute.getMonth() - erf.getMonth();
              if (md < 0 || (md === 0 && heute.getDate() < erf.getDate())) zusatz--;
              const aktuell = alterErf + zusatz;
              return (
                <div className="rounded-md bg-blue-50 border border-blue-200 px-3 py-2 text-xs text-blue-800">
                  🧮 Aktuelles Alter: <strong>{aktuell} Jahre</strong>
                  <span className="text-blue-600/80">
                    {' '}— berechnet aus „Alter bei Erfassung" ({alterErf} J. am{' '}
                    {erf.toLocaleDateString('de-DE')}) + verstrichene Zeit.
                  </span>
                </div>
              );
            }
            return null;
          })()}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Tätigkeiten — Interesse besteht für (Mehrfachauswahl)
            </label>
            <div className="grid grid-cols-2 gap-2">
              {ALLE_INTERESSE_TAETIGKEITEN.map((t) => {
                const aktiv = (form.interesseTaetigkeiten ?? []).includes(t);
                return (
                  <label key={t} className={`flex items-center gap-2 rounded-lg border px-3 py-2 cursor-pointer text-sm ${
                    aktiv ? 'border-blue-500 bg-blue-50 text-blue-800' : 'border-gray-200 hover:bg-gray-50'
                  }`}>
                    <input
                      type="checkbox"
                      checked={aktiv}
                      onChange={() => setForm((f) => {
                        const cur = f.interesseTaetigkeiten ?? [];
                        return {
                          ...f,
                          interesseTaetigkeiten: cur.includes(t)
                            ? cur.filter((x) => x !== t)
                            : [...cur, t],
                        };
                      })}
                      className="rounded"
                    />
                    {INTERESSE_TAETIGKEIT_LABELS[t]}
                  </label>
                );
              })}
            </div>
          </div>

          <label className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 cursor-pointer text-sm">
            <input
              type="checkbox"
              checked={form.autoVorhanden ?? false}
              onChange={(e) => setForm((f) => ({ ...f, autoVorhanden: e.target.checked }))}
              className="rounded"
            />
            🚗 <strong>Auto vorhanden</strong>
            <span className="text-xs text-gray-500">(z. B. für Fahrer / Springer / Austräger)</span>
          </label>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Interesse für Teilgebiete / Orte
            </label>
            {(form.interessentOrte ?? []).length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {(form.interessentOrte ?? []).map((o) => (
                  <span key={o} className="inline-flex items-center gap-1 text-sm bg-blue-50 border border-blue-200 text-blue-800 px-2 py-0.5 rounded-full">
                    📍 {o}
                    <button
                      type="button"
                      onClick={() => setForm((f) => ({ ...f, interessentOrte: (f.interessentOrte ?? []).filter((x) => x !== o) }))}
                      className="text-blue-500 hover:text-red-600 leading-none"
                      title={`„${o}" entfernen`}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <input
                type="text"
                list="interessent-ort-vorschlaege"
                value={neuerOrt}
                onChange={(e) => setNeuerOrt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); ortHinzufuegen(); }
                }}
                placeholder="Teilgebiet oder Ort, z. B. Uslar"
                className={inputClass}
              />
              <datalist id="interessent-ort-vorschlaege">
                {ortVorschlaege.map((o) => <option key={o} value={o} />)}
              </datalist>
              <button
                type="button"
                onClick={ortHinzufuegen}
                disabled={!neuerOrt.trim()}
                className="shrink-0 px-3 py-2 text-sm rounded-lg border border-blue-300 text-blue-700 hover:bg-blue-50 disabled:opacity-40"
              >
                + Hinzufügen
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <FormField label="Datum der Kontaktaufnahme">
              <input
                type="date"
                value={form.interessentKontaktDatum ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, interessentKontaktDatum: e.target.value || undefined }))}
                className={inputClass}
              />
            </FormField>
            <FormField label="Link zu Korrespondenz (Google Mail / Drive)">
              <input
                type="url"
                value={form.interessentKorrespondenzLink ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, interessentKorrespondenzLink: e.target.value || undefined }))}
                placeholder="https://mail.google.com/..."
                className={inputClass}
              />
            </FormField>
          </div>

          <FormField label="Memo (Einschätzung, Eindruck, Notizen)">
            <textarea
              value={form.interessentMemo ?? ''}
              onChange={(e) => setForm((f) => ({ ...f, interessentMemo: e.target.value || undefined }))}
              rows={4}
              className={inputClass}
              placeholder="z. B. ‚Sehr motivierter Bewerber, würde gerne zusätzlich mittwochs aushelfen.‘"
            />
          </FormField>

          {/* Eltern-Kontaktdaten — nur sichtbar bei (potenziell) Minderjährigen.
              Alle Felder optional. Berechnung wie im Alters-Info-Banner. */}
          {(() => {
            let alterFuerForm: number | null = null;
            if (form.geburtsdatum) {
              try {
                const a = berechneAlter(form.geburtsdatum);
                if (Number.isFinite(a)) alterFuerForm = a;
              } catch { /* ignore */ }
            } else if (form.interessentAlterBeiErfassung != null && form.interessentAlterBeiErfassung > 0) {
              // Bei der Eingabe als "Alter bei Erfassung" interpretieren wir den
              // Eingabewert direkt — der ist konservativer (jüngerer Stand).
              alterFuerForm = form.interessentAlterBeiErfassung;
            }
            if (alterFuerForm == null || alterFuerForm >= 18) return null;
            return (
              <div className="rounded-lg border border-orange-200 bg-orange-50/40 p-4 space-y-3">
                <div className="text-sm font-semibold text-orange-800">
                  👨‍👩‍👧 Erziehungsberechtigte (optional)
                </div>
                <p className="text-xs text-orange-700/80">
                  Interessent ist laut Angabe minderjährig ({alterFuerForm} J.).
                  Kontaktdaten der Eltern sind optional — falls bereits bekannt,
                  hier eintragen.
                </p>
                <FormField label="Name Erziehungsberechtigte/r">
                  <input
                    type="text"
                    value={form.elternName ?? ''}
                    onChange={(e) => setForm((f) => ({ ...f, elternName: e.target.value || undefined }))}
                    placeholder="z. B. Anna Mustermann"
                    className={inputClass}
                  />
                </FormField>
                <div className="grid grid-cols-2 gap-4">
                  <FormField label="Telefon (Festnetz)">
                    <input
                      type="tel"
                      value={form.elternTelefon ?? ''}
                      onChange={(e) => setForm((f) => ({ ...f, elternTelefon: e.target.value || undefined }))}
                      className={inputClass}
                    />
                  </FormField>
                  <FormField label="Mobil">
                    <input
                      type="tel"
                      value={form.elternMobil ?? ''}
                      onChange={(e) => setForm((f) => ({ ...f, elternMobil: e.target.value || undefined }))}
                      className={inputClass}
                    />
                  </FormField>
                </div>
                <FormField label="E-Mail">
                  <input
                    type="email"
                    value={form.elternEmail ?? ''}
                    onChange={(e) => setForm((f) => ({ ...f, elternEmail: e.target.value || undefined }))}
                    className={inputClass}
                  />
                </FormField>
                <div className="flex items-center gap-5 text-sm text-gray-700">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.elternNutztWhatsApp ?? false}
                      onChange={(e) => setForm((f) => ({ ...f, elternNutztWhatsApp: e.target.checked }))}
                      className="rounded"
                    />
                    WhatsApp
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.elternNutztTelegram ?? false}
                      onChange={(e) => setForm((f) => ({ ...f, elternNutztTelegram: e.target.checked }))}
                      className="rounded"
                    />
                    Telegram
                  </label>
                </div>
              </div>
            );
          })()}

          <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.interessentDeinteressiert ?? false}
                onChange={(e) => setForm((f) => ({ ...f, interessentDeinteressiert: e.target.checked }))}
                className="rounded"
              />
              <span className="text-sm text-gray-700">
                <strong>Deinteressiert</strong> — Interessent hat kein Interesse mehr.
                Datensatz bleibt in den Stammdaten, wird aber nicht mehr in
                Auswahllisten vorgeschlagen.
              </span>
            </label>
          </div>
        </div>
      )}

      {/* Restliche Stammdaten: nur bei „echten" MAs (kein Interessent) */}
      {!form.istInteressent && (<>
      <div className="grid grid-cols-[1fr_2fr_1fr] gap-4">
        {(() => {
          // Sperr-Regeln:
          //  - Bestehender MA → Nummer ist final, nie änderbar.
          //  - Neuer MA + Rolle „Abrechnung" → Vorschlag muss übernommen werden.
          //  - Neuer MA + Rolle „Admin" → Vorschlag darf angepasst werden.
          // Ehemaliger Interessent ohne Nummer: Nummer wird jetzt erst
          // vergeben und ist damit wie bei einer Neuanlage zu behandeln.
          const hatFesteNummer = !!initial?.nummer;
          const istNummerGesperrt = hatFesteNummer || !isAdmin;
          const hint = hatFesteNummer
            ? 'Festgelegte Nummern können nicht mehr geändert werden.'
            : isAdmin
            ? '5-stellig, beginnt mit 9. Vorschlag fortlaufend — bei Bedarf anpassen.'
            : 'Automatisch vorgeschlagen — fortlaufend. Anpassen darf nur ein Admin.';
          return (
            <FormField label="Mitarbeiternummer *" hint={hint}>
              <input
                type="text"
                value={form.nummer}
                onChange={(e) => setForm((f) => ({ ...f, nummer: e.target.value }))}
                maxLength={5}
                placeholder="90001"
                readOnly={istNummerGesperrt}
                className={`${inputClass} ${istNummerGesperrt ? 'bg-gray-100 text-gray-700 cursor-not-allowed font-mono' : 'font-mono'}`}
                title={istNummerGesperrt ? hint : undefined}
              />
            </FormField>
          );
        })()}
        <FormField label="Name *">
          <input
            type="text"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            placeholder="Max Mustermann"
            className={inputClass}
          />
        </FormField>
        {(() => {
          const vorschlag = kuerzelVorschlag(form.name);
          const aktuell = ((form as any).kuerzel ?? '').toString().toUpperCase();
          const zeigeVorschlag = !!vorschlag && aktuell !== vorschlag;
          return (
            <FormField
              label="Kürzel"
              hint="optional · 3 Buchstaben · z. B. für die Drucksaal-Planung"
            >
              <div className="flex gap-1">
                <input
                  type="text"
                  value={aktuell}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      kuerzel: e.target.value
                        .toUpperCase()
                        .replace(/[^A-ZÄÖÜß]/g, '')
                        .slice(0, 3) || undefined,
                    } as any))
                  }
                  maxLength={3}
                  placeholder={vorschlag || 'MMA'}
                  className={`${inputClass} font-mono uppercase tracking-widest text-center`}
                />
                {zeigeVorschlag && (
                  <button
                    type="button"
                    onClick={() =>
                      setForm((f) => ({ ...f, kuerzel: vorschlag } as any))
                    }
                    className="shrink-0 text-xs text-blue-600 hover:text-blue-800 border border-blue-200 rounded px-1.5"
                    title={`Vorschlag „${vorschlag}" übernehmen`}
                  >
                    ↩
                  </button>
                )}
              </div>
            </FormField>
          );
        })()}
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="col-span-2">
          <FormField label="Straße & Hausnummer">
            <input
              type="text"
              value={form.adresse.strasse}
              onChange={(e) => setForm((f) => ({ ...f, adresse: { ...f.adresse, strasse: e.target.value } }))}
              placeholder="Musterstraße 1"
              className={inputClass}
            />
          </FormField>
        </div>
        <FormField label="PLZ">
          <input
            type="text"
            value={form.adresse.plz}
            onChange={(e) => setForm((f) => ({ ...f, adresse: { ...f.adresse, plz: e.target.value } }))}
            placeholder="37170"
            maxLength={5}
            className={inputClass}
          />
        </FormField>
      </div>

      <FormField label="Ort">
        <input
          type="text"
          value={form.adresse.ort}
          onChange={(e) => setForm((f) => ({ ...f, adresse: { ...f.adresse, ort: e.target.value } }))}
          placeholder="Uslar"
          className={inputClass}
        />
      </FormField>

      <div className="grid grid-cols-2 gap-4">
        <FormField label="Telefon">
          <input
            type="tel"
            value={form.telefon}
            onChange={(e) => setForm((f) => ({ ...f, telefon: e.target.value }))}
            placeholder="+49 5571 12345"
            className={inputClass}
          />
        </FormField>
        <FormField label="Mobilnummer">
          <input
            type="tel"
            value={form.mobilnummer ?? ''}
            onChange={(e) => setForm((f) => ({ ...f, mobilnummer: e.target.value || undefined }))}
            placeholder="+49 151 1234567"
            className={inputClass}
          />
        </FormField>
      </div>

      <FormField label="Messenger auf der Mobilnummer">
        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={form.nutztWhatsApp ?? false}
              onChange={(e) => setForm((f) => ({ ...f, nutztWhatsApp: e.target.checked }))}
              className="rounded"
            />
            <span>💬 WhatsApp</span>
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={form.nutztTelegram ?? false}
              onChange={(e) => setForm((f) => ({ ...f, nutztTelegram: e.target.checked }))}
              className="rounded"
            />
            <span>✈ Telegram</span>
          </label>
        </div>
      </FormField>

      <div className="grid grid-cols-2 gap-4">
        <FormField label="E-Mail">
          <input
            type="email"
            value={form.email ?? ''}
            onChange={(e) => setForm((f) => ({ ...f, email: e.target.value || undefined }))}
            placeholder="name@example.de"
            className={inputClass}
          />
        </FormField>
        <FormField label="Geburtsdatum *">
          <input
            type="date"
            required={!form.nochNichtAngemeldet}
            value={form.geburtsdatum}
            // Maximum: vor 13 Jahren (heute) — verhindert Eingabe eines
            // Datums, das einen MA unter 13 Jahren ergibt.
            max={(() => {
              const d = new Date();
              d.setFullYear(d.getFullYear() - 13);
              return d.toISOString().slice(0, 10);
            })()}
            onChange={(e) => setForm((f) => ({ ...f, geburtsdatum: e.target.value }))}
            className={inputClass}
          />
          {alter !== null && alter < 13 && (
            <p className="text-xs text-red-600 mt-1">
              ⛔ Alter unter 13 Jahren — Beschäftigung gesetzlich nicht zulässig.
              Bitte Geburtsdatum prüfen.
            </p>
          )}
          {minderjährig && alter !== null && alter >= 13 && (
            <p className="text-xs text-orange-600 mt-1">
              ⚠ Minderjährig ({alter} Jahre) — abweichender Stundenlohn gilt
            </p>
          )}
        </FormField>
      </div>

      {/* Erziehungsberechtigte — Pflicht bei Minderjährigen */}
      {minderjährig && (
        <div className="rounded-lg border-2 border-orange-300 bg-orange-50 p-4 space-y-3">
          <div className="text-sm font-semibold text-orange-900">
            👨‍👩‍👧 Erziehungsberechtigte (Pflicht bei Minderjährigen)
            <p className="text-xs font-normal text-orange-800 mt-0.5">
              Name ist Pflicht. Mindestens ein Kontakt (Telefon, Mobil oder E-Mail).
            </p>
          </div>

          <FormField label={form.nochNichtAngemeldet ? 'Name (Erziehungsberechtigte/r)' : 'Name (Erziehungsberechtigte/r) *'}>
            <input
              type="text"
              required={!form.nochNichtAngemeldet}
              value={form.elternName ?? ''}
              onChange={(e) => setForm((f) => ({ ...f, elternName: e.target.value || undefined }))}
              placeholder="z. B. Maria Mustermann"
              className={inputClass}
            />
          </FormField>

          <div className="grid grid-cols-2 gap-3">
            <FormField label="Telefon">
              <input
                type="tel"
                value={form.elternTelefon ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, elternTelefon: e.target.value || undefined }))}
                placeholder="+49 5571 12345"
                className={inputClass}
              />
            </FormField>
            <FormField label="Mobilnummer">
              <input
                type="tel"
                value={form.elternMobil ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, elternMobil: e.target.value || undefined }))}
                placeholder="+49 151 1234567"
                className={inputClass}
              />
            </FormField>
          </div>

          <FormField label="E-Mail">
            <input
              type="email"
              value={form.elternEmail ?? ''}
              onChange={(e) => setForm((f) => ({ ...f, elternEmail: e.target.value || undefined }))}
              placeholder="name@example.de"
              className={inputClass}
            />
          </FormField>

          <FormField label="Messenger (auf der Mobilnummer der Eltern)">
            <div className="flex flex-wrap gap-4">
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={form.elternNutztWhatsApp ?? false}
                  onChange={(e) => setForm((f) => ({ ...f, elternNutztWhatsApp: e.target.checked }))}
                  className="rounded"
                />
                <span>💬 WhatsApp</span>
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={form.elternNutztTelegram ?? false}
                  onChange={(e) => setForm((f) => ({ ...f, elternNutztTelegram: e.target.checked }))}
                  className="rounded"
                />
                <span>✈ Telegram</span>
              </label>
            </div>
          </FormField>
        </div>
      )}

      {/* Abweichende Lieferadresse (allgemein) — Felder nur sichtbar, wenn aktiviert */}
      <div className={`rounded-lg border p-3 ${form.abweichendeLieferadresseAktiv ? 'border-amber-300 bg-amber-50' : 'border-gray-200 bg-gray-50'}`}>
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={form.abweichendeLieferadresseAktiv ?? false}
            onChange={(e) => setForm((f) => ({ ...f, abweichendeLieferadresseAktiv: e.target.checked }))}
            className="mt-0.5 rounded"
          />
          <div>
            <div className="text-sm font-medium text-gray-800">📍 Abweichende Lieferadresse</div>
            <p className="text-xs text-gray-500 mt-0.5">
              Aktivieren, wenn dieser Mitarbeiter nicht an seiner Wohnadresse beliefert wird.
              Die Adresse erscheint auf den Lieferscheinen.
            </p>
          </div>
        </label>

        {form.abweichendeLieferadresseAktiv && (
          <div className="mt-3 space-y-3 pl-7">
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <FormField label="Straße & Hausnummer">
                  <input
                    type="text"
                    value={form.abweichendeLieferadresse?.strasse ?? ''}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        abweichendeLieferadresse: { ...LEERE_LIEFERADRESSE, ...f.abweichendeLieferadresse, strasse: e.target.value },
                      }))
                    }
                    placeholder="Ablageort, Musterstraße 1"
                    className={inputClass}
                  />
                </FormField>
              </div>
              <FormField label="PLZ">
                <input
                  type="text"
                  value={form.abweichendeLieferadresse?.plz ?? ''}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      abweichendeLieferadresse: { ...LEERE_LIEFERADRESSE, ...f.abweichendeLieferadresse, plz: e.target.value },
                    }))
                  }
                  placeholder="37170"
                  maxLength={5}
                  className={inputClass}
                />
              </FormField>
            </div>
            <FormField label="Ort">
              <input
                type="text"
                value={form.abweichendeLieferadresse?.ort ?? ''}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    abweichendeLieferadresse: { ...LEERE_LIEFERADRESSE, ...f.abweichendeLieferadresse, ort: e.target.value },
                  }))
                }
                placeholder="Uslar"
                className={inputClass}
              />
            </FormField>
            <FormField label="Telefon">
              <input
                type="tel"
                value={form.abweichendeLieferadresse?.telefon ?? ''}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    abweichendeLieferadresse: { ...LEERE_LIEFERADRESSE, ...f.abweichendeLieferadresse, telefon: e.target.value },
                  }))
                }
                placeholder="+49 5571 12345"
                className={inputClass}
              />
            </FormField>
            <FormField label="Memo" hint="Grund / Hinweis zur Lieferadresse — erscheint auf dem Lieferschein.">
              <textarea
                value={form.abweichendeLieferadresse?.memo ?? ''}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    abweichendeLieferadresse: { ...LEERE_LIEFERADRESSE, ...f.abweichendeLieferadresse, memo: e.target.value },
                  }))
                }
                placeholder="z. B. Paket im Carport ablegen"
                rows={2}
                className={inputClass}
              />
            </FormField>
          </div>
        )}
      </div>

      {/* Google-Drive-Link — Admin + Abrechnung sichtbar/editierbar */}
      <FormField
        label="Google-Drive-Link (Unterlagen)"
        hint="Optional. Ordner-/Dokument-Link aus Google Drive, in dem die Unterlagen dieses Mitarbeiters abgelegt sind."
      >
        <input
          type="url"
          value={form.googleDriveLink ?? ''}
          onChange={(e) => setForm((f) => ({ ...f, googleDriveLink: e.target.value || undefined }))}
          placeholder="https://drive.google.com/..."
          className={inputClass}
        />
        {form.googleDriveLink && (
          <a
            href={form.googleDriveLink}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block mt-1 text-xs text-blue-600 hover:text-blue-800 underline break-all"
          >
            🔗 Im Drive öffnen
          </a>
        )}
      </FormField>

      {/* Rollen */}
      <FormField
        label="Rollen *"
        hint='Die Rolle „sonstige" kann nur der Admin setzen — bei „sonstige" werden Ist-Zeiten der Zeiterfassung abgerechnet (sonst nur Soll-Zeiten).'
      >
        <div className="flex flex-wrap gap-2 mt-1">
          {ALLE_ROLLEN.map((r) => {
            const aktiv = form.rollen.includes(r);
            const gesperrt = r === 'sonstige' && !isAdmin;
            return (
              <button
                key={r}
                type="button"
                onClick={() => { if (!gesperrt) toggleRolle(r); }}
                disabled={gesperrt}
                title={gesperrt ? 'Nur durch Admin änderbar' : undefined}
                className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                  aktiv
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white text-gray-600 border-gray-300 hover:border-blue-400'
                } ${gesperrt ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                {ROLLEN_LABELS[r]}{gesperrt && ' 🔒'}
              </button>
            );
          })}
        </div>
      </FormField>

      {/* ============================================================
          🔐 Admin-Einstellungen — nur für Admin sichtbar & editierbar
          ============================================================ */}
      {isAdmin && (
        <div className="rounded-lg border-2 border-red-300 bg-red-50/30 p-4 my-2">
          <div className="flex items-center gap-2 mb-3 pb-2 border-b border-red-200">
            <span className="text-red-700">🔐</span>
            <h3 className="text-sm font-semibold text-red-900">Admin-Einstellungen</h3>
            <span className="text-xs text-red-600 ml-auto">nur für Admin sichtbar &amp; editierbar</span>
          </div>
          <div className="space-y-5">

          <FormField label="Abrechnung">
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={form.hatFestgehalt}
                onChange={(e) => setForm((f) => ({ ...f, hatFestgehalt: e.target.checked }))}
                className="rounded"
              />
              Mitarbeiter bekommt Festgehalt (fixes Monatsgehalt, keine Leistungsabrechnung)
            </label>
          </FormField>

          {/* Fahrtkostenerstattung — nur Admin darf sehen & bearbeiten */}
          <FormField
            label="Fahrtkostenerstattung"
            hint={'Wenn aktiv, sieht der MA in seinem Mitarbeiter-Login die „Fahrtkosten"-Maske und kann eigene Fahrten erfassen. Bei Admin/Abrechnung immer sichtbar.'}
          >
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={(form as any).fahrtkostenerstattung ?? false}
                onChange={(e) => setForm((f) => ({
                  ...f,
                  fahrtkostenerstattung: e.target.checked ? true : undefined,
                } as any))}
                className="w-4 h-4"
              />
              <span className="text-sm text-gray-700">🚗 Fahrtkosten erfassen erlaubt</span>
            </label>
          </FormField>

          {/* Drucksaal — Mitarbeiter erscheint in der Drucksaal-Planung
              (unabhängig von Festgehalt/Geschäftsführer-Status) */}
          <FormField label="Drucksaal">
            <label className="flex items-start gap-2 text-sm text-gray-700 cursor-pointer">
              <input
                type="checkbox"
                checked={(form as any).istDrucksaal ?? false}
                onChange={(e) => setForm((f) => ({
                  ...f,
                  istDrucksaal: e.target.checked ? true : undefined,
                } as any))}
                className="rounded mt-0.5"
              />
              <span>
                <span className="font-medium">🖨 Drucksaal-Mitarbeiter</span>
                <span className="block text-xs text-gray-500">
                  Erscheint in der Personalplanung als wählbarer MA für Drucken,
                  Falzen, Schneiden, Verpacken.
                </span>
              </span>
            </label>
          </FormField>

          {/* Vorläufig nicht abmelden — Bedarfs-Springer, der mehrere
              Monate ohne Einsatz bleibt, soll vom Lohnbüro nicht
              automatisch abgemeldet werden. */}
          <FormField label="Abmeldung">
            <label className="flex items-start gap-2 text-sm text-gray-700 cursor-pointer">
              <input
                type="checkbox"
                checked={(form as any).vorlaeufigNichtAbmelden ?? false}
                onChange={(e) => setForm((f) => ({
                  ...f,
                  vorlaeufigNichtAbmelden: e.target.checked ? true : undefined,
                } as any))}
                className="rounded mt-0.5"
              />
              <span>
                <span className="font-medium">⏸ vorläufig nicht abmelden</span>
                <span className="block text-xs text-gray-500">
                  MA erscheint nicht in der Abmelde-Vorschlagsliste, auch wenn
                  in einer Periode keine Auszahlung erfolgt. In der
                  Lohnübermittlung wird er stattdessen als „bitte angemeldet
                  lassen" hinterlegt. Sinnvoll für Bedarfs-Springer.
                </span>
              </span>
            </label>
          </FormField>

          {form.hatFestgehalt && (
            <>
              <FormField label="Festgehalt (EUR/Monat)">
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={form.festgehaltEur ?? ''}
                  onChange={(e) => setForm((f) => ({ ...f, festgehaltEur: e.target.value ? parseFloat(e.target.value) : undefined }))}
                  // Mausrad nicht für Wert-Änderung nutzen — verhindert versehentliche
                  // Verschiebung um den step-Wert beim Scrollen durch das Formular.
                  onWheel={(e) => (e.currentTarget as HTMLInputElement).blur()}
                  placeholder="0"
                  className={inputClass}
                />
              </FormField>

              {/* Geschäftsführer-Kennzeichen — befreit von Stunden-Pflicht & Mindestlohn-Prüfung */}
              <FormField label="Sonderstatus">
                <label className="flex items-start gap-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={form.istGeschaeftsfuehrer ?? false}
                    onChange={(e) => setForm((f) => ({ ...f, istGeschaeftsfuehrer: e.target.checked }))}
                    className="rounded mt-0.5"
                  />
                  <span>
                    <span className="font-medium">Geschäftsführer</span>
                    <span className="block text-xs text-gray-500">
                      Befreit von der Pflicht zur Angabe der Wochen-/Monatsstunden
                      und von der Mindestlohn-Prüfung (fällt nicht unter MiLoG).
                    </span>
                  </span>
                </label>
              </FormField>

              {/* Vertraglich vereinbarte Arbeitszeit (Woche/Monat synchron) — nicht bei Geschäftsführern */}
              {!form.istGeschaeftsfuehrer && (() => {
                // Faktor: 52 Wochen / 12 Monate = ~4,3333
                const FAKTOR = 52 / 12;
                const setWoche = (val: string) => {
                  const w = val ? parseFloat(val) : undefined;
                  setForm((f) => ({
                    ...f,
                    wochenstundenFestgehalt: w,
                    monatsstundenFestgehalt: w !== undefined ? Math.round(w * FAKTOR * 100) / 100 : undefined,
                  }));
                };
                const setMonat = (val: string) => {
                  const m = val ? parseFloat(val) : undefined;
                  setForm((f) => ({
                    ...f,
                    monatsstundenFestgehalt: m,
                    wochenstundenFestgehalt: m !== undefined ? Math.round((m / FAKTOR) * 100) / 100 : undefined,
                  }));
                };
                return (
                  <FormField
                    label="Vertraglich vereinbarte Arbeitszeit *"
                    hint="Eines von beiden eintragen — der andere Wert wird automatisch berechnet (Monat = 52/12 × Woche)."
                  >
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">Stunden / Woche</label>
                        <input
                          type="number"
                          min="0"
                          step="any"
                          value={form.wochenstundenFestgehalt ?? ''}
                          onChange={(e) => setWoche(e.target.value)}
                          onWheel={(e) => (e.currentTarget as HTMLInputElement).blur()}
                          placeholder="z. B. 40"
                          className={inputClass}
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">Stunden / Monat (Ø)</label>
                        <input
                          type="number"
                          min="0"
                          step="any"
                          value={form.monatsstundenFestgehalt ?? ''}
                          onChange={(e) => setMonat(e.target.value)}
                          onWheel={(e) => (e.currentTarget as HTMLInputElement).blur()}
                          placeholder="z. B. 173,33"
                          className={inputClass}
                        />
                      </div>
                    </div>
                  </FormField>
                );
              })()}

              {/* Mindestlohn-Prüfung — nur bei Volljährigen, nicht bei Geschäftsführern */}
              {!form.istGeschaeftsfuehrer && (() => {
                const monatsStd = form.monatsstundenFestgehalt ?? 0;
                const lohn = form.festgehaltEur ?? 0;
                const mindestlohn = parameter?.mindeststundenlohn ?? 0;
                if (monatsStd <= 0 || lohn <= 0 || mindestlohn <= 0) return null;
                const istMinderj = minderjährig;
                if (istMinderj) {
                  return (
                    <p className="text-xs text-gray-500 -mt-2">
                      Mindestlohn-Prüfung wird bei Minderjährigen nicht angewendet.
                    </p>
                  );
                }
                const effektiv = lohn / monatsStd;
                if (effektiv >= mindestlohn) {
                  return (
                    <p className="text-xs text-green-700 -mt-2">
                      ✓ Effektiver Stundenlohn: {effektiv.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €/h —
                      liegt über der Mindestlohn-Warnschwelle ({mindestlohn} €/h).
                    </p>
                  );
                }
                const noetigesGehalt = mindestlohn * monatsStd;
                return (
                  <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 -mt-2">
                    <div className="font-semibold mb-0.5">⚠ Mindestlohn unterschritten</div>
                    <div className="text-xs">
                      Effektiver Stundenlohn:{' '}
                      <span className="font-medium">
                        {effektiv.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €/h
                      </span>
                      {' '}(unter Warnschwelle {mindestlohn} €/h).
                    </div>
                    <div className="text-xs mt-1">
                      Nötiges Festgehalt für Mindestlohn-Konformität:{' '}
                      <span className="font-semibold">
                        {noetigesGehalt.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €/Monat
                      </span>
                      {' '}(= {mindestlohn} €/h × {monatsStd.toLocaleString('de-DE', { maximumFractionDigits: 2 })} h/Monat).
                    </div>
                  </div>
                );
              })()}
            </>
          )}

          {/* Ausnahme bei Minderjährigen: Abrechnung wie Erwachsener */}
          {minderjährig && (
            <FormField
              label="Ausnahme: Abrechnung nach MiLoG (Erwachsene)"
              hint={`Wenn aktiviert, wird dieser minderjährige Mitarbeiter mit den Erwachsenen-Stundenlöhnen abgerechnet (Austragen: ${parameter?.stundenlohnErwachseneAustr ?? 13.9} €/h, Zusammentragen: ${parameter?.stundenlohnErwachseneZusammen ?? 13.9} €/h).`}
            >
              <label className="flex items-start gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={form.abrechnungAlsErwachseneMiLoG ?? false}
                  onChange={(e) => setForm((f) => ({ ...f, abrechnungAlsErwachseneMiLoG: e.target.checked }))}
                  className="rounded mt-0.5"
                />
                <span>
                  <span className="font-medium">Abrechnung nach MiLoG (Erwachsene)</span>
                  <span className="block text-xs text-gray-500">
                    Überschreibt die Stundenlöhne für Minderjährige zugunsten der Erwachsenen-Tarife.
                    Greift nicht, wenn ein individueller Stundenlohn gesetzt ist.
                  </span>
                </span>
              </label>
            </FormField>
          )}

          {/* Individueller Stundenlohn */}
          <FormField
            label="Individueller Stundenlohn (EUR/h)"
            hint={`Leer lassen für Standard (${
              minderjährig && !form.abrechnungAlsErwachseneMiLoG
                ? `${parameter?.stundenlohnMinderjAustr ?? 10.0} €/h Minderjährige`
                : `${parameter?.stundenlohnErwachseneAustr ?? 13.9} €/h MiLoG`
            })`}
          >
            <input
              type="number"
              min="0"
              step="0.01"
              value={form.stundenlohnIndividuell ?? ''}
              onChange={(e) => setForm((f) => ({
                ...f,
                stundenlohnIndividuell: e.target.value ? parseFloat(e.target.value) : undefined,
              }))}
              onWheel={(e) => (e.currentTarget as HTMLInputElement).blur()}
              placeholder="Leer = Standard"
              className={inputClass}
            />
            {form.stundenlohnIndividuell !== undefined &&
              parameter?.stundenlohnErwachseneAustr !== undefined &&
              form.stundenlohnIndividuell < parameter.mindeststundenlohn && (
                <p className="text-xs text-red-600 mt-1">
                  ⚠ Stundenlohn liegt unter dem konfigurierten Mindestlohn ({parameter.mindeststundenlohn} €/h)!
                </p>
              )}
          </FormField>

          {/* Individueller Fahrkostensatz */}
          <FormField
            label="Individueller Fahrkostensatz (EUR/km)"
            hint={`Leer lassen für globalen Standardsatz (${parameter?.fahrkostenEurProKm ?? 0.30} €/km)`}
          >
            <input
              type="number"
              min="0"
              step="0.01"
              value={(form as any).fahrkostenEurProKm ?? ''}
              onWheel={(e) => (e.currentTarget as HTMLInputElement).blur()}
              onChange={(e) => setForm((f) => ({
                ...f,
                fahrkostenEurProKm: e.target.value ? parseFloat(e.target.value) : undefined,
              } as any))}
              placeholder="Leer = Standard"
              className={inputClass}
            />
          </FormField>

          </div>
        </div>
      )}

      {/* Sozialversicherungs-Status */}
      <FormField label="Sozialversicherung / Minijob">
        <div className="space-y-2">
          <label className="flex items-start gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={form.istMinijob ?? false}
              onChange={(e) => setForm((f) => ({ ...f, istMinijob: e.target.checked }))}
              className="rounded mt-0.5"
            />
            <span>
              <span className="font-medium">Minijob</span>
              <span className="block text-xs text-gray-500">
                In der Abrechnung erscheint eine Warnung, wenn der Bruttolohn im Monat die Minijob-Grenze überschreitet.
              </span>
            </span>
          </label>
          <label className="flex items-start gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={form.sozialversicherungsBefreit ?? false}
              onChange={(e) => setForm((f) => ({ ...f, sozialversicherungsBefreit: e.target.checked }))}
              className="rounded mt-0.5"
            />
            <span>
              <span className="font-medium">Befreiung von Sozialversicherung liegt vor</span>
              <span className="block text-xs text-gray-500">
                Nur bei gekennzeichneten Mitarbeitern gilt Brutto = Netto — der Auszahlungsbetrag wird in der Abrechnung direkt berechnet.
                Bei allen anderen übernimmt das Lohnbüro die Berechnung der Sozialversicherungsabzüge.
              </span>
            </span>
          </label>
        </div>
      </FormField>

      {/* Sozialversicherungsnummer — Pflichtfeld für Minijob-Verdienstbescheinigung */}
      <FormField
        label="Sozialversicherungsnummer"
        hint="12-stellig (z. B. „12 345678 A 901“). Wird für Verdienstbescheinigungen (Minijob) benötigt."
      >
        <input
          type="text"
          value={form.sozialversicherungsNummer ?? ''}
          onChange={(e) => setForm((f) => ({
            ...f,
            sozialversicherungsNummer: e.target.value || undefined,
          }))}
          placeholder="z. B. 12 345678 A 901"
          className={inputClass}
        />
      </FormField>

      {/* Steuer-ID — 11-stellige Identifikationsnummer (Bundeszentralamt für Steuern) */}
      <FormField
        label="Steuer-ID"
        hint="11-stellig. Wird für die Anmeldung beim Lohnbüro benötigt."
      >
        <input
          type="text"
          value={form.steuerId ?? ''}
          onChange={(e) => setForm((f) => ({
            ...f,
            steuerId: e.target.value || undefined,
          }))}
          placeholder="z. B. 12345678901"
          className={inputClass}
        />
      </FormField>

      {/* Individuelle Lohngrenze — z. B. weitere Minijobs / Höchstgrenze.
          Sichtbar/editierbar für Admin und Abrechnung (analog Minijob/SV-Befreiung). */}
      <div className="border border-gray-300 rounded-lg p-3 space-y-3 bg-gray-50">
        <FormField
          label="Individuelle Lohngrenze (EUR/Monat)"
          hint="Optional. Wenn der Bruttolohn im Monat diesen Wert überschreitet, erscheint in der Abrechnung eine Warnung — z. B. wegen weiterer Minijobs bei anderen Arbeitgebern oder vertraglicher Höchstgrenze."
        >
          <input
            type="number"
            min="0"
            step="1"
            value={form.lohngrenzeIndividuellEur ?? ''}
            onChange={(e) => setForm((f) => ({
              ...f,
              lohngrenzeIndividuellEur: e.target.value ? parseFloat(e.target.value) : undefined,
            }))}
            onWheel={(e) => (e.currentTarget as HTMLInputElement).blur()}
            placeholder="Leer = keine individuelle Grenze"
            className={inputClass}
          />
        </FormField>

        {(form.lohngrenzeIndividuellEur ?? 0) > 0 && (
          <>
            <FormField
              label="Grund / Vermerk zur Lohngrenze"
              hint='Z. B. „weiterer Minijob bei XY", „Verabredung Höchstgrenze für beide Jobs".'
            >
              <input
                type="text"
                value={form.lohngrenzeIndividuellKommentar ?? ''}
                onChange={(e) => setForm((f) => ({
                  ...f,
                  lohngrenzeIndividuellKommentar: e.target.value || undefined,
                }))}
                placeholder="z. B. weiterer Minijob bei …"
                className={inputClass}
              />
            </FormField>

            <FormField
              label="Externer Link zur Dokumentation"
              hint="Optional. Link zu weiterführender Dokumentation (Google Drive, Mail-Thread, …)."
            >
              <input
                type="url"
                value={form.lohngrenzeIndividuellLink ?? ''}
                onChange={(e) => setForm((f) => ({
                  ...f,
                  lohngrenzeIndividuellLink: e.target.value || undefined,
                }))}
                placeholder="https://…"
                className={inputClass}
              />
              {form.lohngrenzeIndividuellLink && (
                <a
                  href={form.lohngrenzeIndividuellLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-block mt-1 text-xs text-blue-600 hover:text-blue-800 underline break-all"
                >
                  🔗 Dokumentation öffnen
                </a>
              )}
            </FormField>
          </>
        )}
      </div>

      {/* Pauschaler Tätigkeitsbonus je Ausgabe — Abrechnungs-Rolle sieht nur (read-only) */}
      <FormField
        label="Tätigkeitsbonus je Ausgabe (Minuten)"
        hint={
          isAdmin
            ? 'Pauschal pro Ausgabe einer Abrechnungsperiode — wird mit dem Stundensatz vergütet (z. B. 60 Min × Stundensatz × Anzahl Ausgaben).'
            : 'Anzeige — Bearbeitung nur durch Admin.'
        }
      >
        <input
          type="number"
          min="0"
          step="1"
          value={form.ausgabenBonusMinuten ?? ''}
          onChange={(e) => setForm((f) => ({
            ...f,
            ausgabenBonusMinuten: e.target.value ? parseFloat(e.target.value) : undefined,
          }))}
          onWheel={(e) => (e.currentTarget as HTMLInputElement).blur()}
          placeholder={isAdmin ? 'z. B. 60' : '—'}
          readOnly={!isAdmin}
          className={`${inputClass} ${!isAdmin ? 'bg-gray-50 text-gray-600 cursor-not-allowed' : ''}`}
        />
      </FormField>

      {(form.ausgabenBonusMinuten ?? 0) > 0 && (
        <FormField label="Grund / Vermerk zum Tätigkeitsbonus">
          <input
            type="text"
            value={form.ausgabenBonusKommentar ?? ''}
            onChange={(e) => setForm((f) => ({
              ...f,
              ausgabenBonusKommentar: e.target.value || undefined,
            }))}
            placeholder="z. B. Betreuung der Zusammenträger und Orga.-Tätigkeiten"
            readOnly={!isAdmin}
            className={`${inputClass} ${!isAdmin ? 'bg-gray-50 text-gray-600 cursor-not-allowed' : ''}`}
          />
        </FormField>
      )}

      <FormField
        label="Abholer"
        hint="Markiert Austräger, die ihren Stapel Anzeigenblätter selbst im Werk abholen. Auf dem Lieferschein erscheint dann ein deutlicher Hinweis 📦 ‚Stapel bleibt im Werk — Abholung durch Austräger‘ — der Tour-Fahrer nimmt diesen Stapel NICHT mit."
      >
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={(form as any).istAbholer ?? false}
            onChange={(e) => setForm((f) => ({
              ...f,
              istAbholer: e.target.checked ? true : undefined,
            } as any))}
            className="w-4 h-4"
          />
          <span className="text-sm text-gray-700">
            📦 Abholer — holt den Stapel selbst im Werk ab
          </span>
        </label>
      </FormField>

      {/* Online-Erfassung — steuert QR-Code + gemeldete Werte auf dem Lieferschein */}
      <FormField
        label="Online-Erfassung"
        hint="Nur wenn aktiv, trägt der Lieferschein den QR-Code zur Online-Erfassung, den Hinweistext dazu und die bereits gemeldeten Werte (Zeiten, Restmengen). Ohne das Kennzeichen ist der Lieferschein ein reiner Papier-Bogen zum Ausfüllen und Zurücksenden. Standard: deaktiviert."
      >
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={(form as any).onlineErfassungAktiv ?? false}
            onChange={(e) => setForm((f) => ({
              ...f,
              onlineErfassungAktiv: e.target.checked ? true : undefined,
            } as any))}
            className="w-4 h-4"
          />
          <span className="text-sm text-gray-700">
            Online-Erfassung aktiv — meldet Zeiten und Restmengen selbst per QR-Code
          </span>
        </label>
      </FormField>

      {error && <p className="text-red-600 text-sm">{error}</p>}

      {/* PIN-Verwaltung (nur bei bestehenden Mitarbeitern) */}
      {initial && (
        <PinVerwaltung mitarbeiter={initial} />
      )}

      {/* NFC-Chip beschreiben */}
      <div className="mt-4 pt-4 border-t border-gray-200">
        <div className="flex items-center justify-between">
          <div>
            <h4 className="text-sm font-semibold text-gray-700 mb-0.5">NFC-Chip</h4>
            <p className="text-xs text-gray-400">
              {initial
                ? 'Schreibt den Identifikations-Link auf den NFC-Chip des Mitarbeiters.'
                : 'Erst speichern — danach kann der NFC-Chip beschrieben werden.'}
            </p>
          </div>
          {initial
            ? <NfcSchreibenButton mitarbeiterId={initial.id} />
            : (
              <button
                type="button"
                disabled
                className="text-xs text-gray-300 border border-gray-200 px-3 py-1.5 rounded-lg cursor-not-allowed"
              >
                📲 NFC Chip neu beschreiben
              </button>
            )}
        </div>
      </div>

      {/* QR-Code / Meldungslink — nur für Mitarbeiter mit Teilgebietsfreigaben,
          die für die Online-Erfassung freigeschaltet sind. Ohne das Kennzeichen
          gibt es keinen Meldungslink zum Teilen (und auch keinen QR-Code auf
          dem Lieferschein). */}
      {initial && freigaben.length > 0 && (form as any).onlineErfassungAktiv && (
        <AustraegerMeldungsLink mitarbeiterId={initial.id} name={form.name} />
      )}

      </>)}
      </div>
      )}

      {/* ---- Tab: Freigaben ---- */}
      {tab === 'freigaben' && (
        <div className="space-y-4">
          {/* Auswertung: aktuell als Standardausträger zugeordnete TGs */}
          {(() => {
            if (!initial) return null;
            const alsStandard = aktiveTeilgebiete
              .filter((tg) => tg.standardAustraegerId === initial.id)
              .sort((a, b) => a.name.localeCompare(b.name, 'de', { numeric: true }));
            return (
              <div className="rounded-lg border-2 border-amber-300 bg-amber-50 p-4">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-amber-700">⭐</span>
                  <h4 className="text-sm font-semibold text-amber-900">
                    Mitarbeiter ist Standardausträger
                  </h4>
                  <span className="ml-auto text-xs text-amber-700 font-medium">
                    {alsStandard.length} Teilgebiet{alsStandard.length === 1 ? '' : 'e'}
                  </span>
                </div>
                {alsStandard.length === 0 ? (
                  <p className="text-xs text-amber-700/80 italic">
                    Aktuell keinem Teilgebiet als Standardausträger zugeordnet.
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {alsStandard.map((tg) => (
                      <span
                        key={tg.id}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-white border border-amber-300 text-xs font-medium text-amber-900"
                        title={`Standardausträger für ${tg.name}${tg.plz ? ` (${tg.plz})` : ''}`}
                      >
                        <span>⭐</span>
                        <span>{tg.name}</span>
                        {tg.plz && <span className="text-amber-600/70 font-normal">· {tg.plz}</span>}
                      </span>
                    ))}
                  </div>
                )}
                <p className="text-[11px] text-amber-700/70 mt-2">
                  Nur Anzeige — die Zuordnung als Standardausträger wird im
                  jeweiligen Teilgebiet (Reiter „Teilgebiete") gepflegt.
                </p>
              </div>
            );
          })()}

          <p className="text-sm text-gray-500">
            Wähle die Teilgebiete aus, die dieser Austräger kennt und austragen darf.
            Nur freigegebene Austräger können als Standardausträger eines Teilgebiets hinterlegt werden.
          </p>
          {aktiveTeilgebiete.length === 0 ? (
            <div className="text-gray-400 text-sm text-center py-8">Keine aktiven Teilgebiete vorhanden.</div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {[...aktiveTeilgebiete].sort((a, b) => a.name.localeCompare(b.name)).map((tg) => (
                <button
                  key={tg.id}
                  type="button"
                  onClick={() => toggleFreigabe(tg.id)}
                  className={`text-left px-3 py-2.5 rounded-lg border text-sm transition-colors ${
                    freigaben.includes(tg.id)
                      ? 'bg-green-50 border-green-400 text-green-800 font-medium'
                      : 'bg-white border-gray-200 text-gray-600 hover:border-gray-400'
                  }`}
                >
                  <div className="font-medium">{tg.name}</div>
                  {tg.plz && <div className="text-xs opacity-70">{tg.plz}</div>}
                </button>
              ))}
            </div>
          )}
          <p className="text-xs text-gray-400">
            {freigaben.length} von {aktiveTeilgebiete.length} Teilgebieten freigegeben
          </p>
        </div>
      )}

      {/* ---- Tab: Teilgebiet-Boni (Sondervereinbarungen) ---- */}
      {tab === 'boni' && (
        <SondervereinbarungenReiter
          mitarbeiter={initial}
          teilgebiete={aktiveTeilgebiete}
          isAdmin={isAdmin}
          onCountChange={setSondervereinbarungenCount}
        />
      )}

      {/* ---- Tab: Abweichende Lieferadressen je Teilgebiet ---- */}
      {tab === 'lieferadressen' && (
        <div className="space-y-4">
          <p className="text-sm text-gray-500">
            Je Teilgebiet kann eine eigene abweichende Lieferadresse hinterlegt werden.
            Sie hat bei Lieferung in dieses Teilgebiet <strong>Vorrang</strong> vor der allgemeinen
            abweichenden Lieferadresse (Reiter „Stammdaten"). Anwendungsfall: Springer werden je
            Teilgebiet an unterschiedlichen Ablageorten beliefert.
          </p>

          {(() => {
            const tgNameMap = new Map(teilgebiete.map((tg) => [tg.id, tg]));
            const belegteIds = new Set(lieferadressenTg.map((l) => l.teilgebietId));
            const verfuegbare = [...aktiveTeilgebiete]
              .filter((tg) => !belegteIds.has(tg.id))
              .sort((a, b) => a.name.localeCompare(b.name, 'de', { numeric: true }));
            const updateLA = (tgId: string, patch: Partial<TeilgebietLieferadresse>) =>
              setLieferadressenTg((prev) =>
                prev.map((l) => (l.teilgebietId === tgId ? { ...l, ...patch } : l)),
              );
            return (
              <>
                {/* Hinzufügen */}
                <div className="flex items-center gap-2">
                  <select
                    value=""
                    onChange={(e) => {
                      const tgId = e.target.value;
                      if (!tgId) return;
                      setLieferadressenTg((prev) => [
                        ...prev,
                        { teilgebietId: tgId, ...LEERE_LIEFERADRESSE },
                      ]);
                    }}
                    disabled={verfuegbare.length === 0}
                    className={inputClass + ' max-w-xs'}
                  >
                    <option value="">
                      {verfuegbare.length === 0
                        ? 'Alle aktiven Teilgebiete bereits erfasst'
                        : '+ Teilgebiet hinzufügen…'}
                    </option>
                    {verfuegbare.map((tg) => (
                      <option key={tg.id} value={tg.id}>
                        {tg.name}{tg.plz ? ` (${tg.plz})` : ''}
                      </option>
                    ))}
                  </select>
                </div>

                {lieferadressenTg.length === 0 ? (
                  <div className="text-gray-400 text-sm text-center py-8">
                    Keine teilgebietsspezifischen Lieferadressen hinterlegt.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {lieferadressenTg.map((l) => {
                      const tg = tgNameMap.get(l.teilgebietId);
                      return (
                        <div
                          key={l.teilgebietId}
                          className="rounded-lg border border-gray-200 bg-gray-50 p-3 space-y-3"
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold text-gray-800">
                              📍 {tg ? tg.name : 'Unbekanntes Teilgebiet'}
                              {tg?.plz && <span className="font-normal text-gray-500"> · {tg.plz}</span>}
                            </span>
                            <button
                              type="button"
                              onClick={() =>
                                setLieferadressenTg((prev) =>
                                  prev.filter((x) => x.teilgebietId !== l.teilgebietId),
                                )
                              }
                              className="ml-auto text-xs text-red-600 hover:text-red-800 border border-red-200 rounded px-2 py-0.5"
                            >
                              Entfernen
                            </button>
                          </div>
                          <div className="grid grid-cols-3 gap-3">
                            <div className="col-span-2">
                              <FormField label="Straße & Hausnummer">
                                <input
                                  type="text"
                                  value={l.strasse}
                                  onChange={(e) => updateLA(l.teilgebietId, { strasse: e.target.value })}
                                  placeholder="Ablageort, Musterstraße 1"
                                  className={inputClass}
                                />
                              </FormField>
                            </div>
                            <FormField label="PLZ">
                              <input
                                type="text"
                                value={l.plz}
                                onChange={(e) => updateLA(l.teilgebietId, { plz: e.target.value })}
                                placeholder="37170"
                                maxLength={5}
                                className={inputClass}
                              />
                            </FormField>
                          </div>
                          <FormField label="Ort">
                            <input
                              type="text"
                              value={l.ort}
                              onChange={(e) => updateLA(l.teilgebietId, { ort: e.target.value })}
                              placeholder="Uslar"
                              className={inputClass}
                            />
                          </FormField>
                          <FormField label="Telefon">
                            <input
                              type="tel"
                              value={l.telefon ?? ''}
                              onChange={(e) => updateLA(l.teilgebietId, { telefon: e.target.value })}
                              placeholder="+49 5571 12345"
                              className={inputClass}
                            />
                          </FormField>
                          <FormField label="Memo" hint="Grund / Hinweis — erscheint auf dem Lieferschein.">
                            <textarea
                              value={l.memo ?? ''}
                              onChange={(e) => updateLA(l.teilgebietId, { memo: e.target.value })}
                              placeholder="z. B. Paket beim Kiosk abgeben"
                              rows={2}
                              className={inputClass}
                            />
                          </FormField>
                        </div>
                      );
                    })}
                  </div>
                )}
                <p className="text-xs text-amber-700/80">
                  Nur Einträge mit ausgefüllter Straße oder Ort werden gespeichert.
                </p>
              </>
            );
          })()}
        </div>
      )}

      {/* ---- Tab: Anmeldung / Abmeldung ---- */}
      {tab === 'anmeldung' && (
        <div className="space-y-5">
          {/* Anmeldung-Block */}
          <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 space-y-4">
            <div className="text-sm font-semibold text-blue-900">📝 Anmeldung beim Lohnbüro</div>

            <FormField label="Status">
              <label className="flex items-start gap-2 text-sm text-gray-700 mb-2">
                <input
                  type="checkbox"
                  checked={form.nochNichtAngemeldet ?? false}
                  onChange={(e) => setForm((f) => ({ ...f, nochNichtAngemeldet: e.target.checked }))}
                  className="rounded mt-0.5"
                />
                <span>
                  <span className="font-medium">⏳ Noch nicht angemeldet</span>
                  <span className="block text-xs text-gray-500">
                    Solange aktiviert, ist der Mitarbeiter in keiner operativen Auswahl
                    selektierbar (Standardausträger, Springer, Zusammentragen, Zeit-Erfassung).
                  </span>
                </span>
              </label>
            </FormField>

            {minderjährig && (
              <FormField label="Erlaubnis Eltern">
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={form.erlaubnisElternEingeholt ?? false}
                    onChange={(e) => setForm((f) => ({ ...f, erlaubnisElternEingeholt: e.target.checked }))}
                    className="rounded"
                  />
                  Erlaubnis der Eltern / Erziehungsberechtigten eingeholt
                </label>
              </FormField>
            )}

            <FormField
              label="Link zur FastDok-Bestätigungsmail"
              hint="Z. B. Gmail-Permalink zur Bestätigung des Lohnbüros."
            >
              <input
                type="url"
                value={form.lohnbueroBestaetigungLink ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, lohnbueroBestaetigungLink: e.target.value || undefined }))}
                placeholder="https://mail.google.com/..."
                className={inputClass}
              />
              {form.lohnbueroBestaetigungLink && (
                <a
                  href={form.lohnbueroBestaetigungLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-block mt-1 text-xs text-blue-600 hover:text-blue-800 underline break-all"
                >
                  🔗 Mail öffnen
                </a>
              )}
            </FormField>

            <div className="grid grid-cols-2 gap-3">
              <FormField label="Erste Abrechnungsperiode">
                <select
                  value={form.startAbrechnungsperiodeId ?? ''}
                  onChange={(e) => setForm((f) => ({ ...f, startAbrechnungsperiodeId: e.target.value || undefined }))}
                  className={inputClass}
                >
                  <option value="">— keine —</option>
                  {[...abrechnungsperioden]
                    .sort((a, b) => (a.jahr !== b.jahr ? a.jahr - b.jahr : a.monat - b.monat))
                    .map((p) => (
                      <option key={p.id} value={p.id}>{p.bezeichnung}</option>
                    ))}
                </select>
              </FormField>
              <FormField label="oder Startdatum">
                <input
                  type="date"
                  value={form.startDatum ?? ''}
                  onChange={(e) => setForm((f) => ({ ...f, startDatum: e.target.value || undefined }))}
                  className={inputClass}
                />
              </FormField>
            </div>

            <FormField label="Vollständigkeit der Erfassung">
              <select
                value={form.anmeldungStatus ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, anmeldungStatus: (e.target.value || undefined) as typeof form.anmeldungStatus }))}
                className={inputClass}
              >
                <option value="">— bitte wählen —</option>
                <option value="fragebogen-beim-ma">1. Fragebogen beim Mitarbeiter</option>
                <option value="fragebogen-zurueck-unvollstaendig">2. Fragebogen zurück, unvollständig</option>
                <option value="vollstaendig">3. Vollständig</option>
              </select>
            </FormField>

            {form.anmeldungStatus === 'fragebogen-zurueck-unvollstaendig' && (
              <FormField label="Fehlende Informationen (Memo)">
                <textarea
                  value={form.anmeldungUnvollstaendigMemo ?? ''}
                  onChange={(e) => setForm((f) => ({ ...f, anmeldungUnvollstaendigMemo: e.target.value || undefined }))}
                  rows={3}
                  placeholder="z. B. fehlende Steuer-ID, Bankverbindung unleserlich, …"
                  className={inputClass}
                />
              </FormField>
            )}

            {form.anmeldungStatus === 'vollstaendig' && (
              <FormField label="Datenübermittlung an Lohnbüro">
                <input
                  type="date"
                  value={form.anmeldungUebermittlungDatum ?? ''}
                  onChange={(e) => {
                    const datum = e.target.value || undefined;
                    setForm((f) => ({ ...f, anmeldungUebermittlungDatum: datum }));
                    // Wenn Datum erstmals gesetzt + Kennzeichen "Noch nicht angemeldet" aktiv → Rückfrage
                    if (datum && form.nochNichtAngemeldet) {
                      // setTimeout damit React den State erst aktualisiert
                      setTimeout(() => {
                        if (confirm('Datenübermittlung erfolgt — Kennzeichen „Noch nicht angemeldet" jetzt entfernen?')) {
                          setForm((f) => ({ ...f, nochNichtAngemeldet: false }));
                        }
                      }, 0);
                    }
                  }}
                  className={inputClass}
                />
              </FormField>
            )}

            <FormField
              label="Anmeldedaten / Memo fürs Lohnbüro"
              hint="Anmelderelevante Angaben, die mit dem Mitarbeiter in die Anmeldemaske des Lohnbüros einzutragen sind — z. B. Steuer-ID, Krankenkasse, SV-Nummer."
            >
              <textarea
                value={form.anmeldungMemo ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, anmeldungMemo: e.target.value || undefined }))}
                rows={4}
                placeholder="z. B. Steuer-ID: 12 345 678 901&#10;Krankenkasse: AOK Niedersachsen&#10;SV-Nummer: …"
                className={inputClass}
              />
            </FormField>
          </div>

          {/* Abmeldung-Block */}
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 space-y-4">
            <div className="text-sm font-semibold text-red-900">🚪 Abmeldung beim Lohnbüro</div>

            <FormField label="Status">
              <label className="flex items-start gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={form.abgemeldet ?? false}
                  onChange={(e) => setForm((f) => ({ ...f, abgemeldet: e.target.checked }))}
                  className="rounded mt-0.5"
                />
                <span>
                  <span className="font-medium">Mitarbeiter abgemeldet</span>
                  <span className="block text-xs text-gray-500">
                    MA verlässt das Unternehmen. Erscheint nicht mehr in operativen Auswahllisten.
                  </span>
                </span>
              </label>
            </FormField>

            {form.abgemeldet && (
              <>
                <FormField label="Datum der Übermittlung an Lohnbüro">
                  <input
                    type="date"
                    value={form.abmeldungUebermittlungDatum ?? ''}
                    onChange={(e) => setForm((f) => ({ ...f, abmeldungUebermittlungDatum: e.target.value || undefined }))}
                    className={inputClass}
                  />
                </FormField>

                <FormField label="Letzte Abrechnungsperiode">
                  <select
                    value={form.letzteAbrechnungsperiodeId ?? ''}
                    onChange={(e) => setForm((f) => ({ ...f, letzteAbrechnungsperiodeId: e.target.value || undefined }))}
                    className={inputClass}
                  >
                    <option value="">— keine —</option>
                    {[...abrechnungsperioden]
                      .sort((a, b) => (b.jahr !== a.jahr ? b.jahr - a.jahr : b.monat - a.monat))
                      .map((p) => (
                        <option key={p.id} value={p.id}>{p.bezeichnung}</option>
                      ))}
                  </select>
                </FormField>
              </>
            )}
          </div>
        </div>
      )}

      {/* ---- Tab: Lohnkonto (Admin-only) ---- */}
      {tab === 'lohnkonto' && isAdmin && initial && (
        <LohnkontoTab mitarbeiter={initial} />
      )}

      {/* ---- Tab: Verdienstbescheinigung Minijob (Admin-only) ---- */}
      {tab === 'verdienstbescheinigung' && isAdmin && initial && form.istMinijob && (
        <VerdienstbescheinigungTab
          mitarbeiter={initial}
          adminName={adminName}
          lohnbueroAbrechnungen={lohnbueroAbrechnungen}
          lohnbueroDriveLinks={lohnbueroDriveLinks}
          fragenKatalog={verdienstbescheinigungFragen}
        />
      )}

      {/* Aktionen — immer sichtbar */}
      {error && <p className="text-red-600 text-sm mt-4">{error}</p>}
      <div className="flex items-center justify-between pt-5 mt-4 border-t border-gray-100">
        <div>
          {initial && tab === 'stammdaten' && (
            initial.isActive ? (
              <button
                type="button"
                onClick={handleDeaktivieren}
                className="text-sm text-red-600 hover:text-red-700"
              >
                Mitarbeiter deaktivieren
              </button>
            ) : (
              <button
                type="button"
                onClick={handleAktivieren}
                className="text-sm text-green-700 hover:text-green-800 font-medium"
              >
                ✓ Mitarbeiter aktivieren
              </button>
            )
          )}
        </div>
        <div className="flex gap-3">
          <button type="button" onClick={onCancel} className="px-4 py-2 text-sm text-gray-600">
            Abbrechen
          </button>
          <button
            type="submit"
            disabled={saving}
            className="bg-blue-600 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? 'Speichere...' : initial ? 'Speichern' : 'Erstellen'}
          </button>
        </div>
      </div>
    </form>
  );
}

// ---- PIN-Verwaltung für Mitarbeiter ------------------------

function PinVerwaltung({ mitarbeiter: initialMa }: { mitarbeiter: Mitarbeiter }) {
  // Immer die aktuellen Daten aus dem Context holen (wird per Real-time-Listener aktualisiert)
  const { mitarbeiter: alleMitarbeiter, userRole } = useApp();
  const mitarbeiter = alleMitarbeiter.find((m) => m.id === initialMa.id) ?? initialMa;

  const [neuerPin, setNeuerPin] = useState('');
  const [pinBestaetigung, setPinBestaetigung] = useState('');
  const [showPinForm, setShowPinForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  const hatPin = !!mitarbeiter.pinHash;

  // ---- PIN anzeigen (nur Admin) ----------------------------
  // In der Datenbank steht nur der SHA-256-Hash. Für die Anzeige wird
  // der PIN durch Probieren aller 4- bis 6-stelligen Zahlen
  // rekonstruiert (siehe ermittlePinAusHash) — so bleibt der Klartext
  // weiterhin nirgends gespeichert.
  const istAdmin = userRole === 'admin';
  const [klartextPin, setKlartextPin] = useState<string | null>(null);
  const [sucheLaeuft, setSucheLaeuft] = useState(false);
  const [suchFortschritt, setSuchFortschritt] = useState(0);
  const [suchMeldung, setSuchMeldung] = useState('');
  const abbruchRef = useRef(false);

  // Angezeigten PIN verwerfen, wenn der PIN geändert/gelöscht wird oder
  // ein anderer Mitarbeiter geöffnet ist.
  useEffect(() => {
    setKlartextPin(null);
    setSuchMeldung('');
    setSuchFortschritt(0);
  }, [mitarbeiter.id, mitarbeiter.pinHash]);

  // Angezeigten PIN nach 60 Sekunden automatisch wieder ausblenden.
  useEffect(() => {
    if (!klartextPin) return;
    const id = setTimeout(() => setKlartextPin(null), 60_000);
    return () => clearTimeout(id);
  }, [klartextPin]);

  // Laufende Suche beim Verlassen abbrechen.
  useEffect(() => () => { abbruchRef.current = true; }, []);

  async function handlePinAnzeigen() {
    if (!mitarbeiter.pinHash) return;
    abbruchRef.current = false;
    setSucheLaeuft(true);
    setSuchMeldung('');
    setSuchFortschritt(0);
    try {
      const gefunden = await ermittlePinAusHash(mitarbeiter.pinHash, {
        onFortschritt: setSuchFortschritt,
        abbruch: () => abbruchRef.current,
      });
      if (abbruchRef.current) { setSuchMeldung('Suche abgebrochen.'); return; }
      if (gefunden) {
        setKlartextPin(gefunden);
      } else {
        setSuchMeldung('PIN nicht ermittelbar (länger als 6 Stellen). Bitte neu setzen.');
      }
    } catch {
      setSuchMeldung('Fehler beim Ermitteln des PINs.');
    } finally {
      setSucheLaeuft(false);
    }
  }

  async function handlePinSetzen() {
    if (neuerPin.length < 4) { setMessage('PIN muss mindestens 4 Stellen haben.'); return; }
    if (pinBestaetigung.length < 4) { setMessage('Bitte PIN-Bestätigung eingeben.'); return; }
    if (neuerPin !== pinBestaetigung) { setMessage('PINs stimmen nicht überein.'); return; }
    setSaving(true);
    setMessage('');
    try {
      const hash = await hashPin(neuerPin);
      await aktualisiereMitarbeiter(mitarbeiter.id, { pinHash: hash });
      setNeuerPin('');
      setPinBestaetigung('');
      setShowPinForm(false);
      setMessage('✓ PIN gesetzt');
      setTimeout(() => setMessage(''), 3000);
    } catch {
      setMessage('Fehler beim Speichern.');
    } finally {
      setSaving(false);
    }
  }

  async function handlePinLoeschen() {
    if (!confirm(`PIN von "${mitarbeiter.name}" wirklich löschen?`)) return;
    setSaving(true);
    try {
      await aktualisiereMitarbeiter(mitarbeiter.id, { pinHash: undefined });
      setMessage('✓ PIN gelöscht');
      setTimeout(() => setMessage(''), 3000);
    } catch {
      setMessage('Fehler beim Löschen.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-4 pt-4 border-t border-gray-200">
      <div className="flex items-center gap-3 mb-2">
        <h4 className="text-sm font-semibold text-gray-700">Mitarbeiter-PIN (Selbstschutz)</h4>
        {hatPin ? (
          <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">🔒 PIN gesetzt</span>
        ) : (
          <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">Kein PIN</span>
        )}
      </div>
      <p className="text-xs text-gray-400 mb-3">
        Wenn ein PIN gesetzt ist, können die eigenen Daten dieses Mitarbeiters durch ihn selbst geschützt werden.
      </p>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setShowPinForm(!showPinForm)}
          className="text-xs text-blue-600 hover:text-blue-800 underline"
        >
          {hatPin ? 'PIN ändern' : 'PIN setzen'}
        </button>
        {hatPin && istAdmin && !klartextPin && (
          <button
            type="button"
            onClick={handlePinAnzeigen}
            disabled={sucheLaeuft}
            className="text-xs text-blue-600 hover:text-blue-800 underline disabled:opacity-50"
          >
            {sucheLaeuft ? 'PIN wird ermittelt…' : 'PIN anzeigen'}
          </button>
        )}
        {hatPin && istAdmin && klartextPin && (
          <button
            type="button"
            onClick={() => setKlartextPin(null)}
            className="text-xs text-gray-500 hover:text-gray-700 underline"
          >
            PIN verbergen
          </button>
        )}
        {hatPin && (
          <button
            type="button"
            onClick={handlePinLoeschen}
            disabled={saving}
            className="text-xs text-red-500 hover:text-red-700 underline"
          >
            PIN löschen
          </button>
        )}
      </div>

      {/* Ermittelten PIN anzeigen — nur Admin */}
      {sucheLaeuft && (
        <div className="mt-3 bg-blue-50 border border-blue-200 rounded-lg p-3">
          <p className="text-xs text-blue-800 mb-2">PIN wird ermittelt… {suchFortschritt} %</p>
          <div className="h-1.5 bg-blue-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-500 transition-all"
              style={{ width: `${suchFortschritt}%` }}
            />
          </div>
          <button
            type="button"
            onClick={() => { abbruchRef.current = true; }}
            className="text-xs text-gray-500 hover:text-gray-700 underline mt-2"
          >
            Abbrechen
          </button>
        </div>
      )}
      {klartextPin && (
        <div className="mt-3 bg-amber-50 border border-amber-300 rounded-lg p-3 flex items-center justify-between gap-3">
          <div>
            <p className="text-xs text-amber-800">PIN von {mitarbeiter.name}</p>
            <p className="text-2xl font-mono tracking-widest text-gray-900">{klartextPin}</p>
          </div>
          <p className="text-xs text-amber-700 text-right max-w-[12rem]">
            Wird nach 60 Sekunden automatisch ausgeblendet.
          </p>
        </div>
      )}
      {suchMeldung && !sucheLaeuft && (
        <p className="text-xs text-red-600 mt-2">{suchMeldung}</p>
      )}

      {showPinForm && (
        <div className="mt-3 bg-gray-50 rounded-lg p-3 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs text-gray-600 mb-1">Neuer PIN (min. 4 Stellen)</label>
              <input
                type="password"
                inputMode="numeric"
                maxLength={8}
                value={neuerPin}
                onChange={(e) => setNeuerPin(e.target.value.replace(/\D/g, ''))}
                placeholder="••••"
                className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">Bestätigung *</label>
              <input
                type="password"
                inputMode="numeric"
                maxLength={8}
                value={pinBestaetigung}
                onChange={(e) => setPinBestaetigung(e.target.value.replace(/\D/g, ''))}
                placeholder="••••"
                className={`w-full border rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 ${
                  pinBestaetigung && pinBestaetigung !== neuerPin
                    ? 'border-red-400 bg-red-50'
                    : 'border-gray-300'
                }`}
              />
              {pinBestaetigung && pinBestaetigung !== neuerPin && (
                <p className="text-xs text-red-500 mt-0.5">Stimmt nicht überein</p>
              )}
            </div>
          </div>
          <div className="flex gap-2 items-center">
            <button
              type="button"
              onClick={handlePinSetzen}
              disabled={saving || neuerPin.length < 4 || pinBestaetigung.length < 4 || neuerPin !== pinBestaetigung}
              className="text-xs bg-blue-600 text-white px-3 py-1.5 rounded hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? '...' : 'PIN setzen'}
            </button>
            <button
              type="button"
              onClick={() => { setShowPinForm(false); setNeuerPin(''); setPinBestaetigung(''); }}
              className="text-xs text-gray-500 hover:text-gray-700"
            >
              Abbrechen
            </button>
          </div>
        </div>
      )}
      {message && (
        <p className={`text-xs mt-1 ${message.startsWith('✓') ? 'text-green-600' : 'text-red-600'}`}>
          {message}
        </p>
      )}
    </div>
  );
}

function FormField({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      {hint && <p className="text-xs text-gray-400 mb-1">{hint}</p>}
      {children}
    </div>
  );
}

const inputClass =
  'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';

// ---- NFC-Chip beschreiben ----------------------------------

function NfcSchreibenButton({ mitarbeiterId }: { mitarbeiterId: string }) {
  const [status, setStatus] = useState<'idle' | 'schreibt' | 'ok' | 'fehler'>('idle');
  const [showInfo, setShowInfo] = useState(false);
  const [kopiert, setKopiert] = useState(false);

  const nfcUrl = `${window.location.origin}/nfc?ma=${encodeURIComponent(mitarbeiterId)}`;

  async function handleSchreiben() {
    if (!nfcVerfuegbar()) {
      // Desktop: Info-Box mit URL zum Kopieren anzeigen
      setShowInfo((v) => !v);
      return;
    }
    setStatus('schreibt');
    try {
      await beschreibeNfcTag(mitarbeiterId);
      setStatus('ok');
      setTimeout(() => setStatus('idle'), 3000);
    } catch {
      setStatus('fehler');
      setTimeout(() => setStatus('idle'), 3000);
    }
  }

  async function handleKopieren() {
    await navigator.clipboard.writeText(nfcUrl);
    setKopiert(true);
    setTimeout(() => setKopiert(false), 2000);
  }

  return (
    <div className="relative">
      <button
        onClick={handleSchreiben}
        disabled={status === 'schreibt'}
        title={nfcVerfuegbar() ? 'NFC-Chip beschreiben' : 'NFC-Chip-URL anzeigen'}
        className={`text-xs font-medium px-3 py-1.5 rounded-lg border transition-colors ${
          status === 'ok'
            ? 'border-green-300 bg-green-50 text-green-700'
            : status === 'fehler'
            ? 'border-red-300 bg-red-50 text-red-700'
            : showInfo
            ? 'border-blue-400 bg-blue-50 text-blue-700'
            : 'border-gray-300 bg-white text-gray-700 hover:border-gray-400 hover:bg-gray-50'
        }`}
      >
        {status === 'schreibt' ? '📲 Schreibt…' :
         status === 'ok'      ? '✓ NFC Chip beschrieben' :
         status === 'fehler'  ? '✗ Fehler beim Schreiben' :
                                '📲 NFC Chip neu beschreiben'}
      </button>

      {/* Info-Box für Desktop (kein NFC verfügbar) */}
      {showInfo && (
        <div className="absolute left-0 top-6 z-50 bg-white border border-gray-200 rounded-xl shadow-xl p-4 w-80">
          <div className="flex items-start justify-between mb-2">
            <p className="text-xs font-semibold text-gray-700">NFC-Chip beschreiben</p>
            <button onClick={() => setShowInfo(false)} className="text-gray-400 hover:text-gray-600 text-sm ml-2">✕</button>
          </div>
          <p className="text-xs text-gray-500 mb-3">
            Web NFC ist nur in <strong>Chrome auf Android</strong> verfügbar.
            Diese URL auf den Chip schreiben — zum Beispiel mit der App <em>NFC Tools</em>:
          </p>
          <div className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 mb-3">
            <p className="text-xs font-mono text-blue-700 break-all">{nfcUrl}</p>
          </div>
          <button
            onClick={handleKopieren}
            className="w-full text-xs bg-blue-600 text-white py-2 rounded-lg hover:bg-blue-700 transition-colors"
          >
            {kopiert ? '✓ Kopiert!' : '📋 URL kopieren'}
          </button>
          <p className="text-xs text-gray-400 mt-2 text-center">
            Oder öffne diese Seite auf dem Android-Handy und tippe dort auf 📲 NFC
          </p>
        </div>
      )}
    </div>
  );
}

// ---- QR-Code / Meldungslink für Austräger ------------------

function AustraegerMeldungsLink({
  mitarbeiterId,
  name,
}: {
  mitarbeiterId: string;
  name: string;
}) {
  const [kopiert, setKopiert] = useState(false);
  const [qrOffen, setQrOffen] = useState(false);

  const url = `${window.location.origin}/meldung?ma=${encodeURIComponent(mitarbeiterId)}`;
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&margin=8&data=${encodeURIComponent(url)}`;

  async function handleKopieren() {
    await navigator.clipboard.writeText(url);
    setKopiert(true);
    setTimeout(() => setKopiert(false), 2500);
  }

  return (
    <div className="mt-4 pt-4 border-t border-gray-200">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h4 className="text-sm font-semibold text-gray-700 mb-0.5">📋 Meldungs-Link (Austräger)</h4>
          <p className="text-xs text-gray-400">
            QR-Code auf Lieferschein drucken oder Link teilen. Kein Login nötig.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setQrOffen((v) => !v)}
          className={`shrink-0 text-xs font-medium px-3 py-1.5 rounded-lg border transition-colors ${
            qrOffen
              ? 'border-green-400 bg-green-50 text-green-700'
              : 'border-gray-300 bg-white text-gray-700 hover:border-gray-400'
          }`}
        >
          {qrOffen ? '▲ Schließen' : '📷 QR-Code anzeigen'}
        </button>
      </div>

      {qrOffen && (
        <div className="mt-3 bg-gray-50 border border-gray-200 rounded-xl p-4">
          <div className="flex gap-4 items-start">
            {/* QR Code */}
            <div className="shrink-0 bg-white border border-gray-200 rounded-lg p-1">
              <img
                src={qrUrl}
                alt={`QR-Code Meldungslink ${name}`}
                width={110}
                height={110}
                className="rounded"
                loading="lazy"
              />
            </div>
            {/* Info + Aktionen */}
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-gray-700 mb-1">Persönlicher Meldungslink:</p>
              <div className="bg-white border border-gray-200 rounded-lg px-2.5 py-2 mb-2.5 overflow-hidden">
                <p className="text-xs font-mono text-blue-700 break-all leading-relaxed">{url}</p>
              </div>
              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  onClick={handleKopieren}
                  className="w-full text-xs bg-blue-600 text-white py-2 rounded-lg hover:bg-blue-700 transition-colors font-medium"
                >
                  {kopiert ? '✓ Kopiert!' : '📋 Link kopieren'}
                </button>
                <a
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  className="w-full text-xs text-center bg-white border border-gray-300 text-gray-700 py-2 rounded-lg hover:border-gray-400 transition-colors"
                >
                  🔗 Link öffnen (Test)
                </a>
              </div>
            </div>
          </div>
          <p className="text-xs text-gray-400 mt-3 text-center">
            QR-Code auf Lieferschein drucken — Austräger scannt und erfasst seine Zeiten direkt.
          </p>
        </div>
      )}
    </div>
  );
}

// ============================================================
// Lohnkonto-Tab (Admin-only) — Verlauf + freie Korrektur-Buchungen
// ============================================================


function LohnkontoTab({ mitarbeiter }: { mitarbeiter: Mitarbeiter }) {
  const { lohnkontoBuchungen, abrechnungsperioden } = useApp();
  const [neuArt, setNeuArt] = useState<'verschiebung' | 'verrechnung'>('verschiebung');
  const [neuBetrag, setNeuBetrag] = useState('');
  const [neuKommentar, setNeuKommentar] = useState('');
  const [neuPeriodeId, setNeuPeriodeId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const periodenSorted = [...abrechnungsperioden].sort((a, b) =>
    a.jahr !== b.jahr ? b.jahr - a.jahr : b.monat - a.monat
  );
  const offene = periodenSorted.filter((p) => p.status === 'offen');
  const defaultPeriodeId =
    offene[offene.length - 1]?.id ?? periodenSorted[0]?.id ?? '';

  const buchungenMa = lohnkontoBuchungen.filter((b) => b.mitarbeiterId === mitarbeiter.id);
  const periodeMap = new Map(abrechnungsperioden.map((p) => [p.id, p]));
  const sortiert = [...buchungenMa].sort((a, b) => {
    const pa = periodeMap.get(a.abrechnungsperiodeId);
    const pb = periodeMap.get(b.abrechnungsperiodeId);
    if (pa && pb) {
      if (pa.jahr !== pb.jahr) return pa.jahr - pb.jahr;
      if (pa.monat !== pb.monat) return pa.monat - pb.monat;
    }
    return a.erstelltAm - b.erstelltAm;
  });
  // Saldo-Akkumulation in Cent-Integer gegen Float-Drift
  // („79,30 + 0,02 → 79,28").
  const toCent = (eur: number) => Math.round(eur * 100);
  let saldoCent = 0;
  const zeilen = sortiert.map((b) => {
    saldoCent += b.art === 'verschiebung' ? toCent(b.betragEur) : -toCent(b.betragEur);
    return { buchung: b, periode: periodeMap.get(b.abrechnungsperiodeId), saldoNach: saldoCent / 100 };
  });
  const aktuellerSaldo = zeilen.length > 0 ? zeilen[zeilen.length - 1].saldoNach : 0;

  async function handleNeu() {
    setError('');
    const betrag = parseFloat(neuBetrag.replace(',', '.'));
    if (!Number.isFinite(betrag) || betrag <= 0) {
      setError('Betrag muss > 0 sein.');
      return;
    }
    const periodeId = neuPeriodeId || defaultPeriodeId;
    if (!periodeId) {
      setError('Keine Abrechnungsperiode vorhanden. Bitte zuerst anlegen.');
      return;
    }
    setSaving(true);
    try {
      await erstelleLohnkontoBuchung({
        mitarbeiterId: mitarbeiter.id,
        abrechnungsperiodeId: periodeId,
        art: neuArt,
        betragEur: betrag,
        kommentar: neuKommentar.trim() || undefined,
      });
      setNeuBetrag('');
      setNeuKommentar('');
    } catch (e) {
      console.error(e);
      setError('Fehler beim Speichern.');
    } finally {
      setSaving(false);
    }
  }

  async function handleLoeschen(id: string) {
    if (!confirm('Diese Buchung wirklich endgültig löschen?')) return;
    await loescheLohnkontoBuchung(id);
  }

  async function handleKommentarBearbeiten(id: string, alt: string | undefined) {
    const neu = prompt('Kommentar bearbeiten:', alt ?? '');
    if (neu === null) return;
    await aktualisiereLohnkontoBuchung(id, { kommentar: neu.trim() || undefined });
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <div className="rounded-lg border border-blue-100 bg-blue-50 p-3">
          <div className="text-xs text-blue-700 mb-0.5">Buchungen</div>
          <div className="text-base font-bold text-blue-900">{zeilen.length}</div>
        </div>
        <div
          className={`rounded-lg border p-3 ${
            aktuellerSaldo > 0
              ? 'bg-amber-100 border-amber-300 text-amber-900'
              : aktuellerSaldo < 0
                ? 'bg-red-100 border-red-300 text-red-900'
                : 'bg-gray-50 border-gray-200 text-gray-700'
          }`}
        >
          <div className="text-xs opacity-70 mb-0.5">Aktueller Saldo</div>
          <div className="text-lg font-bold">{eur(aktuellerSaldo)}</div>
        </div>
      </div>

      <div className="text-xs text-gray-500 italic">
        Lohnkonto-Buchungen werden nicht an das Lohnbüro übermittelt. Positiver Saldo
        = Guthaben des Mitarbeiters, das in Folgemonaten verrechnet werden kann.
      </div>

      {/* Neuanlage */}
      <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 space-y-3">
        <h4 className="text-sm font-semibold text-gray-800">Neue Buchung erfassen</h4>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div>
            <label className="block text-xs text-gray-600 mb-1">Art</label>
            <select
              value={neuArt}
              onChange={(e) => setNeuArt(e.target.value as 'verschiebung' | 'verrechnung')}
              className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm"
            >
              <option value="verschiebung">→ Lohnkonto (zurücklegen)</option>
              <option value="verrechnung">← Lohnkonto (gutschreiben)</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-600 mb-1">Betrag (€) *</label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={neuBetrag}
              onChange={(e) => setNeuBetrag(e.target.value)}
              placeholder="0,00"
              className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-600 mb-1">Wirksam in Periode</label>
            <select
              value={neuPeriodeId || defaultPeriodeId}
              onChange={(e) => setNeuPeriodeId(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm"
            >
              {periodenSorted.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.bezeichnung} {p.status === 'abgeschlossen' ? '🔒' : ''}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-600 mb-1">Kommentar (optional)</label>
            <input
              type="text"
              value={neuKommentar}
              onChange={(e) => setNeuKommentar(e.target.value)}
              placeholder="z. B. Korrektur Vormonat"
              className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm"
            />
          </div>
        </div>
        {error && <p className="text-xs text-red-600">{error}</p>}
        <div className="flex justify-end">
          <button
            type="button"
            onClick={handleNeu}
            disabled={saving}
            className="bg-blue-600 text-white px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? '…' : 'Buchung speichern'}
          </button>
        </div>
      </div>

      {/* Verlauf */}
      {zeilen.length === 0 ? (
        <div className="rounded-lg border border-gray-200 bg-gray-50 py-10 text-center text-sm text-gray-500">
          Keine Lohnkonto-Buchungen für diesen Mitarbeiter vorhanden.
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-gray-200">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200 text-gray-600 text-xs">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Periode</th>
                <th className="px-3 py-2 text-left font-medium">Art</th>
                <th className="px-3 py-2 text-right font-medium">Betrag</th>
                <th className="px-3 py-2 text-right font-medium">Saldo</th>
                <th className="px-3 py-2 text-left font-medium">Kommentar</th>
                <th className="px-3 py-2 text-right font-medium">Datum</th>
                <th className="px-3 py-2 text-right font-medium">Aktion</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {zeilen.map(({ buchung, periode, saldoNach }) => (
                <tr key={buchung.id} className="hover:bg-gray-50">
                  <td className="px-3 py-2 font-medium text-gray-800">
                    {periode?.bezeichnung ?? <span className="text-gray-400 italic">—</span>}
                  </td>
                  <td className="px-3 py-2">
                    {buchung.art === 'verschiebung' ? (
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs bg-amber-100 text-amber-800 border border-amber-200">
                        → Lohnkonto
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs bg-green-100 text-green-800 border border-green-200">
                        ← gutschreiben
                      </span>
                    )}
                  </td>
                  <td className={`px-3 py-2 text-right font-semibold ${
                    buchung.art === 'verschiebung' ? 'text-amber-700' : 'text-green-700'
                  }`}>
                    {buchung.art === 'verschiebung' ? '−' : '+'}{eur(buchung.betragEur)}
                  </td>
                  <td className={`px-3 py-2 text-right font-medium ${
                    saldoNach > 0 ? 'text-amber-800' : saldoNach < 0 ? 'text-red-700' : 'text-gray-600'
                  }`}>{eur(saldoNach)}</td>
                  <td className="px-3 py-2 text-gray-600">
                    {buchung.kommentar ?? <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-3 py-2 text-right text-xs text-gray-500">
                    {new Date(buchung.erstelltAm).toLocaleDateString('de-DE')}
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => handleKommentarBearbeiten(buchung.id, buchung.kommentar)}
                      className="text-xs text-blue-600 hover:text-blue-800 mr-2"
                      title="Kommentar bearbeiten"
                    >
                      ✎
                    </button>
                    <button
                      type="button"
                      onClick={() => handleLoeschen(buchung.id)}
                      className="text-xs text-red-500 hover:text-red-700"
                      title="Buchung löschen"
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ============================================================
// Reiter „Teilgebiet-Boni" — Sondervereinbarungen pro MA+TG
// ============================================================

function SondervereinbarungenReiter({
  mitarbeiter,
  teilgebiete,
  isAdmin,
  onCountChange,
}: {
  mitarbeiter: Mitarbeiter | null;
  teilgebiete: Teilgebiet[];
  isAdmin: boolean;
  onCountChange: (n: number) => void;
}) {
  const [eintraege, setEintraege] = useState<Sondervereinbarung[]>([]);
  const [neuTgId, setNeuTgId] = useState('');
  const [neuBetrag, setNeuBetrag] = useState('');
  const [neuBegruendung, setNeuBegruendung] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [editId, setEditId] = useState<string | null>(null);
  const [editBetrag, setEditBetrag] = useState('');
  const [editBegruendung, setEditBegruendung] = useState('');

  // Listener: alle Sondervereinbarungen, lokal auf den MA filtern.
  useEffect(() => {
    if (!mitarbeiter) {
      onCountChange(0);
      return;
    }
    const unsub = sondervereinbarungenListener((list) => {
      const eigene = list.filter((s) => s.mitarbeiterId === mitarbeiter.id);
      setEintraege(eigene);
      onCountChange(eigene.length);
    });
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mitarbeiter?.id]);

  if (!mitarbeiter) {
    return (
      <div className="border border-gray-200 rounded-lg p-6 text-center text-gray-400 text-sm">
        Bitte zuerst den Mitarbeiter speichern — danach können Teilgebiet-Boni
        (Sondervereinbarungen) hinzugefügt werden.
      </div>
    );
  }

  const tgMap = new Map(teilgebiete.map((t) => [t.id, t]));
  const sortiert = [...eintraege].sort((a, b) => {
    const na = tgMap.get(a.teilgebietId)?.name ?? '';
    const nb = tgMap.get(b.teilgebietId)?.name ?? '';
    return na.localeCompare(nb, 'de', { numeric: true });
  });

  async function handleNeu() {
    setError('');
    if (!neuTgId) { setError('Bitte ein Teilgebiet wählen.'); return; }
    const betrag = parseFloat(neuBetrag.replace(',', '.'));
    if (!Number.isFinite(betrag) || betrag <= 0) {
      setError('Betrag muss > 0 sein.');
      return;
    }
    setSaving(true);
    try {
      await erstelleSondervereinbarung({
        mitarbeiterId: mitarbeiter!.id,
        teilgebietId: neuTgId,
        betragEur: betrag,
        begruendung: neuBegruendung.trim(),
      });
      setNeuTgId('');
      setNeuBetrag('');
      setNeuBegruendung('');
    } catch (e) {
      console.error(e);
      setError('Fehler beim Speichern.');
    } finally {
      setSaving(false);
    }
  }

  function startEdit(s: Sondervereinbarung) {
    setEditId(s.id);
    setEditBetrag(s.betragEur.toString());
    setEditBegruendung(s.begruendung ?? '');
  }

  async function handleEditSpeichern(s: Sondervereinbarung) {
    const betrag = parseFloat(editBetrag.replace(',', '.'));
    if (!Number.isFinite(betrag) || betrag <= 0) {
      alert('Betrag muss > 0 sein.');
      return;
    }
    await aktualisiereSondervereinbarung(s.id, {
      betragEur: betrag,
      begruendung: editBegruendung.trim(),
    });
    setEditId(null);
  }

  async function handleLoeschen(s: Sondervereinbarung) {
    const tg = tgMap.get(s.teilgebietId);
    if (!confirm(`Sondervereinbarung für „${tg?.name ?? s.teilgebietId}" wirklich löschen?`)) return;
    await loescheSondervereinbarung(s.id);
  }

  const verfuegbareTg = teilgebiete
    .filter((tg) => !eintraege.some((e) => e.teilgebietId === tg.id))
    .sort((a, b) => a.name.localeCompare(b.name, 'de', { numeric: true }));

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-500">
        Sondervereinbarung pro Teilgebiet: zusätzlicher Betrag je verteilter
        Ausgabe, wenn dieser Mitarbeiter als <strong>Standardausträger</strong>
        eingesetzt wird. Wirkt sich direkt in der Abrechnung aus.
      </p>

      {sortiert.length === 0 ? (
        <div className="border border-gray-200 rounded-lg p-6 text-center text-gray-400 text-sm">
          Keine Sondervereinbarungen hinterlegt
        </div>
      ) : (
        <div className="border border-gray-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200 text-gray-600 text-xs">
              <tr>
                <th className="text-left px-3 py-2 font-medium">Teilgebiet</th>
                <th className="text-right px-3 py-2 font-medium">Bonus je Ausgabe</th>
                <th className="text-left px-3 py-2 font-medium">Begründung</th>
                <th className="text-right px-3 py-2 font-medium w-24">Aktion</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {sortiert.map((s) => {
                const tg = tgMap.get(s.teilgebietId);
                const isEditing = editId === s.id;
                return (
                  <tr key={s.id} className="hover:bg-gray-50">
                    <td className="px-3 py-2 font-medium text-gray-800">
                      {tg?.name ?? s.teilgebietId}
                      {tg?.plz && <span className="ml-1 text-xs text-gray-400">({tg.plz})</span>}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {isEditing ? (
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={editBetrag}
                          onChange={(e) => setEditBetrag(e.target.value)}
                          onWheel={(e) => (e.currentTarget as HTMLInputElement).blur()}
                          className="w-20 border border-gray-300 rounded px-2 py-1 text-sm text-right"
                        />
                      ) : (
                        <span className="text-green-700 font-medium">
                          + {s.betragEur.toFixed(2)} €
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-gray-600">
                      {isEditing ? (
                        <input
                          type="text"
                          value={editBegruendung}
                          onChange={(e) => setEditBegruendung(e.target.value)}
                          placeholder="Begründung"
                          className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
                        />
                      ) : (
                        s.begruendung || <span className="text-gray-300">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      {isAdmin ? (
                        isEditing ? (
                          <>
                            <button
                              type="button"
                              onClick={() => handleEditSpeichern(s)}
                              className="text-green-600 hover:text-green-800 text-xs mr-2"
                            >
                              ✓
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditId(null)}
                              className="text-gray-400 hover:text-gray-600 text-xs"
                            >
                              ✕
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={() => startEdit(s)}
                              className="text-blue-500 hover:text-blue-700 text-xs mr-2"
                              title="Betrag/Begründung bearbeiten"
                            >
                              ✎
                            </button>
                            <button
                              type="button"
                              onClick={() => handleLoeschen(s)}
                              className="text-red-400 hover:text-red-600 text-xs"
                              title="Sondervereinbarung löschen"
                            >
                              ✕
                            </button>
                          </>
                        )
                      ) : (
                        <span className="text-gray-300 text-xs">read-only</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Neue Sondervereinbarung — nur Admin */}
      {isAdmin && (
        <div className="border border-dashed border-gray-300 rounded-lg p-3">
          <p className="text-xs font-medium text-gray-500 mb-2">Sondervereinbarung hinzufügen</p>
          <div className="grid grid-cols-1 md:grid-cols-12 gap-2">
            <div className="md:col-span-5">
              <label className="block text-xs text-gray-500 mb-1">Teilgebiet</label>
              <select
                value={neuTgId}
                onChange={(e) => setNeuTgId(e.target.value)}
                className="border border-gray-300 rounded px-2 py-1.5 text-sm w-full focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                <option value="">— Teilgebiet wählen —</option>
                {verfuegbareTg.map((tg) => (
                  <option key={tg.id} value={tg.id}>
                    {tg.name}{tg.plz ? ` (${tg.plz})` : ''}
                  </option>
                ))}
              </select>
            </div>
            <div className="md:col-span-2">
              <label className="block text-xs text-gray-500 mb-1">Betrag (€)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={neuBetrag}
                onChange={(e) => setNeuBetrag(e.target.value)}
                onWheel={(e) => (e.currentTarget as HTMLInputElement).blur()}
                placeholder="0.00"
                className="border border-gray-300 rounded px-2 py-1.5 text-sm w-full text-right focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div className="md:col-span-4">
              <label className="block text-xs text-gray-500 mb-1">Begründung (optional)</label>
              <input
                type="text"
                value={neuBegruendung}
                onChange={(e) => setNeuBegruendung(e.target.value)}
                placeholder="z. B. Mehrfamilienhaus mit hoher Stueckzahl"
                className="border border-gray-300 rounded px-2 py-1.5 text-sm w-full focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div className="md:col-span-1 flex items-end">
              <button
                type="button"
                onClick={handleNeu}
                disabled={!neuTgId || !neuBetrag || saving}
                className="bg-blue-600 text-white px-3 py-1.5 rounded text-sm font-medium hover:bg-blue-700 disabled:opacity-40 w-full"
              >
                {saving ? '…' : '+'}
              </button>
            </div>
          </div>
          {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
        </div>
      )}
    </div>
  );
}

// ============================================================
// Verdienstbescheinigung-Tab (Admin-only, nur bei istMinijob)
// ============================================================

const MONATSNAMEN_KURZ = [
  'Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun',
  'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez',
];

interface MonatsZeile {
  jahr: number;
  monat: number;
  lbAbrechnung: LohnbueroAbrechnung | null;
  gespeichert: VerdienstbescheinigungWert | null;
  bruttoEditEur: string;       // String, damit Leer-Eingabe = kein Override
  ueberprueftEdit: boolean;
}

function monatsBereich(vonJahr: number, vonMonat: number, bisJahr: number, bisMonat: number): Array<{ jahr: number; monat: number }> {
  const liste: Array<{ jahr: number; monat: number }> = [];
  const startKey = vonJahr * 12 + (vonMonat - 1);
  const endKey = bisJahr * 12 + (bisMonat - 1);
  if (endKey < startKey) return liste;
  for (let k = startKey; k <= endKey; k++) {
    liste.push({ jahr: Math.floor(k / 12), monat: (k % 12) + 1 });
  }
  return liste;
}

// Hardcodierte Standardfragen mit (MA-abhängiger) Vorbelegung + Hinweis.
// `defaultFn` liefert 'ja'/'nein' wenn eine sinnvolle Vorbelegung möglich ist,
// sonst null — dann wird der Nutzer gezwungen, aktiv zu wählen.
// `hinweisFn` darf null liefern, wenn der Hinweis kontextabhängig entfällt.
// `zusatzWennJa`/`zusatzWennNein` werden ggf. auf der gedruckten Bescheinigung
// als weitere Textzeile unter die Antwort gesetzt.
type StandardFrageDef = {
  id: string;
  fragetext: string;
  defaultFn: (ma: Mitarbeiter) => 'ja' | 'nein' | null;
  hinweisFn?: (ma: Mitarbeiter) => string | null;
  zusatzWennJa?: string;
  zusatzWennNein?: string;
};

const STANDARD_FRAGEN: StandardFrageDef[] = [
  {
    id: 'std-konstantes-einkommen',
    fragetext: 'Bleibt das oben bescheinigte Einkommen und die wöchentliche Arbeitszeit künftig konstant?',
    defaultFn: () => 'nein',
    hinweisFn: () => 'Standardannahme: Minijob-Verdienst schwankt monatlich (z. B. mit der Anzahl ausgetragener Ausgaben). Bei konstanter Vergütung manuell auf „Ja" setzen.',
  },
  {
    id: 'std-familienangehoerige',
    fragetext: 'Ist die Leistungsbezieherin / der Leistungsbezieher mithelfende/r Familienangehörige/r?',
    defaultFn: () => 'nein',
    hinweisFn: () => 'Standardannahme bei Minijob-Mitarbeitern ohne familiäre Bindung an die Geschäftsführung.',
  },
  {
    id: 'std-ehrenamtlich',
    fragetext: 'Handelt es sich um eine ehrenamtliche Tätigkeit?',
    defaultFn: () => 'nein',
    hinweisFn: () => 'Standardannahme: Schlieper-Druck zahlt Lohn — also keine ehrenamtliche Tätigkeit.',
  },
  {
    id: 'std-kv-pv-pflicht',
    fragetext: 'Der Arbeitnehmer entrichtet Pflichtbeiträge zur gesetzlichen Kranken-/Pflegeversicherung.',
    defaultFn: (ma) => (ma.istMinijob ? 'nein' : null),
    hinweisFn: (ma) => (ma.istMinijob
      ? 'Vorbelegt mit „Nein", weil der Mitarbeiter als Minijobber bei Schlieper-Druck keine eigenen KV-/PV-Pflichtbeiträge entrichtet (Arbeitgeber zahlt Pauschalbeiträge).'
      : null),
  },
  {
    id: 'std-rv-pflicht',
    fragetext: 'Der Arbeitnehmer entrichtet Pflichtbeiträge zur gesetzlichen Rentenversicherung.',
    defaultFn: (ma) => (ma.istMinijob && ma.sozialversicherungsBefreit ? 'nein' : null),
    hinweisFn: (ma) => (ma.istMinijob && ma.sozialversicherungsBefreit
      ? 'Vorbelegt mit „Nein": Minijob + Befreiung von der Rentenversicherungspflicht liegt vor.'
      : ma.istMinijob
        ? null
        : null),
  },
  {
    id: 'std-lohnsteuer',
    fragetext: 'Der Arbeitnehmer entrichtet Steuern vom Einkommen.',
    defaultFn: (ma) => (ma.istMinijob ? 'nein' : null),
    hinweisFn: (ma) => (ma.istMinijob
      ? 'Vorbelegt mit „Nein": Schlieper-Druck wendet bei Minijobs die 2 %-Pauschalversteuerung durch den Arbeitgeber an — der Mitarbeiter zahlt keine Lohnsteuer.'
      : null),
  },
  {
    id: 'std-sonderzahlungen',
    fragetext: 'Sind im Lohn Sonderzahlungen enthalten (Urlaubsgeld, Weihnachtsgeld u. ä.)?',
    defaultFn: () => 'nein',
    hinweisFn: () => 'Mit „Nein" abgedeckt sind außerdem: 13. Monatsgehalt, Jahres-, Erfolgs-, Gewinn-, Leistungs-, Treue-, Anwesenheits- und Inflationsausgleichsprämien, einmalige Bonuszahlungen, Jubiläumszuwendungen, Tantiemen, Provisionen.',
  },
  {
    id: 'std-fahrtkosten',
    fragetext: 'Wurden Fahrtkosten erstattet?',
    defaultFn: () => null,    // bewusst keine Vorbelegung — muss aktiv beantwortet werden
    zusatzWennJa: 'Erstattete Fahrtkosten sind in den monatlichen Lohnabrechnungen separat ausgewiesen.',
  },
];

export type FrageMitAntwort = {
  id: string;
  fragetext: string;
  antwortTyp: 'jaNein' | 'betrag' | 'text';
  antwort: string;       // 'ja'/'nein' bei jaNein; freier Text/Betrag sonst; '' = nicht beantwortet
  zusatzText?: string;   // wird im Druck unter die Antwort gesetzt (z. B. Q5-Ja-Hinweis)
};

/** Berechnet die Default-Antworten aller Standardfragen für einen MA. */
function berechneStandardDefaults(ma: Mitarbeiter): Record<string, string> {
  const out: Record<string, string> = {};
  for (const def of STANDARD_FRAGEN) {
    const d = def.defaultFn(ma);
    out[def.id] = d ?? '';
  }
  return out;
}

const STANDARD_FRAGEN_IDS = new Set(STANDARD_FRAGEN.map((f) => f.id));
/** Filter: nur Zusatz-Frage-IDs aus einer Antworten-Map behalten. */
function zusatzKeysAus(map: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(map)) {
    if (!STANDARD_FRAGEN_IDS.has(k)) out[k] = v;
  }
  return out;
}

function VerdienstbescheinigungTab({
  mitarbeiter,
  adminName,
  lohnbueroAbrechnungen,
  lohnbueroDriveLinks,
  fragenKatalog,
}: {
  mitarbeiter: Mitarbeiter;
  adminName: string;
  lohnbueroAbrechnungen: LohnbueroAbrechnung[];
  lohnbueroDriveLinks: LohnbueroDriveLink[];
  fragenKatalog: VerdienstbescheinigungFrage[];
}) {
  const heute = new Date();
  // Default-Bereich: letzte 12 Monate (heute-1Jahr bis heute).
  const vorigesJahr = new Date(heute.getFullYear(), heute.getMonth() - 11, 1);
  const [vonJahr, setVonJahr] = useState<number>(vorigesJahr.getFullYear());
  const [vonMonat, setVonMonat] = useState<number>(vorigesJahr.getMonth() + 1);
  const [bisJahr, setBisJahr] = useState<number>(heute.getFullYear());
  const [bisMonat, setBisMonat] = useState<number>(heute.getMonth() + 1);

  // Freier Text. Vorbelegt je nach Rolle des MA; bei Bedarf überschreibbar
  // (z. B. „Bürokraft", „Maschinenführer"). Die beiden Default-Werte sind
  // als Datalist-Vorschläge eingebunden.
  const defaultTaetigkeitText = mitarbeiter.rollen.includes('austräger')
    ? 'Austräger Anzeigenblattes'
    : 'Aushilfe in der Produktion';
  const [taetigkeit, setTaetigkeit] = useState<string>(defaultTaetigkeitText);

  const [werteMap, setWerteMap] = useState<Map<string, VerdienstbescheinigungWert>>(new Map());
  const [bruttoInputs, setBruttoInputs] = useState<Map<string, string>>(new Map());
  const [ueberprueftInputs, setUeberprueftInputs] = useState<Map<string, boolean>>(new Map());
  const [ladeStatus, setLadeStatus] = useState<'init' | 'laden' | 'ok' | 'fehler'>('init');
  const [saving, setSaving] = useState(false);
  const [druckOffen, setDruckOffen] = useState(false);

  // Antworten auf alle Fragen (Standardfragen + Zusatzfragen aus dem Katalog).
  // Wert ist immer ein String:
  //   - 'ja' / 'nein' bei Ja/Nein-Fragen
  //   - '' = nicht beantwortet (Nutzer muss aktiv wählen)
  //   - Freitext / Betrag-String bei text- bzw. betrag-Fragen
  // Vorbelegung erfolgt aus `STANDARD_FRAGEN[*].defaultFn(ma)` bzw. der
  // `standardAntwort` der Zusatzfrage; null/leer = keine Vorbelegung.
  const [antworten, setAntworten] = useState<Record<string, string>>(() =>
    berechneStandardDefaults(mitarbeiter)
  );

  // Re-Init der Standard-Defaults bei MA-Wechsel oder bei Änderung der
  // entscheidungsrelevanten MA-Flags (Minijob / SV-Befreiung).
  useEffect(() => {
    setAntworten((prev) => ({ ...berechneStandardDefaults(mitarbeiter), ...zusatzKeysAus(prev) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mitarbeiter.id, mitarbeiter.istMinijob, mitarbeiter.sozialversicherungsBefreit]);

  // Anmerkung + internes Memo — werden aus MA geladen und beim Druck-Klick
  // (bzw. dem Speichern-Button) zurückgeschrieben.
  const [anmerkungDruckEdit, setAnmerkungDruckEdit] = useState(mitarbeiter.verdienstbescheinigungAnmerkung ?? '');
  const [internesMemoEdit, setInternesMemoEdit] = useState(mitarbeiter.verdienstbescheinigungInternesMemo ?? '');

  // Arbeitsamt-Kontaktdaten + Kennzeichen.
  const [arbeitsamtKontaktEdit, setArbeitsamtKontaktEdit] = useState(() => ({
    name: mitarbeiter.arbeitsamtKontakt?.name ?? '',
    telefon: mitarbeiter.arbeitsamtKontakt?.telefon ?? '',
    email: mitarbeiter.arbeitsamtKontakt?.email ?? '',
    strasse: mitarbeiter.arbeitsamtKontakt?.strasse ?? '',
    plz: mitarbeiter.arbeitsamtKontakt?.plz ?? '',
    ort: mitarbeiter.arbeitsamtKontakt?.ort ?? '',
  }));
  const [arbeitsamtKundennummerEdit, setArbeitsamtKundennummerEdit] = useState(mitarbeiter.arbeitsamtKundennummer ?? '');
  const [arbeitsamtKundennummerDruckenEdit, setArbeitsamtKundennummerDruckenEdit] = useState(!!mitarbeiter.arbeitsamtKundennummerDrucken);
  const [arbeitsamtZeichenEdit, setArbeitsamtZeichenEdit] = useState(mitarbeiter.arbeitsamtZeichen ?? '');
  const [arbeitsamtZeichenDruckenEdit, setArbeitsamtZeichenDruckenEdit] = useState(!!mitarbeiter.arbeitsamtZeichenDrucken);
  const [adresskopfModeEdit, setAdresskopfModeEdit] = useState<'arbeitsamt' | 'eigene' | 'keine'>(() => {
    if (mitarbeiter.verdienstbescheinigungAdresskopfMode) return mitarbeiter.verdienstbescheinigungAdresskopfMode;
    return mitarbeiter.arbeitsamtKontakt?.name ? 'arbeitsamt' : 'keine';
  });
  const [adresskopfEigeneEdit, setAdresskopfEigeneEdit] = useState(() => ({
    name: mitarbeiter.verdienstbescheinigungAdresskopfEigene?.name ?? '',
    strasse: mitarbeiter.verdienstbescheinigungAdresskopfEigene?.strasse ?? '',
    plz: mitarbeiter.verdienstbescheinigungAdresskopfEigene?.plz ?? '',
    ort: mitarbeiter.verdienstbescheinigungAdresskopfEigene?.ort ?? '',
  }));

  // Inline-Formular „neue Frage anlegen".
  const [neueFrageOpen, setNeueFrageOpen] = useState(false);
  const [neueFrageText, setNeueFrageText] = useState('');
  const [neueFrageTyp, setNeueFrageTyp] = useState<VerdienstbescheinigungAntwortTyp>('jaNein');
  const [neueFrageStandard, setNeueFrageStandard] = useState('');
  const [neueFrageHinweis, setNeueFrageHinweis] = useState('');
  const [neueFrageSaving, setNeueFrageSaving] = useState(false);

  // Nach MA-Wechsel: Anmerkung/Memo neu laden.
  useEffect(() => {
    setAnmerkungDruckEdit(mitarbeiter.verdienstbescheinigungAnmerkung ?? '');
    setInternesMemoEdit(mitarbeiter.verdienstbescheinigungInternesMemo ?? '');
  }, [mitarbeiter.id, mitarbeiter.verdienstbescheinigungAnmerkung, mitarbeiter.verdienstbescheinigungInternesMemo]);

  // Nach MA-Wechsel: alle Arbeitsamt-Felder neu laden.
  useEffect(() => {
    setArbeitsamtKontaktEdit({
      name: mitarbeiter.arbeitsamtKontakt?.name ?? '',
      telefon: mitarbeiter.arbeitsamtKontakt?.telefon ?? '',
      email: mitarbeiter.arbeitsamtKontakt?.email ?? '',
      strasse: mitarbeiter.arbeitsamtKontakt?.strasse ?? '',
      plz: mitarbeiter.arbeitsamtKontakt?.plz ?? '',
      ort: mitarbeiter.arbeitsamtKontakt?.ort ?? '',
    });
    setArbeitsamtKundennummerEdit(mitarbeiter.arbeitsamtKundennummer ?? '');
    setArbeitsamtKundennummerDruckenEdit(!!mitarbeiter.arbeitsamtKundennummerDrucken);
    setArbeitsamtZeichenEdit(mitarbeiter.arbeitsamtZeichen ?? '');
    setArbeitsamtZeichenDruckenEdit(!!mitarbeiter.arbeitsamtZeichenDrucken);
    setAdresskopfModeEdit(
      mitarbeiter.verdienstbescheinigungAdresskopfMode ??
      (mitarbeiter.arbeitsamtKontakt?.name ? 'arbeitsamt' : 'keine')
    );
    setAdresskopfEigeneEdit({
      name: mitarbeiter.verdienstbescheinigungAdresskopfEigene?.name ?? '',
      strasse: mitarbeiter.verdienstbescheinigungAdresskopfEigene?.strasse ?? '',
      plz: mitarbeiter.verdienstbescheinigungAdresskopfEigene?.plz ?? '',
      ort: mitarbeiter.verdienstbescheinigungAdresskopfEigene?.ort ?? '',
    });
  }, [mitarbeiter.id]);

  // Bei neuen Zusatzfragen: Vorbelegung aus `standardAntwort` übernehmen
  // (leer = bewusst keine Vorbelegung; Nutzer muss aktiv wählen).
  useEffect(() => {
    setAntworten((prev) => {
      const next: Record<string, string> = { ...prev };
      let changed = false;
      for (const f of fragenKatalog) {
        if (f.archiviert) continue;
        if (next[f.id] == null) {
          next[f.id] = f.standardAntwort ?? '';
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [fragenKatalog]);

  // Persistente Werte einmalig laden (pro MA-Wechsel).
  useEffect(() => {
    let abgebrochen = false;
    setLadeStatus('laden');
    ladeVerdienstbescheinigungWerte(mitarbeiter.id)
      .then((werte) => {
        if (abgebrochen) return;
        const m = new Map<string, VerdienstbescheinigungWert>();
        for (const w of werte) m.set(`${w.jahr}-${w.monat}`, w);
        setWerteMap(m);
        setBruttoInputs(new Map());
        setUeberprueftInputs(new Map());
        setLadeStatus('ok');
      })
      .catch(() => {
        if (abgebrochen) return;
        setLadeStatus('fehler');
      });
    return () => { abgebrochen = true; };
  }, [mitarbeiter.id]);

  // Abrechnungen je (Jahr, Monat) für DIESEN MA — sorgt für die LB-Brutto Anzeige.
  // Nimmt jeweils die NICHT-Korrektur-Variante mit der höchsten Brutto (defensiver
  // Default: falls mehrere PDFs für dieselbe Periode liegen).
  const lbMap = (() => {
    const map = new Map<string, LohnbueroAbrechnung>();
    for (const e of lohnbueroAbrechnungen) {
      if (e.mitarbeiterId !== mitarbeiter.id) continue;
      const key = `${e.jahr}-${e.monat}`;
      const bestehend = map.get(key);
      if (!bestehend) {
        map.set(key, e);
      } else {
        // Bevorzuge Original ggü. Korrektur; ansonsten die jüngste indizierte.
        if (bestehend.istKorrektur && !e.istKorrektur) map.set(key, e);
        else if (bestehend.istKorrektur === e.istKorrektur && e.indiziertAm > bestehend.indiziertAm) {
          map.set(key, e);
        }
      }
    }
    return map;
  })();

  // Drive-Link je (Jahr, Monat) — Fallback auf Jahres-Link.
  const driveLinkFuer = (jahr: number, monat: number): string | null => {
    const monatsLink = lohnbueroDriveLinks.find((l) => l.jahr === jahr && l.monat === monat);
    if (monatsLink) return monatsLink.url;
    const jahresLink = lohnbueroDriveLinks.find((l) => l.jahr === jahr && l.monat == null);
    return jahresLink ? jahresLink.url : null;
  };

  const zeilen: MonatsZeile[] = monatsBereich(vonJahr, vonMonat, bisJahr, bisMonat).map((m) => {
    const key = `${m.jahr}-${m.monat}`;
    const lb = lbMap.get(key) ?? null;
    const gespeichert = werteMap.get(key) ?? null;
    const bruttoEditEur =
      bruttoInputs.get(key) ??
      (gespeichert?.bruttoManuell != null
        ? gespeichert.bruttoManuell.toFixed(2).replace('.', ',')
        : '');
    const ueberprueftEdit = ueberprueftInputs.get(key) ?? (gespeichert?.ueberprueft ?? false);
    return { jahr: m.jahr, monat: m.monat, lbAbrechnung: lb, gespeichert, bruttoEditEur, ueberprueftEdit };
  });

  // Eingaben → effektiver Brutto-Wert je Zeile.
  function effektivesBrutto(z: MonatsZeile): number | null {
    const eingabe = z.bruttoEditEur.trim();
    if (eingabe) {
      const num = parseFloat(eingabe.replace(',', '.'));
      return Number.isFinite(num) ? num : null;
    }
    return z.lbAbrechnung ? z.lbAbrechnung.gesamtBrutto : null;
  }

  // Welche Zeilen sind „dirty" (von gespeichertem Zustand abweichend)?
  function istDirty(z: MonatsZeile): boolean {
    const key = `${z.jahr}-${z.monat}`;
    const bruttoEingabeRoh = bruttoInputs.get(key);
    const ueberprueftEingabeRoh = ueberprueftInputs.get(key);
    if (bruttoEingabeRoh == null && ueberprueftEingabeRoh == null) return false;
    return true;
  }

  // Pflicht-Daten prüfen (für „Bescheinigung drucken"-Knopf).
  function pflichtFehlend(): string[] {
    const fehlend: string[] = [];
    if (!mitarbeiter.sozialversicherungsNummer?.trim()) fehlend.push('Sozialversicherungsnummer');
    if (!mitarbeiter.geburtsdatum) fehlend.push('Geburtsdatum');
    if (!mitarbeiter.adresse?.strasse?.trim()) fehlend.push('Straße');
    if (!mitarbeiter.adresse?.plz?.trim() || !mitarbeiter.adresse?.ort?.trim()) fehlend.push('PLZ/Ort');
    if (!mitarbeiter.startDatum) fehlend.push('Startdatum (Reiter Anmeldung)');
    return fehlend;
  }

  const ungepruefteMonate = zeilen.filter((z) => !z.ueberprueftEdit).map((z) => `${MONATSNAMEN_KURZ[z.monat - 1]} ${z.jahr}`);
  const monateOhneLB = zeilen.filter((z) => !z.lbAbrechnung && !z.bruttoEditEur.trim() && !(z.gespeichert?.bruttoManuell != null)).map((z) => `${MONATSNAMEN_KURZ[z.monat - 1]} ${z.jahr}`);
  const fehlend = pflichtFehlend();
  const druckBereit = fehlend.length === 0 && ungepruefteMonate.length === 0 && monateOhneLB.length === 0 && zeilen.length > 0;

  // Summe / Durchschnitt
  const summe = zeilen.reduce((acc, z) => acc + (effektivesBrutto(z) ?? 0), 0);
  const durchschnitt = zeilen.length > 0 ? summe / zeilen.length : 0;

  function setBruttoInput(key: string, value: string) {
    setBruttoInputs((prev) => {
      const next = new Map(prev);
      next.set(key, value);
      return next;
    });
  }
  function setUeberprueftInput(key: string, value: boolean) {
    setUeberprueftInputs((prev) => {
      const next = new Map(prev);
      next.set(key, value);
      return next;
    });
  }

  const anmerkungDirty = (anmerkungDruckEdit || '') !== (mitarbeiter.verdienstbescheinigungAnmerkung ?? '');
  const memoDirty = (internesMemoEdit || '') !== (mitarbeiter.verdienstbescheinigungInternesMemo ?? '');

  // Dirty-Flag für die ganze Arbeitsamt-Section (Kontakt + Kennzeichen + Adresskopf-Mode).
  const arbeitsamtDirty = (() => {
    const k = mitarbeiter.arbeitsamtKontakt ?? {};
    const e = mitarbeiter.verdienstbescheinigungAdresskopfEigene ?? {};
    if ((arbeitsamtKontaktEdit.name || '') !== (k.name ?? '')) return true;
    if ((arbeitsamtKontaktEdit.telefon || '') !== (k.telefon ?? '')) return true;
    if ((arbeitsamtKontaktEdit.email || '') !== (k.email ?? '')) return true;
    if ((arbeitsamtKontaktEdit.strasse || '') !== (k.strasse ?? '')) return true;
    if ((arbeitsamtKontaktEdit.plz || '') !== (k.plz ?? '')) return true;
    if ((arbeitsamtKontaktEdit.ort || '') !== (k.ort ?? '')) return true;
    if ((arbeitsamtKundennummerEdit || '') !== (mitarbeiter.arbeitsamtKundennummer ?? '')) return true;
    if (arbeitsamtKundennummerDruckenEdit !== !!mitarbeiter.arbeitsamtKundennummerDrucken) return true;
    if ((arbeitsamtZeichenEdit || '') !== (mitarbeiter.arbeitsamtZeichen ?? '')) return true;
    if (arbeitsamtZeichenDruckenEdit !== !!mitarbeiter.arbeitsamtZeichenDrucken) return true;
    const aktuellerModus = mitarbeiter.verdienstbescheinigungAdresskopfMode ??
      (mitarbeiter.arbeitsamtKontakt?.name ? 'arbeitsamt' : 'keine');
    if (adresskopfModeEdit !== aktuellerModus) return true;
    if ((adresskopfEigeneEdit.name || '') !== (e.name ?? '')) return true;
    if ((adresskopfEigeneEdit.strasse || '') !== (e.strasse ?? '')) return true;
    if ((adresskopfEigeneEdit.plz || '') !== (e.plz ?? '')) return true;
    if ((adresskopfEigeneEdit.ort || '') !== (e.ort ?? '')) return true;
    return false;
  })();

  async function speichereDirty() {
    setSaving(true);
    try {
      for (const z of zeilen) {
        if (!istDirty(z)) continue;
        const bruttoStr = z.bruttoEditEur.trim();
        const bruttoNum = bruttoStr ? parseFloat(bruttoStr.replace(',', '.')) : undefined;
        const bruttoManuell = bruttoNum != null && Number.isFinite(bruttoNum) ? bruttoNum : undefined;
        await setzeVerdienstbescheinigungWert(
          mitarbeiter.id,
          z.jahr,
          z.monat,
          { bruttoManuell, ueberprueft: z.ueberprueftEdit },
          adminName || 'Admin',
        );
      }
      // Anmerkung + internes Memo + Arbeitsamt-Daten persistieren, wenn geändert.
      if (anmerkungDirty || memoDirty || arbeitsamtDirty) {
        // Hilfsfunktion: Objekt nur dann setzen, wenn mindestens ein Feld
        // ausgefüllt ist; sonst undefined (Feld in Firestore löschen).
        const kontaktClean = {
          name: arbeitsamtKontaktEdit.name.trim() || undefined,
          telefon: arbeitsamtKontaktEdit.telefon.trim() || undefined,
          email: arbeitsamtKontaktEdit.email.trim() || undefined,
          strasse: arbeitsamtKontaktEdit.strasse.trim() || undefined,
          plz: arbeitsamtKontaktEdit.plz.trim() || undefined,
          ort: arbeitsamtKontaktEdit.ort.trim() || undefined,
        };
        const kontaktLeer = Object.values(kontaktClean).every((v) => v == null);
        const eigeneClean = {
          name: adresskopfEigeneEdit.name.trim() || undefined,
          strasse: adresskopfEigeneEdit.strasse.trim() || undefined,
          plz: adresskopfEigeneEdit.plz.trim() || undefined,
          ort: adresskopfEigeneEdit.ort.trim() || undefined,
        };
        const eigeneLeer = Object.values(eigeneClean).every((v) => v == null);
        await aktualisiereMitarbeiter(mitarbeiter.id, {
          verdienstbescheinigungAnmerkung: anmerkungDruckEdit.trim() || undefined,
          verdienstbescheinigungInternesMemo: internesMemoEdit.trim() || undefined,
          arbeitsamtKontakt: kontaktLeer ? undefined : kontaktClean,
          arbeitsamtKundennummer: arbeitsamtKundennummerEdit.trim() || undefined,
          arbeitsamtKundennummerDrucken: arbeitsamtKundennummerDruckenEdit || undefined,
          arbeitsamtZeichen: arbeitsamtZeichenEdit.trim() || undefined,
          arbeitsamtZeichenDrucken: arbeitsamtZeichenDruckenEdit || undefined,
          verdienstbescheinigungAdresskopfMode: adresskopfModeEdit,
          verdienstbescheinigungAdresskopfEigene: eigeneLeer ? undefined : eigeneClean,
        });
      }
      // Nach dem Speichern: neu laden, Eingabe-Caches leeren.
      const frisch = await ladeVerdienstbescheinigungWerte(mitarbeiter.id);
      const m = new Map<string, VerdienstbescheinigungWert>();
      for (const w of frisch) m.set(`${w.jahr}-${w.monat}`, w);
      setWerteMap(m);
      setBruttoInputs(new Map());
      setUeberprueftInputs(new Map());
    } finally {
      setSaving(false);
    }
  }

  async function druckenMitAutoSave() {
    if (dirtyAnzahl > 0 || anmerkungDirty || memoDirty || arbeitsamtDirty) {
      await speichereDirty();
    }
    setDruckOffen(true);
  }

  async function frageAnlegen() {
    if (!neueFrageText.trim()) return;
    setNeueFrageSaving(true);
    try {
      const maxSort = fragenKatalog.reduce((m, f) => Math.max(m, f.sortierung), 0);
      await erstelleVerdienstbescheinigungFrage(
        neueFrageText,
        neueFrageTyp,
        maxSort + 10,
        neueFrageStandard.trim() || undefined,
        neueFrageHinweis.trim() || undefined,
      );
      setNeueFrageText('');
      setNeueFrageTyp('jaNein');
      setNeueFrageStandard('');
      setNeueFrageHinweis('');
      setNeueFrageOpen(false);
    } finally {
      setNeueFrageSaving(false);
    }
  }

  async function frageLoeschen(frageId: string) {
    if (!confirm('Diese Zusatzfrage wirklich aus dem Katalog entfernen?\n\nSie verschwindet dann für ALLE Mitarbeiter — auf bereits gedruckten Bescheinigungen bleibt sie natürlich erhalten.')) return;
    await loescheVerdienstbescheinigungFrage(frageId);
  }

  const aktiveZusatzFragen = fragenKatalog.filter((f) => !f.archiviert);
  const dirtyAnzahl = zeilen.filter(istDirty).length;
  const aktuellesJahr = heute.getFullYear();
  const jahreAuswahl: number[] = [];
  for (let j = aktuellesJahr - 5; j <= aktuellesJahr + 1; j++) jahreAuswahl.push(j);

  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-blue-200 bg-blue-50/40 p-4 space-y-3">
        <h3 className="text-sm font-semibold text-gray-800">Bescheinigungs-Zeitraum</h3>
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="block text-xs text-gray-500 mb-0.5">Von</label>
            <div className="flex gap-1">
              <select
                value={vonMonat}
                onChange={(e) => setVonMonat(parseInt(e.target.value, 10))}
                className="border border-gray-300 rounded px-2 py-1.5 text-sm"
              >
                {MONATSNAMEN_KURZ.map((n, i) => (
                  <option key={i + 1} value={i + 1}>{n}</option>
                ))}
              </select>
              <select
                value={vonJahr}
                onChange={(e) => setVonJahr(parseInt(e.target.value, 10))}
                className="border border-gray-300 rounded px-2 py-1.5 text-sm"
              >
                {jahreAuswahl.map((j) => <option key={j} value={j}>{j}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-0.5">Bis</label>
            <div className="flex gap-1">
              <select
                value={bisMonat}
                onChange={(e) => setBisMonat(parseInt(e.target.value, 10))}
                className="border border-gray-300 rounded px-2 py-1.5 text-sm"
              >
                {MONATSNAMEN_KURZ.map((n, i) => (
                  <option key={i + 1} value={i + 1}>{n}</option>
                ))}
              </select>
              <select
                value={bisJahr}
                onChange={(e) => setBisJahr(parseInt(e.target.value, 10))}
                className="border border-gray-300 rounded px-2 py-1.5 text-sm"
              >
                {jahreAuswahl.map((j) => <option key={j} value={j}>{j}</option>)}
              </select>
            </div>
          </div>
          <div className="ml-auto">
            <label className="block text-xs text-gray-500 mb-0.5">Tätigkeit</label>
            <div className="flex gap-1.5 items-center">
              <input
                type="text"
                value={taetigkeit}
                onChange={(e) => setTaetigkeit(e.target.value)}
                placeholder="Tätigkeit eingeben…"
                className="border border-gray-300 rounded px-2 py-1.5 text-sm w-72"
              />
              {(['Austräger Anzeigenblattes', 'Aushilfe in der Produktion'] as const).map((preset) => {
                const aktiv = taetigkeit === preset;
                return (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setTaetigkeit(preset)}
                    className={`px-2 py-1.5 text-xs rounded border whitespace-nowrap ${
                      aktiv
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'bg-white text-gray-700 border-gray-300 hover:border-gray-400'
                    }`}
                    title={`Tätigkeit auf „${preset}" setzen`}
                  >
                    {preset}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {ladeStatus === 'laden' && (
        <div className="text-sm text-gray-500">Lade gespeicherte Werte…</div>
      )}
      {ladeStatus === 'fehler' && (
        <div className="text-sm text-red-700">Fehler beim Laden der gespeicherten Werte.</div>
      )}

      {ladeStatus !== 'laden' && (
        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200 text-gray-600 text-xs">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Monat</th>
                <th className="px-3 py-2 text-right font-medium" title="Brutto laut Lohnbüro-PDF">Brutto LB</th>
                <th className="px-3 py-2 text-right font-medium" title="Manueller Override — leer = LB-Wert nutzen">Manuelles Brutto</th>
                <th className="px-3 py-2 text-center font-medium" title="Wert wurde gegen die Original-PDF geprüft und ist freigegeben">Wert überprüft</th>
                <th className="px-3 py-2 text-left font-medium">PDF</th>
                <th className="px-3 py-2 text-right font-medium">Effektiv</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {zeilen.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-gray-400">
                    Zeitraum-Bereich leer (Von &gt; Bis?).
                  </td>
                </tr>
              ) : (
                // Anzeige rückwärts — aktueller Monat oben. Für Druck +
                // Summen-Berechnung bleibt `zeilen` chronologisch.
                [...zeilen].reverse().map((z) => {
                  const key = `${z.jahr}-${z.monat}`;
                  const eff = effektivesBrutto(z);
                  const dirty = istDirty(z);
                  const driveLink = driveLinkFuer(z.jahr, z.monat);
                  return (
                    <tr key={key} className={dirty ? 'bg-amber-50/40' : ''}>
                      <td className="px-3 py-2 font-mono text-xs text-gray-700">
                        {MONATSNAMEN_KURZ[z.monat - 1]} {z.jahr}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-gray-700">
                        {z.lbAbrechnung ? eur(z.lbAbrechnung.gesamtBrutto) : <span className="text-gray-300" title="Für diesen Monat liegt keine Lohnbüro-PDF im System">— keine PDF —</span>}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <input
                          type="text"
                          inputMode="decimal"
                          value={z.bruttoEditEur}
                          onChange={(e) => setBruttoInput(key, e.target.value)}
                          placeholder={z.lbAbrechnung ? '' : '—'}
                          className="w-28 text-right border border-gray-300 rounded px-2 py-1 text-sm font-mono"
                        />
                      </td>
                      <td className="px-3 py-2 text-center">
                        <input
                          type="checkbox"
                          checked={z.ueberprueftEdit}
                          onChange={(e) => setUeberprueftInput(key, e.target.checked)}
                          className="rounded"
                          title="Übernimmt den Brutto-Wert für die Bescheinigung"
                        />
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {z.lbAbrechnung ? (
                          <a
                            href={`https://drive.google.com/file/d/${z.lbAbrechnung.fileId}/view#page=${z.lbAbrechnung.seite}`}
                            target="_blank"
                            rel="noreferrer"
                            className="text-blue-700 underline hover:text-blue-900"
                            title={z.lbAbrechnung.fileName}
                          >
                            📄 Seite {z.lbAbrechnung.seite}
                          </a>
                        ) : driveLink ? (
                          <a
                            href={driveLink}
                            target="_blank"
                            rel="noreferrer"
                            className="text-gray-500 underline hover:text-gray-700"
                            title="Kein indiziertes PDF — Drive-Ordner öffnen"
                          >
                            📁 Ordner
                          </a>
                        ) : (
                          <span className="text-gray-300">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right font-mono font-semibold text-gray-900">
                        {eff != null ? eur(eff) : <span className="text-gray-300">—</span>}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
            {zeilen.length > 0 && (
              <tfoot className="bg-gray-50 border-t border-gray-200 text-xs">
                <tr>
                  <td className="px-3 py-2 font-semibold text-gray-700">Summe</td>
                  <td />
                  <td />
                  <td />
                  <td />
                  <td className="px-3 py-2 text-right font-mono font-bold text-gray-900">{eur(summe)}</td>
                </tr>
                <tr>
                  <td className="px-3 py-2 font-semibold text-gray-700">Durchschnitt</td>
                  <td />
                  <td />
                  <td />
                  <td />
                  <td className="px-3 py-2 text-right font-mono font-bold text-gray-900">{eur(durchschnitt)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}

      {/* ---- Fragenblock ---- */}
      <div className="rounded-lg border border-gray-200 bg-white p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-800">Fragen auf der Bescheinigung</h3>
          <button
            type="button"
            onClick={() => setNeueFrageOpen((v) => !v)}
            className="text-xs text-blue-700 hover:text-blue-900 underline"
          >
            {neueFrageOpen ? '— abbrechen' : '+ Frage hinzufügen'}
          </button>
        </div>

        {/* Standardfragen */}
        <div className="space-y-2">
          {STANDARD_FRAGEN.map((f) => {
            const defaultAntwort = f.defaultFn(mitarbeiter);
            const hinweis = f.hinweisFn?.(mitarbeiter) ?? null;
            const aktuelleAntwort = antworten[f.id] ?? '';
            return (
              <FrageJaNeinZeile
                key={f.id}
                fragetext={f.fragetext}
                wert={aktuelleAntwort}
                defaultWert={defaultAntwort}
                hinweis={hinweis}
                onChange={(v) => setAntworten((prev) => ({ ...prev, [f.id]: v }))}
                onLeeren={() => setAntworten((prev) => ({ ...prev, [f.id]: '' }))}
              />
            );
          })}
        </div>

        {/* Zusatzfragen aus dem Katalog */}
        {aktiveZusatzFragen.length > 0 && (
          <div className="space-y-2 pt-2 border-t border-gray-100">
            <p className="text-xs text-gray-500">
              Zusatzfragen (Katalog gilt für alle Mitarbeiter):
            </p>
            {aktiveZusatzFragen.map((f) => (
              <ZusatzFrageZeile
                key={f.id}
                frage={f}
                antwort={antworten[f.id] ?? (f.standardAntwort ?? '')}
                onAntwort={(v) => setAntworten((prev) => ({ ...prev, [f.id]: v }))}
                onLoeschen={() => frageLoeschen(f.id)}
              />
            ))}
          </div>
        )}

        {/* Inline-Form für neue Frage */}
        {neueFrageOpen && (
          <div className="rounded-md border border-blue-200 bg-blue-50/50 p-3 space-y-2">
            <div className="flex gap-2 items-start">
              <input
                type="text"
                value={neueFrageText}
                onChange={(e) => setNeueFrageText(e.target.value)}
                placeholder="Fragetext (wird auf der Bescheinigung gedruckt)…"
                className="flex-1 border border-gray-300 rounded px-2 py-1.5 text-sm"
                autoFocus
              />
              <select
                value={neueFrageTyp}
                onChange={(e) => {
                  const t = e.target.value as VerdienstbescheinigungAntwortTyp;
                  setNeueFrageTyp(t);
                  // Wenn der Standardantwort-Wert nicht zum neuen Typ passt → leeren.
                  if (t !== 'jaNein' && (neueFrageStandard === 'ja' || neueFrageStandard === 'nein')) {
                    setNeueFrageStandard('');
                  }
                }}
                className="border border-gray-300 rounded px-2 py-1.5 text-sm"
              >
                <option value="jaNein">Ja/Nein</option>
                <option value="betrag">Betrag (EUR)</option>
                <option value="text">Freitext</option>
              </select>
            </div>
            <div className="flex gap-2 items-center">
              <label className="text-[11px] text-gray-600 shrink-0">Standardantwort:</label>
              {neueFrageTyp === 'jaNein' ? (
                <select
                  value={neueFrageStandard}
                  onChange={(e) => setNeueFrageStandard(e.target.value)}
                  className="border border-gray-300 rounded px-2 py-1 text-xs"
                >
                  <option value="">— keine (Nutzer muss wählen) —</option>
                  <option value="ja">Ja</option>
                  <option value="nein">Nein</option>
                </select>
              ) : (
                <input
                  type="text"
                  value={neueFrageStandard}
                  onChange={(e) => setNeueFrageStandard(e.target.value)}
                  placeholder={neueFrageTyp === 'betrag' ? 'z. B. 0,00 (leer = keine Vorbelegung)' : 'leer = keine Vorbelegung'}
                  className="flex-1 border border-gray-300 rounded px-2 py-1 text-xs"
                />
              )}
            </div>
            <textarea
              value={neueFrageHinweis}
              onChange={(e) => setNeueFrageHinweis(e.target.value)}
              placeholder="Hinweistext (optional, erscheint als ⓘ neben der Antwort)"
              rows={2}
              className="w-full border border-gray-300 rounded px-2 py-1.5 text-xs"
            />
            <div className="flex justify-end">
              <button
                type="button"
                onClick={frageAnlegen}
                disabled={!neueFrageText.trim() || neueFrageSaving}
                className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white px-3 py-1.5 rounded text-sm font-medium"
              >
                {neueFrageSaving ? '…' : 'Anlegen'}
              </button>
            </div>
            <p className="text-[11px] text-gray-500">
              Die neue Frage wird im globalen Fragen-Katalog gespeichert und erscheint
              automatisch bei allen Mitarbeiter-Bescheinigungen.
            </p>
          </div>
        )}
      </div>

      {/* ---- Anmerkung (gedruckt) ---- */}
      <div className="rounded-lg border border-gray-200 bg-white p-4 space-y-2">
        <h3 className="text-sm font-semibold text-gray-800">
          Anmerkung auf der Bescheinigung
        </h3>
        <p className="text-xs text-gray-500">
          Optional. Wenn ausgefüllt, erscheint dieser Text auf dem gedruckten
          Dokument. Leer → wird ausgeblendet.
        </p>
        <textarea
          value={anmerkungDruckEdit}
          onChange={(e) => setAnmerkungDruckEdit(e.target.value)}
          placeholder='z. B. „Beschäftigung unterbrochen vom 01.03.–15.03.2026 wegen Krankheit."'
          rows={3}
          className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
        />
      </div>

      {/* ---- Internes Memo (NICHT gedruckt) ---- */}
      <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 space-y-2">
        <h3 className="text-sm font-semibold text-gray-800">
          Internes Memo (wird nicht gedruckt)
        </h3>
        <textarea
          value={internesMemoEdit}
          onChange={(e) => setInternesMemoEdit(e.target.value)}
          placeholder="Nur intern — z. B. Rückfragen, Hinweise für nächste Bescheinigung…"
          rows={3}
          className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
        />
      </div>

      {/* ---- Kontaktdaten Arbeitsamt ---- */}
      <div className="rounded-lg border border-gray-200 bg-white p-4 space-y-4">
        <h3 className="text-sm font-semibold text-gray-800">
          Kontaktdaten Arbeitsamt (Bundesagentur für Arbeit)
        </h3>

        {/* Ansprechpartner */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-gray-500 mb-0.5">Sachbearbeiter (Name)</label>
            <input
              type="text"
              value={arbeitsamtKontaktEdit.name}
              onChange={(e) => setArbeitsamtKontaktEdit((p) => ({ ...p, name: e.target.value }))}
              placeholder="z. B. Frau Müller"
              className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-0.5">Telefon</label>
            <input
              type="text"
              value={arbeitsamtKontaktEdit.telefon}
              onChange={(e) => setArbeitsamtKontaktEdit((p) => ({ ...p, telefon: e.target.value }))}
              className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-0.5">E-Mail</label>
            <input
              type="email"
              value={arbeitsamtKontaktEdit.email}
              onChange={(e) => setArbeitsamtKontaktEdit((p) => ({ ...p, email: e.target.value }))}
              className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-0.5">Straße + Hausnr.</label>
            <input
              type="text"
              value={arbeitsamtKontaktEdit.strasse}
              onChange={(e) => setArbeitsamtKontaktEdit((p) => ({ ...p, strasse: e.target.value }))}
              className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-0.5">PLZ</label>
            <input
              type="text"
              value={arbeitsamtKontaktEdit.plz}
              onChange={(e) => setArbeitsamtKontaktEdit((p) => ({ ...p, plz: e.target.value }))}
              className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-0.5">Ort</label>
            <input
              type="text"
              value={arbeitsamtKontaktEdit.ort}
              onChange={(e) => setArbeitsamtKontaktEdit((p) => ({ ...p, ort: e.target.value }))}
              className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
            />
          </div>
        </div>

        {/* Kundennummer + Ihr Zeichen mit Drucken-Toggle */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2 border-t border-gray-100">
          <div>
            <label className="block text-xs text-gray-500 mb-0.5">Kundennummer (des Mitarbeiters bei der BA)</label>
            <input
              type="text"
              value={arbeitsamtKundennummerEdit}
              onChange={(e) => setArbeitsamtKundennummerEdit(e.target.value)}
              className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
            />
            <label className="mt-1 flex items-center gap-2 text-xs text-gray-700">
              <input
                type="checkbox"
                checked={arbeitsamtKundennummerDruckenEdit}
                onChange={(e) => setArbeitsamtKundennummerDruckenEdit(e.target.checked)}
                disabled={!arbeitsamtKundennummerEdit.trim()}
                className="rounded"
              />
              In Betreffzeile der Bescheinigung drucken
            </label>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-0.5">Ihr Zeichen (BA)</label>
            <input
              type="text"
              value={arbeitsamtZeichenEdit}
              onChange={(e) => setArbeitsamtZeichenEdit(e.target.value)}
              className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
            />
            <label className="mt-1 flex items-center gap-2 text-xs text-gray-700">
              <input
                type="checkbox"
                checked={arbeitsamtZeichenDruckenEdit}
                onChange={(e) => setArbeitsamtZeichenDruckenEdit(e.target.checked)}
                disabled={!arbeitsamtZeichenEdit.trim()}
                className="rounded"
              />
              In Betreffzeile der Bescheinigung drucken
            </label>
          </div>
        </div>

        {/* Adresskopf-Auswahl */}
        <div className="pt-2 border-t border-gray-100 space-y-2">
          <label className="block text-xs font-semibold text-gray-700">Adresskopf der Bescheinigung</label>
          <div className="flex flex-wrap gap-3 text-sm text-gray-700">
            <label className="flex items-center gap-1.5">
              <input
                type="radio"
                checked={adresskopfModeEdit === 'arbeitsamt'}
                onChange={() => setAdresskopfModeEdit('arbeitsamt')}
              />
              Name + Adresse Arbeitsamt
            </label>
            <label className="flex items-center gap-1.5">
              <input
                type="radio"
                checked={adresskopfModeEdit === 'eigene'}
                onChange={() => setAdresskopfModeEdit('eigene')}
              />
              Eigene Adresse
            </label>
            <label className="flex items-center gap-1.5">
              <input
                type="radio"
                checked={adresskopfModeEdit === 'keine'}
                onChange={() => setAdresskopfModeEdit('keine')}
              />
              Keine Adresse
            </label>
          </div>
          {adresskopfModeEdit === 'eigene' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 pt-2">
              <input
                type="text"
                value={adresskopfEigeneEdit.name}
                onChange={(e) => setAdresskopfEigeneEdit((p) => ({ ...p, name: e.target.value }))}
                placeholder="Name / Behörde"
                className="border border-gray-300 rounded px-2 py-1.5 text-sm md:col-span-2"
              />
              <input
                type="text"
                value={adresskopfEigeneEdit.strasse}
                onChange={(e) => setAdresskopfEigeneEdit((p) => ({ ...p, strasse: e.target.value }))}
                placeholder="Straße + Hausnr."
                className="border border-gray-300 rounded px-2 py-1.5 text-sm md:col-span-2"
              />
              <input
                type="text"
                value={adresskopfEigeneEdit.plz}
                onChange={(e) => setAdresskopfEigeneEdit((p) => ({ ...p, plz: e.target.value }))}
                placeholder="PLZ"
                className="border border-gray-300 rounded px-2 py-1.5 text-sm"
              />
              <input
                type="text"
                value={adresskopfEigeneEdit.ort}
                onChange={(e) => setAdresskopfEigeneEdit((p) => ({ ...p, ort: e.target.value }))}
                placeholder="Ort"
                className="border border-gray-300 rounded px-2 py-1.5 text-sm"
              />
            </div>
          )}
        </div>
      </div>

      {/* ---- Aktionen ---- */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={speichereDirty}
          disabled={(dirtyAnzahl === 0 && !anmerkungDirty && !memoDirty && !arbeitsamtDirty) || saving}
          className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white px-4 py-2 rounded-lg text-sm font-medium"
        >
          {saving
            ? 'Speichert…'
            : `💾 Änderungen speichern${dirtyAnzahl + (anmerkungDirty ? 1 : 0) + (memoDirty ? 1 : 0) + (arbeitsamtDirty ? 1 : 0) > 0 ? ` (${dirtyAnzahl + (anmerkungDirty ? 1 : 0) + (memoDirty ? 1 : 0) + (arbeitsamtDirty ? 1 : 0)})` : ''}`}
        </button>
        <button
          type="button"
          onClick={druckenMitAutoSave}
          disabled={!druckBereit || saving}
          className="bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-300 text-white px-4 py-2 rounded-lg text-sm font-medium"
          title={druckBereit
            ? 'Bescheinigung in Druck-Vorschau öffnen (offene Änderungen werden automatisch gespeichert)'
            : 'Pflichtdaten fehlen oder Monate sind nicht überprüft'}
        >
          🖨️ Verdienstbescheinigung drucken
        </button>
      </div>

      {(fehlend.length > 0 || ungepruefteMonate.length > 0 || monateOhneLB.length > 0) && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 space-y-2">
          <p className="font-semibold">Vor dem Druck noch zu erledigen:</p>
          {fehlend.length > 0 && (
            <div>
              <span className="font-medium">Fehlende Stammdaten:</span>{' '}
              {fehlend.join(', ')}
            </div>
          )}
          {monateOhneLB.length > 0 && (
            <div>
              <span className="font-medium">Monate ohne Brutto-Wert (weder LB-PDF noch manueller Override):</span>{' '}
              {monateOhneLB.join(', ')}
            </div>
          )}
          {ungepruefteMonate.length > 0 && (
            <div>
              <span className="font-medium">Noch nicht überprüfte Monate:</span>{' '}
              {ungepruefteMonate.join(', ')}
            </div>
          )}
        </div>
      )}

      {druckOffen && (
        <VerdienstbescheinigungDruck
          mitarbeiter={mitarbeiter}
          taetigkeit={taetigkeit}
          zeilen={zeilen.map((z) => ({
            jahr: z.jahr,
            monat: z.monat,
            bruttoEur: effektivesBrutto(z) ?? 0,
          }))}
          durchschnittEur={durchschnitt}
          standardFragen={STANDARD_FRAGEN.map((f) => {
            const a = antworten[f.id] ?? '';
            return {
              id: f.id,
              fragetext: f.fragetext,
              antwortTyp: 'jaNein' as const,
              antwort: a === 'ja' ? 'Ja' : a === 'nein' ? 'Nein' : '',
              zusatzText: a === 'ja' ? f.zusatzWennJa : a === 'nein' ? f.zusatzWennNein : undefined,
            };
          })}
          zusatzFragen={aktiveZusatzFragen.map((f) => ({
            id: f.id,
            fragetext: f.fragetext,
            antwortTyp: f.antwortTyp,
            antwort: antworten[f.id] ?? '',
          }))}
          anmerkung={anmerkungDruckEdit.trim()}
          adresskopf={(() => {
            if (adresskopfModeEdit === 'arbeitsamt') {
              return {
                name: arbeitsamtKontaktEdit.name.trim(),
                strasse: arbeitsamtKontaktEdit.strasse.trim(),
                plz: arbeitsamtKontaktEdit.plz.trim(),
                ort: arbeitsamtKontaktEdit.ort.trim(),
              };
            }
            if (adresskopfModeEdit === 'eigene') {
              return {
                name: adresskopfEigeneEdit.name.trim(),
                strasse: adresskopfEigeneEdit.strasse.trim(),
                plz: adresskopfEigeneEdit.plz.trim(),
                ort: adresskopfEigeneEdit.ort.trim(),
              };
            }
            return null;  // 'keine'
          })()}
          betreffZusatz={[
            arbeitsamtKundennummerDruckenEdit && arbeitsamtKundennummerEdit.trim()
              ? `Kundennr. ${arbeitsamtKundennummerEdit.trim()}`
              : null,
            arbeitsamtZeichenDruckenEdit && arbeitsamtZeichenEdit.trim()
              ? `Ihr Zeichen ${arbeitsamtZeichenEdit.trim()}`
              : null,
          ].filter(Boolean).join(' · ')}
          onClose={() => setDruckOffen(false)}
        />
      )}
    </div>
  );
}

// ---- Helfer: klickbares Info-Icon mit Hinweis-Popover -------

function HinweisIcon({ text }: { text: string | null | undefined }) {
  const [offen, setOffen] = useState(false);
  if (!text) return null;
  return (
    <span className="relative inline-block">
      <button
        type="button"
        onClick={() => setOffen((v) => !v)}
        className="w-4 h-4 inline-flex items-center justify-center rounded-full bg-blue-100 text-blue-700 text-[10px] font-bold hover:bg-blue-200"
        title="Hinweis anzeigen"
        aria-label="Hinweis anzeigen"
      >
        i
      </button>
      {offen && (
        <span className="absolute right-0 top-5 z-30 w-72 bg-white border border-gray-300 shadow-lg rounded p-2 text-xs text-gray-700 leading-snug whitespace-normal">
          {text}
          <button
            type="button"
            onClick={() => setOffen(false)}
            className="absolute top-1 right-1 text-gray-400 hover:text-gray-700 text-xs"
            aria-label="Schließen"
          >
            ✕
          </button>
        </span>
      )}
    </span>
  );
}

// ---- Helfer: Ja/Nein-Zeile für Standardfragen ---------------

function FrageJaNeinZeile({
  fragetext,
  wert,
  defaultWert,
  hinweis,
  onChange,
  onLeeren,
}: {
  fragetext: string;
  wert: string;                          // '', 'ja' oder 'nein'
  defaultWert: 'ja' | 'nein' | null;     // null = keine Vorbelegung
  hinweis: string | null;
  onChange: (v: 'ja' | 'nein') => void;
  onLeeren: () => void;
}) {
  const istVorbelegt = defaultWert != null && wert === defaultWert;
  return (
    <div className="flex items-start gap-3 py-1">
      <div className="flex-1 text-sm text-gray-700">
        {fragetext}
        {!wert && (
          <span className="ml-2 text-[10px] uppercase tracking-wide text-amber-700 font-semibold" title="Wird beim Druck weggelassen, solange keine Antwort gewählt ist.">
            ⚠ keine Antwort → wird nicht gedruckt
          </span>
        )}
        {istVorbelegt && (
          <span className="ml-2 text-[10px] uppercase tracking-wide text-blue-700 font-semibold" title="Diese Antwort ist als Standard vorbelegt — bei Bedarf umschalten oder löschen.">
            ✓ vorbelegt
          </span>
        )}
      </div>
      <div className="flex gap-1 shrink-0 items-center">
        <label className={`px-2.5 py-1 rounded text-xs cursor-pointer border ${wert === 'ja' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-300 hover:border-gray-400'}`}>
          <input
            type="radio"
            checked={wert === 'ja'}
            onChange={() => onChange('ja')}
            className="hidden"
          />
          Ja
        </label>
        <label className={`px-2.5 py-1 rounded text-xs cursor-pointer border ${wert === 'nein' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-300 hover:border-gray-400'}`}>
          <input
            type="radio"
            checked={wert === 'nein'}
            onChange={() => onChange('nein')}
            className="hidden"
          />
          Nein
        </label>
        <button
          type="button"
          onClick={onLeeren}
          disabled={!wert}
          className="px-1.5 py-1 text-xs text-gray-400 hover:text-red-600 disabled:opacity-30 disabled:hover:text-gray-400"
          title="Antwort leeren (Frage erscheint dann nicht im Druck)"
        >
          ⌫
        </button>
        <HinweisIcon text={hinweis} />
      </div>
    </div>
  );
}

// ---- Helfer: Zeile für Zusatzfrage aus dem Katalog ----------

function ZusatzFrageZeile({
  frage,
  antwort,
  onAntwort,
  onLoeschen,
}: {
  frage: VerdienstbescheinigungFrage;
  antwort: string;
  onAntwort: (v: string) => void;
  onLoeschen: () => void;
}) {
  const istVorbelegt = !!frage.standardAntwort && antwort === frage.standardAntwort;
  const istLeer = !antwort.trim();
  return (
    <div className="flex items-start gap-3 py-1">
      <div className="flex-1 text-sm text-gray-700">
        {frage.fragetext}
        {istLeer && (
          <span className="ml-2 text-[10px] uppercase tracking-wide text-amber-700 font-semibold" title="Wird beim Druck weggelassen, solange keine Antwort gewählt ist.">
            ⚠ keine Antwort → wird nicht gedruckt
          </span>
        )}
        {istVorbelegt && (
          <span className="ml-2 text-[10px] uppercase tracking-wide text-blue-700 font-semibold" title="Diese Antwort ist als Standard vorbelegt.">
            ✓ vorbelegt
          </span>
        )}
      </div>
      <div className="shrink-0 flex items-center gap-2">
        {frage.antwortTyp === 'jaNein' ? (
          <div className="flex gap-1">
            <label className={`px-2.5 py-1 rounded text-xs cursor-pointer border ${antwort === 'ja' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-300 hover:border-gray-400'}`}>
              <input
                type="radio"
                checked={antwort === 'ja'}
                onChange={() => onAntwort('ja')}
                className="hidden"
              />
              Ja
            </label>
            <label className={`px-2.5 py-1 rounded text-xs cursor-pointer border ${antwort === 'nein' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-300 hover:border-gray-400'}`}>
              <input
                type="radio"
                checked={antwort === 'nein'}
                onChange={() => onAntwort('nein')}
                className="hidden"
              />
              Nein
            </label>
          </div>
        ) : frage.antwortTyp === 'betrag' ? (
          <input
            type="text"
            inputMode="decimal"
            value={antwort}
            onChange={(e) => onAntwort(e.target.value)}
            placeholder="0,00 €"
            className="w-32 text-right border border-gray-300 rounded px-2 py-1 text-xs font-mono"
          />
        ) : (
          <input
            type="text"
            value={antwort}
            onChange={(e) => onAntwort(e.target.value)}
            placeholder="Antwort…"
            className="w-56 border border-gray-300 rounded px-2 py-1 text-xs"
          />
        )}
        <button
          type="button"
          onClick={() => onAntwort('')}
          disabled={istLeer}
          className="px-1.5 py-1 text-xs text-gray-400 hover:text-red-600 disabled:opacity-30 disabled:hover:text-gray-400"
          title="Antwort leeren (Frage erscheint dann nicht im Druck)"
        >
          ⌫
        </button>
        <HinweisIcon text={frage.hinweis ?? null} />
      </div>
      <button
        type="button"
        onClick={onLoeschen}
        className="shrink-0 text-gray-400 hover:text-red-600 text-xs"
        title="Frage aus dem Katalog entfernen (gilt dann für alle MAs)"
      >
        ✕
      </button>
    </div>
  );
}
