// ============================================================
// Änderungsprotokoll — geteilte Verlaufsansicht
// ============================================================
//
// Read-only Verlaufsansicht der Collection `auditlog`, gefiltert auf einen
// Bereich (Austräger-Ausfälle / Standard-Wechsel / Teilgebietsanpassung).
// Ermöglicht bei Reklamationen die Nachvollziehbarkeit, wer wann was
// geändert hat. Wird sowohl aus der Personalplanung als auch aus der
// Teilgebiete-Verwaltung geöffnet.

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
  eintraege,
  onClose,
}: {
  bereich: AuditLog['bereich'];
  eintraege: AuditLog[];
  onClose: () => void;
}) {
  const [filterText, setFilterText] = useState('');
  const gefiltert = useMemo(() => {
    const suchtext = filterText.trim().toLowerCase();
    if (!suchtext) return eintraege;
    return eintraege.filter((e) =>
      [e.teilgebietName, e.mitarbeiterName ?? '', e.adminName, e.beschreibung]
        .join(' ')
        .toLowerCase()
        .includes(suchtext),
    );
  }, [eintraege, filterText]);

  const titel = PROTOKOLL_BEREICH_TITEL[bereich] ?? 'Änderungsprotokoll';

  return (
    <Modal isOpen={true} onClose={onClose} title={titel} size="lg">
      <div className="space-y-3">
        <input
          type="text"
          value={filterText}
          onChange={(e) => setFilterText(e.target.value)}
          placeholder="Filtern nach Teilgebiet, Mitarbeiter, Benutzer oder Text…"
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
                  <span className="font-medium text-gray-800">
                    {PROTOKOLL_AKTION_LABEL[e.aktion] ?? e.aktion}
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
                <div className="text-gray-500">{e.beschreibung}</div>
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
