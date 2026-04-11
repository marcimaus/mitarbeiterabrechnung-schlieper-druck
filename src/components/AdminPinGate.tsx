import { useState, type FormEvent } from 'react';
import { useApp } from '../context/AppContext';
import { verifyPin } from '../lib/auth';

interface Props {
  children: React.ReactNode;
}

export default function AdminPinGate({ children }: Props) {
  const { isAdminAuthenticated, parameter, loginAdmin } = useApp();
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  if (isAdminAuthenticated) {
    return <>{children}</>;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!parameter?.adminPinHash) {
      // Noch kein PIN gesetzt — erster Login, PIN wird gesetzt
      setError('Kein Admin-PIN konfiguriert. Bitte in den Parametern setzen.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const ok = await verifyPin(pin, parameter.adminPinHash);
      if (ok) {
        loginAdmin(parameter.adminName || 'Admin');
      } else {
        setError('Falscher PIN. Bitte erneut versuchen.');
        setPin('');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100">
      <div className="bg-white rounded-xl shadow-lg p-8 w-full max-w-sm">
        <div className="text-center mb-6">
          <div className="text-4xl mb-3">🔒</div>
          <h1 className="text-xl font-bold text-gray-800">Admin-Bereich</h1>
          <p className="text-gray-500 text-sm mt-1">Bitte Admin-PIN eingeben</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="password"
            inputMode="numeric"
            maxLength={8}
            placeholder="PIN eingeben"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
            className="w-full text-center text-2xl tracking-widest border border-gray-300 rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500"
            autoFocus
          />

          {error && (
            <p className="text-red-600 text-sm text-center">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading || pin.length < 4}
            className="w-full bg-blue-600 text-white rounded-lg px-4 py-3 font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? 'Prüfe...' : 'Anmelden'}
          </button>
        </form>
      </div>
    </div>
  );
}
