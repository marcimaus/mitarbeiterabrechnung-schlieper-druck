// Hinweise unter einem Mitarbeiter-Auswahlfeld (Personalplanung, Einsätze):
// Anmeldestatus beim Lohnbüro und — bei Abholern — eine abweichende
// Lieferadresse für das gewählte Teilgebiet.

import type { Mitarbeiter } from '../types';
import { anmeldeHinweis, type MaAuswahlKontext } from '../lib/maAuswahl';
import { formatAdresse } from '../lib/sonderLieferung';
import { tgLieferadresseFuer } from '../utils';

export default function MaAuswahlHinweise({
  ma,
  ktx,
  teilgebietId,
}: {
  ma: Mitarbeiter | null | undefined;
  ktx: MaAuswahlKontext;
  /** Gewähltes Teilgebiet — für den Abholer-Hinweis. */
  teilgebietId?: string | null;
}) {
  if (!ma) return null;
  const status = anmeldeHinweis(ma, ktx);
  const tgAdresse = teilgebietId && ma.istAbholer ? tgLieferadresseFuer(ma, teilgebietId) : undefined;
  if (!status && !tgAdresse) return null;
  return (
    <div className="mt-1 space-y-1">
      {status && (
        <div
          className={`rounded border px-2 py-1 text-[11px] ${
            status.stufe === 'warnung'
              ? 'border-red-300 bg-red-50 text-red-800'
              : 'border-amber-300 bg-amber-50 text-amber-900'
          }`}
        >
          {status.stufe === 'warnung' ? '⚠ ' : 'ℹ '}
          {status.text}
        </div>
      )}
      {tgAdresse && (
        <div className="rounded border border-orange-300 bg-orange-50 px-2 py-1 text-[11px] text-orange-900">
          📍 <strong>abw. Lieferadr.</strong> für dieses Teilgebiet: {formatAdresse(tgAdresse) || '—'}
          {tgAdresse.memo ? ` (${tgAdresse.memo})` : ''}. {ma.name} ist Abholer, wird für dieses Teilgebiet
          aber beliefert — der Lieferschein zeigt dann keine „Abholung". Ist die Adresse noch aktuell?
        </div>
      )}
    </div>
  );
}
