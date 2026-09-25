// ============================================================
// Protokoll einer Beilagenbestellung
// ============================================================
//
// Read-only Verlaufsansicht der Collection `beilagenVorlagenLog` für eine
// Bestellung: wer hat wann was angelegt, geändert (feldweise alt → neu),
// archiviert, in einen Auftrag übernommen oder gelöscht.

import { useEffect, useState } from 'react';
import Modal from './Modal';
import { beilagenVorlageLogListener } from '../lib/db';
import type { BeilagenVorlageLog } from '../types';

const AKTION_LABEL: Record<BeilagenVorlageLog['aktion'], string> = {
  erstellt: '🆕 Angelegt',
  geaendert: '✏️ Geändert',
  archiviert: '🗄 Archiviert',
  reaktiviert: '↩ Aus Archiv geholt',
  uebernommen: '➡ In Auftrag übernommen',
  geloescht: '🗑 Gelöscht',
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

export default function BestellungProtokollModal({
  vorlageId,
  titel,
  onClose,
}: {
  vorlageId: string;
  titel: string;
  onClose: () => void;
}) {
  const [eintraege, setEintraege] = useState<BeilagenVorlageLog[] | null>(null);
  useEffect(() => beilagenVorlageLogListener(vorlageId, setEintraege), [vorlageId]);

  return (
    <Modal isOpen={true} onClose={onClose} title={`Protokoll — ${titel}`} size="lg">
      <div className="space-y-3">
        <p className="text-xs text-gray-500">
          Alle Änderungen an dieser Bestellung, neueste zuerst. Einträge vor Einführung des Protokolls
          (22.09.2026) sind nicht erfasst.
        </p>
        <div className="max-h-[60vh] overflow-y-auto border border-gray-200 rounded divide-y divide-gray-100">
          {eintraege === null ? (
            <div className="px-3 py-4 text-sm text-gray-400 text-center">Lade …</div>
          ) : eintraege.length === 0 ? (
            <div className="px-3 py-4 text-sm text-gray-400 italic text-center">Keine Einträge.</div>
          ) : (
            eintraege.map((e) => (
              <div key={e.id} className="px-3 py-2 text-xs space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-gray-800">{AKTION_LABEL[e.aktion] ?? e.aktion}</span>
                  <span className="text-gray-400">{formatZeitstempel(e.zeitstempel)}</span>
                </div>
                {e.hinweis && <div className="text-gray-600">{e.hinweis}</div>}
                {(e.aenderungen ?? []).length > 0 && (
                  <ul className="space-y-0.5">
                    {e.aenderungen!.map((a, i) => (
                      <li key={i} className="text-gray-600">
                        <span className="font-medium">{a.feld}:</span>{' '}
                        {a.alt && <span className="line-through text-gray-400">{a.alt}</span>}
                        {a.alt && a.neu && ' → '}
                        {a.neu && <span className="text-gray-800 font-medium">{a.neu}</span>}
                      </li>
                    ))}
                  </ul>
                )}
                <div className="text-gray-400">von {e.benutzer}</div>
              </div>
            ))
          )}
        </div>
        <div className="flex justify-end pt-2 border-t border-gray-100">
          <button type="button" onClick={onClose} className="text-gray-500 hover:text-gray-700 text-sm px-2">
            Schließen
          </button>
        </div>
      </div>
    </Modal>
  );
}
