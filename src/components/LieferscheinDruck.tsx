// Lieferschein-Druckkomponente
// Zeigt print-fertige Lieferscheine für alle Teilgebiete einer Abrechnungsperiode

import { useState, useEffect, useMemo } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { ladeAuslieferungsmemosFuerAusgaben } from '../lib/db';
import type {
  Abrechnungsperiode,
  Ausgabe,
  Einsatz,
  Beilage,
  Mitarbeiter,
  Teilgebiet,
  Tour,
  AuslieferungsMemo,
} from '../types';
import {
  berechneGewichtAnzeigenblattKg,
  berechneGewichtBeilagenKg,
  berechneAustraegezeit,
  formatierStunden,
} from '../lib/berechnung';
import { useApp } from '../context/AppContext';

// ---- Typen --------------------------------------------------

interface KWZeile {
  kw: number;
  ausgabe: Ausgabe | null;
  einsatz: Einsatz | null; // null = standard (kein Einsatz-Dokument = standard Austräger)
  springer: Mitarbeiter | null;
  beilagen: Beilage[];
  mittwoch: string; // YYYY-MM-DD
}

interface MemoEintrag {
  kw: number;
  scope: 'alle' | 'tour' | 'teilgebiet';
  text: string;
}

interface LieferscheinInfo {
  teilgebiet: Teilgebiet;
  empfaenger: Mitarbeiter;      // Empfänger dieses Lieferscheins (Standardausträger oder Springer)
  istSpringer: boolean;          // true → Kopf in ROT
  zeilen: KWZeile[];             // nur KWs, die auf diesen Empfänger entfallen
  meldungsLink: string;
  memos: MemoEintrag[];          // pro KW gesammelte Memos (alle/tour/teilgebiet)
  /** Eindeutige Lieferschein-ID = teilgebietId + '__' + empfaengerId */
  schluessel: string;
}

// ---- Hilfsfunktionen ----------------------------------------

/** Mittwoch der ISO-Woche als YYYY-MM-DD */
function mittwochDerKW(kw: number, jahr: number): string {
  const jan4 = new Date(jahr, 0, 4);
  const wochentag = jan4.getDay() || 7;
  const mo = new Date(jan4);
  mo.setDate(jan4.getDate() - (wochentag - 1) + (kw - 1) * 7 + 2); // +2 = Mittwoch
  return mo.toISOString().slice(0, 10);
}

function formatDatum(iso: string): string {
  return new Date(iso + 'T00:00:00').toLocaleDateString('de-DE', {
    weekday: 'short', day: '2-digit', month: '2-digit',
  });
}

function formatKm(m: number): string {
  return (m / 1000).toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' km';
}

// ---- Haupt-Komponente ---------------------------------------

interface Props {
  periode: Abrechnungsperiode;
  ausgaben: Ausgabe[];
  mitarbeiter: Mitarbeiter[];
  teilgebiete: Teilgebiet[];
  touren?: Tour[];
  onClose: () => void;
}

export default function LieferscheinDruck({
  periode,
  ausgaben,
  mitarbeiter,
  teilgebiete,
  onClose,
}: Props) {
  const [loading, setLoading] = useState(true);
  const [fehler, setFehler] = useState('');
  const [scheine, setScheine] = useState<LieferscheinInfo[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const mitarbeiterMap = new Map(mitarbeiter.map((m) => [m.id, m]));

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    setFehler('');
    try {
      // Ausgaben dieser Periode (nach KW + Jahr)
      const periodeAusgaben = ausgaben.filter(
        (a) => periode.kalenderwochen.includes(a.kw) && a.jahr === periode.jahr
      );

      // Einsätze je Ausgabe laden
      const einsaetzeByAusgabe = new Map<string, Einsatz[]>();
      for (const a of periodeAusgaben) {
        const snap = await getDocs(
          query(collection(db, 'einsaetze'), where('ausgabeId', '==', a.id))
        );
        einsaetzeByAusgabe.set(
          a.id,
          snap.docs.map((d) => ({ id: d.id, ...d.data() } as Einsatz))
        );
      }

      // Beilagen je Ausgabe laden
      const beilagenByAusgabe = new Map<string, Beilage[]>();
      for (const a of periodeAusgaben) {
        const snap = await getDocs(
          query(collection(db, 'beilagen'), where('ausgabeId', '==', a.id))
        );
        beilagenByAusgabe.set(
          a.id,
          snap.docs.map((d) => ({ id: d.id, ...d.data() } as Beilage))
        );
      }

      // Auslieferungs-Memos für alle Ausgaben der Periode laden
      const memos: AuslieferungsMemo[] = await ladeAuslieferungsmemosFuerAusgaben(
        periodeAusgaben.map((a) => a.id)
      );
      const memosByAusgabe = new Map<string, AuslieferungsMemo[]>();
      for (const m of memos) {
        const list = memosByAusgabe.get(m.ausgabeId) ?? [];
        list.push(m);
        memosByAusgabe.set(m.ausgabeId, list);
      }

      // Lieferscheine aufbauen: je (Teilgebiet, tatsächlicher Empfänger) ein
      // Schein. Regeln:
      //  - Pro KW + TG genau ein Empfänger: Springer wenn vorhanden, sonst
      //    der Standardausträger.
      //  - KWs ohne Ausgabe in der Periode fließen NICHT in den Schein ein
      //    (sonst entstehen leere Standard-Lieferscheine, obwohl der
      //    Springer das TG vollständig übernommen hat — Bug #2).
      //  - TGs ohne Standardausträger werden trotzdem ausgegeben, sofern
      //    mindestens ein Springer-Einsatz existiert (Bug #1).
      const result: LieferscheinInfo[] = [];
      const sortedKWs = [...periode.kalenderwochen].sort((a, b) => a - b);

      for (const tg of teilgebiete) {
        if (!tg.isActive) continue;
        const standardMA = tg.standardAustraegerId
          ? (mitarbeiterMap.get(tg.standardAustraegerId) ?? null)
          : null;

        // Zeilen pro KW mit Empfänger ermitteln — leere KWs (keine Ausgabe
        // ODER kein Empfänger feststellbar) werden komplett übersprungen.
        type ZeileMitEmpf = KWZeile & { empfaengerId: string };
        const alleZeilen: ZeileMitEmpf[] = [];
        for (const kw of sortedKWs) {
          const ausgabe = periodeAusgaben.find((a) => a.kw === kw) ?? null;
          if (!ausgabe) continue; // ohne Ausgabe: keine Auslieferung dieser KW
          const einsätzeList = einsaetzeByAusgabe.get(ausgabe.id) ?? [];
          const einsatz = einsätzeList.find((e) => e.teilgebietId === tg.id) ?? null;
          const springer =
            einsatz?.typ === 'springer' && einsatz.mitarbeiterId
              ? (mitarbeiterMap.get(einsatz.mitarbeiterId) ?? null)
              : null;
          const beilagen = (beilagenByAusgabe.get(ausgabe.id) ?? []).filter((b) =>
            b.teilgebietIds.includes(tg.id)
          );
          // Empfänger: Springer hat Vorrang. Wenn kein Springer und kein
          // Standardausträger gesetzt → diese KW gehört zu keinem
          // Lieferschein.
          const empfaengerId = springer?.id ?? standardMA?.id ?? null;
          if (!empfaengerId) continue;

          alleZeilen.push({
            kw,
            ausgabe,
            einsatz,
            springer,
            beilagen,
            mittwoch: mittwochDerKW(kw, periode.jahr),
            empfaengerId,
          });
        }

        if (alleZeilen.length === 0) continue;

        // Memos je KW ermitteln (alle/tour/teilgebiet zusammenführen)
        function memosFuerKw(kw: number): MemoEintrag[] {
          const ausgabe = periodeAusgaben.find((a) => a.kw === kw);
          if (!ausgabe) return [];
          const mList = memosByAusgabe.get(ausgabe.id) ?? [];
          const out: MemoEintrag[] = [];
          for (const m of mList) {
            if (m.scope === 'alle') {
              out.push({ kw, scope: 'alle', text: m.text });
            } else if (m.scope === 'tour' && m.tourId && tg.tourId === m.tourId) {
              out.push({ kw, scope: 'tour', text: m.text });
            } else if (m.scope === 'teilgebiet' && m.teilgebietId === tg.id) {
              out.push({ kw, scope: 'teilgebiet', text: m.text });
            }
          }
          return out;
        }

        // Nach Empfänger gruppieren
        const byEmpfaenger = new Map<string, ZeileMitEmpf[]>();
        for (const z of alleZeilen) {
          const arr = byEmpfaenger.get(z.empfaengerId) ?? [];
          arr.push(z);
          byEmpfaenger.set(z.empfaengerId, arr);
        }

        for (const [empfId, zeilen] of byEmpfaenger.entries()) {
          const empfaenger = mitarbeiterMap.get(empfId);
          if (!empfaenger) continue;
          const istSpringer = !standardMA || empfId !== standardMA.id;
          const meldungsLink = `${window.location.origin}/meldung?ma=${encodeURIComponent(empfaenger.id)}`;

          // Memos für die KWs dieses Lieferscheins
          const memosListe: MemoEintrag[] = [];
          for (const z of zeilen) {
            memosListe.push(...memosFuerKw(z.kw));
          }

          result.push({
            teilgebiet: tg,
            empfaenger,
            istSpringer,
            zeilen: zeilen.map(({ empfaengerId: _e, ...rest }) => rest),
            meldungsLink,
            memos: memosListe,
            schluessel: `${tg.id}__${empfId}`,
          });
        }
      }

      result.sort((a, b) => {
        const byName = a.teilgebiet.name.localeCompare(b.teilgebiet.name);
        if (byName !== 0) return byName;
        // Standardausträger zuerst, dann Springer
        if (a.istSpringer !== b.istSpringer) return a.istSpringer ? 1 : -1;
        return a.empfaenger.name.localeCompare(b.empfaenger.name);
      });
      setScheine(result);
      // Standardmäßig alle ausgewählt
      setSelectedIds(new Set(result.map((s) => s.schluessel)));
    } catch (err) {
      console.error(err);
      setFehler('Fehler beim Laden der Daten.');
    } finally {
      setLoading(false);
    }
  }

  // KW-Filter: bei aktivem Filter werden nur Lieferscheine angezeigt, deren
  // Empfänger das TG in dieser KW (Ausgabe) tatsächlich austrägt. Im Schein
  // selbst werden dann auch nur die KW-passenden Zeilen + Memos behalten.
  // → Damit erscheint Scherbarths Schein nicht im KW-18-Druck, wenn KW18
  //   ein Springer austrägt.
  const [filterKw, setFilterKw] = useState<number | null>(null);
  const sichtbareScheine = useMemo(() => {
    const ausgewaehlt = scheine.filter((s) => selectedIds.has(s.schluessel));
    if (filterKw === null) return ausgewaehlt;
    return ausgewaehlt.flatMap((s) => {
      const zeilen = s.zeilen.filter((z) => z.kw === filterKw);
      if (zeilen.length === 0) return [];
      const memos = s.memos.filter((m) => m.kw === filterKw);
      return [{ ...s, zeilen, memos }];
    });
  }, [scheine, selectedIds, filterKw]);
  const kwListe = useMemo(
    () => [...periode.kalenderwochen].sort((a, b) => a - b),
    [periode.kalenderwochen]
  );

  // ---- Render -----------------------------------------------
  return (
    <>
      {/* Print-CSS */}
      <style>{`
        @media print {
          @page { size: A4 landscape; margin: 8mm; }
          /* Sicherheitsnetz: ALLE Body-Inhalte unsichtbar machen, dann
             nur den Druckbereich (.lieferschein-druckbereich) wieder
             sichtbar — verhindert, dass das Modal-Overlay (z. B. wegen
             stacking-context oder Tailwind-Print-Variantenreihenfolge)
             versehentlich mitgedruckt wird. */
          body * { visibility: hidden !important; }
          .lieferschein-druckbereich,
          .lieferschein-druckbereich * { visibility: visible !important; }
          .lieferschein-druckbereich {
            position: absolute;
            inset: 0;
            background: white;
          }
          .no-print { display: none !important; }
          .lieferschein-seite { break-after: page; page-break-after: always; }
          .lieferschein-seite:last-child { break-after: avoid; page-break-after: avoid; }
          body { margin: 0; }
        }
        @media screen {
          .lieferschein-seite {
            background: white;
            box-shadow: 0 2px 8px rgba(0,0,0,0.15);
            margin-bottom: 24px;
          }
        }
        .fill-line {
          border-bottom: 1px solid #374151;
          display: inline-block;
          min-width: 50px;
        }
        .fill-cell {
          border-bottom: 1.5px solid #374151;
          min-height: 22px;
        }
        table.lieferschein-tabelle { border-collapse: collapse; width: 100%; }
        table.lieferschein-tabelle th,
        table.lieferschein-tabelle td {
          border: 1px solid #9ca3af;
          padding: 4px 5px;
          font-size: 11px;
          vertical-align: middle;
        }
        table.lieferschein-tabelle th { background: #f3f4f6; font-weight: 600; }
        tr.springer-row td { color: #dc2626; font-weight: 600; }
        tr.ausfall-row td { color: #9ca3af; font-style: italic; }
      `}</style>

      {/* ---- Steuerleiste (kein Druck) ---- */}
      <div className="no-print fixed inset-0 bg-black/60 z-50 flex flex-col">
        {/* Toolbar */}
        <div className="bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3 flex-wrap shrink-0">
          <button
            onClick={onClose}
            className="text-gray-600 hover:text-gray-900 text-sm px-3 py-1.5 border border-gray-300 rounded-lg"
          >
            ✕ Schließen
          </button>
          <span className="text-gray-700 font-semibold">
            Lieferscheine — {periode.bezeichnung}
          </span>
          <span className="text-gray-500 text-sm">
            ({sichtbareScheine.length} von {scheine.length} Lieferscheinen)
          </span>
          <div className="ml-auto flex gap-2">
            <button
              onClick={() => setSelectedIds(new Set(scheine.map((s) => s.schluessel)))}
              className="text-xs text-blue-600 hover:underline"
            >
              Alle
            </button>
            <button
              onClick={() => setSelectedIds(new Set())}
              className="text-xs text-blue-600 hover:underline"
            >
              Keine
            </button>
            <button
              onClick={() => window.print()}
              disabled={sichtbareScheine.length === 0}
              className="bg-blue-700 hover:bg-blue-800 disabled:bg-gray-300 text-white px-4 py-1.5 rounded-lg text-sm font-medium"
            >
              🖨️ Drucken ({sichtbareScheine.length})
            </button>
          </div>
        </div>

        {/* KW-Filter — beschränkt die Lieferscheine auf eine bestimmte Ausgabe */}
        {!loading && scheine.length > 0 && kwListe.length > 1 && (
          <div className="bg-blue-50 border-b border-blue-200 px-4 py-2 flex flex-wrap items-center gap-2 shrink-0">
            <span className="text-xs font-semibold text-blue-900">Ausgabe (KW):</span>
            <button
              type="button"
              onClick={() => setFilterKw(null)}
              className={`text-xs px-2.5 py-1 rounded-full border ${
                filterKw === null
                  ? 'bg-blue-700 text-white border-blue-700'
                  : 'bg-white text-blue-700 border-blue-300 hover:border-blue-400'
              }`}
            >
              Alle ({kwListe.length})
            </button>
            {kwListe.map((kw) => (
              <button
                key={kw}
                type="button"
                onClick={() => setFilterKw(kw)}
                className={`text-xs px-2.5 py-1 rounded-full border ${
                  filterKw === kw
                    ? 'bg-blue-700 text-white border-blue-700'
                    : 'bg-white text-blue-700 border-blue-300 hover:border-blue-400'
                }`}
                title={`Nur Lieferscheine für KW ${kw}`}
              >
                KW {kw}
              </button>
            ))}
            {filterKw !== null && (
              <span className="text-[11px] text-blue-700 italic ml-1">
                Filter aktiv — nur die Empfänger der KW {filterKw} werden gedruckt.
              </span>
            )}
          </div>
        )}

        {/* Auswahl-Leiste */}
        {!loading && scheine.length > 0 && (
          <div className="bg-gray-50 border-b border-gray-200 px-4 py-2 flex flex-wrap gap-2 shrink-0">
            {scheine.map((s) => (
              <button
                key={s.schluessel}
                type="button"
                onClick={() =>
                  setSelectedIds((prev) => {
                    const next = new Set(prev);
                    if (next.has(s.schluessel)) next.delete(s.schluessel);
                    else next.add(s.schluessel);
                    return next;
                  })
                }
                className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                  selectedIds.has(s.schluessel)
                    ? s.istSpringer
                      ? 'bg-red-600 text-white border-red-600'
                      : 'bg-blue-600 text-white border-blue-600'
                    : s.istSpringer
                      ? 'bg-white text-red-600 border-red-300'
                      : 'bg-white text-gray-600 border-gray-300'
                }`}
              >
                {s.teilgebiet.name}
                {s.istSpringer && ' 🔄'}
              </button>
            ))}
          </div>
        )}

        {/* Vorschau */}
        <div className="flex-1 overflow-y-auto p-6 bg-gray-200">
          {loading ? (
            <div className="text-center text-white py-12">Lade Daten…</div>
          ) : fehler ? (
            <div className="text-center text-red-300 py-12">{fehler}</div>
          ) : sichtbareScheine.length === 0 ? (
            <div className="text-center text-gray-400 py-12">Keine Lieferscheine ausgewählt.</div>
          ) : (
            <div className="max-w-3xl mx-auto">
              {sichtbareScheine.map((s) => (
                <LieferscheinSeite key={s.schluessel} info={s} periode={periode} />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ---- Druck-Inhalt (nur beim Drucken sichtbar) ---- */}
      <div className="lieferschein-druckbereich hidden print:block">
        {sichtbareScheine.map((s) => (
          <LieferscheinSeite key={s.schluessel} info={s} periode={periode} />
        ))}
      </div>
    </>
  );
}

// ---- Eine Lieferschein-Seite --------------------------------

function LieferscheinSeite({
  info,
  periode,
}: {
  info: LieferscheinInfo;
  periode: Abrechnungsperiode;
}) {
  const { teilgebiet: tg, empfaenger: ma, istSpringer, zeilen, meldungsLink, memos } = info;
  const { parameter } = useApp();

  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=130x130&margin=4&data=${encodeURIComponent(meldungsLink)}`;

  const adresse = [
    ma.adresse.strasse,
    `${ma.adresse.plz} ${ma.adresse.ort}`.trim(),
  ]
    .filter(Boolean)
    .join(', ');

  // Farbe des Kopfbereichs: rot, wenn Springer
  const headerFarbe = istSpringer ? '#b91c1c' : '#1e3a5f';
  const boxBg = istSpringer ? '#fef2f2' : '#f9fafb';
  const boxBorder = istSpringer ? '#fca5a5' : '#d1d5db';

  // Prüfe ob es bereits Online-Meldungen gibt
  const mitMeldung = zeilen.filter((z) => z.einsatz?.meldungEingereichtAm).length;

  return (
    <div
      className="lieferschein-seite p-6 text-gray-900"
      style={{ fontFamily: 'Arial, Helvetica, sans-serif', fontSize: '12px' }}
    >
      {/* ---- Kopfzeile ---- */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: '18px', fontWeight: 700, color: headerFarbe, marginBottom: '2px' }}>
            LIEFERSCHEIN{istSpringer ? ' — SPRINGER 🔄' : ''}
          </div>
          <div style={{ fontSize: '11px', color: '#6b7280' }}>
            Schlieper-Druck GmbH · Tip aktuell
          </div>
          <div style={{ fontSize: '11px', color: '#6b7280', marginTop: '1px' }}>
            Abrechnungsperiode: <strong>{periode.bezeichnung}</strong>
          </div>
          {istSpringer && (
            <div style={{
              fontSize: '11px',
              color: '#b91c1c',
              fontWeight: 700,
              marginTop: '3px',
              padding: '2px 6px',
              display: 'inline-block',
              border: '1.5px solid #b91c1c',
              borderRadius: '4px',
              background: '#fef2f2',
            }}>
              ⚠ Achtung Fahrer: NICHT zum Standardausträger, sondern zum Springer!
            </div>
          )}
        </div>
        {/* QR-Code rechts oben */}
        <div style={{ textAlign: 'center' }}>
          <img
            src={qrUrl}
            alt="QR-Code Online-Erfassung"
            width={90}
            height={90}
            style={{ display: 'block', border: '1px solid #e5e7eb', borderRadius: '4px' }}
            loading="lazy"
          />
          <div style={{ fontSize: '8px', color: '#6b7280', marginTop: '2px', maxWidth: '90px' }}>
            Online-Erfassung
          </div>
        </div>
      </div>

      {/* ---- Mitarbeiter + Teilgebiet-Info ---- */}
      <div style={{ display: 'flex', gap: '16px', marginBottom: '12px' }}>
        {/* Austräger-Box (bei Springer rot) */}
        <div style={{
          flex: 1,
          border: `1.5px solid ${boxBorder}`,
          borderRadius: '6px',
          padding: '8px 10px',
          backgroundColor: boxBg,
        }}>
          <div style={{
            fontSize: '10px',
            color: istSpringer ? '#b91c1c' : '#6b7280',
            marginBottom: '4px',
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
          }}>
            {istSpringer ? 'Springer (Ausliefer-Adresse!)' : 'Austräger'}
          </div>
          <div style={{
            fontWeight: 800,
            fontSize: '14px',
            marginBottom: '2px',
            color: istSpringer ? '#b91c1c' : '#111827',
          }}>{ma.name}</div>
          {ma.adresse.strasse && (
            <div style={{ color: istSpringer ? '#b91c1c' : '#374151' }}>{ma.adresse.strasse}</div>
          )}
          {(ma.adresse.plz || ma.adresse.ort) && (
            <div style={{ color: istSpringer ? '#b91c1c' : '#374151' }}>
              {ma.adresse.plz} {ma.adresse.ort}
            </div>
          )}
          {ma.telefon && (
            <div style={{ color: istSpringer ? '#b91c1c' : '#374151', marginTop: '2px', fontWeight: istSpringer ? 700 : 400 }}>
              📞 {ma.telefon}
            </div>
          )}
        </div>

        {/* Teilgebiet-Box */}
        <div style={{
          flex: 1,
          border: '1px solid #d1d5db',
          borderRadius: '6px',
          padding: '8px 10px',
          backgroundColor: '#f9fafb',
        }}>
          <div style={{ fontSize: '10px', color: '#6b7280', marginBottom: '4px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Teilgebiet
          </div>
          <div style={{ fontWeight: 700, fontSize: '13px', marginBottom: '2px' }}>
            {tg.name}
            {tg.plz && <span style={{ fontWeight: 400, color: '#6b7280', marginLeft: '6px' }}>{tg.plz}</span>}
          </div>
          <div style={{ color: '#374151' }}>
            📦 {tg.stueckzahl} Stück &nbsp;·&nbsp; 🛣️ {formatKm(tg.wegstreckeM)}
          </div>
          {mitMeldung > 0 && (
            <div style={{ color: '#059669', fontSize: '10px', marginTop: '4px' }}>
              ✅ {mitMeldung} Online-Meldung{mitMeldung > 1 ? 'en' : ''} eingegangen
            </div>
          )}
        </div>
      </div>

      {/* ---- Tabelle ---- */}
      <table className="lieferschein-tabelle" style={{ marginBottom: '12px' }}>
        <thead>
          <tr>
            <th style={{ width: '30px', textAlign: 'center' }}>KW</th>
            <th style={{ width: '65px' }}>Datum</th>
            <th style={{ width: '45px', textAlign: 'center' }}>Stück</th>
            <th style={{ width: '40px', textAlign: 'center' }}>km</th>
            <th style={{ width: '50px', textAlign: 'center' }}>Gewicht<br />(kg)</th>
            <th style={{ width: '50px', textAlign: 'center' }}>Soll-<br />Zeit</th>
            <th style={{ minWidth: '80px' }}>Beilagen</th>
            <th style={{ width: '55px', textAlign: 'center' }}>Von</th>
            <th style={{ width: '55px', textAlign: 'center' }}>Bis</th>
            <th style={{ width: '45px', textAlign: 'center' }}>Pause<br />(Min.)</th>
            <th style={{ width: '45px', textAlign: 'center' }}>Rest<br />(Stk.)</th>
          </tr>
        </thead>
        <tbody>
          {zeilen.map((z) => {
            // Ausfall-Zeile
            if (z.einsatz?.typ === 'ausfall' || z.einsatz?.typ === 'ungeklärt') {
              return (
                <tr key={z.kw} className="ausfall-row">
                  <td style={{ textAlign: 'center' }}>{z.kw}</td>
                  <td>{formatDatum(z.mittwoch)}</td>
                  <td colSpan={9} style={{ textAlign: 'center', color: '#9ca3af' }}>
                    {z.einsatz.typ === 'ausfall' ? '— Ausfall —' : '? Ungeklärt ?'}
                  </td>
                </tr>
              );
            }

            // Keine Ausgabe für diese KW (geplant oder nicht angelegt)
            if (!z.ausgabe) {
              return (
                <tr key={z.kw}>
                  <td style={{ textAlign: 'center', color: '#9ca3af' }}>{z.kw}</td>
                  <td style={{ color: '#9ca3af' }}>{formatDatum(z.mittwoch)}</td>
                  <td colSpan={9} style={{ textAlign: 'center', color: '#d1d5db', fontSize: '10px' }}>
                    (noch nicht angelegt)
                  </td>
                </tr>
              );
            }

            // Standard-Zeile (kein Einsatz-Dokument = Standard-Austräger)
            const az = z.einsatz?.arbeitszeit; // eventuell bereits online gemeldet
            const beilagenText = z.beilagen.length > 0
              ? z.beilagen.map((b) => b.arbeitstitel || b.kundenname).join(', ')
              : '';
            const gewichtKg =
              berechneGewichtAnzeigenblattKg(tg, z.ausgabe) +
              berechneGewichtBeilagenKg(tg, z.beilagen);

            return (
              <tr key={z.kw}>
                <td style={{ textAlign: 'center', fontWeight: 600 }}>{z.kw}</td>
                <td>{formatDatum(z.mittwoch)}</td>
                <td style={{ textAlign: 'center' }}>{z.ausgabe.seitenzahl ? `${tg.stueckzahl}` : '—'}</td>
                <td style={{ textAlign: 'center' }}>
                  {(tg.wegstreckeM / 1000).toFixed(1)}
                </td>
                <td style={{ textAlign: 'center', fontWeight: 600 }}>
                  {gewichtKg.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
                </td>
                <td style={{ textAlign: 'center', fontWeight: 600 }}>
                  {(() => {
                    if (!parameter) return '—';
                    const extBeilagen = z.beilagen.filter((b) => b.kennzeichen === 'ext').length;
                    const sollH = berechneAustraegezeit(tg, parameter, extBeilagen);
                    return sollH > 0 ? formatierStunden(sollH) : '—';
                  })()}
                </td>
                <td style={{ color: beilagenText ? '#1d4ed8' : '#d1d5db', fontSize: '10px' }}>
                  {beilagenText || '—'}
                </td>
                {/* Von */}
                <td>
                  {az ? (
                    <span style={{ color: '#059669', fontWeight: 600 }}>{az.von}</span>
                  ) : (
                    <span className="fill-cell" style={{ display: 'block', borderBottom: '1.5px solid #374151', minHeight: '18px' }} />
                  )}
                </td>
                {/* Bis */}
                <td>
                  {az ? (
                    <span style={{ color: '#059669', fontWeight: 600 }}>{az.bis}</span>
                  ) : (
                    <span className="fill-cell" style={{ display: 'block', borderBottom: '1.5px solid #374151', minHeight: '18px' }} />
                  )}
                </td>
                {/* Pause */}
                <td style={{ textAlign: 'center' }}>
                  {az ? (
                    <span style={{ color: '#059669', fontWeight: 600 }}>{az.pausenMinuten}</span>
                  ) : (
                    <span className="fill-cell" style={{ display: 'block', borderBottom: '1.5px solid #374151', minHeight: '18px' }} />
                  )}
                </td>
                {/* Restmenge */}
                <td style={{ textAlign: 'center' }}>
                  {z.einsatz?.meldungEingereichtAm != null ? (
                    <span style={{ color: z.einsatz.restmenge ? '#f97316' : '#059669', fontWeight: 600 }}>
                      {z.einsatz.restmenge ?? 0}
                    </span>
                  ) : (
                    <span className="fill-cell" style={{ display: 'block', borderBottom: '1.5px solid #374151', minHeight: '18px' }} />
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* ---- Auslieferungs-Memos (rot) ---- */}
      {memos.length > 0 && (
        <div style={{
          marginTop: '8px',
          marginBottom: '10px',
          border: '2px solid #b91c1c',
          borderRadius: '6px',
          padding: '8px 10px',
          background: '#fef2f2',
        }}>
          <div style={{
            fontSize: '11px',
            color: '#b91c1c',
            fontWeight: 800,
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            marginBottom: '4px',
          }}>
            ⚠ Wichtige Hinweise zur Auslieferung
          </div>
          <ul style={{
            margin: 0,
            paddingLeft: '14px',
            color: '#b91c1c',
            fontSize: '11px',
            fontWeight: 600,
            lineHeight: 1.4,
          }}>
            {memos.map((m, i) => (
              <li key={i} style={{ marginBottom: '2px' }}>
                <span style={{ fontSize: '9px', fontWeight: 700, marginRight: '4px' }}>
                  [KW {m.kw} · {m.scope === 'alle' ? 'Alle' : m.scope === 'tour' ? 'Tour' : 'TG'}]
                </span>
                <span style={{ whiteSpace: 'pre-wrap' }}>{m.text}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ---- Unterschrift & Hinweis ---- */}
      <div style={{ display: 'flex', gap: '20px', alignItems: 'flex-end', marginTop: '8px' }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: '10px', color: '#6b7280', marginBottom: '2px' }}>
            Ich bestätige die korrekte Auslieferung des Anzeigenblattes.
          </div>
          <div style={{ borderBottom: '1.5px solid #374151', marginTop: '20px' }} />
          <div style={{ fontSize: '9px', color: '#9ca3af', marginTop: '2px' }}>
            Datum / Unterschrift Austräger
          </div>
        </div>
        <div style={{
          flex: 1,
          border: '1px solid #d1d5db',
          borderRadius: '6px',
          padding: '6px 8px',
          backgroundColor: '#eff6ff',
          fontSize: '9px',
          color: '#1e40af',
        }}>
          <strong style={{ fontSize: '10px' }}>📱 Online-Erfassung (empfohlen)</strong><br />
          QR-Code rechts oben scannen — Zeiten direkt im Browser eingeben, kein Login nötig.<br /><br />
          <strong>📷 Alternativ per WhatsApp / E-Mail:</strong><br />
          Ausgefüllten Zettel fotografieren und zurücksenden.
        </div>
      </div>

      {/* Adressleiste für Fahrer */}
      <div style={{
        marginTop: '10px',
        paddingTop: '6px',
        borderTop: '1px dashed #d1d5db',
        fontSize: '9px',
        color: '#9ca3af',
        display: 'flex',
        justifyContent: 'space-between',
      }}>
        <span>Lieferadresse: {adresse}</span>
        <span>Druckdatum: {new Date().toLocaleDateString('de-DE')}</span>
      </div>
    </div>
  );
}
