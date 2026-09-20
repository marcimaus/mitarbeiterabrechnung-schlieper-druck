// Ferienkalender-Verwaltung — Übersicht, Pflege und Import der
// Schulferien (Niedersachsen) und gesetzlichen Feiertage.
//
// Aufruf über die Zeile „🏫 Ferien / Feiertage" in der Personalplanung.
//
// Datenlage je Jahr und Art (Ferien / Feiertage) getrennt:
//   - gepflegte Datensätze in Firestore vorhanden → diese gelten
//   - sonst → eingebaute App-Vorlage; sie lässt sich per Klick
//     übernehmen (dann bearbeitbar) oder per Import ersetzen.

import { useEffect, useMemo, useState } from 'react';
import Modal from './Modal';
import type { FerienkalenderArt, FerienkalenderEintrag } from '../types';
import {
  IMPORT_QUELLE,
  IMPORT_QUELLE_URL,
  holeImportVorschau,
  speichereImport,
  speichereFerienkalenderEintrag,
  loescheFerienkalenderEintrag,
  uebernimmVorlage,
  ferienkalenderDocId,
  jahrAusDatum,
  type ImportVorschlag,
  type ImportErgebnis,
} from '../lib/ferienkalender';
import { ferienVorlageDesJahres, feiertageVorlageDesJahres } from '../lib/ferien';
import { getISOWeek, getISOYear } from '../lib/kalender';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  /** Jahr, das die Personalplanung gerade anzeigt — Startwert der Auswahl. */
  jahr: number;
  /** Kompletter Ferienkalender aus Firestore (alle Jahre). */
  eintraege: FerienkalenderEintrag[];
  darfBearbeiten: boolean;
  bearbeiterName: string;
}

/** Eine Zeile der Übersicht — entweder gepflegt oder aus der Vorlage. */
interface Zeile {
  id: string;
  art: FerienkalenderArt;
  name: string;
  von: string;
  bis: string;
  scope?: 'de' | 'nds';
  /** true = nur Vorlage, noch kein Datensatz in Firestore. */
  istVorlage: boolean;
  quelle?: 'import' | 'manuell';
  bearbeiterName?: string;
}

function fmt(iso: string): string {
  return new Date(iso).toLocaleDateString('de-DE', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
  });
}

function tage(von: string, bis: string): number {
  const a = new Date(von).getTime();
  const b = new Date(bis).getTime();
  return Math.round((b - a) / 86400000) + 1;
}

/** KW-Bereich eines Zeitraums als Text, z. B. „KW 28–33 (2026)". */
function kwText(von: string, bis: string): string {
  const teile: string[] = [];
  const c = new Date(von);
  const ende = new Date(bis);
  const proJahr = new Map<number, Set<number>>();
  while (c <= ende) {
    const j = getISOYear(c);
    if (!proJahr.has(j)) proJahr.set(j, new Set());
    proJahr.get(j)!.add(getISOWeek(c));
    c.setDate(c.getDate() + 1);
  }
  for (const [j, kws] of Array.from(proJahr.entries()).sort((a, b) => a[0] - b[0])) {
    const sortiert = Array.from(kws).sort((a, b) => a - b);
    const bereich =
      sortiert.length === 1
        ? `KW ${sortiert[0]}`
        : `KW ${sortiert[0]}–${sortiert[sortiert.length - 1]}`;
    teile.push(proJahr.size > 1 ? `${bereich} (${j})` : bereich);
  }
  return teile.join(', ');
}

export default function FerienkalenderModal({
  isOpen,
  onClose,
  jahr,
  eintraege,
  darfBearbeiten,
  bearbeiterName,
}: Props) {
  const [gewaehltesJahr, setGewaehltesJahr] = useState(jahr);
  const [fehler, setFehler] = useState<string | null>(null);
  const [hinweis, setHinweis] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Bearbeitung: 'neu-ferien' / 'neu-feiertag' oder die id eines Eintrags.
  const [form, setForm] = useState<FormState | null>(null);

  // Import-Vorschau (noch nicht geschrieben).
  const [vorschau, setVorschau] = useState<ImportVorschlag[] | null>(null);
  const [ergebnis, setErgebnis] = useState<ImportErgebnis | null>(null);

  useEffect(() => {
    if (isOpen) setGewaehltesJahr(jahr);
  }, [isOpen, jahr]);

  // Jahreswechsel / Schließen → transiente Zustände zurücksetzen.
  useEffect(() => {
    setForm(null);
    setVorschau(null);
    setErgebnis(null);
    setFehler(null);
    setHinweis(null);
  }, [gewaehltesJahr, isOpen]);

  const gepflegt = useMemo(
    () => eintraege.filter((e) => e.jahr === gewaehltesJahr),
    [eintraege, gewaehltesJahr],
  );

  // Vorlage greift nur, solange für Jahr + Art gar nichts gepflegt ist —
  // dieselbe Regel wie in `src/lib/ferien.ts`.
  const ferienGepflegt = gepflegt.some((e) => e.art === 'ferien');
  const feiertageGepflegt = gepflegt.some((e) => e.art === 'feiertag');

  const zeilen = useMemo(() => {
    const bauen = (art: FerienkalenderArt, istGepflegt: boolean): Zeile[] => {
      if (istGepflegt) {
        return gepflegt
          .filter((e) => e.art === art)
          .map((e) => ({
            id: e.id,
            art,
            name: e.name,
            von: e.von,
            bis: e.bis,
            scope: e.scope,
            istVorlage: false,
            quelle: e.quelle,
            bearbeiterName: e.bearbeiterName,
          }))
          .sort((a, b) => a.von.localeCompare(b.von));
      }
      if (art === 'ferien') {
        return ferienVorlageDesJahres(gewaehltesJahr).map((f) => ({
          id: ferienkalenderDocId('ferien', gewaehltesJahr, f.name),
          art: 'ferien' as const,
          name: f.name,
          von: f.von,
          bis: f.bis,
          istVorlage: true,
        }));
      }
      return feiertageVorlageDesJahres(gewaehltesJahr).map((f) => ({
        id: ferienkalenderDocId('feiertag', gewaehltesJahr, f.name),
        art: 'feiertag' as const,
        name: f.name,
        von: f.datum,
        bis: f.datum,
        scope: f.scope,
        istVorlage: true,
      }));
    };
    return {
      ferien: bauen('ferien', ferienGepflegt),
      feiertag: bauen('feiertag', feiertageGepflegt),
    };
  }, [gepflegt, gewaehltesJahr, ferienGepflegt, feiertageGepflegt]);

  // ---- Aktionen ----------------------------------------------

  async function mitBusy(fn: () => Promise<void>) {
    setBusy(true);
    setFehler(null);
    try {
      await fn();
    } catch (e) {
      setFehler(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const speichern = (state: FormState) =>
    mitBusy(async () => {
      // Sobald für Jahr + Art ein Datensatz existiert, greift die Vorlage
      // nicht mehr — die übrigen Vorlage-Einträge würden also verschwinden.
      // Deshalb ZUERST die Vorlage materialisieren, dann die Eingabe
      // speichern (die den Vorlage-Datensatz dann korrekt überschreibt
      // bzw. bei Umbenennung ablöst).
      if (state.vorlageUebernehmen) {
        for (const j of new Set([gewaehltesJahr, jahrAusDatum(state.von)])) {
          await uebernimmVorlage(j, state.art, bearbeiterName);
        }
      }
      await speichereFerienkalenderEintrag(
        {
          art: state.art,
          name: state.name,
          von: state.von,
          bis: state.art === 'feiertag' ? state.von : state.bis,
          scope: state.scope,
        },
        bearbeiterName,
        state.vorherigeId,
      );
      setForm(null);
      setHinweis('Gespeichert.');
    });

  const loeschen = (zeile: Zeile) =>
    mitBusy(async () => {
      if (
        !window.confirm(
          `„${zeile.name}" (${fmt(zeile.von)}) wirklich löschen?\n\n` +
            `Der Eintrag verschwindet aus der Personalplanung.`,
        )
      ) {
        return;
      }
      if (zeile.istVorlage) {
        // Vorlage erst materialisieren, sonst kommt der Eintrag sofort
        // wieder (Vorlage greift, solange nichts gepflegt ist).
        await uebernimmVorlage(gewaehltesJahr, zeile.art, bearbeiterName);
      }
      await loescheFerienkalenderEintrag(zeile.id);
      setHinweis('Eintrag gelöscht.');
    });

  const vorlageUebernehmenKlick = (art: FerienkalenderArt) =>
    mitBusy(async () => {
      const n = await uebernimmVorlage(gewaehltesJahr, art, bearbeiterName);
      setHinweis(
        n > 0
          ? `${n} Einträge aus der App-Vorlage übernommen — jetzt bearbeitbar.`
          : 'Für dieses Jahr bringt die App keine Vorlage mit.',
      );
    });

  const importVorschauHolen = () =>
    mitBusy(async () => {
      setErgebnis(null);
      const v = await holeImportVorschau(gewaehltesJahr);
      setVorschau(v);
    });

  const importSchreiben = () =>
    mitBusy(async () => {
      if (!vorschau) return;
      const r = await speichereImport(vorschau, bearbeiterName);
      setVorschau(null);
      setErgebnis(r);
    });

  // ---- Render ------------------------------------------------

  const jahresAuswahl = Array.from({ length: 8 }, (_, i) => jahr - 2 + i);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="🏫 Ferien & Feiertage verwalten" size="xl">
      <div className="space-y-4">
        {/* Kopf: Jahr + Import */}
        <div className="flex flex-wrap items-center gap-3">
          <label className="text-sm font-medium text-gray-700">Jahr</label>
          <select
            value={gewaehltesJahr}
            onChange={(e) => setGewaehltesJahr(Number(e.target.value))}
            className="border border-gray-300 rounded px-2 py-1 text-sm"
          >
            {jahresAuswahl.map((j) => (
              <option key={j} value={j}>{j}</option>
            ))}
          </select>
          <div className="flex-1" />
          {darfBearbeiten && (
            <button
              type="button"
              onClick={importVorschauHolen}
              disabled={busy}
              className="text-sm border border-blue-300 bg-blue-50 hover:bg-blue-100 disabled:opacity-50 text-blue-800 rounded px-3 py-1.5 font-medium"
              title="Ferien und Feiertage aus der offiziellen Quelle abrufen"
            >
              ⬇ Import {gewaehltesJahr}
            </button>
          )}
        </div>

        <p className="text-xs text-gray-500 leading-relaxed">
          Quelle des Imports: <strong>{IMPORT_QUELLE}</strong> — offene Schnittstelle, die
          die Ferienordnungen der Kultusministerien und die gesetzlichen Feiertage
          maschinenlesbar bereitstellt. Maßgeblich bleibt die{' '}
          <a
            href={IMPORT_QUELLE_URL}
            target="_blank"
            rel="noreferrer"
            className="text-blue-700 underline"
          >
            Ferienordnung des Nds. Kultusministeriums
          </a>
          . Die Ferienordnung reicht derzeit bis zum Schuljahr 2029/30.
        </p>

        {fehler && (
          <div className="text-sm bg-red-50 border border-red-200 text-red-800 rounded px-3 py-2">
            ⚠ {fehler}
          </div>
        )}
        {hinweis && !fehler && (
          <div className="text-sm bg-green-50 border border-green-200 text-green-800 rounded px-3 py-2">
            ✓ {hinweis}
          </div>
        )}
        {ergebnis && (
          <div className="text-sm bg-green-50 border border-green-200 text-green-800 rounded px-3 py-2">
            ✓ Import abgeschlossen: {ergebnis.neu} neu, {ergebnis.geaendert} aktualisiert,{' '}
            {ergebnis.unveraendert} unverändert
            {ergebnis.geschuetzt > 0 && `, ${ergebnis.geschuetzt} von Hand gepflegt (nicht überschrieben)`}.
          </div>
        )}

        {/* Import-Vorschau */}
        {vorschau && (
          <ImportVorschau
            vorschau={vorschau}
            jahr={gewaehltesJahr}
            busy={busy}
            onAbbrechen={() => setVorschau(null)}
            onUebernehmen={importSchreiben}
          />
        )}

        {!vorschau && (
          <>
            <Abschnitt
              titel="Schulferien Niedersachsen"
              icon="🏫"
              zeilen={zeilen.ferien}
              istGepflegt={ferienGepflegt}
              jahr={gewaehltesJahr}
              darfBearbeiten={darfBearbeiten}
              busy={busy}
              onNeu={() =>
                setForm(leeresFormular('ferien', gewaehltesJahr, !ferienGepflegt))
              }
              onBearbeiten={(z) => setForm(formularAus(z, !ferienGepflegt))}
              onLoeschen={loeschen}
              onVorlageUebernehmen={() => vorlageUebernehmenKlick('ferien')}
            />
            <Abschnitt
              titel="Gesetzliche Feiertage (DE + Niedersachsen)"
              icon="🔴"
              zeilen={zeilen.feiertag}
              istGepflegt={feiertageGepflegt}
              jahr={gewaehltesJahr}
              darfBearbeiten={darfBearbeiten}
              busy={busy}
              onNeu={() =>
                setForm(leeresFormular('feiertag', gewaehltesJahr, !feiertageGepflegt))
              }
              onBearbeiten={(z) => setForm(formularAus(z, !feiertageGepflegt))}
              onLoeschen={loeschen}
              onVorlageUebernehmen={() => vorlageUebernehmenKlick('feiertag')}
            />
          </>
        )}

        {form && (
          <EintragFormular
            state={form}
            busy={busy}
            onChange={setForm}
            onAbbrechen={() => setForm(null)}
            onSpeichern={() => speichern(form)}
          />
        )}
      </div>
    </Modal>
  );
}

// ============================================================
// Abschnitt (Ferien bzw. Feiertage)
// ============================================================

function Abschnitt({
  titel,
  icon,
  zeilen,
  istGepflegt,
  jahr,
  darfBearbeiten,
  busy,
  onNeu,
  onBearbeiten,
  onLoeschen,
  onVorlageUebernehmen,
}: {
  titel: string;
  icon: string;
  zeilen: Zeile[];
  istGepflegt: boolean;
  jahr: number;
  darfBearbeiten: boolean;
  busy: boolean;
  onNeu: () => void;
  onBearbeiten: (z: Zeile) => void;
  onLoeschen: (z: Zeile) => void;
  onVorlageUebernehmen: () => void;
}) {
  return (
    <section className="border border-gray-200 rounded-lg overflow-hidden">
      <header className="flex items-center gap-2 bg-gray-50 border-b border-gray-200 px-3 py-2">
        <span className="font-semibold text-sm text-gray-800">
          {icon} {titel} {jahr}
        </span>
        <span className="text-xs text-gray-500">({zeilen.length})</span>
        <div className="flex-1" />
        {darfBearbeiten && (
          <button
            type="button"
            onClick={onNeu}
            disabled={busy}
            className="text-xs border border-gray-300 bg-white hover:bg-gray-100 disabled:opacity-50 rounded px-2 py-1 font-medium"
          >
            + Neu
          </button>
        )}
      </header>

      {!istGepflegt && (
        <div className="bg-amber-50 border-b border-amber-200 px-3 py-2 text-xs text-amber-900 flex flex-wrap items-center gap-2">
          <span>
            Noch nichts gepflegt — angezeigt wird die <strong>App-Vorlage</strong>.
            {zeilen.length === 0 && ' Für dieses Jahr bringt die App keine Vorlage mit.'}
          </span>
          {darfBearbeiten && zeilen.length > 0 && (
            <button
              type="button"
              onClick={onVorlageUebernehmen}
              disabled={busy}
              className="border border-amber-400 bg-white hover:bg-amber-100 disabled:opacity-50 rounded px-2 py-0.5 font-medium"
            >
              Vorlage übernehmen (dann bearbeitbar)
            </button>
          )}
        </div>
      )}

      {zeilen.length === 0 ? (
        <p className="px-3 py-3 text-sm text-gray-500 italic">Keine Einträge.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-gray-500 border-b border-gray-200">
              <th className="px-3 py-1.5 font-medium">Bezeichnung</th>
              <th className="px-3 py-1.5 font-medium">Von</th>
              <th className="px-3 py-1.5 font-medium">Bis</th>
              <th className="px-3 py-1.5 font-medium text-right">Tage</th>
              <th className="px-3 py-1.5 font-medium">Kalenderwochen</th>
              <th className="px-3 py-1.5 font-medium">Quelle</th>
              <th className="px-3 py-1.5" />
            </tr>
          </thead>
          <tbody>
            {zeilen.map((z) => (
              <tr key={z.id} className="border-b border-gray-100 last:border-0 hover:bg-gray-50">
                <td className="px-3 py-1.5">
                  {z.name}
                  {z.scope === 'nds' && (
                    <span className="ml-1.5 text-[10px] bg-sky-100 text-sky-800 border border-sky-300 rounded px-1">
                      nur NDS
                    </span>
                  )}
                </td>
                <td className="px-3 py-1.5 tabular-nums">{fmt(z.von)}</td>
                <td className="px-3 py-1.5 tabular-nums">
                  {z.von === z.bis ? '—' : fmt(z.bis)}
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums">{tage(z.von, z.bis)}</td>
                <td className="px-3 py-1.5 text-gray-600">{kwText(z.von, z.bis)}</td>
                <td className="px-3 py-1.5">
                  {z.istVorlage ? (
                    <span className="text-[10px] bg-gray-100 text-gray-600 border border-gray-300 rounded px-1">
                      Vorlage
                    </span>
                  ) : z.quelle === 'manuell' ? (
                    <span
                      className="text-[10px] bg-amber-100 text-amber-900 border border-amber-300 rounded px-1"
                      title={z.bearbeiterName ? `zuletzt: ${z.bearbeiterName}` : undefined}
                    >
                      von Hand
                    </span>
                  ) : (
                    <span className="text-[10px] bg-blue-100 text-blue-800 border border-blue-300 rounded px-1">
                      importiert
                    </span>
                  )}
                </td>
                <td className="px-3 py-1.5 text-right whitespace-nowrap">
                  {darfBearbeiten && (
                    <>
                      <button
                        type="button"
                        onClick={() => onBearbeiten(z)}
                        disabled={busy}
                        className="text-xs text-blue-700 hover:underline disabled:opacity-50"
                      >
                        bearbeiten
                      </button>
                      <button
                        type="button"
                        onClick={() => onLoeschen(z)}
                        disabled={busy}
                        className="ml-3 text-xs text-red-700 hover:underline disabled:opacity-50"
                      >
                        löschen
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

// ============================================================
// Import-Vorschau
// ============================================================

const STATUS_STYLE: Record<ImportVorschlag['status'], { label: string; chip: string }> = {
  neu: { label: 'neu', chip: 'bg-green-100 text-green-800 border-green-300' },
  geaendert: { label: 'wird korrigiert', chip: 'bg-amber-100 text-amber-900 border-amber-300' },
  unveraendert: { label: 'unverändert', chip: 'bg-gray-100 text-gray-600 border-gray-300' },
  'manuell-geschuetzt': {
    label: 'von Hand — bleibt',
    chip: 'bg-violet-100 text-violet-800 border-violet-300',
  },
};

function ImportVorschau({
  vorschau,
  jahr,
  busy,
  onAbbrechen,
  onUebernehmen,
}: {
  vorschau: ImportVorschlag[];
  jahr: number;
  busy: boolean;
  onAbbrechen: () => void;
  onUebernehmen: () => void;
}) {
  const zuSchreiben = vorschau.filter(
    (v) => v.status === 'neu' || v.status === 'geaendert',
  ).length;
  return (
    <section className="border border-blue-300 rounded-lg overflow-hidden">
      <header className="bg-blue-50 border-b border-blue-200 px-3 py-2">
        <span className="font-semibold text-sm text-blue-900">
          Import-Vorschau {jahr} — {zuSchreiben} Änderung(en)
        </span>
        <p className="text-xs text-blue-800 mt-0.5">
          Nichts wurde bisher gespeichert. Von Hand gepflegte Einträge werden nicht
          überschrieben.
        </p>
      </header>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-gray-500 border-b border-gray-200">
            <th className="px-3 py-1.5 font-medium">Art</th>
            <th className="px-3 py-1.5 font-medium">Bezeichnung</th>
            <th className="px-3 py-1.5 font-medium">Zeitraum laut Quelle</th>
            <th className="px-3 py-1.5 font-medium">bisher</th>
            <th className="px-3 py-1.5 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {vorschau.map((v) => (
            <tr key={v.id} className="border-b border-gray-100 last:border-0">
              <td className="px-3 py-1.5">{v.art === 'ferien' ? '🏫' : '🔴'}</td>
              <td className="px-3 py-1.5">{v.name}</td>
              <td className="px-3 py-1.5 tabular-nums">
                {fmt(v.von)}
                {v.von !== v.bis && ` – ${fmt(v.bis)}`}
              </td>
              <td className="px-3 py-1.5 tabular-nums text-gray-500">
                {v.bisher
                  ? v.bisher.von === v.bisher.bis
                    ? fmt(v.bisher.von)
                    : `${fmt(v.bisher.von)} – ${fmt(v.bisher.bis)}`
                  : '—'}
              </td>
              <td className="px-3 py-1.5">
                <span
                  className={`text-[10px] border rounded px-1 ${STATUS_STYLE[v.status].chip}`}
                >
                  {STATUS_STYLE[v.status].label}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex justify-end gap-2 bg-gray-50 border-t border-gray-200 px-3 py-2">
        <button
          type="button"
          onClick={onAbbrechen}
          disabled={busy}
          className="text-sm border border-gray-300 bg-white hover:bg-gray-100 disabled:opacity-50 rounded px-3 py-1.5"
        >
          Abbrechen
        </button>
        <button
          type="button"
          onClick={onUebernehmen}
          disabled={busy || zuSchreiben === 0}
          className="text-sm border border-blue-600 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded px-3 py-1.5 font-medium"
        >
          {zuSchreiben === 0 ? 'Nichts zu übernehmen' : `${zuSchreiben} Änderung(en) übernehmen`}
        </button>
      </div>
    </section>
  );
}

// ============================================================
// Formular (neu / bearbeiten)
// ============================================================

interface FormState {
  art: FerienkalenderArt;
  name: string;
  von: string;
  bis: string;
  scope: 'de' | 'nds';
  /** docId des bearbeiteten Datensatzes — bei „neu" leer. */
  vorherigeId?: string;
  /**
   * true, wenn eine reine Vorlage-Zeile bearbeitet wird: dann muss beim
   * Speichern die restliche Vorlage des Jahres mit übernommen werden,
   * sonst verschwindet sie (gepflegte Daten verdrängen die Vorlage).
   */
  vorlageUebernehmen: boolean;
}

function leeresFormular(
  art: FerienkalenderArt,
  jahr: number,
  vorlageUebernehmen: boolean,
): FormState {
  const start = `${jahr}-01-01`;
  return { art, name: '', von: start, bis: start, scope: 'de', vorlageUebernehmen };
}

function formularAus(z: Zeile, vorlageUebernehmen: boolean): FormState {
  return {
    art: z.art,
    name: z.name,
    von: z.von,
    bis: z.bis,
    scope: z.scope ?? 'de',
    // Auch bei einer Vorlage-Zeile: der Datensatz existiert nach dem
    // Materialisieren unter genau dieser docId und wird bei Umbenennung
    // abgelöst statt zur Dublette.
    vorherigeId: z.id,
    vorlageUebernehmen: z.istVorlage && vorlageUebernehmen,
  };
}

function EintragFormular({
  state,
  busy,
  onChange,
  onAbbrechen,
  onSpeichern,
}: {
  state: FormState;
  busy: boolean;
  onChange: (s: FormState) => void;
  onAbbrechen: () => void;
  onSpeichern: () => void;
}) {
  const istFeiertag = state.art === 'feiertag';
  return (
    <section className="border border-blue-300 bg-blue-50/50 rounded-lg p-3 space-y-3">
      <h3 className="font-semibold text-sm text-gray-800">
        {state.vorherigeId ? 'Eintrag bearbeiten' : 'Neuer Eintrag'} —{' '}
        {istFeiertag ? 'Feiertag' : 'Ferienzeitraum'}
      </h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="text-sm">
          <span className="block text-xs font-medium text-gray-600 mb-0.5">Bezeichnung</span>
          <input
            type="text"
            value={state.name}
            onChange={(e) => onChange({ ...state, name: e.target.value })}
            placeholder={istFeiertag ? 'z. B. Reformationstag' : 'z. B. Sommerferien'}
            className="w-full border border-gray-300 rounded px-2 py-1"
          />
        </label>
        {istFeiertag && (
          <label className="text-sm">
            <span className="block text-xs font-medium text-gray-600 mb-0.5">Geltung</span>
            <select
              value={state.scope}
              onChange={(e) => onChange({ ...state, scope: e.target.value as 'de' | 'nds' })}
              className="w-full border border-gray-300 rounded px-2 py-1"
            >
              <option value="de">bundesweit</option>
              <option value="nds">nur Niedersachsen</option>
            </select>
          </label>
        )}
        <label className="text-sm">
          <span className="block text-xs font-medium text-gray-600 mb-0.5">
            {istFeiertag ? 'Datum' : 'Beginn (inkl.)'}
          </span>
          <input
            type="date"
            value={state.von}
            onChange={(e) => {
              const von = e.target.value;
              onChange({ ...state, von, bis: istFeiertag || state.bis < von ? von : state.bis });
            }}
            className="w-full border border-gray-300 rounded px-2 py-1"
          />
        </label>
        {!istFeiertag && (
          <label className="text-sm">
            <span className="block text-xs font-medium text-gray-600 mb-0.5">Ende (inkl.)</span>
            <input
              type="date"
              value={state.bis}
              onChange={(e) => onChange({ ...state, bis: e.target.value })}
              className="w-full border border-gray-300 rounded px-2 py-1"
            />
          </label>
        )}
      </div>
      {state.von && (
        <p className="text-xs text-gray-600">
          {kwText(state.von, istFeiertag ? state.von : state.bis)} — Jahr{' '}
          {jahrAusDatum(state.von)}
        </p>
      )}
      {state.vorlageUebernehmen && (
        <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1">
          Für {jahrAusDatum(state.von)} ist bisher nichts gepflegt — beim Speichern wird die
          App-Vorlage mit übernommen, damit die übrigen Einträge erhalten bleiben.
        </p>
      )}
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onAbbrechen}
          disabled={busy}
          className="text-sm border border-gray-300 bg-white hover:bg-gray-100 disabled:opacity-50 rounded px-3 py-1.5"
        >
          Abbrechen
        </button>
        <button
          type="button"
          onClick={onSpeichern}
          disabled={busy || !state.name.trim() || !state.von}
          className="text-sm border border-blue-600 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded px-3 py-1.5 font-medium"
        >
          Speichern
        </button>
      </div>
    </section>
  );
}
