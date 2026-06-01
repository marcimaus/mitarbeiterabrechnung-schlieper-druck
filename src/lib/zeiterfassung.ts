// Zeiterfassungs-Logik: Einstempeln, Ausstempeln, Pausen

import {
  collection,
  doc,
  addDoc,
  updateDoc,
  query,
  where,
  getDocs,
  orderBy,
  onSnapshot,
  type Unsubscribe,
} from 'firebase/firestore';
import { db } from './firebase';
import type { Arbeitszeit, Pause, AuditEintrag, ArbeitszeitsTyp } from '../types';

function now(): number {
  return Date.now();
}

// ---- Zeitzonen-Helfer (fix auf Europe/Berlin) --------------
// WICHTIG: Tagesgrenzen und Wanduhrzeiten dürfen NICHT von der lokalen
// Zeitzone des auslösenden Geräts abhängen. Die Stempeluhr läuft auf
// beliebigen Tablets/Smartphones; ist dort die Zeitzone falsch
// eingestellt (z. B. UTC-7 statt Europe/Berlin), wertet die alte Logik
// eine Session vom selben Tag fälschlich als „Vortag" und schließt sie
// automatisch — die 23:59-Schließzeit landet zudem auf einer falschen
// absoluten Uhrzeit (real beobachtet: 08:59 statt 23:59). Daher rechnen
// wir Tagesgrenze und Schließzeit explizit in Berliner Zeit.
const BERLIN_TZ = 'Europe/Berlin';

/** {jahr, monat (1–12), tag} eines Zeitpunkts in Berliner Zeit. */
function berlinDatumsteile(ms: number): { jahr: number; monat: number; tag: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BERLIN_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(ms));
  const wert = (typ: string) => Number(parts.find((p) => p.type === typ)?.value);
  return { jahr: wert('year'), monat: wert('month'), tag: wert('day') };
}

/** Sortierbarer Tagesschlüssel YYYYMMDD eines Zeitpunkts in Berliner Zeit. */
function berlinTagSchluessel(ms: number): number {
  const { jahr, monat, tag } = berlinDatumsteile(ms);
  return jahr * 10000 + monat * 100 + tag;
}

/**
 * Epoch-ms einer Berliner Wanduhrzeit (monat 1–12). Bestimmt den
 * Berliner UTC-Offset zum betreffenden Datum (Sommer-/Winterzeit) und
 * rechnet zurück — unabhängig von der Geräte-Zeitzone.
 */
function berlinWanduhrMs(
  jahr: number,
  monat: number,
  tag: number,
  stunde: number,
  minute: number
): number {
  const naiveUtc = Date.UTC(jahr, monat - 1, tag, stunde, minute, 0);
  // Offset = (Berliner Wandzeit − UTC-Wandzeit) zu diesem Zeitpunkt.
  // Beide Strings werden von Date.parse in derselben Geräte-Zeitzone
  // interpretiert, sodass sich die Geräte-Zeitzone heraushebt.
  const alsBerlin = new Date(naiveUtc).toLocaleString('en-US', { timeZone: BERLIN_TZ });
  const alsUtc = new Date(naiveUtc).toLocaleString('en-US', { timeZone: 'UTC' });
  const offset = Date.parse(alsBerlin) - Date.parse(alsUtc);
  return naiveUtc - offset;
}

// ---- Aktive Sessions laden ---------------------------------

export function aktiveSessions(cb: (list: Arbeitszeit[]) => void): Unsubscribe {
  const q = query(
    collection(db, 'arbeitszeiten'),
    where('status', 'in', ['aktiv', 'pause'])
  );
  return onSnapshot(q, (snap) => {
    cb(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Arbeitszeit)));
  });
}

export async function ladeAktiveSessionFuerMitarbeiter(
  mitarbeiterId: string
): Promise<Arbeitszeit | null> {
  const q = query(
    collection(db, 'arbeitszeiten'),
    where('mitarbeiterId', '==', mitarbeiterId),
    where('status', 'in', ['aktiv', 'pause'])
  );
  const snap = await getDocs(q);
  if (snap.empty) return null;
  return { id: snap.docs[0].id, ...snap.docs[0].data() } as Arbeitszeit;
}

// ---- Einstempeln -------------------------------------------

export async function einstempeln(
  mitarbeiterId: string,
  typ: ArbeitszeitsTyp,
  quelle: import('../types').ArbeitszeitsQuelle = 'nfc',
  ausgabeId?: string
): Promise<Arbeitszeit> {
  // Sicherheitscheck: keine doppelte Session
  const existing = await ladeAktiveSessionFuerMitarbeiter(mitarbeiterId);
  if (existing) throw new Error('Mitarbeiter ist bereits eingestempelt.');

  const ts = now();
  const session: Omit<Arbeitszeit, 'id'> = {
    mitarbeiterId,
    startTime: ts,
    endTime: null,
    status: 'aktiv',
    quelle,
    typ,
    pausen: [],
    gesamtPauseMinuten: 0,
    korrekturLog: [],
    erstelltAm: ts,
    aktualisiertAm: ts,
    ...(ausgabeId ? { ausgabeId } : {}),
  };
  const ref = await addDoc(collection(db, 'arbeitszeiten'), session);
  return { id: ref.id, ...session };
}

// ---- Ausstempeln -------------------------------------------

export async function ausstempeln(sessionId: string): Promise<void> {
  const ts = now();
  const sessionRef = doc(db, 'arbeitszeiten', sessionId);

  // Laufende Pause automatisch beenden
  // Session direkt aktualisieren
  await updateDoc(sessionRef, {
    endTime: ts,
    status: 'abgeschlossen',
    aktualisiertAm: ts,
  });
}

export async function ausstempelnMitPausenabschluss(
  session: Arbeitszeit
): Promise<void> {
  const ts = now();
  const updates: Partial<Arbeitszeit> & { aktualisiertAm: number } = {
    endTime: ts,
    status: 'abgeschlossen',
    aktualisiertAm: ts,
  };

  // Offene Pause automatisch schließen
  const pausen = [...session.pausen];
  const offenePause = pausen.findIndex((p) => p.ende === null);
  if (offenePause >= 0) {
    pausen[offenePause] = { ...pausen[offenePause], ende: ts };
    const gesamtPause = berechnePausenminuten(pausen);
    updates.pausen = pausen;
    updates.gesamtPauseMinuten = gesamtPause;
    updates.status = 'abgeschlossen';
  }

  await updateDoc(doc(db, 'arbeitszeiten', session.id), updates);
}

// ---- Pause starten ----------------------------------------

export async function pauseStarten(session: Arbeitszeit): Promise<void> {
  if (session.status !== 'aktiv') throw new Error('Keine aktive Session.');
  const ts = now();
  const neuePause: Pause = { start: ts, ende: null };
  await updateDoc(doc(db, 'arbeitszeiten', session.id), {
    pausen: [...session.pausen, neuePause],
    status: 'pause',
    aktualisiertAm: ts,
  });
}

// ---- Pause beenden ----------------------------------------

export async function pauseBeenden(session: Arbeitszeit): Promise<void> {
  if (session.status !== 'pause') throw new Error('Keine aktive Pause.');
  const ts = now();
  const pausen = [...session.pausen];
  const letzteIdx = pausen.findLastIndex((p) => p.ende === null);
  if (letzteIdx < 0) throw new Error('Keine offene Pause gefunden.');
  pausen[letzteIdx] = { ...pausen[letzteIdx], ende: ts };
  const gesamtPause = berechnePausenminuten(pausen);
  await updateDoc(doc(db, 'arbeitszeiten', session.id), {
    pausen,
    gesamtPauseMinuten: gesamtPause,
    status: 'aktiv',
    aktualisiertAm: ts,
  });
}

// ---- Auto-Schließen um Mitternacht ------------------------

/**
 * Schließt alle Sessions, die an einem früheren Tag gestartet und nicht
 * ausgestempelt wurden. endTime wird auf 23:59 Uhr des Start-Tages
 * gesetzt, Flag `autoGeschlossenUm24` aktiviert, ein Audit-Eintrag im
 * `korrekturLog` hinterlegt. Rückgabe: Liste der gerade geschlossenen
 * Sessions (für UI-Banner). Bereits zuvor geschlossene Sessions werden
 * NICHT erneut angefasst und NICHT zurückgegeben.
 */
export async function schliesseAbgelaufeneSessions(): Promise<Arbeitszeit[]> {
  const q = query(
    collection(db, 'arbeitszeiten'),
    where('status', 'in', ['aktiv', 'pause'])
  );
  const snap = await getDocs(q);
  // Heutiger Tag in Berliner Zeit (Geräte-Zeitzone irrelevant — Epoch ist
  // zeitzonenunabhängig, nur die Tageszuordnung erfolgt in Berlin).
  const heuteTag = berlinTagSchluessel(now());
  const geschlossene: Arbeitszeit[] = [];

  for (const d of snap.docs) {
    const session = { id: d.id, ...d.data() } as Arbeitszeit;
    const start = berlinDatumsteile(session.startTime);
    const startTag = start.jahr * 10000 + start.monat * 100 + start.tag;
    // Nur schließen, wenn der Start-Tag (Berliner Zeit) VOR dem heutigen
    // Berliner Tag liegt. Same-Day-Sessions bleiben offen.
    if (startTag < heuteTag) {
      const schliesszeit = berlinWanduhrMs(start.jahr, start.monat, start.tag, 23, 59);
      const pausen = [...session.pausen];
      const offenePause = pausen.findLastIndex((p) => p.ende === null);
      if (offenePause >= 0) {
        pausen[offenePause] = { ...pausen[offenePause], ende: schliesszeit };
      }
      const autoLog: AuditEintrag = {
        zeitstempel: now(),
        adminName: '— System —',
        aktion: 'Auto-Close: vergessen auszustempeln, geschlossen um 23:59',
        vorher: JSON.stringify({ endTime: null, status: session.status }),
        nachher: JSON.stringify({ endTime: schliesszeit, status: 'abgeschlossen' }),
      };
      const naechstesGesamtPause = berechnePausenminuten(pausen);
      await updateDoc(d.ref, {
        endTime: schliesszeit,
        status: 'abgeschlossen',
        pausen,
        gesamtPauseMinuten: naechstesGesamtPause,
        autoGeschlossenUm24: true,
        korrekturLog: [...(session.korrekturLog ?? []), autoLog],
        aktualisiertAm: now(),
      });
      geschlossene.push({
        ...session,
        endTime: schliesszeit,
        status: 'abgeschlossen',
        pausen,
        gesamtPauseMinuten: naechstesGesamtPause,
        autoGeschlossenUm24: true,
        korrekturLog: [...(session.korrekturLog ?? []), autoLog],
      });
    }
  }
  return geschlossene;
}

// ---- Auto-geschlossene Session vom Vortag laden ------------

export async function ladeVortagesAutoGeschlossen(
  mitarbeiterId: string
): Promise<Arbeitszeit | null> {
  // Suche in den letzten 3 Tagen nach auto-geschlossenen Sessions
  const grenze = Date.now() - 3 * 24 * 60 * 60 * 1000;
  const q = query(
    collection(db, 'arbeitszeiten'),
    where('mitarbeiterId', '==', mitarbeiterId),
    where('startTime', '>=', grenze),
    orderBy('startTime', 'desc')
  );
  const snap = await getDocs(q);
  for (const d of snap.docs) {
    const s = { id: d.id, ...d.data() } as Arbeitszeit;
    if (s.autoGeschlossenUm24) return s;
  }
  return null;
}

// ---- NFC-Scan verarbeiten ----------------------------------

export type NfcAktion = 'eingestempelt' | 'ausgestempelt' | 'pause_gestartet' | 'pause_beendet' | 'bereits_eingestempelt';

export async function verarbeiteNfcScan(
  mitarbeiterId: string,
  standardTyp: ArbeitszeitsTyp = 'sonstige',
  ausgabeId?: string
): Promise<{ aktion: NfcAktion; session: Arbeitszeit }> {
  const aktive = await ladeAktiveSessionFuerMitarbeiter(mitarbeiterId);

  if (!aktive) {
    const session = await einstempeln(mitarbeiterId, standardTyp, 'nfc', ausgabeId);
    return { aktion: 'eingestempelt', session };
  }

  if (aktive.status === 'pause') {
    await pauseBeenden(aktive);
    return { aktion: 'pause_beendet', session: { ...aktive, status: 'aktiv' } };
  }

  // Aktiv → wird ausstempeln oder Pause über Dialog entschieden (zurückgeben)
  return { aktion: 'bereits_eingestempelt', session: aktive };
}

// ---- Manuelle Korrektur ------------------------------------

export async function korrigiereSession(
  session: Arbeitszeit,
  aenderungen: Partial<Pick<Arbeitszeit, 'startTime' | 'endTime' | 'pausen' | 'typ'>>,
  adminName: string,
  begruendung: string
): Promise<void> {
  const logEintrag: AuditEintrag = {
    zeitstempel: now(),
    adminName,
    aktion: `Korrektur: ${begruendung}`,
    vorher: JSON.stringify({
      startTime: session.startTime,
      endTime: session.endTime,
      pausen: session.pausen,
    }),
    nachher: JSON.stringify(aenderungen),
  };

  const neuerPausenstand = aenderungen.pausen ?? session.pausen;
  const update: Record<string, unknown> = {
    ...aenderungen,
    gesamtPauseMinuten: berechnePausenminuten(neuerPausenstand),
    korrekturLog: [...session.korrekturLog, logEintrag],
    aktualisiertAm: now(),
  };
  // Wenn die endTime überschrieben wird, ist das automatisch gesetzte
  // 23:59-Ende der Auto-Close-Routine nicht mehr „aktiv" — das Flag
  // soll dann zurück, damit Amber-Highlight & ⚠-Symbol verschwinden.
  if (aenderungen.endTime != null && session.autoGeschlossenUm24) {
    update.autoGeschlossenUm24 = false;
  }
  await updateDoc(doc(db, 'arbeitszeiten', session.id), update);
}

// ---- NFC-Tag beschreiben -----------------------------------

export async function beschreibeNfcTag(mitarbeiterId: string): Promise<void> {
  if (!('NDEFReader' in window)) {
    throw new Error('Web NFC wird von diesem Browser nicht unterstützt (Chrome auf Android erforderlich).');
  }
  // Schreibt eine URL auf den Chip — Scannen öffnet die App direkt auf der Mitarbeiter-Seite
  const url = `${window.location.origin}/nfc?ma=${encodeURIComponent(mitarbeiterId)}`;
  // @ts-ignore — NDEFReader ist noch nicht in allen TypeScript-Definitionen
  const ndef = new NDEFReader();
  await ndef.write({
    records: [{ recordType: 'url', data: url }],
  });
}

export async function leseNfcTag(): Promise<string> {
  if (!('NDEFReader' in window)) {
    throw new Error('Web NFC wird von diesem Browser nicht unterstützt.');
  }
  return new Promise((resolve, reject) => {
    // @ts-ignore
    const ndef = new NDEFReader();
    ndef.scan().then(() => {
      ndef.addEventListener('reading', ({ message }: any) => {
        for (const record of message.records) {
          if (record.recordType === 'text') {
            const decoder = new TextDecoder();
            resolve(decoder.decode(record.data));
            return;
          }
        }
        reject(new Error('Kein lesbarer Text auf dem NFC-Tag gefunden.'));
      });
      ndef.addEventListener('readingerror', () => {
        reject(new Error('NFC-Lesefehler.'));
      });
    }).catch(reject);
  });
}

export function nfcVerfuegbar(): boolean {
  return 'NDEFReader' in window;
}

// ---- Hilfsfunktionen ---------------------------------------

export function berechnePausenminuten(pausen: Pause[]): number {
  return pausen.reduce((sum, p) => {
    if (p.ende === null) return sum;
    return sum + (p.ende - p.start) / 60_000;
  }, 0);
}

export function berechneNettoMinuten(session: Arbeitszeit): number {
  if (!session.endTime) {
    const brutto = (now() - session.startTime) / 60_000;
    return Math.max(0, brutto - session.gesamtPauseMinuten);
  }
  const brutto = (session.endTime - session.startTime) / 60_000;
  return Math.max(0, brutto - session.gesamtPauseMinuten);
}

export function formatierZeit(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString('de-DE', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatierDatum(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString('de-DE', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

export function formatierDauer(minuten: number): string {
  const h = Math.floor(minuten / 60);
  const m = Math.round(minuten % 60);
  return `${h}:${m.toString().padStart(2, '0')} h`;
}

// Monatliche Arbeitszeiten laden
export async function ladeMonatsarbeitszeiten(
  mitarbeiterId: string,
  jahr: number,
  monat: number
): Promise<Arbeitszeit[]> {
  const von = new Date(jahr, monat - 1, 1).getTime();
  const bis = new Date(jahr, monat, 1).getTime();
  const q = query(
    collection(db, 'arbeitszeiten'),
    where('mitarbeiterId', '==', mitarbeiterId),
    where('startTime', '>=', von),
    where('startTime', '<', bis),
    orderBy('startTime', 'asc')
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as Arbeitszeit));
}

export async function ladeAlleMonatsarbeitszeiten(
  jahr: number,
  monat: number
): Promise<Arbeitszeit[]> {
  const von = new Date(jahr, monat - 1, 1).getTime();
  const bis = new Date(jahr, monat, 1).getTime();
  const q = query(
    collection(db, 'arbeitszeiten'),
    where('startTime', '>=', von),
    where('startTime', '<', bis),
    orderBy('startTime', 'asc')
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as Arbeitszeit));
}

// ---- Überlappungs-Prüfung (Plausi-Check) --------------------
// Für manuelle Erfassung / Korrektur von Arbeitszeiten.
// Ein Mitarbeiter kann zu einem Zeitpunkt nur EINE Tätigkeit ausführen.

/**
 * Prüft, ob sich [start, end) mit einer vorhandenen Arbeitszeit des Mitarbeiters
 * überschneidet. Offene Sessions (endTime === null) werden bis "jetzt" gewertet.
 * @param mitarbeiterId Mitarbeiter-ID
 * @param start Start in ms (inklusive)
 * @param end Ende in ms (exklusive)
 * @param excludeId Optionale Arbeitszeit-ID, die ignoriert werden soll (beim Bearbeiten)
 * @returns Konflikt-Session oder null
 */
export async function pruefeZeitUeberlappung(
  mitarbeiterId: string,
  start: number,
  end: number,
  excludeId?: string
): Promise<Arbeitszeit | null> {
  const q = query(
    collection(db, 'arbeitszeiten'),
    where('mitarbeiterId', '==', mitarbeiterId)
  );
  const snap = await getDocs(q);
  const jetzt = Date.now();
  for (const d of snap.docs) {
    if (excludeId && d.id === excludeId) continue;
    const a = { id: d.id, ...d.data() } as Arbeitszeit;
    const aEnde = a.endTime ?? jetzt;
    // Überlappung: NICHT (neu komplett davor ODER neu komplett danach)
    if (!(end <= a.startTime || start >= aEnde)) {
      return a;
    }
  }
  return null;
}

/**
 * Formatiert einen Konflikt als Fehlermeldung für Alerts.
 */
export function formatiereUeberlappungsFehler(konflikt: Arbeitszeit): string {
  const fmt = (ts: number) =>
    new Date(ts).toLocaleString('de-DE', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  const typLabels: Record<string, string> = {
    austragen: 'Austragen',
    zusammentragen: 'Zusammentragen',
    vorarbeit: 'Vorarbeit',
    buero: 'Büro',
    fahrt: 'Fahrt',
    sonstiges: 'Sonstiges',
  };
  const typText = typLabels[konflikt.typ] ?? konflikt.typ;
  const endText = konflikt.endTime ? fmt(konflikt.endTime) : '(noch aktiv)';
  return (
    `Überlappung mit bestehender Arbeitszeit (${typText}):\n` +
    `${fmt(konflikt.startTime)} → ${endText}\n\n` +
    `Eine Person kann zu einem Zeitpunkt nur eine Tätigkeit ausführen.`
  );
}
