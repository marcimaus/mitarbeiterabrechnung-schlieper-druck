// ============================================================
// Ferienkalender — Firestore-CRUD + Import aus offizieller Quelle
// ============================================================
//
// Collection `ferienkalender`. Ein Dokument je Ferienzeitraum bzw.
// Feiertag, docId = `${art}-${jahr}-${slug(name)}`. Der deterministische
// Key sorgt dafür, dass ein erneuter Import einen bestehenden Eintrag
// AKTUALISIERT statt zu duplizieren — auch dann, wenn sich die Daten
// geändert haben (z. B. weil vorher falsche Termine drinstanden).
//
// Quelle des Imports: OpenHolidays API (openholidaysapi.org), ein offenes
// Projekt, das die Ferienordnungen der Kultusministerien und die
// gesetzlichen Feiertage der Länder maschinenlesbar bereitstellt —
// für Niedersachsen also die Ferienordnung des Nds. Kultusministeriums.
// Die API ist frei, ohne Schlüssel nutzbar und erlaubt CORS, kann also
// direkt aus der App heraus abgefragt werden.
//
// Gegenprobe von Hand (die maßgebliche Primärquelle):
//   https://www.mk.niedersachsen.de/startseite/service/ferientermine/
//   → „Ferienordnung für die Schuljahre …" (PDF)

import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  deleteDoc,
  onSnapshot,
  writeBatch,
  type Unsubscribe,
} from 'firebase/firestore';
import { db } from './firebase';
import type { FerienkalenderArt, FerienkalenderEintrag } from '../types';
import {
  ferienVorlageDesJahres,
  feiertageVorlageDesJahres,
} from './ferien';

const COLL = 'ferienkalender';

/** Anzeigename der Importquelle — landet als Herkunftsvermerk am Datensatz. */
export const IMPORT_QUELLE = 'OpenHolidays API (Ferienordnung NDS / KMK)';

/** Link auf die maßgebliche Primärquelle, für den Hinweis in der Maske. */
export const IMPORT_QUELLE_URL =
  'https://www.mk.niedersachsen.de/startseite/service/ferientermine/ferientermine-in-niedersachsen-und-weiteren-bundeslandern-6491.html';

const API_BASIS = 'https://openholidaysapi.org';
const LAND = 'DE';
const BUNDESLAND = 'DE-NI'; // Niedersachsen

function now(): number {
  return Date.now();
}

/** Umlautfester Slug für die docId — stabil über Import-Läufe hinweg. */
function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export function ferienkalenderDocId(
  art: FerienkalenderArt,
  jahr: number,
  name: string,
): string {
  return `${art}-${jahr}-${slug(name)}`;
}

// ---------- Lesen ---------------------------------------------

/**
 * Listener über den kompletten Ferienkalender. Bewusst ohne Jahresfilter:
 * die Collection ist klein (gut 20 Datensätze je Jahr) und Zeiträume über
 * die Jahresgrenze (Weihnachtsferien) brauchen ohnehin Vor- und Folgejahr.
 */
export function ferienkalenderListener(
  cb: (list: FerienkalenderEintrag[]) => void,
): Unsubscribe {
  return onSnapshot(collection(db, COLL), (snap) => {
    cb(snap.docs.map((d) => ({ id: d.id, ...d.data() } as FerienkalenderEintrag)));
  });
}

export async function ladeFerienkalender(): Promise<FerienkalenderEintrag[]> {
  const snap = await getDocs(collection(db, COLL));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as FerienkalenderEintrag));
}

// ---------- Schreiben -----------------------------------------

export interface FerienkalenderEingabe {
  art: FerienkalenderArt;
  name: string;
  von: string;
  bis: string;
  scope?: 'de' | 'nds';
}

/** Jahr eines Eintrags = Kalenderjahr des Beginns. */
export function jahrAusDatum(iso: string): number {
  return Number(iso.slice(0, 4));
}

/**
 * Legt einen Eintrag an oder aktualisiert ihn. `vorherigeId` mitgeben,
 * wenn ein bestehender Eintrag bearbeitet wird — ändert sich durch die
 * Bearbeitung Name oder Jahr, wandert der Datensatz auf eine neue docId
 * und der alte wird entfernt (sonst bliebe eine Dublette stehen).
 */
export async function speichereFerienkalenderEintrag(
  eingabe: FerienkalenderEingabe,
  bearbeiterName?: string,
  vorherigeId?: string,
): Promise<string> {
  const name = eingabe.name.trim();
  if (!name) throw new Error('Bezeichnung fehlt.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(eingabe.von)) throw new Error('Startdatum fehlt oder ist ungültig.');
  const bis = eingabe.art === 'feiertag' ? eingabe.von : eingabe.bis;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(bis)) throw new Error('Enddatum fehlt oder ist ungültig.');
  if (bis < eingabe.von) throw new Error('Das Ende liegt vor dem Beginn.');

  const jahr = jahrAusDatum(eingabe.von);
  const id = ferienkalenderDocId(eingabe.art, jahr, name);
  const ref = doc(db, COLL, id);
  const bestehend = await getDoc(ref);
  const ts = now();

  const daten: Record<string, unknown> = {
    art: eingabe.art,
    jahr,
    name,
    von: eingabe.von,
    bis,
    quelle: 'manuell',
    erstelltAm: bestehend.exists() ? (bestehend.data().erstelltAm ?? ts) : ts,
    aktualisiertAm: ts,
  };
  if (eingabe.art === 'feiertag') daten.scope = eingabe.scope ?? 'de';
  if (bearbeiterName?.trim()) daten.bearbeiterName = bearbeiterName.trim();

  await setDoc(ref, daten);
  if (vorherigeId && vorherigeId !== id) {
    await deleteDoc(doc(db, COLL, vorherigeId)).catch(() => {});
  }
  return id;
}

export async function loescheFerienkalenderEintrag(id: string): Promise<void> {
  await deleteDoc(doc(db, COLL, id)).catch(() => {});
}

/**
 * Schreibt die eingebaute Vorlage eines Jahres als bearbeitbare
 * Datensätze nach Firestore. Gedacht für Jahre, die noch nie importiert
 * wurden: ohne Datensätze gibt es nichts zu bearbeiten, und ein
 * gelöschter Eintrag käme aus der Vorlage sofort wieder.
 *
 * Bereits vorhandene Datensätze bleiben unangetastet.
 */
export async function uebernimmVorlage(
  jahr: number,
  art: FerienkalenderArt,
  bearbeiterName?: string,
): Promise<number> {
  const eingaben: FerienkalenderEingabe[] =
    art === 'ferien'
      ? ferienVorlageDesJahres(jahr).map((f) => ({
          art: 'ferien' as const,
          name: f.name,
          von: f.von,
          bis: f.bis,
        }))
      : feiertageVorlageDesJahres(jahr).map((f) => ({
          art: 'feiertag' as const,
          name: f.name,
          von: f.datum,
          bis: f.datum,
          scope: f.scope,
        }));
  if (eingaben.length === 0) return 0;

  const vorhandene = new Set(
    (await ladeFerienkalender()).filter((e) => e.jahr === jahr && e.art === art).map((e) => e.id),
  );
  const batch = writeBatch(db);
  const ts = now();
  let geschrieben = 0;
  for (const e of eingaben) {
    const id = ferienkalenderDocId(art, jahr, e.name);
    if (vorhandene.has(id)) continue;
    const daten: Record<string, unknown> = {
      art,
      jahr,
      name: e.name,
      von: e.von,
      bis: e.bis,
      quelle: 'import',
      importQuelle: 'App-Vorlage (Ferienordnung NDS)',
      erstelltAm: ts,
      aktualisiertAm: ts,
    };
    if (art === 'feiertag') daten.scope = e.scope ?? 'de';
    if (bearbeiterName?.trim()) daten.bearbeiterName = bearbeiterName.trim();
    batch.set(doc(db, COLL, id), daten);
    geschrieben++;
  }
  if (geschrieben > 0) await batch.commit();
  return geschrieben;
}

// ---------- Import aus offizieller Quelle ---------------------

interface OpenHolidayEintrag {
  startDate: string;
  endDate: string;
  name: { language: string; text: string }[];
  nationwide?: boolean;
}

/** Ein Vorschlag aus dem Import inkl. Vergleich mit dem aktuellen Stand. */
export interface ImportVorschlag {
  id: string;
  art: FerienkalenderArt;
  jahr: number;
  name: string;
  von: string;
  bis: string;
  scope?: 'de' | 'nds';
  /** Was der Import mit dem Datensatz tun würde. */
  status: 'neu' | 'geaendert' | 'unveraendert' | 'manuell-geschuetzt';
  /** Bei `geaendert` / `manuell-geschuetzt`: der bisher gespeicherte Stand. */
  bisher?: { von: string; bis: string };
}

function textVon(e: OpenHolidayEintrag): string {
  return e.name.find((n) => n.language === 'DE')?.text ?? e.name[0]?.text ?? '';
}

async function holeVonApi(pfad: string, jahr: number): Promise<OpenHolidayEintrag[]> {
  const url =
    `${API_BASIS}/${pfad}?countryIsoCode=${LAND}&subdivisionCode=${BUNDESLAND}` +
    `&languageIsoCode=DE&validFrom=${jahr}-01-01&validTo=${jahr}-12-31`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) {
    throw new Error(`Abruf fehlgeschlagen (HTTP ${res.status}) — ${pfad}`);
  }
  return (await res.json()) as OpenHolidayEintrag[];
}

/**
 * Holt Ferien + Feiertage des Jahres von der offiziellen Quelle und
 * vergleicht sie mit dem gespeicherten Stand. Schreibt noch nichts —
 * die Maske zeigt das Ergebnis erst zur Bestätigung.
 *
 * Zeiträume, die im Vorjahr beginnen (Weihnachtsferien), gehören zum
 * Vorjahr und werden hier übersprungen — sonst stünden sie doppelt.
 */
export async function holeImportVorschau(jahr: number): Promise<ImportVorschlag[]> {
  const [ferien, feiertage] = await Promise.all([
    holeVonApi('SchoolHolidays', jahr),
    holeVonApi('PublicHolidays', jahr),
  ]);

  const bestand = new Map(
    (await ladeFerienkalender()).map((e) => [e.id, e] as const),
  );

  const vorschlaege: ImportVorschlag[] = [];
  const bauen = (
    art: FerienkalenderArt,
    liste: OpenHolidayEintrag[],
  ) => {
    for (const e of liste) {
      if (jahrAusDatum(e.startDate) !== jahr) continue; // gehört ins Vorjahr
      const name = textVon(e);
      if (!name) continue;
      const id = ferienkalenderDocId(art, jahr, name);
      const scope: 'de' | 'nds' | undefined =
        art === 'feiertag' ? (e.nationwide ? 'de' : 'nds') : undefined;
      const alt = bestand.get(id);
      let status: ImportVorschlag['status'];
      if (!alt) status = 'neu';
      else if (alt.quelle === 'manuell') status = 'manuell-geschuetzt';
      else if (alt.von === e.startDate && alt.bis === e.endDate) status = 'unveraendert';
      else status = 'geaendert';
      vorschlaege.push({
        id,
        art,
        jahr,
        name,
        von: e.startDate,
        bis: e.endDate,
        scope,
        status,
        bisher: alt ? { von: alt.von, bis: alt.bis } : undefined,
      });
    }
  };
  bauen('ferien', ferien);
  bauen('feiertag', feiertage);

  if (vorschlaege.length === 0) {
    throw new Error(
      `Die Quelle liefert für ${jahr} keine Daten. Die Ferienordnung reicht ` +
        `derzeit nur bis zum Schuljahr 2029/30 — spätere Jahre sind noch nicht veröffentlicht.`,
    );
  }
  return vorschlaege.sort((a, b) => a.von.localeCompare(b.von));
}

export interface ImportErgebnis {
  neu: number;
  geaendert: number;
  unveraendert: number;
  geschuetzt: number;
}

/**
 * Schreibt die bestätigte Vorschau. Von Hand gepflegte Einträge
 * (`quelle: 'manuell'`) werden NICHT überschrieben — eine bewusste
 * Korrektur soll ein späterer Import nicht wieder wegbügeln.
 */
export async function speichereImport(
  vorschlaege: ImportVorschlag[],
  bearbeiterName?: string,
): Promise<ImportErgebnis> {
  const ergebnis: ImportErgebnis = { neu: 0, geaendert: 0, unveraendert: 0, geschuetzt: 0 };
  const batch = writeBatch(db);
  const ts = now();
  let schreibt = 0;

  for (const v of vorschlaege) {
    if (v.status === 'manuell-geschuetzt') { ergebnis.geschuetzt++; continue; }
    if (v.status === 'unveraendert') { ergebnis.unveraendert++; continue; }
    const daten: Record<string, unknown> = {
      art: v.art,
      jahr: v.jahr,
      name: v.name,
      von: v.von,
      bis: v.bis,
      quelle: 'import',
      importQuelle: IMPORT_QUELLE,
      erstelltAm: ts,
      aktualisiertAm: ts,
    };
    if (v.art === 'feiertag') daten.scope = v.scope ?? 'de';
    if (bearbeiterName?.trim()) daten.bearbeiterName = bearbeiterName.trim();
    // `merge: true` erhält `erstelltAm` eines bereits bestehenden Datensatzes
    // nicht automatisch — deshalb bewusst überschreiben: beim Import zählt
    // der Zeitpunkt des Imports.
    batch.set(doc(db, COLL, v.id), daten);
    schreibt++;
    if (v.status === 'neu') ergebnis.neu++;
    else ergebnis.geaendert++;
  }

  if (schreibt > 0) await batch.commit();
  return ergebnis;
}
