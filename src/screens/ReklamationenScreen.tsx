import { useState, useEffect, useMemo, useRef, type FormEvent } from 'react';
import { useApp } from '../context/AppContext';
import AdminPinGate from '../components/AdminPinGate';
import Modal from '../components/Modal';
import { istEinsatzbereit } from '../utils';
import {
  abonniereReklamationen,
  erstelleReklamation,
  aktualisiereReklamation,
  loescheReklamation,
  ladeAusgaben,
  ladeEinsaetze,
} from '../lib/db';
import type { Reklamation, Ausgabe, Einsatz } from '../types';
import {
  findePassendeTeilgebiete,
  findePassendeMitarbeiter,
  reklamationFormState,
  reklamationTgIds,
  reklamationMaIds,
  erstelleOrtZuPlzMap,
  findePlzFuerOrt,
  buildGoogleMapsUrl,
  erstelleOrteVorschlag,
  normalisiereStrasse,
  strasseUnscharfPasst,
} from '../lib/reklamation';
import { getISOWeek, getISOYear } from '../lib/kalender';

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
  const [filterMitgeteilt, setFilterMitgeteilt] = useState<'' | 'offen' | 'mitgeteilt'>('');
  // Such-/Einschränkfilter
  const [filterAnrufer, setFilterAnrufer] = useState('');
  const [filterStrasse, setFilterStrasse] = useState('');
  const [filterTgId, setFilterTgId] = useState('');
  const [filterMaId, setFilterMaId] = useState('');

  useEffect(() => {
    const unsub = abonniereReklamationen(setReklamationen);
    return unsub;
  }, []);

  const gefiltert = useMemo(() => {
    const anruferLower = filterAnrufer.trim().toLowerCase();
    const strasseNorm = filterStrasse.trim() ? normalisiereStrasse(filterStrasse) : '';
    return reklamationen.filter((r) => {
      if (filterMitgeteilt === 'offen' && r.mitgeteilt) return false;
      if (filterMitgeteilt === 'mitgeteilt' && !r.mitgeteilt) return false;
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
      return true;
    });
  }, [reklamationen, filterMitgeteilt, filterAnrufer, filterStrasse, filterTgId, filterMaId]);

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
    !!filterAnrufer || !!filterStrasse || !!filterTgId || !!filterMaId;

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

  return (
    <div className="p-4 md:p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Reklamationen</h1>
          <p className="text-gray-500 text-sm">
            {reklamationen.filter((r) => !r.mitgeteilt).length} offen ·{' '}
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
        {(['', 'offen', 'mitgeteilt'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilterMitgeteilt(f)}
            className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${
              filterMitgeteilt === f
                ? 'bg-blue-600 text-white border-blue-600'
                : 'bg-white text-gray-600 border-gray-300 hover:border-gray-400'
            }`}
          >
            {f === '' ? 'Alle' : f === 'offen' ? 'Offen' : 'Mitgeteilt'}
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
        </div>
        {hatSuchfilter && (
          <div className="mt-2 text-right">
            <button
              type="button"
              onClick={() => { setFilterAnrufer(''); setFilterStrasse(''); setFilterTgId(''); setFilterMaId(''); }}
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
                    {!r.briefkastenVorhanden && (
                      <span className="text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">Kein BK</span>
                    )}
                    {r.aufkleberKeineWerbung && (
                      <span className="text-xs bg-red-100 text-red-700 px-1.5 py-0.5 rounded">Aufkleber</span>
                    )}
                    {r.schonMalMitgeteilt && (
                      <span className="text-xs bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded">Wiederholt</span>
                    )}
                    {r.seitWann && (
                      <span className="text-xs text-gray-400">seit {new Date(r.seitWann).toLocaleDateString('de-DE')}</span>
                    )}
                    {r.mailLink && /^https?:\/\//i.test(r.mailLink) && (
                      <a
                        href={r.mailLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="text-xs text-blue-600 hover:text-blue-800 underline"
                        title="Mail-Thread öffnen"
                      >
                        📧 Mail
                      </a>
                    )}
                  </div>
                  {r.anmerkung && (
                    <div className="text-xs text-gray-500 mt-0.5 truncate max-w-[16rem]" title={r.anmerkung}>
                      {r.anmerkung}
                    </div>
                  )}
                </td>
                <td className="px-4 py-3">
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
  const [form, setForm] = useState(() => reklamationFormState(initial));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Cache geladener Daten pro Form-Open — Ausgaben einmal, Einsätze
  // gruppiert pro ausgabeId.
  const ausgabenRef = useRef<Ausgabe[] | null>(null);
  const einsaetzeCacheRef = useRef<Map<string, Einsatz[]>>(new Map());
  // Geladene Einsätze für die relevanten Ausgaben — Trigger für MA-Match.
  const [relevanteEinsaetze, setRelevanteEinsaetze] = useState<Einsatz[]>([]);
  const [maLoading, setMaLoading] = useState(false);

  const aktiveAustraeger = mitarbeiter.filter(
    (m) => istEinsatzbereit(m) && (m.rollen.includes('austräger') || m.rollen.includes('zusammenträger'))
  );

  // TG-Vorschlag — synchron, memoiziert auf Adresse + TG-Liste.
  const tgVorschlaege = useMemo(
    () => findePassendeTeilgebiete(form.strasse, form.plz, form.ort, teilgebiete),
    [form.strasse, form.plz, form.ort, teilgebiete]
  );

  // Bei Adressänderung Vorschläge in die Auswahl übernehmen — aber nur,
  // wenn die User-Auswahl ausschließlich aus früheren Vorschlägen oder
  // leer war (sonst nicht überschreiben).
  const vorschlagsIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const neuVorgeschlagen = new Set(tgVorschlaege.map((v) => v.tg.id));
    setForm((f) => {
      const manuellHinzu = f.teilgebietIds.filter((id) => !vorschlagsIdsRef.current.has(id));
      const neu = Array.from(new Set([...Array.from(neuVorgeschlagen), ...manuellHinzu]));
      vorschlagsIdsRef.current = neuVorgeschlagen;
      // Falls neue Auswahl = alte Auswahl → State nicht ändern (vermeidet
      // unnötige Re-Renders bei stabiler Adresse).
      if (
        neu.length === f.teilgebietIds.length &&
        neu.every((id) => f.teilgebietIds.includes(id))
      ) {
        return f;
      }
      return { ...f, teilgebietIds: neu };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tgVorschlaege]);

  // Einsätze für MA-Match lazy laden, sobald seitWann + TG-Auswahl vorhanden.
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
      const heute = new Date();
      const heuteJahr = getISOYear(heute);
      const heuteKw = getISOWeek(heute);
      const seitWannDate = form.seitWann ? new Date(form.seitWann) : null;
      const seitJahr = seitWannDate ? getISOYear(seitWannDate) : null;
      const seitKw = seitWannDate ? getISOWeek(seitWannDate) : null;

      const relevant = ausgabenRef.current.filter((a) => {
        if (a.jahr > heuteJahr) return false;
        if (a.jahr === heuteJahr && a.kw > heuteKw) return false;
        if (seitJahr !== null && seitKw !== null) {
          if (a.jahr < seitJahr) return false;
          if (a.jahr === seitJahr && a.kw < seitKw) return false;
        }
        return true;
      });

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
  }, [form.seitWann, form.teilgebietIds]);

  // MA-Vorschlag — synchron, memoiziert auf seitWann + TG-Auswahl + Einsätze.
  const maVorschlaege = useMemo(
    () =>
      findePassendeMitarbeiter(form.seitWann, form.teilgebietIds, {
        teilgebiete,
        abrechnungsperioden,
        mitarbeiter,
        einsaetze: relevanteEinsaetze,
      }),
    [form.seitWann, form.teilgebietIds, teilgebiete, abrechnungsperioden, mitarbeiter, relevanteEinsaetze]
  );

  // Vorschläge auch in MA-Auswahl übernehmen — analog zu TGs.
  const maVorschlagsIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const neuVorgeschlagen = new Set(maVorschlaege.map((v) => v.ma.id));
    setForm((f) => {
      const manuellHinzu = f.mitarbeiterIds.filter((id) => !maVorschlagsIdsRef.current.has(id));
      const neu = Array.from(new Set([...Array.from(neuVorgeschlagen), ...manuellHinzu]));
      maVorschlagsIdsRef.current = neuVorgeschlagen;
      if (
        neu.length === f.mitarbeiterIds.length &&
        neu.every((id) => f.mitarbeiterIds.includes(id))
      ) {
        return f;
      }
      return { ...f, mitarbeiterIds: neu };
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
    setForm((f) => ({
      ...f,
      teilgebietIds: f.teilgebietIds.includes(id)
        ? f.teilgebietIds.filter((x) => x !== id)
        : [...f.teilgebietIds, id],
    }));
  }
  function toggleMa(id: string) {
    setForm((f) => ({
      ...f,
      mitarbeiterIds: f.mitarbeiterIds.includes(id)
        ? f.mitarbeiterIds.filter((x) => x !== id)
        : [...f.mitarbeiterIds, id],
    }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!form.anruferName.trim()) { setError('Name des Anrufers ist erforderlich.'); return; }
    // Validierung: seitWann darf nicht in der Zukunft liegen.
    if (form.seitWann) {
      const heuteIso = new Date().toISOString().slice(0, 10);
      if (form.seitWann > heuteIso) {
        setError('„Problem bekannt seit" darf nicht in der Zukunft liegen.');
        return;
      }
    }
    setSaving(true);
    setError('');
    try {
      // Plural-Felder schreiben. Singular-Felder werden NICHT mehr gesetzt
      // — alte Datensätze bleiben für Anzeige-Zwecke unverändert.
      const payload: Partial<Reklamation> = {
        anruferName: form.anruferName,
        telefon: form.telefon || undefined,
        email: form.email || undefined,
        strasse: form.strasse || undefined,
        hausnummer: form.hausnummer || undefined,
        plz: form.plz || undefined,
        ort: form.ort || undefined,
        briefkastenVorhanden: form.briefkastenVorhanden,
        aufkleberKeineWerbung: form.aufkleberKeineWerbung,
        anmerkung: form.anmerkung || undefined,
        teilgebietIds: form.teilgebietIds.length > 0 ? form.teilgebietIds : undefined,
        mitarbeiterIds: form.mitarbeiterIds.length > 0 ? form.mitarbeiterIds : undefined,
        mitgeteilt: form.mitgeteilt,
        seitWann: form.seitWann || undefined,
        schonMalMitgeteilt: form.schonMalMitgeteilt,
        mailLink: form.mailLink || undefined,
      };
      if (initial) {
        await aktualisiereReklamation(initial.id, payload);
      } else {
        // Pflichtfelder, die der Type ohne `Partial` verlangt:
        await erstelleReklamation({
          anruferName: payload.anruferName!,
          telefon: payload.telefon,
          email: payload.email,
          strasse: payload.strasse,
          hausnummer: payload.hausnummer,
          plz: payload.plz,
          ort: payload.ort,
          briefkastenVorhanden: payload.briefkastenVorhanden!,
          aufkleberKeineWerbung: payload.aufkleberKeineWerbung!,
          anmerkung: payload.anmerkung,
          teilgebietIds: payload.teilgebietIds,
          mitarbeiterIds: payload.mitarbeiterIds,
          mitgeteilt: payload.mitgeteilt!,
          seitWann: payload.seitWann,
          schonMalMitgeteilt: payload.schonMalMitgeteilt!,
          mailLink: payload.mailLink,
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

      {/* Adresse — Basis für die TG-Vorschlagslogik */}
      <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-xs font-semibold text-gray-600">📍 Adresse (Basis für TG-Vorschlag)</div>
          {mapsUrl && (
            <a
              href={mapsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-blue-600 hover:text-blue-800 underline inline-flex items-center gap-1"
              title="Adresse auf Google Maps öffnen"
            >
              🗺️ Auf Google Maps ansehen
            </a>
          )}
        </div>
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

      {/* Briefkasten & Aufkleber */}
      <div className="grid grid-cols-2 gap-4">
        <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer p-3 border border-gray-200 rounded-lg hover:bg-gray-50">
          <input
            type="checkbox"
            checked={form.briefkastenVorhanden}
            onChange={(e) => setForm((f) => ({ ...f, briefkastenVorhanden: e.target.checked }))}
            className="rounded"
          />
          Briefkasten vorhanden
        </label>
        <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer p-3 border border-gray-200 rounded-lg hover:bg-gray-50">
          <input
            type="checkbox"
            checked={form.aufkleberKeineWerbung}
            onChange={(e) => setForm((f) => ({ ...f, aufkleberKeineWerbung: e.target.checked }))}
            className="rounded"
          />
          Aufkleber „Keine Werbung"
        </label>
      </div>

      {/* Zeitangaben — VOR der MA-Zuordnung, damit der MA-Vorschlag greift */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Problem bekannt seit</label>
          <input
            type="date"
            value={form.seitWann ?? ''}
            max={new Date().toISOString().slice(0, 10)}
            onChange={(e) => setForm((f) => ({ ...f, seitWann: e.target.value }))}
            className={inputClass}
          />
          <p className="text-[11px] text-gray-400 mt-1">
            Steuert den Zeitraum, in dem nach Austrägern / Springern gesucht wird.
          </p>
        </div>
        <div className="flex flex-col gap-2 justify-end">
          <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer p-3 border border-gray-200 rounded-lg hover:bg-gray-50">
            <input
              type="checkbox"
              checked={form.schonMalMitgeteilt}
              onChange={(e) => setForm((f) => ({ ...f, schonMalMitgeteilt: e.target.checked }))}
              className="rounded"
            />
            Schon mal mitgeteilt
          </label>
        </div>
      </div>

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
              💡 Aus dem Zeitraum „{form.seitWann || 'aktuell'}" → heute:
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

        <details className="text-sm">
          <summary className="cursor-pointer text-xs text-gray-600 hover:text-gray-800 py-1">
            Weitere Austräger hinzufügen …
          </summary>
          <div className="mt-2 max-h-40 overflow-y-auto border border-gray-200 rounded p-2 grid grid-cols-2 gap-1">
            {[...aktiveAustraeger]
              .sort((a, b) => a.name.localeCompare(b.name))
              .filter((m) => !istVorgeschlagenMa(m.id))
              .map((m) => (
                <label key={m.id} className="flex items-center gap-1.5 text-xs text-gray-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.mitarbeiterIds.includes(m.id)}
                    onChange={() => toggleMa(m.id)}
                    className="rounded"
                  />
                  <span>{m.name} ({m.nummer})</span>
                </label>
              ))}
          </div>
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

      {/* Mitgeteilt */}
      <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer p-3 border border-gray-200 rounded-lg hover:bg-gray-50">
        <input
          type="checkbox"
          checked={form.mitgeteilt}
          onChange={(e) => setForm((f) => ({ ...f, mitgeteilt: e.target.checked }))}
          className="rounded"
        />
        Dem Mitarbeiter mitgeteilt
      </label>

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
