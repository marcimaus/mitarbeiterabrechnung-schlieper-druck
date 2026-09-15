// Verteilplan / Bestellzettel für Kunden
// Druckoptimiertes A4-Dokument: Teilgebiete nach Tour + PLZ, mit Checkboxen und Summen.

import { useState } from 'react';
import { useApp } from '../context/AppContext';
import AdminPinGate from '../components/AdminPinGate';
import type { Teilgebiet, Tour } from '../types';

export default function VerteilplanScreen() {
  return (
    <AdminPinGate allowedRoles={['admin', 'abrechnung']}>
      <VerteilplanInhalt />
    </AdminPinGate>
  );
}

function VerteilplanInhalt() {
  const { teilgebiete, touren } = useApp();

  // Kundenfelder
  const [kundenname, setKundenname] = useState('');
  const [ansprechpartner, setAnsprechpartner] = useState('');
  const [telefon, setTelefon] = useState('');
  const [datum, setDatum] = useState(new Date().toISOString().slice(0, 10));
  const [kw, setKw] = useState('');
  const [format, setFormat] = useState('');
  const [gewichtGStk, setGewichtGStk] = useState('');

  // Vorschau / Drucken
  const [druckenModus, setDruckenModus] = useState(false);

  const aktiveTGs = teilgebiete.filter((tg) => tg.isActive).sort((a, b) => a.name.localeCompare(b.name));

  // Touren mit ihren Teilgebieten
  const tourenMitTGs: Array<{ tour: Tour | null; tgs: Teilgebiet[] }> = [
    ...touren
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((tour) => ({
        tour,
        tgs: aktiveTGs.filter((tg) => tg.tourId === tour.id),
      }))
      .filter((g) => g.tgs.length > 0),
    // Ohne Tour
    {
      tour: null,
      tgs: aktiveTGs.filter((tg) => !tg.tourId),
    },
  ].filter((g) => g.tgs.length > 0);

  // Summe je Gruppe
  function summe(tgs: Teilgebiet[]) {
    return tgs.reduce((s, tg) => s + tg.stueckzahl, 0);
  }

  // PLZ-Gruppierung innerhalb einer Tour
  function gruppiereNachPlz(tgs: Teilgebiet[]) {
    const map = new Map<string, Teilgebiet[]>();
    for (const tg of tgs) {
      const plz = tg.plz || '—';
      if (!map.has(plz)) map.set(plz, []);
      map.get(plz)!.push(tg);
    }
    // Sortiert nach PLZ
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }

  const gesamtStueckzahl = summe(aktiveTGs);

  function handleDrucken() {
    window.print();
  }

  return (
    <div>
      {/* Steuerleiste (nur am Bildschirm) */}
      <div className="print:hidden p-6 bg-white border-b border-gray-200">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900">Verteilplan — Bestellzettel</h1>
            <p className="text-sm text-gray-500 mt-0.5">Ausfüllbares Kundendokument zum Drucken</p>
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => setDruckenModus((v) => !v)}
              className="px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50 transition-colors"
            >
              {druckenModus ? '✏ Felder bearbeiten' : '👁 Vorschau'}
            </button>
            <button
              onClick={handleDrucken}
              className="px-5 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
            >
              🖨 Drucken / PDF
            </button>
          </div>
        </div>
      </div>

      {/* Kundenfelder-Editor (nur am Bildschirm, nicht im Druckmodus) */}
      {!druckenModus && (
        <div className="print:hidden bg-gray-50 border-b border-gray-200 px-6 py-4">
          <div className="max-w-5xl mx-auto">
            <p className="text-xs font-semibold text-gray-500 uppercase mb-3">Kundendaten für das Dokument</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Kundenname / Firma</label>
                <input
                  type="text"
                  value={kundenname}
                  onChange={(e) => setKundenname(e.target.value)}
                  placeholder="REWE Uslar GmbH"
                  className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Ansprechpartner</label>
                <input
                  type="text"
                  value={ansprechpartner}
                  onChange={(e) => setAnsprechpartner(e.target.value)}
                  placeholder="Max Mustermann"
                  className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Telefon</label>
                <input
                  type="text"
                  value={telefon}
                  onChange={(e) => setTelefon(e.target.value)}
                  placeholder="05571 12345"
                  className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Datum</label>
                <input
                  type="date"
                  value={datum}
                  onChange={(e) => setDatum(e.target.value)}
                  className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Kalenderwoche</label>
                <input
                  type="text"
                  value={kw}
                  onChange={(e) => setKw(e.target.value)}
                  placeholder="KW 17/2026"
                  className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Format der Beilage</label>
                <input
                  type="text"
                  value={format}
                  onChange={(e) => setFormat(e.target.value)}
                  placeholder="DIN A4, DIN A5 …"
                  className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Gewicht (g/Stk)</label>
                <input
                  type="text"
                  value={gewichtGStk}
                  onChange={(e) => setGewichtGStk(e.target.value)}
                  placeholder="28"
                  className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════
          DRUCKBARES DOKUMENT
          ═══════════════════════════════════════════════════════════ */}
      <div
        style={{
          width: '210mm',
          minHeight: '297mm',
          margin: '0 auto',
          padding: '15mm 12mm',
          background: 'white',
          fontFamily: 'Arial, Helvetica, sans-serif',
          fontSize: '10pt',
          color: '#111',
          boxSizing: 'border-box',
        }}
      >
        {/* ── Kopfzeile ── */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8mm', borderBottom: '2px solid #1d4ed8', paddingBottom: '5mm' }}>
          <div>
            <div style={{ fontSize: '16pt', fontWeight: 'bold', color: '#1d4ed8', lineHeight: 1.2 }}>
              Schlieper-Druck GmbH
            </div>
            <div style={{ fontSize: '8pt', color: '#555', marginTop: '2mm', lineHeight: 1.6 }}>
              Tel. 05571 9203-0 &nbsp;·&nbsp; info@schlieper-druck.com &nbsp;·&nbsp; www.schlieper-druck.com
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: '13pt', fontWeight: 'bold', color: '#111' }}>Verteilplan</div>
            <div style={{ fontSize: '8pt', color: '#555', marginTop: '1mm' }}>Bestellzettel Beilagenverteilung</div>
          </div>
        </div>

        {/* ── Kundendaten ── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4mm', marginBottom: '7mm' }}>
          <KundenFeld label="Kunde / Firma" value={kundenname} />
          <KundenFeld label="Ansprechpartner" value={ansprechpartner} />
          <KundenFeld label="Telefon" value={telefon} />
          <KundenFeld label="Datum" value={datum ? new Date(datum).toLocaleDateString('de-DE') : ''} />
          <KundenFeld label="Kalenderwoche" value={kw} />
          <KundenFeld label="Format der Beilage" value={format} />
          <KundenFeld label="Gewicht (g/Stk)" value={gewichtGStk} />
          <div />
        </div>

        {/* ── Hinweistext ── */}
        <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '4px', padding: '3mm 4mm', marginBottom: '6mm', fontSize: '8pt', color: '#1e40af' }}>
          Bitte markieren Sie die gewünschten Teilgebiete mit einem Kreuz (✓) und senden Sie diesen Bogen zurück.
        </div>

        {/* ── Tabelle ── */}
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '8.5pt' }}>
          <thead>
            <tr style={{ background: '#1d4ed8', color: 'white' }}>
              <th style={thStyle}>✓</th>
              <th style={{ ...thStyle, textAlign: 'left' }}>Teilgebiet</th>
              <th style={{ ...thStyle, textAlign: 'left' }}>PLZ</th>
              <th style={{ ...thStyle, textAlign: 'left' }}>Tour</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>Stückzahl</th>
            </tr>
          </thead>
          <tbody>
            {tourenMitTGs.map(({ tour, tgs }) => {
              const plzGruppen = gruppiereNachPlz(tgs);
              const tourSumme = summe(tgs);
              return (
                <>
                  {/* Tour-Trennzeile */}
                  <tr key={`tour-header-${tour?.id ?? 'ohne'}`}>
                    <td colSpan={5} style={{
                      background: tour ? tour.farbe + '22' : '#f3f4f6',
                      borderLeft: `3px solid ${tour?.farbe ?? '#9ca3af'}`,
                      padding: '2mm 3mm',
                      fontWeight: 'bold',
                      fontSize: '8pt',
                      color: '#333',
                    }}>
                      {tour ? `Tour ${tour.name}` : 'Ohne Tour'}
                    </td>
                  </tr>

                  {plzGruppen.map(([plz, plzTgs]) => (
                    <>
                      {plzTgs.map((tg, idx) => (
                        <tr
                          key={tg.id}
                          style={{ background: idx % 2 === 0 ? '#ffffff' : '#f9fafb' }}
                        >
                          <td style={{ ...tdStyle, textAlign: 'center', width: '10mm' }}>
                            <span style={{ display: 'inline-block', width: '4mm', height: '4mm', border: '1px solid #666', borderRadius: '2px' }} />
                          </td>
                          <td style={{ ...tdStyle, paddingLeft: '5mm' }}>{tg.name}</td>
                          <td style={tdStyle}>{tg.plz}</td>
                          <td style={tdStyle}>{tour?.name ?? '—'}</td>
                          <td style={{ ...tdStyle, textAlign: 'right' }}>{tg.stueckzahl.toLocaleString('de-DE')}</td>
                        </tr>
                      ))}

                      {/* PLZ-Zwischensumme (nur wenn > 1 TG in dieser PLZ) */}
                      {plzTgs.length > 1 && (
                        <tr key={`plz-${plz}`} style={{ background: '#f0f7ff' }}>
                          <td style={{ ...tdStyle, textAlign: 'center' }} />
                          <td colSpan={3} style={{ ...tdStyle, color: '#1d4ed8', fontStyle: 'italic', fontSize: '8pt' }}>
                            PLZ {plz} Gesamt
                          </td>
                          <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 'bold', color: '#1d4ed8' }}>
                            {summe(plzTgs).toLocaleString('de-DE')}
                          </td>
                        </tr>
                      )}
                    </>
                  ))}

                  {/* Tour-Summe */}
                  <tr key={`tour-summe-${tour?.id ?? 'ohne'}`} style={{ background: tour ? tour.farbe + '33' : '#e5e7eb' }}>
                    <td style={{ ...tdStyle, textAlign: 'center' }} />
                    <td colSpan={3} style={{ ...tdStyle, fontWeight: 'bold', fontSize: '8.5pt' }}>
                      {tour ? `Tour ${tour.name} Gesamt` : 'Ohne Tour Gesamt'}
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 'bold' }}>
                      {tourSumme.toLocaleString('de-DE')}
                    </td>
                  </tr>
                </>
              );
            })}
          </tbody>
          <tfoot>
            <tr style={{ background: '#1d4ed8', color: 'white' }}>
              <td style={{ ...tdStyle, textAlign: 'center' }} />
              <td colSpan={3} style={{ ...tdStyle, fontWeight: 'bold', fontSize: '10pt', color: 'white' }}>
                Gesamtauflage
              </td>
              <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 'bold', fontSize: '10pt', color: 'white' }}>
                {gesamtStueckzahl.toLocaleString('de-DE')}
              </td>
            </tr>
          </tfoot>
        </table>

        {/* ── Unterschrift ── */}
        <div style={{ marginTop: '12mm', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15mm' }}>
          <div>
            <div style={{ borderTop: '1px solid #555', paddingTop: '2mm', fontSize: '8pt', color: '#555' }}>
              Unterschrift Kunde / Datum
            </div>
          </div>
          <div>
            <div style={{ borderTop: '1px solid #555', paddingTop: '2mm', fontSize: '8pt', color: '#555' }}>
              Schlieper-Druck GmbH — Auftragsannahme
            </div>
          </div>
        </div>

        {/* ── Fußzeile ── */}
        <div style={{ marginTop: '8mm', paddingTop: '3mm', borderTop: '1px solid #ddd', fontSize: '7pt', color: '#888', textAlign: 'center' }}>
          Schlieper-Druck GmbH · Tip aktuell · Tel. 05571 9203-0 · info@schlieper-druck.com · www.schlieper-druck.com
        </div>
      </div>
    </div>
  );
}

// ── Hilfkomponenten ───────────────────────────────────────────────────────────

function KundenFeld({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5mm' }}>
      <span style={{ fontSize: '7pt', color: '#888', textTransform: 'uppercase', letterSpacing: '0.3px' }}>
        {label}
      </span>
      <div style={{
        borderBottom: '1px solid #aaa',
        minHeight: '6mm',
        paddingBottom: '1mm',
        fontSize: '9pt',
        color: value ? '#111' : '#ccc',
      }}>
        {value || '\u00a0'}
      </div>
    </div>
  );
}

const thStyle: React.CSSProperties = {
  padding: '2.5mm 2mm',
  fontSize: '8pt',
  fontWeight: 'bold',
  textAlign: 'center',
  borderBottom: '1px solid #1d4ed8',
};

const tdStyle: React.CSSProperties = {
  padding: '1.5mm 2mm',
  borderBottom: '1px solid #e5e7eb',
};
