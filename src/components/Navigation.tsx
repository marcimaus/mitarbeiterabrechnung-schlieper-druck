import { NavLink, useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext';

interface NavItem {
  to: string;
  label: string;
  icon: string;
  adminOnly?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Start', icon: '🏠' },
  { to: '/zeiterfassung', label: 'Zeiterfassung', icon: '⏱' },
  { to: '/mitarbeiter', label: 'Mitarbeiter', icon: '👥', adminOnly: true },
  { to: '/teilgebiete', label: 'Teilgebiete', icon: '📍', adminOnly: true },
  { to: '/touren', label: 'Touren', icon: '🗺', adminOnly: true },
  { to: '/ausgaben', label: 'Ausgaben', icon: '📄', adminOnly: true },
  { to: '/abrechnung', label: 'Abrechnung', icon: '💰', adminOnly: true },
  { to: '/parameter', label: 'Parameter', icon: '⚙️', adminOnly: true },
];

export default function Navigation() {
  const { isAdminAuthenticated, logoutAdmin, adminName } = useApp();
  const navigate = useNavigate();

  const visibleItems = NAV_ITEMS.filter(
    (item) => !item.adminOnly || isAdminAuthenticated
  );

  return (
    <nav className="bg-white border-r border-gray-200 w-56 shrink-0 flex flex-col h-full">
      {/* Logo */}
      <div className="p-4 border-b border-gray-200">
        <h1 className="font-bold text-blue-700 text-sm leading-tight">
          Schlieper-Druck
        </h1>
        <p className="text-xs text-gray-500">Mitarbeiterabrechnung</p>
      </div>

      {/* Nav-Links */}
      <div className="flex-1 overflow-y-auto py-2">
        {visibleItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) =>
              `flex items-center gap-3 px-4 py-2.5 text-sm transition-colors ${
                isActive
                  ? 'bg-blue-50 text-blue-700 font-medium border-r-2 border-blue-600'
                  : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
              }`
            }
          >
            <span className="text-base">{item.icon}</span>
            {item.label}
          </NavLink>
        ))}
      </div>

      {/* Admin-Bereich Login/Logout */}
      <div className="p-3 border-t border-gray-200">
        {isAdminAuthenticated ? (
          <div className="space-y-2">
            <p className="text-xs text-gray-500 truncate">Admin: {adminName}</p>
            <button
              onClick={() => { logoutAdmin(); navigate('/'); }}
              className="w-full text-xs text-red-600 hover:text-red-700 text-left px-2 py-1.5 rounded hover:bg-red-50 transition-colors"
            >
              🔓 Abmelden
            </button>
          </div>
        ) : (
          <NavLink
            to="/admin"
            className="flex items-center gap-2 text-xs text-gray-500 hover:text-blue-600 px-2 py-1.5 rounded hover:bg-blue-50 transition-colors"
          >
            🔒 Admin-Login
          </NavLink>
        )}
      </div>
    </nav>
  );
}
