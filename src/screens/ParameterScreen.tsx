import { useState, useEffect, type FormEvent } from 'react';
import { useApp } from '../context/AppContext';
import AdminPinGate from '../components/AdminPinGate';
import { speichereParameter } from '../lib/db';
import { hashPin } from '../lib/auth';
import type { Parameter } from '../types';

const STANDARD_PARAMETER: Omit<Parameter, 'adminPinHash' | 'adminName' | 'beilagenPreise'> = {
  laufgeschwindigkeitMProH: 5000,
  steckzeitStkProH: 720,
  stundenlohnErwachseneAustr: 13.90,
  stundenlohnMinderjAustr: 10.00,
  mindeststundenlohn: 13.90,
  springerZuschlagProzent: 25,
  gewichtszulageAnzeigenblattEurKg: 0.05,
  gewichtszulageBeilagenEurKg: 0.30,
  standardGrammurGqm: 65,
  standardSeitenformatBreiteMm: 305,
  standardSeitenformatHoeheMm: 215,
  fahrkostenEurProKm: 0.30,
};

export default function ParameterScreen() {
  return (
    <AdminPinGate>
      <ParameterInhalt />
    </AdminPinGate>
  );
}

function ParameterInhalt() {
  const { parameter, adminName } = useApp();

  const [form, setForm] = useState({
    laufgeschwindigkeitMProH: STANDARD_PARAMETER.laufgeschwindigkeitMProH,
    steckzeitStkProH: STANDARD_PARAMETER.steckzeitStkProH,
    stundenlohnErwachseneAustr: STANDARD_PARAMETER.stundenlohnErwachseneAustr,
    stundenlohnMinderjAustr: STANDARD_PARAMETER.stundenlohnMinderjAustr,
    mindeststundenlohn: STANDARD_PARAMETER.mindeststundenlohn,
    springerZuschlagProzent: STANDARD_PARAMETER.springerZuschlagProzent,
    gewichtszulageAnzeigenblattEurKg: STANDARD_PARAMETER.gewichtszulageAnzeigenblattEurKg,
    gewichtszulageBeilagenEurKg: STANDARD_PARAMETER.gewichtszulageBeilagenEurKg,
    standardGrammurGqm: STANDARD_PARAMETER.standardGrammurGqm,
    standardSeitenformatBreiteMm: STANDARD_PARAMETER.standardSeitenformatBreiteMm,
    standardSeitenformatHoeheMm: STANDARD_PARAMETER.standardSeitenformatHoeheMm,
    fahrkostenEurProKm: STANDARD_PARAMETER.fahrkostenEurProKm,
    adminName: adminName || '',
  });

  const [neuerPin, setNeuerPin] = useState('');
  const [pinBestaetigung, setPinBestaetigung] = useState('');
  const [saving, setSaving] = useState(false);
  const [pinSaving, setPinSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [pinMessage, setPinMessage] = useState('');

  // Form mit bestehenden Parametern füllen
  useEffect(() => {
    if (parameter) {
      setForm((f) => ({
        ...f,
        laufgeschwindigkeitMProH: parameter.laufgeschwindigkeitMProH,
        steckzeitStkProH: parameter.steckzeitStkProH,
        stundenlohnErwachseneAustr: parameter.stundenlohnErwachseneAustr,
        stundenlohnMinderjAustr: parameter.stundenlohnMinderjAustr,
        mindeststundenlohn: parameter.mindeststundenlohn,
        springerZuschlagProzent: parameter.springerZuschlagProzent,
        gewichtszulageAnzeigenblattEurKg: parameter.gewichtszulageAnzeigenblattEurKg,
        gewichtszulageBeilagenEurKg: parameter.gewichtszulageBeilagenEurKg,
        standardGrammurGqm: parameter.standardGrammurGqm,
        standardSeitenformatBreiteMm: parameter.standardSeitenformatBreiteMm,
        standardSeitenformatHoeheMm: parameter.standardSeitenformatHoeheMm,
        fahrkostenEurProKm: parameter.fahrkostenEurProKm ?? 0.30,
        adminName: parameter.adminName || '',
      }));
    }
  }, [parameter]);

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMessage('');
    try {
      await speichereParameter({
        ...form,
        beilagenPreise: parameter?.beilagenPreise ?? [],
        adminPinHash: parameter?.adminPinHash ?? '',
      });
      setMessage('✓ Parameter gespeichert');
      setTimeout(() => setMessage(''), 3000);
    } catch (err) {
      setMessage('Fehler beim Speichern!');
      console.error(err);
    } finally {
      setSaving(false);
    }
  }

  async function handlePinAendern(e: FormEvent) {
    e.preventDefault();
    if (neuerPin.length < 4) { setPinMessage('PIN muss mindestens 4 Stellen haben.'); return; }
    if (neuerPin !== pinBestaetigung) { setPinMessage('PINs stimmen nicht überein.'); return; }
    setPinSaving(true);
    setPinMessage('');
    try {
      const hash = await hashPin(neuerPin);
      await speichereParameter({ adminPinHash: hash });
      setNeuerPin('');
      setPinBestaetigung('');
      setPinMessage('✓ Admin-PIN geändert');
      setTimeout(() => setPinMessage(''), 3000);
    } catch (err) {
      setPinMessage('Fehler beim Ändern des PINs!');
      console.error(err);
    } finally {
      setPinSaving(false);
    }
  }

  function num(val: number | string) {
    return typeof val === 'number' ? val : parseFloat(val as string) || 0;
  }

  return (
    <div className="p-6 max-w-2xl">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Systemparameter</h1>

      <form onSubmit={handleSave} className="space-y-6">

        {/* Admin-Info */}
        <Section title="Admin">
          <Field label="Admin-Name">
            <input
              type="text"
              value={form.adminName}
              onChange={(e) => setForm((f) => ({ ...f, adminName: e.target.value }))}
              placeholder="Admin"
              className={inputClass}
            />
          </Field>
        </Section>

        {/* Austragen Zeitwerte */}
        <Section title="Zeitwerte Austragen">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Laufgeschwindigkeit (m/h)" hint="Standard: 5000">
              <input
                type="number"
                min="100"
                value={form.laufgeschwindigkeitMProH}
                onChange={(e) => setForm((f) => ({ ...f, laufgeschwindigkeitMProH: num(e.target.value) }))}
                className={inputClass}
              />
            </Field>
            <Field label="Steckzeit (Stk/h)" hint="Standard: 720">
              <input
                type="number"
                min="1"
                value={form.steckzeitStkProH}
                onChange={(e) => setForm((f) => ({ ...f, steckzeitStkProH: num(e.target.value) }))}
                className={inputClass}
              />
            </Field>
          </div>
          <p className="text-xs text-gray-400 mt-2">
            Zeitwert = Wegstrecke / Laufgeschwindigkeit + Stückzahl / Steckzeit
          </p>
        </Section>

        {/* Stundenlöhne */}
        <Section title="Stundenlöhne (EUR/h)">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Erwachsene Austräger (MiLoG)" hint="Aktuell: 13,90 €">
              <input
                type="number"
                min="0"
                step="0.01"
                value={form.stundenlohnErwachseneAustr}
                onChange={(e) => setForm((f) => ({ ...f, stundenlohnErwachseneAustr: num(e.target.value) }))}
                className={inputClass}
              />
            </Field>
            <Field label="Minderjährige Austräger" hint="Standard: 10,00 €">
              <input
                type="number"
                min="0"
                step="0.01"
                value={form.stundenlohnMinderjAustr}
                onChange={(e) => setForm((f) => ({ ...f, stundenlohnMinderjAustr: num(e.target.value) }))}
                className={inputClass}
              />
            </Field>
          </div>
          <Field label="Mindestlohn-Warnschwelle (EUR/h)" hint="Unterhalb dieses Werts wird beim Mitarbeiter eine Warnung angezeigt">
            <input
              type="number"
              min="0"
              step="0.01"
              value={form.mindeststundenlohn}
              onChange={(e) => setForm((f) => ({ ...f, mindeststundenlohn: num(e.target.value) }))}
              className={inputClass}
            />
          </Field>
        </Section>

        {/* Springer */}
        <Section title="Springer">
          <Field label="Springer-Zuschlag (%)" hint="Standard: 25%">
            <input
              type="number"
              min="0"
              max="200"
              value={form.springerZuschlagProzent}
              onChange={(e) => setForm((f) => ({ ...f, springerZuschlagProzent: num(e.target.value) }))}
              className={inputClass}
            />
          </Field>
        </Section>

        {/* Gewichtszulagen */}
        <Section title="Gewichtszulagen (EUR/kg)">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Anzeigenblatt" hint="Standard: 0,05 €/kg">
              <input
                type="number"
                min="0"
                step="0.01"
                value={form.gewichtszulageAnzeigenblattEurKg}
                onChange={(e) => setForm((f) => ({ ...f, gewichtszulageAnzeigenblattEurKg: num(e.target.value) }))}
                className={inputClass}
              />
            </Field>
            <Field label="Beilagen" hint="Standard: 0,30 €/kg">
              <input
                type="number"
                min="0"
                step="0.01"
                value={form.gewichtszulageBeilagenEurKg}
                onChange={(e) => setForm((f) => ({ ...f, gewichtszulageBeilagenEurKg: num(e.target.value) }))}
                className={inputClass}
              />
            </Field>
          </div>
        </Section>

        {/* Fahrtkosten */}
        <Section title="Fahrtkosten">
          <Field label="Standardsatz (EUR/km)" hint="Standard: 0,30 €/km — kann je Mitarbeiter überschrieben werden">
            <input
              type="number"
              min="0"
              step="0.01"
              value={form.fahrkostenEurProKm}
              onChange={(e) => setForm((f) => ({ ...f, fahrkostenEurProKm: num(e.target.value) }))}
              className={inputClass}
            />
          </Field>
        </Section>

        {/* Ausgabe-Standardwerte */}
        <Section title="Ausgabe-Standardwerte">
          <div className="grid grid-cols-3 gap-4">
            <Field label="Grammatur (g/m²)" hint="Standard: 65">
              <input
                type="number"
                min="1"
                value={form.standardGrammurGqm}
                onChange={(e) => setForm((f) => ({ ...f, standardGrammurGqm: num(e.target.value) }))}
                className={inputClass}
              />
            </Field>
            <Field label="Seitenformat Breite (mm)" hint="Standard: 305">
              <input
                type="number"
                min="1"
                value={form.standardSeitenformatBreiteMm}
                onChange={(e) => setForm((f) => ({ ...f, standardSeitenformatBreiteMm: num(e.target.value) }))}
                className={inputClass}
              />
            </Field>
            <Field label="Seitenformat Höhe (mm)" hint="Standard: 215">
              <input
                type="number"
                min="1"
                value={form.standardSeitenformatHoeheMm}
                onChange={(e) => setForm((f) => ({ ...f, standardSeitenformatHoeheMm: num(e.target.value) }))}
                className={inputClass}
              />
            </Field>
          </div>
        </Section>

        {message && (
          <p className={`text-sm ${message.startsWith('✓') ? 'text-green-600' : 'text-red-600'}`}>
            {message}
          </p>
        )}

        <button
          type="submit"
          disabled={saving}
          className="bg-blue-600 text-white px-6 py-2.5 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          {saving ? 'Speichere...' : 'Parameter speichern'}
        </button>
      </form>

      {/* PINs ändern */}
      <div className="mt-8 border-t border-gray-200 pt-6 grid grid-cols-1 md:grid-cols-2 gap-8">
        {/* Admin-PIN */}
        <div>
          <h2 className="font-semibold text-gray-900 mb-4">Admin-PIN ändern</h2>
          {!parameter?.adminPinHash && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4 text-sm text-amber-700">
              ⚠ Noch kein Admin-PIN gesetzt.
            </div>
          )}
          <form onSubmit={handlePinAendern} className="space-y-3">
            <Field label="Neuer Admin-PIN (min. 4 Stellen)">
              <input
                type="password"
                inputMode="numeric"
                maxLength={8}
                value={neuerPin}
                onChange={(e) => setNeuerPin(e.target.value.replace(/\D/g, ''))}
                placeholder="••••"
                className={inputClass}
              />
            </Field>
            <Field label="PIN bestätigen">
              <input
                type="password"
                inputMode="numeric"
                maxLength={8}
                value={pinBestaetigung}
                onChange={(e) => setPinBestaetigung(e.target.value.replace(/\D/g, ''))}
                placeholder="••••"
                className={inputClass}
              />
            </Field>
            {pinMessage && (
              <p className={`text-sm ${pinMessage.startsWith('✓') ? 'text-green-600' : 'text-red-600'}`}>
                {pinMessage}
              </p>
            )}
            <button
              type="submit"
              disabled={pinSaving || neuerPin.length < 4}
              className="bg-gray-700 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-gray-800 disabled:opacity-50 transition-colors"
            >
              {pinSaving ? 'Speichere...' : 'Admin-PIN setzen'}
            </button>
          </form>
        </div>

        {/* Abrechnungs-PIN */}
        <AbrechnungPinSection inputClass={inputClass} />
      </div>
    </div>
  );
}

function AbrechnungPinSection({ inputClass }: { inputClass: string }) {
  const { parameter } = useApp();
  const [pin, setPin] = useState('');
  const [bestaetigung, setBestaetigung] = useState('');
  const [msg, setMsg] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (pin !== bestaetigung) { setMsg('PINs stimmen nicht überein.'); return; }
    setSaving(true);
    setMsg('');
    try {
      const hash = await hashPin(pin);
      await speichereParameter({ abrechnungPinHash: hash });
      setMsg('✓ Abrechnungs-PIN gesetzt.');
      setPin('');
      setBestaetigung('');
    } catch {
      setMsg('Fehler beim Speichern.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <h2 className="font-semibold text-gray-900 mb-1">Abrechnungs-PIN</h2>
      <p className="text-xs text-gray-500 mb-4">
        Zweiter PIN für die Rolle "Mitarbeiter Abrechnung": darf Ausgaben, Einsätze und Abrechnungsperioden verwalten.
        {parameter?.abrechnungPinHash ? ' ✓ Bereits gesetzt.' : ' Noch nicht gesetzt.'}
      </p>
      <form onSubmit={handleSubmit} className="space-y-3">
        <Field label="Neuer Abrechnungs-PIN (min. 4 Stellen)">
          <input
            type="password"
            inputMode="numeric"
            maxLength={8}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
            placeholder="••••"
            className={inputClass}
          />
        </Field>
        <Field label="PIN bestätigen">
          <input
            type="password"
            inputMode="numeric"
            maxLength={8}
            value={bestaetigung}
            onChange={(e) => setBestaetigung(e.target.value.replace(/\D/g, ''))}
            placeholder="••••"
            className={inputClass}
          />
        </Field>
        {msg && (
          <p className={`text-sm ${msg.startsWith('✓') ? 'text-green-600' : 'text-red-600'}`}>{msg}</p>
        )}
        <button
          type="submit"
          disabled={saving || pin.length < 4}
          className="bg-purple-600 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-purple-700 disabled:opacity-50 transition-colors"
        >
          {saving ? 'Speichere...' : 'Abrechnungs-PIN setzen'}
        </button>
      </form>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
      <h3 className="font-medium text-gray-800 mb-4 text-sm uppercase tracking-wide">{title}</h3>
      <div className="space-y-4">{children}</div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      {hint && <p className="text-xs text-gray-400 mb-1">{hint}</p>}
      {children}
    </div>
  );
}

const inputClass =
  'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';
