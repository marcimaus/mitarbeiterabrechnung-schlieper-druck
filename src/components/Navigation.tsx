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
  { to: '/', label: 'Start', icon: '🏠' },
  { to: '/zeiterfassung', label: 'Stempeluhr', icon: '⏱' },
  { to: '/fahrten', label: 'Fahrtkosten', icon: '🚗', roles: ['admin', 'abrechnung', 'mitarbeiter'] },
  { to: '/zeitübersicht', label: 'Zeitübersicht', icon: '📊', roles: ['admin'] },
  { to: '/mitarbeiter', label: 'Mitarbeiter', icon: '👥', roles: ['admin'] },
  { to: '/teilgebiete', label: 'Teilgebiete', icon: '📍', roles: ['admin'] },
  { to: '/touren', label: 'Touren', icon: '🗺', roles: ['admin'] },
  { to: '/ausgaben', label: 'Ausgaben', icon: '📄', roles: ['admin', 'abrechnung'] },
  { to: '/einsaetze', label: 'Einsätze', icon: '🗓', roles: ['admin', 'abrechnung'] },
  { to: '/zusammentragen', label: 'Zusammentragen', icon: '📦', roles: ['admin', 'abrechnung'] },
  { to: '/reklamationen', label: 'Reklamationen', icon: '📞', roles: ['admin', 'abrechnung'] },
  { to: '/abrechnung', label: 'Abrechnung', icon: '💰', roles: ['admin', 'abrechnung'] },
  { to: '/parameter', label: 'Parameter', icon: '⚙️', roles: ['admin'] },
];

export default function Navigation() {
  const { userRole, isAdminAuthenticated, logoutAdmin, adminName } = useApp();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);

  const visibleItems = NAV_ITEMS.filter((item) => {
    if (!item.roles) return true;
    if (!userRole) return false;
    return item.roles.includes(userRole);
  });

  const rollenLabel =
    userRole === 'admin' ? 'Admin' :
    userRole === 'abrechnung' ? 'Abrechnung' :
    userRole === 'mitarbeiter' ? 'Mitarbeiter' : '';

  const navContent = (
    <>
      {/* Nav-Links */}
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

      {/* Login/Logout */}
      <div className="p-3 border-t border-gray-200 shrink-0">
        {isAdminAuthenticated ? (
          <div className="space-y-2">
            <p className="text-xs text-gray-500 truncate">
              {rollenLabel}: {adminName}
            </p>
            <button
              onClick={() => { logoutAdmin(); navigate('/'); setMobileOpen(false); }}
              className="w-full text-xs text-red-600 hover:text-red-700 text-left px-2 py-1.5 rounded hover:bg-red-50 transition-colors"
            >
              🔓 Abmelden
            </button>
          </div>
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
    </>
  );

  return (
    <>
      {/* ---- Desktop Sidebar ---- */}
      <nav className="hidden md:flex bg-white border-r border-gray-200 w-52 shrink-0 flex-col h-full">
        <div className="p-4 border-b border-gray-200 shrink-0">
          <h1 className="font-bold text-blue-700 text-sm leading-tight">Schlieper-Druck</h1>
          <p className="text-xs text-gray-500">Mitarbeiterabrechnung</p>
        </div>
        {navContent}
      </nav>

      {/* ---- Mobile: Header-Bar ---- */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-40 bg-white border-b border-gray-200 flex items-center justify-between px-4 py-3">
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

      {/* ---- Mobile: Drawer ---- */}
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
            <div className="p-4 border-b border-gray-200 flex items-center justify-between">
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
            {navContent}
          </nav>
        </div>
      )}

      {/* ---- Mobile: Spacer for fixed header ---- */}
      <div className="md:hidden h-14 shrink-0" />
    </>
  );
}
