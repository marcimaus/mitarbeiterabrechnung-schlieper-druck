// Lieferscheine drucken — ein Blatt je Austräger+Teilgebiet je Ausgabe
// Enthält: Austräger-Info, Teilgebiet-Info, Periode-Tabelle, QR-Code, Unterschrift
// Springer wird rot markiert (Fahrer sieht: andere Lieferadresse!)

import { useState, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import AdminPinGate from '../components/AdminPinGate';
import { ladeAusgaben, ladeEinsaetze } from '../lib/db';
import type { Ausgabe, Einsatz, Mitarbeiter, Teilgebiet, Abrechnungsperiode } from '../types';
import { kwLabel } from '../lib/kalender';

export default function LieferscheineScreen() {
  return (
    <AdminPinGate>
      <LieferscheineInhalt />
    </AdminPinGate>
  );
}

// ── Hilfsfunktionen ────────────────────────────────────────────────────────

/** Montag der ISO-KW als lesbares Datum */
function montagDerKW(kw: number, jahr: number): string {
  const jan4 = new Date(jahr, 0, 4);
  const wd = jan4.getDay() || 7;
  const mo = new Date(jan4);
  mo.setDate(jan4.getDate() - (wd - 1) + (kw - 1) * 7);
  return mo.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function adresseZeile(a?: Mitarbeiter['adresse']): string {
  if (!a) return '';
  return [a.strasse, [a.plz, a.ort].filter(Boolean).join(' ')].filter(Boolean).join(', ');
}

// ── Haupt-Inhalt ────────────────────────────────────────────────────────────

function LieferscheineInhalt() {
  const { mitarbeiter, teilgebiete, abrechnungsperioden } = useApp();
  const [ausgaben, setAusgaben] = useState<Ausgabe[]>([]);
  const [selectedAusgabeId, setSelectedAusgabeId] = useState('');
  const [selectedPeriodeId, setSelectedPeriodeId] = useState('');
  const [einsaetze, setEinsaetze] = useState<Einsatz[]>([]);
  const [loading, setLoading] = useState(false);
  const [druckbereit, setDruckbereit] = useState(false);

  // Ausgaben laden
  useEffect(() => {
    ladeAusgaben().then((list) => {
      const sorted = [...list].sort((a, b) =>
        b.jahr !== a.jahr ? b.jahr - a.jahr : b.kw - a.kw
      );
      setAusgaben(sorted);
      if (sorted.length > 0) setSelectedAusgabeId(sorted[0].id);
    });
  }, []);

  // Einsätze laden wenn Ausgabe wechselt
  useEffect(() => {
    if (!selectedAusgabeId) { setEinsaetze([]); return; }
    setLoading(true);
    ladeEinsaetze(selectedAusgabeId)
      .then(setEinsaetze)
      .finally(() => setLoading(false));
  }, [selectedAusgabeId]);

  const selectedAusgabe = ausgaben.find((a) => a.id === selectedAusgabeId);
  const selectedPeriode = abrechnungsperioden.find((p) => p.id === selectedPeriodeId);

  // Periode auto-vorschlagen wenn Ausgabe bekannt
  useEffect(() => {
    if (!selectedAusgabe || selectedPeriodeId) return;
    const passendePeriode = abrechnungsperioden.find((p) =>
      p.kalenderwochen.includes(selectedAusgabe.kw) && p.jahr === selectedAusgabe.jahr
    );
    if (passendePeriode) setSelectedPeriodeId(passendePeriode.id);
  }, [selectedAusgabe, abrechnungsperioden, selectedPeriodeId]);

  // Einsätze filtern: nur mit Mitarbeiter (kein Ausfall/ungeklärt)
  const aktiveEinsaetze = einsaetze.filter(
    (e) => e.mitarbeiterId && e.typ !== 'ausfall' && e.typ !== 'ungeklärt'
  );

  // Ausgaben in der Periode (für die Zeiterfassungs-Tabelle)
  const ausgabenInPeriode: Ausgabe[] = selectedPeriode
    ? ausgaben.filter(
        (a) =>
          selectedPeriode.kalenderwochen.includes(a.kw) &&
          a.jahr === selectedPeriode.jahr
      ).sort((a, b) => a.kw - b.kw)
    : selectedAusgabe
    ? [selectedAusgabe]
    : [];

  function getMa(id: string | null): Mitarbeiter | undefined {
    return id ? mitarbeiter.find((m) => m.id === id) : undefined;
  }
  function getTg(id: string): Teilgebiet | undefined {
    return teilgebiete.find((t) => t.id === id);
  }

  return (
    <div className="p-6">
      {/* Drucksteuerung — wird beim Drucken ausgeblendet */}
      <div className="print:hidden">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">📄 Lieferscheine</h1>
            <p className="text-gray-500 text-sm">Druckvorlage für Austräger — je ein Blatt pro Teilgebiet</p>
          </div>
          {druckbereit && aktiveEinsaetze.length > 0 && (
            <button
              onClick={() => window.print()}
              className="bg-green-700 hover:bg-green-800 text-white font-semibold px-6 py-2.5 rounded-xl transition-colors"
            >
              🖨️ Drucken ({aktiveEinsaetze.length} Blätter)
            </button>
          )}
        </div>

        {/* Auswahl */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 mb-6 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Ausgabe (KW)</label>
            <select
              value={selectedAusgabeId}
              onChange={(e) => { setSelectedAusgabeId(e.target.value); setDruckbereit(false); }}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">— Ausgabe wählen —</option>
              {ausgaben.map((a) => (
                <option key={a.id} value={a.id}>
                  {kwLabel(a.kw, a.jahr)} · {a.seitenzahl} Seiten · {a.status}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Abrechnungsperiode
              <span className="text-gray-400 font-normal ml-1">(für Periode-Übersicht auf Lieferschein)</span>
            </label>
            <select
              value={selectedPeriodeId}
              onChange={(e) => setSelectedPeriodeId(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">— nur diese Ausgabe —</option>
              {abrechnungsperioden.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.bezeichnung} · KW {p.kalenderwochen.join(', ')}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Status */}
        {loading && (
          <div className="text-center text-gray-400 py-8">Lade Einsätze …</div>
        )}
        {!loading && selectedAusgabe && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 mb-6">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold text-gray-800">
                Einsätze {kwLabel(selectedAusgabe.kw, selectedAusgabe.jahr)}
              </h2>
              <span className="text-sm text-gray-500">{aktiveEinsaetze.length} Lieferscheine</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
              {aktiveEinsaetze.map((e) => {
                const tg = getTg(e.teilgebietId);
                const ma = getMa(e.mitarbeiterId);
                const istSpringer = e.typ === 'springer';
                return (
                  <div
                    key={e.id}
                    className={`text-xs rounded-lg px-3 py-2 border ${
                      istSpringer
                        ? 'bg-red-50 border-red-200 text-red-800'
                        : 'bg-gray-50 border-gray-200 text-gray-700'
                    }`}
                  >
                    <div className="font-medium truncate">{tg?.name ?? '—'}</div>
                    <div className="truncate opacity-75">{ma?.name ?? '—'}</div>
                    {istSpringer && <div className="text-red-600 font-semibold text-xs">SPRINGER</div>}
                  </div>
                );
              })}
            </div>
            {aktiveEinsaetze.length > 0 && (
              <div className="mt-4 flex gap-3">
                <button
                  onClick={() => setDruckbereit(true)}
                  className="bg-blue-600 hover:bg-blue-700 text-white px-5 py-2 rounded-lg text-sm font-medium transition-colors"
                >
                  Druckvorschau aktivieren
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Druckbereich ── */}
      {druckbereit && selectedAusgabe && aktiveEinsaetze.length > 0 && (
        <div>
          {aktiveEinsaetze.map((einsatz) => {
            const tg = getTg(einsatz.teilgebietId);
            const ma = getMa(einsatz.mitarbeiterId);
            if (!tg || !ma) return null;
            return (
              <LieferscheinSeite
                key={einsatz.id}
                einsatz={einsatz}
                ma={ma}
                tg={tg}
                ausgabe={selectedAusgabe}
                ausgabenInPeriode={ausgabenInPeriode}
                periode={selectedPeriode}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Einzelner Lieferschein (eine Druckseite) ────────────────────────────────

interface SeiteProps {
  einsatz: Einsatz;
  ma: Mitarbeiter;
  tg: Teilgebiet;
  ausgabe: Ausgabe;
  ausgabenInPeriode: Ausgabe[];
  periode?: Abrechnungsperiode;
}

function LieferscheinSeite({ einsatz, ma, tg, ausgabe, ausgabenInPeriode, periode }: SeiteProps) {
  const istSpringer = einsatz.typ === 'springer';
  const qrUrl = `${window.location.origin}/meldung?ma=${encodeURIComponent(ma.id)}`;
  const qrImgUrl = `https://api.qrserver.com/v1/create-qr-code/?size=130x130&margin=4&data=${encodeURIComponent(qrUrl)}`;
  const adresse = adresseZeile(ma.adresse);

  return (
    <div
      className="bg-white print:block"
      style={{
        width: '210mm',
        minHeight: '297mm',
        padding: '12mm 14mm',
        marginBottom: '8mm',
        pageBreakAfter: 'always',
        fontFamily: 'Arial, sans-serif',
        fontSize: '11pt',
        boxSizing: 'border-box',
      }}
    >
      {/* ─── Kopf ─── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '6mm', borderBottom: '2px solid #1e40af', paddingBottom: '4mm' }}>
        <div>
          <div style={{ fontSize: '10pt', color: '#6b7280', marginBottom: '1mm' }}>Schlieper-Druck GmbH · Tip aktuell</div>
          <div style={{ fontSize: '16pt', fontWeight: 'bold', color: '#1e3a8a' }}>Lieferschein</div>
          <div style={{ fontSize: '11pt', color: '#374151', marginTop: '1mm' }}>
            {kwLabel(ausgabe.kw, ausgabe.jahr)} · {montagDerKW(ausgabe.kw, ausgabe.jahr)}
          </div>
          {periode && (
            <div style={{ fontSize: '9pt', color: '#6b7280', marginTop: '1mm' }}>
              Abrechnungsperiode: {periode.bezeichnung} | KW {periode.kalenderwochen.join(', ')}
            </div>
          )}
        </div>
        {/* QR Code */}
        <div style={{ textAlign: 'center' }}>
          <img src={qrImgUrl} alt="QR-Code Meldung" width={100} height={100} style={{ border: '1px solid #e5e7eb', borderRadius: '4px' }} />
          <div style={{ fontSize: '7pt', color: '#6b7280', marginTop: '1mm', maxWidth: '26mm', wordBreak: 'break-all' }}>
            Online melden
          </div>
        </div>
      </div>

      {/* ─── Springer-Banner ─── */}
      {istSpringer && (
        <div style={{
          backgroundColor: '#fee2e2',
          border: '2px solid #ef4444',
          borderRadius: '6px',
          padding: '4mm 6mm',
          marginBottom: '4mm',
          textAlign: 'center',
        }}>
          <span style={{ color: '#dc2626', fontWeight: 'bold', fontSize: '14pt' }}>
            🔄 SPRINGER — abweichende Lieferadresse!
          </span>
          <div style={{ fontSize: '9pt', color: '#7f1d1d', marginTop: '1mm' }}>
            Bitte an untenstehende Adresse des Springers liefern — nicht an Standardausträger.
          </div>
        </div>
      )}

      {/* ─── Zwei Spalten: Austräger + Teilgebiet ─── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '5mm', marginBottom: '5mm' }}>
        {/* Austräger */}
        <div style={{ border: '1px solid #d1d5db', borderRadius: '6px', padding: '3mm 4mm' }}>
          <div style={{ fontSize: '8pt', color: '#6b7280', fontWeight: 'bold', marginBottom: '1.5mm', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            {istSpringer ? '🔄 Springer (Lieferadresse)' : 'Austräger'}
          </div>
          <div style={{ fontWeight: 'bold', fontSize: '12pt', color: istSpringer ? '#dc2626' : '#111827' }}>
            {ma.name}
          </div>
          {adresse && (
            <div style={{ fontSize: '10pt', color: '#374151', marginTop: '1mm', lineHeight: 1.4 }}>
              {ma.adresse.strasse && <div>{ma.adresse.strasse}</div>}
              {(ma.adresse.plz || ma.adresse.ort) && (
                <div>{[ma.adresse.plz, ma.adresse.ort].filter(Boolean).join(' ')}</div>
              )}
            </div>
          )}
          {ma.telefon && (
            <div style={{ fontSize: '9pt', color: '#6b7280', marginTop: '1mm' }}>
              📞 {ma.telefon}
            </div>
          )}
        </div>

        {/* Teilgebiet */}
        <div style={{ border: '1px solid #d1d5db', borderRadius: '6px', padding: '3mm 4mm' }}>
          <div style={{ fontSize: '8pt', color: '#6b7280', fontWeight: 'bold', marginBottom: '1.5mm', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Verteilgebiet
          </div>
          <div style={{ fontWeight: 'bold', fontSize: '12pt', color: '#111827' }}>{tg.name}</div>
          {tg.plz && <div style={{ fontSize: '10pt', color: '#374151' }}>PLZ: {tg.plz}</div>}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2mm', marginTop: '2mm' }}>
            <div style={{ backgroundColor: '#eff6ff', borderRadius: '4px', padding: '2mm', textAlign: 'center' }}>
              <div style={{ fontSize: '8pt', color: '#6b7280' }}>Menge</div>
              <div style={{ fontWeight: 'bold', fontSize: '13pt', color: '#1e40af' }}>{tg.stueckzahl}</div>
              <div style={{ fontSize: '7pt', color: '#6b7280' }}>Stück</div>
            </div>
            <div style={{ backgroundColor: '#f0fdf4', borderRadius: '4px', padding: '2mm', textAlign: 'center' }}>
              <div style={{ fontSize: '8pt', color: '#6b7280' }}>Strecke</div>
              <div style={{ fontWeight: 'bold', fontSize: '13pt', color: '#15803d' }}>
                {tg.wegstreckeM >= 1000 ? `${(tg.wegstreckeM / 1000).toFixed(1)} km` : `${tg.wegstreckeM} m`}
              </div>
              <div style={{ fontSize: '7pt', color: '#6b7280' }}>Laufweg</div>
            </div>
          </div>
        </div>
      </div>

      {/* ─── Zeiterfassungs-Tabelle ─── */}
      <div style={{ marginBottom: '5mm' }}>
        <div style={{ fontSize: '9pt', fontWeight: 'bold', color: '#374151', marginBottom: '2mm', textTransform: 'uppercase', letterSpacing: '0.3px' }}>
          Erfassung Arbeitszeiten — bitte ausfüllen oder QR-Code nutzen
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '9.5pt' }}>
          <thead>
            <tr style={{ backgroundColor: '#1e3a8a', color: 'white' }}>
              <th style={thStyle}>KW</th>
              <th style={thStyle}>Datum</th>
              <th style={thStyle}>Menge</th>
              <th style={thStyle}>Arbeit von</th>
              <th style={thStyle}>bis</th>
              <th style={thStyle}>Pause (min)</th>
              <th style={thStyle}>Restmenge</th>
            </tr>
          </thead>
          <tbody>
            {ausgabenInPeriode.map((ag, idx) => {
              const istAktuell = ag.id === ausgabe.id;
              return (
                <tr
                  key={ag.id}
                  style={{
                    backgroundColor: istAktuell ? '#eff6ff' : idx % 2 === 0 ? '#ffffff' : '#f9fafb',
                  }}
                >
                  <td style={{ ...tdStyle, fontWeight: istAktuell ? 'bold' : 'normal', color: istAktuell ? '#1e40af' : 'inherit' }}>
                    {ag.kw}
                    {istAktuell && ' ◀'}
                  </td>
                  <td style={tdStyle}>{montagDerKW(ag.kw, ag.jahr)}</td>
                  <td style={{ ...tdStyle, textAlign: 'center', fontWeight: istAktuell ? 'bold' : 'normal' }}>
                    {istAktuell ? tg.stueckzahl : ''}
                  </td>
                  <td style={eingabeTdStyle}>&nbsp;</td>
                  <td style={eingabeTdStyle}>&nbsp;</td>
                  <td style={eingabeTdStyle}>&nbsp;</td>
                  <td style={eingabeTdStyle}>&nbsp;</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ─── Unterschrift + Rücksendung ─── */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '5mm', marginTop: '4mm' }}>
        <div>
          <div style={{ fontSize: '8pt', color: '#6b7280', marginBottom: '8mm' }}>
            Unterschrift Austräger (oder online via QR-Code melden)
          </div>
          <div style={{ borderTop: '1px solid #374151', paddingTop: '1mm', fontSize: '8pt', color: '#6b7280' }}>
            Datum &amp; Unterschrift
          </div>
        </div>
        <div style={{ border: '1px solid #d1d5db', borderRadius: '6px', padding: '3mm', backgroundColor: '#f9fafb' }}>
          <div style={{ fontSize: '7pt', color: '#6b7280', fontWeight: 'bold', marginBottom: '1mm' }}>
            RÜCKSENDUNG AN:
          </div>
          <div style={{ fontSize: '9pt', fontWeight: 'bold', lineHeight: 1.4 }}>
            Schlieper-Druck GmbH
          </div>
          <div style={{ fontSize: '8pt', color: '#374151', lineHeight: 1.4 }}>
            per WhatsApp/Foto oder<br />per QR-Code online melden
          </div>
        </div>
      </div>

      {/* ─── Fuß ─── */}
      <div style={{ borderTop: '1px solid #e5e7eb', marginTop: '4mm', paddingTop: '2mm', display: 'flex', justifyContent: 'space-between', fontSize: '7.5pt', color: '#9ca3af' }}>
        <span>Schlieper-Druck GmbH · Tip aktuell · {kwLabel(ausgabe.kw, ausgabe.jahr)}</span>
        <span>Austräger-Nr.: {ma.nummer}</span>
      </div>
    </div>
  );
}

// ── Tabellen-Styles ────────────────────────────────────────────────────────

const thStyle: React.CSSProperties = {
  padding: '3mm 2mm',
  textAlign: 'left',
  fontWeight: 'bold',
  fontSize: '8.5pt',
  borderRight: '1px solid #3b5fc0',
};

const tdStyle: React.CSSProperties = {
  padding: '2.5mm 2mm',
  borderBottom: '1px solid #e5e7eb',
  borderRight: '1px solid #e5e7eb',
};

const eingabeTdStyle: React.CSSProperties = {
  ...tdStyle,
  minHeight: '8mm',
  backgroundColor: 'transparent',
};
