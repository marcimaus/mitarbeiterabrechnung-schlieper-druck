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
  zusammentragGeschwErste2StapelStkProH: 1700,
  zusammentragGeschwWeitereStapelStkProH: 3400,
  externeBeilageEinlegeGeschwStkProH: 442,
  stundenlohnErwachseneZusammen: 13.90,
  stundenlohnMinderjZusammen: 10.00,
  springerZuschlagProzent: 25,
  springerZuschlagOptionen: [25, 30],
  gewichtszulageAnzeigenblattEurKg: 0.05,
  gewichtszulageBeilagenEurKg: 0.30,
  standardGrammurGqm: 65,
  standardSeitenformatBreiteMm: 305,
  standardSeitenformatHoeheMm: 215,
  fahrkostenEurProKm: 0.30,
  minijobGrenzeEurProMonat: 556,
  gewichtToleranzObenProzent: 2,
  gewichtToleranzUntenProzent: 1,
  austragenNachIstZeit: false,
  zusammentragenNachIstZeit: false,
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
    zusammentragGeschwErste2StapelStkProH: STANDARD_PARAMETER.zusammentragGeschwErste2StapelStkProH,
    zusammentragGeschwWeitereStapelStkProH: STANDARD_PARAMETER.zusammentragGeschwWeitereStapelStkProH,
    externeBeilageEinlegeGeschwStkProH: STANDARD_PARAMETER.externeBeilageEinlegeGeschwStkProH,
    stundenlohnErwachseneZusammen: STANDARD_PARAMETER.stundenlohnErwachseneZusammen,
    stundenlohnMinderjZusammen: STANDARD_PARAMETER.stundenlohnMinderjZusammen,
    springerZuschlagProzent: STANDARD_PARAMETER.springerZuschlagProzent,
    springerZuschlagOptionen: [25, 30] as number[],
    gewichtszulageAnzeigenblattEurKg: STANDARD_PARAMETER.gewichtszulageAnzeigenblattEurKg,
    gewichtszulageBeilagenEurKg: STANDARD_PARAMETER.gewichtszulageBeilagenEurKg,
    standardGrammurGqm: STANDARD_PARAMETER.standardGrammurGqm,
    standardSeitenformatBreiteMm: STANDARD_PARAMETER.standardSeitenformatBreiteMm,
    standardSeitenformatHoeheMm: STANDARD_PARAMETER.standardSeitenformatHoeheMm,
    fahrkostenEurProKm: STANDARD_PARAMETER.fahrkostenEurProKm,
    minijobGrenzeEurProMonat: STANDARD_PARAMETER.minijobGrenzeEurProMonat,
    gewichtToleranzObenProzent: STANDARD_PARAMETER.gewichtToleranzObenProzent,
    gewichtToleranzUntenProzent: STANDARD_PARAMETER.gewichtToleranzUntenProzent,
    austragenNachIstZeit: false,
    zusammentragenNachIstZeit: false,
    bonusZeiterfassungEur: 0,
    adminName: adminName || '',
  });
  const [neueOption, setNeueOption] = useState('');

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
        zusammentragGeschwErste2StapelStkProH:
          parameter.zusammentragGeschwErste2StapelStkProH ?? STANDARD_PARAMETER.zusammentragGeschwErste2StapelStkProH,
        zusammentragGeschwWeitereStapelStkProH:
          parameter.zusammentragGeschwWeitereStapelStkProH ?? STANDARD_PARAMETER.zusammentragGeschwWeitereStapelStkProH,
        externeBeilageEinlegeGeschwStkProH:
          parameter.externeBeilageEinlegeGeschwStkProH ?? STANDARD_PARAMETER.externeBeilageEinlegeGeschwStkProH,
        stundenlohnErwachseneZusammen:
          parameter.stundenlohnErwachseneZusammen ?? STANDARD_PARAMETER.stundenlohnErwachseneZusammen,
        stundenlohnMinderjZusammen:
          parameter.stundenlohnMinderjZusammen ?? STANDARD_PARAMETER.stundenlohnMinderjZusammen,
        springerZuschlagProzent: parameter.springerZuschlagProzent,
        springerZuschlagOptionen: parameter.springerZuschlagOptionen ?? [25, 30],
        gewichtszulageAnzeigenblattEurKg: parameter.gewichtszulageAnzeigenblattEurKg,
        gewichtszulageBeilagenEurKg: parameter.gewichtszulageBeilagenEurKg,
        standardGrammurGqm: parameter.standardGrammurGqm,
        standardSeitenformatBreiteMm: parameter.standardSeitenformatBreiteMm,
        standardSeitenformatHoeheMm: parameter.standardSeitenformatHoeheMm,
        fahrkostenEurProKm: parameter.fahrkostenEurProKm ?? 0.30,
        minijobGrenzeEurProMonat: parameter.minijobGrenzeEurProMonat ?? 556,
        gewichtToleranzObenProzent: parameter.gewichtToleranzObenProzent ?? 2,
        gewichtToleranzUntenProzent: parameter.gewichtToleranzUntenProzent ?? 1,
        austragenNachIstZeit: parameter.austragenNachIstZeit ?? false,
        zusammentragenNachIstZeit: parameter.zusammentragenNachIstZeit ?? false,
        bonusZeiterfassungEur: parameter.bonusZeiterfassungEur ?? 0,
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
          <Field label="Standard-Zuschlag (%)" hint="Wird als Standardvorgabe verwendet wenn kein individueller Wert gewählt wird">
            <input
              type="number"
              min="0"
              max="200"
              value={form.springerZuschlagProzent}
              onChange={(e) => setForm((f) => ({ ...f, springerZuschlagProzent: num(e.target.value) }))}
              className={inputClass}
            />
          </Field>
          <Field label="Auswählbare Zuschläge" hint="Diese Werte können je Einsatz direkt ausgewählt werden">
            <div className="flex flex-wrap gap-2 mb-2">
              {[...form.springerZuschlagOptionen].sort((a, b) => a - b).map((opt) => (
                <span
                  key={opt}
                  className="inline-flex items-center gap-1 bg-blue-100 text-blue-700 text-sm px-2.5 py-1 rounded-full"
                >
                  {opt} %
                  <button
                    type="button"
                    onClick={() => setForm((f) => ({
                      ...f,
                      springerZuschlagOptionen: f.springerZuschlagOptionen.filter((o) => o !== opt),
                    }))}
                    className="text-blue-400 hover:text-blue-700 ml-0.5"
                  >
                    ✕
                  </button>
                </span>
              ))}
              {form.springerZuschlagOptionen.length === 0 && (
                <span className="text-xs text-gray-400">Keine Optionen konfiguriert</span>
              )}
            </div>
            <div className="flex gap-2">
              <input
                type="number"
                min="1"
                max="200"
                value={neueOption}
                onChange={(e) => setNeueOption(e.target.value)}
                placeholder="z.B. 30"
                className="border border-gray-300 rounded px-2 py-1.5 text-sm w-24 focus:outline-none focus:ring-1 focus:ring-blue-500"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    const v = parseInt(neueOption);
                    if (v > 0 && !form.springerZuschlagOptionen.includes(v)) {
                      setForm((f) => ({ ...f, springerZuschlagOptionen: [...f.springerZuschlagOptionen, v] }));
                    }
                    setNeueOption('');
                  }
                }}
              />
              <button
                type="button"
                onClick={() => {
                  const v = parseInt(neueOption);
                  if (v > 0 && !form.springerZuschlagOptionen.includes(v)) {
                    setForm((f) => ({ ...f, springerZuschlagOptionen: [...f.springerZuschlagOptionen, v] }));
                  }
                  setNeueOption('');
                }}
                className="text-sm text-blue-600 hover:text-blue-800 px-2 py-1.5 rounded border border-blue-300 hover:border-blue-500"
              >
                + Hinzufügen
              </button>
            </div>
          </Field>
        </Section>

        {/* Zusammentragen & externe Beilagen */}
        <Section title="Zusammentragen & externe Beilagen">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Geschwindigkeit erste 2 Anzeigenblatt-Stapel (Stk/h)" hint="Standard: 1700">
              <input
                type="number"
                min="1"
                value={form.zusammentragGeschwErste2StapelStkProH}
                onChange={(e) => setForm((f) => ({ ...f, zusammentragGeschwErste2StapelStkProH: num(e.target.value) }))}
                className={inputClass}
              />
            </Field>
            <Field label="Geschwindigkeit weitere Stapel + Beilagen (Stk/h)" hint="Standard: 4300">
              <input
                type="number"
                min="1"
                value={form.zusammentragGeschwWeitereStapelStkProH}
                onChange={(e) => setForm((f) => ({ ...f, zusammentragGeschwWeitereStapelStkProH: num(e.target.value) }))}
                className={inputClass}
              />
            </Field>
          </div>
          <Field
            label="Geschwindigkeit Einlegen externer Beilagen (Stk/h)"
            hint="Je externer Beilage — Austräger/Springer legt die Beilage selbst in das bereits zusammengetragene Anzeigenblatt ein. Standard: 442"
          >
            <input
              type="number"
              min="1"
              value={form.externeBeilageEinlegeGeschwStkProH}
              onChange={(e) => setForm((f) => ({ ...f, externeBeilageEinlegeGeschwStkProH: num(e.target.value) }))}
              className={inputClass}
            />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Stundenlohn Zusammenträger erwachsen (EUR/h)" hint="Standard: 13,90 €">
              <input
                type="number"
                min="0"
                step="0.01"
                value={form.stundenlohnErwachseneZusammen}
                onChange={(e) => setForm((f) => ({ ...f, stundenlohnErwachseneZusammen: num(e.target.value) }))}
                className={inputClass}
              />
            </Field>
            <Field label="Stundenlohn Zusammenträger minderjährig (EUR/h)" hint="Standard: 10,00 €">
              <input
                type="number"
                min="0"
                step="0.01"
                value={form.stundenlohnMinderjZusammen}
                onChange={(e) => setForm((f) => ({ ...f, stundenlohnMinderjZusammen: num(e.target.value) }))}
                className={inputClass}
              />
            </Field>
          </div>
          <p className="text-xs text-gray-400 mt-2">
            Die Abrechnung erfolgt nach errechneter Soll-Zeit (Stückzahl / Geschwindigkeit), nicht nach Ist-Zeit aus der Stempeluhr.
            Die Stundenlöhne werden je nach Alter automatisch gewählt (≥ 18 Jahre = erwachsen).
          </p>
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

        {/* Minijob-Grenze */}
        <Section title="Minijob-Grenze">
          <Field
            label="Minijob-Grenze (EUR/Monat)"
            hint="Aktuell gültige Monatsgrenze für geringfügig Beschäftigte (seit 2025: 556 €). Bei als 'Minijob' markierten Mitarbeitern erscheint in der Abrechnung eine Warnung, wenn der Bruttolohn diese Grenze überschreitet."
          >
            <input
              type="number"
              min="0"
              step="0.01"
              value={form.minijobGrenzeEurProMonat}
              onChange={(e) => setForm((f) => ({ ...f, minijobGrenzeEurProMonat: num(e.target.value) }))}
              className={inputClass}
            />
          </Field>
        </Section>

        {/* Gewichtskontrolle */}
        <Section title="Gewichtskontrolle Zusammentragen">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Toleranz nach oben (%)" hint="Standard: 2 — max. zulässige Überschreitung des Soll-Gewichts">
              <input
                type="number"
                min="0"
                step="0.1"
                value={form.gewichtToleranzObenProzent}
                onChange={(e) => setForm((f) => ({ ...f, gewichtToleranzObenProzent: num(e.target.value) }))}
                className={inputClass}
              />
            </Field>
            <Field label="Toleranz nach unten (%)" hint="Standard: 1 — max. zulässige Unterschreitung des Soll-Gewichts">
              <input
                type="number"
                min="0"
                step="0.1"
                value={form.gewichtToleranzUntenProzent}
                onChange={(e) => setForm((f) => ({ ...f, gewichtToleranzUntenProzent: num(e.target.value) }))}
                className={inputClass}
              />
            </Field>
          </div>
        </Section>

        {/* Abrechnungsmodus */}
        <Section title="Abrechnungsmodus">
          <label className="flex items-start gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={form.austragenNachIstZeit}
              onChange={(e) => setForm((f) => ({ ...f, austragenNachIstZeit: e.target.checked }))}
              className="mt-0.5 rounded"
            />
            <span>
              <span className="font-medium">Austragen: Abrechnung nach Ist-Zeit (Zeiterfassung) statt Plan-Zeit (Parameter)</span>
              <p className="text-xs text-gray-400 mt-0.5">
                Wenn aktiviert, werden erfasste Stempeluhr-Zeiten (Typ "Austragen") zur Austragen-Abrechnung verwendet.
                Standard ist die Plan-Zeit aus den Teilgebiets-Parametern.
              </p>
            </span>
          </label>
          <label className="flex items-start gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={form.zusammentragenNachIstZeit}
              onChange={(e) => setForm((f) => ({ ...f, zusammentragenNachIstZeit: e.target.checked }))}
              className="mt-0.5 rounded"
            />
            <span>
              <span className="font-medium">Zusammentragen: Abrechnung nach Ist-Zeit (Zeiterfassung) statt Plan-Zeit (Stapel + Vorarbeit)</span>
              <p className="text-xs text-gray-400 mt-0.5">
                Wenn aktiviert, werden erfasste Stempeluhr-Zeiten (Typ "Zusammentragen") zur Zusammentragen-Abrechnung verwendet.
              </p>
            </span>
          </label>
        </Section>

        {/* Bonus Zeiterfassung Austragen */}
        <Section title="Bonus Zeiterfassung Austragen">
          <p className="text-xs text-gray-500 -mt-1">
            Pauschaler Bonus in EUR je vollständig online erfasstem Einsatz
            (Austragen). Nur Austräger erhalten ihn — je Teilgebiet und Ausgabe
            einmalig. Bedingung: Arbeitszeit (von/bis) UND Restmenge sind über
            den QR-Code-Lieferschein eingegeben und die Meldung wurde vor
            Periodenabschluss eingereicht. 0 = deaktiviert.
          </p>
          <div className="grid grid-cols-3 gap-4">
            <Field label="Bonus je Einsatz (EUR)" hint="z. B. 0,50">
              <input
                type="number"
                min="0"
                step="0.01"
                value={form.bonusZeiterfassungEur}
                onChange={(e) => setForm((f) => ({ ...f, bonusZeiterfassungEur: num(e.target.value) }))}
                className={inputClass}
              />
            </Field>
          </div>
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

      {/* Historischer Snapshot-Viewer */}
      <div className="mt-8 border-t border-gray-200 pt-6">
        <SnapshotViewer />
      </div>

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

// ---- Snapshot-Viewer: Parameter abgeschlossener Perioden -----
//
// Zeigt schreibgeschützt die Parameter, die bei einer abgeschlossenen
// Abrechnungsperiode festgeschrieben wurden (paramSnapshot). Damit lässt
// sich nachvollziehen, mit welchen Werten ein Monat tatsächlich gerechnet
// wurde — auch wenn die aktuellen Parameter inzwischen geändert wurden.

interface ParamFeld {
  key: keyof Parameter;
  label: string;
  einheit?: string;
  istBoolean?: boolean;
}

const SNAPSHOT_FELDER: ParamFeld[] = [
  { key: 'laufgeschwindigkeitMProH', label: 'Laufgeschwindigkeit', einheit: 'm/h' },
  { key: 'steckzeitStkProH', label: 'Steckzeit', einheit: 'Stk/h' },
  { key: 'stundenlohnErwachseneAustr', label: 'Stundenlohn Austragen (Erwachsene)', einheit: '€/h' },
  { key: 'stundenlohnMinderjAustr', label: 'Stundenlohn Austragen (Minderjährige)', einheit: '€/h' },
  { key: 'mindeststundenlohn', label: 'Mindeststundenlohn', einheit: '€/h' },
  { key: 'zusammentragGeschwErste2StapelStkProH', label: 'Zusammentragen Geschw. (1.–2. Stapel)', einheit: 'Stk/h' },
  { key: 'zusammentragGeschwWeitereStapelStkProH', label: 'Zusammentragen Geschw. (weitere Stapel + Beilagen)', einheit: 'Stk/h' },
  { key: 'externeBeilageEinlegeGeschwStkProH', label: 'Geschw. externe Beilagen einlegen (Austräger)', einheit: 'Stk/h' },
  { key: 'stundenlohnErwachseneZusammen', label: 'Stundenlohn Zusammentragen (Erwachsene)', einheit: '€/h' },
  { key: 'stundenlohnMinderjZusammen', label: 'Stundenlohn Zusammentragen (Minderjährige)', einheit: '€/h' },
  { key: 'springerZuschlagProzent', label: 'Springer-Zuschlag (Standard)', einheit: '%' },
  { key: 'gewichtszulageAnzeigenblattEurKg', label: 'Gewichtszulage Anzeigenblatt', einheit: '€/kg' },
  { key: 'gewichtszulageBeilagenEurKg', label: 'Gewichtszulage Beilagen', einheit: '€/kg' },
  { key: 'standardGrammurGqm', label: 'Standard Grammatur', einheit: 'g/m²' },
  { key: 'standardSeitenformatBreiteMm', label: 'Standard Seitenbreite', einheit: 'mm' },
  { key: 'standardSeitenformatHoeheMm', label: 'Standard Seitenhöhe', einheit: 'mm' },
  { key: 'fahrkostenEurProKm', label: 'Fahrkostensatz', einheit: '€/km' },
  { key: 'minijobGrenzeEurProMonat', label: 'Minijob-Grenze', einheit: '€/Monat' },
  { key: 'gewichtToleranzObenProzent', label: 'Gewichtstoleranz oben', einheit: '%' },
  { key: 'gewichtToleranzUntenProzent', label: 'Gewichtstoleranz unten', einheit: '%' },
  { key: 'austragenNachIstZeit', label: 'Austragen nach Ist-Zeit', istBoolean: true },
  { key: 'zusammentragenNachIstZeit', label: 'Zusammentragen nach Ist-Zeit', istBoolean: true },
];

function SnapshotViewer() {
  const { abrechnungsperioden, parameter } = useApp();
  const [selectedId, setSelectedId] = useState('');

  // Nur Perioden mit gespeichertem Snapshot anzeigen.
  const verfuegbarePerioden = [...abrechnungsperioden]
    .filter((p) => !!p.paramSnapshot)
    .sort((a, b) => (b.jahr !== a.jahr ? b.jahr - a.jahr : b.monat - a.monat));

  const ausgewaehlt = verfuegbarePerioden.find((p) => p.id === selectedId);
  const snap = ausgewaehlt?.paramSnapshot;

  function formatWert(wert: unknown, feld: ParamFeld): string {
    if (wert === undefined || wert === null) return '—';
    if (feld.istBoolean) return wert ? 'Ja' : 'Nein';
    if (typeof wert === 'number') {
      const fmt = wert.toLocaleString('de-DE', {
        minimumFractionDigits: Number.isInteger(wert) ? 0 : 2,
        maximumFractionDigits: 2,
      });
      return feld.einheit ? `${fmt} ${feld.einheit}` : fmt;
    }
    return String(wert);
  }

  return (
    <div>
      <h2 className="font-semibold text-gray-900 mb-2">📚 Historische Parameter</h2>
      <p className="text-xs text-gray-500 mb-4">
        Zeigt die Parameter, die beim Abschluss einer Abrechnungsperiode festgeschrieben
        wurden. Schreibgeschützt — dient nur der Nachvollziehbarkeit.
      </p>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Abgeschlossene Periode wählen
          </label>
          <select
            value={selectedId}
            onChange={(e) => setSelectedId(e.target.value)}
            className={inputClass}
          >
            <option value="">— Periode auswählen —</option>
            {verfuegbarePerioden.map((p) => (
              <option key={p.id} value={p.id}>
                {p.bezeichnung}
                {p.status === 'abgeschlossen' ? ' (abgeschlossen)' : ' (offen, alter Snapshot)'}
                {p.gesperrtAm
                  ? ` — gesperrt am ${new Date(p.gesperrtAm).toLocaleDateString('de-DE')}`
                  : ''}
              </option>
            ))}
          </select>
          {verfuegbarePerioden.length === 0 && (
            <p className="text-xs text-gray-400 mt-2">
              Keine Periode mit gespeichertem Parameter-Snapshot vorhanden. Snapshots
              werden beim Abschließen einer Periode erstellt.
            </p>
          )}
        </div>

        {snap && parameter && (
          <div className="overflow-hidden rounded-lg border border-gray-200">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200 text-gray-600">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Parameter</th>
                  <th className="px-3 py-2 text-right font-medium">
                    Wert in Periode<br />
                    <span className="text-[10px] font-normal text-gray-500">
                      ({ausgewaehlt?.bezeichnung})
                    </span>
                  </th>
                  <th className="px-3 py-2 text-right font-medium">
                    Aktueller Wert
                  </th>
                  <th className="px-3 py-2 text-center font-medium w-12">∆</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {SNAPSHOT_FELDER.map((feld) => {
                  const snapWert = (snap as Partial<Parameter>)[feld.key];
                  const aktWert = (parameter as Parameter)[feld.key];
                  const abweichung =
                    snapWert !== undefined && aktWert !== undefined && snapWert !== aktWert;
                  return (
                    <tr key={feld.key} className={abweichung ? 'bg-amber-50' : ''}>
                      <td className="px-3 py-2 text-gray-700">{feld.label}</td>
                      <td className="px-3 py-2 text-right font-medium text-gray-900">
                        {formatWert(snapWert, feld)}
                      </td>
                      <td className="px-3 py-2 text-right text-gray-600">
                        {formatWert(aktWert, feld)}
                      </td>
                      <td className="px-3 py-2 text-center">
                        {abweichung ? (
                          <span title="Wert hat sich seit Periodenabschluss geändert" className="text-amber-700">
                            ≠
                          </span>
                        ) : snapWert !== undefined ? (
                          <span className="text-gray-300">=</span>
                        ) : (
                          <span className="text-gray-300">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
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
