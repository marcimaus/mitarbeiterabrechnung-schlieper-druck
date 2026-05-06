import { useState, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import AdminPinGate from '../components/AdminPinGate';
import {
  ladeAusgaben,
  ladeBeilagen,
  ladeZusammentragenEinsaetze,
  setzeZusammentragenEinsatz,
  loescheZusammentragenEinsatz,
  ladeArbeitszeitenFuerAusgabe,
  erstelleArbeitszeit,
  aktualisiereArbeitszeit,
  loescheArbeitszeit,
  aktualisiereAusgabe,
} from '../lib/db';
import type { Ausgabe, Beilage, ZusammentragenEinsatz, Arbeitszeit } from '../types';
import { kwLabel } from '../lib/kalender';
import { berechneZusammentragZeit, formatierStunden } from '../lib/berechnung';
import { pruefeZeitUeberlappung, formatiereUeberlappungsFehler } from '../lib/zeiterfassung';
import { findAbgeschlossenePeriodeFuerZeitraum } from '../lib/abrechnungslogik';
import { istEinsatzbereit } from '../utils';

export default function ZusammentragenScreen() {
  return (
    <AdminPinGate allowedRoles={['admin', 'abrechnung']}>
      <ZusammentragenInhalt />
    </AdminPinGate>
  );
}

function ZusammentragenInhalt() {
  const { teilgebiete, mitarbeiter, touren, abrechnungsperioden, parameter } = useApp();
  const [ausgaben, setAusgaben] = useState<Ausgabe[]>([]);
  const [selectedAusgabeId, setSelectedAusgabeId] = useState('');
  const [alleEinsaetze, setAlleEinsaetze] = useState<ZusammentragenEinsatz[]>([]);
  const [beilagen, setBeilagen] = useState<Beilage[]>([]);
  const [loading, setLoading] = useState(false);

  const [vorarbeitAktiv, setVorarbeitAktiv] = useState(false); // lokaler Toggle-State

  const [tgSaving, setTgSaving] = useState<string | null>(null);

  // ---- Such- und Filter-Zustand ----
  const [suche, setSuche] = useState('');
  const [filterTourId, setFilterTourId] = useState<string>('');
  const [filterStatus, setFilterStatus] = useState<'' | 'zugewiesen' | 'offen'>('');

  // ---- Mehrfachauswahl ----
  const [auswahlIds, setAuswahlIds] = useState<Set<string>>(new Set());
  const [bulkMitarbeiterId, setBulkMitarbeiterId] = useState('');
  const [bulkSaving, setBulkSaving] = useState(false);

  useEffect(() => {
    ladeAusgaben().then((list) => {
      const sorted = [...list].sort((a, b) =>
        b.jahr !== a.jahr ? b.jahr - a.jahr : b.kw - a.kw
      );
      setAusgaben(sorted);
      if (sorted.length > 0) setSelectedAusgabeId(sorted[0].id);
    });
  }, []);

  useEffect(() => {
    if (!selectedAusgabeId) return;
    setLoading(true);
    const ausgabe = ausgaben.find((a) => a.id === selectedAusgabeId);
    // Vorarbeit-Erlaubnis aus der Ausgabe selbst (persistent) — Fallback: alte ZusammentragenEinsatz-Daten
    Promise.all([
      ladeZusammentragenEinsaetze(selectedAusgabeId),
      ladeBeilagen(selectedAusgabeId),
    ]).then(([list, bl]) => {
      setAlleEinsaetze(list);
      setBeilagen(bl);
      setVorarbeitAktiv(
        ausgabe?.vorarbeitFreigegeben === true || list.some((e) => e.istVorarbeit)
      );
      setLoading(false);
    });
  }, [selectedAusgabeId, ausgaben]);

  const reload = async () => {
    if (!selectedAusgabeId) return;
    const list = await ladeZusammentragenEinsaetze(selectedAusgabeId);
    setAlleEinsaetze(list);
  };

  const selectedAusgabe = ausgaben.find((a) => a.id === selectedAusgabeId);

  // Einträge aufteilen
  const vorarbeitEintraege = alleEinsaetze.filter((e) => e.istVorarbeit);
  const normalEinsaetze = alleEinsaetze.filter((e) => !e.istVorarbeit);

  // Map: teilgebietId → Einsatz (für normale Einträge)
  const tgMap = Object.fromEntries(normalEinsaetze.map((e) => [e.teilgebietId, e]));

  const aktiveTeilgebiete = teilgebiete
    .filter((tg) => tg.isActive)
    // Natural Sort: Uslar1 < Uslar2 < … < Uslar10
    .sort((a, b) => a.name.localeCompare(b.name, 'de', { numeric: true }));

  // ---- Filterung ----
  const sucheNorm = suche.trim().toLowerCase();
  const gefilterteTeilgebiete = aktiveTeilgebiete.filter((tg) => {
    if (sucheNorm) {
      const tour = touren.find((t) => t.id === tg.tourId);
      const treffer =
        tg.name.toLowerCase().includes(sucheNorm) ||
        tg.plz.toLowerCase().includes(sucheNorm) ||
        (tour?.name.toLowerCase().includes(sucheNorm) ?? false);
      if (!treffer) return false;
    }
    if (filterTourId && tg.tourId !== filterTourId) return false;
    if (filterStatus) {
      const zugewiesen = !!tgMap[tg.id];
      if (filterStatus === 'zugewiesen' && !zugewiesen) return false;
      if (filterStatus === 'offen' && zugewiesen) return false;
    }
    return true;
  });

  const zusammentraeger = mitarbeiter.filter(
    (m) => istEinsatzbereit(m) && m.rollen.includes('zusammenträger')
  );

  // ---- Vorarbeit-Toggle (an/aus) ---
  async function handleVorarbeitToggle(aktiv: boolean) {
    if (!selectedAusgabe) return;
    // Persistenz: Flag auf der Ausgabe speichern (wird auch in der Lohnberechnung geprüft)
    await aktualisiereAusgabe(selectedAusgabe.id, { vorarbeitFreigegeben: aktiv });
    // Lokale Ausgabenliste aktualisieren
    setAusgaben((prev) => prev.map((a) => a.id === selectedAusgabe.id ? { ...a, vorarbeitFreigegeben: aktiv } : a));
    // Ggf. alte ZusammentragenEinsatz-Vorarbeit-Einträge bei Deaktivierung löschen
    if (!aktiv && vorarbeitEintraege.length > 0) {
      for (const e of vorarbeitEintraege) {
        await loescheZusammentragenEinsatz(e.id);
      }
      await reload();
    }
    setVorarbeitAktiv(aktiv);
  }

  // ---- Vorarbeit-Zeit aktualisieren ---
  async function handleVorarbeitZeitUpdate(einsatz: ZusammentragenEinsatz, h: number, m: number) {
    await setzeZusammentragenEinsatz({
      ausgabeId: einsatz.ausgabeId,
      teilgebietId: einsatz.teilgebietId,
      mitarbeiterId: einsatz.mitarbeiterId,
      stapelBearbeitet: einsatz.stapelBearbeitet,
      istVorarbeit: true,
      vorarbeitMinuten: h * 60 + m,
    });
    await reload();
  }

  // ---- Vorarbeit-Eintrag löschen ---
  async function handleVorarbeitLoeschen(id: string) {
    await loescheZusammentragenEinsatz(id);
    await reload();
  }

  // ---- Mehrfachauswahl ---
  function toggleAuswahl(tgId: string) {
    setAuswahlIds((prev) => {
      const n = new Set(prev);
      if (n.has(tgId)) n.delete(tgId);
      else n.add(tgId);
      return n;
    });
  }
  function toggleAlleGefilterten(alleIds: string[]) {
    const allSelected = alleIds.every((id) => auswahlIds.has(id));
    setAuswahlIds((prev) => {
      const n = new Set(prev);
      if (allSelected) alleIds.forEach((id) => n.delete(id));
      else alleIds.forEach((id) => n.add(id));
      return n;
    });
  }
  function leereAuswahl() {
    setAuswahlIds(new Set());
  }
  async function handleBulkZuweisen() {
    if (!selectedAusgabe || auswahlIds.size === 0) return;
    setBulkSaving(true);
    try {
      for (const tgId of auswahlIds) {
        if (!bulkMitarbeiterId) {
          // Zuweisung entfernen
          const e = tgMap[tgId];
          if (e) await loescheZusammentragenEinsatz(e.id);
        } else {
          await setzeZusammentragenEinsatz({
            ausgabeId: selectedAusgabe.id,
            teilgebietId: tgId,
            mitarbeiterId: bulkMitarbeiterId,
            stapelBearbeitet: selectedAusgabe.stapelAnzahl,
            istVorarbeit: false,
          });
        }
      }
      await reload();
      leereAuswahl();
    } finally {
      setBulkSaving(false);
    }
  }

  // ---- Normales Zusammentragen ---
  async function handleTgChange(teilgebietId: string, mitarbeiterId: string) {
    if (!selectedAusgabe) return;
    setTgSaving(teilgebietId);
    try {
      if (!mitarbeiterId) {
        const e = tgMap[teilgebietId];
        if (e) {
          await loescheZusammentragenEinsatz(e.id);
          await reload();
        }
        return;
      }
      await setzeZusammentragenEinsatz({
        ausgabeId: selectedAusgabe.id,
        teilgebietId,
        mitarbeiterId,
        stapelBearbeitet: selectedAusgabe.stapelAnzahl,
        istVorarbeit: false,
      });
      await reload();
    } finally {
      setTgSaving(null);
    }
  }

  const zugehoerigerPeriode = selectedAusgabe
    ? abrechnungsperioden.find((p) => p.jahr === selectedAusgabe.jahr && p.kalenderwochen.includes(selectedAusgabe.kw))
    : undefined;
  // Sperre: Periode abgeschlossen ODER Monatswechsel durchgeführt
  // (nach Monatswechsel würden Mengenänderungen die fixierten Werte verschieben).
  const istAbgeschlossen = zugehoerigerPeriode?.status === 'abgeschlossen';
  const istMonatswechsel = !!zugehoerigerPeriode?.monatswechselSnapshot;
  const istGesperrt = istAbgeschlossen || istMonatswechsel;
  const zugewiesen = normalEinsaetze.length;
  const gesamt = aktiveTeilgebiete.length;

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Zusammentragen</h1>

      {/* Ausgabeauswahl */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
        <div className="flex items-center gap-4 flex-wrap">
          <label className="text-sm font-medium text-gray-700">Ausgabe:</label>
          <select
            value={selectedAusgabeId}
            onChange={(e) => setSelectedAusgabeId(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {ausgaben.map((a) => (
              <option key={a.id} value={a.id}>
                {kwLabel(a.kw, a.jahr)} — {a.stapelAnzahl} Stapel ({a.seitenzahl} S.)
              </option>
            ))}
          </select>
          {selectedAusgabe && (
            <span className="inline-flex items-center gap-1 bg-blue-100 text-blue-800 text-xs font-semibold px-2.5 py-1 rounded-full">
              📦 {selectedAusgabe.stapelAnzahl} Stapel je Teilgebiet
            </span>
          )}
          {!loading && (
            <div className="ml-auto flex items-center gap-2">
              <span className="text-sm text-gray-500">{zugewiesen}/{gesamt} TG</span>
              <div className="h-2 w-24 bg-gray-200 rounded-full overflow-hidden">
                <div
                  className="h-full bg-green-500 rounded-full transition-all"
                  style={{ width: `${gesamt > 0 ? (zugewiesen / gesamt) * 100 : 0}%` }}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {loading && <div className="text-center py-8 text-gray-400">Lade Daten...</div>}

      {istAbgeschlossen && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-800 flex items-center gap-2">
          🔒 Diese Ausgabe gehört zu einer <strong>abgeschlossenen Abrechnungsperiode</strong> — keine Änderungen mehr möglich.
        </div>
      )}
      {!istAbgeschlossen && istMonatswechsel && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 text-sm text-emerald-900 flex items-center gap-2">
          📌 Für diese Periode wurde der <strong>Monatswechsel durchgeführt</strong> — Zusammentragen ist fixiert; Änderungen würden die fixierten Werte verschieben.
        </div>
      )}

      {!loading && selectedAusgabe && (
        <>
          {/* ---- VORARBEIT-SEKTION ---- */}
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-5">
            <div className="flex items-center gap-3 mb-4">
              <label className={`flex items-center gap-2 ${!istGesperrt ? 'cursor-pointer' : 'opacity-60'}`}>
                <input
                  type="checkbox"
                  checked={vorarbeitAktiv}
                  disabled={istGesperrt}
                  onChange={(e) => {
                    if (!istGesperrt) handleVorarbeitToggle(e.target.checked);
                  }}
                  className="w-4 h-4 accent-amber-600"
                />
                <span className="font-semibold text-amber-900">Vorarbeit für diese Ausgabe erlauben</span>
              </label>
              <span className="text-xs text-amber-700">
                (Zusatzarbeit vor dem eigentlichen Zusammentragen, wird nach Zeit abgerechnet)
              </span>
            </div>

            {vorarbeitAktiv && (
              <div className="space-y-3">
                {/* Bestehende Vorarbeit-Einträge */}
                {vorarbeitEintraege.map((e) => {
                  const ma = mitarbeiter.find((m) => m.id === e.mitarbeiterId);
                  const h = Math.floor((e.vorarbeitMinuten ?? 0) / 60);
                  const m = (e.vorarbeitMinuten ?? 0) % 60;
                  return (
                    <div key={e.id} className="flex items-center gap-3 bg-white rounded-lg border border-amber-200 px-4 py-2.5">
                      <span className="font-medium text-gray-900 w-40 shrink-0">{ma?.name ?? '?'}</span>
                      <VorarbeitZeitEingabe
                        stunden={h}
                        minuten={m}
                        onSave={(nh, nm) => handleVorarbeitZeitUpdate(e, nh, nm)}
                      />
                      <button
                        onClick={() => handleVorarbeitLoeschen(e.id)}
                        disabled={istGesperrt}
                        className="ml-auto text-red-400 hover:text-red-600 text-sm px-2 py-1 rounded hover:bg-red-50 transition-colors disabled:opacity-40"
                        title="Eintrag löschen"
                      >
                        ✕
                      </button>
                    </div>
                  );
                })}

              </div>
            )}

            {!vorarbeitAktiv && (
              <p className="text-sm text-amber-700">
                Haken setzen um Vorarbeit-Zeiten für diese Ausgabe zu erfassen.
              </p>
            )}

            {vorarbeitAktiv && (
              <ArbeitszeitVorarbeitSektion
                ausgabeId={selectedAusgabe.id}
                gesperrt={istGesperrt}
                zusammentraeger={zusammentraeger}
              />
            )}
          </div>

          {/* ---- NORMALES ZUSAMMENTRAGEN (per Teilgebiet) ---- */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 bg-gray-50 flex flex-wrap items-center gap-3">
              <h2 className="font-semibold text-gray-800 text-sm mr-2">Zusammentragen je Teilgebiet</h2>
              <input
                type="text"
                placeholder="Suche Teilgebiet, PLZ, Tour…"
                value={suche}
                onChange={(e) => setSuche(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-56"
              />
              <select
                value={filterTourId}
                onChange={(e) => setFilterTourId(e.target.value)}
                className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">— alle Touren —</option>
                {touren.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value as '' | 'zugewiesen' | 'offen')}
                className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">— alle Status —</option>
                <option value="zugewiesen">Zugewiesen</option>
                <option value="offen">Offen</option>
              </select>
              {(suche || filterTourId || filterStatus) && (
                <button
                  type="button"
                  onClick={() => { setSuche(''); setFilterTourId(''); setFilterStatus(''); }}
                  className="text-xs text-gray-500 hover:text-gray-700 underline"
                >
                  Filter zurücksetzen
                </button>
              )}
              <span className="ml-auto text-xs text-gray-500">
                {gefilterteTeilgebiete.length} von {aktiveTeilgebiete.length}
              </span>
            </div>
            {/* ---- Bulk-Aktionsleiste ---- */}
            {auswahlIds.size > 0 && !istGesperrt && (
              <div className="px-4 py-2.5 bg-blue-50 border-b border-blue-200 flex flex-wrap items-center gap-3">
                <span className="text-sm font-medium text-blue-900">
                  {auswahlIds.size} Teilgebiet{auswahlIds.size === 1 ? '' : 'e'} ausgewählt
                </span>
                <select
                  value={bulkMitarbeiterId}
                  onChange={(e) => setBulkMitarbeiterId(e.target.value)}
                  className="border border-blue-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">— Zuweisung entfernen —</option>
                  {zusammentraeger.map((m) => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={handleBulkZuweisen}
                  disabled={bulkSaving}
                  className="bg-blue-600 text-white px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
                >
                  {bulkSaving ? '…' : bulkMitarbeiterId ? 'Zuweisen' : 'Entfernen'}
                </button>
                <button
                  type="button"
                  onClick={leereAuswahl}
                  className="text-xs text-gray-500 hover:text-gray-700 underline"
                >
                  Auswahl leeren
                </button>
              </div>
            )}
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-3 py-3 w-8 text-center">
                    <input
                      type="checkbox"
                      disabled={istGesperrt || gefilterteTeilgebiete.length === 0}
                      checked={
                        gefilterteTeilgebiete.length > 0 &&
                        gefilterteTeilgebiete.every((tg) => auswahlIds.has(tg.id))
                      }
                      onChange={() => toggleAlleGefilterten(gefilterteTeilgebiete.map((tg) => tg.id))}
                      className="w-4 h-4 rounded"
                      title="Alle in der aktuellen Filteransicht auswählen"
                    />
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Teilgebiet</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Tour</th>
                  <th className="px-4 py-3 text-right font-medium text-gray-600" title="Anzahl interner Beilagen dieses Teilgebiets">int. Beil.</th>
                  <th className="px-4 py-3 text-right font-medium text-gray-600" title="Soll-Zeit für das Zusammentragen">Soll-Zeit</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Zusammenträger</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {gefilterteTeilgebiete.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-sm text-gray-400">
                      Keine Teilgebiete entsprechen den Filterkriterien.
                    </td>
                  </tr>
                )}
                {gefilterteTeilgebiete.map((tg) => {
                  const e = tgMap[tg.id];
                  const tour = touren.find((t) => t.id === tg.tourId);
                  const isSaving = tgSaving === tg.id;
                  const selected = auswahlIds.has(tg.id);
                  const intBeilTg = beilagen.filter(
                    (b) => b.kennzeichen === 'int' && b.teilgebietIds.includes(tg.id)
                  ).length;
                  const sollZeitH = selectedAusgabe && parameter
                    ? berechneZusammentragZeit(
                        tg.stueckzahl,
                        selectedAusgabe.stapelAnzahl,
                        intBeilTg,
                        parameter
                      )
                    : 0;

                  return (
                    <tr key={tg.id} className={selected ? 'bg-blue-50' : (e ? 'bg-white' : 'bg-gray-50')}>
                      <td className="px-3 py-2.5 text-center">
                        <input
                          type="checkbox"
                          disabled={istGesperrt}
                          checked={selected}
                          onChange={() => toggleAuswahl(tg.id)}
                          className="w-4 h-4 rounded"
                        />
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="font-medium text-gray-900">{tg.name}</div>
                        <div className="text-xs text-gray-400">{tg.plz} · {tg.stueckzahl} Stk</div>
                      </td>
                      <td className="px-4 py-2.5">
                        {tour ? (
                          <span
                            className="text-xs font-medium px-2 py-0.5 rounded-full text-white"
                            style={{ backgroundColor: tour.farbe }}
                          >
                            {tour.name}
                          </span>
                        ) : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-4 py-2.5 text-right text-xs text-gray-600">
                        {intBeilTg > 0 ? intBeilTg : <span className="text-gray-300">0</span>}
                      </td>
                      <td className="px-4 py-2.5 text-right text-xs font-mono text-gray-700">
                        {sollZeitH > 0 ? formatierStunden(sollZeitH) : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          <select
                            value={e?.mitarbeiterId ?? ''}
                            onChange={(ev) => handleTgChange(tg.id, ev.target.value)}
                            disabled={isSaving || istGesperrt}
                            className={`border rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                              e ? 'border-green-300 bg-green-50' : 'border-gray-300'
                            }`}
                          >
                            <option value="">— nicht zugewiesen —</option>
                            {zusammentraeger.map((m) => (
                              <option key={m.id} value={m.id}>{m.name}</option>
                            ))}
                          </select>
                          {isSaving && <span className="text-xs text-gray-400 animate-pulse">...</span>}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {/* Summenzeile über die GEFILTERTEN Teilgebiete */}
                {gefilterteTeilgebiete.length > 0 && (() => {
                  const summeStueck = gefilterteTeilgebiete.reduce((s, tg) => s + tg.stueckzahl, 0);
                  const summeIntBeil = gefilterteTeilgebiete.reduce((s, tg) =>
                    s + beilagen.filter(
                      (b) => b.kennzeichen === 'int' && b.teilgebietIds.includes(tg.id)
                    ).length, 0);
                  const summeSollZeit = gefilterteTeilgebiete.reduce((s, tg) => {
                    if (!selectedAusgabe || !parameter) return s;
                    const intBeilTg = beilagen.filter(
                      (b) => b.kennzeichen === 'int' && b.teilgebietIds.includes(tg.id)
                    ).length;
                    return s + berechneZusammentragZeit(
                      tg.stueckzahl,
                      selectedAusgabe.stapelAnzahl,
                      intBeilTg,
                      parameter
                    );
                  }, 0);
                  return (
                    <tr className="bg-blue-50 border-t-2 border-blue-200 font-semibold">
                      <td className="px-3 py-2.5"></td>
                      <td className="px-4 py-2.5 text-gray-900">
                        Σ {gefilterteTeilgebiete.length} TG
                        {gefilterteTeilgebiete.length !== aktiveTeilgebiete.length && (
                          <span className="ml-1 font-normal text-xs text-gray-500">
                            (von {aktiveTeilgebiete.length})
                          </span>
                        )}
                        <div className="text-xs text-gray-500 font-normal">
                          {summeStueck.toLocaleString('de-DE')} Stk
                        </div>
                      </td>
                      <td></td>
                      <td className="px-4 py-2.5 text-right text-xs text-gray-700">
                        {summeIntBeil > 0 ? summeIntBeil : '—'}
                      </td>
                      <td className="px-4 py-2.5 text-right text-xs font-mono text-gray-900">
                        {summeSollZeit > 0 ? formatierStunden(summeSollZeit) : '—'}
                      </td>
                      <td></td>
                    </tr>
                  );
                })()}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

// ---- Vorarbeit-Zeit-Eingabe ------------------------------------

function VorarbeitZeitEingabe({
  stunden,
  minuten,
  onSave,
}: {
  stunden: number;
  minuten: number;
  onSave: (h: number, m: number) => void;
}) {
  const [h, setH] = useState(stunden.toString());
  const [m, setM] = useState(minuten.toString().padStart(2, '0'));

  // Props-Änderung (z.B. nach Reload) übernehmen
  useEffect(() => {
    setH(stunden.toString());
    setM(minuten.toString().padStart(2, '0'));
  }, [stunden, minuten]);

  function handleBlur() {
    const hn = Math.max(0, parseInt(h) || 0);
    const mn = Math.max(0, Math.min(59, parseInt(m) || 0));
    onSave(hn, mn);
  }

  return (
    <div className="flex items-center gap-1">
      <input
        type="number"
        min="0"
        max="23"
        value={h}
        onChange={(e) => setH(e.target.value)}
        onBlur={handleBlur}
        className="w-12 border border-gray-300 rounded px-1.5 py-1 text-sm text-center focus:outline-none focus:ring-1 focus:ring-amber-500"
        title="Stunden"
      />
      <span className="text-gray-400 font-bold">:</span>
      <input
        type="number"
        min="0"
        max="59"
        value={m}
        onChange={(e) => setM(e.target.value)}
        onBlur={handleBlur}
        className="w-12 border border-gray-300 rounded px-1.5 py-1 text-sm text-center focus:outline-none focus:ring-1 focus:ring-amber-500"
        title="Minuten"
      />
      <span className="text-xs text-gray-400 ml-0.5">h</span>
    </div>
  );
}

// ---- Arbeitszeit-basierte Vorarbeit-Sektion -------------------
// Zeigt alle Arbeitszeit-Einträge mit typ='vorarbeit' und ausgabeId=<aktuelle Ausgabe>
// Ermöglicht Neuanlage, Bearbeitung (Start/Ende) und Löschen.

function ArbeitszeitVorarbeitSektion({
  ausgabeId,
  gesperrt,
  zusammentraeger,
}: {
  ausgabeId: string;
  gesperrt: boolean;
  zusammentraeger: ReturnType<typeof useApp>['mitarbeiter'];
}) {
  const [zeiten, setZeiten] = useState<Arbeitszeit[]>([]);
  const [loading, setLoading] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [neuForm, setNeuForm] = useState(false);

  async function reload() {
    setLoading(true);
    try {
      const all = await ladeArbeitszeitenFuerAusgabe(ausgabeId);
      setZeiten(all.filter((a) => a.typ === 'vorarbeit').sort((a, b) => b.startTime - a.startTime));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ausgabeId]);

  function formatDauer(a: Arbeitszeit): string {
    if (!a.endTime) return '— aktiv —';
    const ms = a.endTime - a.startTime - (a.gesamtPauseMinuten ?? 0) * 60_000;
    const min = Math.max(0, Math.round(ms / 60_000));
    const h = Math.floor(min / 60);
    const m = min % 60;
    return `${h}h ${m.toString().padStart(2, '0')}min`;
  }

  function formatDatum(ts: number): string {
    const d = new Date(ts);
    return d.toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  async function handleLoeschen(id: string) {
    if (!confirm('Diesen Vorarbeit-Eintrag wirklich löschen?')) return;
    await loescheArbeitszeit(id);
    await reload();
  }

  return (
    <div className="mt-5 pt-4 border-t border-amber-200">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-amber-900">
          Erfasste Vorarbeitszeiten (aus Zeiterfassung) — {zeiten.length}
        </h3>
        {!gesperrt && !neuForm && (
          <button
            onClick={() => setNeuForm(true)}
            className="text-xs bg-white border border-amber-400 text-amber-800 px-2.5 py-1 rounded hover:bg-amber-100 font-medium"
          >
            + Zeit hinzufügen
          </button>
        )}
      </div>

      {loading && <p className="text-xs text-amber-700">Lade...</p>}

      {!loading && zeiten.length === 0 && !neuForm && (
        <p className="text-xs text-amber-700 italic">Noch keine Arbeitszeit-Einträge für diese Ausgabe erfasst.</p>
      )}

      <div className="space-y-2">
        {zeiten.map((z) => {
          const ma = zusammentraeger.find((m) => m.id === z.mitarbeiterId)
            ?? { id: z.mitarbeiterId, name: '(unbekannt / andere Rolle)' } as { id: string; name: string };
          const isEditing = editId === z.id;
          if (isEditing) {
            return (
              <ArbeitszeitEditForm
                key={z.id}
                arbeitszeit={z}
                maName={ma.name}
                onCancel={() => setEditId(null)}
                onSaved={async () => { setEditId(null); await reload(); }}
              />
            );
          }
          return (
            <div key={z.id} className="flex items-center gap-3 bg-white rounded-lg border border-amber-200 px-4 py-2">
              <span className="font-medium text-gray-900 w-40 shrink-0 text-sm">{ma.name}</span>
              <span className="text-xs text-gray-600">
                {formatDatum(z.startTime)}
                {z.endTime ? ` → ${formatDatum(z.endTime)}` : ''}
              </span>
              <span className="text-xs font-semibold text-amber-800 ml-2">{formatDauer(z)}</span>
              <span className="text-[10px] uppercase tracking-wide text-gray-400 ml-auto">{z.quelle}</span>
              {!gesperrt && (
                <>
                  <button
                    onClick={() => setEditId(z.id)}
                    className="text-blue-500 hover:text-blue-700 text-xs px-2 py-0.5 rounded hover:bg-blue-50"
                  >
                    Bearbeiten
                  </button>
                  <button
                    onClick={() => handleLoeschen(z.id)}
                    className="text-red-400 hover:text-red-600 text-sm px-2 py-0.5 rounded hover:bg-red-50"
                    title="Eintrag löschen"
                  >
                    ✕
                  </button>
                </>
              )}
            </div>
          );
        })}

        {neuForm && (
          <ArbeitszeitNeuForm
            ausgabeId={ausgabeId}
            zusammentraeger={zusammentraeger}
            onCancel={() => setNeuForm(false)}
            onSaved={async () => { setNeuForm(false); await reload(); }}
          />
        )}
      </div>
    </div>
  );
}

// ---- Neu-Form für Arbeitszeit-Vorarbeit -----------------------

function ArbeitszeitNeuForm({
  ausgabeId,
  zusammentraeger,
  onCancel,
  onSaved,
}: {
  ausgabeId: string;
  zusammentraeger: ReturnType<typeof useApp>['mitarbeiter'];
  onCancel: () => void;
  onSaved: () => Promise<void> | void;
}) {
  const { abrechnungsperioden } = useApp();
  const heute = new Date();
  const defDatum = heute.toISOString().slice(0, 10);
  const [maId, setMaId] = useState('');
  const [datum, setDatum] = useState(defDatum);
  const [startZeit, setStartZeit] = useState('08:00');
  const [endZeit, setEndZeit] = useState('10:00');
  const [saving, setSaving] = useState(false);

  // Live-Warnung wenn der gewählte Zeitraum eine abgeschlossene Periode berührt.
  const warnungPeriode = (() => {
    const start = new Date(`${datum}T${startZeit}:00`).getTime();
    const end = new Date(`${datum}T${endZeit}:00`).getTime();
    return findAbgeschlossenePeriodeFuerZeitraum(
      abrechnungsperioden,
      start,
      end > start ? end : start
    );
  })();

  async function handleSpeichern() {
    if (!maId) return;
    const start = new Date(`${datum}T${startZeit}:00`).getTime();
    const end = new Date(`${datum}T${endZeit}:00`).getTime();
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      alert('Ende muss nach Start liegen.');
      return;
    }
    setSaving(true);
    try {
      const konflikt = await pruefeZeitUeberlappung(maId, start, end);
      if (konflikt) {
        alert(formatiereUeberlappungsFehler(konflikt));
        setSaving(false);
        return;
      }
      await erstelleArbeitszeit({
        mitarbeiterId: maId,
        startTime: start,
        endTime: end,
        status: 'abgeschlossen',
        quelle: 'manuell',
        typ: 'vorarbeit',
        pausen: [],
        gesamtPauseMinuten: 0,
        korrekturLog: [{
          zeitstempel: Date.now(),
          adminName: 'Admin',
          aktion: 'Vorarbeit manuell erfasst (Zusammentragen-Screen)',
        }],
        ausgabeId,
      });
      await onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="bg-white rounded-lg border-2 border-dashed border-amber-400 p-3 space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <select
          value={maId}
          onChange={(e) => setMaId(e.target.value)}
          className="border border-gray-300 rounded px-2 py-1.5 text-sm"
        >
          <option value="">— Mitarbeiter wählen —</option>
          {zusammentraeger.map((m) => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
        </select>
        <input
          type="date"
          value={datum}
          onChange={(e) => setDatum(e.target.value)}
          className="border border-gray-300 rounded px-2 py-1.5 text-sm"
        />
        <input
          type="time"
          value={startZeit}
          onChange={(e) => setStartZeit(e.target.value)}
          className="border border-gray-300 rounded px-2 py-1.5 text-sm"
        />
        <span className="text-gray-400">bis</span>
        <input
          type="time"
          value={endZeit}
          onChange={(e) => setEndZeit(e.target.value)}
          className="border border-gray-300 rounded px-2 py-1.5 text-sm"
        />
        <button
          onClick={handleSpeichern}
          disabled={!maId || saving}
          className="bg-amber-600 text-white px-3 py-1.5 rounded text-sm font-medium hover:bg-amber-700 disabled:opacity-50"
        >
          {saving ? '...' : 'Speichern'}
        </button>
        <button
          onClick={onCancel}
          className="text-gray-500 hover:text-gray-700 text-sm px-2"
        >
          Abbrechen
        </button>
      </div>
      {warnungPeriode && (
        <div className="rounded border border-amber-300 bg-amber-50 px-2 py-1.5 text-xs text-amber-900">
          ⚠ <span className="font-medium">{warnungPeriode.bezeichnung}</span> ist
          bereits abgeschlossen. Die Zeit kann gespeichert werden, fließt aber
          nicht mehr in die Abrechnung ein.
        </div>
      )}
    </div>
  );
}

// ---- Edit-Form für Arbeitszeit-Vorarbeit ----------------------

function ArbeitszeitEditForm({
  arbeitszeit,
  maName,
  onCancel,
  onSaved,
}: {
  arbeitszeit: Arbeitszeit;
  maName: string;
  onCancel: () => void;
  onSaved: () => Promise<void> | void;
}) {
  const { abrechnungsperioden } = useApp();
  const startDate = new Date(arbeitszeit.startTime);
  const endDate = arbeitszeit.endTime ? new Date(arbeitszeit.endTime) : new Date(arbeitszeit.startTime + 60 * 60_000);
  const pad = (n: number) => n.toString().padStart(2, '0');
  const toDatum = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const toZeit = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const [datum, setDatum] = useState(toDatum(startDate));
  const [startZeit, setStartZeit] = useState(toZeit(startDate));
  const [endZeit, setEndZeit] = useState(toZeit(endDate));
  const [saving, setSaving] = useState(false);

  const warnungPeriode = (() => {
    const start = new Date(`${datum}T${startZeit}:00`).getTime();
    const end = new Date(`${datum}T${endZeit}:00`).getTime();
    return findAbgeschlossenePeriodeFuerZeitraum(
      abrechnungsperioden,
      start,
      end > start ? end : start
    );
  })();

  async function handleSpeichern() {
    const start = new Date(`${datum}T${startZeit}:00`).getTime();
    const end = new Date(`${datum}T${endZeit}:00`).getTime();
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      alert('Ende muss nach Start liegen.');
      return;
    }
    setSaving(true);
    try {
      const konflikt = await pruefeZeitUeberlappung(arbeitszeit.mitarbeiterId, start, end, arbeitszeit.id);
      if (konflikt) {
        alert(formatiereUeberlappungsFehler(konflikt));
        setSaving(false);
        return;
      }
      await aktualisiereArbeitszeit(arbeitszeit.id, {
        startTime: start,
        endTime: end,
        status: 'abgeschlossen',
        korrekturLog: [
          ...(arbeitszeit.korrekturLog ?? []),
          {
            zeitstempel: Date.now(),
            adminName: 'Admin',
            aktion: 'Vorarbeit Zeitbereich geändert (Zusammentragen-Screen)',
          },
        ],
      });
      await onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="bg-blue-50 rounded-lg border-2 border-blue-300 p-3 space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-medium text-gray-900 w-40 shrink-0 text-sm">{maName}</span>
        <input
          type="date"
          value={datum}
          onChange={(e) => setDatum(e.target.value)}
          className="border border-gray-300 rounded px-2 py-1.5 text-sm"
        />
        <input
          type="time"
          value={startZeit}
          onChange={(e) => setStartZeit(e.target.value)}
          className="border border-gray-300 rounded px-2 py-1.5 text-sm"
        />
        <span className="text-gray-400">bis</span>
        <input
          type="time"
          value={endZeit}
          onChange={(e) => setEndZeit(e.target.value)}
          className="border border-gray-300 rounded px-2 py-1.5 text-sm"
        />
        <button
          onClick={handleSpeichern}
          disabled={saving}
          className="bg-blue-600 text-white px-3 py-1.5 rounded text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? '...' : 'Speichern'}
        </button>
        <button
          onClick={onCancel}
          className="text-gray-500 hover:text-gray-700 text-sm px-2"
        >
          Abbrechen
        </button>
      </div>
      {warnungPeriode && (
        <div className="rounded border border-amber-300 bg-amber-50 px-2 py-1.5 text-xs text-amber-900">
          ⚠ <span className="font-medium">{warnungPeriode.bezeichnung}</span> ist
          bereits abgeschlossen. Die Änderung kann gespeichert werden, fließt
          aber nicht mehr in die Abrechnung ein.
        </div>
      )}
    </div>
  );
}
