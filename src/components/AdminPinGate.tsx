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
  const { userRole, parameter, loginAdmin, loginAbrechnung } = useApp();

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
      loginAdmin={loginAdmin}
      loginAbrechnung={loginAbrechnung}
    />
  );
}

function PinLoginForm({
  ersterStart,
  allowedRoles,
  parameter,
  loginAdmin,
  loginAbrechnung,
}: {
  ersterStart: boolean;
  allowedRoles: UserRole[];
  parameter: ReturnType<typeof useApp>['parameter'];
  loginAdmin: (name: string) => void;
  loginAbrechnung: (name: string) => void;
}) {
  const [pin, setPin] = useState('');
  const [pinWiederholung, setPinWiederholung] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const nurAbrechnung = allowedRoles.length === 1 && allowedRoles[0] === 'abrechnung';
  const beideErlaubt = allowedRoles.includes('admin') && allowedRoles.includes('abrechnung');

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      if (ersterStart) {
        // Ersten Admin-PIN setzen
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
            beilagenPreise: [],
          }),
          adminPinHash: hash,
          adminName: 'Admin',
        });
        loginAdmin('Admin');
        return;
      }

      // Admin-PIN prüfen (außer wenn nur Abrechnung erlaubt)
      if (!nurAbrechnung && parameter?.adminPinHash) {
        const okAdmin = await verifyPin(pin, parameter.adminPinHash);
        if (okAdmin) {
          loginAdmin(parameter.adminName || 'Admin');
          return;
        }
      }

      // Abrechnungs-PIN prüfen (wenn erlaubt und vorhanden)
      if ((beideErlaubt || nurAbrechnung) && parameter?.abrechnungPinHash) {
        const okAbr = await verifyPin(pin, parameter.abrechnungPinHash);
        if (okAbr) {
          loginAbrechnung('Abrechnung');
          return;
        }
      }

      setError('Falscher PIN. Bitte erneut versuchen.');
      setPin('');
    } finally {
      setLoading(false);
    }
  }

  const titel = ersterStart
    ? 'Admin-PIN erstellen'
    : nurAbrechnung
    ? 'Abrechnung-Login'
    : 'Anmeldung erforderlich';

  const untertitel = ersterStart
    ? 'Erster Start — bitte einen PIN festlegen'
    : nurAbrechnung
    ? 'Bitte Abrechnungs-PIN eingeben'
    : 'Admin- oder Abrechnungs-PIN eingeben';

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100">
      <div className="bg-white rounded-xl shadow-lg p-8 w-full max-w-sm">
        <div className="text-center mb-6">
          <div className="text-4xl mb-3">{ersterStart ? '🔑' : '🔒'}</div>
          <h1 className="text-xl font-bold text-gray-800">{titel}</h1>
          <p className="text-gray-500 text-sm mt-1">{untertitel}</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
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
      </div>
    </div>
  );
}
