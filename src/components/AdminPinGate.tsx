import { useState, type FormEvent } from 'react';
import { useApp } from '../context/AppContext';
import { verifyPin, hashPin } from '../lib/auth';
import { speichereParameter } from '../lib/db';
import type { UserRole } from '../context/AppContext';

interface Props {
  children: React.ReactNode;
  /** Welche Rollen Zugang haben. Default: nur 'admin' */
  allowedRoles?: UserRole[];
}

export default function AdminPinGate({
  children,
  allowedRoles = ['admin'],
}: Props) {
  const { userRole, parameter, mitarbeiter, loginAdmin, loginAbrechnung, loginMitarbeiter } = useApp();

  // Zugang gewährt wenn aktuelle Rolle in der erlaubten Liste ist
  if (userRole && allowedRoles.includes(userRole)) {
    return <>{children}</>;
  }

  const ersterStart = !parameter?.adminPinHash;

  return (
    <PinLoginForm
      ersterStart={ersterStart}
      allowedRoles={allowedRoles}
      parameter={parameter}
      mitarbeiter={mitarbeiter}
      loginAdmin={loginAdmin}
      loginAbrechnung={loginAbrechnung}
      loginMitarbeiter={loginMitarbeiter}
    />
  );
}

type LoginModus = 'admin' | 'abrechnung' | 'mitarbeiter';

function PinLoginForm({
  ersterStart,
  allowedRoles,
  parameter,
  mitarbeiter,
  loginAdmin,
  loginAbrechnung,
  loginMitarbeiter,
}: {
  ersterStart: boolean;
  allowedRoles: UserRole[];
  parameter: ReturnType<typeof useApp>['parameter'];
  mitarbeiter: ReturnType<typeof useApp>['mitarbeiter'];
  loginAdmin: (name: string) => void;
  loginAbrechnung: (name: string) => void;
  loginMitarbeiter: (id: string, name: string) => void;
}) {
  const showAdmin = allowedRoles.includes('admin');
  const showAbrechnung = allowedRoles.includes('abrechnung');
  const showMitarbeiter = allowedRoles.includes('mitarbeiter');

  // Startet mit dem ersten erlaubten Modus
  const defaultModus: LoginModus = showAdmin ? 'admin' : showAbrechnung ? 'abrechnung' : 'mitarbeiter';
  const [modus, setModus] = useState<LoginModus>(defaultModus);

  const [pin, setPin] = useState('');
  const [pinWiederholung, setPinWiederholung] = useState('');
  const [selectedMaId, setSelectedMaId] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Mitarbeiter mit gesetztem PIN
  const maWithPin = mitarbeiter.filter((m) => m.isActive && m.pinHash);

  function wechsleModus(m: LoginModus) {
    setModus(m);
    setPin('');
    setPinWiederholung('');
    setSelectedMaId('');
    setError('');
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      if (ersterStart) {
        // Erster Start: Admin-PIN festlegen
        if (pin.length < 4) { setError('PIN muss mindestens 4 Ziffern haben.'); return; }
        if (pin !== pinWiederholung) { setError('PINs stimmen nicht überein.'); setPinWiederholung(''); return; }
        const hash = await hashPin(pin);
        await speichereParameter({
          ...(parameter ?? {
            laufgeschwindigkeitMProH: 5000,
            steckzeitStkProH: 720,
            stundenlohnErwachseneAustr: 13.90,
            stundenlohnMinderjAustr: 10.00,
            mindeststundenlohn: 13.90,
            springerZuschlagProzent: 25,
            gewichtszulageAnzeigenblattEurKg: 0.05,
            gewichtszulageBeilagenEurKg: 0.30,
            standardGrammurGqm: 65,
            standardSeitenformatBreiteMm: 305,
            standardSeitenformatHoeheMm: 215,
            fahrkostenEurProKm: 0.30,
            minijobGrenzeEurProMonat: 556,
            beilagenPreise: [],
          }),
          adminPinHash: hash,
          adminName: 'Admin',
        });
        loginAdmin('Admin');
        return;
      }

      if (modus === 'admin') {
        if (!parameter?.adminPinHash) { setError('Kein Admin-PIN gesetzt.'); return; }
        const ok = await verifyPin(pin, parameter.adminPinHash);
        if (ok) { loginAdmin(parameter.adminName || 'Admin'); return; }
        setError('Falscher PIN.');
        setPin('');
        return;
      }

      if (modus === 'abrechnung') {
        if (!parameter?.abrechnungPinHash) { setError('Kein Abrechnungs-PIN gesetzt. Bitte Admin fragen.'); return; }
        const ok = await verifyPin(pin, parameter.abrechnungPinHash);
        if (ok) { loginAbrechnung('Abrechnung'); return; }
        setError('Falscher PIN.');
        setPin('');
        return;
      }

      if (modus === 'mitarbeiter') {
        if (!selectedMaId) { setError('Bitte Mitarbeiter auswählen.'); return; }
        const ma = mitarbeiter.find((m) => m.id === selectedMaId);
        if (!ma?.pinHash) { setError('Dieser Mitarbeiter hat keinen PIN gesetzt.'); return; }
        const ok = await verifyPin(pin, ma.pinHash);
        if (ok) {
          loginMitarbeiter(ma.id, ma.name);
        } else {
          setError('Falscher PIN.');
          setPin('');
        }
      }
    } finally {
      setLoading(false);
    }
  }

  // --- Erster Start ---
  if (ersterStart) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100">
        <div className="bg-white rounded-xl shadow-lg p-8 w-full max-w-sm">
          <div className="text-center mb-6">
            <div className="text-4xl mb-3">🔑</div>
            <h1 className="text-xl font-bold text-gray-800">Admin-PIN erstellen</h1>
            <p className="text-gray-500 text-sm mt-1">Erster Start — Admin-PIN festlegen</p>
          </div>
          <form onSubmit={handleSubmit} className="space-y-4">
            <input
              type="password"
              inputMode="numeric"
              maxLength={8}
              placeholder="Neuer PIN"
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
              className="w-full text-center text-2xl tracking-widest border border-gray-300 rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500"
              autoFocus
            />
            <input
              type="password"
              inputMode="numeric"
              maxLength={8}
              placeholder="PIN wiederholen"
              value={pinWiederholung}
              onChange={(e) => setPinWiederholung(e.target.value.replace(/\D/g, ''))}
              className="w-full text-center text-2xl tracking-widest border border-gray-300 rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {error && <p className="text-red-600 text-sm text-center">{error}</p>}
            <button
              type="submit"
              disabled={loading || pin.length < 4 || pinWiederholung.length < 4}
              className="w-full bg-blue-600 text-white rounded-lg px-4 py-3 font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? 'Speichere...' : 'PIN festlegen & anmelden'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  // --- Anzahl sichtbarer Rollen-Buttons ---
  const rollenButtons = [
    showAdmin && { key: 'admin' as LoginModus, label: 'Admin', icon: '🔒' },
    showAbrechnung && { key: 'abrechnung' as LoginModus, label: 'Abrechnung', icon: '📊' },
    showMitarbeiter && { key: 'mitarbeiter' as LoginModus, label: 'Mitarbeiter', icon: '👤' },
  ].filter(Boolean) as { key: LoginModus; label: string; icon: string }[];

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100">
      <div className="bg-white rounded-xl shadow-lg p-8 w-full max-w-sm">
        <div className="text-center mb-6">
          <div className="text-4xl mb-3">
            {modus === 'admin' ? '🔒' : modus === 'abrechnung' ? '📊' : '👤'}
          </div>
          <h1 className="text-xl font-bold text-gray-800">Anmeldung</h1>
          <p className="text-gray-500 text-sm mt-1">Schlieper-Druck Mitarbeiterabrechnung</p>
        </div>

        {/* Rollen-Auswahl (nur wenn mehrere Rollen erlaubt) */}
        {rollenButtons.length > 1 && (
          <div className={`grid gap-2 mb-5 ${rollenButtons.length === 3 ? 'grid-cols-3' : 'grid-cols-2'}`}>
            {rollenButtons.map((btn) => (
              <button
                key={btn.key}
                type="button"
                onClick={() => wechsleModus(btn.key)}
                className={`flex flex-col items-center gap-1 py-2.5 px-2 rounded-lg border text-xs font-medium transition-colors ${
                  modus === btn.key
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white text-gray-600 border-gray-200 hover:border-blue-300 hover:text-blue-600'
                }`}
              >
                <span className="text-lg">{btn.icon}</span>
                {btn.label}
              </button>
            ))}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Mitarbeiter-Auswahl */}
          {modus === 'mitarbeiter' && (
            <div>
              <label className="block text-sm text-gray-600 mb-1.5">Mitarbeiter auswählen</label>
              {maWithPin.length === 0 ? (
                <div className="text-center text-sm text-gray-500 bg-gray-50 rounded-lg p-4">
                  Kein Mitarbeiter hat bisher einen PIN gesetzt.<br />
                  <span className="text-gray-400 text-xs mt-1 block">PINs werden vom Admin im Mitarbeiter-Formular vergeben.</span>
                </div>
              ) : (
                <select
                  value={selectedMaId}
                  onChange={(e) => { setSelectedMaId(e.target.value); setError(''); setPin(''); }}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  autoFocus
                >
                  <option value="">— Mitarbeiter wählen —</option>
                  {maWithPin.map((m) => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                </select>
              )}
            </div>
          )}

          {/* PIN-Eingabe (bei Mitarbeiter nur wenn MA gewählt) */}
          {(modus !== 'mitarbeiter' || selectedMaId) && (
            <div>
              <label className="block text-sm text-gray-600 mb-1.5">
                {modus === 'admin' ? 'Admin-PIN' : modus === 'abrechnung' ? 'Abrechnungs-PIN' : 'Mitarbeiter-PIN'}
              </label>
              <input
                type="password"
                inputMode="numeric"
                maxLength={8}
                placeholder="PIN eingeben"
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
                className="w-full text-center text-2xl tracking-widest border border-gray-300 rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500"
                autoFocus={modus !== 'mitarbeiter'}
              />
            </div>
          )}

          {error && <p className="text-red-600 text-sm text-center">{error}</p>}

          {(modus !== 'mitarbeiter' || selectedMaId) && (
            <button
              type="submit"
              disabled={loading || pin.length < 4}
              className="w-full bg-blue-600 text-white rounded-lg px-4 py-3 font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? 'Prüfe...' : 'Anmelden'}
            </button>
          )}
        </form>

        {/* Hinweis wenn kein Abrechnungs-PIN gesetzt */}
        {modus === 'abrechnung' && !parameter?.abrechnungPinHash && (
          <p className="text-xs text-amber-600 text-center mt-3 bg-amber-50 rounded-lg p-2">
            Noch kein Abrechnungs-PIN gesetzt. Bitte Admin unter Parameter → Rollen-PINs einen PIN einrichten.
          </p>
        )}
      </div>
    </div>
  );
}
