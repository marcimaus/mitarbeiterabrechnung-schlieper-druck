// ============================================================
// Urlaubs-Übersicht (Hauptnavigation)
// ============================================================
//
// Ersetzt den bisherigen Reiter „Urlaub" im MitarbeiterScreen. Statt
// pro MA-Form einen Reiter zu öffnen, hat man hier eine eigene Maske
// mit MA-Auswahl + Jahr/Monat-Filter und einer Detail-Anzeige in einer
// gemeinsamen Tabelle.
//
// Read-only. Bearbeitung erfolgt nach wie vor unter /planung.

import { useEffect, useMemo, useState } from 'react';
import AdminPinGate from '../components/AdminPinGate';
import Modal from '../components/Modal';
import { useApp } from '../context/AppContext';
import { urlaubsListenerProMa } from '../lib/planung';
import { URLAUB_STATUS_LABELS, type UrlaubsEintrag } from '../types';
import { MONATSNAMEN } from '../lib/kalender';

export default function UrlaubScreen() {
  return (
    <AdminPinGate allowedRoles={['admin', 'abrechnung']}>
      <UrlaubScreenInhalt />
    </AdminPinGate>
  );
}

type UrlaubGruppe = {
  key: string;
  datumVon: string;
  datumBis: string;
  eintraege: UrlaubsEintrag[];
  kws: Array<{
    jahr: number;
    kw: number;
    status: UrlaubsEintrag['status'];
    tage: number;
    werktage: string[];
    freigegeben: boolean;
    erstellerName: string;
  }>;
  kommentar?: string;
  externerLink?: string;
  alleFreigegeben: boolean;
};

function UrlaubScreenInhalt() {
  const { mitarbeiter } = useApp();

  // Aktive MAs mit Rolle 'sonstige' bevorzugt — das sind die typischen
  // Urlaubs-Kandidaten. Wir zeigen aber alle aktiven (für Vollständigkeit).
  const auswahlbareMa = useMemo(
    () => mitarbeiter
      .filter((m) => m.isActive && !m.istInteressent)
      .sort((a, b) => a.name.localeCompare(b.name, 'de')),
    [mitarbeiter],
  );

  const [selectedMaId, setSelectedMaId] = useState<string>('');
  // Suchtext für die MA-Auswahl — durchsucht Volltext (Name + Nummer),
  // analog zur Suche im Mitarbeiter-Screen.
  const [suche, setSuche] = useState('');
  // Jahr-Filter: 'alle' = keine Beschränkung, sonst Jahreszahl.
  const [filterJahr, setFilterJahr] = useState<string>('alle');
  // Monat-Filter: '' = alle, sonst 1..12.
  const [filterMonat, setFilterMonat] = useState<string>('');

  const selectedMa = useMemo(
    () => auswahlbareMa.find((m) => m.id === selectedMaId),
    [auswahlbareMa, selectedMaId],
  );

  const sucheTreffer = useMemo(() => {
    const q = suche.trim().toLowerCase();
    if (!q) return [];
    return auswahlbareMa
      .filter((m) =>
        m.name.toLowerCase().includes(q) || m.nummer.includes(suche.trim()),
      )
      .slice(0, 20);
  }, [auswahlbareMa, suche]);

  const [eintraege, setEintraege] = useState<UrlaubsEintrag[] | null>(null);
  const [detail, setDetail] = useState<UrlaubGruppe | null>(null);

  useEffect(() => {
    if (!selectedMaId) {
      setEintraege(null);
      return;
    }
    setEintraege(null);
    const unsub = urlaubsListenerProMa(selectedMaId, setEintraege);
    return () => unsub();
  }, [selectedMaId]);

  // Verfügbare Jahre für den Filter — aus den vorhandenen Einträgen + aktuelles Jahr.
  const verfuegbareJahre = useMemo(() => {
    const s = new Set<number>();
    s.add(new Date().getFullYear());
    if (eintraege) for (const e of eintraege) s.add(e.jahr);
    return Array.from(s).sort((a, b) => b - a);
  }, [eintraege]);

  /**
   * Filter-Anwendung: Ein Eintrag passt zum Filter, wenn mindestens einer
   * seiner Werktage (oder der von/bis-Bereich) im gewählten Jahr/Monat
   * liegt. Mehrwöchige Urlaubsgruppen werden also angezeigt, sobald sie
   * den Filter-Zeitraum berühren.
   */
  const eintraegeGefiltert = useMemo(() => {
    if (!eintraege) return [];
    if (filterJahr === 'alle' && !filterMonat) return eintraege;
    const j = filterJahr === 'alle' ? null : parseInt(filterJahr, 10);
    const m = filterMonat ? parseInt(filterMonat, 10) : null;
    return eintraege.filter((e) => {
      // Schnellpfad: Jahr-Filter ohne Monat → einfach e.jahr vergleichen.
      if (j !== null && m === null) {
        return e.jahr === j;
      }
      // Sonst: prüfe Werktage / von+bis. Wenn werktageInKw vorhanden, daraus
      // direkt Monat ableiten; sonst Fallback aus datumVon..datumBis.
      const tage: string[] =
        e.werktageInKw && e.werktageInKw.length > 0
          ? e.werktageInKw
          : istoBetween(e.datumVon, e.datumBis);
      for (const iso of tage) {
        const d = new Date(iso);
        if (j !== null && d.getFullYear() !== j) continue;
        if (m !== null && d.getMonth() + 1 !== m) continue;
        return true;
      }
      return false;
    });
  }, [eintraege, filterJahr, filterMonat]);

  // Gruppieren nach Urlaubsgruppe (datumVon + datumBis).
  const gruppen = useMemo(() => {
    const map = new Map<string, UrlaubGruppe>();
    for (const e of eintraegeGefiltert) {
      const k = `${e.datumVon ?? ''}|${e.datumBis ?? ''}`;
      const g = map.get(k) ?? {
        key: k,
        datumVon: e.datumVon ?? '',
        datumBis: e.datumBis ?? '',
        eintraege: [],
        kws: [],
        kommentar: e.kommentar,
        externerLink: e.externerLink,
        alleFreigegeben: true,
      };
      g.eintraege.push(e);
      g.kws.push({
        jahr: e.jahr,
        kw: e.kw,
        status: e.status,
        tage: e.werktageInKw?.length ?? 0,
        werktage: e.werktageInKw ?? [],
        freigegeben: e.freigegeben,
        erstellerName: e.erstellerName,
      });
      if (!e.freigegeben) g.alleFreigegeben = false;
      if (!g.kommentar && e.kommentar) g.kommentar = e.kommentar;
      if (!g.externerLink && e.externerLink) g.externerLink = e.externerLink;
      map.set(k, g);
    }
    return Array.from(map.values())
      .map((g) => {
        g.kws.sort((a, b) => a.jahr - b.jahr || a.kw - b.kw);
        g.eintraege.sort((a, b) => a.jahr - b.jahr || a.kw - b.kw);
        return g;
      })
      .sort((a, b) => {
        const av = a.kws[a.kws.length - 1];
        const bv = b.kws[b.kws.length - 1];
        return bv.jahr - av.jahr || bv.kw - av.kw;
      });
  }, [eintraegeGefiltert]);

  const summeTage = eintraegeGefiltert.reduce(
    (s, e) => s + (e.werktageInKw?.length ?? 0),
    0,
  );

  return (
    <div className="p-3 md:p-5 max-w-6xl mx-auto">
      <div className="mb-4">
        <h1 className="text-xl md:text-2xl font-bold text-gray-900">Urlaub</h1>
        <p className="text-xs text-gray-500">
          Urlaubsdaten je Mitarbeiter. Bearbeitung erfolgt in{' '}
          <a href="/planung" className="text-blue-600 hover:underline">Personalplanung → Urlaub</a>.
        </p>
      </div>

      {/* Filter-Leiste */}
      <div className="bg-white border border-gray-200 rounded-lg p-3 md:p-4 mb-4 flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[260px] relative">
          <label className="block text-xs font-medium text-gray-600 mb-1">Mitarbeiter</label>
          {selectedMa ? (
            <div className="flex items-center gap-2 border border-blue-300 bg-blue-50 rounded px-2 py-1.5 text-sm">
              <span className="flex-1 truncate">
                <strong>{selectedMa.name}</strong>
                <span className="ml-2 text-xs font-mono text-gray-500">{selectedMa.nummer}</span>
              </span>
              <button
                type="button"
                onClick={() => { setSelectedMaId(''); setSuche(''); }}
                className="text-xs text-gray-500 hover:text-red-600"
                title="Auswahl löschen"
              >
                ✕
              </button>
            </div>
          ) : (
            <input
              type="text"
              value={suche}
              onChange={(e) => setSuche(e.target.value)}
              placeholder="Name oder Nummer suchen…"
              className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
              autoFocus
            />
          )}
          {/* Trefferliste — nur sichtbar, wenn aktiv gesucht wird und kein MA gewählt ist. */}
          {!selectedMa && suche.trim() && (
            <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-white border border-gray-300 rounded shadow-lg max-h-72 overflow-y-auto">
              {sucheTreffer.length === 0 ? (
                <div className="px-2 py-2 text-xs text-gray-500 italic">
                  Kein Treffer.
                </div>
              ) : (
                sucheTreffer.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => {
                      setSelectedMaId(m.id);
                      setSuche('');
                    }}
                    className="w-full text-left px-2 py-1.5 text-sm hover:bg-blue-50 border-b border-gray-100 last:border-b-0 flex items-center justify-between"
                  >
                    <span className="truncate">{m.name}</span>
                    <span className="ml-2 text-xs font-mono text-gray-500 shrink-0">{m.nummer}</span>
                  </button>
                ))
              )}
            </div>
          )}
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Jahr</label>
          <select
            value={filterJahr}
            onChange={(e) => setFilterJahr(e.target.value)}
            className="border border-gray-300 rounded px-2 py-1.5 text-sm"
          >
            <option value="alle">alle</option>
            {verfuegbareJahre.map((j) => (
              <option key={j} value={String(j)}>{j}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Monat</label>
          <select
            value={filterMonat}
            onChange={(e) => setFilterMonat(e.target.value)}
            className="border border-gray-300 rounded px-2 py-1.5 text-sm"
          >
            <option value="">alle</option>
            {MONATSNAMEN.map((name, i) => (
              <option key={i + 1} value={String(i + 1)}>{name}</option>
            ))}
          </select>
        </div>

        {(filterJahr !== 'alle' || filterMonat) && (
          <button
            type="button"
            onClick={() => { setFilterJahr('alle'); setFilterMonat(''); }}
            className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1.5"
            title="Filter zurücksetzen"
          >
            ✕ Filter zurücksetzen
          </button>
        )}
      </div>

      {/* Inhalt */}
      {!selectedMaId ? (
        <div className="bg-white border border-gray-200 rounded-lg p-6 text-sm text-gray-500 italic">
          Bitte links einen Mitarbeiter wählen.
        </div>
      ) : eintraege === null ? (
        <div className="bg-white border border-gray-200 rounded-lg p-6 text-sm text-gray-500 italic">
          Lade Urlaubsdaten…
        </div>
      ) : eintraegeGefiltert.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-lg p-6 text-sm text-gray-500 italic">
          {eintraege.length === 0
            ? 'Keine Urlaubseinträge für diesen Mitarbeiter erfasst.'
            : 'Keine Einträge im gewählten Zeitraum.'}
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <div className="px-3 py-2 flex items-baseline justify-between bg-gray-50 border-b border-gray-200">
            <span className="text-xs text-gray-600">
              {eintraegeGefiltert.length} Eintrag/Einträge angezeigt · Σ {summeTage} Werktag(e)
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs text-gray-600 border-b border-gray-200">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">Zeitraum</th>
                  <th className="text-left px-3 py-2 font-medium">KWs</th>
                  <th className="text-left px-3 py-2 font-medium">Status</th>
                  <th className="text-right px-3 py-2 font-medium">Werktage</th>
                  <th className="text-left px-3 py-2 font-medium">Freigabe</th>
                  <th className="text-left px-3 py-2 font-medium">Kommentar</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {gruppen.map((g) => {
                  const totalTage = g.kws.reduce((s, k) => s + k.tage, 0);
                  const statuses = Array.from(new Set(g.kws.map((k) => k.status)));
                  return (
                    <tr
                      key={g.key}
                      className="hover:bg-blue-50/40 cursor-pointer"
                      onClick={() => setDetail(g)}
                      title="Klick öffnet die Details"
                    >
                      <td className="px-3 py-2 whitespace-nowrap">
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); setDetail(g); }}
                          className="text-blue-600 hover:underline text-left"
                        >
                          {g.datumVon && g.datumBis ? (
                            g.datumVon === g.datumBis ? (
                              new Date(g.datumVon).toLocaleDateString('de-DE')
                            ) : (
                              <>
                                {new Date(g.datumVon).toLocaleDateString('de-DE')}
                                {' – '}
                                {new Date(g.datumBis).toLocaleDateString('de-DE')}
                              </>
                            )
                          ) : (
                            <span className="italic">ohne Datum</span>
                          )}
                        </button>
                      </td>
                      <td className="px-3 py-2 text-xs text-gray-700">
                        {g.kws.length === 1
                          ? `KW ${g.kws[0].kw}/${g.kws[0].jahr}`
                          : `KW ${g.kws[0].kw}/${g.kws[0].jahr} – KW ${g.kws[g.kws.length - 1].kw}/${g.kws[g.kws.length - 1].jahr} (${g.kws.length} W.)`}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {statuses.map((s) => (
                          <span
                            key={s}
                            className={`inline-block mr-1 px-1.5 py-0.5 rounded ${
                              s === 'ganze-woche'
                                ? 'bg-red-100 text-red-800'
                                : s === 'einzeltag'
                                ? 'bg-yellow-100 text-yellow-800'
                                : 'bg-orange-100 text-orange-800'
                            }`}
                          >
                            {URLAUB_STATUS_LABELS[s]}
                          </span>
                        ))}
                      </td>
                      <td className="px-3 py-2 text-right font-medium">{totalTage}</td>
                      <td className="px-3 py-2 text-xs">
                        {g.alleFreigegeben ? (
                          <span className="text-green-700">✓ freigegeben</span>
                        ) : (
                          <span className="text-amber-700">⏳ offen</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs text-gray-700">
                        {g.kommentar && (
                          <div className="truncate max-w-xs" title={g.kommentar}>💬 {g.kommentar}</div>
                        )}
                        {g.externerLink && (
                          <a
                            href={g.externerLink}
                            target="_blank"
                            rel="noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="text-blue-600 hover:underline"
                          >
                            🔗 Link
                          </a>
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); setDetail(g); }}
                          className="text-blue-600 hover:underline"
                        >
                          Details ›
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {detail && (
        <UrlaubDetailModal gruppe={detail} onClose={() => setDetail(null)} />
      )}
    </div>
  );
}

/**
 * Werktage zwischen `von` und `bis` (Mo–Fr), als ISO-Liste.
 * Wird nur als Fallback verwendet, wenn ein Eintrag noch ohne
 * `werktageInKw` gespeichert wurde.
 */
function istoBetween(datumVon?: string, datumBis?: string): string[] {
  if (!datumVon || !datumBis) return [];
  const v = new Date(datumVon);
  const b = new Date(datumBis);
  if (isNaN(+v) || isNaN(+b) || b < v) return [];
  const out: string[] = [];
  const c = new Date(v);
  while (c <= b) {
    const dow = c.getDay();
    if (dow >= 1 && dow <= 5) {
      const y = c.getFullYear();
      const m = String(c.getMonth() + 1).padStart(2, '0');
      const d = String(c.getDate()).padStart(2, '0');
      out.push(`${y}-${m}-${d}`);
    }
    c.setDate(c.getDate() + 1);
  }
  return out;
}

function UrlaubDetailModal({
  gruppe,
  onClose,
}: {
  gruppe: UrlaubGruppe;
  onClose: () => void;
}) {
  const totalTage = gruppe.kws.reduce((s, k) => s + k.tage, 0);
  const ersteller = Array.from(new Set(gruppe.eintraege.map((e) => e.erstellerName))).join(', ');
  const erstelltAm = gruppe.eintraege.length > 0
    ? Math.min(...gruppe.eintraege.map((e) => e.erstelltAm))
    : null;

  return (
    <Modal isOpen={true} onClose={onClose} title="Urlaubs-Details" size="lg">
      <div className="space-y-3 text-sm">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-0.5">Datum von</label>
            <div>{gruppe.datumVon ? new Date(gruppe.datumVon).toLocaleDateString('de-DE') : <span className="text-gray-400 italic">—</span>}</div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-0.5">Datum bis</label>
            <div>{gruppe.datumBis ? new Date(gruppe.datumBis).toLocaleDateString('de-DE') : <span className="text-gray-400 italic">—</span>}</div>
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-0.5">Werktage gesamt</label>
          <div className="font-semibold">{totalTage}</div>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Wochen-Aufschlüsselung</label>
          <table className="w-full text-xs border border-gray-200 rounded">
            <thead className="bg-gray-50 text-gray-600">
              <tr>
                <th className="text-left px-2 py-1 font-medium">KW</th>
                <th className="text-left px-2 py-1 font-medium">Status</th>
                <th className="text-left px-2 py-1 font-medium">Werktage (konkret)</th>
                <th className="text-left px-2 py-1 font-medium">Freigabe</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {gruppe.kws.map((w) => (
                <tr key={`${w.jahr}-${w.kw}`}>
                  <td className="px-2 py-1 whitespace-nowrap">KW {w.kw}/{w.jahr}</td>
                  <td className="px-2 py-1">
                    <span
                      className={`inline-block px-1.5 py-0.5 rounded ${
                        w.status === 'ganze-woche'
                          ? 'bg-red-100 text-red-800'
                          : w.status === 'einzeltag'
                          ? 'bg-yellow-100 text-yellow-800'
                          : 'bg-orange-100 text-orange-800'
                      }`}
                    >
                      {URLAUB_STATUS_LABELS[w.status]}
                    </span>
                  </td>
                  <td className="px-2 py-1 text-gray-700">
                    {w.werktage.length === 0
                      ? <span className="text-gray-400 italic">—</span>
                      : w.werktage.map((d) => new Date(d).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' })).join(', ')}
                  </td>
                  <td className="px-2 py-1">
                    {w.freigegeben
                      ? <span className="text-green-700">✓</span>
                      : <span className="text-amber-700">⏳ offen</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {gruppe.kommentar && (
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-0.5">Kommentar</label>
            <div className="whitespace-pre-wrap text-gray-800">{gruppe.kommentar}</div>
          </div>
        )}

        {gruppe.externerLink && (
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-0.5">Externer Link</label>
            <a
              href={gruppe.externerLink}
              target="_blank"
              rel="noreferrer"
              className="text-blue-600 hover:underline break-all"
            >
              {gruppe.externerLink}
            </a>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 text-xs text-gray-600 pt-2 border-t border-gray-100">
          <div>
            <span className="font-medium text-gray-500">Erfasst von:</span>{' '}
            {ersteller || <span className="italic">—</span>}
          </div>
          <div>
            <span className="font-medium text-gray-500">Erfasst am:</span>{' '}
            {erstelltAm ? new Date(erstelltAm).toLocaleDateString('de-DE') : '—'}
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-gray-100">
          <a
            href="/planung"
            className="text-xs text-blue-600 hover:underline"
          >
            ↗ in Planung öffnen
          </a>
          <button
            type="button"
            onClick={onClose}
            className="text-sm bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded"
          >
            Schließen
          </button>
        </div>
      </div>
    </Modal>
  );
}
