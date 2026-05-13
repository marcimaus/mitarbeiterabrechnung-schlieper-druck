import { useEffect, useState } from 'react';
import { useApp } from '../context/AppContext';
import { abonniereReklamationen } from '../lib/db';
import type { Reklamation } from '../types';

export default function HomeScreen() {
  const { mitarbeiter, teilgebiete, touren, abrechnungsperioden, isAdminAuthenticated } = useApp();

  const aktiveMitarbeiter = mitarbeiter.filter((m) => m.isActive);
  const aktiveTouren = touren.length;
  const offenePerioden = abrechnungsperioden.filter((p) => p.status === 'offen').length;

  // Teilgebiete ohne Standardausträger (aktiv, keine Auslagestellen — diese
  // brauchen keinen Austräger).
  const tgsOhneAustraeger = teilgebiete
    .filter((tg) => tg.isActive && !tg.istAuslagestelle && !tg.standardAustraegerId)
    .sort((a, b) => a.name.localeCompare(b.name, 'de', { numeric: true }));

  // Offene Reklamationen: Datensätze, die noch nicht dem MA mitgeteilt wurden.
  const [reklamationen, setReklamationen] = useState<Reklamation[]>([]);
  useEffect(() => {
    if (!isAdminAuthenticated) return;
    const unsub = abonniereReklamationen(setReklamationen);
    return () => unsub();
  }, [isAdminAuthenticated]);
  const offeneReklamationen = reklamationen.filter((r) => !r.mitgeteilt);

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
              <QuickLink href="/ausgaben" icon="📄" title="Ausgaben & Beilagen" desc="Wochenausgaben planen" />
              <QuickLink href="/einsaetze" icon="🗓" title="Einsätze" desc="Austräger zuweisen" />
              <QuickLink href="/reklamationen" icon="📞" title="Reklamationen" desc="Leser-Reklamationen erfassen" />
              <QuickLink href="/abrechnung" icon="💰" title="Abrechnung" desc="Monatsabrechnung & Export" />
              <QuickLink href="/teilgebiete" icon="📍" title="Teilgebiete" desc="Gebiete & Straßenlisten" />
            </>
          )}
        </div>
      </div>

      {/* Auswertungen: Teilgebiete ohne Standardausträger + offene Reklamationen */}
      {isAdminAuthenticated && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Teilgebiete ohne Standardausträger */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 md:p-6">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-amber-600">⚠</span>
              <h2 className="font-semibold text-gray-800">Teilgebiete ohne Standardausträger</h2>
              <span className={`ml-auto text-xs px-2 py-0.5 rounded-full font-medium ${
                tgsOhneAustraeger.length === 0
                  ? 'bg-green-100 text-green-700'
                  : 'bg-amber-100 text-amber-800'
              }`}>
                {tgsOhneAustraeger.length}
              </span>
            </div>
            {tgsOhneAustraeger.length === 0 ? (
              <p className="text-sm text-gray-500 italic">
                Alle aktiven Teilgebiete haben einen Standardausträger zugeordnet. ✓
              </p>
            ) : (
              <div className="space-y-1.5 max-h-64 overflow-y-auto">
                {tgsOhneAustraeger.map((tg) => (
                  <a
                    key={tg.id}
                    href="/teilgebiete"
                    className="flex items-center justify-between py-1.5 px-2.5 rounded-md bg-amber-50 border border-amber-200 hover:bg-amber-100"
                  >
                    <span className="text-sm font-medium text-amber-900">{tg.name}</span>
                    {tg.plz && (
                      <span className="text-xs text-amber-700 font-mono">{tg.plz}</span>
                    )}
                  </a>
                ))}
              </div>
            )}
          </div>

          {/* Offene Reklamationen */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 md:p-6">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-red-600">📞</span>
              <h2 className="font-semibold text-gray-800">Offene Reklamationen</h2>
              <span className={`ml-auto text-xs px-2 py-0.5 rounded-full font-medium ${
                offeneReklamationen.length === 0
                  ? 'bg-green-100 text-green-700'
                  : 'bg-red-100 text-red-700'
              }`}>
                {offeneReklamationen.length}
              </span>
            </div>
            {offeneReklamationen.length === 0 ? (
              <p className="text-sm text-gray-500 italic">
                Keine offenen Reklamationen. ✓
              </p>
            ) : (
              <div className="space-y-1.5 max-h-64 overflow-y-auto">
                {offeneReklamationen.slice(0, 10).map((r) => (
                  <a
                    key={r.id}
                    href="/reklamationen"
                    className="block py-1.5 px-2.5 rounded-md bg-red-50 border border-red-200 hover:bg-red-100"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium text-red-900 truncate">
                        {r.anruferName || '— ohne Name —'}
                      </span>
                      <span className="text-[11px] text-red-600 shrink-0 font-mono">
                        {new Date(r.erstelltAm).toLocaleDateString('de-DE')}
                      </span>
                    </div>
                    {(r.strasse || r.ort) && (
                      <div className="text-xs text-red-700/80 truncate">
                        {[r.strasse, r.hausnummer].filter(Boolean).join(' ')}
                        {(r.strasse || r.hausnummer) && (r.plz || r.ort) ? ', ' : ''}
                        {[r.plz, r.ort].filter(Boolean).join(' ')}
                      </div>
                    )}
                  </a>
                ))}
                {offeneReklamationen.length > 10 && (
                  <a
                    href="/reklamationen"
                    className="block py-1 text-center text-xs text-red-700 hover:text-red-900 font-medium"
                  >
                    … und {offeneReklamationen.length - 10} weitere
                  </a>
                )}
              </div>
            )}
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
