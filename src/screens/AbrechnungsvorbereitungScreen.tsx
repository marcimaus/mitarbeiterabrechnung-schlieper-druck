// Abrechnungsvorbereitung — Memos je Mitarbeiter, ans Lohnbüro übermittelt
// in einer ausgewählten Abrechnungsperiode.
//
// - Sichtbar für admin + abrechnung.
// - Admin kann Memos als „nur Admin sichtbar" markieren (das Häkchen ist
//   nur für Admin sichtbar/setzbar). Abrechnung sieht diese Memos nicht.
// - Memo enthält Kategorie + Freitext + optionale Abrechnungsperiode-
//   Zuordnung. Solange keine Periode zugeordnet ist, weist der
//   AbrechnungScreen mit einem Banner darauf hin (analog Fahrtkosten).
// - Periode abgeschlossen → Memo ist read-only (gleiches Pattern wie
//   bei den anderen periodengebundenen Daten).

import { useMemo, useState } from 'react';
import { useApp } from '../context/AppContext';
import AdminPinGate from '../components/AdminPinGate';
import Modal from '../components/Modal';
import {
  erstelleMitarbeiterMemo,
  aktualisiereMitarbeiterMemo,
  loescheMitarbeiterMemo,
  speichereMemoKategorien,
} from '../lib/db';
import type {
  Mitarbeiter,
  MitarbeiterMemo,
  MemoKategorie,
  Rolle,
  Abrechnungsperiode,
} from '../types';
import {
  MEMO_KATEGORIE_LABELS,
  ROLLEN_LABELS,
  alleMemoKategorien,
  memoKategorieLabel,
} from '../types';

const ALLE_ROLLEN = Object.keys(ROLLEN_LABELS) as Rolle[];

export default function AbrechnungsvorbereitungScreen() {
  return (
    <AdminPinGate allowedRoles={['admin', 'abrechnung']}>
      <Inhalt />
    </AdminPinGate>
  );
}

function Inhalt() {
  const { mitarbeiter, abrechnungsperioden, mitarbeiterMemos, userRole, adminName } = useApp();
  const istAdmin = userRole === 'admin';

  // ---- Filterleiste (analog MitarbeiterScreen, ohne Interessenten) ----
  const [filterText, setFilterText] = useState('');
  const [filterOrtPlz, setFilterOrtPlz] = useState('');
  const [filterRolle, setFilterRolle] = useState<Rolle | ''>('');
  const [filterMinijob, setFilterMinijob] = useState<'' | 'ja' | 'nein'>('');
  const [filterSvFrei, setFilterSvFrei] = useState<'' | 'ja' | 'nein'>('');
  const [filterAnmeldung, setFilterAnmeldung] = useState<'' | 'offen' | 'angemeldet' | 'abgemeldet'>('');
  const [nurAktive, setNurAktive] = useState(true);
  const [nurMitMemos, setNurMitMemos] = useState(false);
  /**
   * Periodenfilter — wirken auf BEIDES: die MA-Liste (nur MAs mit
   * passenden Memos werden gezeigt) UND auf die Memos im Panel je MA.
   * Jahr und Monat sind unabhängig wählbar. Zusätzlich kann „nur
   * unzugeordnete" Memos selektiert werden — überdeckt Jahr/Monat.
   */
  // Vorbelegung: aktuelles Jahr + aktueller Monat.
  const [filterJahr, setFilterJahr] = useState<number | ''>(() => new Date().getFullYear());
  const [filterMonat, setFilterMonat] = useState<number | ''>(() => new Date().getMonth() + 1);
  const [nurUnzugeordnet, setNurUnzugeordnet] = useState(false);
  const filterPeriodeAktiv = nurUnzugeordnet || filterJahr !== '' || filterMonat !== '';

  const [neuesMemoOffen, setNeuesMemoOffen] = useState(false);
  const [kategorienOffen, setKategorienOffen] = useState(false);

  /** Map: Periode-ID → Periode (für schnellen Lookup beim Filtern). */
  const periodeById = useMemo(
    () => new Map(abrechnungsperioden.map((p) => [p.id, p])),
    [abrechnungsperioden],
  );

  /** Liefert die Memos für einen MA — entsprechend der Sichtbarkeit + den
   *  Filtern. */
  function memosFuerMa(maId: string): MitarbeiterMemo[] {
    const sichtbar = sichtbareMemosFuerMa(mitarbeiterMemos, maId, istAdmin);
    if (nurUnzugeordnet) {
      return sichtbar.filter((memo) => !memo.abrechnungsperiodeId);
    }
    if (filterJahr === '' && filterMonat === '') return sichtbar;
    return sichtbar.filter((memo) => {
      if (!memo.abrechnungsperiodeId) return false;
      const periode = periodeById.get(memo.abrechnungsperiodeId);
      if (!periode) return false;
      if (filterJahr !== '' && periode.jahr !== filterJahr) return false;
      if (filterMonat !== '' && periode.monat !== filterMonat) return false;
      return true;
    });
  }

  /** Jahres-Auswahl: alle Jahre, die mindestens eine Periode haben. */
  const jahreInPerioden = useMemo(() => {
    const s = new Set<number>();
    for (const p of abrechnungsperioden) s.add(p.jahr);
    return [...s].sort((a, b) => b - a);
  }, [abrechnungsperioden]);

  const MONATSNAMEN = [
    'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
    'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
  ];

  const gefiltert = useMemo(() => {
    return mitarbeiter.filter((m) => {
      if (m.istInteressent) return false;
      if (nurAktive && !m.isActive) return false;
      if (filterText && !m.name.toLowerCase().includes(filterText.toLowerCase()) && !m.nummer.includes(filterText)) return false;
      if (filterOrtPlz.trim()) {
        const q = filterOrtPlz.trim().toLowerCase();
        const plz = (m.adresse?.plz ?? '').toLowerCase();
        const ort = (m.adresse?.ort ?? '').toLowerCase();
        if (!plz.includes(q) && !ort.includes(q)) return false;
      }
      if (filterRolle && !m.rollen.includes(filterRolle)) return false;
      if (filterMinijob === 'ja' && !m.istMinijob) return false;
      if (filterMinijob === 'nein' && m.istMinijob) return false;
      if (filterSvFrei === 'ja' && !m.sozialversicherungsBefreit) return false;
      if (filterSvFrei === 'nein' && m.sozialversicherungsBefreit) return false;
      if (filterAnmeldung === 'offen' && !m.nochNichtAngemeldet) return false;
      if (filterAnmeldung === 'angemeldet' && (m.nochNichtAngemeldet || m.abgemeldet)) return false;
      if (filterAnmeldung === 'abgemeldet' && !m.abgemeldet) return false;
      // „Nur mit Memo": prüfen anhand der gefilterten Memos (siehe
      // memosFuerMa) — damit der Filter sich mit dem Periodenfilter
      // kombiniert (= „nur MAs mit Memo IN DIESER Periode").
      if (nurMitMemos || filterPeriodeAktiv) {
        if (memosFuerMa(m.id).length === 0) return false;
      }
      return true;
    }).sort((a, b) => a.name.localeCompare(b.name, 'de'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mitarbeiter, mitarbeiterMemos, istAdmin, filterText, filterOrtPlz, filterRolle, filterMinijob, filterSvFrei, filterAnmeldung, nurAktive, nurMitMemos, filterJahr, filterMonat, nurUnzugeordnet]);

  // Periodenliste — sortiert nach Jahr/Monat absteigend (neueste zuerst).
  const periodenSortiert = useMemo(
    () => [...abrechnungsperioden].sort((a, b) =>
      b.jahr !== a.jahr ? b.jahr - a.jahr : b.monat - a.monat,
    ),
    [abrechnungsperioden],
  );

  // Schnellansicht: wieviele unzugeordnete Memos hat der aktuelle User sichtbar?
  const sichtbareMemos = useMemo(
    () => mitarbeiterMemos.filter((m) => istAdmin || !m.nurAdmin),
    [mitarbeiterMemos, istAdmin],
  );
  const unzugeordnet = sichtbareMemos.filter((m) => !m.abrechnungsperiodeId).length;

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-2">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Abrechnungsvorbereitung</h1>
          <p className="text-gray-500 text-sm">
            Memos je Mitarbeiter — werden bei der Lohnübermittlung an das Lohnbüro mitgeschickt.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setKategorienOffen(true)}
            className="text-sm font-medium text-gray-700 border border-gray-300 hover:bg-gray-50 px-3 py-2 rounded-lg transition-colors"
            title="Liste der Memo-Betreffe (Kategorien) erweitern / bearbeiten"
          >
            ⚙ Betreffe verwalten
          </button>
          <button
            type="button"
            onClick={() => setNeuesMemoOffen(true)}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg shadow-sm transition-colors"
          >
            + Neues Memo
          </button>
        </div>
      </div>

      <MemoKategorienModal
        isOpen={kategorienOffen}
        onClose={() => setKategorienOffen(false)}
      />

      <NeuesMemoModal
        isOpen={neuesMemoOffen}
        onClose={() => setNeuesMemoOffen(false)}
        mitarbeiter={mitarbeiter.filter((m) => !m.istInteressent && m.isActive)}
        alleMitarbeiter={mitarbeiter.filter((m) => !m.istInteressent)}
        perioden={periodenSortiert}
        istAdmin={istAdmin}
        adminName={adminName}
        userRole={userRole}
      />

      {unzugeordnet > 0 && (
        <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900">
          ⚠ <strong>{unzugeordnet}</strong> Memo{unzugeordnet === 1 ? '' : 's'} ohne
          Abrechnungsperiode — bitte einer Periode zuordnen, sonst werden sie
          nicht ans Lohnbüro übermittelt.
        </div>
      )}

      {/* Filter */}
      <div className="flex flex-wrap gap-3 mb-4">
        <input
          type="text"
          placeholder="Name oder Nummer suchen..."
          value={filterText}
          onChange={(e) => setFilterText(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-52"
        />
        <input
          type="text"
          placeholder="Ort oder PLZ..."
          value={filterOrtPlz}
          onChange={(e) => setFilterOrtPlz(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-36"
        />
        <select
          value={filterRolle}
          onChange={(e) => setFilterRolle(e.target.value as Rolle | '')}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">Alle Rollen</option>
          {ALLE_ROLLEN.map((r) => (
            <option key={r} value={r}>{ROLLEN_LABELS[r]}</option>
          ))}
        </select>
        <select
          value={filterMinijob}
          onChange={(e) => setFilterMinijob(e.target.value as '' | 'ja' | 'nein')}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">Minijob: alle</option>
          <option value="ja">nur Minijob</option>
          <option value="nein">nur kein Minijob</option>
        </select>
        <select
          value={filterSvFrei}
          onChange={(e) => setFilterSvFrei(e.target.value as '' | 'ja' | 'nein')}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">SV-Befreiung: alle</option>
          <option value="ja">nur SV-befreit</option>
          <option value="nein">nur nicht SV-befreit</option>
        </select>
        <select
          value={filterAnmeldung}
          onChange={(e) => setFilterAnmeldung(e.target.value as '' | 'offen' | 'angemeldet' | 'abgemeldet')}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">Anmeldung: alle</option>
          <option value="offen">⏳ noch nicht angemeldet</option>
          <option value="angemeldet">✓ angemeldet</option>
          <option value="abgemeldet">🚪 abgemeldet</option>
        </select>
        <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
          <input
            type="checkbox"
            checked={nurAktive}
            onChange={(e) => setNurAktive(e.target.checked)}
            className="rounded"
          />
          Nur aktive
        </label>
        <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
          <input
            type="checkbox"
            checked={nurMitMemos}
            onChange={(e) => setNurMitMemos(e.target.checked)}
            className="rounded"
          />
          Nur mit Memo
        </label>
        <select
          value={filterJahr === '' ? '' : String(filterJahr)}
          onChange={(e) => setFilterJahr(e.target.value === '' ? '' : Number(e.target.value))}
          disabled={nurUnzugeordnet}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-400"
          title="Memos nach Jahr der zugeordneten Periode filtern"
        >
          <option value="">Jahr: alle</option>
          {jahreInPerioden.map((j) => (
            <option key={j} value={String(j)}>{j}</option>
          ))}
        </select>
        <select
          value={filterMonat === '' ? '' : String(filterMonat)}
          onChange={(e) => setFilterMonat(e.target.value === '' ? '' : Number(e.target.value))}
          disabled={nurUnzugeordnet}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-400"
          title="Memos nach Monat der zugeordneten Periode filtern"
        >
          <option value="">Monat: alle</option>
          {MONATSNAMEN.map((label, idx) => (
            <option key={idx + 1} value={String(idx + 1)}>{label}</option>
          ))}
        </select>
        <label
          className={`flex items-center gap-2 text-sm cursor-pointer ${
            nurUnzugeordnet ? 'text-amber-700 font-medium' : 'text-gray-600'
          }`}
          title="Nur Memos ohne zugeordnete Abrechnungsperiode"
        >
          <input
            type="checkbox"
            checked={nurUnzugeordnet}
            onChange={(e) => setNurUnzugeordnet(e.target.checked)}
            className="rounded"
          />
          ⚠ Nur unzugeordnete
        </label>
      </div>

      {/* MA-Liste mit Memo-Panels */}
      <div className="space-y-2">
        {gefiltert.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 p-6 text-center text-gray-400 text-sm">
            Keine Mitarbeiter gefunden
          </div>
        ) : (
          gefiltert.map((m) => (
            <MitarbeiterMemoZeile
              key={m.id}
              ma={m}
              memos={memosFuerMa(m.id)}
              perioden={periodenSortiert}
              istAdmin={istAdmin}
              adminName={adminName}
              userRole={userRole}
              filterAktiv={filterPeriodeAktiv}
            />
          ))
        )}
      </div>
    </div>
  );
}

function sichtbareMemosFuerMa(
  alleMemos: MitarbeiterMemo[],
  maId: string,
  istAdmin: boolean,
): MitarbeiterMemo[] {
  return alleMemos
    .filter((memo) => memo.mitarbeiterId === maId)
    .filter((memo) => istAdmin || !memo.nurAdmin)
    .sort((a, b) => b.erstelltAm - a.erstelltAm);
}

function MitarbeiterMemoZeile({
  ma,
  memos,
  perioden,
  istAdmin,
  adminName,
  userRole,
  filterAktiv,
}: {
  ma: Mitarbeiter;
  memos: MitarbeiterMemo[];
  perioden: Abrechnungsperiode[];
  istAdmin: boolean;
  adminName: string;
  userRole: 'admin' | 'abrechnung' | 'mitarbeiter' | null;
  /** Wenn Periodenfilter aktiv → Zeile automatisch ausklappen, weil
   *  der User gezielt nach diesen Memos sucht. */
  filterAktiv: boolean;
}) {
  const [expandiert, setExpandiert] = useState(memos.length > 0 || filterAktiv);
  return (
    <div className="bg-white rounded-xl border border-gray-200">
      <button
        type="button"
        onClick={() => setExpandiert((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <span className="font-semibold text-gray-900">{ma.name}</span>
          <span className="text-xs text-gray-400 font-mono">{ma.nummer}</span>
          {memos.length > 0 && (
            <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">
              {memos.length} Memo{memos.length === 1 ? '' : 's'}
            </span>
          )}
          {memos.some((mm) => !mm.abrechnungsperiodeId) && (
            <span className="text-xs text-amber-600">⚠ nicht zugeordnet</span>
          )}
        </div>
        <span className="text-gray-400 text-sm">{expandiert ? '▾' : '▸'}</span>
      </button>
      {expandiert && (
        <div className="px-4 pb-4 space-y-3 border-t border-gray-100">
          {memos.map((memo) => (
            <MemoEintrag
              key={memo.id}
              memo={memo}
              perioden={perioden}
              istAdmin={istAdmin}
              adminName={adminName}
              userRole={userRole}
            />
          ))}
          <NeuesMemoForm
            maId={ma.id}
            perioden={perioden}
            istAdmin={istAdmin}
            adminName={adminName}
            userRole={userRole}
          />
        </div>
      )}
    </div>
  );
}

function MemoEintrag({
  memo,
  perioden,
  istAdmin,
  adminName: _adminName,
  userRole,
}: {
  memo: MitarbeiterMemo;
  perioden: Abrechnungsperiode[];
  istAdmin: boolean;
  adminName: string;
  userRole: 'admin' | 'abrechnung' | 'mitarbeiter' | null;
}) {
  void _adminName;
  void userRole;
  const { memoKategorienEigene } = useApp();
  const periode = perioden.find((p) => p.id === memo.abrechnungsperiodeId);
  const istAbgeschlossen = periode?.status === 'abgeschlossen';
  const [bearbeitet, setBearbeitet] = useState(false);
  const [textEdit, setTextEdit] = useState(memo.text);
  const [kategorieEdit, setKategorieEdit] = useState<MemoKategorie>(memo.kategorie);
  const [periodeIdEdit, setPeriodeIdEdit] = useState(memo.abrechnungsperiodeId ?? '');
  const [linkEdit, setLinkEdit] = useState(memo.externerLink ?? '');
  const [nurAdminEdit, setNurAdminEdit] = useState<boolean>(memo.nurAdmin === true);

  async function speichern() {
    if (!textEdit.trim()) return;
    await aktualisiereMitarbeiterMemo(memo.id, {
      kategorie: kategorieEdit,
      text: textEdit.trim(),
      abrechnungsperiodeId: periodeIdEdit || undefined,
      externerLink: linkEdit.trim() || undefined,
      // Nur Admin darf das Flag setzen. Falls Abrechnung editiert,
      // bleibt das ursprüngliche Flag erhalten.
      nurAdmin: istAdmin ? nurAdminEdit : memo.nurAdmin,
    });
    setBearbeitet(false);
  }

  async function loeschen() {
    if (!confirm('Memo wirklich löschen?')) return;
    await loescheMitarbeiterMemo(memo.id);
  }

  // Read-only-Zustand: abgeschlossene Periode → keine Bearbeitung mehr.
  const readOnly = istAbgeschlossen;

  return (
    <div className={`rounded-lg border ${memo.nurAdmin ? 'border-red-200 bg-red-50/40' : 'border-gray-200 bg-gray-50/40'} p-3`}>
      {!bearbeitet ? (
        <>
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1 flex-wrap">
                <span className="text-xs font-medium text-blue-700 bg-blue-100 px-2 py-0.5 rounded">
                  {memoKategorieLabel(memo.kategorie, memoKategorienEigene)}
                </span>
                {memo.abrechnungsperiodeId ? (
                  <span className="text-xs text-gray-600">
                    → {periode?.bezeichnung ?? '(gelöschte Periode)'}
                    {istAbgeschlossen && (
                      <span className="ml-1 text-gray-500" title="Periode abgeschlossen">🔒</span>
                    )}
                  </span>
                ) : (
                  <span className="text-xs text-amber-700">⚠ keine Periode zugeordnet</span>
                )}
                {memo.nurAdmin && (
                  <span className="text-[10px] bg-red-100 text-red-700 px-1.5 py-0.5 rounded" title="Nur für Admin sichtbar">
                    🔒 nur Admin
                  </span>
                )}
                {memo.externerLink?.trim() && (
                  <a
                    href={memo.externerLink.trim()}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[10px] bg-blue-50 hover:bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded border border-blue-200"
                    title={memo.externerLink}
                  >
                    🔗 öffnen
                  </a>
                )}
              </div>
              <div className="text-sm text-gray-800 whitespace-pre-wrap break-words">{memo.text}</div>
              <div className="text-[10px] text-gray-400 mt-1">
                {new Date(memo.erstelltAm).toLocaleString('de-DE')} ·
                {' '}von {memo.erstellerName || memo.erstellerRolle}
                {memo.aktualisiertAm > memo.erstelltAm + 1000 && (
                  <span> · bearb. {new Date(memo.aktualisiertAm).toLocaleString('de-DE')}</span>
                )}
              </div>
            </div>
            {!readOnly && (
              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={() => setBearbeitet(true)}
                  className="text-xs text-blue-600 hover:text-blue-800 px-2"
                  title="Memo bearbeiten"
                >
                  ✎
                </button>
                <button
                  type="button"
                  onClick={loeschen}
                  className="text-xs text-red-500 hover:text-red-700 px-2"
                  title="Memo löschen"
                >
                  ✕
                </button>
              </div>
            )}
          </div>
        </>
      ) : (
        <div className="space-y-2">
          <div className="flex gap-2">
            <select
              value={kategorieEdit}
              onChange={(e) => setKategorieEdit(e.target.value as MemoKategorie)}
              className="border border-gray-300 rounded px-2 py-1 text-sm"
            >
              <KategorieOptionen aktuell={kategorieEdit} />
            </select>
            <select
              value={periodeIdEdit}
              onChange={(e) => setPeriodeIdEdit(e.target.value)}
              className="border border-gray-300 rounded px-2 py-1 text-sm flex-1"
            >
              <option value="">— keine Periode zugeordnet —</option>
              {perioden.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.bezeichnung}{p.status === 'abgeschlossen' ? ' 🔒' : ''}
                </option>
              ))}
            </select>
          </div>
          <textarea
            value={textEdit}
            onChange={(e) => setTextEdit(e.target.value)}
            rows={3}
            className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
            placeholder="Memo-Text…"
          />
          <div className="flex items-center gap-1">
            <input
              type="url"
              value={linkEdit}
              onChange={(e) => setLinkEdit(e.target.value)}
              placeholder="Externer Link (optional, z. B. Mail-Thread, PDF)"
              className="flex-1 border border-gray-300 rounded px-2 py-1 text-sm"
            />
            {linkEdit.trim() && (
              <a
                href={linkEdit.trim()}
                target="_blank"
                rel="noreferrer"
                className="text-xs border border-blue-200 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded px-2 py-1"
                title="Link in neuem Tab öffnen"
              >
                🔗
              </a>
            )}
          </div>
          {istAdmin && (
            <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer">
              <input
                type="checkbox"
                checked={nurAdminEdit}
                onChange={(e) => setNurAdminEdit(e.target.checked)}
                className="rounded"
              />
              🔒 Nur für Admin sichtbar (Abrechnung sieht dieses Memo nicht)
            </label>
          )}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={speichern}
              disabled={!textEdit.trim()}
              className="text-xs bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white px-3 py-1 rounded"
            >
              Speichern
            </button>
            <button
              type="button"
              onClick={() => {
                setBearbeitet(false);
                setTextEdit(memo.text);
                setKategorieEdit(memo.kategorie);
                setPeriodeIdEdit(memo.abrechnungsperiodeId ?? '');
                setLinkEdit(memo.externerLink ?? '');
                setNurAdminEdit(memo.nurAdmin === true);
              }}
              className="text-xs text-gray-500 hover:text-gray-700"
            >
              Abbrechen
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function NeuesMemoModal({
  isOpen,
  onClose,
  mitarbeiter,
  alleMitarbeiter,
  perioden,
  istAdmin,
  adminName,
  userRole,
}: {
  isOpen: boolean;
  onClose: () => void;
  /** Aktive MA (Vorauswahl-Liste). */
  mitarbeiter: Mitarbeiter[];
  /** Alle MA (inkl. inaktive) für die Suche. */
  alleMitarbeiter: Mitarbeiter[];
  perioden: Abrechnungsperiode[];
  istAdmin: boolean;
  adminName: string;
  userRole: 'admin' | 'abrechnung' | 'mitarbeiter' | null;
}) {
  const [maFilter, setMaFilter] = useState('');
  const [selectedMaId, setSelectedMaId] = useState('');
  const [kategorie, setKategorie] = useState<MemoKategorie>('sonstiges');
  const [text, setText] = useState('');
  const [periodeId, setPeriodeId] = useState('');
  const [externerLink, setExternerLink] = useState('');
  const [nurAdmin, setNurAdmin] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showInaktive, setShowInaktive] = useState(false);

  const quelle = showInaktive ? alleMitarbeiter : mitarbeiter;
  const gefilterteMas = useMemo(() => {
    const q = maFilter.trim().toLowerCase();
    if (!q) return quelle.sort((a, b) => a.name.localeCompare(b.name, 'de'));
    return quelle
      .filter(
        (m) =>
          m.name.toLowerCase().includes(q) ||
          m.nummer.includes(q),
      )
      .sort((a, b) => a.name.localeCompare(b.name, 'de'));
  }, [quelle, maFilter]);

  const selectedMa = alleMitarbeiter.find((m) => m.id === selectedMaId);

  function reset() {
    setMaFilter('');
    setSelectedMaId('');
    setKategorie('sonstiges');
    setText('');
    setPeriodeId('');
    setExternerLink('');
    setNurAdmin(false);
    setShowInaktive(false);
  }

  function handleClose() {
    reset();
    onClose();
  }

  async function speichern() {
    if (!selectedMaId || !text.trim()) return;
    if (userRole !== 'admin' && userRole !== 'abrechnung') return;
    setSaving(true);
    try {
      await erstelleMitarbeiterMemo({
        mitarbeiterId: selectedMaId,
        kategorie,
        text: text.trim(),
        abrechnungsperiodeId: periodeId || undefined,
        externerLink: externerLink.trim() || undefined,
        nurAdmin: istAdmin ? nurAdmin : false,
        erstellerName: adminName || (istAdmin ? 'Admin' : 'Abrechnung'),
        erstellerRolle: istAdmin ? 'admin' : 'abrechnung',
      });
      reset();
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Neues Memo anlegen" size="lg">
      <div className="space-y-4">
        {/* MA-Auswahl */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Mitarbeiter *</label>
          {!selectedMaId ? (
            <div className="space-y-2">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={maFilter}
                  onChange={(e) => setMaFilter(e.target.value)}
                  placeholder="Name oder Nummer suchen…"
                  autoFocus
                  className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer whitespace-nowrap">
                  <input
                    type="checkbox"
                    checked={showInaktive}
                    onChange={(e) => setShowInaktive(e.target.checked)}
                    className="rounded"
                  />
                  inkl. inaktive
                </label>
              </div>
              <div className="max-h-48 overflow-y-auto border border-gray-200 rounded-lg divide-y divide-gray-100">
                {gefilterteMas.length === 0 ? (
                  <div className="px-3 py-2 text-sm text-gray-400">Keine Treffer</div>
                ) : (
                  gefilterteMas.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => { setSelectedMaId(m.id); setMaFilter(''); }}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50 flex items-center gap-2"
                    >
                      <span className="font-medium text-gray-900">{m.name}</span>
                      <span className="text-xs text-gray-400 font-mono">{m.nummer}</span>
                      {!m.isActive && (
                        <span className="text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">inaktiv</span>
                      )}
                    </button>
                  ))
                )}
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
              <span className="font-medium text-gray-900 flex-1">{selectedMa?.name}</span>
              <span className="text-xs text-gray-500 font-mono">{selectedMa?.nummer}</span>
              <button
                type="button"
                onClick={() => setSelectedMaId('')}
                className="text-xs text-blue-600 hover:text-blue-800 ml-1"
                title="Mitarbeiter ändern"
              >
                ✎ ändern
              </button>
            </div>
          )}
        </div>

        {/* Formular — erst sichtbar wenn MA gewählt */}
        {selectedMaId && (
          <>
            <div className="flex gap-2">
              <div className="flex-shrink-0">
                <label className="block text-xs font-medium text-gray-600 mb-1">Kategorie</label>
                <select
                  value={kategorie}
                  onChange={(e) => setKategorie(e.target.value as MemoKategorie)}
                  className="border border-gray-300 rounded px-2 py-1.5 text-sm"
                >
                  <KategorieOptionen aktuell={kategorie} />
                </select>
              </div>
              <div className="flex-1">
                <label className="block text-xs font-medium text-gray-600 mb-1">Abrechnungsperiode</label>
                <select
                  value={periodeId}
                  onChange={(e) => setPeriodeId(e.target.value)}
                  className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
                >
                  <option value="">— keine Periode zugeordnet —</option>
                  {perioden.map((p) => (
                    <option key={p.id} value={p.id} disabled={p.status === 'abgeschlossen'}>
                      {p.bezeichnung}{p.status === 'abgeschlossen' ? ' 🔒' : ''}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Memo-Text *</label>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={4}
                autoFocus
                className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="z. B. IBAN-Änderung, Auswertungsanfrage, Besonderheit für das Lohnbüro…"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Externer Link <span className="font-normal text-gray-400">(optional — wird nicht ans Lohnbüro übermittelt)</span>
              </label>
              <div className="flex items-center gap-1">
                <input
                  type="url"
                  value={externerLink}
                  onChange={(e) => setExternerLink(e.target.value)}
                  placeholder="https://…"
                  className="flex-1 border border-gray-300 rounded px-3 py-1.5 text-sm"
                />
                {externerLink.trim() && (
                  <a
                    href={externerLink.trim()}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs border border-blue-200 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded px-2 py-1.5"
                  >
                    🔗
                  </a>
                )}
              </div>
            </div>

            {istAdmin && (
              <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
                <input
                  type="checkbox"
                  checked={nurAdmin}
                  onChange={(e) => setNurAdmin(e.target.checked)}
                  className="rounded"
                />
                🔒 Nur für Admin sichtbar (Abrechnung sieht dieses Memo nicht)
              </label>
            )}

            <div className="flex items-center gap-3 pt-1">
              <button
                type="button"
                onClick={speichern}
                disabled={!text.trim() || saving}
                className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
              >
                {saving ? 'Speichert…' : 'Memo speichern'}
              </button>
              <button
                type="button"
                onClick={handleClose}
                className="text-sm text-gray-500 hover:text-gray-700"
              >
                Abbrechen
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

function NeuesMemoForm({
  maId,
  perioden,
  istAdmin,
  adminName,
  userRole,
}: {
  maId: string;
  perioden: Abrechnungsperiode[];
  istAdmin: boolean;
  adminName: string;
  userRole: 'admin' | 'abrechnung' | 'mitarbeiter' | null;
}) {
  const [aktiv, setAktiv] = useState(false);
  const [kategorie, setKategorie] = useState<MemoKategorie>('sonstiges');
  const [text, setText] = useState('');
  const [periodeId, setPeriodeId] = useState('');
  const [externerLink, setExternerLink] = useState('');
  const [nurAdmin, setNurAdmin] = useState(false);
  const [saving, setSaving] = useState(false);

  async function speichern() {
    if (!text.trim()) return;
    if (userRole !== 'admin' && userRole !== 'abrechnung') return;
    setSaving(true);
    try {
      await erstelleMitarbeiterMemo({
        mitarbeiterId: maId,
        kategorie,
        text: text.trim(),
        abrechnungsperiodeId: periodeId || undefined,
        externerLink: externerLink.trim() || undefined,
        nurAdmin: istAdmin ? nurAdmin : false,
        erstellerName: adminName || (istAdmin ? 'Admin' : 'Abrechnung'),
        erstellerRolle: istAdmin ? 'admin' : 'abrechnung',
      });
      setText('');
      setKategorie('sonstiges');
      setPeriodeId('');
      setExternerLink('');
      setNurAdmin(false);
      setAktiv(false);
    } finally {
      setSaving(false);
    }
  }

  if (!aktiv) {
    return (
      <button
        type="button"
        onClick={() => setAktiv(true)}
        className="text-sm text-blue-600 hover:text-blue-800 border border-dashed border-blue-300 hover:border-blue-500 rounded px-3 py-1.5 w-full text-left"
      >
        + Neues Memo anlegen
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-blue-200 bg-blue-50/40 p-3 space-y-2">
      <div className="flex gap-2">
        <select
          value={kategorie}
          onChange={(e) => setKategorie(e.target.value as MemoKategorie)}
          className="border border-gray-300 rounded px-2 py-1 text-sm"
        >
          <KategorieOptionen aktuell={kategorie} />
        </select>
        <select
          value={periodeId}
          onChange={(e) => setPeriodeId(e.target.value)}
          className="border border-gray-300 rounded px-2 py-1 text-sm flex-1"
        >
          <option value="">— Periode zuordnen (optional) —</option>
          {perioden.map((p) => (
            <option key={p.id} value={p.id} disabled={p.status === 'abgeschlossen'}>
              {p.bezeichnung}{p.status === 'abgeschlossen' ? ' 🔒 abgeschlossen' : ''}
            </option>
          ))}
        </select>
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        autoFocus
        className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
        placeholder="Memo-Text — z. B. IBAN-Änderung mit neuer Bankverbindung, Auswertungsanfrage Zeitraum etc."
      />
      <div className="flex items-center gap-1">
        <input
          type="url"
          value={externerLink}
          onChange={(e) => setExternerLink(e.target.value)}
          placeholder="Externer Link (optional, z. B. Mail-Thread, PDF) — wird NICHT ans Lohnbüro übermittelt"
          className="flex-1 border border-gray-300 rounded px-2 py-1 text-sm"
        />
        {externerLink.trim() && (
          <a
            href={externerLink.trim()}
            target="_blank"
            rel="noreferrer"
            className="text-xs border border-blue-200 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded px-2 py-1"
            title="Link in neuem Tab öffnen"
          >
            🔗
          </a>
        )}
      </div>
      {istAdmin && (
        <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer">
          <input
            type="checkbox"
            checked={nurAdmin}
            onChange={(e) => setNurAdmin(e.target.checked)}
            className="rounded"
          />
          🔒 Nur für Admin sichtbar (Abrechnung sieht dieses Memo nicht)
        </label>
      )}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={speichern}
          disabled={!text.trim() || saving}
          className="text-xs bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white px-3 py-1 rounded"
        >
          {saving ? 'Speichert…' : 'Speichern'}
        </button>
        <button
          type="button"
          onClick={() => {
            setAktiv(false);
            setText('');
            setPeriodeId('');
            setExternerLink('');
            setKategorie('sonstiges');
            setNurAdmin(false);
          }}
          className="text-xs text-gray-500 hover:text-gray-700"
        >
          Abbrechen
        </button>
      </div>
    </div>
  );
}

/** <option>-Liste aller Memo-Kategorien (Standard + eigene). Ist die
 *  aktuelle Kategorie unbekannt (z. B. Altbestand), bleibt sie wählbar. */
function KategorieOptionen({ aktuell }: { aktuell: MemoKategorie }) {
  const { memoKategorienEigene } = useApp();
  const liste = alleMemoKategorien(memoKategorienEigene);
  return (
    <>
      {!liste.some((k) => k.id === aktuell) && (
        <option value={aktuell}>{memoKategorieLabel(aktuell, memoKategorienEigene)}</option>
      )}
      {liste.map((k) => (
        <option key={k.id} value={k.id}>{k.label}</option>
      ))}
    </>
  );
}

/** Pflege der eigenen Memo-Kategorien (Betreffe). Standard-Kategorien sind
 *  fest; eigene können angelegt, umbenannt und — solange kein Memo sie
 *  verwendet — gelöscht werden. */
function MemoKategorienModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const { memoKategorienEigene, mitarbeiterMemos } = useApp();
  const [neu, setNeu] = useState('');
  const [editId, setEditId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState('');
  const [saving, setSaving] = useState(false);

  const nutzung = useMemo(() => {
    const m = new Map<string, number>();
    for (const memo of mitarbeiterMemos) m.set(memo.kategorie, (m.get(memo.kategorie) ?? 0) + 1);
    return m;
  }, [mitarbeiterMemos]);

  const eigeneSortiert = [...memoKategorienEigene].sort((a, b) => a.label.localeCompare(b.label, 'de'));

  function labelVergeben(label: string, ausserId?: string): boolean {
    const l = label.trim().toLowerCase();
    return (
      Object.values(MEMO_KATEGORIE_LABELS).some((v) => v.toLowerCase() === l) ||
      memoKategorienEigene.some((k) => k.id !== ausserId && k.label.trim().toLowerCase() === l)
    );
  }

  async function speichern(liste: typeof memoKategorienEigene): Promise<boolean> {
    setSaving(true);
    try {
      await speichereMemoKategorien(liste);
      return true;
    } catch (e) {
      alert('Speichern fehlgeschlagen: ' + (e instanceof Error ? e.message : String(e)));
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function hinzufuegen() {
    const label = neu.trim();
    if (!label) return;
    if (labelVergeben(label)) {
      alert(`Den Betreff „${label}" gibt es bereits.`);
      return;
    }
    const id = `k_${Date.now().toString(36)}`;
    if (await speichern([...memoKategorienEigene, { id, label }])) setNeu('');
  }

  async function umbenennen(id: string) {
    const label = editLabel.trim();
    if (!label) return;
    if (labelVergeben(label, id)) {
      alert(`Den Betreff „${label}" gibt es bereits.`);
      return;
    }
    if (await speichern(memoKategorienEigene.map((k) => (k.id === id ? { ...k, label } : k)))) {
      setEditId(null);
    }
  }

  async function loeschen(id: string, label: string) {
    const anzahl = nutzung.get(id) ?? 0;
    if (anzahl > 0) {
      alert(`„${label}" wird von ${anzahl} Memo${anzahl === 1 ? '' : 's'} verwendet und kann nicht gelöscht werden. Umbenennen ist möglich.`);
      return;
    }
    if (!confirm(`Betreff „${label}" löschen?`)) return;
    await speichern(memoKategorienEigene.filter((k) => k.id !== id));
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Memo-Betreffe verwalten" size="md">
      <div className="space-y-4">
        <div>
          <div className="text-xs font-medium text-gray-500 uppercase mb-1">Standard (fest)</div>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(MEMO_KATEGORIE_LABELS).map(([id, label]) => (
              <span key={id} className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">
                {label}
              </span>
            ))}
          </div>
        </div>

        <div>
          <div className="text-xs font-medium text-gray-500 uppercase mb-1">Eigene Betreffe</div>
          {eigeneSortiert.length === 0 ? (
            <div className="text-sm text-gray-400">Noch keine eigenen Betreffe angelegt.</div>
          ) : (
            <ul className="divide-y divide-gray-100 border border-gray-200 rounded-lg">
              {eigeneSortiert.map((k) => {
                const anzahl = nutzung.get(k.id) ?? 0;
                return (
                  <li key={k.id} className="flex items-center gap-2 px-3 py-1.5">
                    {editId === k.id ? (
                      <>
                        <input
                          type="text"
                          value={editLabel}
                          onChange={(e) => setEditLabel(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') umbenennen(k.id); }}
                          autoFocus
                          className="flex-1 border border-gray-300 rounded px-2 py-1 text-sm"
                        />
                        <button
                          type="button"
                          onClick={() => umbenennen(k.id)}
                          disabled={saving || !editLabel.trim()}
                          className="text-xs bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white px-2 py-1 rounded"
                        >
                          OK
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditId(null)}
                          className="text-xs text-gray-500 hover:text-gray-700"
                        >
                          Abbrechen
                        </button>
                      </>
                    ) : (
                      <>
                        <span className="flex-1 text-sm text-gray-800">{k.label}</span>
                        {anzahl > 0 && (
                          <span className="text-[10px] text-gray-400">{anzahl} Memo{anzahl === 1 ? '' : 's'}</span>
                        )}
                        <button
                          type="button"
                          onClick={() => { setEditId(k.id); setEditLabel(k.label); }}
                          className="text-xs text-blue-600 hover:text-blue-800 px-1"
                          title="Umbenennen"
                        >
                          ✎
                        </button>
                        <button
                          type="button"
                          onClick={() => loeschen(k.id, k.label)}
                          disabled={saving}
                          className={`text-xs px-1 ${anzahl > 0 ? 'text-gray-300 cursor-not-allowed' : 'text-red-500 hover:text-red-700'}`}
                          title={anzahl > 0 ? 'Wird verwendet — nicht löschbar' : 'Löschen'}
                        >
                          ✕
                        </button>
                      </>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="flex gap-2">
          <input
            type="text"
            value={neu}
            onChange={(e) => setNeu(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') hinzufuegen(); }}
            placeholder="Neuer Betreff, z. B. Steuerklassen-Änderung"
            className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            type="button"
            onClick={hinzufuegen}
            disabled={saving || !neu.trim()}
            className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white text-sm font-medium px-4 py-2 rounded-lg"
          >
            + Hinzufügen
          </button>
        </div>
      </div>
    </Modal>
  );
}
