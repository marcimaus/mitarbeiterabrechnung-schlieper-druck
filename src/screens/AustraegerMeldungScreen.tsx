// Selbstmeldung für Austräger: Arbeitszeiten + Restmengen ohne Login
// Aufruf via: /meldung?ma=<mitarbeiterId>

import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { getDoc, doc, collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { aktualisiereEinsatzMeldung, setzeEinsatz } from '../lib/db';
import type { Mitarbeiter, Einsatz, Ausgabe, Teilgebiet, AustraegerArbeitszeit } from '../types';

// ---- Hilfsfunktionen ----------------------------------------

function kwLabel(kw: number, jahr: number): string {
  return `KW ${kw}/${jahr}`;
}

/** Montag der ISO-Woche als YYYY-MM-DD */
function montagDerKW(kw: number, jahr: number): string {
  // 4. Januar liegt immer in KW 1
  const jan4 = new Date(jahr, 0, 4);
  const wochentag = jan4.getDay() || 7; // 1 = Mo
  const mo = new Date(jan4);
  mo.setDate(jan4.getDate() - (wochentag - 1) + (kw - 1) * 7);
  return mo.toISOString().slice(0, 10);
}

function heuteStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function formatDatum(iso: string): string {
  return new Date(iso + 'T00:00:00').toLocaleDateString('de-DE', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

function formatZeitstempel(ts: number): string {
  return new Date(ts).toLocaleString('de-DE', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

// Netto-Minuten aus von/bis/pausen
function nettoMinuten(von: string, bis: string, pausenMin: number): number {
  const [vH, vM] = von.split(':').map(Number);
  const [bH, bM] = bis.split(':').map(Number);
  const brutto = (bH * 60 + bM) - (vH * 60 + vM);
  return Math.max(0, brutto - pausenMin);
}

function formatDauer(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h}:${String(m).padStart(2, '0')} h`;
}

// ---- Haupt-Export -------------------------------------------

export default function AustraegerMeldungScreen() {
  const [searchParams] = useSearchParams();
  const mitarbeiterId = searchParams.get('ma') ?? '';

  const [mitarbeiter, setMitarbeiter] = useState<Mitarbeiter | null>(null);
  const [einsaetze, setEinsaetze] = useState<Einsatz[]>([]);
  const [ausgaben, setAusgaben] = useState<Map<string, Ausgabe>>(new Map());
  const [teilgebiete, setTeilgebiete] = useState<Map<string, Teilgebiet>>(new Map());
  const [loading, setLoading] = useState(true);
  const [fehler, setFehler] = useState('');

  // Daten laden
  useEffect(() => {
    if (!mitarbeiterId) {
      setFehler('Kein Mitarbeiter-Link angegeben.');
      setLoading(false);
      return;
    }
    loadAlles();
  }, [mitarbeiterId]);

  async function loadAlles() {
    setLoading(true);
    setFehler('');
    try {
      // Mitarbeiter laden
      const maSnap = await getDoc(doc(db, 'mitarbeiter', mitarbeiterId));
      if (!maSnap.exists()) {
        setFehler('Mitarbeiter nicht gefunden. Bitte wende dich ans Büro.');
        setLoading(false);
        return;
      }
      const ma = { id: maSnap.id, ...maSnap.data() } as Mitarbeiter;
      if (!ma.isActive) {
        setFehler('Dieser Mitarbeiter ist nicht mehr aktiv.');
        setLoading(false);
        return;
      }
      setMitarbeiter(ma);

      // Explizite Einsätze des MA laden (Springer, manuell erfasste Standards …)
      const eSnap = await getDocs(
        query(collection(db, 'einsaetze'), where('mitarbeiterId', '==', mitarbeiterId))
      );
      const loadedEinsaetze = eSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Einsatz));

      // Ausgaben laden (alle, für Namensauflösung)
      const aSnap = await getDocs(collection(db, 'ausgaben'));
      const ausgabenMap = new Map<string, Ausgabe>();
      for (const d of aSnap.docs) ausgabenMap.set(d.id, { id: d.id, ...d.data() } as Ausgabe);

      // Teilgebiete laden (alle, für Namensauflösung)
      const tSnap = await getDocs(collection(db, 'teilgebiete'));
      const tgMap = new Map<string, Teilgebiet>();
      for (const d of tSnap.docs) tgMap.set(d.id, { id: d.id, ...d.data() } as Teilgebiet);

      // Virtuelle Einsätze ergänzen: für TGs, deren Standardausträger der
      // eingeloggte MA ist, existiert normalerweise KEIN expliziter
      // Einsatz-Datensatz pro KW — die Standard-Zuordnung steckt nur am
      // Teilgebiet. Damit der QR-Code-Empfänger trotzdem etwas zum Melden
      // hat, generieren wir pro (TG, noch nicht abgeschlossene Ausgabe)
      // einen virtuellen Einsatz mit synthetic-ID. Beim Speichern wird
      // daraus über setzeEinsatz ein echter angelegt.
      const standardTgs = Array.from(tgMap.values()).filter(
        (tg) => tg.standardAustraegerId === mitarbeiterId && tg.isActive
      );
      const aktiveAusgaben = Array.from(ausgabenMap.values()).filter(
        (a) => a.status !== 'abgeschlossen'
      );
      const aktiveAusgabeIds = aktiveAusgaben.map((a) => a.id);
      // Alle Einsätze für die noch offenen Ausgaben (egal welcher MA), um
      // zu erkennen, ob das TG durch einen Springer / Ausfall übernommen
      // wurde — dann KEIN virtueller Einsatz für den Standardausträger.
      const alleEinsaetzeAktive: Einsatz[] = [];
      for (let i = 0; i < aktiveAusgabeIds.length; i += 30) {
        const chunk = aktiveAusgabeIds.slice(i, i + 30);
        if (chunk.length === 0) continue;
        const snap = await getDocs(
          query(collection(db, 'einsaetze'), where('ausgabeId', 'in', chunk))
        );
        alleEinsaetzeAktive.push(...snap.docs.map((d) => ({ id: d.id, ...d.data() } as Einsatz)));
      }
      const heuteTs = Date.now();
      const virtuelle: Einsatz[] = [];
      for (const tg of standardTgs) {
        for (const a of aktiveAusgaben) {
          const exist = alleEinsaetzeAktive.find(
            (e) => e.teilgebietId === tg.id && e.ausgabeId === a.id
          );
          if (exist) continue; // entweder eigener (loadedEinsaetze) oder ein anderer MA
          virtuelle.push({
            id: `synthetic_${tg.id}__${a.id}`,
            ausgabeId: a.id,
            kw: a.kw,
            jahr: a.jahr,
            teilgebietId: tg.id,
            mitarbeiterId,
            typ: 'standard',
            erstelltAm: heuteTs,
            aktualisiertAm: heuteTs,
          });
        }
      }

      const alle = [...loadedEinsaetze, ...virtuelle];
      // Einsätze sortieren: neueste Ausgabe zuerst
      alle.sort((a, b) => {
        if (b.jahr !== a.jahr) return b.jahr - a.jahr;
        return b.kw - a.kw;
      });

      setEinsaetze(alle);
      setAusgaben(ausgabenMap);
      setTeilgebiete(tgMap);
    } catch (err) {
      console.error(err);
      setFehler('Fehler beim Laden. Bitte Seite neu laden.');
    } finally {
      setLoading(false);
    }
  }

  function handleMeldungGespeichert(einsatzId: string, updated: Einsatz) {
    setEinsaetze((prev) =>
      prev.map((e) => (e.id === einsatzId ? updated : e))
    );
  }

  // Aufteilen: ausstehend vs. eingereicht
  const ausstehend = einsaetze.filter((e) => !e.meldungEingereichtAm);
  const eingereicht = einsaetze.filter((e) => !!e.meldungEingereichtAm);

  // ---- Render -----------------------------------------------

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center text-gray-500">
          <div className="text-4xl mb-3 animate-spin">⏳</div>
          <p>Lade Daten…</p>
        </div>
      </div>
    );
  }

  if (fehler) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow p-6 max-w-sm w-full text-center">
          <div className="text-5xl mb-3">⚠️</div>
          <p className="text-gray-700 font-medium">{fehler}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-green-700 text-white px-4 py-5">
        <div className="max-w-lg mx-auto">
          <p className="text-green-200 text-sm font-medium uppercase tracking-wide">Meine Meldungen</p>
          <h1 className="text-2xl font-bold mt-0.5">{mitarbeiter?.name}</h1>
          <p className="text-green-200 text-sm mt-1">Austragen · Schlieper-Druck</p>
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 py-4 space-y-4">

        {/* Ausstehende Meldungen */}
        {ausstehend.length > 0 && (
          <section>
            <div className="flex items-center gap-2 mb-3">
              <span className="inline-block w-2.5 h-2.5 rounded-full bg-orange-500"></span>
              <h2 className="font-semibold text-gray-800">
                Ausstehend ({ausstehend.length})
              </h2>
            </div>
            <div className="space-y-3">
              {ausstehend.map((einsatz) => (
                <MeldungsKarte
                  key={einsatz.id}
                  einsatz={einsatz}
                  ausgabe={ausgaben.get(einsatz.ausgabeId)}
                  teilgebiet={teilgebiete.get(einsatz.teilgebietId)}
                  onGespeichert={(updated) => handleMeldungGespeichert(einsatz.id, updated)}
                />
              ))}
            </div>
          </section>
        )}

        {ausstehend.length === 0 && einsaetze.length > 0 && (
          <div className="bg-green-50 border border-green-200 rounded-xl p-4 text-center">
            <span className="text-2xl">✅</span>
            <p className="text-green-800 font-medium mt-1">Alles gemeldet!</p>
            <p className="text-green-600 text-sm">Keine ausstehenden Meldungen.</p>
          </div>
        )}

        {einsaetze.length === 0 && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 text-center">
            <span className="text-4xl">📋</span>
            <p className="text-gray-600 mt-2">Noch keine Einsätze zugewiesen.</p>
          </div>
        )}

        {/* Bereits eingereichte Meldungen */}
        {eingereicht.length > 0 && (
          <section>
            <h2 className="font-semibold text-gray-500 text-sm uppercase tracking-wide mb-3">
              ✅ Bereits eingereicht ({eingereicht.length})
            </h2>
            <div className="space-y-2">
              {eingereicht.map((einsatz) => (
                <EingereichtKarte
                  key={einsatz.id}
                  einsatz={einsatz}
                  ausgabe={ausgaben.get(einsatz.ausgabeId)}
                  teilgebiet={teilgebiete.get(einsatz.teilgebietId)}
                  onBearbeiten={(updated) => handleMeldungGespeichert(einsatz.id, updated)}
                />
              ))}
            </div>
          </section>
        )}

        {/* Footer */}
        <div className="text-center text-gray-400 text-xs pb-6 pt-2">
          Schlieper-Druck GmbH · Mitarbeiter-Meldungsportal
        </div>
      </div>
    </div>
  );
}

// ---- Karte für ausstehende Meldung -------------------------

interface KarteProps {
  einsatz: Einsatz;
  ausgabe?: Ausgabe;
  teilgebiet?: Teilgebiet;
  onGespeichert: (updated: Einsatz) => void;
}

function MeldungsKarte({ einsatz, ausgabe, teilgebiet, onGespeichert }: KarteProps) {
  const defaultDatum = ausgabe
    ? montagDerKW(ausgabe.kw, ausgabe.jahr)
    : heuteStr();

  const [offen, setOffen] = useState(true);
  const [datum, setDatum] = useState(defaultDatum);
  const [von, setVon] = useState('');
  const [bis, setBis] = useState('');
  const [pausenMin, setPausenMin] = useState('0');
  const [restmenge, setRestmenge] = useState('0');
  const [busy, setBusy] = useState(false);
  const [meldung, setMeldung] = useState('');

  const netto = von && bis ? nettoMinuten(von, bis, Number(pausenMin) || 0) : null;
  const formValid = datum && von && bis && von < bis;

  async function handleSpeichern() {
    if (!formValid) return;
    setBusy(true);
    setMeldung('');
    try {
      const az: AustraegerArbeitszeit = {
        datum,
        von,
        bis,
        pausenMinuten: Number(pausenMin) || 0,
      };
      const ts = Date.now();
      // Virtueller Einsatz (synthetic-ID): erst echten Datensatz in
      // Firestore anlegen, dann die Meldung darauf schreiben.
      let echteId = einsatz.id;
      if (echteId.startsWith('synthetic_')) {
        echteId = await setzeEinsatz({
          ausgabeId: einsatz.ausgabeId,
          kw: einsatz.kw,
          jahr: einsatz.jahr,
          teilgebietId: einsatz.teilgebietId,
          mitarbeiterId: einsatz.mitarbeiterId,
          typ: 'standard',
        });
      }
      await aktualisiereEinsatzMeldung(echteId, {
        arbeitszeit: az,
        restmenge: Number(restmenge) || 0,
        meldungEingereichtAm: ts,
      });
      onGespeichert({
        ...einsatz,
        id: echteId,
        arbeitszeit: az,
        restmenge: Number(restmenge) || 0,
        meldungEingereichtAm: ts,
      });
      setMeldung('✅ Gespeichert!');
    } catch (err) {
      console.error(err);
      setMeldung('❌ Fehler beim Speichern. Bitte erneut versuchen.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-orange-200 overflow-hidden">
      {/* Kopfzeile */}
      <button
        type="button"
        className="w-full flex items-center justify-between px-4 py-3 bg-orange-50 text-left"
        onClick={() => setOffen((v) => !v)}
      >
        <div>
          <span className="font-semibold text-orange-800 text-base">
            {ausgabe ? kwLabel(ausgabe.kw, ausgabe.jahr) : '—'}
          </span>
          <span className="ml-2 text-orange-600 text-sm">{teilgebiet?.name ?? '—'}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs bg-orange-200 text-orange-800 px-2 py-0.5 rounded-full font-medium">
            Ausstehend
          </span>
          <span className="text-orange-600">{offen ? '▲' : '▼'}</span>
        </div>
      </button>

      {/* Metainfo */}
      {offen && (
        <div className="px-4 pt-1 pb-0">
          <p className="text-xs text-gray-500">
            Typ: {einsatz.typ === 'springer' ? '🔄 Springer' : '👤 Standard'} ·
            Stücke: {teilgebiet?.stueckzahl ?? '—'}
          </p>
        </div>
      )}

      {/* Formular */}
      {offen && (
        <div className="px-4 pb-4 pt-3 space-y-4">

          {/* Datum */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Austrag-Datum
            </label>
            <input
              type="date"
              value={datum}
              onChange={(e) => setDatum(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-base focus:outline-none focus:ring-2 focus:ring-green-500"
            />
          </div>

          {/* Arbeitszeit von / bis */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Beginn
              </label>
              <input
                type="time"
                value={von}
                onChange={(e) => setVon(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-base focus:outline-none focus:ring-2 focus:ring-green-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Ende
              </label>
              <input
                type="time"
                value={bis}
                onChange={(e) => setBis(e.target.value)}
                className={`w-full border rounded-lg px-3 py-2.5 text-base focus:outline-none focus:ring-2 focus:ring-green-500 ${
                  von && bis && bis <= von ? 'border-red-400 bg-red-50' : 'border-gray-300'
                }`}
              />
            </div>
          </div>
          {von && bis && bis <= von && (
            <p className="text-red-600 text-sm -mt-2">Ende muss nach Beginn liegen.</p>
          )}

          {/* Pausen */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Pause (Minuten)
            </label>
            <div className="flex items-center gap-3">
              <input
                type="number"
                min="0"
                max="480"
                value={pausenMin}
                onChange={(e) => setPausenMin(e.target.value)}
                className="w-28 border border-gray-300 rounded-lg px-3 py-2.5 text-base focus:outline-none focus:ring-2 focus:ring-green-500"
              />
              {netto !== null && netto > 0 && (
                <span className="text-green-700 font-medium text-sm">
                  = {formatDauer(netto)} Netto-Arbeitszeit
                </span>
              )}
            </div>
          </div>

          {/* Restmenge */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Restmenge (nicht ausgetragene Stücke)
            </label>
            <div className="flex items-center gap-3">
              <input
                type="number"
                min="0"
                value={restmenge}
                onChange={(e) => setRestmenge(e.target.value)}
                className="w-28 border border-gray-300 rounded-lg px-3 py-2.5 text-base focus:outline-none focus:ring-2 focus:ring-green-500"
              />
              <span className="text-gray-500 text-sm">
                Stück
                {teilgebiet && Number(restmenge) > 0 && (
                  <span className="text-orange-600 ml-1">
                    ({Math.round(((Number(restmenge) / teilgebiet.stueckzahl) * 100))}% nicht ausgetragen)
                  </span>
                )}
              </span>
            </div>
            <p className="text-xs text-gray-400 mt-1">
              0 eingeben wenn alles ausgetragen wurde.
            </p>
          </div>

          {/* Meldung */}
          {meldung && (
            <p className={`text-sm font-medium ${meldung.startsWith('✅') ? 'text-green-700' : 'text-red-600'}`}>
              {meldung}
            </p>
          )}

          {/* Speichern */}
          <button
            type="button"
            onClick={handleSpeichern}
            disabled={!formValid || busy}
            className="w-full bg-green-700 hover:bg-green-800 disabled:bg-gray-300 text-white font-semibold py-3 rounded-xl transition-colors text-base"
          >
            {busy ? 'Speichere…' : '✅ Meldung einreichen'}
          </button>
        </div>
      )}
    </div>
  );
}

// ---- Karte für bereits eingereichte Meldung ----------------

interface EingereichtProps {
  einsatz: Einsatz;
  ausgabe?: Ausgabe;
  teilgebiet?: Teilgebiet;
  onBearbeiten: (updated: Einsatz) => void;
}

function EingereichtKarte({ einsatz, ausgabe, teilgebiet, onBearbeiten }: EingereichtProps) {
  const [offen, setOffen] = useState(false);
  const [bearbeiten, setBearbeiten] = useState(false);

  // Bearbeitungs-State
  const [datum, setDatum] = useState(einsatz.arbeitszeit?.datum ?? heuteStr());
  const [von, setVon] = useState(einsatz.arbeitszeit?.von ?? '');
  const [bis, setBis] = useState(einsatz.arbeitszeit?.bis ?? '');
  const [pausenMin, setPausenMin] = useState(String(einsatz.arbeitszeit?.pausenMinuten ?? 0));
  const [restmenge, setRestmenge] = useState(String(einsatz.restmenge ?? 0));
  const [busy, setBusy] = useState(false);
  const [meldung, setMeldung] = useState('');

  const netto = von && bis ? nettoMinuten(von, bis, Number(pausenMin) || 0) : null;
  const formValid = datum && von && bis && von < bis;

  async function handleSpeichern() {
    if (!formValid) return;
    setBusy(true);
    setMeldung('');
    try {
      const az: AustraegerArbeitszeit = {
        datum,
        von,
        bis,
        pausenMinuten: Number(pausenMin) || 0,
      };
      const ts = Date.now();
      await aktualisiereEinsatzMeldung(einsatz.id, {
        arbeitszeit: az,
        restmenge: Number(restmenge) || 0,
        meldungEingereichtAm: ts,
      });
      onBearbeiten({
        ...einsatz,
        arbeitszeit: az,
        restmenge: Number(restmenge) || 0,
        meldungEingereichtAm: ts,
      });
      setBearbeiten(false);
      setMeldung('✅ Aktualisiert');
    } catch {
      setMeldung('❌ Fehler. Bitte erneut versuchen.');
    } finally {
      setBusy(false);
    }
  }

  const az = einsatz.arbeitszeit;

  return (
    <div className="bg-white rounded-xl shadow-sm border border-green-100 overflow-hidden">
      <button
        type="button"
        className="w-full flex items-center justify-between px-4 py-3 text-left"
        onClick={() => setOffen((v) => !v)}
      >
        <div>
          <span className="font-medium text-gray-800">
            {ausgabe ? kwLabel(ausgabe.kw, ausgabe.jahr) : '—'}
          </span>
          <span className="ml-2 text-gray-500 text-sm">{teilgebiet?.name ?? '—'}</span>
        </div>
        <div className="flex items-center gap-2">
          {az && (
            <span className="text-xs text-gray-500 hidden sm:inline">
              {az.von}–{az.bis} Uhr
            </span>
          )}
          <span className="text-xs bg-green-100 text-green-800 px-2 py-0.5 rounded-full">✓</span>
          <span className="text-gray-400">{offen ? '▲' : '▼'}</span>
        </div>
      </button>

      {offen && !bearbeiten && az && (
        <div className="px-4 pb-4 border-t border-gray-50">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 mt-3 text-sm">
            <dt className="text-gray-500">Datum</dt>
            <dd className="font-medium">{formatDatum(az.datum)}</dd>
            <dt className="text-gray-500">Arbeitszeit</dt>
            <dd className="font-medium">{az.von} – {az.bis} Uhr</dd>
            <dt className="text-gray-500">Pause</dt>
            <dd className="font-medium">{az.pausenMinuten} min</dd>
            <dt className="text-gray-500">Netto</dt>
            <dd className="font-medium text-green-700">
              {formatDauer(nettoMinuten(az.von, az.bis, az.pausenMinuten))}
            </dd>
            <dt className="text-gray-500">Restmenge</dt>
            <dd className={`font-medium ${(einsatz.restmenge ?? 0) > 0 ? 'text-orange-600' : 'text-gray-700'}`}>
              {einsatz.restmenge ?? 0} Stk.
            </dd>
          </dl>
          {einsatz.meldungEingereichtAm && (
            <p className="text-xs text-gray-400 mt-3">
              Eingereicht: {formatZeitstempel(einsatz.meldungEingereichtAm)}
            </p>
          )}
          <button
            type="button"
            onClick={() => setBearbeiten(true)}
            className="mt-3 text-sm text-blue-600 hover:text-blue-800 underline"
          >
            ✏️ Korrigieren
          </button>
        </div>
      )}

      {offen && bearbeiten && (
        <div className="px-4 pb-4 border-t border-gray-100 pt-3 space-y-3">
          <p className="text-xs text-orange-600 font-medium">⚠️ Meldung wird überschrieben</p>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Datum</label>
            <input type="date" value={datum} onChange={(e) => setDatum(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-base" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Beginn</label>
              <input type="time" value={von} onChange={(e) => setVon(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-base" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Ende</label>
              <input type="time" value={bis} onChange={(e) => setBis(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-base" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Pause (Min.)</label>
              <input type="number" min="0" value={pausenMin} onChange={(e) => setPausenMin(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-base" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Restmenge (Stk.)</label>
              <input type="number" min="0" value={restmenge} onChange={(e) => setRestmenge(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-base" />
            </div>
          </div>

          {netto !== null && netto > 0 && (
            <p className="text-green-700 text-sm">Netto-Arbeitszeit: {formatDauer(netto)}</p>
          )}

          {meldung && (
            <p className={`text-sm font-medium ${meldung.startsWith('✅') ? 'text-green-700' : 'text-red-600'}`}>
              {meldung}
            </p>
          )}

          <div className="flex gap-3">
            <button type="button" onClick={handleSpeichern} disabled={!formValid || busy}
              className="flex-1 bg-green-700 hover:bg-green-800 disabled:bg-gray-300 text-white font-semibold py-2.5 rounded-xl transition-colors text-sm">
              {busy ? 'Speichere…' : 'Speichern'}
            </button>
            <button type="button" onClick={() => { setBearbeiten(false); setMeldung(''); }}
              className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold py-2.5 rounded-xl text-sm">
              Abbrechen
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
