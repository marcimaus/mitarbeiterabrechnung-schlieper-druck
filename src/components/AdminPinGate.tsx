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
  // Mitarbeiter-Login nur zeigen wenn 'mitarbeiter' in der Liste oder alle Rollen erlaubt
  const showMaLogin =
    allowedRoles.includes('mitarbeiter') ||
    (allowedRoles.includes('admin') && allowedRoles.includes('abrechnung'));

  return (
    <PinLoginForm
      ersterStart={ersterStart}
      allowedRoles={allowedRoles}
      showMaLogin={showMaLogin}
      parameter={parameter}
      mitarbeiter={mitarbeiter}
      loginAdmin={loginAdmin}
      loginAbrechnung={loginAbrechnung}
      loginMitarbeiter={loginMitarbeiter}
    />
  );
}

type LoginModus = 'personal' | 'mitarbeiter';

function PinLoginForm({
  ersterStart,
  allowedRoles,
  showMaLogin,
  parameter,
  mitarbeiter,
  loginAdmin,
  loginAbrechnung,
  loginMitarbeiter,
}: {
  ersterStart: boolean;
  allowedRoles: UserRole[];
  showMaLogin: boolean;
  parameter: ReturnType<typeof useApp>['parameter'];
  mitarbeiter: ReturnType<typeof useApp>['mitarbeiter'];
  loginAdmin: (name: string) => void;
  loginAbrechnung: (name: string) => void;
  loginMitarbeiter: (id: string, name: string) => void;
}) {
  const [modus, setModus] = useState<LoginModus>('personal');
  const [pin, setPin] = useState('');
  const [pinWiederholung, setPinWiederholung] = useState('');
  const [selectedMaId, setSelectedMaId] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const nurAbrechnung = allowedRoles.length === 1 && allowedRoles[0] === 'abrechnung';
  const beideErlaubt = allowedRoles.includes('admin') && allowedRoles.includes('abrechnung');

  // Mitarbeiter mit gesetztem PIN
  const maWithPin = mitarbeiter.filter((m) => m.isActive && m.pinHash);

  function wechsleModus(m: LoginModus) {
    setModus(m);
    setPin('');
    setPinWiederholung('');
    setSelectedMaId('');
    setError('');
  }

  async function handlePersonalSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      if (ersterStart) {
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
            beilagenPreise: [],
          }),
          adminPinHash: hash,
          adminName: 'Admin',
        });
        loginAdmin('Admin');
        return;
      }

      // Admin-PIN prüfen
      if (!nurAbrechnung && parameter?.adminPinHash) {
        const okAdmin = await verifyPin(pin, parameter.adminPinHash);
        if (okAdmin) { loginAdmin(parameter.adminName || 'Admin'); return; }
      }

      // Abrechnungs-PIN prüfen
      if ((beideErlaubt || nurAbrechnung) && parameter?.abrechnungPinHash) {
        const okAbr = await verifyPin(pin, parameter.abrechnungPinHash);
        if (okAbr) { loginAbrechnung('Abrechnung'); return; }
      }

      setError('Falscher PIN. Bitte erneut versuchen.');
      setPin('');
    } finally {
      setLoading(false);
    }
  }

  async function handleMitarbeiterSubmit(e: FormEvent) {
    e.preventDefault();
    if (!selectedMaId) { setError('Bitte Mitarbeiter auswählen.'); return; }
    const ma = mitarbeiter.find((m) => m.id === selectedMaId);
    if (!ma?.pinHash) { setError('Dieser Mitarbeiter hat keinen PIN gesetzt.'); return; }
    setLoading(true);
    setError('');
    try {
      const ok = await verifyPin(pin, ma.pinHash);
      if (ok) {
        loginMitarbeiter(ma.id, ma.name);
      } else {
        setError('Falscher PIN.');
        setPin('');
      }
    } finally {
      setLoading(false);
    }
  }

  const titelPersonal = ersterStart
    ? 'Admin-PIN erstellen'
    : nurAbrechnung
    ? 'Abrechnung-Login'
    : 'Anmeldung';

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100">
      <div className="bg-white rounded-xl shadow-lg p-8 w-full max-w-sm">
        <div className="text-center mb-6">
          <div className="text-4xl mb-3">{ersterStart ? '🔑' : modus === 'mitarbeiter' ? '👤' : '🔒'}</div>
          <h1 className="text-xl font-bold text-gray-800">
            {modus === 'mitarbeiter' ? 'Mitarbeiter-Login' : titelPersonal}
          </h1>
          <p className="text-gray-500 text-sm mt-1">
            {modus === 'mitarbeiter'
              ? 'Mitarbeiter auswählen und PIN eingeben'
              : ersterStart
              ? 'Erster Start — Admin-PIN festlegen'
              : nurAbrechnung
              ? 'Bitte Abrechnungs-PIN eingeben'
              : 'Admin- oder Abrechnungs-PIN eingeben'}
          </p>
        </div>

        {/* Modus-Tabs (nur wenn Mitarbeiter-Login möglich) */}
        {showMaLogin && !ersterStart && (
          <div className="flex rounded-lg border border-gray-200 overflow-hidden mb-5 text-sm">
            <button
              type="button"
              onClick={() => wechsleModus('personal')}
              className={`flex-1 py-2 transition-colors ${
                modus === 'personal'
                  ? 'bg-blue-600 text-white'
                  : 'bg-white text-gray-600 hover:bg-gray-50'
              }`}
            >
              🔒 Admin / Abrechnung
            </button>
            <button
              type="button"
              onClick={() => wechsleModus('mitarbeiter')}
              className={`flex-1 py-2 border-l border-gray-200 transition-colors ${
                modus === 'mitarbeiter'
                  ? 'bg-blue-600 text-white'
                  : 'bg-white text-gray-600 hover:bg-gray-50'
              }`}
            >
              👤 Mitarbeiter
            </button>
          </div>
        )}

        {/* Personal-Login (Admin / Abrechnung) */}
        {modus === 'personal' && (
          <form onSubmit={handlePersonalSubmit} className="space-y-4">
            <input
              type="password"
              inputMode="numeric"
              maxLength={8}
              placeholder={ersterStart ? 'Neuer PIN' : 'PIN eingeben'}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
              className="w-full text-center text-2xl tracking-widest border border-gray-300 rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500"
              autoFocus
            />
            {ersterStart && (
              <input
                type="password"
                inputMode="numeric"
                maxLength={8}
                placeholder="PIN wiederholen"
                value={pinWiederholung}
                onChange={(e) => setPinWiederholung(e.target.value.replace(/\D/g, ''))}
                className="w-full text-center text-2xl tracking-widest border border-gray-300 rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            )}
            {error && <p className="text-red-600 text-sm text-center">{error}</p>}
            <button
              type="submit"
              disabled={loading || pin.length < 4 || (ersterStart && pinWiederholung.length < 4)}
              className="w-full bg-blue-600 text-white rounded-lg px-4 py-3 font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loading
                ? ersterStart ? 'Speichere...' : 'Prüfe...'
                : ersterStart ? 'PIN festlegen & anmelden' : 'Anmelden'}
            </button>
          </form>
        )}

        {/* Mitarbeiter-Login */}
        {modus === 'mitarbeiter' && (
          <form onSubmit={handleMitarbeiterSubmit} className="space-y-4">
            {maWithPin.length === 0 ? (
              <div className="text-center text-sm text-gray-500 bg-gray-50 rounded-lg p-4">
                Kein Mitarbeiter hat bisher einen PIN gesetzt.<br />
                <span className="text-gray-400 text-xs mt-1 block">PINs werden vom Admin im Mitarbeiter-Formular vergeben.</span>
              </div>
            ) : (
              <>
                <div>
                  <label className="block text-sm text-gray-600 mb-1.5">Mitarbeiter auswählen</label>
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
                </div>
                {selectedMaId && (
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
                )}
                {error && <p className="text-red-600 text-sm text-center">{error}</p>}
                <button
                  type="submit"
                  disabled={loading || !selectedMaId || pin.length < 4}
                  className="w-full bg-blue-600 text-white rounded-lg px-4 py-3 font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {loading ? 'Prüfe...' : 'Anmelden'}
                </button>
              </>
            )}
          </form>
        )}
      </div>
    </div>
  );
}
