import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AppProvider } from './context/AppContext';
import Navigation from './components/Navigation';
import OfflineBanner from './components/OfflineBanner';
import HomeScreen from './screens/HomeScreen';
import ZeiterfassungScreen from './screens/ZeiterfassungScreen';
import ZeitübersichtScreen from './screens/ZeitübersichtScreen';
import MitarbeiterScreen from './screens/MitarbeiterScreen';
import TeilgebieteScreen from './screens/TeilgebieteScreen';
import TourenScreen from './screens/TourenScreen';
import AusgabenScreen from './screens/AusgabenScreen';
import EinsaetzeScreen from './screens/EinsaetzeScreen';
import ZusammentragenScreen from './screens/ZusammentragenScreen';
import FahrtenScreen from './screens/FahrtenScreen';
import AbrechnungScreen from './screens/AbrechnungScreen';
import ParameterScreen from './screens/ParameterScreen';
import ReklamationenScreen from './screens/ReklamationenScreen';
import NfcLandingScreen from './screens/NfcLandingScreen';
import AustraegerMeldungScreen from './screens/AustraegerMeldungScreen';
import VerteilplanScreen from './screens/VerteilplanScreen';
import { useApp } from './context/AppContext';

export default function App() {
  return (
    <AppProvider>
      <BrowserRouter>
        <AppLayout />
      </BrowserRouter>
    </AppProvider>
  );
}

// ---- Haupt-Layout (braucht useApp → innerhalb AppProvider) ----

function AppLayout() {
  const { isAdminAuthenticated, userRole } = useApp();
  const istMitarbeiter = userRole === 'mitarbeiter';

  // Mobile: Rollenbalken (h-7 = 28px) + Hamburger-Header (h-14 = 56px) = 84px
  // Ohne Login: nur Hamburger-Header (h-14 = 56px)
  const mobilePt = isAdminAuthenticated ? 'pt-[84px]' : 'pt-14';

  // Mitarbeiter-Login: Startseite ist nicht sichtbar — Default ist die
  // Stempeluhr. Nicht angemeldete sehen ebenfalls keine Startseite — sie
  // landen direkt in der (lesenden) Stempeluhr und können sich von dort
  // anmelden. Nur Admin/Abrechnung sehen die normale Startseite.
  const istAngemeldet = userRole !== null;
  const startElement = istAngemeldet && !istMitarbeiter
    ? <HomeScreen />
    : <Navigate to="/zeiterfassung" replace />;

  return (
    <div className="flex flex-col min-h-screen">
      <OfflineBanner />
      <div className="flex flex-1 min-h-0">
        <Navigation />
        <main className={`flex-1 overflow-y-auto bg-gray-50 ${mobilePt} md:pt-0`}>
          <Routes>
            <Route path="/" element={startElement} />
            <Route path="/zeiterfassung" element={<ZeiterfassungScreen />} />
            <Route path="/zeitübersicht" element={<ZeitübersichtScreen />} />
            <Route path="/mitarbeiter" element={<MitarbeiterScreen />} />
            <Route path="/teilgebiete" element={<TeilgebieteScreen />} />
            <Route path="/touren" element={<TourenScreen />} />
            <Route path="/ausgaben" element={<AusgabenScreen />} />
            <Route path="/einsaetze" element={<EinsaetzeScreen />} />
            <Route path="/zusammentragen" element={<ZusammentragenScreen />} />
            <Route path="/fahrten" element={<FahrtenScreen />} />
            <Route path="/abrechnung" element={<AbrechnungScreen />} />
            <Route path="/parameter" element={<ParameterScreen />} />
            <Route path="/reklamationen" element={<ReklamationenScreen />} />
            <Route path="/nfc" element={<NfcLandingScreen />} />
            <Route path="/meldung" element={<AustraegerMeldungScreen />} />
            <Route path="/verteilplan" element={<VerteilplanScreen />} />
            <Route path="/admin" element={<AdminLoginPage />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}

// ---- Admin-Login Seite ----------------------------------------
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import AdminPinGate from './components/AdminPinGate';

function AdminLoginPage() {
  const { isAdminAuthenticated } = useApp();
  const navigate = useNavigate();

  useEffect(() => {
    if (isAdminAuthenticated) navigate('/');
  }, [isAdminAuthenticated, navigate]);

  return (
    <AdminPinGate allowedRoles={['admin', 'abrechnung', 'mitarbeiter']}>
      <div />
    </AdminPinGate>
  );
}
