import { useApp } from '../context/AppContext';

export default function HomeScreen() {
  const { mitarbeiter, teilgebiete, touren, abrechnungsperioden, isAdminAuthenticated } = useApp();

  const aktiveMitarbeiter = mitarbeiter.filter((m) => m.isActive);
  const aktiveTouren = touren.length;
  const offenePerioden = abrechnungsperioden.filter((p) => p.status === 'offen').length;

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto">
      <h1 className="text-xl md:text-2xl font-bold text-gray-900 mb-0.5">
        Mitarbeiterabrechnung
      </h1>
      <p className="text-gray-500 mb-6 text-sm">Schlieper-Druck GmbH</p>

      {/* Statistik-Kacheln */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <StatCard label="Aktive Mitarbeiter" value={aktiveMitarbeiter.length} icon="👥" color="blue" />
        <StatCard label="Teilgebiete" value={teilgebiete.filter(t => t.isActive).length} icon="📍" color="green" />
        <StatCard label="Touren" value={aktiveTouren} icon="🗺" color="yellow" />
        <StatCard label="Offene Perioden" value={offenePerioden} icon="💰" color="orange" />
      </div>

      {/* Schnellzugriff */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 md:p-6 mb-4">
        <h2 className="font-semibold text-gray-800 mb-3">Schnellzugriff</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <QuickLink href="/zeiterfassung" icon="⏱" title="Stempeluhr" desc="Zeiten stempeln & erfassen" />
          <QuickLink href="/fahrten" icon="🚗" title="Fahrtkosten" desc="Fahrt erfassen" />
          {isAdminAuthenticated && (
            <>
              <QuickLink href="/mitarbeiter" icon="👥" title="Mitarbeiter" desc="Stammdaten verwalten" />
              <QuickLink href="/ausgaben" icon="📄" title="Ausgaben" desc="Wochenausgaben planen" />
              <QuickLink href="/einsaetze" icon="🗓" title="Einsätze" desc="Austräger zuweisen" />
              <QuickLink href="/reklamationen" icon="📞" title="Reklamationen" desc="Leser-Reklamationen erfassen" />
              <QuickLink href="/abrechnung" icon="💰" title="Abrechnung" desc="Monatsabrechnung & Export" />
              <QuickLink href="/teilgebiete" icon="📍" title="Teilgebiete" desc="Gebiete & Straßenlisten" />
            </>
          )}
        </div>
      </div>

      {/* Letzte Abrechnungsperioden */}
      {abrechnungsperioden.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 md:p-6">
          <h2 className="font-semibold text-gray-800 mb-3">Abrechnungsperioden</h2>
          <div className="space-y-2">
            {[...abrechnungsperioden]
              .sort((a, b) => b.jahr !== a.jahr ? b.jahr - a.jahr : b.monat - a.monat)
              .slice(0, 5)
              .map((p) => (
                <div
                  key={p.id}
                  className="flex items-center justify-between py-2.5 px-3 rounded-lg bg-gray-50 active:bg-gray-100"
                >
                  <span className="text-sm font-medium text-gray-800">{p.bezeichnung}</span>
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full ${
                      p.status === 'abgeschlossen'
                        ? 'bg-green-100 text-green-700'
                        : 'bg-amber-100 text-amber-700'
                    }`}
                  >
                    {p.status === 'abgeschlossen' ? 'Abgeschlossen' : 'Offen'}
                  </span>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  icon,
  color,
}: {
  label: string;
  value: number;
  icon: string;
  color: 'blue' | 'green' | 'yellow' | 'orange';
}) {
  const colors = {
    blue: 'bg-blue-50 text-blue-700',
    green: 'bg-green-50 text-green-700',
    yellow: 'bg-yellow-50 text-yellow-700',
    orange: 'bg-orange-50 text-orange-700',
  };
  return (
    <div className={`rounded-xl p-3 md:p-4 ${colors[color]}`}>
      <div className="text-xl md:text-2xl mb-1">{icon}</div>
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-xs font-medium opacity-80 leading-tight">{label}</div>
    </div>
  );
}

function QuickLink({
  href,
  icon,
  title,
  desc,
}: {
  href: string;
  icon: string;
  title: string;
  desc: string;
}) {
  return (
    <a
      href={href}
      className="flex items-center gap-3 p-3.5 rounded-lg border border-gray-200 hover:border-blue-300 hover:bg-blue-50 active:bg-blue-100 transition-colors group"
    >
      <span className="text-2xl shrink-0">{icon}</span>
      <div>
        <div className="text-sm font-medium text-gray-800 group-hover:text-blue-700">
          {title}
        </div>
        <div className="text-xs text-gray-500">{desc}</div>
      </div>
    </a>
  );
}
