// Phase 4: Abrechnung & Export
// Placeholder — wird in Phase 4 vollständig implementiert

import AdminPinGate from '../components/AdminPinGate';

export default function AbrechnungScreen() {
  return (
    <AdminPinGate>
      <div className="p-6">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Abrechnung</h1>
        <div className="bg-green-50 border border-green-200 rounded-xl p-6 text-center">
          <div className="text-4xl mb-3">💰</div>
          <p className="text-green-800 font-medium">Monatsabrechnung & Export (Phase 4)</p>
          <p className="text-green-600 text-sm mt-1">
            Lohnberechnung, Excel-Export & PDF-Lieferscheine — wird in Phase 4 implementiert
          </p>
        </div>
      </div>
    </AdminPinGate>
  );
}
