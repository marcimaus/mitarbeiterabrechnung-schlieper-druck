// =============================================================
// Abrechnungen Lohnbüro auswerten
// -------------------------------------------------------------
// Admin-only Sicht auf die indizierten Lohnbüro-PDF-Abrechnungen.
// Zwei Tabs:
//   1. "Abrechnungen" — pro Monat & MA: Brutto/Netto/SV/Auszahlung
//   2. "An-/Abmeldungen" — SV-Meldungen mit „Grund der Abgabe"
//
// Datenquelle: zwei Firestore-Collections, in AppContext live geladen.
// Indizierung erfolgt offline via One-Off-Skript (siehe Plan).
// =============================================================

import { useEffect, useMemo, useState } from 'react';
import AdminPinGate from '../components/AdminPinGate';
import Modal from '../components/Modal';
import { useApp } from '../context/AppContext';
import { eur } from '../lib/abrechnungslogik';
import {
  erstelleLegacyMitarbeiter,
  weiseLohnbueroNameRohZu,
  setzeLohnbueroDriveLink,
  loescheLohnbueroDriveLink,
} from '../lib/db';
import type { MitarbeiterAbrechnung } from '../lib/abrechnungslogik';
import type {
  LohnbueroAbrechnung,
  LohnbueroAnmeldung,
  LohnbueroDriveLink,
  Mitarbeiter,
  Rolle,
} from '../types';
import { ROLLEN_LABELS } from '../types';

const ALLE_ROLLEN = Object.keys(ROLLEN_LABELS) as Rolle[];

type Tab = 'abrechnungen' | 'anmeldungen' | 'drive';

export default function LohnbueroAuswertungScreen() {
  return (
    <AdminPinGate allowedRoles={['admin']}>
      <LohnbueroAuswertungInhalt />
    </AdminPinGate>
  );
}

function LohnbueroAuswertungInhalt() {
  const {
    mitarbeiter,
    lohnbueroAbrechnungen,
    lohnbueroAnmeldungen,
    lohnbueroDriveLinks,
    abrechnungsperioden,
    adminName,
  } = useApp();
  const [tab, setTab] = useState<Tab>('abrechnungen');
  // Wenn gesetzt, ist der Zuordnen-Modal offen und vorbelegt mit diesem
  // Rohnamen. Die Zuordnung greift bulk auf alle Einträge mit gleichem
  // Rohnamen (siehe `weiseLohnbueroNameRohZu`).
  const [zuordnenName, setZuordnenName] = useState<string | null>(null);

  const maMap = useMemo(
    () => new Map(mitarbeiter.map((m) => [m.id, m])),
    [mitarbeiter],
  );

  // Lookup-Map: `${jahr}-${monat}-${mitarbeiterId}` → bruttoLohnbuero aus
  // dem App-Abrechnungs-Snapshot (= der Wert, den wir ans Lohnbüro
  // übermittelt haben). Vergleich zur Spalte „Gesamt-Brutto" aus dem
  // Lohnbüro-PDF zeigt Übermittlungsfehler.
  const appBruttoMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of abrechnungsperioden) {
      const erg = (p.abrechnungSnapshot?.ergebnisse ?? []) as MitarbeiterAbrechnung[];
      for (const e of erg) {
        if (!e.mitarbeiter?.id) continue;
        map.set(`${p.jahr}-${p.monat}-${e.mitarbeiter.id}`, e.bruttoLohnbuero ?? 0);
      }
    }
    return map;
  }, [abrechnungsperioden]);

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">🧾 Abrechnungen Lohnbüro auswerten</h1>
        <p className="text-gray-500 text-sm">
          Indizierte PDF-Abrechnungen vom Steuer-/Lohnbüro (Drive). Zeigt
          die tatsächlich abgerechneten Werte je Monat & Mitarbeiter sowie
          SV-An-/Abmeldungen.
        </p>
      </div>

      <div className="flex border-b border-gray-200 mb-4">
        <TabButton
          aktiv={tab === 'abrechnungen'}
          onClick={() => setTab('abrechnungen')}
          label={`Abrechnungen (${lohnbueroAbrechnungen.length})`}
        />
        <TabButton
          aktiv={tab === 'anmeldungen'}
          onClick={() => setTab('anmeldungen')}
          label={`An-/Abmeldungen (${lohnbueroAnmeldungen.length})`}
        />
        <TabButton
          aktiv={tab === 'drive'}
          onClick={() => setTab('drive')}
          label={`Abrechnungsdaten im externen Speicher (GDrive) (${lohnbueroDriveLinks.length})`}
        />
      </div>

      {tab === 'abrechnungen' && (
        <AbrechnungenTab
          eintraege={lohnbueroAbrechnungen}
          maMap={maMap}
          mitarbeiter={mitarbeiter}
          onZuordnen={setZuordnenName}
          appBruttoMap={appBruttoMap}
        />
      )}
      {tab === 'anmeldungen' && (
        <AnmeldungenTab
          eintraege={lohnbueroAnmeldungen}
          maMap={maMap}
          mitarbeiter={mitarbeiter}
          onZuordnen={setZuordnenName}
        />
      )}
      {tab === 'drive' && (
        <DriveLinksTab links={lohnbueroDriveLinks} adminName={adminName} />
      )}

      <ZuordnenModal
        nameRoh={zuordnenName}
        mitarbeiter={mitarbeiter}
        onClose={() => setZuordnenName(null)}
        anzahlAbrechnungen={lohnbueroAbrechnungen.filter(
          (e) => e.nameRoh === zuordnenName && !e.mitarbeiterId,
        ).length}
        anzahlAnmeldungen={lohnbueroAnmeldungen.filter(
          (e) => e.nameRoh === zuordnenName && !e.mitarbeiterId,
        ).length}
      />
    </div>
  );
}

function TabButton({ aktiv, onClick, label }: { aktiv: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
        aktiv
          ? 'border-blue-600 text-blue-700'
          : 'border-transparent text-gray-500 hover:text-gray-800'
      }`}
    >
      {label}
    </button>
  );
}

// ============================================================
// Tab: Abrechnungsdaten im externen Speicher (GDrive)
// ============================================================
// Pro Monat (bzw. Jahr) ein Link in den Drive-Ordner mit den
// Original-Abrechnungen vom Lohnbüro. Such-Einschränkung nach Jahr
// und Monat. Bei „nur Jahr" wird der Jahres-Link angeboten.

function DriveLinksTab({
  links,
  adminName,
}: {
  links: LohnbueroDriveLink[];
  adminName: string;
}) {
  const jahre = useMemo(() => {
    const s = new Set<number>();
    for (const l of links) s.add(l.jahr);
    return [...s].sort((a, b) => b - a);
  }, [links]);

  const [filterJahr, setFilterJahr] = useState<number | ''>('');
  const [filterMonat, setFilterMonat] = useState<number | ''>('');
  const [neuJahr, setNeuJahr] = useState<string>(String(new Date().getFullYear()));
  const [neuMonat, setNeuMonat] = useState<string>('');
  const [neuUrl, setNeuUrl] = useState('');
  const [saving, setSaving] = useState(false);

  // Gefilterte Anzeige.
  const gefiltert = useMemo(() => {
    let list = [...links];
    if (filterJahr !== '') list = list.filter((l) => l.jahr === filterJahr);
    if (filterMonat !== '') {
      // Bei gewähltem Monat nur Monats-Links dieses Monats.
      list = list.filter((l) => l.monat === filterMonat);
    }
    // Sortierung: Jahr desc, dann Monat asc (null/Jahr-Link zuerst).
    return list.sort((a, b) => {
      if (a.jahr !== b.jahr) return b.jahr - a.jahr;
      return (a.monat ?? 0) - (b.monat ?? 0);
    });
  }, [links, filterJahr, filterMonat]);

  // „Nur Jahr ausgewählt" → den Jahres-Link separat anbieten.
  const jahresLink = useMemo(() => {
    if (filterJahr === '' || filterMonat !== '') return null;
    return links.find((l) => l.jahr === filterJahr && l.monat == null) ?? null;
  }, [links, filterJahr, filterMonat]);

  async function speichern() {
    const j = parseInt(neuJahr, 10);
    if (!Number.isFinite(j) || j < 2000 || j > 2100) {
      alert('Bitte ein gültiges Jahr angeben.');
      return;
    }
    const m = neuMonat === '' ? null : parseInt(neuMonat, 10);
    if (!neuUrl.trim()) {
      alert('Bitte einen Link angeben.');
      return;
    }
    setSaving(true);
    try {
      await setzeLohnbueroDriveLink(j, m, neuUrl.trim(), adminName || 'Admin');
      setNeuUrl('');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-600">
        Links in das Google Drive, in dem die Original-Abrechnungen vom
        Lohnbüro abgelegt sind. Pro Monat (oder Jahr) ein Link. Die per
        Skript importierten Monate werden automatisch hinterlegt; weitere
        Monate kannst du hier manuell ergänzen.
      </p>

      {/* Filterleiste */}
      <div className="flex flex-wrap gap-3 items-center">
        <select
          value={filterJahr === '' ? '' : String(filterJahr)}
          onChange={(e) => setFilterJahr(e.target.value === '' ? '' : Number(e.target.value))}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">Jahr: alle</option>
          {jahre.map((j) => (
            <option key={j} value={String(j)}>{j}</option>
          ))}
        </select>
        <select
          value={filterMonat === '' ? '' : String(filterMonat)}
          onChange={(e) => setFilterMonat(e.target.value === '' ? '' : Number(e.target.value))}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">Monat: alle</option>
          {MONATSNAMEN.map((label, idx) => (
            <option key={idx + 1} value={String(idx + 1)}>{label}</option>
          ))}
        </select>
      </div>

      {/* Jahres-Link-Hinweis, wenn nur Jahr gewählt */}
      {filterJahr !== '' && filterMonat === '' && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm flex items-center gap-2">
          <span className="text-emerald-800 font-medium">📁 Jahresordner {filterJahr}:</span>
          {jahresLink ? (
            <a
              href={jahresLink.url}
              target="_blank"
              rel="noreferrer"
              className="text-emerald-700 underline hover:text-emerald-900"
            >
              im Drive öffnen
            </a>
          ) : (
            <span className="text-gray-500 italic">kein Jahres-Link hinterlegt</span>
          )}
        </div>
      )}

      {/* Tabelle */}
      <div className="overflow-hidden rounded-lg border border-gray-200">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200 text-gray-600 text-xs">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Jahr</th>
              <th className="px-3 py-2 text-left font-medium">Monat</th>
              <th className="px-3 py-2 text-left font-medium">Link</th>
              <th className="px-3 py-2 text-left font-medium">Aktualisiert</th>
              <th className="px-3 py-2 text-right font-medium">Aktion</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {gefiltert.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-8 text-center text-gray-400">
                  Keine Links für die aktuelle Auswahl.
                </td>
              </tr>
            ) : (
              gefiltert.map((l) => (
                <DriveLinkZeile key={l.id} link={l} adminName={adminName} />
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Neuer Link */}
      <div className="rounded-lg border border-blue-200 bg-blue-50/40 p-3 space-y-2">
        <h3 className="text-sm font-semibold text-gray-800">Link hinzufügen / überschreiben</h3>
        <div className="flex flex-wrap gap-2 items-center">
          <input
            type="number"
            value={neuJahr}
            onChange={(e) => setNeuJahr(e.target.value)}
            placeholder="Jahr"
            className="border border-gray-300 rounded px-2 py-1.5 text-sm w-24"
          />
          <select
            value={neuMonat}
            onChange={(e) => setNeuMonat(e.target.value)}
            className="border border-gray-300 rounded px-2 py-1.5 text-sm"
          >
            <option value="">— Jahres-Link —</option>
            {MONATSNAMEN.map((label, idx) => (
              <option key={idx + 1} value={String(idx + 1)}>{label}</option>
            ))}
          </select>
          <input
            type="url"
            value={neuUrl}
            onChange={(e) => setNeuUrl(e.target.value)}
            placeholder="https://drive.google.com/drive/folders/…"
            className="border border-gray-300 rounded px-2 py-1.5 text-sm flex-1 min-w-[16rem]"
          />
          <button
            type="button"
            onClick={speichern}
            disabled={saving}
            className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white text-sm px-4 py-1.5 rounded"
          >
            {saving ? 'Speichert…' : 'Speichern'}
          </button>
        </div>
        <p className="text-[11px] text-gray-500">
          Monat leer lassen → Link gilt für den ganzen Jahresordner. Vorhandene
          Einträge mit gleichem Jahr/Monat werden überschrieben.
        </p>
      </div>
    </div>
  );
}

function DriveLinkZeile({ link, adminName }: { link: LohnbueroDriveLink; adminName: string }) {
  const [bearbeiten, setBearbeiten] = useState(false);
  const [urlEdit, setUrlEdit] = useState(link.url);
  const [saving, setSaving] = useState(false);

  async function speichern() {
    setSaving(true);
    try {
      await setzeLohnbueroDriveLink(link.jahr, link.monat, urlEdit, adminName || 'Admin');
      setBearbeiten(false);
    } finally {
      setSaving(false);
    }
  }
  async function loeschen() {
    if (!confirm('Diesen Drive-Link wirklich löschen?')) return;
    await loescheLohnbueroDriveLink(link.id);
  }

  return (
    <tr className="hover:bg-gray-50">
      <td className="px-3 py-2 font-medium text-gray-900">{link.jahr}</td>
      <td className="px-3 py-2 text-gray-700">
        {link.monat == null ? <span className="text-gray-400 italic">Jahresordner</span> : MONATSNAMEN[link.monat - 1]}
      </td>
      <td className="px-3 py-2">
        {bearbeiten ? (
          <input
            type="url"
            value={urlEdit}
            onChange={(e) => setUrlEdit(e.target.value)}
            className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
            autoFocus
          />
        ) : (
          <a
            href={link.url}
            target="_blank"
            rel="noreferrer"
            className="text-blue-700 underline hover:text-blue-900 break-all"
          >
            📁 im Drive öffnen
          </a>
        )}
      </td>
      <td className="px-3 py-2 text-xs text-gray-500 whitespace-nowrap">
        {new Date(link.aktualisiertAm).toLocaleDateString('de-DE')}
        {link.aktualisiertVon && <div className="text-[10px] text-gray-400">{link.aktualisiertVon}</div>}
      </td>
      <td className="px-3 py-2 text-right whitespace-nowrap">
        {bearbeiten ? (
          <>
            <button
              type="button"
              onClick={speichern}
              disabled={saving}
              className="text-xs bg-blue-600 text-white px-2.5 py-1 rounded hover:bg-blue-700 disabled:opacity-50 mr-1.5"
            >
              {saving ? '…' : 'Speichern'}
            </button>
            <button
              type="button"
              onClick={() => { setBearbeiten(false); setUrlEdit(link.url); }}
              className="text-xs text-gray-500 hover:text-gray-700"
            >
              Abbrechen
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() => setBearbeiten(true)}
              className="text-xs text-blue-600 hover:text-blue-800 px-2"
              title="Link bearbeiten"
            >
              ✎
            </button>
            <button
              type="button"
              onClick={loeschen}
              className="text-xs text-red-500 hover:text-red-700 px-2"
              title="Link löschen"
            >
              ✕
            </button>
          </>
        )}
      </td>
    </tr>
  );
}

// ---- Volltext-Filter über Name + Nummer ---------------------

function matchSuche(
  hayParts: Array<string | undefined | null>,
  query: string,
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const tokens = q.split(/\s+/).filter(Boolean);
  const hay = hayParts.filter(Boolean).join(' ').toLowerCase();
  return tokens.every((t) => hay.includes(t));
}

function deepLink(fileId: string, seite: number): string {
  return `https://drive.google.com/file/d/${fileId}/view#page=${seite}`;
}

// ---- Tab: Abrechnungen --------------------------------------

function AbrechnungenTab({
  eintraege,
  maMap,
  mitarbeiter,
  onZuordnen,
  appBruttoMap,
}: {
  eintraege: LohnbueroAbrechnung[];
  maMap: Map<string, Mitarbeiter>;
  mitarbeiter: Mitarbeiter[];
  onZuordnen: (nameRoh: string) => void;
  appBruttoMap: Map<string, number>;
}) {
  const [filterText, setFilterText] = useState('');
  const [filterJahr, setFilterJahr] = useState<number | ''>('');
  const [filterMonat, setFilterMonat] = useState<number | ''>('');
  const [filterKorrektur, setFilterKorrektur] = useState<'' | 'nur' | 'ohne'>('');
  const [filterMatch, setFilterMatch] = useState<'' | 'ohneMatch' | 'mitMatch'>('');
  const [filterRolle, setFilterRolle] = useState<Rolle | ''>('');
  const [filterMinijob, setFilterMinijob] = useState<'' | 'ja' | 'nein'>('');
  const [filterSvFrei, setFilterSvFrei] = useState<'' | 'ja' | 'nein'>('');

  const jahre = useMemo(() => {
    return [...new Set(eintraege.map((e) => e.jahr))].sort((a, b) => b - a);
  }, [eintraege]);

  const gefiltert = useMemo(() => {
    return eintraege.filter((e) => {
      if (filterJahr !== '' && e.jahr !== filterJahr) return false;
      if (filterMonat !== '' && e.monat !== filterMonat) return false;
      if (filterKorrektur === 'nur' && !e.istKorrektur) return false;
      if (filterKorrektur === 'ohne' && e.istKorrektur) return false;
      if (filterMatch === 'ohneMatch' && e.mitarbeiterId) return false;
      if (filterMatch === 'mitMatch' && !e.mitarbeiterId) return false;
      // MA-bezogene Filter: greifen nur bei zugeordneten Einträgen.
      // Unzugeordnete fliegen automatisch raus, wenn einer dieser
      // Filter aktiv ist — das ist gewollt (Abrechnungen ohne MA
      // können diese Kriterien nicht erfüllen).
      const ma = e.mitarbeiterId ? maMap.get(e.mitarbeiterId) : null;
      const maFilterAktiv = filterRolle || filterMinijob || filterSvFrei;
      if (maFilterAktiv && !ma) return false;
      if (filterRolle && ma && !ma.rollen?.includes(filterRolle)) return false;
      if (filterMinijob === 'ja' && ma && !ma.istMinijob) return false;
      if (filterMinijob === 'nein' && ma && ma.istMinijob) return false;
      if (filterSvFrei === 'ja' && ma && !ma.sozialversicherungsBefreit) return false;
      if (filterSvFrei === 'nein' && ma && ma.sozialversicherungsBefreit) return false;
      if (filterText.trim()) {
        const ok = matchSuche(
          [e.nameRoh, ma?.name, ma?.nummer, e.personalNrLohnbuero],
          filterText,
        );
        if (!ok) return false;
      }
      return true;
    });
  }, [eintraege, maMap, filterJahr, filterMonat, filterKorrektur, filterMatch, filterText, filterRolle, filterMinijob, filterSvFrei]);

  const sortiert = useMemo(() => {
    return [...gefiltert].sort((a, b) => {
      if (a.jahr !== b.jahr) return b.jahr - a.jahr;
      if (a.monat !== b.monat) return b.monat - a.monat;
      const na = (a.mitarbeiterId ? maMap.get(a.mitarbeiterId)?.name : null) ?? a.nameRoh;
      const nb = (b.mitarbeiterId ? maMap.get(b.mitarbeiterId)?.name : null) ?? b.nameRoh;
      return na.localeCompare(nb, 'de');
    });
  }, [gefiltert, maMap]);

  const ohneMatch = sortiert.filter((e) => e.mitarbeiterId === null);
  const summe = sortiert.reduce(
    (acc, e) => {
      acc.brutto += e.gesamtBrutto ?? 0;
      acc.sv += e.svAbzuege ?? 0;
      acc.netto += e.nettoVerdienst ?? 0;
      acc.auszahlung += e.auszahlungsbetrag ?? 0;
      // App-Brutto-Summe nur über Zeilen, die einen App-Wert haben.
      // Differenz analog — sonst würde die Footer-Summe Äpfel und
      // Birnen mischen.
      const appB = e.mitarbeiterId
        ? appBruttoMap.get(`${e.jahr}-${e.monat}-${e.mitarbeiterId}`)
        : undefined;
      if (appB != null) {
        acc.appBrutto += appB;
        acc.appBruttoCount += 1;
        acc.diff += (e.gesamtBrutto ?? 0) - appB;
      }
      return acc;
    },
    { brutto: 0, sv: 0, netto: 0, auszahlung: 0, appBrutto: 0, appBruttoCount: 0, diff: 0 },
  );

  return (
    <div>
      <FilterLeiste
        filterText={filterText}
        setFilterText={setFilterText}
        filterJahr={filterJahr}
        setFilterJahr={setFilterJahr}
        filterMonat={filterMonat}
        setFilterMonat={setFilterMonat}
        extras={
          <>
            <select
              value={filterMatch}
              onChange={(e) => setFilterMatch(e.target.value as '' | 'ohneMatch' | 'mitMatch')}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
              title="Filter Match-Status"
            >
              <option value="">Match: alle</option>
              <option value="ohneMatch">⚠ nur ohne Match</option>
              <option value="mitMatch">✓ nur mit Match</option>
            </select>
            <select
              value={filterKorrektur}
              onChange={(e) => setFilterKorrektur(e.target.value as '' | 'nur' | 'ohne')}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
              title="Filter Korrektur-PDFs (Nachberechnungen)"
            >
              <option value="">Korrekturen: alle</option>
              <option value="nur">nur Korrekturen</option>
              <option value="ohne">ohne Korrekturen</option>
            </select>
            <select
              value={filterRolle}
              onChange={(e) => setFilterRolle(e.target.value as Rolle | '')}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
              title="Filter MA-Rolle (greift nur bei zugeordneten Einträgen)"
            >
              <option value="">Rolle: alle</option>
              {ALLE_ROLLEN.map((r) => (
                <option key={r} value={r}>{ROLLEN_LABELS[r]}</option>
              ))}
            </select>
            <select
              value={filterMinijob}
              onChange={(e) => setFilterMinijob(e.target.value as '' | 'ja' | 'nein')}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
              title="Filter Minijob"
            >
              <option value="">Minijob: alle</option>
              <option value="ja">nur Minijob</option>
              <option value="nein">nur kein Minijob</option>
            </select>
            <select
              value={filterSvFrei}
              onChange={(e) => setFilterSvFrei(e.target.value as '' | 'ja' | 'nein')}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
              title="Filter SV-Befreiung"
            >
              <option value="">SV-Befreiung: alle</option>
              <option value="ja">nur SV-befreit</option>
              <option value="nein">nur nicht SV-befreit</option>
            </select>
          </>
        }
        jahre={jahre}
        gesamtCount={eintraege.length}
        trefferCount={sortiert.length}
      />

      {ohneMatch.length > 0 && (
        <div className="mb-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          ⚠ {ohneMatch.length} Treffer ohne MA-Match (Name aus PDF konnte
          keinem App-Mitarbeiter zugeordnet werden) — bitte Namen prüfen
          oder MA-Stammdaten ergänzen.
        </div>
      )}

      {sortiert.length === 0 ? (
        <LeerHinweis gesamt={eintraege.length} />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200 text-gray-600 text-xs">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Periode</th>
                <th className="px-3 py-2 text-left font-medium">Mitarbeiter</th>
                <th className="px-3 py-2 text-right font-medium" title="Brutto laut Lohnbüro-PDF">Brutto&nbsp;LB</th>
                <th className="px-3 py-2 text-right font-medium" title="Brutto, der von der App ans Lohnbüro übermittelt wurde (bruttoLohnbuero aus dem App-Abrechnungs-Snapshot)">Brutto&nbsp;App</th>
                <th className="px-3 py-2 text-right font-medium" title="Differenz = Brutto LB − Brutto App. Sollte 0 sein. Abweichungen zeigen Übermittlungsfehler.">Δ</th>
                <th className="px-3 py-2 text-right font-medium">SV-Abzüge</th>
                <th className="px-3 py-2 text-right font-medium">Netto-Verdienst</th>
                <th className="px-3 py-2 text-right font-medium">Auszahlung</th>
                <th className="px-3 py-2 text-left font-medium">PDF</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {sortiert.map((e) => {
                const ma = e.mitarbeiterId ? maMap.get(e.mitarbeiterId) : null;
                const appBrutto = e.mitarbeiterId
                  ? appBruttoMap.get(`${e.jahr}-${e.monat}-${e.mitarbeiterId}`)
                  : undefined;
                const diff = appBrutto != null ? e.gesamtBrutto - appBrutto : null;
                const diffSignifikant = diff != null && Math.abs(diff) >= 0.01;
                return (
                  <tr key={e.id} className={`hover:bg-gray-50 ${e.istKorrektur ? 'bg-orange-50/60' : ''}`}>
                    <td className="px-3 py-2 font-mono text-xs text-gray-700 whitespace-nowrap">
                      {String(e.monat).padStart(2, '0')}/{e.jahr}
                      {e.istKorrektur && (
                        <span className="ml-2 text-[10px] uppercase font-semibold text-orange-600">
                          Korr.
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-gray-900">
                      {ma ? (
                        <>
                          <span className="font-medium">{ma.name}</span>
                          <span className="ml-2 text-xs font-mono text-gray-400">{ma.nummer}</span>
                        </>
                      ) : (
                        <>
                          <span className="text-gray-500 italic">{e.nameRoh}</span>
                          <button
                            type="button"
                            onClick={() => onZuordnen(e.nameRoh)}
                            className="ml-2 text-[10px] text-amber-700 hover:text-amber-900 underline font-medium"
                            title="Diesen Rohnamen einem Mitarbeiter zuordnen"
                          >
                            ⚠ Zuordnen
                          </button>
                        </>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-gray-700">{eur(e.gesamtBrutto)}</td>
                    <td className="px-3 py-2 text-right font-mono text-gray-700">
                      {appBrutto != null ? eur(appBrutto) : <span className="text-gray-300" title="App-Abrechnungs-Snapshot enthält keinen Wert für diesen MA in dieser Periode (z. B. weil die App-Periode noch nicht abgeschlossen ist).">—</span>}
                    </td>
                    <td className={`px-3 py-2 text-right font-mono ${
                      diff == null
                        ? 'text-gray-300'
                        : diffSignifikant
                          ? 'font-semibold text-red-700'
                          : 'text-green-700'
                    }`}>
                      {diff == null
                        ? '—'
                        : diffSignifikant
                          ? (diff > 0 ? '+' : '') + eur(diff)
                          : eur(0)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-gray-700">{eur(e.svAbzuege)}</td>
                    <td className="px-3 py-2 text-right font-mono text-gray-700">{eur(e.nettoVerdienst)}</td>
                    <td className="px-3 py-2 text-right font-mono font-semibold text-gray-900">
                      {eur(e.auszahlungsbetrag)}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      <a
                        href={deepLink(e.fileId, e.seite)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:text-blue-800 underline"
                        title={e.fileName}
                      >
                        Seite {e.seite}
                      </a>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            {sortiert.length > 1 && (
              <tfoot className="bg-gray-50 border-t border-gray-200">
                <tr className="text-xs">
                  <td className="px-3 py-2 font-semibold text-gray-700" colSpan={2}>
                    Summe ({sortiert.length} Zeilen)
                  </td>
                  <td className="px-3 py-2 text-right font-mono font-bold text-gray-900">{eur(summe.brutto)}</td>
                  <td className="px-3 py-2 text-right font-mono text-gray-700" title={`Nur über ${summe.appBruttoCount} Zeilen mit App-Snapshot`}>
                    {summe.appBruttoCount > 0 ? eur(summe.appBrutto) : <span className="text-gray-300">—</span>}
                  </td>
                  <td className={`px-3 py-2 text-right font-mono ${
                    summe.appBruttoCount === 0
                      ? 'text-gray-300'
                      : Math.abs(summe.diff) >= 0.01
                        ? 'font-bold text-red-700'
                        : 'text-green-700'
                  }`}>
                    {summe.appBruttoCount === 0
                      ? '—'
                      : Math.abs(summe.diff) >= 0.01
                        ? (summe.diff > 0 ? '+' : '') + eur(summe.diff)
                        : eur(0)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-gray-700">{eur(summe.sv)}</td>
                  <td className="px-3 py-2 text-right font-mono text-gray-700">{eur(summe.netto)}</td>
                  <td className="px-3 py-2 text-right font-mono font-bold text-gray-900">{eur(summe.auszahlung)}</td>
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}

      <DebugFehlmatchHinweis
        ohneMatch={ohneMatch.map((e) => e.nameRoh)}
        mitarbeiter={mitarbeiter}
        onZuordnen={onZuordnen}
      />
    </div>
  );
}

// ---- Tab: An-/Abmeldungen -----------------------------------

function AnmeldungenTab({
  eintraege,
  maMap,
  mitarbeiter,
  onZuordnen,
}: {
  eintraege: LohnbueroAnmeldung[];
  maMap: Map<string, Mitarbeiter>;
  mitarbeiter: Mitarbeiter[];
  onZuordnen: (nameRoh: string) => void;
}) {
  const [filterText, setFilterText] = useState('');
  const [filterJahr, setFilterJahr] = useState<number | ''>('');
  const [filterMonat, setFilterMonat] = useState<number | ''>('');
  const [filterTyp, setFilterTyp] = useState<'' | 'anmeldung' | 'abmeldung'>('');
  const [filterMatch, setFilterMatch] = useState<'' | 'ohneMatch' | 'mitMatch'>('');
  const [filterRolle, setFilterRolle] = useState<Rolle | ''>('');
  const [filterMinijob, setFilterMinijob] = useState<'' | 'ja' | 'nein'>('');
  const [filterSvFrei, setFilterSvFrei] = useState<'' | 'ja' | 'nein'>('');

  const jahre = useMemo(() => {
    return [...new Set(eintraege.map((e) => e.jahr))].sort((a, b) => b - a);
  }, [eintraege]);

  const gefiltert = useMemo(() => {
    return eintraege.filter((e) => {
      if (filterJahr !== '' && e.jahr !== filterJahr) return false;
      if (filterMonat !== '' && e.monat !== filterMonat) return false;
      if (filterTyp && e.typ !== filterTyp) return false;
      if (filterMatch === 'ohneMatch' && e.mitarbeiterId) return false;
      if (filterMatch === 'mitMatch' && !e.mitarbeiterId) return false;
      const ma = e.mitarbeiterId ? maMap.get(e.mitarbeiterId) : null;
      const maFilterAktiv = filterRolle || filterMinijob || filterSvFrei;
      if (maFilterAktiv && !ma) return false;
      if (filterRolle && ma && !ma.rollen?.includes(filterRolle)) return false;
      if (filterMinijob === 'ja' && ma && !ma.istMinijob) return false;
      if (filterMinijob === 'nein' && ma && ma.istMinijob) return false;
      if (filterSvFrei === 'ja' && ma && !ma.sozialversicherungsBefreit) return false;
      if (filterSvFrei === 'nein' && ma && ma.sozialversicherungsBefreit) return false;
      if (filterText.trim()) {
        const ok = matchSuche(
          [e.nameRoh, ma?.name, ma?.nummer, e.grundDerAbgabe],
          filterText,
        );
        if (!ok) return false;
      }
      return true;
    });
  }, [eintraege, maMap, filterJahr, filterMonat, filterTyp, filterMatch, filterText, filterRolle, filterMinijob, filterSvFrei]);

  const sortiert = useMemo(() => {
    return [...gefiltert].sort((a, b) => {
      if (a.jahr !== b.jahr) return b.jahr - a.jahr;
      if (a.monat !== b.monat) return b.monat - a.monat;
      const na = (a.mitarbeiterId ? maMap.get(a.mitarbeiterId)?.name : null) ?? a.nameRoh;
      const nb = (b.mitarbeiterId ? maMap.get(b.mitarbeiterId)?.name : null) ?? b.nameRoh;
      return na.localeCompare(nb, 'de');
    });
  }, [gefiltert, maMap]);

  const ohneMatch = sortiert.filter((e) => e.mitarbeiterId === null);

  return (
    <div>
      <FilterLeiste
        filterText={filterText}
        setFilterText={setFilterText}
        filterJahr={filterJahr}
        setFilterJahr={setFilterJahr}
        filterMonat={filterMonat}
        setFilterMonat={setFilterMonat}
        extras={
          <>
            <select
              value={filterMatch}
              onChange={(e) => setFilterMatch(e.target.value as '' | 'ohneMatch' | 'mitMatch')}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
              title="Filter Match-Status"
            >
              <option value="">Match: alle</option>
              <option value="ohneMatch">⚠ nur ohne Match</option>
              <option value="mitMatch">✓ nur mit Match</option>
            </select>
            <select
              value={filterTyp}
              onChange={(e) => setFilterTyp(e.target.value as '' | 'anmeldung' | 'abmeldung')}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
            >
              <option value="">Typ: alle</option>
              <option value="anmeldung">nur Anmeldungen</option>
              <option value="abmeldung">nur Abmeldungen</option>
            </select>
            <select
              value={filterRolle}
              onChange={(e) => setFilterRolle(e.target.value as Rolle | '')}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
              title="Filter MA-Rolle (greift nur bei zugeordneten Einträgen)"
            >
              <option value="">Rolle: alle</option>
              {ALLE_ROLLEN.map((r) => (
                <option key={r} value={r}>{ROLLEN_LABELS[r]}</option>
              ))}
            </select>
            <select
              value={filterMinijob}
              onChange={(e) => setFilterMinijob(e.target.value as '' | 'ja' | 'nein')}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
              title="Filter Minijob"
            >
              <option value="">Minijob: alle</option>
              <option value="ja">nur Minijob</option>
              <option value="nein">nur kein Minijob</option>
            </select>
            <select
              value={filterSvFrei}
              onChange={(e) => setFilterSvFrei(e.target.value as '' | 'ja' | 'nein')}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
              title="Filter SV-Befreiung"
            >
              <option value="">SV-Befreiung: alle</option>
              <option value="ja">nur SV-befreit</option>
              <option value="nein">nur nicht SV-befreit</option>
            </select>
          </>
        }
        jahre={jahre}
        gesamtCount={eintraege.length}
        trefferCount={sortiert.length}
      />

      {ohneMatch.length > 0 && (
        <div className="mb-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          ⚠ {ohneMatch.length} Treffer ohne MA-Match.
        </div>
      )}

      {sortiert.length === 0 ? (
        <LeerHinweis gesamt={eintraege.length} />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200 text-gray-600 text-xs">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Periode</th>
                <th className="px-3 py-2 text-left font-medium">Typ</th>
                <th className="px-3 py-2 text-left font-medium">Mitarbeiter</th>
                <th className="px-3 py-2 text-left font-medium">Beschäftigungs-Zeitraum</th>
                <th className="px-3 py-2 text-left font-medium">Grund der Abgabe</th>
                <th className="px-3 py-2 text-left font-medium">PDF</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {sortiert.map((e) => {
                const ma = e.mitarbeiterId ? maMap.get(e.mitarbeiterId) : null;
                const istAb = e.typ === 'abmeldung';
                return (
                  <tr
                    key={e.id}
                    className={`hover:bg-gray-50 ${istAb ? 'bg-red-50/40' : 'bg-green-50/40'}`}
                  >
                    <td className="px-3 py-2 font-mono text-xs text-gray-700 whitespace-nowrap">
                      {String(e.monat).padStart(2, '0')}/{e.jahr}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {istAb ? (
                        <span className="text-red-700 font-semibold">🚪 Abmeldung</span>
                      ) : (
                        <span className="text-green-700 font-semibold">➕ Anmeldung</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-gray-900">
                      {ma ? (
                        <>
                          <span className="font-medium">{ma.name}</span>
                          <span className="ml-2 text-xs font-mono text-gray-400">{ma.nummer}</span>
                        </>
                      ) : (
                        <>
                          <span className="text-gray-500 italic">{e.nameRoh}</span>
                          <button
                            type="button"
                            onClick={() => onZuordnen(e.nameRoh)}
                            className="ml-2 text-[10px] text-amber-700 hover:text-amber-900 underline font-medium"
                            title="Diesen Rohnamen einem Mitarbeiter zuordnen"
                          >
                            ⚠ Zuordnen
                          </button>
                        </>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-700 whitespace-nowrap">
                      {e.beschaeftigungVon && (
                        <span>
                          {new Date(e.beschaeftigungVon).toLocaleDateString('de-DE')}
                        </span>
                      )}
                      {(e.beschaeftigungVon || e.beschaeftigungBis) && <span className="mx-1">–</span>}
                      {e.beschaeftigungBis && (
                        <span>
                          {new Date(e.beschaeftigungBis).toLocaleDateString('de-DE')}
                        </span>
                      )}
                      {!e.beschaeftigungVon && !e.beschaeftigungBis && (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-800">
                      {e.grundDerAbgabe ?? <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      <a
                        href={deepLink(e.fileId, e.seite)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:text-blue-800 underline"
                        title={e.fileName}
                      >
                        Seite {e.seite}
                      </a>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <DebugFehlmatchHinweis
        ohneMatch={ohneMatch.map((e) => e.nameRoh)}
        mitarbeiter={mitarbeiter}
        onZuordnen={onZuordnen}
      />
    </div>
  );
}

// ---- Shared: Filter-Leiste ----------------------------------

const MONATSNAMEN = [
  'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
];

function FilterLeiste({
  filterText,
  setFilterText,
  filterJahr,
  setFilterJahr,
  filterMonat,
  setFilterMonat,
  extras,
  jahre,
  gesamtCount,
  trefferCount,
}: {
  filterText: string;
  setFilterText: (v: string) => void;
  filterJahr: number | '';
  setFilterJahr: (v: number | '') => void;
  filterMonat: number | '';
  setFilterMonat: (v: number | '') => void;
  extras: React.ReactNode;
  jahre: number[];
  gesamtCount: number;
  trefferCount: number;
}) {
  return (
    <div className="flex flex-wrap gap-3 mb-3 items-center">
      <input
        type="text"
        placeholder="Name oder Nummer suchen..."
        value={filterText}
        onChange={(e) => setFilterText(e.target.value)}
        className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-52"
        autoFocus
      />
      <select
        value={filterJahr}
        onChange={(e) => setFilterJahr(e.target.value === '' ? '' : parseInt(e.target.value, 10))}
        className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
      >
        <option value="">Jahr: alle</option>
        {jahre.map((j) => (
          <option key={j} value={j}>{j}</option>
        ))}
      </select>
      <select
        value={filterMonat}
        onChange={(e) => setFilterMonat(e.target.value === '' ? '' : parseInt(e.target.value, 10))}
        className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
      >
        <option value="">Monat: alle</option>
        {MONATSNAMEN.map((n, i) => (
          <option key={i} value={i + 1}>{n}</option>
        ))}
      </select>
      {extras}
      <span className="text-xs text-gray-500 ml-auto">
        {trefferCount} von {gesamtCount}
      </span>
    </div>
  );
}

function LeerHinweis({ gesamt }: { gesamt: number }) {
  return (
    <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 py-8 text-center text-sm text-gray-500">
      {gesamt === 0
        ? 'Noch keine Daten indiziert — bitte das Indexier-Skript laufen lassen.'
        : 'Keine Treffer für die aktiven Filter.'}
    </div>
  );
}

// ---- Liste: Unzugeordnete Namen mit Direkt-Zuordnen-Knopf --

function DebugFehlmatchHinweis({
  ohneMatch,
  mitarbeiter,
  onZuordnen,
}: {
  ohneMatch: string[];
  mitarbeiter: Mitarbeiter[];
  onZuordnen: (nameRoh: string) => void;
}) {
  if (ohneMatch.length === 0) return null;
  // Pro eindeutigem Rohnamen: einfacher Vorschlag (Token-Overlap) als
  // Lese-Hinweis; die eigentliche Zuordnung erfolgt im Modal.
  const counts = new Map<string, number>();
  for (const r of ohneMatch) counts.set(r, (counts.get(r) ?? 0) + 1);
  const uniqueRohnamen = [...counts.keys()].sort((a, b) => (counts.get(b)! - counts.get(a)!));
  const reihen = uniqueRohnamen.map((roh) => {
    const tokens = roh.toLowerCase().split(/\s+/).filter((t) => t.length > 1);
    let best: { ma: Mitarbeiter; overlap: number } | null = null;
    for (const m of mitarbeiter) {
      const maTokens = m.name.toLowerCase().split(/\s+/).filter(Boolean);
      const overlap = tokens.filter((t) => maTokens.some((x) => x.includes(t) || t.includes(x))).length;
      if (!best || overlap > best.overlap) best = { ma: m, overlap };
    }
    return { roh, count: counts.get(roh) ?? 0, vorschlag: best && best.overlap > 0 ? best.ma : null };
  });
  return (
    <details className="mt-4" open={uniqueRohnamen.length <= 10}>
      <summary className="text-xs text-gray-500 cursor-pointer hover:text-gray-800">
        ⚠ Nicht zugeordnete PDF-Namen — {uniqueRohnamen.length} Name(n) auflösen
      </summary>
      <table className="w-full text-xs mt-2">
        <thead className="text-gray-500">
          <tr>
            <th className="text-left py-1">PDF-Rohname</th>
            <th className="text-right py-1 pr-3">Treffer</th>
            <th className="text-left py-1">App-Vorschlag</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {reihen.map((v) => (
            <tr key={v.roh} className="border-t border-gray-100">
              <td className="py-1 font-mono">{v.roh}</td>
              <td className="py-1 text-right pr-3 text-gray-500">{v.count}</td>
              <td className="py-1">
                {v.vorschlag
                  ? <span className="text-gray-700">{v.vorschlag.name} <span className="text-gray-400 font-mono">({v.vorschlag.nummer})</span></span>
                  : <span className="text-gray-400">— kein Vorschlag —</span>}
              </td>
              <td className="py-1 text-right">
                <button
                  type="button"
                  onClick={() => onZuordnen(v.roh)}
                  className="text-blue-600 hover:text-blue-800 underline"
                >
                  Zuordnen
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

// ---- Zuordnen-Modal -----------------------------------------
//
// Zwei Modi:
//  1. "Bestehender MA": Auswahl aus Volltext-Suche über alle MAs.
//  2. "Legacy-MA neu anlegen": Name + Nummer eingeben → wird mit Flag
//     istLegacy=true / isActive=false / abgemeldet=true persistiert.
// In beiden Fällen wird die Zuordnung anschließend auf ALLE
// Lohnbüro-Einträge (Abrechnungen + Anmeldungen) mit identischem
// nameRoh angewendet — der User muss jeden Rohnamen nur einmal
// auflösen, nicht jeden Monat einzeln.

function ZuordnenModal({
  nameRoh,
  mitarbeiter,
  onClose,
  anzahlAbrechnungen,
  anzahlAnmeldungen,
}: {
  nameRoh: string | null;
  mitarbeiter: Mitarbeiter[];
  onClose: () => void;
  anzahlAbrechnungen: number;
  anzahlAnmeldungen: number;
}) {
  const [modus, setModus] = useState<'bestehend' | 'neu'>('bestehend');
  const [suche, setSuche] = useState('');
  const [neuName, setNeuName] = useState('');
  const [neuNummer, setNeuNummer] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);

  const isOpen = nameRoh !== null;
  // Reset state whenever a different Rohname kommt (oder Modal frisch öffnet)
  useEffect(() => {
    if (!isOpen) return;
    setModus('bestehend');
    setSuche(nameRoh ?? '');
    setNeuName(nameRoh ?? '');
    setNeuNummer('');
    setFehler(null);
    setSubmitting(false);
  }, [nameRoh, isOpen]);

  // Volltext-Suche über bestehende MAs
  const trefferMa = useMemo(() => {
    const q = suche.trim().toLowerCase();
    if (!q) return mitarbeiter.slice(0, 50);
    const tokens = q.split(/\s+/).filter(Boolean);
    return mitarbeiter
      .filter((m) => {
        const hay = `${m.name} ${m.nummer}`.toLowerCase();
        return tokens.every((t) => hay.includes(t));
      })
      .slice(0, 100);
  }, [mitarbeiter, suche]);

  // Token-Overlap-Vorschlag (Default-Selektion)
  const vorschlagId = useMemo(() => {
    if (!nameRoh) return '';
    const tokens = nameRoh.toLowerCase().split(/\s+/).filter((t) => t.length > 1);
    let best: { ma: Mitarbeiter; overlap: number } | null = null;
    for (const m of mitarbeiter) {
      const maTokens = m.name.toLowerCase().split(/\s+/).filter(Boolean);
      const overlap = tokens.filter((t) => maTokens.some((x) => x.includes(t) || t.includes(x))).length;
      if (!best || overlap > best.overlap) best = { ma: m, overlap };
    }
    return best && best.overlap > 0 ? best.ma.id : '';
  }, [nameRoh, mitarbeiter]);

  const [auswahlId, setAuswahlId] = useState('');
  useEffect(() => {
    if (isOpen) setAuswahlId(vorschlagId);
    else setAuswahlId('');
  }, [isOpen, vorschlagId]);

  async function handleSubmit() {
    if (!nameRoh) return;
    setFehler(null);
    setSubmitting(true);
    try {
      let zielId = '';
      if (modus === 'bestehend') {
        if (!auswahlId) {
          setFehler('Bitte einen Mitarbeiter auswählen.');
          setSubmitting(false);
          return;
        }
        zielId = auswahlId;
      } else {
        const n = neuName.trim();
        const num = neuNummer.trim();
        if (!n || !num) {
          setFehler('Name und Nummer sind Pflicht.');
          setSubmitting(false);
          return;
        }
        if (mitarbeiter.some((m) => m.nummer === num)) {
          setFehler(`Nummer „${num}" ist bereits vergeben.`);
          setSubmitting(false);
          return;
        }
        zielId = await erstelleLegacyMitarbeiter(n, num);
      }
      const result = await weiseLohnbueroNameRohZu(nameRoh, zielId);
      onClose();
      // Bestätigung nach Erfolg (kleiner Toast über window.alert-Ersatz —
      // hält Code-Aufwand minimal und ist unter Admins akzeptabel).
      const total = result.abrechnungen + result.anmeldungen;
      // setTimeout damit Modal sicher zu ist, bevor alert kommt
      setTimeout(() => {
        alert(`Zuordnung gespeichert: ${result.abrechnungen} Abrechnung(en)` +
          (result.anmeldungen > 0 ? ` + ${result.anmeldungen} An-/Abmeldung(en)` : '') +
          ` (${total} Records aktualisiert).`);
      }, 50);
    } catch (e) {
      console.error(e);
      setFehler(`Fehler: ${e instanceof Error ? e.message : 'unbekannt'}`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="PDF-Namen zuordnen" size="lg">
      {nameRoh && (
        <div className="space-y-4">
          <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm">
            <div className="text-gray-700">PDF-Rohname:</div>
            <div className="font-mono font-semibold text-amber-900 text-base">{nameRoh}</div>
            <div className="text-xs text-gray-600 mt-1">
              Betrifft {anzahlAbrechnungen} Abrechnung(en)
              {anzahlAnmeldungen > 0 && ` + ${anzahlAnmeldungen} An-/Abmeldung(en)`}
              {' '}ohne Match.
            </div>
          </div>

          <div className="flex gap-2 border-b border-gray-200">
            <button
              type="button"
              onClick={() => setModus('bestehend')}
              className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px ${
                modus === 'bestehend'
                  ? 'border-blue-600 text-blue-700'
                  : 'border-transparent text-gray-500 hover:text-gray-800'
              }`}
            >
              Bestehenden MA wählen
            </button>
            <button
              type="button"
              onClick={() => setModus('neu')}
              className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px ${
                modus === 'neu'
                  ? 'border-blue-600 text-blue-700'
                  : 'border-transparent text-gray-500 hover:text-gray-800'
              }`}
            >
              Neu anlegen (Legacy)
            </button>
          </div>

          {modus === 'bestehend' ? (
            <div className="space-y-2">
              <input
                type="text"
                value={suche}
                onChange={(e) => setSuche(e.target.value)}
                placeholder="Name oder Nummer suchen..."
                className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
              />
              <select
                value={auswahlId}
                onChange={(e) => setAuswahlId(e.target.value)}
                className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
                size={Math.min(10, Math.max(4, trefferMa.length))}
              >
                {trefferMa.length === 0 && (
                  <option value="" disabled>— keine Treffer —</option>
                )}
                {trefferMa.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.nummer} — {m.name}
                    {!m.isActive ? ' — inaktiv' : ''}
                    {m.istLegacy ? ' — legacy' : ''}
                  </option>
                ))}
              </select>
              {/* Prominente Anzeige des aktuell ausgewählten MA */}
              {auswahlId && (() => {
                const sel = mitarbeiter.find((m) => m.id === auswahlId);
                if (!sel) return null;
                return (
                  <div className="rounded border border-blue-300 bg-blue-50 px-3 py-2 text-sm">
                    <span className="text-gray-500">Ausgewählt: </span>
                    <span className="font-semibold text-gray-900">{sel.name}</span>
                    <span className="ml-2 font-mono text-blue-700">Nr. {sel.nummer}</span>
                    {!sel.isActive && <span className="ml-2 text-xs text-gray-500">(inaktiv)</span>}
                    {sel.istLegacy && <span className="ml-2 text-xs text-amber-700">(legacy)</span>}
                    {auswahlId === vorschlagId && (
                      <span className="ml-2 text-[11px] text-gray-500">— Vorschlag</span>
                    )}
                  </div>
                );
              })()}
            </div>
          ) : (
            <div className="space-y-3">
              <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-900">
                Wird angelegt als <strong>Legacy</strong>-Mitarbeiter: <em>deaktiviert</em> +
                <em> abgemeldet</em>, ohne Geburtsdatum/Adresse/Rollen.
                Erscheint nicht in aktiven Workflows — nur als Auflöser
                für historische Lohnbüro-Treffer.
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">Name *</label>
                <input
                  type="text"
                  value={neuName}
                  onChange={(e) => setNeuName(e.target.value)}
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
                  placeholder="z. B. Vorname Nachname"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">Mitarbeiternummer *</label>
                <input
                  type="text"
                  value={neuNummer}
                  onChange={(e) => setNeuNummer(e.target.value)}
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm font-mono"
                  placeholder="z. B. 90123"
                />
                <p className="text-[11px] text-gray-500 mt-1">
                  Frei wählbar. Wenn die Lohnbüro-Personal-Nr bekannt ist,
                  diese gerne verwenden — sonst eine eindeutige Kennung.
                </p>
              </div>
            </div>
          )}

          {fehler && (
            <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">
              {fehler}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2 border-t border-gray-200">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900"
              disabled={submitting}
            >
              Abbrechen
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
              disabled={submitting}
            >
              {submitting
                ? `Speichere ${anzahlAbrechnungen + anzahlAnmeldungen} Eintrag(e)…`
                : 'Zuordnen'}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
