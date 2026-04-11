// Phase 2: Ausgabenplanung
// Placeholder — wird in Phase 2 vollständig implementiert

import AdminPinGate from '../components/AdminPinGate';

export default function AusgabenScreen() {
  return (
    <AdminPinGate>
      <div className="p-6">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Ausgabenplanung</h1>
        <div className="bg-purple-50 border border-purple-200 rounded-xl p-6 text-center">
          <div className="text-4xl mb-3">📄</div>
          <p className="text-purple-800 font-medium">Ausgaben & Beilagen (Phase 2)</p>
          <p className="text-purple-600 text-sm mt-1">
            KW-Ausgaben, Beilagenplanung & Abrechnungsperioden — wird in Phase 2 implementiert
          </p>
        </div>
      </div>
    </AdminPinGate>
  );
}
