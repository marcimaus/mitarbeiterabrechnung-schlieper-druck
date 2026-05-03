// Verlauf eines Lohnkontos je Mitarbeiter — chronologische Liste aller
// Buchungen mit laufendem Saldo. Wird sowohl von der Mitarbeiter-Liste als
// auch aus der Abrechnung (per "Verlauf"-Button) geöffnet.

import { useMemo } from 'react';
import Modal from './Modal';
import { useApp } from '../context/AppContext';
import type { Abrechnungsperiode, LohnkontoBuchung, Mitarbeiter } from '../types';
import { eur } from '../lib/abrechnungslogik';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  mitarbeiter: Mitarbeiter;
}

interface Zeile {
  buchung: LohnkontoBuchung;
  periode?: Abrechnungsperiode;
  saldoNach: number;
}

export default function LohnkontoVerlauf({ isOpen, onClose, mitarbeiter }: Props) {
  const { lohnkontoBuchungen, abrechnungsperioden } = useApp();

  const zeilen = useMemo<Zeile[]>(() => {
    const buchungenMa = lohnkontoBuchungen.filter(
      (b) => b.mitarbeiterId === mitarbeiter.id
    );
    // Periode-Lookup nach ID
    const periodeMap = new Map<string, Abrechnungsperiode>();
    for (const p of abrechnungsperioden) periodeMap.set(p.id, p);

    // Chronologisch sortieren — primär nach Periode (Jahr/Monat),
    // sekundär nach erstelltAm. Buchungen ohne bekannte Periode ans Ende.
    const sorted = [...buchungenMa].sort((a, b) => {
      const pa = periodeMap.get(a.abrechnungsperiodeId);
      const pb = periodeMap.get(b.abrechnungsperiodeId);
      if (pa && pb) {
        if (pa.jahr !== pb.jahr) return pa.jahr - pb.jahr;
        if (pa.monat !== pb.monat) return pa.monat - pb.monat;
        return a.erstelltAm - b.erstelltAm;
      }
      if (pa && !pb) return -1;
      if (!pa && pb) return 1;
      return a.erstelltAm - b.erstelltAm;
    });

    let saldo = 0;
    return sorted.map((b) => {
      saldo += b.art === 'verschiebung' ? b.betragEur : -b.betragEur;
      return {
        buchung: b,
        periode: periodeMap.get(b.abrechnungsperiodeId),
        saldoNach: saldo,
      };
    });
  }, [lohnkontoBuchungen, abrechnungsperioden, mitarbeiter.id]);

  const aktuellerSaldo = zeilen.length > 0 ? zeilen[zeilen.length - 1].saldoNach : 0;
  const summeVerschiebung = zeilen
    .filter((z) => z.buchung.art === 'verschiebung')
    .reduce((s, z) => s + z.buchung.betragEur, 0);
  const summeVerrechnung = zeilen
    .filter((z) => z.buchung.art === 'verrechnung')
    .reduce((s, z) => s + z.buchung.betragEur, 0);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Lohnkonto-Verlauf — ${mitarbeiter.name} (${mitarbeiter.nummer})`}
      size="xl"
    >
      <div className="space-y-4">
        {/* Kopfzeile mit Kennzahlen */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Kennzahl
            label="Buchungen"
            value={zeilen.length.toString()}
            farbe="bg-blue-50 text-blue-700 border-blue-100"
          />
          <Kennzahl
            label="Σ verschoben"
            value={`−${eur(summeVerschiebung)}`}
            farbe="bg-amber-50 text-amber-800 border-amber-100"
          />
          <Kennzahl
            label="Σ verrechnet"
            value={`+${eur(summeVerrechnung)}`}
            farbe="bg-green-50 text-green-800 border-green-100"
          />
          <Kennzahl
            label="Aktueller Saldo"
            value={eur(aktuellerSaldo)}
            farbe={
              aktuellerSaldo > 0
                ? 'bg-amber-100 text-amber-900 border-amber-300'
                : aktuellerSaldo < 0
                  ? 'bg-red-100 text-red-900 border-red-300'
                  : 'bg-gray-50 text-gray-700 border-gray-200'
            }
            gross
          />
        </div>

        <div className="text-xs text-gray-500 italic">
          Hinweis: Verschiebungen werden NICHT an das Lohnbüro übermittelt — der
          Verlauf ist nur intern in dieser App sichtbar. „+" beim Saldo bedeutet
          Guthaben des Mitarbeiters auf dem Lohnkonto, das in Folgemonaten
          verrechnet werden kann.
        </div>

        {/* Tabelle */}
        {zeilen.length === 0 ? (
          <div className="rounded-lg border border-gray-200 bg-gray-50 py-12 text-center text-sm text-gray-500">
            Keine Lohnkonto-Buchungen für diesen Mitarbeiter vorhanden.
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-gray-200">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200 text-gray-600">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Periode</th>
                  <th className="px-3 py-2 text-left font-medium">Art</th>
                  <th className="px-3 py-2 text-right font-medium">Betrag</th>
                  <th className="px-3 py-2 text-right font-medium">Saldo nach Buchung</th>
                  <th className="px-3 py-2 text-left font-medium">Kommentar</th>
                  <th className="px-3 py-2 text-right font-medium">Gebucht am</th>
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
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-800 border border-amber-200">
                          → Lohnkonto (zurückgelegt)
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800 border border-green-200">
                          ← Lohnkonto (gutgeschrieben)
                        </span>
                      )}
                    </td>
                    <td
                      className={`px-3 py-2 text-right font-semibold ${
                        buchung.art === 'verschiebung' ? 'text-amber-700' : 'text-green-700'
                      }`}
                    >
                      {buchung.art === 'verschiebung' ? '−' : '+'}
                      {eur(buchung.betragEur)}
                    </td>
                    <td
                      className={`px-3 py-2 text-right font-medium ${
                        saldoNach > 0
                          ? 'text-amber-800'
                          : saldoNach < 0
                            ? 'text-red-700'
                            : 'text-gray-600'
                      }`}
                    >
                      {eur(saldoNach)}
                    </td>
                    <td className="px-3 py-2 text-gray-600">
                      {buchung.kommentar ?? <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-3 py-2 text-right text-xs text-gray-500">
                      {new Date(buchung.erstelltAm).toLocaleDateString('de-DE')}
                    </td>
                  </tr>
                ))}
                {/* Schlusszeile mit aktuellem Saldo */}
                <tr className="bg-blue-50 border-t-2 border-blue-200">
                  <td colSpan={3} className="px-3 py-2 text-right font-bold text-gray-900">
                    Aktueller Saldo
                  </td>
                  <td
                    className={`px-3 py-2 text-right font-bold ${
                      aktuellerSaldo > 0
                        ? 'text-amber-800'
                        : aktuellerSaldo < 0
                          ? 'text-red-700'
                          : 'text-gray-700'
                    }`}
                  >
                    {eur(aktuellerSaldo)}
                  </td>
                  <td colSpan={2}></td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Modal>
  );
}

function Kennzahl({
  label,
  value,
  farbe,
  gross = false,
}: {
  label: string;
  value: string;
  farbe: string;
  gross?: boolean;
}) {
  return (
    <div className={`rounded-lg border p-3 ${farbe}`}>
      <div className="text-xs opacity-70 mb-0.5">{label}</div>
      <div className={`font-bold ${gross ? 'text-lg' : 'text-base'}`}>{value}</div>
    </div>
  );
}
