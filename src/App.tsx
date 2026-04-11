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
import AbrechnungScreen from './screens/AbrechnungScreen';
import ParameterScreen from './screens/ParameterScreen';

export default function App() {
  return (
    <AppProvider>
      <BrowserRouter>
        <div className="flex flex-col min-h-screen">
          <OfflineBanner />
          <div className="flex flex-1 min-h-0">
            <Navigation />
            <main className="flex-1 overflow-y-auto bg-gray-50">
              <Routes>
                <Route path="/" element={<HomeScreen />} />
                <Route path="/zeiterfassung" element={<ZeiterfassungScreen />} />
                <Route path="/zeitübersicht" element={<ZeitübersichtScreen />} />
                <Route path="/mitarbeiter" element={<MitarbeiterScreen />} />
                <Route path="/teilgebiete" element={<TeilgebieteScreen />} />
                <Route path="/touren" element={<TourenScreen />} />
                <Route path="/ausgaben" element={<AusgabenScreen />} />
                <Route path="/abrechnung" element={<AbrechnungScreen />} />
                <Route path="/parameter" element={<ParameterScreen />} />
                <Route path="/admin" element={<AdminLoginPage />} />
              </Routes>
            </main>
          </div>
        </div>
      </BrowserRouter>
    </AppProvider>
  );
}

// Admin-Login Seite (leitet nach erfolgreichem Login zur Startseite)
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
    <AdminPinGate>
      <div />
    </AdminPinGate>
  );
}
