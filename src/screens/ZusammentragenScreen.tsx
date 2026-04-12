import { useState, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import AdminPinGate from '../components/AdminPinGate';
import {
  ladeAusgaben,
  ladeZusammentragenEinsaetze,
  setzeZusammentragenEinsatz,
  loescheZusammentragenEinsatz,
} from '../lib/db';
import type { Ausgabe, ZusammentragenEinsatz } from '../types';
import { kwLabel } from '../lib/kalender';

// Sentinel-ID für Vorarbeit-Einträge (kein echtes Teilgebiet)
const VORARBEIT_TG_ID = '__vorarbeit__';

export default function ZusammentragenScreen() {
  return (
    <AdminPinGate>
      <ZusammentragenInhalt />
    </AdminPinGate>
  );
}

function ZusammentragenInhalt() {
  const { teilgebiete, mitarbeiter, touren } = useApp();
  const [ausgaben, setAusgaben] = useState<Ausgabe[]>([]);
  const [selectedAusgabeId, setSelectedAusgabeId] = useState('');
  const [alleEinsaetze, setAlleEinsaetze] = useState<ZusammentragenEinsatz[]>([]);
  const [loading, setLoading] = useState(false);

  // Vorarbeit-Dialog-State
  const [vorarbeitNeuMA, setVorarbeitNeuMA] = useState('');
  const [vorarbeitNeuH, setVorarbeitNeuH] = useState('0');
  const [vorarbeitNeuM, setVorarbeitNeuM] = useState('00');
  const [vorarbeitSaving, setVorarbeitSaving] = useState(false);
  const [vorarbeitAktiv, setVorarbeitAktiv] = useState(false); // lokaler Toggle-State

  const [tgSaving, setTgSaving] = useState<string | null>(null);

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
    ladeZusammentragenEinsaetze(selectedAusgabeId).then((list) => {
      setAlleEinsaetze(list);
      // Vorarbeit-Zustand aus geladenen Daten ableiten
      setVorarbeitAktiv(list.some((e) => e.istVorarbeit));
      setLoading(false);
    });
  }, [selectedAusgabeId]);

  const reload = async () => {
    if (!selectedAusgabeId) return;
    const list = await ladeZusammentragenEinsaetze(selectedAusgabeId);
    setAlleEinsaetze(list);
    setVorarbeitAktiv(list.some((e) => e.istVorarbeit));
  };

  const selectedAusgabe = ausgaben.find((a) => a.id === selectedAusgabeId);

  // Einträge aufteilen
  const vorarbeitEintraege = alleEinsaetze.filter((e) => e.istVorarbeit);
  const normalEinsaetze = alleEinsaetze.filter((e) => !e.istVorarbeit);

  // Map: teilgebietId → Einsatz (für normale Einträge)
  const tgMap = Object.fromEntries(normalEinsaetze.map((e) => [e.teilgebietId, e]));

  const aktiveTeilgebiete = teilgebiete
    .filter((tg) => tg.isActive)
    .sort((a, b) => a.name.localeCompare(b.name));

  const zusammentraeger = mitarbeiter.filter(
    (m) => m.isActive && m.rollen.includes('zusammenträger')
  );

  // Welche Zusammenträger haben noch keinen Vorarbeit-Eintrag?
  const vorarbeitMaIds = new Set(vorarbeitEintraege.map((e) => e.mitarbeiterId));
  const verfuegbarFuerVorarbeit = zusammentraeger.filter(
    (m) => !vorarbeitMaIds.has(m.id)
  );

  // ---- Vorarbeit-Toggle (an/aus) ---
  async function handleVorarbeitToggle(aktiv: boolean) {
    if (!aktiv && vorarbeitEintraege.length > 0) {
      // Alle Vorarbeit-Einträge löschen
      for (const e of vorarbeitEintraege) {
        await loescheZusammentragenEinsatz(e.id);
      }
      await reload();
    }
    setVorarbeitAktiv(aktiv);
  }

  // ---- Vorarbeit-Eintrag hinzufügen ---
  async function handleVorarbeitHinzufuegen() {
    if (!selectedAusgabe || !vorarbeitNeuMA) return;
    const minuten = parseInt(vorarbeitNeuH || '0') * 60 + parseInt(vorarbeitNeuM || '0');
    setVorarbeitSaving(true);
    try {
      await setzeZusammentragenEinsatz({
        ausgabeId: selectedAusgabe.id,
        teilgebietId: VORARBEIT_TG_ID,
        mitarbeiterId: vorarbeitNeuMA,
        stapelBearbeitet: selectedAusgabe.stapelAnzahl,
        istVorarbeit: true,
        vorarbeitMinuten: minuten,
      });
      setVorarbeitNeuMA('');
      setVorarbeitNeuH('0');
      setVorarbeitNeuM('00');
      await reload();
    } finally {
      setVorarbeitSaving(false);
    }
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

  const istGesperrt = selectedAusgabe?.status === 'abgeschlossen';
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

      {istGesperrt && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-800 flex items-center gap-2">
          🔒 Diese Ausgabe gehört zu einer <strong>abgeschlossenen Abrechnungsperiode</strong> — keine Änderungen mehr möglich.
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
                <span className="font-semibold text-amber-900">Vorarbeit für diese Ausgabe</span>
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

                {/* Neuen Vorarbeit-Eintrag hinzufügen */}
                {verfuegbarFuerVorarbeit.length > 0 && (
                  <div className="flex items-center gap-3 bg-white rounded-lg border border-dashed border-amber-300 px-4 py-2.5">
                    <select
                      value={vorarbeitNeuMA}
                      onChange={(e) => setVorarbeitNeuMA(e.target.value)}
                      className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-amber-500"
                    >
                      <option value="">— Zusammenträger wählen —</option>
                      {verfuegbarFuerVorarbeit.map((m) => (
                        <option key={m.id} value={m.id}>{m.name}</option>
                      ))}
                    </select>
                    <VorarbeitZeitEingabe
                      stunden={parseInt(vorarbeitNeuH) || 0}
                      minuten={parseInt(vorarbeitNeuM) || 0}
                      onSave={(h, m) => { setVorarbeitNeuH(h.toString()); setVorarbeitNeuM(m.toString().padStart(2, '0')); }}
                    />
                    <button
                      onClick={handleVorarbeitHinzufuegen}
                      disabled={!vorarbeitNeuMA || vorarbeitSaving || istGesperrt}
                      className="ml-2 bg-amber-600 text-white px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-amber-700 disabled:opacity-50 transition-colors"
                    >
                      + Hinzufügen
                    </button>
                  </div>
                )}

                {verfuegbarFuerVorarbeit.length === 0 && zusammentraeger.length > 0 && (
                  <p className="text-xs text-amber-700 pl-1">Alle Zusammenträger sind bereits eingetragen.</p>
                )}
              </div>
            )}

            {!vorarbeitAktiv && (
              <p className="text-sm text-amber-700">
                Haken setzen um Vorarbeit-Zeiten für diese Ausgabe zu erfassen.
              </p>
            )}
          </div>

          {/* ---- NORMALES ZUSAMMENTRAGEN (per Teilgebiet) ---- */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
              <h2 className="font-semibold text-gray-800 text-sm">Zusammentragen je Teilgebiet</h2>
            </div>
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Teilgebiet</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Tour</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Zusammenträger</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {aktiveTeilgebiete.map((tg) => {
                  const e = tgMap[tg.id];
                  const tour = touren.find((t) => t.id === tg.tourId);
                  const isSaving = tgSaving === tg.id;

                  return (
                    <tr key={tg.id} className={e ? 'bg-white' : 'bg-gray-50'}>
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
