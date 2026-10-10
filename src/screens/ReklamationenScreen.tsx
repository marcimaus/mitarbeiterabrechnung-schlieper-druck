import { useState, useEffect, useMemo, useRef, type FormEvent } from 'react';
import { useApp } from '../context/AppContext';
import AdminPinGate from '../components/AdminPinGate';
import Modal from '../components/Modal';
import {
  abonniereReklamationen,
  erstelleReklamation,
  aktualisiereReklamation,
  loescheReklamation,
  ladeAusgaben,
  ladeEinsaetze,
} from '../lib/db';
import type {
  Reklamation,
  Ausgabe,
  Einsatz,
  ReklamationGrundKey,
  AnruferMerkmalKey,
  ReklamationZeitraum,
} from '../types';
import {
  REKLAMATION_GRUND_KEYS,
  REKLAMATION_GRUND_LABELS,
  ANRUFER_MERKMAL_KEYS,
  ANRUFER_MERKMAL_LABELS,
} from '../types';
import {
  findePassendeTeilgebiete,
  findePassendeMitarbeiter,
  zeitfensterFuerVorschlag,
  reklamationFormState,
  reklamationTgIds,
  reklamationMaIds,
  reklamationGruende,
  reklamationMerkmal,
  reklamationZeitraeume,
  erstelleOrtZuPlzMap,
  findePlzFuerOrt,
  buildGoogleMapsUrl,
  erstelleOrteVorschlag,
  normalisiereStrasse,
  strasseUnscharfPasst,
} from '../lib/reklamation';
/** Kompakte Textzusammenfassung der Zeiträume einer Reklamation (für die Liste). */
function zeitraumKurz(zeitraeume: ReklamationZeitraum[]): string {
  if (zeitraeume.length === 0) return '';
  return zeitraeume
    .map((z) => {
      if (z.typ === 'kw' && z.vonKw != null) {
        const von = `KW ${z.vonKw}/${z.vonJahr}`;
        if (z.bisKw != null && (z.bisKw !== z.vonKw || z.bisJahr !== z.vonJahr)) {
          return `${von}–KW ${z.bisKw}/${z.bisJahr}`;
        }
        return von;
      }
      if (z.typ === 'geschaetzt' && z.anzahl) {
        return `seit ${z.anzahl} ${z.einheit === 'monate' ? 'Mon.' : 'Wo.'}`;
      }
      if (z.typ === 'datum' && z.datum) {
        return new Date(z.datum).toLocaleDateString('de-DE');
      }
      return '';
    })
    .filter(Boolean)
    .join(', ');
}

const inputClass =
  'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';

export default function ReklamationenScreen() {
  return (
    <AdminPinGate allowedRoles={['admin', 'abrechnung']}>
      <ReklamationenInhalt />
    </AdminPinGate>
  );
}

function ReklamationenInhalt() {
  const { mitarbeiter, teilgebiete } = useApp();
  const [reklamationen, setReklamationen] = useState<Reklamation[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editTarget, setEditTarget] = useState<Reklamation | null>(null);
  const [filterMitgeteilt, setFilterMitgeteilt] = useState<'' | 'offen' | 'mitgeteilt' | 'archiv'>('');
  // Such-/Einschränkfilter
  const [filterAnrufer, setFilterAnrufer] = useState('');
  const [filterStrasse, setFilterStrasse] = useState('');
  const [filterTgId, setFilterTgId] = useState('');
  const [filterMaId, setFilterMaId] = useState('');
  const [filterGrund, setFilterGrund] = useState<'' | ReklamationGrundKey>('');
  const [filterSchonMal, setFilterSchonMal] = useState(false);

  useEffect(() => {
    const unsub = abonniereReklamationen(setReklamationen);
    return unsub;
  }, []);

  const gefiltert = useMemo(() => {
    const anruferLower = filterAnrufer.trim().toLowerCase();
    const strasseNorm = filterStrasse.trim() ? normalisiereStrasse(filterStrasse) : '';
    return reklamationen.filter((r) => {
      // Archiv-Filter: nur archivierte zeigen. Alle anderen Filter
      // blenden archivierte standardmäßig aus.
      if (filterMitgeteilt === 'archiv') {
        if (!r.archiviert) return false;
      } else {
        if (r.archiviert) return false;
        if (filterMitgeteilt === 'offen' && r.mitgeteilt) return false;
        if (filterMitgeteilt === 'mitgeteilt' && !r.mitgeteilt) return false;
      }
      // Anrufer-Volltextsuche: anruferName + telefon + email
      if (anruferLower) {
        const hay = [r.anruferName, r.telefon ?? '', r.email ?? '']
          .join(' ')
          .toLowerCase();
        if (!hay.includes(anruferLower)) return false;
      }
      // Teilgebiet-Filter
      if (filterTgId) {
        if (!reklamationTgIds(r).includes(filterTgId)) return false;
      }
      // Mitarbeiter-Filter
      if (filterMaId) {
        if (!reklamationMaIds(r).includes(filterMaId)) return false;
      }
      // Straßen-Filter — unscharf
      if (strasseNorm) {
        if (!strasseUnscharfPasst(strasseNorm, r.strasse ?? '')) return false;
      }
      // Reklamationsgrund-Filter
      if (filterGrund) {
        if (!reklamationGruende(r).includes(filterGrund)) return false;
      }
      // „Schon mal mitgeteilt"-Filter
      if (filterSchonMal) {
        if (reklamationMerkmal(r, 'schonMalMitgeteilt') !== 'ja') return false;
      }
      return true;
    });
  }, [reklamationen, filterMitgeteilt, filterAnrufer, filterStrasse, filterTgId, filterMaId, filterGrund, filterSchonMal]);

  // Listen für die Select-Filter — aktive MA mit Austräger-Rolle (für die
  // Auswahl) plus alle in bestehenden Reklamationen referenzierten MAs,
  // damit der Filter auch historische Zuordnungen abdeckt.
  const filterMaListe = useMemo(() => {
    const referenziert = new Set<string>();
    for (const r of reklamationen) reklamationMaIds(r).forEach((id) => referenziert.add(id));
    const set = new Set<string>(referenziert);
    for (const m of mitarbeiter) {
      if (m.isActive && (m.rollen.includes('austräger') || m.rollen.includes('zusammenträger'))) {
        set.add(m.id);
      }
    }
    return Array.from(set)
      .map((id) => mitarbeiter.find((m) => m.id === id))
      .filter((m): m is NonNullable<typeof m> => !!m)
      .sort((a, b) => a.name.localeCompare(b.name, 'de'));
  }, [reklamationen, mitarbeiter]);
  const filterTgListe = useMemo(() => {
    const referenziert = new Set<string>();
    for (const r of reklamationen) reklamationTgIds(r).forEach((id) => referenziert.add(id));
    const set = new Set<string>(referenziert);
    for (const t of teilgebiete) if (t.isActive) set.add(t.id);
    return Array.from(set)
      .map((id) => teilgebiete.find((t) => t.id === id))
      .filter((t): t is NonNullable<typeof t> => !!t)
      .sort((a, b) => a.name.localeCompare(b.name, 'de', { numeric: true }));
  }, [reklamationen, teilgebiete]);
  const hatSuchfilter =
    !!filterAnrufer || !!filterStrasse || !!filterTgId || !!filterMaId || !!filterGrund || filterSchonMal;

  /** Liefert die Namensliste der mit der Reklamation verknüpften TGs (Plural + Legacy). */
  function getTgNames(r: Reklamation): string[] {
    return reklamationTgIds(r).map((id) => teilgebiete.find((t) => t.id === id)?.name ?? '?');
  }
  /** Liefert die Namensliste der zugeordneten Mitarbeiter (Plural + Legacy). */
  function getMaNames(r: Reklamation): string[] {
    return reklamationMaIds(r).map((id) => mitarbeiter.find((m) => m.id === id)?.name ?? '?');
  }
  /** Kompakt-Render: erste 2 Namen, „(+N)" Tooltip enthält die ganze Liste. */
  function renderListe(namen: string[]): { text: string; titel: string } {
    if (namen.length === 0) return { text: '—', titel: '' };
    if (namen.length <= 2) return { text: namen.join(', '), titel: namen.join(', ') };
    return {
      text: `${namen.slice(0, 2).join(', ')} (+${namen.length - 2})`,
      titel: namen.join(', '),
    };
  }

  async function toggleMitgeteilt(r: Reklamation) {
    await aktualisiereReklamation(r.id, { mitgeteilt: !r.mitgeteilt });
  }
  async function toggleArchiviert(r: Reklamation) {
    await aktualisiereReklamation(r.id, { archiviert: !r.archiviert });
  }

  return (
    <div className="p-4 md:p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Reklamationen</h1>
          <p className="text-gray-500 text-sm">
            {reklamationen.filter((r) => !r.mitgeteilt && !r.archiviert).length} offen ·{' '}
            {reklamationen.filter((r) => r.archiviert).length} archiviert ·{' '}
            {reklamationen.length} gesamt
          </p>
        </div>
        <button
          onClick={() => { setEditTarget(null); setShowForm(true); }}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
        >
          + Neue Reklamation
        </button>
      </div>

      {/* Filter */}
      <div className="flex gap-3 mb-3 flex-wrap items-center">
        {(['', 'offen', 'mitgeteilt', 'archiv'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilterMitgeteilt(f)}
            className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${
              filterMitgeteilt === f
                ? 'bg-blue-600 text-white border-blue-600'
                : 'bg-white text-gray-600 border-gray-300 hover:border-gray-400'
            }`}
          >
            {f === '' ? 'Alle' : f === 'offen' ? 'Offen' : f === 'mitgeteilt' ? 'Mitgeteilt' : '📦 Archiv'}
          </button>
        ))}
        <span className="text-xs text-gray-400 ml-auto">
          {gefiltert.length} von {reklamationen.length}
        </span>
      </div>

      {/* Such-/Einschränkfilter */}
      <div className="bg-white border border-gray-200 rounded-lg p-3 mb-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Anrufer (Name / Tel. / E-Mail)</label>
            <input
              type="text"
              value={filterAnrufer}
              onChange={(e) => setFilterAnrufer(e.target.value)}
              placeholder="Volltextsuche"
              className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Straße (unscharf)</label>
            <input
              type="text"
              value={filterStrasse}
              onChange={(e) => setFilterStrasse(e.target.value)}
              placeholder="z. B. Lindenstr."
              className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Teilgebiet</label>
            <select
              value={filterTgId}
              onChange={(e) => setFilterTgId(e.target.value)}
              className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="">— alle —</option>
              {filterTgListe.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}{t.plz ? ` (${t.plz})` : ''}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Mitarbeiter</label>
            <select
              value={filterMaId}
              onChange={(e) => setFilterMaId(e.target.value)}
              className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="">— alle —</option>
              {filterMaListe.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} ({m.nummer})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Reklamationsgrund</label>
            <select
              value={filterGrund}
              onChange={(e) => setFilterGrund(e.target.value as '' | ReklamationGrundKey)}
              className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="">— alle —</option>
              {REKLAMATION_GRUND_KEYS.map((g) => (
                <option key={g} value={g}>
                  {REKLAMATION_GRUND_LABELS[g]}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-end">
            <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
              <input
                type="checkbox"
                checked={filterSchonMal}
                onChange={(e) => setFilterSchonMal(e.target.checked)}
                className="rounded"
              />
              Schon mal mitgeteilt
            </label>
          </div>
        </div>
        {hatSuchfilter && (
          <div className="mt-2 text-right">
            <button
              type="button"
              onClick={() => { setFilterAnrufer(''); setFilterStrasse(''); setFilterTgId(''); setFilterMaId(''); setFilterGrund(''); setFilterSchonMal(false); }}
              className="text-xs text-gray-500 hover:text-gray-700 underline"
            >
              ✕ Suchfilter zurücksetzen
            </button>
          </div>
        )}
      </div>

      {/* Tabelle */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Datum</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Anrufer</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Teilgebiet</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Austräger</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Hinweise</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Status</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {gefiltert.length === 0 && (
              <tr>
                <td colSpan={7} className="text-center py-8 text-gray-400">
                  Keine Reklamationen gefunden
                </td>
              </tr>
            )}
            {gefiltert.map((r) => (
              <tr key={r.id} className={`hover:bg-gray-50 ${!r.mitgeteilt ? 'bg-red-50/30' : ''}`}>
                <td className="px-4 py-3 text-gray-500 text-xs">
                  {new Date(r.erstelltAm).toLocaleDateString('de-DE')}
                </td>
                <td className="px-4 py-3">
                  <div className="font-medium text-gray-900">{r.anruferName}</div>
                  {r.telefon && <div className="text-xs text-gray-500">{r.telefon}</div>}
                  {(r.strasse || r.plz || r.ort) && (
                    <div className="text-xs text-gray-400 mt-0.5">
                      {[r.strasse, r.hausnummer].filter(Boolean).join(' ')}
                      {(r.strasse || r.hausnummer) && (r.plz || r.ort) ? ', ' : ''}
                      {[r.plz, r.ort].filter(Boolean).join(' ')}
                    </div>
                  )}
                </td>
                <td className="px-4 py-3 text-gray-600">
                  {(() => { const v = renderListe(getTgNames(r)); return <span title={v.titel}>{v.text}</span>; })()}
                </td>
                <td className="px-4 py-3 text-gray-600">
                  {(() => { const v = renderListe(getMaNames(r)); return <span title={v.titel}>{v.text}</span>; })()}
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1">
                    {reklamationGruende(r).map((g) => (
                      <span key={g} className="text-xs bg-red-100 text-red-700 px-1.5 py-0.5 rounded">
                        {REKLAMATION_GRUND_LABELS[g]}
                      </span>
                    ))}
                    {(r.gruendeFreitext ?? []).map((t, i) => (
                      <span key={`f${i}`} className="text-xs bg-red-50 text-red-600 px-1.5 py-0.5 rounded border border-red-200">
                        {t}
                      </span>
                    ))}
                  </div>
                  {(() => {
                    const merkmale = ANRUFER_MERKMAL_KEYS
                      .map((k) => ({ k, v: reklamationMerkmal(r, k) }))
                      .filter((x) => x.v);
                    if (merkmale.length === 0) return null;
                    return (
                      <div className="text-[11px] text-gray-500 mt-0.5">
                        {merkmale.map((x, i) => (
                          <span key={x.k}>
                            {i > 0 && ' · '}
                            {ANRUFER_MERKMAL_LABELS[x.k]}: <span className={x.v === 'ja' ? 'text-green-600' : 'text-gray-500'}>{x.v}</span>
                          </span>
                        ))}
                      </div>
                    );
                  })()}
                  {(() => {
                    const zr = zeitraumKurz(reklamationZeitraeume(r));
                    return zr ? <div className="text-xs text-gray-400 mt-0.5">🗓 {zr}</div> : null;
                  })()}
                  {r.mailLink && /^https?:\/\//i.test(r.mailLink) && (
                    <a
                      href={r.mailLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="text-xs text-blue-600 hover:text-blue-800 underline inline-block mt-0.5"
                      title="Mail-Thread öffnen"
                    >
                      📧 Mail
                    </a>
                  )}
                  {r.anmerkung && (
                    <div className="text-xs text-gray-500 mt-0.5 truncate max-w-[16rem]" title={r.anmerkung}>
                      {r.anmerkung}
                    </div>
                  )}
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-col gap-1 items-start">
                    <button
                      onClick={() => toggleMitgeteilt(r)}
                      className={`text-xs px-2 py-1 rounded-full font-medium transition-colors ${
                        r.mitgeteilt
                          ? 'bg-green-100 text-green-700 hover:bg-green-200'
                          : 'bg-amber-100 text-amber-700 hover:bg-amber-200'
                      }`}
                    >
                      {r.mitgeteilt ? '✓ Mitgeteilt' : 'Offen'}
                    </button>
                    <button
                      onClick={() => toggleArchiviert(r)}
                      className={`text-[10px] px-2 py-0.5 rounded-full font-medium transition-colors ${
                        r.archiviert
                          ? 'bg-gray-300 text-gray-700 hover:bg-gray-400'
                          : 'text-gray-400 hover:text-gray-700 hover:bg-gray-100'
                      }`}
                      title={r.archiviert ? 'Aus Archiv holen' : 'Archivieren'}
                    >
                      {r.archiviert ? '📦 Archiv' : '📦 archivieren'}
                    </button>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <div className="flex gap-2">
                    <button
                      onClick={() => { setEditTarget(r); setShowForm(true); }}
                      className="text-blue-600 hover:text-blue-800 text-xs font-medium"
                    >
                      Bearbeiten
                    </button>
                    <button
                      onClick={async () => {
                        if (confirm('Reklamation wirklich löschen?')) {
                          await loescheReklamation(r.id);
                        }
                      }}
                      className="text-red-400 hover:text-red-600 text-xs"
                    >
                      Löschen
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal
        isOpen={showForm}
        onClose={() => setShowForm(false)}
        title={editTarget ? 'Reklamation bearbeiten' : 'Neue Reklamation erfassen'}
        size="lg"
      >
        <ReklamationForm
          initial={editTarget}
          alleReklamationen={reklamationen}
          onSave={() => setShowForm(false)}
          onCancel={() => setShowForm(false)}
        />
      </Modal>
    </div>
  );
}

function ReklamationForm({
  initial,
  alleReklamationen,
  onSave,
  onCancel,
}: {
  initial: Reklamation | null;
  alleReklamationen: Reklamation[];
  onSave: () => void;
  onCancel: () => void;
}) {
  const { mitarbeiter, teilgebiete, abrechnungsperioden } = useApp();
  const heuteIso = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState(() => {
    const s = reklamationFormState(initial);
    // Neuerfassung: Zeitraum „Problem bekannt" mit heutigem Datum vorbelegen.
    if (!initial && s.zeitraeume.length === 0) {
      s.zeitraeume = [{ typ: 'datum', datum: heuteIso }];
    }
    return s;
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  // Freitext-Grund-Eingabefeld
  const [freitextEingabe, setFreitextEingabe] = useState('');

  // Cache geladener Daten pro Form-Open — Ausgaben einmal, Einsätze
  // gruppiert pro ausgabeId.
  const ausgabenRef = useRef<Ausgabe[] | null>(null);
  const einsaetzeCacheRef = useRef<Map<string, Einsatz[]>>(new Map());
  // Geladene Einsätze für die relevanten Ausgaben — Trigger für MA-Match.
  const [relevanteEinsaetze, setRelevanteEinsaetze] = useState<Einsatz[]>([]);
  const [maLoading, setMaLoading] = useState(false);
  // Reale Ausgaben für die KW-Zeitraum-Dropdowns (absteigend sortiert).
  const [ausgabenListe, setAusgabenListe] = useState<Ausgabe[]>([]);
  useEffect(() => {
    let abgebrochen = false;
    (async () => {
      if (!ausgabenRef.current) ausgabenRef.current = await ladeAusgaben();
      if (abgebrochen) return;
      const sortiert = [...ausgabenRef.current].sort(
        (a, b) => b.jahr - a.jahr || b.kw - a.kw
      );
      setAusgabenListe(sortiert);
    })().catch((e) => console.error('Ausgaben laden fehlgeschlagen:', e));
    return () => { abgebrochen = true; };
  }, []);

  // Zeitfenster (von..bis) für die Austräger-/Springer-Vorauswahl.
  const maFenster = useMemo(
    () => zeitfensterFuerVorschlag(form.zeitraeume),
    [form.zeitraeume]
  );

  // Alle Einsätze (zeitunabhängig) — lazy geladen, wenn „weitere Austräger"
  // aufgeklappt wird. Basis für die Liste der MAs, die das TG JEMALS
  // ausgetragen haben.
  const [alleEinsaetze, setAlleEinsaetze] = useState<Einsatz[] | null>(null);
  const [alleEinsLoading, setAlleEinsLoading] = useState(false);
  async function ladeAlleEinsaetze() {
    if (alleEinsaetze !== null || alleEinsLoading) return;
    setAlleEinsLoading(true);
    try {
      if (!ausgabenRef.current) ausgabenRef.current = await ladeAusgaben();
      const result: Einsatz[] = [];
      await Promise.all(
        ausgabenRef.current.map(async (a) => {
          let list = einsaetzeCacheRef.current.get(a.id);
          if (!list) { list = await ladeEinsaetze(a.id); einsaetzeCacheRef.current.set(a.id, list); }
          result.push(...list);
        })
      );
      setAlleEinsaetze(result);
    } catch (e) {
      console.error('Alle Einsätze laden fehlgeschlagen:', e);
    } finally {
      setAlleEinsLoading(false);
    }
  }

  // MAs, die das/die gewählte(n) TG JEMALS ausgetragen haben (zeitunabhängig):
  // weites Fenster [2000 .. weit in der Zukunft] über alle geladenen Einsätze.
  const maJemals = useMemo(() => {
    if (form.teilgebietIds.length === 0) return [];
    return findePassendeMitarbeiter(
      { von: { jahr: 2000, kw: 1 }, bis: { jahr: 9999, kw: 53 } },
      form.teilgebietIds,
      { teilgebiete, abrechnungsperioden, mitarbeiter, einsaetze: alleEinsaetze ?? relevanteEinsaetze }
    );
  }, [form.teilgebietIds, teilgebiete, abrechnungsperioden, mitarbeiter, alleEinsaetze, relevanteEinsaetze]);

  // TG-Vorschlag — synchron, memoiziert auf Adresse + TG-Liste.
  const tgVorschlaege = useMemo(
    () => findePassendeTeilgebiete(form.strasse, form.plz, form.ort, teilgebiete),
    [form.strasse, form.plz, form.ort, teilgebiete]
  );

  // TG-Auswahl an die Adresse koppeln — SPIEGELN, nicht akkumulieren:
  // Solange der User die TG-Auswahl noch nicht manuell angefasst hat (und es
  // eine Neuerfassung ist), entspricht die Auswahl exakt den aktuellen
  // Adress-Vorschlägen. Ändert sich die Adresse, verschwinden vorher
  // vorgeschlagene TGs wieder (kein Aufsummieren über alle Tippzustände).
  // Sobald der User toggelt → eingefroren. Beim Bearbeiten nie automatisch.
  const tgBeruehrtRef = useRef<boolean>(!!initial);
  useEffect(() => {
    if (tgBeruehrtRef.current) return;
    const ids = tgVorschlaege.map((v) => v.tg.id);
    setForm((f) => {
      if (
        ids.length === f.teilgebietIds.length &&
        ids.every((id) => f.teilgebietIds.includes(id))
      ) {
        return f;
      }
      return { ...f, teilgebietIds: ids };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tgVorschlaege]);

  // Einsätze für MA-Match lazy laden — nur Ausgaben im begrenzten Fenster.
  useEffect(() => {
    if (form.teilgebietIds.length === 0) {
      setRelevanteEinsaetze([]);
      return;
    }
    let abgebrochen = false;
    setMaLoading(true);
    (async () => {
      if (!ausgabenRef.current) {
        ausgabenRef.current = await ladeAusgaben();
      }
      const { von, bis } = maFenster;
      const leqVon = (a: Ausgabe) => von.jahr < a.jahr || (von.jahr === a.jahr && von.kw <= a.kw);
      const leqBis = (a: Ausgabe) => a.jahr < bis.jahr || (a.jahr === bis.jahr && a.kw <= bis.kw);
      const relevant = ausgabenRef.current.filter((a) => leqVon(a) && leqBis(a));

      // Einsätze gecached pro ausgabeId
      const result: Einsatz[] = [];
      await Promise.all(
        relevant.map(async (a) => {
          let einsList = einsaetzeCacheRef.current.get(a.id);
          if (!einsList) {
            einsList = await ladeEinsaetze(a.id);
            einsaetzeCacheRef.current.set(a.id, einsList);
          }
          result.push(...einsList);
        })
      );
      if (!abgebrochen) {
        setRelevanteEinsaetze(result);
        setMaLoading(false);
      }
    })().catch((e) => {
      console.error('Einsätze laden fehlgeschlagen:', e);
      if (!abgebrochen) setMaLoading(false);
    });
    return () => { abgebrochen = true; };
  }, [maFenster, form.teilgebietIds]);

  // MA-Vorschlag — synchron, memoiziert auf Fenster + TG-Auswahl + Einsätze.
  const maVorschlaege = useMemo(
    () =>
      findePassendeMitarbeiter(maFenster, form.teilgebietIds, {
        teilgebiete,
        abrechnungsperioden,
        mitarbeiter,
        einsaetze: relevanteEinsaetze,
      }),
    [maFenster, form.teilgebietIds, teilgebiete, abrechnungsperioden, mitarbeiter, relevanteEinsaetze]
  );

  // MA-Auswahl-Persistenz (Bug-Fix): Vorschläge werden NUR bei einer
  // Neuerfassung und NUR solange der User noch keinen MA angeklickt hat
  // automatisch vorbelegt (Spiegel der aktuellen Vorschläge). Sobald der
  // User eine Auswahl trifft → eingefroren. Beim Bearbeiten (`initial`
  // gesetzt) findet nie ein automatisches Vorbelegen statt — die
  // gespeicherte Auswahl bleibt exakt erhalten.
  const maBeruehrtRef = useRef<boolean>(!!initial);
  useEffect(() => {
    if (maBeruehrtRef.current) return;
    const ids = maVorschlaege.map((v) => v.ma.id);
    setForm((f) => {
      if (
        ids.length === f.mitarbeiterIds.length &&
        ids.every((id) => f.mitarbeiterIds.includes(id))
      ) {
        return f;
      }
      return { ...f, mitarbeiterIds: ids };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maVorschlaege]);

  // Ort → PLZ-Auto-Fill: einmal Map aufbauen (aus MA-Adressen), bei
  // Ortsänderung prüfen, ob eindeutige PLZ existiert. Setzt PLZ nur, wenn
  // sie aktuell leer ist — User-Eingabe wird nicht überschrieben.
  const ortPlzMap = useMemo(() => erstelleOrtZuPlzMap(mitarbeiter), [mitarbeiter]);
  // Orte-Vorschlagsliste: nur Orte, die zum Verteilbereich gehören
  // (Adressen aktiver Mitarbeiter im PLZ-Bereich der aktiven TGs, plus
  // bereits in Reklamationen erfasste Orte).
  const orteVorschlag = useMemo(
    () => erstelleOrteVorschlag(mitarbeiter, teilgebiete, alleReklamationen),
    [mitarbeiter, teilgebiete, alleReklamationen]
  );
  const datalistId = 'reklamation-orte';
  useEffect(() => {
    if (!form.ort.trim() || form.plz.trim()) return;
    const plzVorschlag = findePlzFuerOrt(form.ort, ortPlzMap);
    if (plzVorschlag) {
      setForm((f) => (f.plz ? f : { ...f, plz: plzVorschlag }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.ort]);

  // Google-Maps-URL — sobald genug Adressdaten vorliegen.
  const mapsUrl = useMemo(
    () => buildGoogleMapsUrl(form.strasse, form.hausnummer, form.plz, form.ort),
    [form.strasse, form.hausnummer, form.plz, form.ort]
  );

  function toggleTg(id: string) {
    // Manuelle TG-Auswahl friert das Adress-Spiegeln ein.
    tgBeruehrtRef.current = true;
    setForm((f) => ({
      ...f,
      teilgebietIds: f.teilgebietIds.includes(id)
        ? f.teilgebietIds.filter((x) => x !== id)
        : [...f.teilgebietIds, id],
    }));
  }
  function toggleMa(id: string) {
    // Sobald der User eine MA-Auswahl trifft, friert das Auto-Vorbelegen ein.
    maBeruehrtRef.current = true;
    setForm((f) => ({
      ...f,
      mitarbeiterIds: f.mitarbeiterIds.includes(id)
        ? f.mitarbeiterIds.filter((x) => x !== id)
        : [...f.mitarbeiterIds, id],
    }));
  }

  // ---- Reklamationsgründe ----
  function toggleGrund(g: ReklamationGrundKey) {
    setForm((f) => ({
      ...f,
      gruende: f.gruende.includes(g)
        ? f.gruende.filter((x) => x !== g)
        : [...f.gruende, g],
    }));
  }
  function addFreitext() {
    const t = freitextEingabe.trim();
    if (!t) return;
    setForm((f) => (f.gruendeFreitext.includes(t) ? f : { ...f, gruendeFreitext: [...f.gruendeFreitext, t] }));
    setFreitextEingabe('');
  }
  function removeFreitext(t: string) {
    setForm((f) => ({ ...f, gruendeFreitext: f.gruendeFreitext.filter((x) => x !== t) }));
  }

  // ---- Anrufer-Merkmale (Tri-State) ----
  function setMerkmal(key: AnruferMerkmalKey, wert: 'ja' | 'nein') {
    setForm((f) => {
      const next = { ...f.anruferMerkmale };
      if (next[key] === wert) {
        delete next[key]; // erneuter Klick auf aktiven Wert → „nicht gefragt"
      } else {
        next[key] = wert;
      }
      return { ...f, anruferMerkmale: next };
    });
  }

  // ---- Zeiträume ----
  function addZeitraum(typ: ReklamationZeitraum['typ']) {
    const neu: ReklamationZeitraum =
      typ === 'datum'
        ? { typ: 'datum', datum: heuteIso }
        : typ === 'geschaetzt'
          ? { typ: 'geschaetzt', einheit: 'wochen', anzahl: 1 }
          : { typ: 'kw' };
    setForm((f) => ({ ...f, zeitraeume: [...f.zeitraeume, neu] }));
  }
  function setZeitraum(index: number, patch: Partial<ReklamationZeitraum>) {
    setForm((f) => ({
      ...f,
      zeitraeume: f.zeitraeume.map((z, i) => {
        if (i !== index) return z;
        const merged: Record<string, unknown> = { ...z, ...patch };
        // undefined-Keys (z. B. geleertes „bis") entfernen statt zu speichern.
        for (const k of Object.keys(merged)) if (merged[k] === undefined) delete merged[k];
        return merged as unknown as ReklamationZeitraum;
      }),
    }));
  }
  function removeZeitraum(index: number) {
    setForm((f) => ({ ...f, zeitraeume: f.zeitraeume.filter((_, i) => i !== index) }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!form.anruferName.trim()) { setError('Name des Anrufers ist erforderlich.'); return; }
    // Validierung der Zeiträume.
    for (const z of form.zeitraeume) {
      if (z.typ === 'datum' && z.datum && z.datum > heuteIso) {
        setError('„Problem bekannt" darf nicht in der Zukunft liegen.');
        return;
      }
      if (z.typ === 'kw') {
        if (z.vonJahr == null || z.vonKw == null) {
          setError('Bitte für jeden KW-Zeitraum eine „Von"-Ausgabe wählen (oder den Zeitraum entfernen).');
          return;
        }
        if (z.bisJahr != null && z.bisKw != null) {
          const vonV = z.vonJahr * 100 + z.vonKw;
          const bisV = z.bisJahr * 100 + z.bisKw;
          if (bisV < vonV) { setError('KW-Zeitraum: „Bis" darf nicht vor „Von" liegen.'); return; }
        }
      }
    }
    setSaving(true);
    setError('');
    try {
      // Nur die aktuellen Felder schreiben. Deprecated Booleans + seitWann
      // werden NICHT mehr gesetzt; undefAsDelete entfernt geleerte Felder.
      const merkmaleLeer = Object.keys(form.anruferMerkmale).length === 0;
      const payload: Partial<Reklamation> = {
        anruferName: form.anruferName,
        telefon: form.telefon || undefined,
        email: form.email || undefined,
        strasse: form.strasse || undefined,
        hausnummer: form.hausnummer || undefined,
        plz: form.plz || undefined,
        ort: form.ort || undefined,
        anmerkung: form.anmerkung || undefined,
        teilgebietIds: form.teilgebietIds.length > 0 ? form.teilgebietIds : undefined,
        mitarbeiterIds: form.mitarbeiterIds.length > 0 ? form.mitarbeiterIds : undefined,
        mitgeteilt: form.mitgeteilt,
        mailLink: form.mailLink || undefined,
        archiviert: form.archiviert ? true : undefined,
        gruende: form.gruende.length > 0 ? form.gruende : undefined,
        gruendeFreitext: form.gruendeFreitext.length > 0 ? form.gruendeFreitext : undefined,
        anruferMerkmale: merkmaleLeer ? undefined : form.anruferMerkmale,
        zeitraeume: form.zeitraeume.length > 0 ? form.zeitraeume : undefined,
      };
      if (initial) {
        await aktualisiereReklamation(initial.id, payload);
      } else {
        await erstelleReklamation({
          anruferName: payload.anruferName!,
          telefon: payload.telefon,
          email: payload.email,
          strasse: payload.strasse,
          hausnummer: payload.hausnummer,
          plz: payload.plz,
          ort: payload.ort,
          anmerkung: payload.anmerkung,
          teilgebietIds: payload.teilgebietIds,
          mitarbeiterIds: payload.mitarbeiterIds,
          mitgeteilt: payload.mitgeteilt!,
          mailLink: payload.mailLink,
          archiviert: payload.archiviert,
          gruende: payload.gruende,
          gruendeFreitext: payload.gruendeFreitext,
          anruferMerkmale: payload.anruferMerkmale,
          zeitraeume: payload.zeitraeume,
        });
      }
      onSave();
    } catch (err) {
      setError('Fehler beim Speichern.');
      console.error(err);
    } finally {
      setSaving(false);
    }
  }

  const aktiveTgs = teilgebiete.filter((t) => t.isActive);
  const tgMap = new Map(teilgebiete.map((t) => [t.id, t]));
  const maMap = new Map(mitarbeiter.map((m) => [m.id, m]));
  const istVorgeschlagenTg = (id: string) => tgVorschlaege.some((v) => v.tg.id === id);
  const istVorgeschlagenMa = (id: string) => maVorschlaege.some((v) => v.ma.id === id);

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Anrufer */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Name des Anrufers *</label>
          <input
            type="text"
            value={form.anruferName}
            onChange={(e) => setForm((f) => ({ ...f, anruferName: e.target.value }))}
            placeholder="Max Mustermann"
            className={inputClass}
            autoFocus
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Telefon</label>
          <input
            type="tel"
            value={form.telefon ?? ''}
            onChange={(e) => setForm((f) => ({ ...f, telefon: e.target.value }))}
            placeholder="+49 5571 12345"
            className={inputClass}
          />
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">E-Mail</label>
        <input
          type="email"
          value={form.email ?? ''}
          onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
          placeholder="max@beispiel.de"
          className={inputClass}
        />
      </div>

      {/* Adresse — Basis für die TG-Vorschlagslogik (zuklappbar) */}
      <details className="rounded-lg border border-gray-200 bg-gray-50 p-3" open={!initial}>
        <summary className="cursor-pointer text-xs font-semibold text-gray-600 flex items-center justify-between gap-2">
          <span>📍 Adresse (Basis für TG-Vorschlag)</span>
          <span className="font-normal text-gray-400 truncate">
            {[form.strasse, form.hausnummer].filter(Boolean).join(' ')}
            {(form.strasse || form.hausnummer) && (form.plz || form.ort) ? ', ' : ''}
            {[form.plz, form.ort].filter(Boolean).join(' ')}
          </span>
        </summary>
        <div className="mt-2 space-y-2">
        {mapsUrl && (
          <div className="text-right">
            <a
              href={mapsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-blue-600 hover:text-blue-800 underline inline-flex items-center gap-1"
              title="Adresse auf Google Maps öffnen"
            >
              🗺️ Auf Google Maps ansehen
            </a>
          </div>
        )}
        <div className="grid grid-cols-3 gap-2">
          <div className="col-span-2">
            <label className="block text-xs text-gray-500 mb-1">Straße</label>
            <input
              type="text"
              value={form.strasse}
              onChange={(e) => setForm((f) => ({ ...f, strasse: e.target.value }))}
              placeholder="z. B. Bahnhofstraße"
              className={inputClass}
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Hausnummer</label>
            <input
              type="text"
              value={form.hausnummer}
              onChange={(e) => setForm((f) => ({ ...f, hausnummer: e.target.value }))}
              placeholder="z. B. 12a"
              className={inputClass}
            />
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div>
            <label className="block text-xs text-gray-500 mb-1">PLZ</label>
            <input
              type="text"
              value={form.plz}
              onChange={(e) => setForm((f) => ({ ...f, plz: e.target.value }))}
              placeholder="37170"
              className={inputClass}
              maxLength={5}
            />
          </div>
          <div className="col-span-2">
            <label className="block text-xs text-gray-500 mb-1">Ort</label>
            <input
              type="text"
              value={form.ort}
              onChange={(e) => setForm((f) => ({ ...f, ort: e.target.value }))}
              placeholder="z. B. Uslar"
              list={datalistId}
              className={inputClass}
            />
            <datalist id={datalistId}>
              {orteVorschlag.map((o) => (
                <option key={o} value={o} />
              ))}
            </datalist>
          </div>
        </div>
        </div>
      </details>

      {/* Reklamationsgrund — eigene Karte (zuklappbar) */}
      <details className="rounded-lg border border-red-200 bg-red-50/40 p-3" open={!initial}>
        <summary className="cursor-pointer text-sm font-semibold text-red-800 flex items-center justify-between gap-2">
          <span className="shrink-0">⚠️ Reklamationsgrund</span>
          <span className="font-normal text-red-600 text-xs truncate text-right">
            {[
              ...form.gruende.map((g) => REKLAMATION_GRUND_LABELS[g]),
              ...form.gruendeFreitext,
            ].join(', ') || 'kein Grund gewählt'}
          </span>
        </summary>
        <div className="mt-2 space-y-2">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
          {REKLAMATION_GRUND_KEYS.map((g) => (
            <label key={g} className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
              <input
                type="checkbox"
                checked={form.gruende.includes(g)}
                onChange={() => toggleGrund(g)}
                className="rounded"
              />
              {REKLAMATION_GRUND_LABELS[g]}
            </label>
          ))}
        </div>
        {/* Freitext-Gründe */}
        {form.gruendeFreitext.length > 0 && (
          <div className="flex flex-wrap gap-1 pt-1">
            {form.gruendeFreitext.map((t) => (
              <span key={t} className="text-xs bg-white border border-red-200 text-red-700 px-1.5 py-0.5 rounded inline-flex items-center gap-1">
                {t}
                <button type="button" onClick={() => removeFreitext(t)} className="text-red-400 hover:text-red-600" title="Entfernen">✕</button>
              </span>
            ))}
          </div>
        )}
        <div className="flex gap-2 pt-1">
          <input
            type="text"
            value={freitextEingabe}
            onChange={(e) => setFreitextEingabe(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addFreitext(); } }}
            placeholder="+ eigener Grund (Freitext)"
            className="flex-1 border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-red-400"
          />
          <button
            type="button"
            onClick={addFreitext}
            className="px-3 py-1.5 text-sm rounded bg-red-100 text-red-700 hover:bg-red-200 disabled:opacity-50"
            disabled={!freitextEingabe.trim()}
          >
            Hinzufügen
          </button>
        </div>
        </div>
      </details>

      {/* Kennzeichen zum Anrufer — Aufklappbox mit Tri-State Ja/Nein */}
      <div className="rounded-lg border border-gray-200 bg-white p-3 space-y-2">
        <details>
          <summary className="cursor-pointer text-sm font-medium text-gray-700">
            🏷️ Kennzeichen zum Anrufer (Ja/Nein, falls gefragt)
          </summary>
          <div className="mt-2 space-y-1.5">
            {ANRUFER_MERKMAL_KEYS.map((key) => {
              const val = form.anruferMerkmale[key];
              return (
                <div key={key} className="flex items-center justify-between gap-2 text-sm">
                  <span className="text-gray-700">{ANRUFER_MERKMAL_LABELS[key]}</span>
                  <div className="flex gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => setMerkmal(key, 'ja')}
                      className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                        val === 'ja'
                          ? 'bg-green-600 text-white border-green-600'
                          : 'bg-white text-gray-500 border-gray-300 hover:border-green-400'
                      }`}
                    >
                      Ja
                    </button>
                    <button
                      type="button"
                      onClick={() => setMerkmal(key, 'nein')}
                      className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                        val === 'nein'
                          ? 'bg-gray-600 text-white border-gray-600'
                          : 'bg-white text-gray-500 border-gray-300 hover:border-gray-400'
                      }`}
                    >
                      Nein
                    </button>
                  </div>
                </div>
              );
            })}
            <p className="text-[11px] text-gray-400 pt-1">
              Nicht angeklickt = Frage wurde dem Anrufer nicht gestellt.
            </p>
          </div>
        </details>
        {/* Zusammenfassung — immer sichtbar, nur beantwortete Merkmale */}
        {(() => {
          const beantwortet = ANRUFER_MERKMAL_KEYS.filter((k) => form.anruferMerkmale[k]);
          if (beantwortet.length === 0) {
            return <p className="text-xs text-gray-400">Keine Kennzeichen erfasst.</p>;
          }
          return (
            <div className="flex flex-wrap gap-1">
              {beantwortet.map((k) => (
                <span key={k} className="text-xs bg-gray-100 text-gray-700 px-1.5 py-0.5 rounded">
                  {ANRUFER_MERKMAL_LABELS[k]}:{' '}
                  <span className={form.anruferMerkmale[k] === 'ja' ? 'text-green-700 font-medium' : 'text-gray-600 font-medium'}>
                    {form.anruferMerkmale[k]}
                  </span>
                </span>
              ))}
            </div>
          );
        })()}
      </div>

      {/* Zeitraum — steuert das Vorschlag-Fenster (zuklappbar) */}
      <details className="rounded-lg border border-gray-200 bg-white p-3" open={!initial}>
        <summary className="cursor-pointer text-sm font-medium text-gray-700 flex items-center justify-between gap-2">
          <span>🗓 Zeitraum des Problems</span>
          <span className="font-normal text-gray-400 text-xs truncate">
            {zeitraumKurz(form.zeitraeume) || 'kein Zeitraum'}
          </span>
        </summary>
        <div className="mt-2 space-y-2">
        <p className="text-[11px] text-gray-400">
          Steuert den Zeitraum, in dem nach Austrägern / Springern gesucht wird.
        </p>
        {form.zeitraeume.map((z, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2 border border-gray-100 rounded p-2 bg-gray-50/60">
            <select
              value={z.typ}
              onChange={(e) => {
                const typ = e.target.value as ReklamationZeitraum['typ'];
                // Beim Typwechsel die fremden Felder zurücksetzen.
                const base: ReklamationZeitraum =
                  typ === 'datum' ? { typ: 'datum', datum: heuteIso }
                  : typ === 'geschaetzt' ? { typ: 'geschaetzt', einheit: 'wochen', anzahl: 1 }
                  : { typ: 'kw' };
                setForm((f) => ({ ...f, zeitraeume: f.zeitraeume.map((x, idx) => (idx === i ? base : x)) }));
              }}
              className="border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="kw">Ausgabe (KW)</option>
              <option value="geschaetzt">geschätzt</option>
              <option value="datum">Datum</option>
            </select>

            {z.typ === 'kw' && (
              <>
                <span className="text-xs text-gray-500">von</span>
                <select
                  value={z.vonJahr != null && z.vonKw != null ? `${z.vonJahr}-${z.vonKw}` : ''}
                  onChange={(e) => {
                    const [jahr, kw] = e.target.value.split('-').map(Number);
                    setZeitraum(i, { vonJahr: jahr, vonKw: kw });
                  }}
                  className="border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  <option value="">— Ausgabe —</option>
                  {ausgabenListe.map((a) => (
                    <option key={a.id} value={`${a.jahr}-${a.kw}`}>KW {a.kw}/{a.jahr}</option>
                  ))}
                </select>
                <span className="text-xs text-gray-500">bis (optional)</span>
                <select
                  value={z.bisJahr != null && z.bisKw != null ? `${z.bisJahr}-${z.bisKw}` : ''}
                  onChange={(e) => {
                    if (!e.target.value) { setZeitraum(i, { bisJahr: undefined, bisKw: undefined }); return; }
                    const [jahr, kw] = e.target.value.split('-').map(Number);
                    setZeitraum(i, { bisJahr: jahr, bisKw: kw });
                  }}
                  className="border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  <option value="">— nur eine Ausgabe —</option>
                  {ausgabenListe.map((a) => (
                    <option key={a.id} value={`${a.jahr}-${a.kw}`}>KW {a.kw}/{a.jahr}</option>
                  ))}
                </select>
              </>
            )}

            {z.typ === 'geschaetzt' && (
              <>
                <span className="text-xs text-gray-500">seit</span>
                <input
                  type="number"
                  min={1}
                  value={z.anzahl ?? 1}
                  onChange={(e) => setZeitraum(i, { anzahl: Math.max(1, Number(e.target.value) || 1) })}
                  className="w-16 border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
                <select
                  value={z.einheit ?? 'wochen'}
                  onChange={(e) => setZeitraum(i, { einheit: e.target.value as 'wochen' | 'monate' })}
                  className="border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  <option value="wochen">Wochen</option>
                  <option value="monate">Monaten</option>
                </select>
              </>
            )}

            {z.typ === 'datum' && (
              <input
                type="date"
                value={z.datum ?? ''}
                max={heuteIso}
                onChange={(e) => setZeitraum(i, { datum: e.target.value })}
                className="border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            )}

            <button
              type="button"
              onClick={() => removeZeitraum(i)}
              className="ml-auto text-gray-400 hover:text-red-500 text-sm"
              title="Zeitraum entfernen"
            >
              ✕
            </button>
          </div>
        ))}
        <div className="flex gap-2">
          <button type="button" onClick={() => addZeitraum('kw')} className="text-xs text-blue-600 hover:text-blue-800">+ Ausgabe (KW)</button>
          <button type="button" onClick={() => addZeitraum('geschaetzt')} className="text-xs text-blue-600 hover:text-blue-800">+ geschätzt</button>
          <button type="button" onClick={() => addZeitraum('datum')} className="text-xs text-blue-600 hover:text-blue-800">+ Datum</button>
        </div>
        </div>
      </details>

      {/* Teilgebiet-Auswahl: Vorschläge oben, Erweiterung im Disclosure */}
      <div className="rounded-lg border border-gray-200 bg-white p-3 space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium text-gray-700">Teilgebiet(e)</label>
          <span className="text-xs text-gray-400">
            {form.teilgebietIds.length} gewählt
          </span>
        </div>

        {tgVorschlaege.length > 0 ? (
          <div className="rounded-md border border-blue-200 bg-blue-50/60 p-2.5">
            <div className="text-xs font-medium text-blue-800 mb-1.5">
              💡 Vorgeschlagen anhand der Adresse:
            </div>
            <ul className="space-y-1">
              {tgVorschlaege.map((v) => (
                <li key={v.tg.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={form.teilgebietIds.includes(v.tg.id)}
                    onChange={() => toggleTg(v.tg.id)}
                    className="rounded"
                  />
                  <span className="font-medium text-gray-900">{v.tg.name}</span>
                  {v.tg.plz && <span className="text-xs text-gray-500">({v.tg.plz})</span>}
                  <span className="ml-auto text-[10px] bg-white border border-blue-200 text-blue-700 px-1.5 py-0.5 rounded">
                    {v.grund}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-xs text-gray-400 italic">
            Keine automatischen Vorschläge — Adresse eingeben oder unten manuell wählen.
          </p>
        )}

        <details className="text-sm">
          <summary className="cursor-pointer text-xs text-gray-600 hover:text-gray-800 py-1">
            Weitere Teilgebiete hinzufügen …
          </summary>
          <div className="mt-2 max-h-40 overflow-y-auto border border-gray-200 rounded p-2 grid grid-cols-2 gap-1">
            {[...aktiveTgs]
              .sort((a, b) => a.name.localeCompare(b.name, 'de', { numeric: true }))
              .filter((tg) => !istVorgeschlagenTg(tg.id))
              .map((tg) => (
                <label key={tg.id} className="flex items-center gap-1.5 text-xs text-gray-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.teilgebietIds.includes(tg.id)}
                    onChange={() => toggleTg(tg.id)}
                    className="rounded"
                  />
                  <span>{tg.name}{tg.plz ? ` (${tg.plz})` : ''}</span>
                </label>
              ))}
          </div>
        </details>

        {/* Bereits gewählte TGs, die nicht im Vorschlag erscheinen (z. B. manuell hinzugefügt) */}
        {form.teilgebietIds.some((id) => !istVorgeschlagenTg(id)) && (
          <div className="flex flex-wrap gap-1 pt-1">
            {form.teilgebietIds
              .filter((id) => !istVorgeschlagenTg(id))
              .map((id) => {
                const tg = tgMap.get(id);
                return (
                  <span key={id} className="text-xs bg-gray-100 text-gray-700 px-1.5 py-0.5 rounded inline-flex items-center gap-1">
                    {tg?.name ?? id}
                    <button
                      type="button"
                      onClick={() => toggleTg(id)}
                      className="text-gray-400 hover:text-red-500"
                      title="Entfernen"
                    >
                      ✕
                    </button>
                  </span>
                );
              })}
          </div>
        )}
      </div>

      {/* Austräger-Auswahl */}
      <div className="rounded-lg border border-gray-200 bg-white p-3 space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium text-gray-700">Austräger / Springer</label>
          <span className="text-xs text-gray-400">
            {form.mitarbeiterIds.length} gewählt
            {maLoading && <span className="ml-2 text-blue-500">… lade Einsätze</span>}
          </span>
        </div>

        {maVorschlaege.length > 0 ? (
          <div className="rounded-md border border-blue-200 bg-blue-50/60 p-2.5">
            <div className="text-xs font-medium text-blue-800 mb-1.5">
              💡 Im Zeitraum KW {maFenster.von.kw}/{maFenster.von.jahr} – KW {maFenster.bis.kw}/{maFenster.bis.jahr} eingesetzt:
            </div>
            <ul className="space-y-1">
              {maVorschlaege.map((v) => (
                <li key={v.ma.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={form.mitarbeiterIds.includes(v.ma.id)}
                    onChange={() => toggleMa(v.ma.id)}
                    className="rounded"
                  />
                  <span className="font-medium text-gray-900">{v.ma.name}</span>
                  <span className="text-xs text-gray-500">({v.ma.nummer})</span>
                  <div className="ml-auto flex gap-1">
                    {v.rollen.includes('standard') && (
                      <span className="text-[10px] bg-white border border-green-200 text-green-700 px-1.5 py-0.5 rounded">
                        Standard
                      </span>
                    )}
                    {v.rollen.includes('springer') && (
                      <span className="text-[10px] bg-white border border-amber-200 text-amber-700 px-1.5 py-0.5 rounded">
                        Springer
                      </span>
                    )}
                    {!v.ma.isActive && (
                      <span className="text-[10px] bg-gray-100 border border-gray-200 text-gray-500 px-1.5 py-0.5 rounded">
                        inaktiv
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-xs text-gray-400 italic">
            {form.teilgebietIds.length === 0
              ? 'Bitte zuerst ein Teilgebiet wählen.'
              : maLoading
                ? '… ermittle Austräger im gewählten Zeitraum.'
                : 'Keine Treffer im gewählten Zeitraum.'}
          </p>
        )}

        <details
          className="text-sm"
          onToggle={(e) => { if ((e.target as HTMLDetailsElement).open) ladeAlleEinsaetze(); }}
        >
          <summary className="cursor-pointer text-xs text-gray-600 hover:text-gray-800 py-1">
            Weitere Austräger hinzufügen … (jemals in diesem Teilgebiet eingesetzt)
          </summary>
          {form.teilgebietIds.length === 0 ? (
            <p className="mt-2 text-xs text-gray-400 italic">Bitte zuerst ein Teilgebiet wählen.</p>
          ) : alleEinsLoading ? (
            <p className="mt-2 text-xs text-blue-500">… lade Einsatz-Historie</p>
          ) : (() => {
            const kandidaten = maJemals.filter((v) => !istVorgeschlagenMa(v.ma.id));
            if (kandidaten.length === 0) {
              return <p className="mt-2 text-xs text-gray-400 italic">Keine weiteren Austräger mit Historie in diesem Teilgebiet.</p>;
            }
            return (
              <div className="mt-2 max-h-40 overflow-y-auto border border-gray-200 rounded p-2 grid grid-cols-2 gap-1">
                {kandidaten.map((v) => (
                  <label key={v.ma.id} className="flex items-center gap-1.5 text-xs text-gray-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.mitarbeiterIds.includes(v.ma.id)}
                      onChange={() => toggleMa(v.ma.id)}
                      className="rounded"
                    />
                    <span>
                      {v.ma.name} ({v.ma.nummer})
                      {!v.ma.isActive && <span className="ml-1 text-gray-400">· inaktiv</span>}
                    </span>
                  </label>
                ))}
              </div>
            );
          })()}
        </details>

        {form.mitarbeiterIds.some((id) => !istVorgeschlagenMa(id)) && (
          <div className="flex flex-wrap gap-1 pt-1">
            {form.mitarbeiterIds
              .filter((id) => !istVorgeschlagenMa(id))
              .map((id) => {
                const m = maMap.get(id);
                return (
                  <span key={id} className="text-xs bg-gray-100 text-gray-700 px-1.5 py-0.5 rounded inline-flex items-center gap-1">
                    {m?.name ?? id}
                    <button
                      type="button"
                      onClick={() => toggleMa(id)}
                      className="text-gray-400 hover:text-red-500"
                      title="Entfernen"
                    >
                      ✕
                    </button>
                  </span>
                );
              })}
          </div>
        )}
      </div>

      {/* Anmerkung */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Anmerkung</label>
        <textarea
          value={form.anmerkung ?? ''}
          onChange={(e) => setForm((f) => ({ ...f, anmerkung: e.target.value }))}
          rows={3}
          placeholder="Details zur Reklamation..."
          className={inputClass + ' resize-none'}
        />
      </div>

      {/* Mail-Link — Dokumentation der Verarbeitung */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          📧 Mail-Link
          <span className="ml-1 text-xs text-gray-400 font-normal">(Verarbeitung / Korrespondenz)</span>
        </label>
        <div className="flex gap-2">
          <input
            type="url"
            value={form.mailLink}
            onChange={(e) => setForm((f) => ({ ...f, mailLink: e.target.value }))}
            placeholder="https://mail.google.com/mail/u/0/#inbox/..."
            className={inputClass}
          />
          {form.mailLink && /^https?:\/\//i.test(form.mailLink) && (
            <a
              href={form.mailLink}
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 text-xs text-blue-600 hover:text-blue-800 underline self-center px-2"
              title="Mail-Thread öffnen"
            >
              ↗ öffnen
            </a>
          )}
        </div>
      </div>

      {/* Mitgeteilt + Archiv — nebeneinander */}
      <div className="grid grid-cols-2 gap-4">
        <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer p-3 border border-gray-200 rounded-lg hover:bg-gray-50">
          <input
            type="checkbox"
            checked={form.mitgeteilt}
            onChange={(e) => setForm((f) => ({ ...f, mitgeteilt: e.target.checked }))}
            className="rounded"
          />
          Dem Mitarbeiter mitgeteilt
        </label>
        <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer p-3 border border-gray-200 rounded-lg hover:bg-gray-50">
          <input
            type="checkbox"
            checked={form.archiviert}
            onChange={(e) => setForm((f) => ({ ...f, archiviert: e.target.checked }))}
            className="rounded"
          />
          📦 Archiv
        </label>
      </div>

      {error && <p className="text-red-600 text-sm">{error}</p>}

      <div className="flex justify-end gap-3 pt-2">
        <button type="button" onClick={onCancel} className="px-4 py-2 text-sm text-gray-600">
          Abbrechen
        </button>
        <button
          type="submit"
          disabled={saving}
          className="bg-blue-600 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? 'Speichere...' : initial ? 'Speichern' : 'Erfassen'}
        </button>
      </div>
    </form>
  );
}
