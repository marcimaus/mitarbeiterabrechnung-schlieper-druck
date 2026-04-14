import { BrowserRouter, Routes, Route } from 'react-router-dom';
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

export default function App() {
  return (
    <AppProvider>
      <BrowserRouter>
        <div className="flex flex-col min-h-screen">
          <OfflineBanner />
          <div className="flex flex-1 min-h-0">
            <Navigation />
            {/* main: auf Mobile brauchen wir padding-top für den fixen Header */}
            <main className="flex-1 overflow-y-auto bg-gray-50 pt-0 md:pt-0">
              <Routes>
                <Route path="/" element={<HomeScreen />} />
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
                <Route path="/admin" element={<AdminLoginPage />} />
              </Routes>
            </main>
          </div>
        </div>
      </BrowserRouter>
    </AppProvider>
  );
}

// Admin-Login Seite
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import AdminPinGate from './components/AdminPinGate';
import { useApp } from './context/AppContext';

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
