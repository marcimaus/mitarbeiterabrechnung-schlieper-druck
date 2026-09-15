// Statistikmeldung — Stundenberechnung für die behördliche Statistik.
//
// Zeigt je Monat eines Jahres die gemeldeten Arbeitsstunden:
//   Ist-Stunden „Sonstige" + „Vorarbeit"  (tatsächlich erfasste Zeit)
//   Soll-Stunden „Austragen" + „Zusammentragen" (kalkulierte Plan-Zeit)
// und deren Summe. Nur für den Admin sichtbar (Gating im aufrufenden Screen).

import { useEffect, useState } from 'react';
import { useApp } from '../context/AppContext';
import {
  ladePeriodeData,
  berechneAbrechnung,
  aggregiereStatistikStunden,
  type MitarbeiterAbrechnung,
  type StatistikStunden,
} from '../lib/abrechnungslogik';

interface MonatsZeile extends StatistikStunden {
  periodeId: string;
  monat: number;
  bezeichnung: string;
}

/** Dezimalstunden im deutschen Format, z. B. „123,75 h". */
function fmtStd(stunden: number): string {
  return (
    stunden.toLocaleString('de-DE', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }) + ' h'
  );
}

export default function StatistikMeldung() {
  const { mitarbeiter, teilgebiete, parameter, abrechnungsperioden } = useApp();
  const heute = new Date();

  // Auswählbare Jahre: alle Jahre mit Abrechnungsperioden, sonst das aktuelle.
  const jahre = (() => {
    const set = new Set<number>(abrechnungsperioden.map((p) => p.jahr));
    set.add(heute.getFullYear());
    return Array.from(set).sort((a, b) => b - a);
  })();

  const [jahr, setJahr] = useState<number>(jahre[0] ?? heute.getFullYear());
  const [zeilen, setZeilen] = useState<MonatsZeile[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [fehler, setFehler] = useState('');

  useEffect(() => {
    if (!parameter) return;
    const perioden = abrechnungsperioden
      .filter((p) => p.jahr === jahr)
      .sort((a, b) => a.monat - b.monat);
    if (perioden.length === 0) {
      setZeilen([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setFehler('');
    (async () => {
      try {
        const rows = await Promise.all(
          perioden.map(async (p): Promise<MonatsZeile> => {
            let ergebnisse: MitarbeiterAbrechnung[];
            if (p.status === 'abgeschlossen' && p.abrechnungSnapshot?.ergebnisse) {
              // Abgeschlossene Periode: gespeichertes Ergebnis verwenden.
              ergebnisse = p.abrechnungSnapshot.ergebnisse as MitarbeiterAbrechnung[];
            } else {
              // Offene Periode (oder ohne Snapshot): live berechnen. Variable
              // Periodenzusätze und Lohnkonto beeinflussen nur Beträge, nicht
              // die Stunden — daher hier leer.
              const data = await ladePeriodeData(p);
              ergebnisse = berechneAbrechnung(
                mitarbeiter,
                teilgebiete,
                data,
                parameter,
                p,
                [],
                abrechnungsperioden,
                []
              );
            }
            const agg = aggregiereStatistikStunden(ergebnisse);
            return { ...agg, periodeId: p.id, monat: p.monat, bezeichnung: p.bezeichnung };
          })
        );
        if (!cancelled) setZeilen(rows);
      } catch (e) {
        console.error('Fehler bei der Berechnung der Statistikmeldung:', e);
        if (!cancelled) {
          setFehler('Fehler bei der Berechnung der Statistikmeldung.');
          setZeilen(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [jahr, parameter, mitarbeiter, teilgebiete, abrechnungsperioden]);

  const summe: StatistikStunden | null = zeilen && zeilen.length > 0
    ? zeilen.reduce<StatistikStunden>(
        (s, z) => ({
          istSonstige: s.istSonstige + z.istSonstige,
          istVorarbeit: s.istVorarbeit + z.istVorarbeit,
          sollAustragen: s.sollAustragen + z.sollAustragen,
          sollZusammentragen: s.sollZusammentragen + z.sollZusammentragen,
          gesamt: s.gesamt + z.gesamt,
        }),
        { istSonstige: 0, istVorarbeit: 0, sollAustragen: 0, sollZusammentragen: 0, gesamt: 0 }
      )
    : null;

  return (
    <div className="space-y-4">
      {/* Kopf: Jahr-Auswahl + Erklärung */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="font-semibold text-gray-800">Statistikmeldung — Arbeitsstunden je Monat</h2>
          <select
            value={jahr}
            onChange={(e) => setJahr(Number(e.target.value))}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ml-auto"
            title="Jahr wählen"
          >
            {jahre.map((j) => (
              <option key={j} value={j}>{j}</option>
            ))}
          </select>
        </div>
        <p className="text-xs text-gray-500 mt-2">
          Ist-Stunden „Sonstige" + „Vorarbeit" (tatsächlich erfasste Zeit, inkl.
          Vorarbeit aus Stempeluhr und Zusammentragen) zuzüglich Soll-Stunden
          „Austragen" + „Zusammentragen" (kalkulierte Plan-Zeit).
        </p>
      </div>

      {fehler && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
          {fehler}
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-gray-400 text-sm">Berechne Stunden…</div>
        ) : zeilen === null ? (
          <div className="p-8 text-center text-gray-400 text-sm">—</div>
        ) : zeilen.length === 0 ? (
          <div className="p-8 text-center text-gray-400 text-sm">
            Keine Abrechnungsperioden im Jahr {jahr} vorhanden.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-2.5 font-medium text-gray-600">Monat</th>
                <th className="text-right px-4 py-2.5 font-medium text-gray-600">Ist Sonstige</th>
                <th className="text-right px-4 py-2.5 font-medium text-gray-600">Ist Vorarbeit</th>
                <th className="text-right px-4 py-2.5 font-medium text-gray-600">Soll Austragen</th>
                <th className="text-right px-4 py-2.5 font-medium text-gray-600">Soll Zusammentragen</th>
                <th className="text-right px-4 py-2.5 font-semibold text-gray-800">Gesamt</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {zeilen.map((z) => (
                <tr key={z.periodeId} className="hover:bg-gray-50">
                  <td className="px-4 py-2.5 text-gray-700">{z.bezeichnung}</td>
                  <td className="px-4 py-2.5 text-right text-gray-600">{fmtStd(z.istSonstige)}</td>
                  <td className="px-4 py-2.5 text-right text-gray-600">{fmtStd(z.istVorarbeit)}</td>
                  <td className="px-4 py-2.5 text-right text-gray-600">{fmtStd(z.sollAustragen)}</td>
                  <td className="px-4 py-2.5 text-right text-gray-600">{fmtStd(z.sollZusammentragen)}</td>
                  <td className="px-4 py-2.5 text-right font-semibold text-gray-900">{fmtStd(z.gesamt)}</td>
                </tr>
              ))}
            </tbody>
            {summe && (
              <tfoot className="border-t-2 border-gray-300 bg-gray-50">
                <tr>
                  <td className="px-4 py-2.5 font-semibold text-gray-800">Summe {jahr}</td>
                  <td className="px-4 py-2.5 text-right font-medium text-gray-700">{fmtStd(summe.istSonstige)}</td>
                  <td className="px-4 py-2.5 text-right font-medium text-gray-700">{fmtStd(summe.istVorarbeit)}</td>
                  <td className="px-4 py-2.5 text-right font-medium text-gray-700">{fmtStd(summe.sollAustragen)}</td>
                  <td className="px-4 py-2.5 text-right font-medium text-gray-700">{fmtStd(summe.sollZusammentragen)}</td>
                  <td className="px-4 py-2.5 text-right font-bold text-gray-900">{fmtStd(summe.gesamt)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        )}
      </div>
    </div>
  );
}
