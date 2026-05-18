import { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext';

interface NavItem {
  to: string;
  label: string;
  icon: string;
  roles?: Array<'admin' | 'abrechnung' | 'mitarbeiter'>;
}

const NAV_ITEMS: NavItem[] = [
  // Startseite nur für Admin/Abrechnung — Mitarbeiter landen direkt auf der
  // Stempeluhr (Redirect in App.tsx).
  { to: '/', label: 'Start', icon: '🏠', roles: ['admin', 'abrechnung'] },
  { to: '/zeiterfassung', label: 'Stempeluhr', icon: '⏱' },
  { to: '/fahrten', label: 'Fahrtkosten', icon: '🚗', roles: ['admin', 'abrechnung', 'mitarbeiter'] },
  // Zeitübersicht: für Mitarbeiter ebenfalls sichtbar — eingeschränkt auf
  // die eigenen Daten (Filterung im Screen).
  { to: '/zeitübersicht', label: 'Zeitübersicht', icon: '📊', roles: ['admin', 'abrechnung', 'mitarbeiter'] },
  { to: '/mitarbeiter', label: 'Mitarbeiter & Interessenten', icon: '👥', roles: ['admin', 'abrechnung'] },
  { to: '/teilgebiete', label: 'Teilgebiete', icon: '📍', roles: ['admin', 'abrechnung'] },
  { to: '/touren', label: 'Touren', icon: '🗺', roles: ['admin', 'abrechnung'] },
  { to: '/ausgaben', label: 'Ausgaben & Beilagen', icon: '📄', roles: ['admin', 'abrechnung'] },
  { to: '/planung', label: 'Personalplanung', icon: '🗒', roles: ['admin', 'abrechnung'] },
  { to: '/urlaub', label: 'Urlaub', icon: '🏖', roles: ['admin', 'abrechnung'] },
  { to: '/einsaetze', label: 'Einsätze', icon: '🗓', roles: ['admin', 'abrechnung'] },
  { to: '/verteilplan', label: 'Verteilplan', icon: '📋', roles: ['admin', 'abrechnung'] },
  { to: '/zusammentragen', label: 'Zusammentragen', icon: '📦', roles: ['admin', 'abrechnung'] },
  { to: '/reklamationen', label: 'Reklamationen', icon: '📞', roles: ['admin', 'abrechnung'] },
  // Abrechnung & Parameter: nur Admin. Lieferscheine: ausgeblendet, Druck
  // erfolgt aus dem Einsätze-Screen heraus.
  { to: '/abrechnungsvorschau', label: 'Abrechnungsvorschau', icon: '🧮', roles: ['admin', 'abrechnung'] },
  { to: '/abrechnung', label: 'Abrechnung', icon: '💰', roles: ['admin'] },
  { to: '/parameter', label: 'Parameter', icon: '⚙️', roles: ['admin'] },
];

// ---- Rollenbalken-Konfiguration --------------------------------

function rollenConfig(userRole: string | null, adminName: string) {
  if (userRole === 'admin') return { label: 'Admin', bg: 'bg-red-600' };
  if (userRole === 'abrechnung') return { label: 'Abrechnung', bg: 'bg-blue-600' };
  if (userRole === 'mitarbeiter') return { label: adminName || 'Mitarbeiter', bg: 'bg-green-700' };
  return null;
}

export default function Navigation() {
  const { userRole, isAdminAuthenticated, logoutAdmin, adminName, mitarbeiter, mitarbeiterId } = useApp();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);

  // Eingeloggter Mitarbeiter — wird für das Fahrtkosten-Item gebraucht
  // (nur sichtbar wenn fahrtkostenerstattung am MA gesetzt ist).
  const loggedInMa = mitarbeiterId
    ? mitarbeiter.find((m) => m.id === mitarbeiterId)
    : undefined;

  const visibleItems = NAV_ITEMS.filter((item) => {
    if (!item.roles) return true;
    if (!userRole) return false;
    if (!item.roles.includes(userRole)) return false;
    // Spezialfall: Fahrtkosten-Item für Mitarbeiter nur, wenn das
    // Kennzeichen am MA gesetzt ist. Admin/Abrechnung sehen es immer.
    if (item.to === '/fahrten' && userRole === 'mitarbeiter') {
      return loggedInMa?.fahrtkostenerstattung === true;
    }
    return true;
  });

  const rolle = rollenConfig(userRole, adminName);

  const navLinks = (
    <div className="flex-1 overflow-y-auto py-2">
      {visibleItems.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.to === '/'}
          onClick={() => setMobileOpen(false)}
          className={({ isActive }) =>
            `flex items-center gap-3 px-4 py-3 md:py-2.5 text-sm transition-colors ${
              isActive
                ? 'bg-blue-50 text-blue-700 font-medium border-r-2 border-blue-600'
                : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900 active:bg-gray-100'
            }`
          }
        >
          <span className="text-base">{item.icon}</span>
          {item.label}
        </NavLink>
      ))}
    </div>
  );

  const logoutSection = (
    <div className="p-3 border-t border-gray-200 shrink-0">
      {isAdminAuthenticated ? (
        <button
          onClick={() => { logoutAdmin(); navigate('/'); setMobileOpen(false); }}
          className="w-full text-xs text-red-600 hover:text-red-700 text-left px-2 py-1.5 rounded hover:bg-red-50 transition-colors"
        >
          🔓 Abmelden
        </button>
      ) : (
        <NavLink
          to="/admin"
          onClick={() => setMobileOpen(false)}
          className="flex items-center gap-2 text-xs text-gray-500 hover:text-blue-600 px-2 py-1.5 rounded hover:bg-blue-50 transition-colors"
        >
          🔒 Anmelden
        </NavLink>
      )}
    </div>
  );

  return (
    <>
      {/* ======== DESKTOP SIDEBAR ======== */}
      <nav className="hidden md:flex bg-white border-r border-gray-200 w-52 shrink-0 flex-col h-full">
        {/* App-Titel */}
        <div className="p-4 border-b border-gray-200 shrink-0">
          <h1 className="font-bold text-blue-700 text-sm leading-tight">Schlieper-Druck</h1>
          <p className="text-xs text-gray-500">Mitarbeiterabrechnung</p>
        </div>

        {/* Rollenbalken Desktop */}
        {rolle && (
          <div className={`${rolle.bg} px-4 py-1.5 shrink-0 flex items-center gap-2`}>
            <span className="text-xs font-semibold text-white tracking-wide">{rolle.label}</span>
          </div>
        )}

        {navLinks}
        {logoutSection}
      </nav>

      {/* ======== MOBILE: Rollenbalken (fixiert, ganz oben, z-50) ======== */}
      {rolle && (
        <div
          className={`md:hidden fixed top-0 left-0 right-0 z-50 h-7 flex items-center px-4 ${rolle.bg}`}
        >
          <span className="text-xs font-semibold text-white tracking-wide">{rolle.label}</span>
        </div>
      )}

      {/* ======== MOBILE: Header-Bar (unter Rollenbalken, z-40) ======== */}
      <div
        className={`md:hidden fixed left-0 right-0 z-40 bg-white border-b border-gray-200 flex items-center justify-between px-4 py-3 ${
          rolle ? 'top-7' : 'top-0'
        }`}
      >
        <div>
          <span className="font-bold text-blue-700 text-sm">Schlieper-Druck</span>
          <span className="text-xs text-gray-400 ml-2">Abrechnung</span>
        </div>
        <button
          onClick={() => setMobileOpen((o) => !o)}
          className="p-2 rounded-lg text-gray-600 hover:bg-gray-100 active:bg-gray-200 transition-colors"
          aria-label="Menü öffnen"
        >
          {mobileOpen ? '✕' : '☰'}
        </button>
      </div>

      {/* ======== MOBILE: Drawer ======== */}
      {mobileOpen && (
        <div
          className="md:hidden fixed inset-0 z-50 flex"
          onClick={() => setMobileOpen(false)}
        >
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/40" />
          {/* Drawer */}
          <nav
            className="relative bg-white w-64 h-full flex flex-col shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Drawer-Titel */}
            <div className="p-4 border-b border-gray-200 flex items-center justify-between shrink-0">
              <div>
                <h1 className="font-bold text-blue-700 text-sm leading-tight">Schlieper-Druck</h1>
                <p className="text-xs text-gray-500">Mitarbeiterabrechnung</p>
              </div>
              <button
                onClick={() => setMobileOpen(false)}
                className="text-gray-400 hover:text-gray-600 text-xl p-1"
              >
                ✕
              </button>
            </div>

            {/* Rollenbalken im Drawer */}
            {rolle && (
              <div className={`${rolle.bg} px-4 py-1.5 shrink-0 flex items-center gap-2`}>
                <span className="text-xs font-semibold text-white tracking-wide">{rolle.label}</span>
              </div>
            )}

            {navLinks}
            {logoutSection}
          </nav>
        </div>
      )}
    </>
  );
}
