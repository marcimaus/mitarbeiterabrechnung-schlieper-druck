// Eingabeblock „Sonder-Lieferadresse + Vorschuss" für einen Einsatz
// (Ausgabe × Teilgebiet). Genutzt im Einsätze-Screen (Springer-Dialog und
// eigener Dialog je Zeile) und im Ausfall-Dialog der Personalplanung.

import { useMemo, useState } from 'react';
import { adressKandidaten, formatAdresse, LEERE_SONDER_ADRESSE, type SonderLieferungWert } from '../lib/sonderLieferung';
import { hatAdresse } from '../utils';
import type { Mitarbeiter, SonderLieferadresse, Teilgebiet } from '../types';

const eur = (n: number) => n.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });

export default function SonderLieferungFelder({
  wert,
  onChange,
  teilgebiet,
  teilgebiete,
  mitarbeiter,
  empfaengerId,
  vorschussMoeglich,
  vorschussHinweis,
  geplanterBetrag,
  mehrereWochen,
  disabled,
}: {
  wert: SonderLieferungWert;
  onChange: (w: SonderLieferungWert) => void;
  teilgebiet: Teilgebiet | null;
  teilgebiete: Teilgebiet[];
  mitarbeiter: Mitarbeiter[];
  /** Austräger dieser Woche — seine eigenen Adressen werden nicht angeboten. */
  empfaengerId: string | null;
  /** Vorschuss nur, wenn ein Austräger feststeht. */
  vorschussMoeglich: boolean;
  vorschussHinweis?: string;
  /** Berechneter Lohn des Einsatzes (falls ermittelbar). */
  geplanterBetrag?: number | null;
  /** Ausfall über mehrere KWs — Angaben gelten für jede dieser Wochen. */
  mehrereWochen?: boolean;
  disabled?: boolean;
}) {
  const [suche, setSuche] = useState('');
  const [auswahlOffen, setAuswahlOffen] = useState(false);
  const kandidaten = useMemo(
    () => (teilgebiet ? adressKandidaten(mitarbeiter, teilgebiet.id, teilgebiete, empfaengerId) : []),
    [mitarbeiter, teilgebiet, teilgebiete, empfaengerId],
  );
  const treffer = useMemo(() => {
    const q = suche.trim().toLowerCase();
    const liste = q
      ? kandidaten.filter((k) =>
          `${k.mitarbeiter.name} ${k.mitarbeiter.nummer} ${formatAdresse(k.adresse)} ${k.art}`.toLowerCase().includes(q),
        )
      : kandidaten;
    return liste.slice(0, 60);
  }, [kandidaten, suche]);

  // Wer Straße/PLZ/Ort von Hand ändert, hat nicht mehr die übernommene Adresse.
  const setAdresse = (patch: Partial<SonderLieferadresse>) => {
    const neu = { ...wert.adresse, ...patch };
    if ('strasse' in patch || 'plz' in patch || 'ort' in patch) {
      delete neu.quelleMitarbeiterId;
      delete neu.quelleBeschreibung;
    }
    onChange({ ...wert, adresse: neu });
  };

  const inp = 'w-full border border-gray-300 rounded px-2 py-1 text-sm disabled:bg-gray-50';
  const geltung = mehrereWochen ? 'gilt für jede Woche dieses Ausfalls' : 'nur in dieser Woche';

  return (
    <div className="space-y-3">
      {/* ---- Sonder-Lieferadresse ---- */}
      <div className={`rounded-lg border p-3 ${wert.adresseAktiv ? 'border-orange-300 bg-orange-50' : 'border-gray-200'}`}>
        <label className="flex items-center gap-2 text-sm font-medium text-gray-800 cursor-pointer">
          <input
            type="checkbox"
            checked={wert.adresseAktiv}
            disabled={disabled}
            onChange={(e) => onChange({ ...wert, adresseAktiv: e.target.checked })}
          />
          📍 Andere Lieferadresse ({geltung})
        </label>
        {wert.adresseAktiv && (
          <div className="mt-2 space-y-2">
            {!disabled && (
              <div>
                <button
                  type="button"
                  onClick={() => setAuswahlOffen((v) => !v)}
                  className="text-xs text-blue-700 hover:underline"
                >
                  {auswahlOffen ? '▾' : '▸'} Aus gespeicherten Adressen anderer Mitarbeiter übernehmen
                </button>
                {auswahlOffen && (
                  <div className="mt-1 border border-gray-200 rounded bg-white">
                    <input
                      type="text"
                      value={suche}
                      onChange={(e) => setSuche(e.target.value)}
                      placeholder="Name, Nummer oder Adresse…"
                      className="w-full border-b border-gray-200 px-2 py-1 text-sm"
                      autoFocus
                    />
                    <div className="max-h-48 overflow-y-auto divide-y divide-gray-100">
                      {treffer.length === 0 ? (
                        <div className="px-2 py-2 text-xs text-gray-500 italic">Keine Adresse gefunden.</div>
                      ) : treffer.map((k, i) => {
                        const neueGruppe = i === 0 || treffer[i - 1].hatFreigabe !== k.hatFreigabe;
                        return (
                          <div key={k.key}>
                            {neueGruppe && (
                              <div className="px-2 py-0.5 bg-gray-50 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                                {k.hatFreigabe ? `Mit Freigabe für ${teilgebiet?.name ?? 'dieses Teilgebiet'}` : 'Weitere Mitarbeiter'}
                              </div>
                            )}
                            <button
                              type="button"
                              onClick={() => {
                                onChange({
                                  ...wert,
                                  adresse: {
                                    ...LEERE_SONDER_ADRESSE,
                                    ...k.adresse,
                                    telefon: k.adresse.telefon ?? '',
                                    memo: wert.adresse.memo ?? '',
                                    quelleMitarbeiterId: k.mitarbeiter.id,
                                    quelleBeschreibung: `${k.art} ${k.mitarbeiter.name}`,
                                  },
                                });
                                setAuswahlOffen(false);
                                setSuche('');
                              }}
                              className="w-full text-left px-2 py-1 hover:bg-blue-50 text-xs"
                            >
                              <span className="font-medium text-gray-900">{k.mitarbeiter.name}</span>
                              <span className="text-gray-500"> · {k.art}{k.fuerDiesesTg ? ' ★' : ''}</span>
                              <div className="text-gray-700">{formatAdresse(k.adresse)}</div>
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}
            <div className="grid grid-cols-6 gap-2">
              <div className="col-span-6">
                <input className={inp} placeholder="Straße + Hausnummer" value={wert.adresse.strasse} disabled={disabled}
                  onChange={(e) => setAdresse({ strasse: e.target.value })} />
              </div>
              <div className="col-span-2">
                <input className={inp} placeholder="PLZ" value={wert.adresse.plz} disabled={disabled}
                  onChange={(e) => setAdresse({ plz: e.target.value })} />
              </div>
              <div className="col-span-4">
                <input className={inp} placeholder="Ort" value={wert.adresse.ort} disabled={disabled}
                  onChange={(e) => setAdresse({ ort: e.target.value })} />
              </div>
              <div className="col-span-3">
                <input className={inp} placeholder="Telefon (optional)" value={wert.adresse.telefon ?? ''} disabled={disabled}
                  onChange={(e) => setAdresse({ telefon: e.target.value })} />
              </div>
              <div className="col-span-3">
                <input className={inp} placeholder="Hinweis für den Fahrer (optional)" value={wert.adresse.memo ?? ''} disabled={disabled}
                  onChange={(e) => setAdresse({ memo: e.target.value })} />
              </div>
            </div>
            {wert.adresse.quelleBeschreibung && (
              <div className="text-[11px] text-gray-500">Übernommen aus: {wert.adresse.quelleBeschreibung}</div>
            )}
            {!hatAdresse(wert.adresse) && (
              <div className="text-[11px] text-amber-700">Bitte mindestens Straße oder Ort angeben — sonst wird keine Sonder-Adresse gespeichert.</div>
            )}
            <div className="text-[11px] text-gray-500">Erscheint hervorgehoben auf dem Lieferschein.</div>
          </div>
        )}
      </div>

      {/* ---- Vorschuss ---- */}
      <div className={`rounded-lg border p-3 ${wert.vorschuss && vorschussMoeglich ? 'border-emerald-300 bg-emerald-50' : 'border-gray-200'}`}>
        <label className={`flex items-center gap-2 text-sm font-medium ${vorschussMoeglich ? 'text-gray-800 cursor-pointer' : 'text-gray-400'}`}>
          <input
            type="checkbox"
            checked={wert.vorschuss && vorschussMoeglich}
            disabled={disabled || !vorschussMoeglich}
            onChange={(e) => onChange({ ...wert, vorschuss: e.target.checked })}
          />
          💶 Einsatz als Vorschuss auszahlen ({geltung})
        </label>
        {!vorschussMoeglich && vorschussHinweis && (
          <div className="mt-1 text-[11px] text-gray-500">{vorschussHinweis}</div>
        )}
        {wert.vorschuss && vorschussMoeglich && (
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-xs text-gray-600">Betrag:</span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={wert.vorschussBetrag}
              disabled={disabled}
              onChange={(e) => onChange({ ...wert, vorschussBetrag: e.target.value })}
              placeholder={geplanterBetrag != null ? geplanterBetrag.toFixed(2) : 'berechnet'}
              className="w-28 border border-gray-300 rounded px-2 py-1 text-sm"
            />
            <span className="text-xs text-gray-500">
              € — leer = berechneter Lohn des Einsatzes
              {geplanterBetrag != null ? ` (aktuell ${eur(geplanterBetrag)})` : ''}
            </span>
            <div className="w-full text-[11px] text-gray-500">
              Auswahl + Druck im Einsätze-Screen (Status „Vorschuss vorgemerkt"); in der Abrechnung erscheint ein Hinweis —
              den Vorschuss bucht ihr dort wie gewohnt.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
