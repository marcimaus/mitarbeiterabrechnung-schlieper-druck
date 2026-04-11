import { useApp } from '../context/AppContext';

export default function OfflineBanner() {
  const { isOnline } = useApp();
  if (isOnline) return null;

  return (
    <div className="bg-amber-500 text-white text-sm text-center py-2 px-4 font-medium">
      Keine Internetverbindung — Daten werden lokal gespeichert und synchronisiert, sobald die Verbindung wiederhergestellt ist.
    </div>
  );
}
