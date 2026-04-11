import { useState, useEffect, type FormEvent } from 'react';
import { useApp } from '../context/AppContext';
import AdminPinGate from '../components/AdminPinGate';
import Modal from '../components/Modal';
import {
  ladeAusgaben,
  erstelleAusgabe,
  aktualisiereAusgabe,
  ladeBeilagen,
  erstelleBeilage,
  aktualisiereBeilage,
  loescheBeilage,
} from '../lib/db';
import { berechneStapel } from '../lib/berechnung';
import {
  getCurrentKW,
  alleKWsImJahr,
  kwLabel,
  formatDonnerstag,
  maxKWinJahr,
} from '../lib/kalender';
import type { Ausgabe, Beilage, BeilagenFormat, BeilagenKennzeichen, AusgabeStatus } from '../types';

const SEITENZAHLEN = [8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32];
const BEILAGEN_FORMATE: { value: BeilagenFormat; label: string }[] = [
  { value: 'A4', label: 'DIN A4' },
  { value: 'A5', label: 'DIN A5' },
  { value: 'kleinerA5', label: 'Kleiner als A5' },
];

export default function AusgabenScreen() {
  return (
    <AdminPinGate>
      <AusgabenInhalt />
    </AdminPinGate>
  );
}

function AusgabenInhalt() {
  const [tab, setTab] = useState<'ausgaben' | 'perioden'>('ausgaben');

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Ausgabenplanung</h1>
        <div className="flex rounded-lg border border-gray-300 overflow-hidden text-sm">
          <button
            onClick={() => setTab('ausgaben')}
            className={`px-4 py-2 ${tab === 'ausgaben' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
          >
            📄 Ausgaben
          </button>
          <button
            onClick={() => setTab('perioden')}
            className={`px-4 py-2 border-l border-gray-300 ${tab === 'perioden' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
          >
            📅 Abrechnungsperioden
          </button>
        </div>
      </div>

      {tab === 'ausgaben' ? <AusgabenListe /> : <AbrechnungsperiodenInhalt />}
    </div>
  );
}

// ============================================================
// AUSGABEN
// ============================================================

function AusgabenListe() {
  const { parameter } = useApp();
  const [ausgaben, setAusgaben] = useState<Ausgabe[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Ausgabe | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editTarget, setEditTarget] = useState<Ausgabe | null>(null);
  const [filterJahr, setFilterJahr] = useState(new Date().getFullYear());

  useEffect(() => {
    ladeAusgaben().then((list) => {
      setAusgaben(list);
      setLoading(false);
      if (list.length > 0) setSelected(list[0]);
    });
  }, []);

  const gefilterteAusgaben = ausgaben.filter((a) => a.jahr === filterJahr);
  const jahre = [...new Set(ausgaben.map((a) => a.jahr))].sort((a, b) => b - a);

  async function handleSave(neu: Ausgabe) {
    setAusgaben((prev) => {
      const idx = prev.findIndex((a) => a.id === neu.id);
      if (idx >= 0) {
        const updated = [...prev];
        updated[idx] = neu;
        return updated.sort((a, b) => b.jahr - a.jahr || b.kw - a.kw);
      }
      return [neu, ...prev].sort((a, b) => b.jahr - a.jahr || b.kw - a.kw);
    });
    setSelected(neu);
    setShowForm(false);
  }

  const statusBadge = (status: AusgabeStatus) => {
    const map = {
      geplant: 'bg-gray-100 text-gray-600',
      laufend: 'bg-blue-100 text-blue-700',
      abgeschlossen: 'bg-green-100 text-green-700',
    };
    const labels = { geplant: 'Geplant', laufend: 'Laufend', abgeschlossen: 'Abgeschlossen' };
    return <span className={`text-xs px-2 py-0.5 rounded-full ${map[status]}`}>{labels[status]}</span>;
  };

  return (
    <div className="flex gap-6">
      {/* Liste links */}
      <div className="w-64 shrink-0">
        <div className="flex items-center justify-between mb-2">
          <select
            value={filterJahr}
            onChange={(e) => setFilterJahr(Number(e.target.value))}
            className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {jahre.length === 0 && <option value={new Date().getFullYear()}>{new Date().getFullYear()}</option>}
            {jahre.map((j) => <option key={j} value={j}>{j}</option>)}
          </select>
          <button
            onClick={() => { setEditTarget(null); setShowForm(true); }}
            className="bg-blue-600 text-white px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-blue-700"
          >
            + Neu
          </button>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          {loading && <div className="p-4 text-center text-gray-400 text-sm">Lädt...</div>}
          {!loading && gefilterteAusgaben.length === 0 && (
            <div className="p-4 text-center text-gray-400 text-sm">Keine Ausgaben für {filterJahr}</div>
          )}
          {gefilterteAusgaben.map((a) => (
            <button
              key={a.id}
              onClick={() => setSelected(a)}
              className={`w-full text-left px-4 py-3 border-b border-gray-100 last:border-0 transition-colors ${
                selected?.id === a.id ? 'bg-blue-50' : 'hover:bg-gray-50'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className={`font-medium text-sm ${selected?.id === a.id ? 'text-blue-700' : 'text-gray-800'}`}>
                  {kwLabel(a.kw, a.jahr)}
                </span>
                {statusBadge(a.status)}
              </div>
              <div className="text-xs text-gray-400 mt-0.5">{formatDonnerstag(a.kw, a.jahr)}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Detail rechts */}
      <div className="flex-1">
        {selected ? (
          <AusgabeDetail
            ausgabe={selected}
            onEdit={() => { setEditTarget(selected); setShowForm(true); }}
            onStatusChange={async (status) => {
              await aktualisiereAusgabe(selected.id, { status });
              const aktualisiert = { ...selected, status };
              setSelected(aktualisiert);
              handleSave(aktualisiert);
            }}
          />
        ) : (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 text-center text-gray-400">
            Ausgabe links auswählen oder neu anlegen
          </div>
        )}
      </div>

      <Modal
        isOpen={showForm}
        onClose={() => setShowForm(false)}
        title={editTarget ? 'Ausgabe bearbeiten' : 'Neue Ausgabe'}
        size="md"
      >
        <AusgabeForm
          initial={editTarget}
          parameter={parameter}
          vorhandeneKWs={ausgaben.map((a) => ({ kw: a.kw, jahr: a.jahr }))}
          onSave={handleSave}
          onCancel={() => setShowForm(false)}
        />
      </Modal>
    </div>
  );
}

// ---- Ausgabe Detail ----------------------------------------

function AusgabeDetail({
  ausgabe,
  onEdit,
  onStatusChange,
}: {
  ausgabe: Ausgabe;
  onEdit: () => void;
  onStatusChange: (s: AusgabeStatus) => void;
}) {
  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-bold text-gray-900">{kwLabel(ausgabe.kw, ausgabe.jahr)}</h2>
            <p className="text-sm text-gray-500">Erscheint: {formatDonnerstag(ausgabe.kw, ausgabe.jahr)}</p>
          </div>
          <button onClick={onEdit} className="text-sm text-blue-600 hover:text-blue-800">Bearbeiten</button>
        </div>

        <div className="grid grid-cols-3 gap-4 mt-4">
          <InfoBox label="Seitenzahl" value={`${ausgabe.seitenzahl} Seiten`} />
          <InfoBox label="Stapel" value={ausgabe.stapel.join(' + ')} hint="Bogen-Zusammensetzung" />
          <InfoBox label="Grammatur" value={`${ausgabe.grammaturGqm} g/m²`} />
        </div>

        <div className="mt-4 flex items-center gap-3">
          <span className="text-sm text-gray-600">Status:</span>
          {(['geplant', 'laufend', 'abgeschlossen'] as AusgabeStatus[]).map((s) => (
            <button
              key={s}
              onClick={() => onStatusChange(s)}
              className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                ausgabe.status === s
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white text-gray-600 border-gray-300 hover:border-blue-400'
              }`}
            >
              {s === 'geplant' ? 'Geplant' : s === 'laufend' ? 'Laufend' : 'Abgeschlossen'}
            </button>
          ))}
        </div>
      </div>

      {/* Beilagen */}
      <BeilagenVerwaltung ausgabe={ausgabe} />
    </div>
  );
}

function InfoBox({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="bg-gray-50 rounded-lg p-3">
      <div className="text-xs text-gray-500 mb-1">{label}</div>
      <div className="font-semibold text-gray-800 text-sm">{value}</div>
      {hint && <div className="text-xs text-gray-400 mt-0.5">{hint}</div>}
    </div>
  );
}

// ---- Ausgabe Formular --------------------------------------

function AusgabeForm({
  initial,
  parameter,
  vorhandeneKWs,
  onSave,
  onCancel,
}: {
  initial: Ausgabe | null;
  parameter: ReturnType<typeof useApp>['parameter'];
  vorhandeneKWs: { kw: number; jahr: number }[];
  onSave: (a: Ausgabe) => void;
  onCancel: () => void;
}) {
  const aktuelleKW = getCurrentKW();
  const [kw, setKw] = useState(initial?.kw ?? aktuelleKW.kw);
  const [jahr, setJahr] = useState(initial?.jahr ?? aktuelleKW.jahr);
  const [seitenzahl, setSeitenzahl] = useState(initial?.seitenzahl ?? 16);
  const [grammatur, setGrammatur] = useState(
    initial?.grammaturGqm ?? parameter?.standardGrammurGqm ?? 65
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const stapelVorschau = berechneStapel(seitenzahl);
  const maxKW = maxKWinJahr(jahr);

  const kwBereitsVorhanden = vorhandeneKWs.some(
    (v) => v.kw === kw && v.jahr === jahr && v.kw !== initial?.kw
  );

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (kwBereitsVorhanden) { setError(`KW ${kw}/${jahr} ist bereits angelegt.`); return; }
    setSaving(true);
    setError('');
    try {
      if (initial) {
        await aktualisiereAusgabe(initial.id, {
          kw, jahr, seitenzahl, grammaturGqm: grammatur,
          seitenformatMm: initial.seitenformatMm,
        });
        onSave({ ...initial, kw, jahr, seitenzahl, stapel: berechneStapel(seitenzahl), grammaturGqm: grammatur });
      } else {
        const id = await erstelleAusgabe({
          kw, jahr, seitenzahl, grammaturGqm: grammatur,
          seitenformatMm: {
            breite: parameter?.standardSeitenformatBreiteMm ?? 305,
            hoehe: parameter?.standardSeitenformatHoeheMm ?? 215,
          },
          status: 'geplant',
        });
        onSave({
          id, kw, jahr, seitenzahl, stapel: berechneStapel(seitenzahl),
          grammaturGqm: grammatur,
          seitenformatMm: {
            breite: parameter?.standardSeitenformatBreiteMm ?? 305,
            hoehe: parameter?.standardSeitenformatHoeheMm ?? 215,
          },
          status: 'geplant',
          erstelltAm: Date.now(),
          aktualisiertAm: Date.now(),
        });
      }
    } catch (err) {
      setError('Fehler beim Speichern.');
      console.error(err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Kalenderwoche</label>
          <input
            type="number"
            min={1}
            max={maxKW}
            value={kw}
            onChange={(e) => setKw(Number(e.target.value))}
            className={inputClass}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Jahr</label>
          <input
            type="number"
            min={2020}
            max={2099}
            value={jahr}
            onChange={(e) => setJahr(Number(e.target.value))}
            className={inputClass}
          />
        </div>
      </div>

      {kwBereitsVorhanden && (
        <p className="text-amber-600 text-sm">⚠ KW {kw}/{jahr} ist bereits angelegt.</p>
      )}

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Erscheinungsdatum</label>
        <p className="text-sm text-gray-500 bg-gray-50 rounded-lg px-3 py-2">
          Donnerstag, {formatDonnerstag(kw, jahr)}
        </p>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Seitenzahl</label>
        <select
          value={seitenzahl}
          onChange={(e) => setSeitenzahl(Number(e.target.value))}
          className={inputClass}
        >
          {SEITENZAHLEN.map((s) => (
            <option key={s} value={s}>{s} Seiten</option>
          ))}
        </select>
        <p className="text-xs text-gray-400 mt-1">
          Stapel: {stapelVorschau.map((s) => `${s}-Seiten-Bogen`).join(' + ')}
        </p>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Grammatur (g/m²)</label>
        <input
          type="number"
          min={30}
          max={200}
          value={grammatur}
          onChange={(e) => setGrammatur(Number(e.target.value))}
          className={inputClass}
        />
      </div>

      {error && <p className="text-red-600 text-sm">{error}</p>}

      <div className="flex justify-end gap-3 pt-2">
        <button type="button" onClick={onCancel} className="px-4 py-2 text-sm text-gray-600">Abbrechen</button>
        <button
          type="submit"
          disabled={saving || kwBereitsVorhanden}
          className="bg-blue-600 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          {saving ? 'Speichere...' : initial ? 'Speichern' : 'Anlegen'}
        </button>
      </div>
    </form>
  );
}

// ============================================================
// BEILAGEN
// ============================================================

function BeilagenVerwaltung({ ausgabe }: { ausgabe: Ausgabe }) {
  const { teilgebiete } = useApp();
  const [beilagen, setBeilagen] = useState<Beilage[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editTarget, setEditTarget] = useState<Beilage | null>(null);

  useEffect(() => {
    setLoading(true);
    ladeBeilagen(ausgabe.id).then((list) => {
      setBeilagen(list);
      setLoading(false);
    });
  }, [ausgabe.id]);

  async function handleLoeschen(id: string) {
    if (!confirm('Beilage wirklich löschen?')) return;
    await loescheBeilage(id);
    setBeilagen((prev) => prev.filter((b) => b.id !== id));
  }

  const gesamtgewichtKg = (b: Beilage) => {
    const anzahl = b.teilgebietIds.reduce((sum, tgId) => {
      const tg = teilgebiete.find((t) => t.id === tgId);
      return sum + (tg?.stueckzahl ?? 0);
    }, 0);
    return ((b.gewichtGStk * anzahl) / 1000).toFixed(2);
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-gray-800">
          Beilagen <span className="text-gray-400 font-normal text-sm">({beilagen.length})</span>
        </h3>
        <button
          onClick={() => { setEditTarget(null); setShowForm(true); }}
          className="bg-blue-600 text-white px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-blue-700"
        >
          + Beilage hinzufügen
        </button>
      </div>

      {loading && <div className="text-gray-400 text-sm">Lädt...</div>}

      {!loading && beilagen.length === 0 && (
        <p className="text-gray-400 text-sm">Keine Beilagen für diese Ausgabe.</p>
      )}

      <div className="space-y-2">
        {beilagen.map((b) => (
          <div key={b.id} className="border border-gray-200 rounded-lg p-3">
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-medium text-sm text-gray-800">{b.arbeitstitel}</span>
                  <span className={`text-xs px-1.5 py-0.5 rounded ${
                    b.kennzeichen === 'int' ? 'bg-purple-100 text-purple-700' : 'bg-orange-100 text-orange-700'
                  }`}>
                    {b.kennzeichen === 'int' ? 'intern' : 'extern'}
                  </span>
                  <span className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">{b.format}</span>
                </div>
                <div className="text-xs text-gray-500">
                  Kunde: {b.kundenname} · {b.gewichtGStk} g/Stk · {b.teilgebietIds.length} Gebiete · ~{gesamtgewichtKg(b)} kg gesamt
                </div>
              </div>
              <div className="flex gap-2 ml-3">
                <button
                  onClick={() => { setEditTarget(b); setShowForm(true); }}
                  className="text-xs text-blue-600 hover:text-blue-800"
                >
                  Bearbeiten
                </button>
                <button
                  onClick={() => handleLoeschen(b.id)}
                  className="text-xs text-red-500 hover:text-red-700"
                >
                  Löschen
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      <Modal
        isOpen={showForm}
        onClose={() => setShowForm(false)}
        title={editTarget ? 'Beilage bearbeiten' : 'Neue Beilage'}
        size="lg"
      >
        <BeilageForm
          initial={editTarget}
          ausgabeId={ausgabe.id}
          onSave={(b) => {
            setBeilagen((prev) => {
              const idx = prev.findIndex((x) => x.id === b.id);
              if (idx >= 0) { const u = [...prev]; u[idx] = b; return u; }
              return [...prev, b];
            });
            setShowForm(false);
          }}
          onCancel={() => setShowForm(false)}
        />
      </Modal>
    </div>
  );
}

// ---- Beilage Formular --------------------------------------

function BeilageForm({
  initial,
  ausgabeId,
  onSave,
  onCancel,
}: {
  initial: Beilage | null;
  ausgabeId: string;
  onSave: (b: Beilage) => void;
  onCancel: () => void;
}) {
  const { teilgebiete, touren } = useApp();
  const [arbeitstitel, setArbeitstitel] = useState(initial?.arbeitstitel ?? '');
  const [kundenname, setKundenname] = useState(initial?.kundenname ?? '');
  const [gewicht, setGewicht] = useState(initial?.gewichtGStk ?? 0);
  const [format, setFormat] = useState<BeilagenFormat>(initial?.format ?? 'A4');
  const [kennzeichen, setKennzeichen] = useState<BeilagenKennzeichen>(initial?.kennzeichen ?? 'int');
  const [ausgewaehlteTeilgebiete, setAusgewaehlteTeilgebiete] = useState<string[]>(
    initial?.teilgebietIds ?? []
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [tourFilter, setTourFilter] = useState('');

  const aktiveTeilgebiete = teilgebiete.filter((t) => t.isActive);
  const gefilterteTG = tourFilter
    ? aktiveTeilgebiete.filter((t) => t.tourId === tourFilter)
    : aktiveTeilgebiete;

  function toggleTeilgebiet(id: string) {
    setAusgewaehlteTeilgebiete((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  function alleToggeln() {
    const allIds = gefilterteTG.map((t) => t.id);
    const alleGewaehlt = allIds.every((id) => ausgewaehlteTeilgebiete.includes(id));
    if (alleGewaehlt) {
      setAusgewaehlteTeilgebiete((prev) => prev.filter((id) => !allIds.includes(id)));
    } else {
      setAusgewaehlteTeilgebiete((prev) => [...new Set([...prev, ...allIds])]);
    }
  }

  const gesamtStueckzahl = ausgewaehlteTeilgebiete.reduce((sum, id) => {
    return sum + (teilgebiete.find((t) => t.id === id)?.stueckzahl ?? 0);
  }, 0);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!arbeitstitel.trim()) { setError('Arbeitstitel erforderlich.'); return; }
    if (!kundenname.trim()) { setError('Kundenname erforderlich.'); return; }
    if (gewicht <= 0) { setError('Gewicht muss größer als 0 sein.'); return; }
    setSaving(true);
    setError('');
    try {
      const data = {
        ausgabeId,
        arbeitstitel,
        kundenname,
        gewichtGStk: gewicht,
        format,
        kennzeichen,
        teilgebietIds: ausgewaehlteTeilgebiete,
      };
      if (initial) {
        await aktualisiereBeilage(initial.id, data);
        onSave({ ...initial, ...data });
      } else {
        const id = await erstelleBeilage(data);
        onSave({ id, ...data, erstelltAm: Date.now() });
      }
    } catch (err) {
      setError('Fehler beim Speichern.');
      console.error(err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Arbeitstitel *</label>
          <input
            type="text"
            value={arbeitstitel}
            onChange={(e) => setArbeitstitel(e.target.value)}
            placeholder="z.B. REWE Prospekt"
            className={inputClass}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Kundenname *</label>
          <input
            type="text"
            value={kundenname}
            onChange={(e) => setKundenname(e.target.value)}
            placeholder="z.B. REWE Uslar"
            className={inputClass}
          />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Gewicht (g/Stk) *</label>
          <input
            type="number"
            min="0.1"
            step="0.1"
            value={gewicht || ''}
            onChange={(e) => setGewicht(parseFloat(e.target.value) || 0)}
            placeholder="25"
            className={inputClass}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Format</label>
          <select value={format} onChange={(e) => setFormat(e.target.value as BeilagenFormat)} className={inputClass}>
            {BEILAGEN_FORMATE.map((f) => (
              <option key={f.value} value={f.value}>{f.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Einlegen</label>
          <div className="flex gap-2 mt-1">
            {(['int', 'ext'] as BeilagenKennzeichen[]).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setKennzeichen(k)}
                className={`flex-1 py-2 text-xs rounded-lg border transition-colors ${
                  kennzeichen === k
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white text-gray-600 border-gray-300'
                }`}
              >
                {k === 'int' ? '🏭 Intern' : '🚶 Extern'}
              </button>
            ))}
          </div>
          <p className="text-xs text-gray-400 mt-1">
            {kennzeichen === 'int' ? 'Wird im Betrieb eingelegt' : 'Austräger legt ein'}
          </p>
        </div>
      </div>

      {/* Teilgebiete auswählen */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-sm font-medium text-gray-700">
            Teilgebiete ({ausgewaehlteTeilgebiete.length} gewählt · {gesamtStueckzahl.toLocaleString('de-DE')} Stk)
          </label>
          <div className="flex gap-2">
            <select
              value={tourFilter}
              onChange={(e) => setTourFilter(e.target.value)}
              className="border border-gray-300 rounded px-2 py-1 text-xs"
            >
              <option value="">Alle Touren</option>
              {touren.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <button
              type="button"
              onClick={alleToggeln}
              className="text-xs text-blue-600 hover:text-blue-800"
            >
              {gefilterteTG.every((t) => ausgewaehlteTeilgebiete.includes(t.id)) ? 'Alle abwählen' : 'Alle wählen'}
            </button>
          </div>
        </div>
        <div className="border border-gray-200 rounded-lg p-3 max-h-48 overflow-y-auto grid grid-cols-3 gap-1">
          {gefilterteTG.map((tg) => (
            <label key={tg.id} className="flex items-center gap-1.5 cursor-pointer hover:bg-gray-50 rounded px-1 py-0.5">
              <input
                type="checkbox"
                checked={ausgewaehlteTeilgebiete.includes(tg.id)}
                onChange={() => toggleTeilgebiet(tg.id)}
                className="rounded"
              />
              <span className="text-xs text-gray-700">{tg.name}</span>
              <span className="text-xs text-gray-400">({tg.stueckzahl})</span>
            </label>
          ))}
          {gefilterteTG.length === 0 && (
            <p className="text-xs text-gray-400 col-span-3">Keine Teilgebiete gefunden</p>
          )}
        </div>
      </div>

      {error && <p className="text-red-600 text-sm">{error}</p>}

      <div className="flex justify-end gap-3 pt-2">
        <button type="button" onClick={onCancel} className="px-4 py-2 text-sm text-gray-600">Abbrechen</button>
        <button
          type="submit"
          disabled={saving}
          className="bg-blue-600 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? 'Speichere...' : initial ? 'Speichern' : 'Hinzufügen'}
        </button>
      </div>
    </form>
  );
}

// ============================================================
// ABRECHNUNGSPERIODEN
// ============================================================

import { ladeAbrechnungsperioden, erstelleAbrechnungsperiode, aktualisiereAbrechnungsperiode } from '../lib/db';
import type { Abrechnungsperiode } from '../types';
import { MONATSNAMEN } from '../lib/kalender';

function AbrechnungsperiodenInhalt() {
  const [perioden, setPerioden] = useState<Abrechnungsperiode[]>([]);
  const [ausgaben, setAusgaben] = useState<Ausgabe[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editTarget, setEditTarget] = useState<Abrechnungsperiode | null>(null);

  useEffect(() => {
    Promise.all([ladeAbrechnungsperioden(), ladeAusgaben()]).then(([p, a]) => {
      setPerioden(p);
      setAusgaben(a);
      setLoading(false);
    });
  }, []);

  // Alle bereits zugeordneten KW/Jahr-Kombinationen
  const belegteKWs = perioden
    .filter((p) => editTarget === null || p.id !== editTarget.id)
    .flatMap((p) => p.kalenderwochen.map((kw) => `${p.jahr}-${kw}`));

  if (loading) return <div className="text-gray-400 text-sm">Lädt...</div>;

  return (
    <div>
      <div className="flex justify-end mb-4">
        <button
          onClick={() => { setEditTarget(null); setShowForm(true); }}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700"
        >
          + Neue Periode
        </button>
      </div>

      <div className="space-y-3">
        {perioden.length === 0 && (
          <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-400">
            Noch keine Abrechnungsperioden angelegt
          </div>
        )}
        {perioden.map((p) => (
          <div key={p.id} className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-3">
                  <h3 className="font-semibold text-gray-900">{p.bezeichnung}</h3>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${
                    p.status === 'abgeschlossen' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'
                  }`}>
                    {p.status === 'abgeschlossen' ? 'Abgeschlossen' : 'Offen'}
                  </span>
                </div>
                <div className="text-sm text-gray-500 mt-1">
                  {p.kalenderwochen.length === 0
                    ? 'Keine Kalenderwochen zugeordnet'
                    : p.kalenderwochen.sort((a, b) => a - b).map((kw) => kwLabel(kw, p.jahr)).join(' · ')}
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => { setEditTarget(p); setShowForm(true); }}
                  className="text-sm text-blue-600 hover:text-blue-800"
                >
                  Bearbeiten
                </button>
                {p.status === 'offen' && (
                  <button
                    onClick={async () => {
                      await aktualisiereAbrechnungsperiode(p.id, { status: 'abgeschlossen' });
                      setPerioden((prev) => prev.map((x) => x.id === p.id ? { ...x, status: 'abgeschlossen' } : x));
                    }}
                    className="text-sm text-green-600 hover:text-green-800"
                  >
                    Abschließen
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      <Modal
        isOpen={showForm}
        onClose={() => setShowForm(false)}
        title={editTarget ? 'Periode bearbeiten' : 'Neue Abrechnungsperiode'}
        size="md"
      >
        <PeriodeForm
          initial={editTarget}
          ausgaben={ausgaben}
          belegteKWs={belegteKWs}
          onSave={(p) => {
            setPerioden((prev) => {
              const idx = prev.findIndex((x) => x.id === p.id);
              if (idx >= 0) { const u = [...prev]; u[idx] = p; return u; }
              return [p, ...prev];
            });
            setShowForm(false);
          }}
          onCancel={() => setShowForm(false)}
        />
      </Modal>
    </div>
  );
}

function PeriodeForm({
  initial,
  ausgaben,
  belegteKWs,
  onSave,
  onCancel,
}: {
  initial: Abrechnungsperiode | null;
  ausgaben: Ausgabe[];
  belegteKWs: string[];
  onSave: (p: Abrechnungsperiode) => void;
  onCancel: () => void;
}) {
  const heute = new Date();
  const [monat, setMonat] = useState(initial?.monat ?? heute.getMonth() + 1);
  const [jahr, setJahr] = useState(initial?.jahr ?? heute.getFullYear());
  const [gewaehlteKWs, setGewaehlteKWs] = useState<number[]>(initial?.kalenderwochen ?? []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const bezeichnung = `${MONATSNAMEN[monat - 1]} ${jahr}`;
  const verfuegbareKWs = alleKWsImJahr(jahr);

  // KWs die bereits zu Ausgaben existieren
  const kwsMitAusgabe = new Set(
    ausgaben.filter((a) => a.jahr === jahr).map((a) => a.kw)
  );

  function toggleKW(kw: number) {
    const key = `${jahr}-${kw}`;
    if (belegteKWs.includes(key)) return; // bereits einer anderen Periode zugeordnet
    setGewaehlteKWs((prev) =>
      prev.includes(kw) ? prev.filter((k) => k !== kw) : [...prev, kw]
    );
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      if (initial) {
        await aktualisiereAbrechnungsperiode(initial.id, {
          monat, jahr, bezeichnung, kalenderwochen: gewaehlteKWs,
        });
        onSave({ ...initial, monat, jahr, bezeichnung, kalenderwochen: gewaehlteKWs });
      } else {
        const id = await erstelleAbrechnungsperiode({
          monat, jahr, bezeichnung, kalenderwochen: gewaehlteKWs, status: 'offen',
        });
        onSave({ id, monat, jahr, bezeichnung, kalenderwochen: gewaehlteKWs, status: 'offen', erstelltAm: Date.now() });
      }
    } catch (err) {
      setError('Fehler beim Speichern.');
      console.error(err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Monat</label>
          <select
            value={monat}
            onChange={(e) => setMonat(Number(e.target.value))}
            className={inputClass}
          >
            {MONATSNAMEN.map((name, i) => (
              <option key={i + 1} value={i + 1}>{name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Jahr</label>
          <input
            type="number"
            min={2020}
            max={2099}
            value={jahr}
            onChange={(e) => setJahr(Number(e.target.value))}
            className={inputClass}
          />
        </div>
      </div>

      <div className="bg-gray-50 rounded-lg px-3 py-2 text-sm text-gray-700">
        Bezeichnung: <strong>{bezeichnung}</strong>
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-sm font-medium text-gray-700">
            Kalenderwochen ({gewaehlteKWs.length} gewählt)
          </label>
          <p className="text-xs text-gray-400">Grau = bereits vergeben · Blau = hat Ausgabe</p>
        </div>
        <div className="border border-gray-200 rounded-lg p-3 grid grid-cols-6 gap-1.5 max-h-52 overflow-y-auto">
          {verfuegbareKWs.map((kw) => {
            const key = `${jahr}-${kw}`;
            const belegt = belegteKWs.includes(key);
            const hatAusgabe = kwsMitAusgabe.has(kw);
            const gewaehlt = gewaehlteKWs.includes(kw);
            return (
              <button
                key={kw}
                type="button"
                onClick={() => toggleKW(kw)}
                disabled={belegt}
                title={belegt ? 'Bereits anderer Periode zugeordnet' : hatAusgabe ? `Ausgabe vorhanden` : ''}
                className={`text-xs py-1.5 rounded border transition-colors ${
                  belegt
                    ? 'bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed'
                    : gewaehlt
                    ? 'bg-blue-600 text-white border-blue-600'
                    : hatAusgabe
                    ? 'bg-blue-50 text-blue-700 border-blue-200 hover:border-blue-400'
                    : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'
                }`}
              >
                {kw}
              </button>
            );
          })}
        </div>
        <p className="text-xs text-gray-400 mt-1">
          Jede KW darf nur einer Periode zugeordnet sein.
        </p>
      </div>

      {error && <p className="text-red-600 text-sm">{error}</p>}

      <div className="flex justify-end gap-3 pt-2">
        <button type="button" onClick={onCancel} className="px-4 py-2 text-sm text-gray-600">Abbrechen</button>
        <button
          type="submit"
          disabled={saving}
          className="bg-blue-600 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? 'Speichere...' : initial ? 'Speichern' : 'Anlegen'}
        </button>
      </div>
    </form>
  );
}

const inputClass = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';
