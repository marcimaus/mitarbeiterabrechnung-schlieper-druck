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
  quelle: 'nfc' | 'manuell' = 'nfc'
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

export async function schliesseAbgelaufeneSessions(): Promise<void> {
  const q = query(
    collection(db, 'arbeitszeiten'),
    where('status', 'in', ['aktiv', 'pause'])
  );
  const snap = await getDocs(q);
  const heute = new Date();

  for (const d of snap.docs) {
    const session = { id: d.id, ...d.data() } as Arbeitszeit;
    const startDatum = new Date(session.startTime);
    const startTag = new Date(startDatum.getFullYear(), startDatum.getMonth(), startDatum.getDate());
    const heute2 = new Date(heute.getFullYear(), heute.getMonth(), heute.getDate());
    // Wenn Session von gestern oder früher → automatisch schließen
    if (startTag < heute2) {
      const schliesszeit = new Date(startDatum.getFullYear(), startDatum.getMonth(), startDatum.getDate(), 23, 59, 0).getTime();
      const pausen = [...session.pausen];
      const offenePause = pausen.findLastIndex((p) => p.ende === null);
      if (offenePause >= 0) {
        pausen[offenePause] = { ...pausen[offenePause], ende: schliesszeit };
      }
      await updateDoc(d.ref, {
        endTime: schliesszeit,
        status: 'abgeschlossen',
        pausen,
        gesamtPauseMinuten: berechnePausenminuten(pausen),
        autoGeschlossenUm24: true,
        aktualisiertAm: now(),
      });
    }
  }
}

// ---- NFC-Scan verarbeiten ----------------------------------

export type NfcAktion = 'eingestempelt' | 'ausgestempelt' | 'pause_gestartet' | 'pause_beendet' | 'bereits_eingestempelt';

export async function verarbeiteNfcScan(
  mitarbeiterId: string,
  standardTyp: ArbeitszeitsTyp = 'büro'
): Promise<{ aktion: NfcAktion; session: Arbeitszeit }> {
  const aktive = await ladeAktiveSessionFuerMitarbeiter(mitarbeiterId);

  if (!aktive) {
    const session = await einstempeln(mitarbeiterId, standardTyp, 'nfc');
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
  await updateDoc(doc(db, 'arbeitszeiten', session.id), {
    ...aenderungen,
    gesamtPauseMinuten: berechnePausenminuten(neuerPausenstand),
    korrekturLog: [...session.korrekturLog, logEintrag],
    aktualisiertAm: now(),
  });
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
