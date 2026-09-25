import { useState } from 'react';
import { useApp } from '../context/AppContext';
import { verifyPin, hashPin } from '../lib/auth';
import { aktualisiereMitarbeiter } from '../lib/db';
import Modal from './Modal';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * Selbstverwaltung: Ein als Mitarbeiter eingeloggter Nutzer ändert seinen
 * eigenen PIN. Erfordert die Eingabe des aktuellen PINs zur Bestätigung.
 */
export default function PinAendernModal({ isOpen, onClose }: Props) {
  const { mitarbeiter, mitarbeiterId } = useApp();
  const ma = mitarbeiterId ? mitarbeiter.find((m) => m.id === mitarbeiterId) : undefined;

  const [aktuellerPin, setAktuellerPin] = useState('');
  const [neuerPin, setNeuerPin] = useState('');
  const [bestaetigung, setBestaetigung] = useState('');
  const [error, setError] = useState('');
  const [erfolg, setErfolg] = useState(false);
  const [saving, setSaving] = useState(false);

  function reset() {
    setAktuellerPin('');
    setNeuerPin('');
    setBestaetigung('');
    setError('');
    setErfolg(false);
    setSaving(false);
  }

  function schliessen() {
    reset();
    onClose();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (!ma?.pinHash) { setError('Kein PIN hinterlegt. Bitte an die Verwaltung wenden.'); return; }
    if (neuerPin.length < 4) { setError('Neuer PIN muss mindestens 4 Ziffern haben.'); return; }
    if (neuerPin !== bestaetigung) { setError('Neue PINs stimmen nicht überein.'); return; }

    setSaving(true);
    try {
      const aktuellOk = await verifyPin(aktuellerPin, ma.pinHash);
      if (!aktuellOk) {
        setError('Aktueller PIN ist falsch.');
        setAktuellerPin('');
        return;
      }
      const hash = await hashPin(neuerPin);
      await aktualisiereMitarbeiter(ma.id, { pinHash: hash });
      setErfolg(true);
    } catch {
      setError('Fehler beim Speichern. Bitte erneut versuchen.');
    } finally {
      setSaving(false);
    }
  }

  const inputClass =
    'w-full text-center text-2xl tracking-widest border border-gray-300 rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500';

  return (
    <Modal isOpen={isOpen} onClose={schliessen} title="PIN ändern" size="sm">
      {erfolg ? (
        <div className="text-center space-y-4 py-2">
          <div className="text-4xl">✅</div>
          <p className="text-gray-700">Dein PIN wurde geändert.</p>
          <button
            type="button"
            onClick={schliessen}
            className="w-full bg-blue-600 text-white rounded-lg px-4 py-2.5 font-medium hover:bg-blue-700 transition-colors"
          >
            Schließen
          </button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-gray-600 mb-1.5">Aktueller PIN</label>
            <input
              type="password"
              inputMode="numeric"
              maxLength={8}
              placeholder="Aktueller PIN"
              value={aktuellerPin}
              onChange={(e) => setAktuellerPin(e.target.value.replace(/\D/g, ''))}
              className={inputClass}
              autoFocus
            />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1.5">Neuer PIN (min. 4 Ziffern)</label>
            <input
              type="password"
              inputMode="numeric"
              maxLength={8}
              placeholder="Neuer PIN"
              value={neuerPin}
              onChange={(e) => setNeuerPin(e.target.value.replace(/\D/g, ''))}
              className={inputClass}
            />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1.5">Neuer PIN wiederholen</label>
            <input
              type="password"
              inputMode="numeric"
              maxLength={8}
              placeholder="Neuer PIN wiederholen"
              value={bestaetigung}
              onChange={(e) => setBestaetigung(e.target.value.replace(/\D/g, ''))}
              className={`${inputClass} ${
                bestaetigung && bestaetigung !== neuerPin ? 'border-red-400 bg-red-50' : ''
              }`}
            />
          </div>

          {error && <p className="text-red-600 text-sm text-center">{error}</p>}

          <button
            type="submit"
            disabled={
              saving ||
              aktuellerPin.length < 4 ||
              neuerPin.length < 4 ||
              neuerPin !== bestaetigung
            }
            className="w-full bg-blue-600 text-white rounded-lg px-4 py-3 font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {saving ? 'Speichere…' : 'PIN ändern'}
          </button>
        </form>
      )}
    </Modal>
  );
}
