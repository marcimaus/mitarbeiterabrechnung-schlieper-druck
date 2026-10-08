// Erinnerungsbanner „Verteilplan online aktualisieren" — steht in den
// Teilgebieten und im Verteilplan, solange eine Stückzahländerung noch nicht
// auf die Webseite übernommen wurde (siehe lib/verteilplanOnline.ts).

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { verteilplanOnlineErledigt } from '../lib/verteilplanOnline';

export default function VerteilplanOnlineHinweis({ mitLinkZumVerteilplan = false }: { mitLinkZumVerteilplan?: boolean }) {
  const { parameter } = useApp();
  const [busy, setBusy] = useState(false);
  const [details, setDetails] = useState(false);
  const hinweis = parameter?.verteilplanOnlineHinweis;
  if (!hinweis) return null;

  const seit = new Date(hinweis.seit).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });

  async function erledigt() {
    if (!confirm('Wurde der Verteilplan auf der Webseite aktualisiert? Der Hinweis wird dann ausgeblendet.')) return;
    setBusy(true);
    try {
      await verteilplanOnlineErledigt();
    } catch (e) {
      console.error(e);
      alert('Der Hinweis konnte nicht zurückgesetzt werden.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm text-amber-900 print:hidden">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="font-semibold">🌐 Bitte „Verteilplan online" aktualisieren</span>
        <span className="text-xs">
          Stückzahlen geändert seit {seit} — „📄 PDF blanko" neu erzeugen und auf der Webseite austauschen.
        </span>
        <button
          type="button"
          onClick={() => setDetails((d) => !d)}
          className="text-xs underline hover:no-underline"
        >
          {details ? 'Änderungen ausblenden' : `${hinweis.aenderungen.length} Änderung${hinweis.aenderungen.length === 1 ? '' : 'en'} anzeigen`}
        </button>
        <span className="ml-auto flex items-center gap-2">
          {mitLinkZumVerteilplan && (
            <Link
              to="/verteilplan"
              className="text-xs border border-amber-400 bg-white px-2.5 py-1 rounded hover:bg-amber-100"
            >
              Zum Verteilplan →
            </Link>
          )}
          <button
            type="button"
            onClick={erledigt}
            disabled={busy}
            className="text-xs bg-amber-600 text-white px-2.5 py-1 rounded hover:bg-amber-700 disabled:opacity-50"
          >
            ✓ Erledigt
          </button>
        </span>
      </div>
      {details && (
        <ul className="mt-1.5 list-disc pl-5 text-xs space-y-0.5">
          {hinweis.aenderungen.map((a, i) => (
            <li key={i}>{a}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
