// ============================================================
// Änderungsprotokoll — geteilte Verlaufsansicht
// ============================================================
//
// Read-only Verlaufsansicht der Collection `auditlog`. Gefiltert wird entweder
// auf einen Bereich (Austräger-Ausfälle / Standard-Wechsel / Teilgebiets-
// anpassung / Teilgebietsdaten) oder — mit eigenem Titel — auf ein einzelnes
// Teilgebiet. Ermöglicht bei Reklamationen die Nachvollziehbarkeit, wer wann
// was geändert hat. Wird aus der Personalplanung und aus der Teilgebiete-
// Verwaltung geöffnet.

import { useMemo, useState } from 'react';
import Modal from './Modal';
import type { AuditLog } from '../types';

const PROTOKOLL_AKTION_LABEL: Record<AuditLog['aktion'], string> = {
  erstellt: '🆕 Erstellt',
  geaendert: '✏️ Geändert',
  geloescht: '🗑 Gelöscht',
};

const PROTOKOLL_BEREICH_TITEL: Record<AuditLog['bereich'], string> = {
  'austraeger-ausfall': 'Änderungsprotokoll — Austräger-Ausfälle / Springer',
  'dauerhafter-wechsel': 'Änderungsprotokoll — Planung dauerhafter Ausfälle / Standard-Wechsel',
  'teilgebiets-anpassung': 'Änderungsprotokoll — Teilgebietsanpassung (Stückzahl)',
  'teilgebiet-stammdaten': 'Änderungsprotokoll — Teilgebietsdaten (Mengen, Straßen, Links)',
};

function formatZeitstempel(ts: number): string {
  return new Date(ts).toLocaleString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function AenderungsProtokollModal({
  bereich,
  titel,
  eintraege,
  onClose,
}: {
  /** Bereich, aus dem das Protokoll geöffnet wurde — steuert nur den Titel. */
  bereich?: AuditLog['bereich'];
  /** Eigener Titel (z. B. Protokoll eines einzelnen Teilgebiets). */
  titel?: string;
  eintraege: AuditLog[];
  onClose: () => void;
}) {
  const [filterText, setFilterText] = useState('');
  const gefiltert = useMemo(() => {
    const suchtext = filterText.trim().toLowerCase();
    if (!suchtext) return eintraege;
    return eintraege.filter((e) =>
      [
        e.teilgebietName,
        e.mitarbeiterName ?? '',
        e.adminName,
        e.beschreibung,
        e.feld ?? '',
        e.altWert ?? '',
        e.neuWert ?? '',
      ]
        .join(' ')
        .toLowerCase()
        .includes(suchtext),
    );
  }, [eintraege, filterText]);

  const fensterTitel =
    titel ?? (bereich ? PROTOKOLL_BEREICH_TITEL[bereich] : undefined) ?? 'Änderungsprotokoll';

  return (
    <Modal isOpen={true} onClose={onClose} title={fensterTitel} size="lg">
      <div className="space-y-3">
        <input
          type="text"
          value={filterText}
          onChange={(e) => setFilterText(e.target.value)}
          placeholder="Filtern nach Teilgebiet, Mitarbeiter, Benutzer, Feld oder Text…"
          className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
        />
        <div className="text-[11px] text-gray-500">
          {gefiltert.length} von {eintraege.length} Einträgen
        </div>
        <div className="max-h-[60vh] overflow-y-auto border border-gray-200 rounded divide-y divide-gray-100">
          {gefiltert.length === 0 ? (
            <div className="px-3 py-4 text-sm text-gray-400 italic text-center">
              Keine Einträge.
            </div>
          ) : (
            gefiltert.map((e) => (
              <div key={e.id} className="px-3 py-2 text-xs space-y-0.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-gray-800 flex items-center gap-1.5">
                    {PROTOKOLL_AKTION_LABEL[e.aktion] ?? e.aktion}
                    {e.automatisch && (
                      <span
                        className="text-[10px] font-normal text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-full px-1.5 py-0.5"
                        title="Halb-automatisch: von der App ausgeführt (z. B. Umsetzung eines Wechsel-/Anpassungsplans beim Monatswechsel), durch einen Klick manuell angestoßen"
                      >
                        🤖 automatisch (App)
                      </span>
                    )}
                  </span>
                  <span className="text-gray-400">{formatZeitstempel(e.zeitstempel)}</span>
                </div>
                <div className="text-gray-600">
                  <strong>{e.teilgebietName}</strong>
                  {e.mitarbeiterName ? ` · ${e.mitarbeiterName}` : ''}
                  {e.kwVon != null && (
                    <span className="text-gray-400">
                      {' '}
                      · KW {e.kwVon}
                      {e.kwBis != null && e.kwBis !== e.kwVon ? `–${e.kwBis}` : ''}
                      {e.jahr != null ? `/${e.jahr}` : ''}
                    </span>
                  )}
                </div>
                {/* Feldweise protokollierte Änderungen (Teilgebietsdoku): alt → neu */}
                {e.feld && (
                  <div className="text-gray-600">
                    <span className="font-medium">{e.feld}:</span>{' '}
                    <span className="line-through text-gray-400">{e.altWert || '—'}</span>
                    {' → '}
                    <span className="text-gray-800 font-medium">{e.neuWert || '—'}</span>
                  </div>
                )}
                {!e.feld && <div className="text-gray-500">{e.beschreibung}</div>}
                <div className="text-gray-400">von {e.adminName}</div>
              </div>
            ))
          )}
        </div>
        <div className="flex justify-end pt-2 border-t border-gray-100">
          <button
            type="button"
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 text-sm px-2"
          >
            Schließen
          </button>
        </div>
      </div>
    </Modal>
  );
}
