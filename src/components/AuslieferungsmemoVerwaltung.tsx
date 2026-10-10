// Verwaltung der Auslieferungs-Memos je Ausgabe.
// Scopes: alle (gilt für jedes Teilgebiet), tour (alle TG einer Tour), teilgebiet (einzelnes TG).
// Memos werden beim Druck der Lieferscheine unterhalb der Tabelle in ROT angezeigt.

import { useEffect, useState } from 'react';
import type { Ausgabe, AuslieferungsMemo, Teilgebiet, Tour } from '../types';
import {
  ladeAuslieferungsmemos,
  erstelleAuslieferungsmemo,
  aktualisiereAuslieferungsmemo,
  loescheAuslieferungsmemo,
} from '../lib/db';
import Modal from './Modal';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  ausgabe: Ausgabe;
  teilgebiete: Teilgebiet[];
  touren: Tour[];
}

type ScopeOption = 'alle' | 'tour' | 'teilgebiet';

export default function AuslieferungsmemoVerwaltung({
  isOpen,
  onClose,
  ausgabe,
  teilgebiete,
  touren,
}: Props) {
  const [memos, setMemos] = useState<AuslieferungsMemo[]>([]);
  const [loading, setLoading] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);

  const [scope, setScope] = useState<ScopeOption>('alle');
  const [tourId, setTourId] = useState('');
  const [teilgebietId, setTeilgebietId] = useState('');
  const [text, setText] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    reload();
  }, [isOpen, ausgabe.id]);

  async function reload() {
    setLoading(true);
    const list = await ladeAuslieferungsmemos(ausgabe.id);
    list.sort((a, b) => b.erstelltAm - a.erstelltAm);
    setMemos(list);
    setLoading(false);
  }

  function resetForm() {
    setEditId(null);
    setScope('alle');
    setTourId('');
    setTeilgebietId('');
    setText('');
  }

  function editieren(m: AuslieferungsMemo) {
    setEditId(m.id);
    setScope(m.scope);
    setTourId(m.tourId ?? '');
    setTeilgebietId(m.teilgebietId ?? '');
    setText(m.text);
  }

  async function speichern() {
    const trimmed = text.trim();
    if (!trimmed) return;
    if (scope === 'tour' && !tourId) {
      alert('Bitte eine Tour wählen.');
      return;
    }
    if (scope === 'teilgebiet' && !teilgebietId) {
      alert('Bitte ein Teilgebiet wählen.');
      return;
    }

    // Firestore akzeptiert keine 'undefined'-Werte → optionale Felder nur setzen, wenn befüllt.
    const data: {
      ausgabeId: string;
      scope: ScopeOption;
      text: string;
      tourId?: string;
      teilgebietId?: string;
    } = {
      ausgabeId: ausgabe.id,
      scope,
      text: trimmed,
    };
    if (scope === 'tour') data.tourId = tourId;
    if (scope === 'teilgebiet') data.teilgebietId = teilgebietId;

    try {
      if (editId) {
        // Beim Update: nicht-relevante Felder auf null statt undefined setzen,
        // damit Firestore sie akzeptiert und alte Werte überschrieben werden.
        await aktualisiereAuslieferungsmemo(editId, {
          ausgabeId: ausgabe.id,
          scope,
          text: trimmed,
          tourId: scope === 'tour' ? tourId : (null as unknown as string | undefined),
          teilgebietId: scope === 'teilgebiet' ? teilgebietId : (null as unknown as string | undefined),
        });
      } else {
        await erstelleAuslieferungsmemo(data);
      }
      resetForm();
      await reload();
    } catch (err) {
      console.error('Fehler beim Speichern des Memos:', err);
      alert('Fehler beim Speichern des Memos:\n' + (err as Error).message);
    }
  }

  async function loeschen(id: string) {
    if (!confirm('Memo wirklich löschen?')) return;
    await loescheAuslieferungsmemo(id);
    if (editId === id) resetForm();
    await reload();
  }

  function scopeLabel(m: AuslieferungsMemo): string {
    if (m.scope === 'alle') return '🌐 Alle Austräger';
    if (m.scope === 'tour') {
      const t = touren.find((t) => t.id === m.tourId);
      return t ? `🚚 Tour: ${t.name}` : '🚚 Tour (?)';
    }
    const tg = teilgebiete.find((x) => x.id === m.teilgebietId);
    return tg ? `📍 ${tg.name}` : '📍 Teilgebiet (?)';
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={() => { resetForm(); onClose(); }}
      title={`Auslieferungs-Memos — KW ${ausgabe.kw}/${ausgabe.jahr}`}
      size="lg"
    >
      <div className="space-y-4">
        {/* Eingabe-Form */}
        <div className="border border-gray-200 rounded-lg p-4 bg-gray-50">
          <div className="text-sm font-medium text-gray-700 mb-3">
            {editId ? '✏️ Memo bearbeiten' : '➕ Neues Memo erfassen'}
          </div>

          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Gültig für</label>
              <div className="flex gap-2 flex-wrap">
                {(['alle', 'tour', 'teilgebiet'] as ScopeOption[]).map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => setScope(opt)}
                    className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${
                      scope === opt
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'bg-white text-gray-700 border-gray-300 hover:border-blue-400'
                    }`}
                  >
                    {opt === 'alle' && '🌐 Alle Austräger'}
                    {opt === 'tour' && '🚚 Tour'}
                    {opt === 'teilgebiet' && '📍 Teilgebiet'}
                  </button>
                ))}
              </div>
            </div>

            {scope === 'tour' && (
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Tour</label>
                <select
                  value={tourId}
                  onChange={(e) => setTourId(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                >
                  <option value="">— bitte wählen —</option>
                  {touren.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
              </div>
            )}

            {scope === 'teilgebiet' && (
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Teilgebiet</label>
                <select
                  value={teilgebietId}
                  onChange={(e) => setTeilgebietId(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                >
                  <option value="">— bitte wählen —</option>
                  {[...teilgebiete]
                    .filter((tg) => tg.isActive)
                    .sort((a, b) => a.name.localeCompare(b.name))
                    .map((tg) => (
                      <option key={tg.id} value={tg.id}>{tg.name} ({tg.plz})</option>
                    ))}
                </select>
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Memo-Text</label>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={3}
                placeholder="z. B. 'Auslieferung diese Woche erst Donnerstag 14:00'"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={speichern}
                disabled={!text.trim()}
                className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
              >
                {editId ? 'Änderung speichern' : 'Memo anlegen'}
              </button>
              {editId && (
                <button
                  type="button"
                  onClick={resetForm}
                  className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 text-sm"
                >
                  Abbrechen
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Liste */}
        <div>
          <div className="text-sm font-medium text-gray-700 mb-2">
            Bestehende Memos ({memos.length})
          </div>
          {loading ? (
            <div className="text-center py-6 text-gray-500 text-sm">Lädt…</div>
          ) : memos.length === 0 ? (
            <div className="text-center py-6 text-gray-400 text-sm">
              Noch keine Memos für diese Ausgabe.
            </div>
          ) : (
            <ul className="divide-y divide-gray-200 border border-gray-200 rounded-lg">
              {memos.map((m) => (
                <li key={m.id} className="p-3 flex items-start gap-3 hover:bg-gray-50">
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium text-gray-600 mb-0.5">
                      {scopeLabel(m)}
                    </div>
                    <div className="text-sm text-red-700 whitespace-pre-wrap">{m.text}</div>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => editieren(m)}
                      className="text-xs px-2 py-1 rounded bg-blue-50 text-blue-700 hover:bg-blue-100"
                    >
                      ✏️
                    </button>
                    <button
                      type="button"
                      onClick={() => loeschen(m.id)}
                      className="text-xs px-2 py-1 rounded bg-red-50 text-red-700 hover:bg-red-100"
                    >
                      🗑
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Modal>
  );
}
