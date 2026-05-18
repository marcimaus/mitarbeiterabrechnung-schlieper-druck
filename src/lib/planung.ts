// ============================================================
// Firestore-CRUD für die Personalplanung (Drucksaal + Austräger)
// ============================================================
//
// Vier Collections (`drucksaalPlanung`, `fahrerPlanung`,
// `zusammentragerPlanung`, `austraegerAusfaelle`). Jede Zelle hat einen
// deterministischen Composite-Key, sodass wiederholtes Speichern derselben
// (jahr, kw, x) idempotent ist und kein zweiter Datensatz entsteht.
//
// Auch das Setzen auf "leer" (Mitarbeiter abwählen) wird unterstützt:
// dann wird der Datensatz gelöscht statt mit `null` belegt — das hält
// die Collection schlank, und Live-Updates per Listener bleiben einfach.

import {
  collection,
  doc,
  setDoc,
  deleteDoc,
  getDoc,
  getDocs,
  query,
  where,
  onSnapshot,
  type Unsubscribe,
} from 'firebase/firestore';
import { db } from './firebase';
import type {
  DrucksaalPlanung,
  DrucksaalTaetigkeit,
  FahrerPlanung,
  ZusammentragerPlanung,
  ZusammentragerStatus,
  UrlaubsEintrag,
  UrlaubStatus,
  StandardAustraegerWechselPlan,
} from '../types';

function now(): number {
  return Date.now();
}

function stripUndef(obj: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));
}

// ============================================================
// Drucksaal-Planung
// ============================================================

const DRUCKSAAL_COLL = 'drucksaalPlanung';

function drucksaalDocId(jahr: number, kw: number, t: DrucksaalTaetigkeit): string {
  return `${jahr}-${kw}-${t}`;
}

export function drucksaalPlanungListener(
  jahr: number,
  cb: (list: DrucksaalPlanung[]) => void,
): Unsubscribe {
  const q = query(collection(db, DRUCKSAAL_COLL), where('jahr', '==', jahr));
  return onSnapshot(q, (snap) => {
    cb(snap.docs.map((d) => ({ id: d.id, ...d.data() } as DrucksaalPlanung)));
  });
}

export async function setzeDrucksaalPlanung(
  jahr: number,
  kw: number,
  taetigkeit: DrucksaalTaetigkeit,
  mitarbeiterId: string | null,
  kommentar?: string,
): Promise<void> {
  const id = drucksaalDocId(jahr, kw, taetigkeit);
  const ref = doc(db, DRUCKSAAL_COLL, id);
  const kommentarClean = kommentar?.trim();
  // Wenn weder MA noch Kommentar gesetzt: Datensatz löschen.
  if (!mitarbeiterId && !kommentarClean) {
    await deleteDoc(ref).catch(() => {});
    return;
  }
  const existing = await getDoc(ref);
  const ts = now();
  await setDoc(ref, stripUndef({
    jahr,
    kw,
    taetigkeit,
    mitarbeiterId: mitarbeiterId ?? null,
    kommentar: kommentarClean || undefined,
    erstelltAm: existing.exists() ? (existing.data().erstelltAm ?? ts) : ts,
    aktualisiertAm: ts,
  }));
}

// ============================================================
// Fahrer-Planung
// ============================================================

const FAHRER_COLL = 'fahrerPlanung';

function fahrerDocId(jahr: number, kw: number, tourId: string): string {
  return `${jahr}-${kw}-${tourId}`;
}

export function fahrerPlanungListener(
  jahr: number,
  cb: (list: FahrerPlanung[]) => void,
): Unsubscribe {
  const q = query(collection(db, FAHRER_COLL), where('jahr', '==', jahr));
  return onSnapshot(q, (snap) => {
    cb(snap.docs.map((d) => ({ id: d.id, ...d.data() } as FahrerPlanung)));
  });
}

export async function setzeFahrerPlanung(
  jahr: number,
  kw: number,
  tourId: string,
  mitarbeiterId: string | null,
  kommentar?: string,
): Promise<void> {
  const id = fahrerDocId(jahr, kw, tourId);
  const ref = doc(db, FAHRER_COLL, id);
  const kommentarClean = kommentar?.trim();
  if (!mitarbeiterId && !kommentarClean) {
    await deleteDoc(ref).catch(() => {});
    return;
  }
  const existing = await getDoc(ref);
  const ts = now();
  await setDoc(ref, stripUndef({
    jahr,
    kw,
    tourId,
    mitarbeiterId: mitarbeiterId ?? null,
    kommentar: kommentarClean || undefined,
    erstelltAm: existing.exists() ? (existing.data().erstelltAm ?? ts) : ts,
    aktualisiertAm: ts,
  }));
}

// ============================================================
// Zusammenträger-Planung
// ============================================================

const ZUSAMMEN_COLL = 'zusammentragerPlanung';

function zusammenDocId(jahr: number, kw: number, mitarbeiterId: string): string {
  return `${jahr}-${kw}-${mitarbeiterId}`;
}

export function zusammentragerPlanungListener(
  jahr: number,
  cb: (list: ZusammentragerPlanung[]) => void,
): Unsubscribe {
  const q = query(collection(db, ZUSAMMEN_COLL), where('jahr', '==', jahr));
  return onSnapshot(q, (snap) => {
    cb(snap.docs.map((d) => ({ id: d.id, ...d.data() } as ZusammentragerPlanung)));
  });
}

export async function setzeZusammentragerPlanung(
  jahr: number,
  kw: number,
  mitarbeiterId: string,
  status: ZusammentragerStatus | null,
  kommentar?: string,
): Promise<void> {
  const id = zusammenDocId(jahr, kw, mitarbeiterId);
  // Wenn weder Status noch Kommentar gesetzt — Datensatz löschen.
  if (!status && !kommentar) {
    await deleteDoc(doc(db, ZUSAMMEN_COLL, id)).catch(() => {});
    return;
  }
  const ref = doc(db, ZUSAMMEN_COLL, id);
  const existing = await getDoc(ref);
  const ts = now();
  await setDoc(
    ref,
    stripUndef({
      jahr,
      kw,
      mitarbeiterId,
      // Status bleibt optional: ein Eintrag mit nur Kommentar (Status=null)
      // soll den Chip NICHT aktivieren — daher hier nicht auf 'kommt' defaulten.
      status: status ?? undefined,
      kommentar: kommentar?.trim() ? kommentar.trim() : undefined,
      erstelltAm: existing.exists() ? (existing.data().erstelltAm ?? ts) : ts,
      aktualisiertAm: ts,
    }),
  );
}

// ============================================================
// Hinweis: Austräger-Ausfälle / Springer werden NICHT mehr in einer
// eigenen Planungs-Collection geführt. Die PlanungScreen-Sektion
// „Austräger-Ausfälle / Springer" liest und schreibt direkt in die
// Collection `einsaetze` (siehe `einsaetzeJahrListener`, `setzeEinsatz`,
// `loescheEinsatz`, `getOrCreateAusgabe` in `src/lib/db.ts`).
// ============================================================

// ============================================================
// Urlaubs-Planung
// ============================================================
//
// Ein Eintrag pro (jahr, kw, mitarbeiterId). Mehrwöchige Urlaube werden
// als separate Einträge pro Woche gespeichert — vom Aufrufer (UI) so
// gewünscht. Der Aufrufer ruft `setzeUrlaub` einmal pro betroffener KW
// mit identischen von/bis-Daten auf.
//
// Freigabe-Workflow:
//   Admin    → freigegeben:true  beim Anlegen
//   Abrechnung → freigegeben:false → Admin entscheidet später

const URLAUB_COLL = 'urlaubsplanung';

function urlaubDocId(jahr: number, kw: number, mitarbeiterId: string): string {
  return `${jahr}-${kw}-${mitarbeiterId}`;
}

export function urlaubsListener(
  jahr: number,
  cb: (list: UrlaubsEintrag[]) => void,
): Unsubscribe {
  const q = query(collection(db, URLAUB_COLL), where('jahr', '==', jahr));
  return onSnapshot(q, (snap) => {
    cb(snap.docs.map((d) => ({ id: d.id, ...d.data() } as UrlaubsEintrag)));
  });
}

/**
 * Lädt alle Urlaubseinträge eines bestimmten Mitarbeiters — jahresübergreifend.
 * Wird im Mitarbeiter-Form (Reiter „Urlaub") verwendet.
 */
export function urlaubsListenerProMa(
  mitarbeiterId: string,
  cb: (list: UrlaubsEintrag[]) => void,
): Unsubscribe {
  const q = query(collection(db, URLAUB_COLL), where('mitarbeiterId', '==', mitarbeiterId));
  return onSnapshot(q, (snap) => {
    cb(snap.docs.map((d) => ({ id: d.id, ...d.data() } as UrlaubsEintrag)));
  });
}

/**
 * Lädt alle nicht freigegebenen Urlaubseinträge (von Abrechnung erstellt) —
 * für die Startseiten-Hinweisbox. Live über onSnapshot, weil die Liste sich
 * jederzeit durch Freigaben verändern kann.
 */
export function urlaubsAusstehendListener(
  cb: (list: UrlaubsEintrag[]) => void,
): Unsubscribe {
  // Composite-Index könnte nötig sein; wir filtern client-seitig, das ist
  // bei wenigen offenen Anträgen vertretbar.
  const q = query(collection(db, URLAUB_COLL), where('freigegeben', '==', false));
  return onSnapshot(q, (snap) => {
    cb(snap.docs.map((d) => ({ id: d.id, ...d.data() } as UrlaubsEintrag)));
  });
}

export async function setzeUrlaub(
  jahr: number,
  kw: number,
  mitarbeiterId: string,
  status: UrlaubStatus,
  details: {
    datumVon?: string;
    datumBis?: string;
    kommentar?: string;
    externerLink?: string;
    werktageInKw?: string[];
    erstellerName: string;
    erstellerRolle: 'admin' | 'abrechnung';
  },
): Promise<void> {
  const id = urlaubDocId(jahr, kw, mitarbeiterId);
  const ref = doc(db, URLAUB_COLL, id);
  const existing = await getDoc(ref);
  const ts = now();
  const ex = existing.exists() ? (existing.data() as UrlaubsEintrag) : null;

  // Wenn der Eintrag schon freigegeben ist und der neue Bearbeiter
  // Abrechnung ist: nur Kommentar ergänzen, sonst nichts überschreiben.
  // Diese Policy wird endgültig in der UI durchgesetzt; hier nur als
  // Backup, um versehentliches Übergehen zu verhindern.
  if (ex && ex.freigegeben && details.erstellerRolle === 'abrechnung') {
    await setDoc(
      ref,
      stripUndef({
        ...ex,
        kommentar: details.kommentar?.trim() || ex.kommentar,
        aktualisiertAm: ts,
      }),
    );
    return;
  }

  await setDoc(
    ref,
    stripUndef({
      jahr,
      kw,
      mitarbeiterId,
      status,
      datumVon: details.datumVon || undefined,
      datumBis: details.datumBis || undefined,
      werktageInKw: details.werktageInKw && details.werktageInKw.length > 0 ? details.werktageInKw : undefined,
      kommentar: details.kommentar?.trim() || undefined,
      externerLink: details.externerLink?.trim() || undefined,
      // Ersteller-Daten bleiben beim ersten Anlegen erhalten — Updates
      // ändern den Ersteller nicht.
      erstellerName: ex?.erstellerName ?? details.erstellerName,
      erstellerRolle: ex?.erstellerRolle ?? details.erstellerRolle,
      // Freigabe: Admin-Anlage = sofort frei; Abrechnung-Anlage = offen.
      // Beim Update wird der bestehende Freigabe-Status nicht angetastet.
      freigegeben: ex?.freigegeben ?? (details.erstellerRolle === 'admin'),
      freigegebenVon: ex?.freigegebenVon,
      freigegebenAm: ex?.freigegebenAm,
      erstelltAm: ex?.erstelltAm ?? ts,
      aktualisiertAm: ts,
    }),
  );
}

export async function loescheUrlaub(
  jahr: number,
  kw: number,
  mitarbeiterId: string,
): Promise<void> {
  const id = urlaubDocId(jahr, kw, mitarbeiterId);
  await deleteDoc(doc(db, URLAUB_COLL, id)).catch(() => {});
}

/** Admin-Freigabe — nur Admin darf aufrufen (UI-Check). */
export async function freigebenUrlaub(
  jahr: number,
  kw: number,
  mitarbeiterId: string,
  adminName: string,
): Promise<void> {
  const id = urlaubDocId(jahr, kw, mitarbeiterId);
  const ref = doc(db, URLAUB_COLL, id);
  const existing = await getDoc(ref);
  if (!existing.exists()) return;
  const ts = now();
  await setDoc(
    ref,
    stripUndef({
      ...existing.data(),
      freigegeben: true,
      freigegebenVon: adminName,
      freigegebenAm: ts,
      aktualisiertAm: ts,
    }),
  );
}

// ============================================================
// Urlaubs-Gruppen-Operationen
// ============================================================
//
// Ein Urlaub kann sich über mehrere Wochen erstrecken. Wir speichern pro
// betroffener KW einen separaten Datensatz (siehe Designentscheidung im
// UrlaubsEintrag-Header), damit die KW-Matrix-Darstellung trivial bleibt.
//
// Aus User-Sicht sind diese Datensätze aber EIN Urlaub — daher müssen
// Bearbeiten/Löschen/Freigeben immer die ganze Gruppe treffen. Eine
// Gruppe wird identifiziert über (mitarbeiterId, datumVon, datumBis):
// alle Datensätze mit identischem Tripel gelten als Geschwister.

/** Findet alle Datensätze einer Gruppe (mitarbeiterId + datumVon + datumBis). */
async function findeUrlaubsGruppe(
  mitarbeiterId: string,
  datumVon: string,
  datumBis: string,
): Promise<UrlaubsEintrag[]> {
  const q = query(
    collection(db, URLAUB_COLL),
    where('mitarbeiterId', '==', mitarbeiterId),
    where('datumVon', '==', datumVon),
    where('datumBis', '==', datumBis),
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as UrlaubsEintrag));
}

/**
 * Upsert für eine komplette Urlaubsgruppe (mehrwöchig).
 *  - Jede Ziel-KW bekommt ihren EIGENEN Status (z. B. „ganze-woche",
 *    „mehrtaegig", „einzeltag") — abgeleitet aus der Anzahl Werktage,
 *    die im Zeitraum [datumVon, datumBis] auf diese KW fallen. Der
 *    Aufrufer übergibt die fertig berechnete Liste.
 *  - Alle alten Geschwister (= Datensätze mit oldDatumVon/Bis) werden
 *    eingesammelt; jene, deren KW NICHT im neuen Wochenfenster liegt,
 *    werden gelöscht.
 *  - Bestehender Freigabe-Status und Ersteller-Daten bleiben pro KW
 *    erhalten (über `setzeUrlaub` indirekt).
 */
export async function setzeUrlaubsGruppe(
  mitarbeiterId: string,
  neueWochen: Array<{ jahr: number; kw: number; status: UrlaubStatus; werktageInKw: string[] }>,
  details: {
    datumVon: string;
    datumBis: string;
    kommentar?: string;
    externerLink?: string;
    erstellerName: string;
    erstellerRolle: 'admin' | 'abrechnung';
    // Falls die Gruppe vorher andere von/bis-Daten hatte (z. B. weil der
    // User den Zeitraum verschoben hat), brauchen wir diese, um die alten
    // Geschwister zu finden und ggf. zu löschen.
    altDatumVon?: string;
    altDatumBis?: string;
  },
): Promise<void> {
  // 1. Alte Geschwister einsammeln — beide Tripel checken, falls
  //    der Zeitraum verändert wurde.
  const altGeschwister: UrlaubsEintrag[] = [];
  const seen = new Set<string>();
  const addUnique = (list: UrlaubsEintrag[]) => {
    for (const e of list) if (!seen.has(e.id)) { seen.add(e.id); altGeschwister.push(e); }
  };
  if (details.altDatumVon && details.altDatumBis) {
    addUnique(await findeUrlaubsGruppe(mitarbeiterId, details.altDatumVon, details.altDatumBis));
  }
  addUnique(await findeUrlaubsGruppe(mitarbeiterId, details.datumVon, details.datumBis));

  // 2. Welche KWs sollen verbleiben?
  const neueKwSet = new Set(neueWochen.map((w) => `${w.jahr}-${w.kw}`));

  // 3. Verwaiste Geschwister löschen — also alle, deren (jahr,kw) nicht
  //    im neuen Fenster liegen.
  await Promise.all(
    altGeschwister
      .filter((e) => !neueKwSet.has(`${e.jahr}-${e.kw}`))
      .map((e) => loescheUrlaub(e.jahr, e.kw, e.mitarbeiterId)),
  );

  // 4. Für jede KW im neuen Fenster mit eigenem Status setzen.
  for (const w of neueWochen) {
    await setzeUrlaub(w.jahr, w.kw, mitarbeiterId, w.status, {
      datumVon: details.datumVon,
      datumBis: details.datumBis,
      kommentar: details.kommentar,
      externerLink: details.externerLink,
      werktageInKw: w.werktageInKw,
      erstellerName: details.erstellerName,
      erstellerRolle: details.erstellerRolle,
    });
  }
}

/** Löscht alle Datensätze einer Gruppe. */
export async function loescheUrlaubsGruppe(
  mitarbeiterId: string,
  datumVon: string,
  datumBis: string,
): Promise<void> {
  const geschwister = await findeUrlaubsGruppe(mitarbeiterId, datumVon, datumBis);
  await Promise.all(
    geschwister.map((e) => loescheUrlaub(e.jahr, e.kw, e.mitarbeiterId)),
  );
}

/** Freigabe für alle Datensätze einer Gruppe gleichzeitig. */
export async function freigebenUrlaubsGruppe(
  mitarbeiterId: string,
  datumVon: string,
  datumBis: string,
  adminName: string,
): Promise<void> {
  const geschwister = await findeUrlaubsGruppe(mitarbeiterId, datumVon, datumBis);
  await Promise.all(
    geschwister.map((e) =>
      freigebenUrlaub(e.jahr, e.kw, e.mitarbeiterId, adminName),
    ),
  );
}

// ============================================================
// Standardausträger-Wechselplanung (dauerhaft)
// ============================================================
//
// Eine separate Collection für geplante dauerhafte Wechsel:
// „TG X wird ab Ausgabe KW/Jahr nicht mehr von Austräger A, sondern von
// Austräger B verteilt". Pro TG genau ein Eintrag (Doc-ID = TG-ID).

const WECHSEL_COLL = 'austraegerwechselPlan';

export function austraegerwechselPlanListener(
  cb: (list: StandardAustraegerWechselPlan[]) => void,
): Unsubscribe {
  return onSnapshot(collection(db, WECHSEL_COLL), (snap) => {
    cb(snap.docs.map((d) => ({ id: d.id, ...d.data() } as StandardAustraegerWechselPlan)));
  });
}

export async function setzeAustraegerwechselPlan(
  data: Omit<StandardAustraegerWechselPlan, 'id' | 'erstelltAm' | 'aktualisiertAm'>,
): Promise<void> {
  const ref = doc(db, WECHSEL_COLL, data.teilgebietId);
  const existing = await getDoc(ref);
  const ts = now();
  await setDoc(
    ref,
    stripUndef({
      ...data,
      erstelltAm: existing.exists() ? (existing.data().erstelltAm ?? ts) : ts,
      aktualisiertAm: ts,
    }),
  );
}

export async function loescheAustraegerwechselPlan(teilgebietId: string): Promise<void> {
  await deleteDoc(doc(db, WECHSEL_COLL, teilgebietId)).catch(() => {});
}
